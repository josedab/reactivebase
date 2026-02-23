/**
 * Horizontal Scaling with Consistent Hashing.
 * Provides subscription routing across multiple server instances using
 * consistent hashing for minimal rebalancing during scale events.
 *
 * Features:
 *   - Consistent hash ring with virtual nodes for even distribution
 *   - Subscription-aware routing (co-locate queries for efficient invalidation)
 *   - Cross-server invalidation broadcasting via pub/sub adapter
 *   - Graceful drain on server removal (migrate subscriptions before shutdown)
 *   - Health checking and auto-removal of unhealthy nodes
 *   - Cluster topology monitoring
 *
 * Usage:
 *   const cluster = new ClusterManager({ nodeId: "server-1" })
 *   cluster.addNode({ id: "server-1", host: "10.0.0.1", port: 4000 })
 *   const targetNode = cluster.routeSubscription("listTasks", { userId: "u1" })
 */

import { createHash } from "node:crypto"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ClusterNode {
  id: string
  host: string
  port: number
  status: "active" | "draining" | "unhealthy" | "removed"
  /** Number of active subscriptions on this node */
  subscriptionCount: number
  /** Weight for subscription distribution (default: 1) */
  weight: number
  /** Last health check timestamp */
  lastHealthCheck: number
  /** Node metadata */
  metadata?: Record<string, unknown>
}

export interface ClusterManagerOptions {
  /** This node's unique identifier */
  nodeId: string
  /** Number of virtual nodes per physical node (default: 150) */
  virtualNodes?: number
  /** Health check interval in ms (default: 10000) */
  healthCheckIntervalMs?: number
  /** Health check timeout in ms (default: 5000) */
  healthCheckTimeoutMs?: number
  /** Max consecutive health check failures before marking unhealthy (default: 3) */
  maxHealthCheckFailures?: number
  /** Callback for cross-server invalidation broadcasts */
  onBroadcast?: (message: ClusterMessage) => void
  /** Callback when node topology changes */
  onTopologyChange?: (nodes: ClusterNode[]) => void
}

export interface ClusterMessage {
  type: "invalidation" | "subscription-migrate" | "health-check" | "topology-update"
  sourceNodeId: string
  targetNodeId?: string
  payload: unknown
  timestamp: number
}

export interface InvalidationBroadcast {
  tables: string[]
  changeSet: {
    table: string
    operation: "insert" | "update" | "delete"
    rowIds: string[]
  }[]
}

export interface SubscriptionRoute {
  subscriptionKey: string
  targetNodeId: string
  /** Hash position on the ring */
  hashPosition: number
}

export interface ClusterStats {
  totalNodes: number
  activeNodes: number
  drainingNodes: number
  unhealthyNodes: number
  totalSubscriptions: number
  avgSubscriptionsPerNode: number
  ringSize: number
  rebalanceCount: number
}

export interface DrainResult {
  nodeId: string
  migratedSubscriptions: number
  durationMs: number
}

// ─── Consistent Hash Ring ────────────────────────────────────────────────────

export class ConsistentHashRing {
  private ring = new Map<number, string>()
  private sortedPositions: number[] = []
  private virtualNodes: number

  constructor(virtualNodes: number = 150) {
    this.virtualNodes = virtualNodes
  }

  get size(): number {
    return this.sortedPositions.length
  }

  get nodeCount(): number {
    return new Set(this.ring.values()).size
  }

  addNode(nodeId: string, weight: number = 1): void {
    const vnodes = Math.round(this.virtualNodes * weight)
    for (let i = 0; i < vnodes; i++) {
      const hash = this.hash(`${nodeId}:${i}`)
      this.ring.set(hash, nodeId)
    }
    this.rebuildSorted()
  }

  removeNode(nodeId: string): void {
    for (const [hash, id] of this.ring) {
      if (id === nodeId) this.ring.delete(hash)
    }
    this.rebuildSorted()
  }

  /**
   * Find the node responsible for the given key.
   */
  getNode(key: string): string | undefined {
    if (this.sortedPositions.length === 0) return undefined

    const hash = this.hash(key)
    // Binary search for the first position >= hash
    let low = 0
    let high = this.sortedPositions.length - 1

    if (hash > this.sortedPositions[high]) {
      // Wrap around to the first node
      return this.ring.get(this.sortedPositions[0])
    }

    while (low < high) {
      const mid = (low + high) >>> 1
      if (this.sortedPositions[mid] < hash) {
        low = mid + 1
      } else {
        high = mid
      }
    }

    return this.ring.get(this.sortedPositions[low])
  }

  /**
   * Get N distinct nodes for a key (for replication).
   */
  getNodes(key: string, count: number): string[] {
    if (this.sortedPositions.length === 0) return []

    const nodes: string[] = []
    const hash = this.hash(key)
    const idx = this.findStartIndex(hash)

    for (let i = 0; i < this.sortedPositions.length && nodes.length < count; i++) {
      const position = this.sortedPositions[(idx + i) % this.sortedPositions.length]
      const nodeId = this.ring.get(position)!
      if (!nodes.includes(nodeId)) {
        nodes.push(nodeId)
      }
    }

    return nodes
  }

