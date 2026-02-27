/**
 * Pub/Sub adapter for multi-server reactivity.
 * Broadcasts mutation change-sets to all server instances so each can
 * invalidate its local subscriptions. Uses a pluggable transport
 * (Redis, in-memory for testing).
 */

import type { ChangeEvent } from "../reactivity/index.js"
import { randomUUID } from "node:crypto"

export interface PubSubAdapter {
  /** Publish a change set to all servers */
  publish(channel: string, events: ChangeEvent[]): Promise<void>
  /** Subscribe to change sets from other servers */
  subscribe(channel: string, handler: (events: ChangeEvent[]) => void): Promise<void>
  /** Unsubscribe from a channel */
  unsubscribe(channel: string): Promise<void>
  /** Gracefully close the adapter */
  close(): Promise<void>
}

export interface RedisPubSubOptions {
  url: string
  channel?: string
  serverId?: string
}

const _DEFAULT_CHANNEL = "reactivebase:changes"

/**
 * Redis pub/sub adapter for cross-server invalidation.
 * Requires the `redis` package (or ioredis) — uses a generic interface
 * to avoid hard dependency. Consumers pass a factory function.
 */
export class RedisPubSubAdapter implements PubSubAdapter {
  private publisher: RedisLike | null = null
  private subscriber: RedisLike | null = null
  private handlers = new Map<string, (events: ChangeEvent[]) => void>()
  private serverId: string
  private closed = false

  constructor(
    private createClient: () => RedisLike,
    private options: { channel?: string; serverId?: string } = {},
  ) {
    this.serverId = options.serverId ?? generateServerId()
  }

  async publish(channel: string, events: ChangeEvent[]): Promise<void> {
    if (this.closed) return

    if (!this.publisher) {
      this.publisher = this.createClient()
    }

    const message = JSON.stringify({
      serverId: this.serverId,
      events,
      timestamp: Date.now(),
    })

    await this.publisher.publish(channel, message)
  }

  async subscribe(channel: string, handler: (events: ChangeEvent[]) => void): Promise<void> {
    if (this.closed) return

    if (!this.subscriber) {
      this.subscriber = this.createClient()
    }

    this.handlers.set(channel, handler)

    await this.subscriber.subscribe(channel)
    this.subscriber.on("message", (ch: string, message: string) => {
      if (ch !== channel) return

      try {
        const parsed = JSON.parse(message) as {
          serverId: string
          events: ChangeEvent[]
        }

        // Ignore messages from self
        if (parsed.serverId === this.serverId) return

        handler(parsed.events)
      } catch {
        console.error("Failed to parse pub/sub message")
      }
    })
  }

  async unsubscribe(channel: string): Promise<void> {
    this.handlers.delete(channel)
    if (this.subscriber) {
      await this.subscriber.unsubscribe(channel)
    }
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.publisher) {
      await this.publisher.quit()
      this.publisher = null
    }
    if (this.subscriber) {
      await this.subscriber.quit()
      this.subscriber = null
    }
  }
}

/**
 * In-memory pub/sub adapter for testing and single-server setups.
 */
export class InMemoryPubSubAdapter implements PubSubAdapter {
  private static channels = new Map<string, Set<(events: ChangeEvent[]) => void>>()
  private localHandlers = new Map<string, (events: ChangeEvent[]) => void>()

  async publish(channel: string, events: ChangeEvent[]): Promise<void> {
    const handlers = InMemoryPubSubAdapter.channels.get(channel)
    if (!handlers) return

    for (const handler of handlers) {
      // Skip own handler
      if (this.localHandlers.get(channel) === handler) continue
      handler(events)
    }
  }

  async subscribe(channel: string, handler: (events: ChangeEvent[]) => void): Promise<void> {
    if (!InMemoryPubSubAdapter.channels.has(channel)) {
      InMemoryPubSubAdapter.channels.set(channel, new Set())
    }
    InMemoryPubSubAdapter.channels.get(channel)!.add(handler)
    this.localHandlers.set(channel, handler)
  }

  async unsubscribe(channel: string): Promise<void> {
    const handler = this.localHandlers.get(channel)
    if (handler) {
      InMemoryPubSubAdapter.channels.get(channel)?.delete(handler)
      this.localHandlers.delete(channel)
    }
  }

  async close(): Promise<void> {
    for (const [channel, handler] of this.localHandlers) {
      InMemoryPubSubAdapter.channels.get(channel)?.delete(handler)
    }
    this.localHandlers.clear()
  }

  /** Reset all channels (for testing) */
  static reset(): void {
    InMemoryPubSubAdapter.channels.clear()
  }
}

/**
 * Minimal Redis client interface for loose coupling.
 */
export interface RedisLike {
  publish(channel: string, message: string): Promise<number>
  subscribe(channel: string): Promise<void>
  unsubscribe(channel: string): Promise<void>
  on(event: "message", handler: (channel: string, message: string) => void): void
  quit(): Promise<void>
}

function generateServerId(): string {
  return `srv_${randomUUID().substring(0, 8)}_${Date.now().toString(36)}`
}
