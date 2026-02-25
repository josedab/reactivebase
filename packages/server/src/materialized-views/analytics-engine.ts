/**
 * Real-Time Analytics Engine.
 * Declarative analytics DSL with IVM-backed incremental computation
 * and reactive subscriptions for live dashboards.
 *
 * Usage:
 *   const engine = new AnalyticsEngine()
 *   engine.defineMetric({ name: "daily_signups", table: "users", aggregation: "count", timeBucket: "day" })
 *   engine.applyChange({ table: "users", operation: "insert", row: { id: "u1" } })
 *   const result = engine.query("daily_signups", { from: startOfDay, to: now })
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AnalyticsMetricDef {
  name: string
  table: string
  aggregation: AggregationType
  /** Column to aggregate (required for sum, avg, min, max, percentile) */
  column?: string
  /** Time bucket for time-series (default: none — single aggregate) */
  timeBucket?: TimeBucketSize
  /** Timestamp column name (default: "created_at") */
  timestampColumn?: string
  /** Additional filter */
  filter?: Record<string, unknown>
  /** Group by dimensions */
  dimensions?: string[]
  /** Description for documentation */
  description?: string
}

export type AggregationType =
  | "count"
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "count_distinct"
  | "percentile_90"
  | "percentile_95"
  | "percentile_99"

export type TimeBucketSize = "minute" | "hour" | "day" | "week" | "month"

export interface AnalyticsQueryOptions {
  from?: number
  to?: number
  dimensions?: Record<string, string>
  limit?: number
}

export interface AnalyticsResult {
  metricName: string
  value: number
  timeSeries?: TimeSeriesPoint[]
  dimensions?: Record<string, AnalyticsDimensionResult[]>
  computedAt: number
  isCached: boolean
}

export interface TimeSeriesPoint {
  timestamp: number
  bucket: string
  value: number
}

export interface AnalyticsDimensionResult {
  dimension: string
  value: number
}

export interface AnalyticsSubscription {
  id: string
  metricName: string
  callback: (result: AnalyticsResult) => void
  lastValue: number | null
}

export interface AnalyticsEngineStats {
  metricsCount: number
  subscriptionCount: number
  computationsTotal: number
  incrementalUpdates: number
  fullRecomputes: number
  cacheHitRate: number
}

// ─── SQL Builders ────────────────────────────────────────────────────────────

export function generateAnalyticsSQL(metric: AnalyticsMetricDef): { sql: string; params: unknown[] } {
  const table = metric.table.replace(/[^a-zA-Z0-9_]/g, "")
  const tsCol = metric.timestampColumn ?? "created_at"
  const agg = buildAggregation(metric.aggregation, metric.column)

  let sql = `SELECT ${agg} AS value`

  if (metric.timeBucket) {
    sql += `, date_trunc('${metric.timeBucket}', "${tsCol}") AS bucket`
  }
  if (metric.dimensions) {
    for (const dim of metric.dimensions) {
      sql += `, "${dim.replace(/[^a-zA-Z0-9_]/g, "")}"`
    }
  }

  sql += ` FROM "${table}"`

  const conditions: string[] = []
  const params: unknown[] = []
  if (metric.filter) {
    for (const [key, val] of Object.entries(metric.filter)) {
      params.push(val)
      conditions.push(`"${key.replace(/[^a-zA-Z0-9_]/g, "")}" = $${params.length}`)
    }
  }
  if (conditions.length > 0) sql += ` WHERE ${conditions.join(" AND ")}`

  if (metric.timeBucket) sql += ` GROUP BY bucket`
  if (metric.dimensions) {
    const dims = metric.dimensions.map((d) => `"${d.replace(/[^a-zA-Z0-9_]/g, "")}"`)
    sql += metric.timeBucket ? `, ${dims.join(", ")}` : ` GROUP BY ${dims.join(", ")}`
  }
  if (metric.timeBucket) sql += ` ORDER BY bucket DESC`

  return { sql, params }
}

function buildAggregation(type: AggregationType, column?: string): string {
  const col = column ? `"${column.replace(/[^a-zA-Z0-9_]/g, "")}"` : "*"
  switch (type) {
    case "count":
      return `COUNT(${col})`
    case "sum":
      return `SUM(${col})`
    case "avg":
      return `AVG(${col})`
    case "min":
      return `MIN(${col})`
    case "max":
      return `MAX(${col})`
    case "count_distinct":
      return `COUNT(DISTINCT ${col})`
    case "percentile_90":
      return `PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY ${col})`
    case "percentile_95":
      return `PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${col})`
    case "percentile_99":
      return `PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ${col})`
    default:
      return `COUNT(*)`
  }
}

// ─── Analytics Engine ────────────────────────────────────────────────────────

