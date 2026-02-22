/**
 * Reactive Analytics & Materialized Views for ReactiveBase.
 * Define reactive materialized views that incrementally update when underlying data changes.
 *
 * Usage:
 *   const taskStats = defineMaterializedView({
 *     name: "task_stats_by_team",
 *     source: "tasks",
 *     groupBy: ["team_id"],
 *     aggregations: {
 *       total: { fn: "count", field: "*" },
 *       completed: { fn: "count", field: "*", filter: { done: true } },
 *     },
 *     refreshStrategy: "on-mutation",
 *   })
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MaterializedViewDefinition {
  name: string
  /** Source table name */
  source: string
  /** Columns to group by (for aggregation views) */
  groupBy?: string[]
  /** Aggregation definitions */
  aggregations?: Record<string, AggregationDef>
  /** Raw SQL for complex views */
  sql?: string
  /** When to refresh the view */
  refreshStrategy: RefreshStrategy
  /** Refresh debounce in ms (default: 100) */
  refreshDebounceMs?: number
}

export type RefreshStrategy =
  | "on-mutation"        // Refresh when source table mutates
  | "periodic"           // Refresh on a timer
  | "manual"             // Only refresh when explicitly called

export interface AggregationDef {
  fn: "count" | "sum" | "avg" | "min" | "max" | "percentile"
  field: string
  /** Optional filter for conditional aggregation */
  filter?: Record<string, unknown>
  /** For percentile, specify which percentile (default: 0.95) */
  percentile?: number
}

export interface MaterializedViewState {
  name: string
  data: Record<string, unknown>[]
  lastRefreshedAt: number
  refreshCount: number
  source: string
}

export interface TimeBucket {
  interval: "minute" | "hour" | "day" | "week" | "month"
  field: string
}

export interface MaterializedViewOptions {
  /** Refresh debounce in ms */
  refreshDebounceMs?: number
}

// ─── SQL Generation ──────────────────────────────────────────────────────────

export function generateMaterializedViewSQL(def: MaterializedViewDefinition): string {
  if (def.sql) {
    return `CREATE MATERIALIZED VIEW IF NOT EXISTS "${def.name}" AS\n${def.sql};`
  }

  const selectClauses: string[] = []
  const groupClauses = def.groupBy ?? []

  // Add group-by columns to select
  for (const col of groupClauses) {
    selectClauses.push(`"${col}"`)
  }

  // Add aggregation columns
  if (def.aggregations) {
    for (const [alias, agg] of Object.entries(def.aggregations)) {
      selectClauses.push(`${buildAggregationSQL(agg)} AS "${alias}"`)
    }
  }

  if (selectClauses.length === 0) {
    selectClauses.push("*")
  }

  let sql = `CREATE MATERIALIZED VIEW IF NOT EXISTS "${def.name}" AS\nSELECT ${selectClauses.join(", ")}\nFROM "${def.source}"`

  if (groupClauses.length > 0) {
    sql += `\nGROUP BY ${groupClauses.map((c) => `"${c}"`).join(", ")}`
  }

  return sql + ";"
}

export function generateRefreshSQL(viewName: string, concurrent: boolean = false): string {
  return `REFRESH MATERIALIZED VIEW ${concurrent ? "CONCURRENTLY " : ""}"${viewName}";`
}

export function generateDropViewSQL(viewName: string): string {
  return `DROP MATERIALIZED VIEW IF EXISTS "${viewName}";`
}

export function generateViewIndexSQL(viewName: string, columns: string[]): string {
  const indexName = `idx_${viewName}_${columns.join("_")}`
  return `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${viewName}" (${columns.map((c) => `"${c}"`).join(", ")});`
}

export function generateUniqueIndexSQL(viewName: string, columns: string[]): string {
  const indexName = `idx_${viewName}_unique_${columns.join("_")}`
  return `CREATE UNIQUE INDEX IF NOT EXISTS "${indexName}" ON "${viewName}" (${columns.map((c) => `"${c}"`).join(", ")});`
}

function buildAggregationSQL(agg: AggregationDef): string {
  const field = agg.field === "*" ? "*" : `"${agg.field}"`

  switch (agg.fn) {
    case "count":
      if (agg.filter) {
        const condition = Object.entries(agg.filter)
          .map(([k, v]) => `"${k}" = ${typeof v === "string" ? `'${v}'` : v}`)
          .join(" AND ")
        return `COUNT(*) FILTER (WHERE ${condition})`
      }
      return `COUNT(${field})`
    case "sum":
      return `SUM(${field})`
    case "avg":
      return `AVG(${field})`
    case "min":
      return `MIN(${field})`
    case "max":
      return `MAX(${field})`
    case "percentile":
      return `PERCENTILE_CONT(${agg.percentile ?? 0.95}) WITHIN GROUP (ORDER BY ${field})`
    default:
      return `COUNT(${field})`
  }
}

// ─── Time-Bucketed Rollups ───────────────────────────────────────────────────

