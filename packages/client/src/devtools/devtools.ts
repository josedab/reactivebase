/**
 * DevTools Instrumentation for ReactiveBase Client.
 * Provides hooks and data collection for the browser DevTools extension.
 * Tracks subscriptions, mutations, cache state, and WebSocket activity.
 *
 * Usage:
 *   const devtools = new DevToolsInstrumentation()
 *   devtools.trackSubscription("sub_1", { queryName: "tasks.list", args: {} })
 *   devtools.trackMutation("m_1", { name: "tasks.complete", args: { id: "1" } })
 *   devtools.onEvent((event) => postMessageToExtension(event))
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DevToolsEvent {
  type: DevToolsEventType
  timestamp: number
  data: unknown
}

export type DevToolsEventType =
  | "subscription:created"
  | "subscription:updated"
  | "subscription:removed"
  | "mutation:started"
  | "mutation:completed"
  | "mutation:failed"
  | "cache:hit"
  | "cache:miss"
  | "cache:update"
  | "ws:message:sent"
  | "ws:message:received"
  | "ws:connected"
  | "ws:disconnected"
  | "optimistic:applied"
  | "optimistic:confirmed"
  | "optimistic:rolledback"

export interface SubscriptionInfo {
  id: string
  queryName: string
  args: unknown
  status: "active" | "pending" | "error" | "closed"
  createdAt: number
  lastUpdatedAt: number
  updateCount: number
  lastData: unknown
  latencyMs?: number
}

export interface MutationInfo {
  id: string
  name: string
  args: unknown
  status: "pending" | "completed" | "failed"
  startedAt: number
  completedAt?: number
  durationMs?: number
  error?: string
  optimistic: boolean
}

export interface CacheStats {
  entries: number
  hitCount: number
  missCount: number
  hitRate: number
  totalSizeEstimate: number
  oldestEntry: number | null
  newestEntry: number | null
}

export interface WebSocketStats {
  messagesSent: number
  messagesReceived: number
  bytesSent: number
  bytesReceived: number
  connectionUptime: number
  reconnectCount: number
  lastMessageAt: number | null
  status: "connected" | "disconnected" | "connecting"
}

export interface PerformanceSnapshot {
  timestamp: number
  subscriptions: SubscriptionInfo[]
  mutations: MutationInfo[]
  cache: CacheStats
  websocket: WebSocketStats
  memoryUsage?: number
}

export type DevToolsEventHandler = (event: DevToolsEvent) => void

// ─── DevTools Instrumentation ────────────────────────────────────────────────

export interface DevToolsOptions {
  /** Max events to keep in history (default: 500) */
  maxEvents?: number
  /** Max mutations to keep in timeline (default: 200) */
  maxMutations?: number
  /** Enable performance sampling (default: true) */
  enablePerformance?: boolean
  /** Performance snapshot interval in ms (default: 5000) */
  snapshotIntervalMs?: number
}

const DEFAULT_OPTIONS: Required<DevToolsOptions> = {
  maxEvents: 500,
  maxMutations: 200,
  enablePerformance: true,
  snapshotIntervalMs: 5_000,
}

/**
 * Client-side instrumentation for the ReactiveBase DevTools browser extension.
 * Collects subscription, mutation, cache, and WebSocket data.
 */
export class DevToolsInstrumentation {
  private options: Required<DevToolsOptions>
  private subscriptions = new Map<string, SubscriptionInfo>()
  private mutations: MutationInfo[] = []
  private events: DevToolsEvent[] = []
  private listeners = new Set<DevToolsEventHandler>()
  private snapshotTimer: ReturnType<typeof setInterval> | null = null
  private snapshots: PerformanceSnapshot[] = []

  private cacheStats: CacheStats = {
    entries: 0,
    hitCount: 0,
    missCount: 0,
    hitRate: 0,
    totalSizeEstimate: 0,
    oldestEntry: null,
    newestEntry: null,
  }

  private wsStats: WebSocketStats = {
    messagesSent: 0,
    messagesReceived: 0,
    bytesSent: 0,
    bytesReceived: 0,
    connectionUptime: 0,
    reconnectCount: 0,
    lastMessageAt: null,
    status: "disconnected",
  }

  private connectionStartTime: number | null = null