export class AnalyticsEngine {
  private metrics = new Map<string, AnalyticsMetricDef>()
  private cache = new Map<string, { value: number; computedAt: number }>()
  private subscriptions = new Map<string, AnalyticsSubscription>()
  private subIdCounter = 0
  private computations = 0
  private incrementalUpdates = 0
  private fullRecomputes = 0
  private cacheHits = 0
  private cacheMisses = 0

  /**
   * Define a new analytics metric.
   */
  defineMetric(def: AnalyticsMetricDef): void {
    if (this.metrics.has(def.name)) throw new Error(`Metric "${def.name}" already defined`)
    this.metrics.set(def.name, def)
    // Initialize cache
    this.cache.set(def.name, { value: 0, computedAt: Date.now() })
  }

  /**
   * Remove a metric definition.
   */
  removeMetric(name: string): void {
    this.metrics.delete(name)
    this.cache.delete(name)
    // Remove subscriptions for this metric
    for (const [id, sub] of this.subscriptions) {
      if (sub.metricName === name) this.subscriptions.delete(id)
    }
  }

  /**
   * Apply a data change — incrementally update affected metrics.
   */
  applyChange(change: {
    table: string
    operation: "insert" | "update" | "delete"
    row?: Record<string, unknown>
  }): void {
    for (const [name, metric] of this.metrics) {
      if (metric.table !== change.table) continue

      // Check filter match
      if (metric.filter && change.row) {
        const matches = Object.entries(metric.filter).every(([k, v]) => change.row![k] === v)
        if (!matches) continue
      }

      const cached = this.cache.get(name)
      if (!cached) continue

      // Incremental update for simple count
      if (metric.aggregation === "count") {
        if (change.operation === "insert") cached.value++
        else if (change.operation === "delete") cached.value = Math.max(0, cached.value - 1)
        cached.computedAt = Date.now()
        this.incrementalUpdates++
      } else if (metric.aggregation === "sum" && metric.column && change.row) {
        const val = Number(change.row[metric.column] ?? 0)
        if (change.operation === "insert") cached.value += val
        else if (change.operation === "delete") cached.value -= val
        cached.computedAt = Date.now()
        this.incrementalUpdates++
      } else {
        // Full recompute needed for complex aggregations
        this.fullRecomputes++
      }

      this.computations++
      this.notifySubscribers(name)
    }
  }

  /**
   * Query a metric's current value.
   */
  query(metricName: string, _options: AnalyticsQueryOptions = {}): AnalyticsResult {
    const metric = this.metrics.get(metricName)
    if (!metric) throw new Error(`Metric "${metricName}" not found`)

    const cached = this.cache.get(metricName)
    if (cached) {
      this.cacheHits++
      return {
        metricName,
        value: cached.value,
        computedAt: cached.computedAt,
        isCached: true,
      }
    }

    this.cacheMisses++
    return { metricName, value: 0, computedAt: Date.now(), isCached: false }
  }

  /**
   * Subscribe to real-time metric updates.
   */
  subscribe(metricName: string, callback: (result: AnalyticsResult) => void): string {
    if (!this.metrics.has(metricName)) throw new Error(`Metric "${metricName}" not found`)

    const id = `analytics_sub_${++this.subIdCounter}`
    this.subscriptions.set(id, { id, metricName, callback, lastValue: null })

    // Send initial value
    const result = this.query(metricName)
    callback(result)

    return id
  }

  /**
   * Unsubscribe from metric updates.
   */
  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId)
  }

  /**
   * Generate SQL for creating materialized view of a metric.
   */
  generateSQL(metricName: string): { sql: string; params: unknown[] } {
    const metric = this.metrics.get(metricName)
    if (!metric) throw new Error(`Metric "${metricName}" not found`)
    return generateAnalyticsSQL(metric)
  }

  /**
   * List all defined metrics.
   */
  listMetrics(): AnalyticsMetricDef[] {
    return Array.from(this.metrics.values())
  }

  getStats(): AnalyticsEngineStats {
    const total = this.cacheHits + this.cacheMisses
    return {
      metricsCount: this.metrics.size,
      subscriptionCount: this.subscriptions.size,
      computationsTotal: this.computations,
      incrementalUpdates: this.incrementalUpdates,
      fullRecomputes: this.fullRecomputes,
      cacheHitRate: total > 0 ? Math.round((this.cacheHits / total) * 1000) / 1000 : 0,
    }
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private notifySubscribers(metricName: string): void {
    for (const sub of this.subscriptions.values()) {
      if (sub.metricName !== metricName) continue
      const result = this.query(metricName)
      if (result.value !== sub.lastValue) {
        sub.lastValue = result.value
        sub.callback(result)
      }
    }
  }
}