  /**
   * Get all keys that would be affected by adding a new node.
   */
  getRebalancedKeys(newNodeId: string): number[] {
    const affected: number[] = []
    const vnodes = this.virtualNodes
    for (let i = 0; i < vnodes; i++) {
      const hash = this.hash(`${newNodeId}:${i}`)
      affected.push(hash)
    }
    return affected
  }

  private hash(key: string): number {
    const h = createHash("md5").update(key).digest()
    return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0
  }

  private findStartIndex(hash: number): number {
    let low = 0
    let high = this.sortedPositions.length - 1

    if (hash > this.sortedPositions[high]) return 0

    while (low < high) {
      const mid = (low + high) >>> 1
      if (this.sortedPositions[mid] < hash) {
        low = mid + 1
      } else {
        high = mid
      }
    }
    return low
  }

  private rebuildSorted(): void {
    this.sortedPositions = Array.from(this.ring.keys()).sort((a, b) => a - b)
  }
}

// ─── Cluster Manager ─────────────────────────────────────────────────────────

const DEFAULT_CLUSTER_OPTIONS: Required<ClusterManagerOptions> = {
  nodeId: "node-1",
  virtualNodes: 150,
  healthCheckIntervalMs: 10_000,
  healthCheckTimeoutMs: 5_000,
  maxHealthCheckFailures: 3,
  onBroadcast: () => {},
  onTopologyChange: () => {},
}

export class ClusterManager {
  private options: Required<ClusterManagerOptions>
  private nodes = new Map<string, ClusterNode>()
  private ring: ConsistentHashRing
  private healthCheckFailures = new Map<string, number>()
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private rebalanceCount = 0
  private subscriptionRoutes = new Map<string, string>()

  constructor(options: ClusterManagerOptions) {
    this.options = { ...DEFAULT_CLUSTER_OPTIONS, ...options }
    this.ring = new ConsistentHashRing(this.options.virtualNodes)
  }

  get nodeId(): string {
    return this.options.nodeId
  }

  get nodeCount(): number {
    return this.nodes.size
  }

  get activeNodeCount(): number {
    return Array.from(this.nodes.values()).filter((n) => n.status === "active").length
  }

  // ─── Node Management ─────────────────────────────────────────────────────

  addNode(node: {
    id: string
    host: string
    port: number
    weight?: number
    metadata?: Record<string, unknown>
  }): ClusterNode {
    const clusterNode: ClusterNode = {
      id: node.id,
      host: node.host,
      port: node.port,
      status: "active",
      subscriptionCount: 0,
      weight: node.weight ?? 1,
      lastHealthCheck: Date.now(),
      metadata: node.metadata,
    }

    this.nodes.set(node.id, clusterNode)
    this.ring.addNode(node.id, clusterNode.weight)
    this.rebalanceCount++
    this.options.onTopologyChange(this.getActiveNodes())

    return clusterNode
  }

  removeNode(nodeId: string): void {
    const node = this.nodes.get(nodeId)
    if (node) {
      node.status = "removed"
      this.ring.removeNode(nodeId)
      this.nodes.delete(nodeId)
      this.rebalanceCount++
      this.options.onTopologyChange(this.getActiveNodes())
    }
  }

  getNode(nodeId: string): ClusterNode | undefined {
    return this.nodes.get(nodeId)
  }

  getActiveNodes(): ClusterNode[] {
    return Array.from(this.nodes.values()).filter((n) => n.status === "active")
  }

  getAllNodes(): ClusterNode[] {
    return Array.from(this.nodes.values())
  }

  // ─── Subscription Routing ────────────────────────────────────────────────

  routeSubscription(queryName: string, args: unknown): SubscriptionRoute {
    const key = this.createSubscriptionKey(queryName, args)
    const targetNodeId = this.ring.getNode(key) ?? this.options.nodeId

    this.subscriptionRoutes.set(key, targetNodeId)

    // Update subscription count
    const node = this.nodes.get(targetNodeId)
    if (node) node.subscriptionCount++

    return {
      subscriptionKey: key,
      targetNodeId,
      hashPosition: 0,
    }
  }

  /**
   * Check if this node should handle a subscription.
   */
  isLocalSubscription(queryName: string, args: unknown): boolean {
    const key = this.createSubscriptionKey(queryName, args)
    const targetNodeId = this.ring.getNode(key)
    return targetNodeId === this.options.nodeId
  }

