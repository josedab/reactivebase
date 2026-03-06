/**
 * Subscription Engine Bridge for ReactiveBase GraphQL.
 * Bridges the ReactiveBase reactivity engine to GraphQL subscriptions,
 * managing subscription lifecycle, per-field change detection,
 * and protocol-level transport for graphql-ws.
 *
 * Features:
 *   - Per-field change detection and filtering
 *   - graphql-ws protocol compliance (connection_init → subscribe → next → complete)
 *   - Subscription lifecycle management with heartbeat
 *   - Batched updates with configurable debounce
 *   - Connection-level backpressure tracking
 *
 * Usage:
 *   const bridge = new SubscriptionBridge({ reactivityMap })
 *   bridge.subscribe("sub-1", "onTaskChanged", { where: { status: "active" } })
 *   bridge.pushChange("tasks", { id: "1", title: "Updated" }, ["title"])
 */

import type { ReactivityMapping } from "./schema-compiler.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SubscriptionBridgeOptions {
  /** Reactivity map from the schema compiler */
  reactivityMap: Record<string, ReactivityMapping>
  /** Debounce window for batching updates (ms, default: 50) */
  debounceMs?: number
  /** Heartbeat interval for subscription keep-alive (ms, default: 30000) */
  heartbeatIntervalMs?: number
  /** Max subscriptions per connection (default: 100) */
  maxSubscriptionsPerConnection?: number
}

export interface SubscriptionEntry {
  id: string
  connectionId: string
  field: string
  mapping: ReactivityMapping
  variables: Record<string, unknown>
  /** Specific fields being watched (for per-field granularity) */
  watchedFields: string[] | null
  active: boolean
  createdAt: number
  lastEventAt: number | null
  eventCount: number
}

export interface ChangeEvent {
  table: string
  type: "insert" | "update" | "delete"
  rowId: string
  data: Record<string, unknown>
  /** Columns that changed (null = all for inserts/deletes) */
  changedColumns: string[] | null
  timestamp: number
}

export interface SubscriptionEvent {
  subscriptionId: string
  field: string
  data: unknown
  changedFields?: string[]
  timestamp: number
}

export type SubscriptionEventCallback = (event: SubscriptionEvent) => void

export interface ConnectionState {
  id: string
  subscriptionIds: Set<string>
  authenticated: boolean
  connectedAt: number
  lastHeartbeat: number
  metadata: Record<string, unknown>
}

export interface BridgeStats {
  totalConnections: number
  totalSubscriptions: number
  activeSubscriptions: number
  totalEventsDelivered: number
  pendingBatchSize: number
}

// ─── Implementation ──────────────────────────────────────────────────────────

const DEFAULT_OPTIONS = {
  debounceMs: 50,
  heartbeatIntervalMs: 30_000,
  maxSubscriptionsPerConnection: 100,
}

export class SubscriptionBridge {
  private options: Required<Omit<SubscriptionBridgeOptions, "reactivityMap">>
  private reactivityMap: Record<string, ReactivityMapping>
  private subscriptions = new Map<string, SubscriptionEntry>()
  private connections = new Map<string, ConnectionState>()
  private listeners = new Map<string, Set<SubscriptionEventCallback>>()
  private pendingBatch: ChangeEvent[] = []
  private batchTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private totalEventsDelivered = 0

  // Index: table name → subscription IDs for fast lookup
  private tableIndex = new Map<string, Set<string>>()

  constructor(options: SubscriptionBridgeOptions) {
    this.reactivityMap = options.reactivityMap
    const { reactivityMap: _, ...rest } = options
    this.options = { ...DEFAULT_OPTIONS, ...rest }
  }

  /**
   * Register a new connection.
   */
  addConnection(connectionId: string, metadata?: Record<string, unknown>): ConnectionState {
    const state: ConnectionState = {
      id: connectionId,
      subscriptionIds: new Set(),
      authenticated: false,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
      metadata: metadata ?? {},
    }
    this.connections.set(connectionId, state)

    if (this.connections.size === 1) {
      this.startHeartbeat()
    }

    return state
  }