export function generateTimeBucketSQL(
  viewName: string,
  source: string,
  timeBucket: TimeBucket,
  aggregations: Record<string, AggregationDef>,
  additionalGroupBy?: string[],
): string {
  const bucketExpr = getTimeBucketExpression(timeBucket)
  const selectClauses: string[] = [`${bucketExpr} AS time_bucket`]
  const groupClauses: string[] = ["time_bucket"]

  for (const col of additionalGroupBy ?? []) {
    selectClauses.push(`"${col}"`)
    groupClauses.push(`"${col}"`)
  }

  for (const [alias, agg] of Object.entries(aggregations)) {
    selectClauses.push(`${buildAggregationSQL(agg)} AS "${alias}"`)
  }

  return `CREATE MATERIALIZED VIEW IF NOT EXISTS "${viewName}" AS
SELECT ${selectClauses.join(", ")}
FROM "${source}"
GROUP BY ${groupClauses.join(", ")}
ORDER BY time_bucket;`
}

function getTimeBucketExpression(bucket: TimeBucket): string {
  switch (bucket.interval) {
    case "minute":
      return `date_trunc('minute', "${bucket.field}")`
    case "hour":
      return `date_trunc('hour', "${bucket.field}")`
    case "day":
      return `date_trunc('day', "${bucket.field}")`
    case "week":
      return `date_trunc('week', "${bucket.field}")`
    case "month":
      return `date_trunc('month', "${bucket.field}")`
  }
}

// ─── MaterializedViewEngine ──────────────────────────────────────────────────

export class MaterializedViewEngine {
  private views = new Map<string, MaterializedViewDefinition>()
  private state = new Map<string, MaterializedViewState>()
  private refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private listeners = new Map<string, Set<(data: Record<string, unknown>[]) => void>>()

  /**
   * Register a materialized view definition.
   */
  register(def: MaterializedViewDefinition): void {
    this.views.set(def.name, def)
    this.state.set(def.name, {
      name: def.name,
      data: [],
      lastRefreshedAt: 0,
      refreshCount: 0,
      source: def.source,
    })
  }

  /**
   * Get the current definition of a view.
   */
  getDefinition(name: string): MaterializedViewDefinition | undefined {
    return this.views.get(name)
  }

  /**
   * Notify the engine that a table was mutated, triggering refresh for dependent views.
   */
  notifyMutation(tableName: string): void {
    for (const [viewName, def] of this.views) {
      if (def.source !== tableName) continue
      if (def.refreshStrategy !== "on-mutation") continue

      const debounceMs = def.refreshDebounceMs ?? 100

      // Debounce rapid mutations
      const existing = this.debounceTimers.get(viewName)
      if (existing) clearTimeout(existing)

      this.debounceTimers.set(
        viewName,
        setTimeout(() => {
          this.debounceTimers.delete(viewName)
          this.triggerRefresh(viewName)
        }, debounceMs),
      )
    }
  }

  /**
   * Manually refresh a view (for "manual" strategy or on-demand).
   */
  triggerRefresh(viewName: string): void {
    const viewState = this.state.get(viewName)
    if (!viewState) return

    viewState.lastRefreshedAt = Date.now()
    viewState.refreshCount++

    // Notify subscribers
    const subs = this.listeners.get(viewName)
    if (subs) {
      for (const listener of subs) {
        listener(viewState.data)
      }
    }
  }

  /**
   * Update the in-memory data for a view (called after actual DB refresh).
   */
  updateData(viewName: string, data: Record<string, unknown>[]): void {
    const viewState = this.state.get(viewName)
    if (!viewState) return

    viewState.data = data
    viewState.lastRefreshedAt = Date.now()

    const subs = this.listeners.get(viewName)
    if (subs) {
      for (const listener of subs) {
        listener(data)
      }
    }
  }

  /**
   * Subscribe to view data changes.
   */
  subscribe(viewName: string, listener: (data: Record<string, unknown>[]) => void): () => void {
    let subs = this.listeners.get(viewName)
    if (!subs) {
      subs = new Set()
      this.listeners.set(viewName, subs)
    }
    subs.add(listener)

    return () => {
      subs!.delete(listener)
      if (subs!.size === 0) this.listeners.delete(viewName)
    }
  }

  /**
   * Get the current state of a view.
   */
  getState(viewName: string): MaterializedViewState | undefined {
    return this.state.get(viewName)
  }

  /**
   * List all registered views.
   */
  listViews(): MaterializedViewDefinition[] {
    return [...this.views.values()]
  }

  /**
   * Generate SQL for all registered views.
   */
  generateAllSQL(): string {
    const statements: string[] = []
    for (const def of this.views.values()) {
      statements.push(generateMaterializedViewSQL(def))
    }
    return statements.join("\n\n")
  }

  /**
   * Stop all timers and clear state.
   */
  stop(): void {
    for (const timer of this.refreshTimers.values()) clearTimeout(timer)
    for (const timer of this.debounceTimers.values()) clearTimeout(timer)
    this.refreshTimers.clear()
    this.debounceTimers.clear()
  }

  get viewCount(): number {
    return this.views.size
  }
}

// ─── Define View ─────────────────────────────────────────────────────────────

export function defineMaterializedView(def: MaterializedViewDefinition): MaterializedViewDefinition {
  if (!def.name) throw new Error("Materialized view must have a name")
  if (!def.source && !def.sql) throw new Error("Materialized view must have a source table or raw SQL")
  return def
}
