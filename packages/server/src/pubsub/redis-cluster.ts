/**
 * Redis Cluster Pub/Sub Adapter for ReactiveBase.
 *
 * Extends the standard Redis adapter with cluster-specific features:
 *   - Multi-node awareness with automatic topology discovery
 *   - Connection failover with configurable retry strategies
 *   - Auto-reconnect on node failures
 *   - Health monitoring per node
 *
 * Redis Cluster pub/sub is global (messages are broadcast to all nodes),
 * so the adapter only needs to connect to one node for subscriptions.
 * On failure, it reconnects to a different node.
 */

import type { ChangeEvent } from "../reactivity/index.js"
import type { PubSubAdapter, RedisLike } from "./pubsub.js"
import { randomUUID } from "node:crypto"

// ── Types ────────────────────────────────────────────────────────────────────

export interface ClusterNode {
  host: string
  port: number
  id?: string
}

export type RetryStrategy = (attempt: number) => number | null

export interface RedisClusterPubSubOptions {
  /** Seed nodes for cluster discovery */
  nodes: ClusterNode[]
  /** Server ID for self-message filtering */
  serverId?: string
  /** Max reconnect attempts before giving up (default: 10) */
  maxReconnectAttempts?: number
  /** Base delay in ms between reconnect attempts (default: 1000) */
  reconnectBaseDelayMs?: number
  /** Max delay in ms between reconnect attempts (default: 30000) */
  reconnectMaxDelayMs?: number
  /** Custom retry strategy. Return delay in ms or null to stop retrying. */
  retryStrategy?: RetryStrategy
  /** Health check interval in ms (default: 30000) */
  healthCheckIntervalMs?: number
  /** Connection timeout in ms (default: 5000) */
  connectTimeoutMs?: number
  /** Logger (default: console) */
  logger?: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }
}

export interface ClusterNodeHealth {
  node: ClusterNode
  isHealthy: boolean
  lastChecked: Date
  latencyMs: number
  consecutiveFailures: number
}

export type ClusterAdapterState = "disconnected" | "connecting" | "connected" | "reconnecting" | "closed"

export interface ClusterAdapterStats {
  state: ClusterAdapterState
  activeNode: ClusterNode | null
  publishCount: number
  receiveCount: number
  reconnectAttempts: number
  lastReconnectAt: Date | null
  nodeHealth: ClusterNodeHealth[]
}

// ── Default retry strategy: exponential backoff with jitter ──────────────────

function defaultRetryStrategy(attempt: number, baseDelay: number, maxDelay: number): number | null {
  if (attempt > 10) return null
  const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay)
  const jitter = delay * 0.2 * Math.random()
  return Math.round(delay + jitter)
}

// ── Redis Cluster Pub/Sub Adapter ────────────────────────────────────────────