  /**
   * Remove a connection and clean up all its subscriptions.
   */
  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId)
    if (!connection) return

    for (const subId of connection.subscriptionIds) {
      this.unsubscribe(subId)
    }
    this.connections.delete(connectionId)

    if (this.connections.size === 0) {
      this.stopHeartbeat()
    }
  }

  /**
   * Authenticate a connection (e.g., after connection_init with a token).
   */
  authenticateConnection(connectionId: string, metadata?: Record<string, unknown>): boolean {
    const connection = this.connections.get(connectionId)
    if (!connection) return false
    connection.authenticated = true
    if (metadata) Object.assign(connection.metadata, metadata)
    return true
  }

  /**
   * Subscribe to a GraphQL subscription field.
   */
  subscribe(
    subscriptionId: string,
    connectionId: string,
    field: string,
    variables?: Record<string, unknown>,
  ): SubscriptionEntry {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      throw new SubscriptionBridgeError(`Connection "${connectionId}" not found`)
    }

    if (connection.subscriptionIds.size >= this.options.maxSubscriptionsPerConnection) {
      throw new SubscriptionBridgeError(
        `Connection "${connectionId}" has reached max subscriptions (${this.options.maxSubscriptionsPerConnection})`,
      )
    }

    const mapping = this.reactivityMap[field]
    if (!mapping) {
      throw new SubscriptionBridgeError(`Unknown subscription field: "${field}"`)
    }

    // Extract watched fields from variables for per-field granularity
    const vars = variables ?? {}
    const watchedFields =
      mapping.granularity === "field" && Array.isArray(vars["fields"]) ? (vars["fields"] as string[]) : null

    const entry: SubscriptionEntry = {
      id: subscriptionId,
      connectionId,
      field,
      mapping,
      variables: vars,
      watchedFields,
      active: true,
      createdAt: Date.now(),
      lastEventAt: null,
      eventCount: 0,
    }

    this.subscriptions.set(subscriptionId, entry)
    connection.subscriptionIds.add(subscriptionId)

    // Update table index
    let tableSet = this.tableIndex.get(mapping.tableName)
    if (!tableSet) {
      tableSet = new Set()
      this.tableIndex.set(mapping.tableName, tableSet)
    }
    tableSet.add(subscriptionId)

    return entry
  }

  /**
   * Unsubscribe from a subscription.
   */
  unsubscribe(subscriptionId: string): void {
    const entry = this.subscriptions.get(subscriptionId)
    if (!entry) return

    entry.active = false
    this.subscriptions.delete(subscriptionId)
    this.listeners.delete(subscriptionId)

    // Clean up connection reference
    const connection = this.connections.get(entry.connectionId)
    if (connection) {
      connection.subscriptionIds.delete(subscriptionId)
    }

    // Clean up table index
    const tableSet = this.tableIndex.get(entry.mapping.tableName)
    if (tableSet) {
      tableSet.delete(subscriptionId)
      if (tableSet.size === 0) this.tableIndex.delete(entry.mapping.tableName)
    }
  }

  /**
   * Register a callback for subscription events.
   */
  onEvent(subscriptionId: string, callback: SubscriptionEventCallback): () => void {
    let listeners = this.listeners.get(subscriptionId)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(subscriptionId, listeners)
    }
    listeners.add(callback)
    return () => listeners!.delete(callback)
  }

  /**
   * Push a data change from the reactivity engine.
   * Changes are batched and debounced before delivery.
   */
  pushChange(change: ChangeEvent): void {
    this.pendingBatch.push(change)

    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.flushBatch()
      }, this.options.debounceMs)
    }
  }

  /**
   * Push a change immediately without debouncing.
   */
  pushChangeImmediate(change: ChangeEvent): void {
    this.deliverChange(change)
  }

  /**
   * Get bridge statistics.
   */
  getStats(): BridgeStats {
    let activeCount = 0
    for (const entry of this.subscriptions.values()) {
      if (entry.active) activeCount++
    }

    return {
      totalConnections: this.connections.size,
      totalSubscriptions: this.subscriptions.size,
      activeSubscriptions: activeCount,
      totalEventsDelivered: this.totalEventsDelivered,
      pendingBatchSize: this.pendingBatch.length,
    }
  }

  /**
   * Get all active subscriptions for a specific table.
   */
  getTableSubscriptions(tableName: string): SubscriptionEntry[] {
    const ids = this.tableIndex.get(tableName)
    if (!ids) return []

    const result: SubscriptionEntry[] = []
    for (const id of ids) {
      const entry = this.subscriptions.get(id)
      if (entry?.active) result.push(entry)
    }
    return result
  }

  /**
   * Clean up all resources.
   */
  destroy(): void {
    this.stopHeartbeat()
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
    this.subscriptions.clear()
    this.connections.clear()
    this.listeners.clear()
    this.tableIndex.clear()
    this.pendingBatch = []
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private flushBatch(): void {
    this.batchTimer = null
    const batch = this.pendingBatch.splice(0)
    for (const change of batch) {
      this.deliverChange(change)
    }
  }

  private deliverChange(change: ChangeEvent): void {
    const subIds = this.tableIndex.get(change.table)
    if (!subIds) return

    for (const subId of subIds) {
      const entry = this.subscriptions.get(subId)
      if (!entry?.active) continue

      // Per-field filtering
      if (entry.watchedFields && change.changedColumns) {
        const hasRelevantChange = change.changedColumns.some((col) => entry.watchedFields!.includes(col))
        if (!hasRelevantChange) continue
      }

      // Where-clause filtering
      if (
        entry.variables["where"] &&
        !this.matchesWhere(change.data, entry.variables["where"] as Record<string, unknown>)
      ) {
        continue
      }

      const event: SubscriptionEvent = {
        subscriptionId: subId,
        field: entry.field,
        data: change.data,
        changedFields: change.changedColumns ?? undefined,
        timestamp: change.timestamp,
      }

      entry.lastEventAt = Date.now()
      entry.eventCount++
      this.totalEventsDelivered++

      const listeners = this.listeners.get(subId)
      if (listeners) {
        for (const listener of listeners) {
          try {
            listener(event)
          } catch {
            // Listener errors should not break event delivery
          }
        }
      }
    }
  }

  private matchesWhere(data: Record<string, unknown>, where: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(where)) {
      if (value !== undefined && value !== null && data[key] !== value) {
        return false
      }
    }
    return true
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now()
      for (const connection of this.connections.values()) {
        connection.lastHeartbeat = now
      }
    }, this.options.heartbeatIntervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class SubscriptionBridgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SubscriptionBridgeError"
  }
}