  constructor(options: DevToolsOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  // ─── Subscription Tracking ─────────────────────────────────────────────

  trackSubscription(id: string, info: { queryName: string; args: unknown }): void {
    const sub: SubscriptionInfo = {
      id,
      queryName: info.queryName,
      args: info.args,
      status: "pending",
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
      updateCount: 0,
      lastData: undefined,
    }
    this.subscriptions.set(id, sub)
    this.emit("subscription:created", sub)
  }

  updateSubscription(id: string, data: unknown, latencyMs?: number): void {
    const sub = this.subscriptions.get(id)
    if (!sub) return

    sub.status = "active"
    sub.lastData = data
    sub.lastUpdatedAt = Date.now()
    sub.updateCount++
    if (latencyMs !== undefined) sub.latencyMs = latencyMs

    this.emit("subscription:updated", { id, updateCount: sub.updateCount, latencyMs })
  }

  removeSubscription(id: string): void {
    const sub = this.subscriptions.get(id)
    if (sub) {
      sub.status = "closed"
      this.emit("subscription:removed", { id })
      this.subscriptions.delete(id)
    }
  }

  getSubscriptions(): SubscriptionInfo[] {
    return [...this.subscriptions.values()]
  }

  // ─── Mutation Tracking ─────────────────────────────────────────────────

  trackMutation(id: string, info: { name: string; args: unknown; optimistic?: boolean }): void {
    const mutation: MutationInfo = {
      id,
      name: info.name,
      args: info.args,
      status: "pending",
      startedAt: Date.now(),
      optimistic: info.optimistic ?? false,
    }
    this.mutations.unshift(mutation)
    if (this.mutations.length > this.options.maxMutations) {
      this.mutations.pop()
    }
    this.emit("mutation:started", mutation)
  }

  completeMutation(id: string): void {
    const mutation = this.mutations.find((m) => m.id === id)
    if (mutation) {
      mutation.status = "completed"
      mutation.completedAt = Date.now()
      mutation.durationMs = mutation.completedAt - mutation.startedAt
      this.emit("mutation:completed", { id, durationMs: mutation.durationMs })
    }
  }

  failMutation(id: string, error: string): void {
    const mutation = this.mutations.find((m) => m.id === id)
    if (mutation) {
      mutation.status = "failed"
      mutation.completedAt = Date.now()
      mutation.durationMs = mutation.completedAt - mutation.startedAt
      mutation.error = error
      this.emit("mutation:failed", { id, error, durationMs: mutation.durationMs })
    }
  }

  getMutations(): MutationInfo[] {
    return [...this.mutations]
  }

  getMutationTimeline(): Array<{ time: number; type: string; id: string; name: string; durationMs?: number }> {
    return this.mutations.map((m) => ({
      time: m.startedAt,
      type: m.status,
      id: m.id,
      name: m.name,
      durationMs: m.durationMs,
    }))
  }

  // ─── Cache Tracking ────────────────────────────────────────────────────

  trackCacheHit(queryName: string): void {
    this.cacheStats.hitCount++
    this.updateHitRate()
    this.emit("cache:hit", { queryName })
  }

  trackCacheMiss(queryName: string): void {
    this.cacheStats.missCount++
    this.updateHitRate()
    this.emit("cache:miss", { queryName })
  }

  updateCacheStats(entries: number, sizeEstimate: number): void {
    this.cacheStats.entries = entries
    this.cacheStats.totalSizeEstimate = sizeEstimate
    this.cacheStats.newestEntry = Date.now()
  }

  getCacheStats(): CacheStats {
    return { ...this.cacheStats }
  }

  // ─── WebSocket Tracking ────────────────────────────────────────────────

  trackWsMessageSent(sizeBytes: number): void {
    this.wsStats.messagesSent++
    this.wsStats.bytesSent += sizeBytes
    this.wsStats.lastMessageAt = Date.now()
    this.emit("ws:message:sent", { sizeBytes })
  }

  trackWsMessageReceived(sizeBytes: number): void {
    this.wsStats.messagesReceived++
    this.wsStats.bytesReceived += sizeBytes
    this.wsStats.lastMessageAt = Date.now()
    this.emit("ws:message:received", { sizeBytes })
  }

  trackWsConnected(): void {
    this.wsStats.status = "connected"
    this.connectionStartTime = Date.now()
    this.emit("ws:connected", {})
  }

  trackWsDisconnected(): void {
    this.wsStats.status = "disconnected"
    if (this.connectionStartTime) {
      this.wsStats.connectionUptime += Date.now() - this.connectionStartTime
      this.connectionStartTime = null
    }
    this.wsStats.reconnectCount++
    this.emit("ws:disconnected", { reconnectCount: this.wsStats.reconnectCount })
  }

  getWsStats(): WebSocketStats {
    const stats = { ...this.wsStats }
    if (this.connectionStartTime) {
      stats.connectionUptime += Date.now() - this.connectionStartTime
    }
    return stats
  }

  // ─── Optimistic Update Tracking ────────────────────────────────────────

  trackOptimisticApplied(mutationId: string, subscriptionId: string): void {
    this.emit("optimistic:applied", { mutationId, subscriptionId })
  }

  trackOptimisticConfirmed(mutationId: string): void {
    this.emit("optimistic:confirmed", { mutationId })
  }

  trackOptimisticRolledback(mutationId: string): void {
    this.emit("optimistic:rolledback", { mutationId })
  }

  // ─── Events & Listeners ────────────────────────────────────────────────

  onEvent(handler: DevToolsEventHandler): () => void {
    this.listeners.add(handler)
    return () => this.listeners.delete(handler)
  }

  getEvents(limit?: number): DevToolsEvent[] {
    return this.events.slice(0, limit ?? this.options.maxEvents)
  }

  // ─── Performance Snapshots ─────────────────────────────────────────────

  takeSnapshot(): PerformanceSnapshot {
    const snapshot: PerformanceSnapshot = {
      timestamp: Date.now(),
      subscriptions: this.getSubscriptions(),
      mutations: this.getMutations().slice(0, 20),
      cache: this.getCacheStats(),
      websocket: this.getWsStats(),
    }
    this.snapshots.unshift(snapshot)
    if (this.snapshots.length > 100) this.snapshots.pop()
    return snapshot
  }

  getSnapshots(): PerformanceSnapshot[] {
    return [...this.snapshots]
  }

  startPerformanceMonitoring(): void {
    if (this.snapshotTimer) return
    this.snapshotTimer = setInterval(() => this.takeSnapshot(), this.options.snapshotIntervalMs)
  }

  stopPerformanceMonitoring(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer)
      this.snapshotTimer = null
    }
  }

  // ─── Summary ───────────────────────────────────────────────────────────

  /**
   * Get a summary suitable for display in DevTools panel.
   */
  getSummary(): DevToolsSummary {
    return {
      activeSubscriptions: this.subscriptions.size,
      pendingMutations: this.mutations.filter((m) => m.status === "pending").length,
      completedMutations: this.mutations.filter((m) => m.status === "completed").length,
      failedMutations: this.mutations.filter((m) => m.status === "failed").length,
      cacheHitRate: this.cacheStats.hitRate,
      cacheEntries: this.cacheStats.entries,
      wsStatus: this.wsStats.status,
      wsMessageCount: this.wsStats.messagesSent + this.wsStats.messagesReceived,
      eventCount: this.events.length,
    }
  }

  /**
   * Reset all tracking data.
   */
  reset(): void {
    this.subscriptions.clear()
    this.mutations = []
    this.events = []
    this.snapshots = []
    this.cacheStats = { entries: 0, hitCount: 0, missCount: 0, hitRate: 0, totalSizeEstimate: 0, oldestEntry: null, newestEntry: null }
    this.wsStats = { messagesSent: 0, messagesReceived: 0, bytesSent: 0, bytesReceived: 0, connectionUptime: 0, reconnectCount: 0, lastMessageAt: null, status: "disconnected" }
    this.connectionStartTime = null
  }

  /**
   * Destroy the instrumentation (stop monitoring, clear data).
   */
  destroy(): void {
    this.stopPerformanceMonitoring()
    this.listeners.clear()
    this.reset()
  }

  // ─── Private ───────────────────────────────────────────────────────────

  private emit(type: DevToolsEventType, data: unknown): void {
    const event: DevToolsEvent = { type, timestamp: Date.now(), data }
    this.events.unshift(event)
    if (this.events.length > this.options.maxEvents) {
      this.events.pop()
    }
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private updateHitRate(): void {
    const total = this.cacheStats.hitCount + this.cacheStats.missCount
    this.cacheStats.hitRate = total > 0 ? this.cacheStats.hitCount / total : 0
  }
}

// ─── Summary Type ────────────────────────────────────────────────────────────

export interface DevToolsSummary {
  activeSubscriptions: number
  pendingMutations: number
  completedMutations: number
  failedMutations: number
  cacheHitRate: number
  cacheEntries: number
  wsStatus: string
  wsMessageCount: number
  eventCount: number
}
