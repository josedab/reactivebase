/**
 * Multi-Database Federation Extensions for ReactiveBase.
 *
 * Adds defineDataSource() config API, cross-source query result merging,
 * reactive federation with change notification propagation, and automatic
 * read replica routing for subscription-heavy queries.
 *
 * Usage:
 *   const federation = defineDataSource({
 *     primary: { connectionString: "postgres://...", default: true },
 *     analytics: { connectionString: "postgres://...", readOnly: true },
 *     replica: { connectionString: "postgres://...", role: "read-replica" },
 *   })
 */

import {
  DatabaseFederation,
  FederationError,
  type DatabaseConfig,
  type FederationConfig,
  type FederatedQueryResult,
} from "./multi-db.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DataSourceConfig extends DatabaseConfig {
  /** Role of this data source */
  role?: "primary" | "read-replica" | "analytics" | "external"
  /** Max subscriptions before routing to a replica */
  subscriptionThreshold?: number
  /** Change notification channel for reactive federation */
  changeChannel?: string
  /** Weight for load-balanced routing (0-100, default: 50) */
  routingWeight?: number
}

export type DataSourceSchema = Record<string, DataSourceConfig>

export interface FederatedDataSource {
  federation: DatabaseFederation
  dataSources: Map<string, DataSourceConfig>
  replicaRouter: ReplicaRouter
}

export interface MergedQueryResult<T = unknown> {
  results: FederatedQueryResult<T[]>[]
  merged: T[]
  totalDurationMs: number
}

export interface ChangeNotification {
  source: string
  table: string
  operation: "insert" | "update" | "delete"
  timestamp: number
  payload?: unknown
}

export type ChangeNotificationHandler = (notification: ChangeNotification) => void | Promise<void>

// ─── defineDataSource API ────────────────────────────────────────────────────

/**
 * Define multiple data sources with typed configuration.
 * Higher-level API over DatabaseFederation with replica routing support.
 */
export function defineDataSource(schema: DataSourceSchema): FederatedDataSource {
  if (Object.keys(schema).length === 0) {
    throw new FederationError("At least one data source must be defined")
  }

  const federationConfig: FederationConfig = {
    databases: {},
  }

  const dataSources = new Map<string, DataSourceConfig>()

  for (const [name, config] of Object.entries(schema)) {
    federationConfig.databases[name] = {
      connectionString: config.connectionString,
      poolSize: config.poolSize,
      default: config.default,
      readOnly: config.readOnly ?? (config.role === "read-replica" || config.role === "analytics"),
      label: config.label ?? name,
      ssl: config.ssl,
    }
    dataSources.set(name, config)
  }

  const federation = new DatabaseFederation(federationConfig)
  const replicaRouter = new ReplicaRouter(dataSources)

  return { federation, dataSources, replicaRouter }
}

// ─── Cross-Source Query Merger ───────────────────────────────────────────────

/**
 * Merge results from multiple data sources into a unified result set.
 * Deduplicates by `id` field and resolves conflicts using source priority.
 */
export function mergeQueryResults<T extends Record<string, unknown>>(
  results: FederatedQueryResult<T[]>[],
  options: { deduplicateBy?: string; sourcePriority?: string[] } = {},
): MergedQueryResult<T> {
  const deduplicateBy = options.deduplicateBy ?? "id"
  const priority = options.sourcePriority ?? results.map((r) => r.database)

  const seen = new Map<unknown, { item: T; sourceIndex: number }>()
  let totalDurationMs = 0

  let noKeyCounter = 0
  for (const result of results) {
    totalDurationMs += result.durationMs
    const sourceIndex = priority.indexOf(result.database)

    for (const item of result.data) {
      const key = item[deduplicateBy]
      if (key === undefined) {
        // No dedup key — include with unique counter key
        seen.set(`__no_key_${noKeyCounter++}`, { item, sourceIndex })
        continue
      }

      const existing = seen.get(key)
      if (!existing || (sourceIndex >= 0 && sourceIndex < existing.sourceIndex)) {
        seen.set(key, { item, sourceIndex })
      }
    }
  }

  const merged = Array.from(seen.values()).map((v) => v.item)

  return { results, merged, totalDurationMs }
}

// ─── Reactive Federation (Change Notification Propagation) ───────────────────

/**
 * Manages change notification propagation across federated data sources.
 * When a source detects a change, it propagates to all interested listeners.
 */