export class RedisClusterPubSubAdapter implements PubSubAdapter {
  private nodes: ClusterNode[]
  private serverId: string
  private publisher: RedisLike | null = null
  private subscriber: RedisLike | null = null
  private handlers = new Map<string, (events: ChangeEvent[]) => void>()
  private state: ClusterAdapterState = "disconnected"
  private currentNodeIndex = 0
  private reconnectAttempts = 0
  private lastReconnectAt: Date | null = null
  private publishCount = 0
  private receiveCount = 0
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private nodeHealth: Map<string, ClusterNodeHealth> = new Map()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  private maxReconnectAttempts: number
  private reconnectBaseDelayMs: number
  private reconnectMaxDelayMs: number
  private retryStrategy: RetryStrategy
  private healthCheckIntervalMs: number
  private logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }

  constructor(
    private createClient: (node: ClusterNode) => RedisLike,
    options: RedisClusterPubSubOptions,
  ) {
    if (!options.nodes || options.nodes.length === 0) {
      throw new Error("RedisClusterPubSubAdapter requires at least one seed node")
    }

    this.nodes = [...options.nodes]
    this.serverId = options.serverId ?? `csrv_${randomUUID().substring(0, 8)}_${Date.now().toString(36)}`
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 1000
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30_000
    this.retryStrategy =
      options.retryStrategy ??
      ((attempt) => defaultRetryStrategy(attempt, this.reconnectBaseDelayMs, this.reconnectMaxDelayMs))
    this.healthCheckIntervalMs = options.healthCheckIntervalMs ?? 30_000
    // eslint-disable-next-line no-console
    this.logger = options.logger ?? { info: console.log, warn: console.warn, error: console.error }

    // Initialize health tracking
    for (const node of this.nodes) {
      const key = nodeKey(node)
      this.nodeHealth.set(key, {
        node,
        isHealthy: true,
        lastChecked: new Date(),
        latencyMs: 0,
        consecutiveFailures: 0,
      })
    }
  }

  /**
   * Publish change events to a channel. Auto-connects on first call.
   */
  async publish(channel: string, events: ChangeEvent[]): Promise<void> {
    if (this.state === "closed") return

    if (!this.publisher) {
      await this.connectPublisher()
    }

    const message = JSON.stringify({
      serverId: this.serverId,
      events,
      timestamp: Date.now(),
    })

    try {
      await this.publisher!.publish(channel, message)
      this.publishCount++
    } catch (err) {
      this.logger.warn(`Publish failed on ${nodeKey(this.getCurrentNode())}: ${err}`)
      await this.handlePublisherFailure()
      // Retry once on the new node
      if (this.publisher) {
        await this.publisher.publish(channel, message)
        this.publishCount++
      }
    }
  }

  /**
   * Subscribe to change events on a channel. Auto-connects on first call.
   */
  async subscribe(channel: string, handler: (events: ChangeEvent[]) => void): Promise<void> {
    if (this.state === "closed") return

    this.handlers.set(channel, handler)

    if (!this.subscriber) {
      await this.connectSubscriber()
    }

    await this.subscriber!.subscribe(channel)
  }

  /**
   * Unsubscribe from a channel.
   */
  async unsubscribe(channel: string): Promise<void> {
    this.handlers.delete(channel)
    if (this.subscriber) {
      try {
        await this.subscriber.unsubscribe(channel)
      } catch {
        // Ignore unsubscribe errors — connection may be dead
      }
    }
  }

  /**
   * Gracefully close all connections and stop health checks.
   */
  async close(): Promise<void> {
    this.state = "closed"
    this.stopHealthChecks()

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    const closeOps: Promise<void>[] = []
    if (this.publisher) {
      closeOps.push(this.publisher.quit().catch(() => {}))
      this.publisher = null
    }
    if (this.subscriber) {
      closeOps.push(this.subscriber.quit().catch(() => {}))
      this.subscriber = null
    }
    await Promise.all(closeOps)

    this.handlers.clear()
  }

  /**
   * Start periodic health checks on all known nodes.
   */
  startHealthChecks(): void {
    if (this.healthCheckTimer) return
    this.healthCheckTimer = setInterval(() => this.runHealthChecks(), this.healthCheckIntervalMs)
  }

  /**
   * Stop periodic health checks.
   */
  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  /**
   * Get adapter statistics.
   */
  getStats(): ClusterAdapterStats {
    return {
      state: this.state,
      activeNode: this.state !== "disconnected" && this.state !== "closed" ? this.getCurrentNode() : null,
      publishCount: this.publishCount,
      receiveCount: this.receiveCount,
      reconnectAttempts: this.reconnectAttempts,
      lastReconnectAt: this.lastReconnectAt,
      nodeHealth: Array.from(this.nodeHealth.values()),
    }
  }

  /**
   * Get the list of known healthy nodes.
   */
  getHealthyNodes(): ClusterNode[] {
    return Array.from(this.nodeHealth.values())
      .filter((h) => h.isHealthy)
      .map((h) => h.node)
  }

  // ── Private: Connection Management ──────────────────────────────────────────

  private getCurrentNode(): ClusterNode {
    return this.nodes[this.currentNodeIndex % this.nodes.length]
  }

  private getNextNode(): ClusterNode {
    // Prefer healthy nodes
    const healthy = this.getHealthyNodes()
    if (healthy.length > 0) {
      this.currentNodeIndex = this.nodes.indexOf(healthy[this.currentNodeIndex % healthy.length] ?? healthy[0])
      if (this.currentNodeIndex === -1) this.currentNodeIndex = 0
    } else {
      // Round-robin through all nodes
      this.currentNodeIndex = (this.currentNodeIndex + 1) % this.nodes.length
    }
    return this.getCurrentNode()
  }

  private async connectPublisher(): Promise<void> {
    const node = this.getCurrentNode()
    this.publisher = this.createClient(node)
    this.state = "connected"
  }

  private async connectSubscriber(): Promise<void> {
    const node = this.getCurrentNode()
    this.subscriber = this.createClient(node)
    this.state = "connected"

    this.subscriber.on("message", (channel: string, message: string) => {
      const handler = this.handlers.get(channel)
      if (!handler) return

      try {
        const parsed = JSON.parse(message) as { serverId: string; events: ChangeEvent[] }
        if (parsed.serverId === this.serverId) return
        this.receiveCount++
        handler(parsed.events)
      } catch {
        this.logger.error("Failed to parse cluster pub/sub message")
      }
    })
  }

  private async handlePublisherFailure(): Promise<void> {
    if (this.publisher) {
      try {
        await this.publisher.quit()
      } catch {
        /* ignore */
      }
      this.publisher = null
    }

    this.markCurrentNodeUnhealthy()
    this.getNextNode()

    try {
      await this.connectPublisher()
    } catch (err) {
      this.logger.error(`Failed to reconnect publisher: ${err}`)
    }
  }

  private async handleSubscriberFailure(): Promise<void> {
    if (this.subscriber) {
      try {
        await this.subscriber.quit()
      } catch {
        /* ignore */
      }
      this.subscriber = null
    }

    this.markCurrentNodeUnhealthy()
    this.state = "reconnecting"
    this.reconnectAttempts++
    this.lastReconnectAt = new Date()

    const delay = this.retryStrategy(this.reconnectAttempts)
    if (delay === null || this.reconnectAttempts > this.maxReconnectAttempts) {
      this.logger.error(`Max reconnect attempts (${this.maxReconnectAttempts}) reached — giving up`)
      this.state = "disconnected"
      return
    }

    this.logger.info(`Reconnecting subscriber in ${delay}ms (attempt ${this.reconnectAttempts})`)

    await new Promise<void>((resolve) => {
      this.reconnectTimer = setTimeout(async () => {
        this.reconnectTimer = null
        try {
          this.getNextNode()
          await this.connectSubscriber()
          // Re-subscribe to all channels
          for (const channel of this.handlers.keys()) {
            await this.subscriber!.subscribe(channel)
          }
          this.state = "connected"
          this.reconnectAttempts = 0
          this.logger.info(`Reconnected to ${nodeKey(this.getCurrentNode())}`)
        } catch (err) {
          this.logger.warn(`Reconnect attempt ${this.reconnectAttempts} failed: ${err}`)
          await this.handleSubscriberFailure()
        }
        resolve()
      }, delay)
    })
  }

  private markCurrentNodeUnhealthy(): void {
    const key = nodeKey(this.getCurrentNode())
    const health = this.nodeHealth.get(key)
    if (health) {
      health.isHealthy = false
      health.consecutiveFailures++
      health.lastChecked = new Date()
    }
  }

  private async runHealthChecks(): Promise<void> {
    for (const [key, health] of this.nodeHealth) {
      if (health.isHealthy) continue

      try {
        const start = Date.now()
        const client = this.createClient(health.node)
        await client.publish("__health_check__", "ping")
        await client.quit()
        const latency = Date.now() - start

        health.isHealthy = true
        health.consecutiveFailures = 0
        health.latencyMs = latency
        health.lastChecked = new Date()
        this.logger.info(`Node ${key} recovered (latency: ${latency}ms)`)
      } catch {
        health.consecutiveFailures++
        health.lastChecked = new Date()
      }
    }
  }
}

function nodeKey(node: ClusterNode): string {
  return `${node.host}:${node.port}`
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createRedisClusterPubSub(
  createClient: (node: ClusterNode) => RedisLike,
  options: RedisClusterPubSubOptions,
): RedisClusterPubSubAdapter {
  return new RedisClusterPubSubAdapter(createClient, options)
}