  /**
   * Remove a subscription route.
   */
  removeSubscriptionRoute(queryName: string, args: unknown): void {
    const key = this.createSubscriptionKey(queryName, args)
    const nodeId = this.subscriptionRoutes.get(key)
    if (nodeId) {
      const node = this.nodes.get(nodeId)
      if (node && node.subscriptionCount > 0) node.subscriptionCount--
      this.subscriptionRoutes.delete(key)
    }
  }

  // ─── Invalidation Broadcasting ───────────────────────────────────────────

  broadcastInvalidation(changes: InvalidationBroadcast): void {
    const message: ClusterMessage = {
      type: "invalidation",
      sourceNodeId: this.options.nodeId,
      payload: changes,
      timestamp: Date.now(),
    }
    this.options.onBroadcast(message)
  }

  /**
   * Handle an incoming cluster message.
   */
  handleMessage(message: ClusterMessage): void {
    switch (message.type) {
      case "health-check":
        this.handleHealthCheckResponse(message.sourceNodeId)
        break
      case "topology-update":
        // Could merge remote topology info
        break
    }
  }

  // ─── Graceful Drain ──────────────────────────────────────────────────────

  /**
   * Start draining a node — mark it as draining and redistribute subscriptions.
   */
  drainNode(nodeId: string): DrainResult {
    const start = Date.now()
    const node = this.nodes.get(nodeId)
    if (!node) return { nodeId, migratedSubscriptions: 0, durationMs: 0 }

    node.status = "draining"
    this.ring.removeNode(nodeId)

    // Count subscriptions that need migration
    let migrated = 0
    for (const [key, routedNodeId] of this.subscriptionRoutes) {
      if (routedNodeId === nodeId) {
        const newNodeId = this.ring.getNode(key) ?? this.options.nodeId
        this.subscriptionRoutes.set(key, newNodeId)
        const newNode = this.nodes.get(newNodeId)
        if (newNode) newNode.subscriptionCount++
        migrated++

        // Broadcast migration message
        this.options.onBroadcast({
          type: "subscription-migrate",
          sourceNodeId: nodeId,
          targetNodeId: newNodeId,
          payload: { subscriptionKey: key },
          timestamp: Date.now(),
        })
      }
    }

    node.subscriptionCount = 0
    this.rebalanceCount++
    this.options.onTopologyChange(this.getActiveNodes())

    return { nodeId, migratedSubscriptions: migrated, durationMs: Date.now() - start }
  }

  // ─── Health Checking ─────────────────────────────────────────────────────

  startHealthChecks(): void {
    if (this.healthCheckTimer) return
    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks()
    }, this.options.healthCheckIntervalMs)
  }

  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  reportHealthCheckSuccess(nodeId: string): void {
    this.healthCheckFailures.set(nodeId, 0)
    const node = this.nodes.get(nodeId)
    if (node) {
      node.lastHealthCheck = Date.now()
      if (node.status === "unhealthy") {
        node.status = "active"
        this.ring.addNode(nodeId, node.weight)
        this.options.onTopologyChange(this.getActiveNodes())
      }
    }
  }

  reportHealthCheckFailure(nodeId: string): void {
    const failures = (this.healthCheckFailures.get(nodeId) ?? 0) + 1
    this.healthCheckFailures.set(nodeId, failures)

    if (failures >= this.options.maxHealthCheckFailures) {
      const node = this.nodes.get(nodeId)
      if (node && node.status === "active") {
        node.status = "unhealthy"
        this.ring.removeNode(nodeId)
        this.rebalanceCount++
        this.options.onTopologyChange(this.getActiveNodes())
      }
    }
  }

  // ─── Stats ───────────────────────────────────────────────────────────────

  getStats(): ClusterStats {
    const allNodes = Array.from(this.nodes.values())
    const active = allNodes.filter((n) => n.status === "active")
    const totalSubs = allNodes.reduce((sum, n) => sum + n.subscriptionCount, 0)

    return {
      totalNodes: allNodes.length,
      activeNodes: active.length,
      drainingNodes: allNodes.filter((n) => n.status === "draining").length,
      unhealthyNodes: allNodes.filter((n) => n.status === "unhealthy").length,
      totalSubscriptions: totalSubs,
      avgSubscriptionsPerNode: active.length > 0 ? totalSubs / active.length : 0,
      ringSize: this.ring.size,
      rebalanceCount: this.rebalanceCount,
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private createSubscriptionKey(queryName: string, args: unknown): string {
    const argsStr = JSON.stringify(args ?? {})
    return `${queryName}:${argsStr}`
  }

  private performHealthChecks(): void {
    for (const [nodeId, node] of this.nodes) {
      if (nodeId === this.options.nodeId) continue
      if (node.status === "removed") continue

      this.options.onBroadcast({
        type: "health-check",
        sourceNodeId: this.options.nodeId,
        targetNodeId: nodeId,
        payload: {},
        timestamp: Date.now(),
      })
    }
  }

  private handleHealthCheckResponse(nodeId: string): void {
    this.reportHealthCheckSuccess(nodeId)
  }
}