export class FederationChangeRelay {
  private handlers = new Map<string, Set<ChangeNotificationHandler>>()
  private globalHandlers = new Set<ChangeNotificationHandler>()

  /** Subscribe to changes from a specific data source. */
  onSourceChange(source: string, handler: ChangeNotificationHandler): () => void {
    if (!this.handlers.has(source)) {
      this.handlers.set(source, new Set())
    }
    this.handlers.get(source)!.add(handler)

    return () => {
      this.handlers.get(source)?.delete(handler)
    }
  }

  /** Subscribe to changes from all data sources. */
  onAnyChange(handler: ChangeNotificationHandler): () => void {
    this.globalHandlers.add(handler)
    return () => {
      this.globalHandlers.delete(handler)
    }
  }

  /** Emit a change notification from a data source. */
  async emit(notification: ChangeNotification): Promise<void> {
    const sourceHandlers = this.handlers.get(notification.source)
    const allHandlers = [...(sourceHandlers ?? []), ...this.globalHandlers]

    await Promise.all(
      allHandlers.map((handler) => {
        try {
          return handler(notification)
        } catch {
          return undefined
        }
      }),
    )
  }

  /** Clear all handlers. */
  clear(): void {
    this.handlers.clear()
    this.globalHandlers.clear()
  }
}

// ─── Automatic Read Replica Router ───────────────────────────────────────────

/**
 * Routes read queries to replicas based on subscription load.
 * Automatically shifts subscription-heavy queries to read replicas
 * to reduce load on the primary.
 */
export class ReplicaRouter {
  private dataSources: Map<string, DataSourceConfig>
  private subscriptionCounts = new Map<string, number>()
  private primaryName: string | null = null
  private replicas: string[] = []

  constructor(dataSources: Map<string, DataSourceConfig>) {
    this.dataSources = dataSources

    for (const [name, config] of dataSources) {
      if (config.default || config.role === "primary") {
        this.primaryName = name
      }
      if (config.role === "read-replica") {
        this.replicas.push(name)
      }
      this.subscriptionCounts.set(name, 0)
    }
  }

  /**
   * Route a read query to the optimal data source.
   * Uses subscription load to determine whether to use a replica.
   */
  routeRead(_tableName?: string): string {
    if (this.replicas.length === 0) {
      return this.primaryName ?? [...this.dataSources.keys()][0]
    }

    const primaryLoad = this.subscriptionCounts.get(this.primaryName ?? "") ?? 0
    const threshold = this.dataSources.get(this.primaryName ?? "")?.subscriptionThreshold ?? 100

    // Route to replica if primary is above threshold
    if (primaryLoad >= threshold) {
      return this.selectLeastLoadedReplica()
    }

    return this.primaryName ?? [...this.dataSources.keys()][0]
  }

  /** Route a write query (always goes to primary). */
  routeWrite(): string {
    if (!this.primaryName) {
      throw new FederationError("No primary database configured for write operations")
    }
    return this.primaryName
  }

  /** Update the subscription count for a data source. */
  updateSubscriptionCount(source: string, count: number): void {
    this.subscriptionCounts.set(source, count)
  }

  /** Increment subscription count. */
  incrementSubscriptions(source: string): void {
    const current = this.subscriptionCounts.get(source) ?? 0
    this.subscriptionCounts.set(source, current + 1)
  }

  /** Decrement subscription count. */
  decrementSubscriptions(source: string): void {
    const current = this.subscriptionCounts.get(source) ?? 0
    this.subscriptionCounts.set(source, Math.max(0, current - 1))
  }

  /** Get current routing stats. */
  getStats(): Record<string, { subscriptions: number; role: string }> {
    const stats: Record<string, { subscriptions: number; role: string }> = {}
    for (const [name, config] of this.dataSources) {
      stats[name] = {
        subscriptions: this.subscriptionCounts.get(name) ?? 0,
        role: config.role ?? (config.default ? "primary" : "secondary"),
      }
    }
    return stats
  }

  private selectLeastLoadedReplica(): string {
    let leastLoaded = this.replicas[0]
    let leastCount = Infinity

    for (const replica of this.replicas) {
      const count = this.subscriptionCounts.get(replica) ?? 0
      if (count < leastCount) {
        leastCount = count
        leastLoaded = replica
      }
    }

    return leastLoaded
  }
}
