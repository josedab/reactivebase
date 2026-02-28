/**
 * Embedded Analytics Query Engine for ReactiveBase.
 * Run analytical queries directly within the framework without external tooling.
 *
 * Features:
 *   - Time-series aggregation with configurable buckets
 *   - Funnel analysis for conversion tracking
 *   - Retention cohort analysis
 *   - Top-N queries with ranking
 *   - SQL generation for all analytics patterns
 *   - Query builder API for composable analytics
 *
 * Usage:
 *   const engine = new EmbeddedAnalyticsQueryEngine()
 *   const tsQuery = engine.timeSeries({ table: "events", timeColumn: "created_at", bucket: "day", metric: { fn: "count" } })
 *   const funnelQuery = engine.funnel({ table: "events", steps: [...] })
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TimeSeriesQuery {
  table: string
  timeColumn: string
  bucket: TimeBucket
  metric: MetricDefinition
  filters?: FilterCondition[]
  groupBy?: string[]
  timeRange?: TimeRange
  fillGaps?: boolean
}

export type TimeBucket = "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year"

export interface MetricDefinition {
  fn: "count" | "sum" | "avg" | "min" | "max" | "count_distinct" | "percentile"
  column?: string
  alias?: string
  percentile?: number
}

export interface FilterCondition {
  column: string
  operator: "=" | "!=" | ">" | "<" | ">=" | "<=" | "in" | "not_in" | "like" | "is_null" | "is_not_null"
  value?: unknown
}

export interface TimeRange {
  start?: string | Date
  end?: string | Date
  last?: string // e.g., "7d", "30d", "1h", "6m"
}

export interface FunnelQuery {
  table: string
  eventColumn: string
  userColumn: string
  timeColumn: string
  steps: FunnelStep[]
  timeRange?: TimeRange
  windowMs?: number
}

export interface FunnelStep {
  name: string
  filter: FilterCondition
}

export interface FunnelResult {
  steps: Array<{
    name: string
    count: number
    conversionRate: number
    dropoffRate: number
  }>
  overallConversion: number
}

export interface RetentionQuery {
  table: string
  userColumn: string
  timeColumn: string
  cohortBucket: TimeBucket
  retentionPeriods: number
  activationFilter?: FilterCondition
  retentionFilter?: FilterCondition
  timeRange?: TimeRange
}

export interface TopNQuery {
  table: string
  rankColumn: string
  metric: MetricDefinition
  n: number
  filters?: FilterCondition[]
  groupBy?: string[]
}

export interface AnalyticsQueryResult {
  sql: string
  params: unknown[]
  description: string
}

// ─── Query Engine ────────────────────────────────────────────────────────────

export class EmbeddedAnalyticsQueryEngine {
  /**
   * Generate a time-series aggregation query.
   */
  timeSeries(query: TimeSeriesQuery): AnalyticsQueryResult {
    validateTable(query.table)
    validateColumn(query.timeColumn)

    const params: unknown[] = []
    const bucketExpr = buildTimeBucketExpression(query.timeColumn, query.bucket)
    const metricExpr = buildMetricExpression(query.metric)
    const groupCols = query.groupBy?.map((c) => `"${sanitize(c)}"`) ?? []
    const selectCols = [
      `${bucketExpr} AS "time_bucket"`,
      ...groupCols,
      `${metricExpr} AS "${sanitize(query.metric.alias ?? "value")}"`,
    ]
    const groupByCols = [`${bucketExpr}`, ...groupCols]

    let whereClause = ""
    if (query.filters?.length || query.timeRange) {
      const conditions = buildFilterConditions(query.filters ?? [], params)
      if (query.timeRange) {
        conditions.push(...buildTimeRangeConditions(query.timeColumn, query.timeRange, params))
      }
      if (conditions.length > 0) {
        whereClause = `WHERE ${conditions.join(" AND ")}`
      }
    }

    const fillGaps = query.fillGaps
      ? `-- Note: Use generate_series to fill gaps in application layer`
      : ""

    const sql = [
      `SELECT ${selectCols.join(", ")}`,
      `FROM "${sanitize(query.table)}"`,
      whereClause,
      `GROUP BY ${groupByCols.join(", ")}`,
      `ORDER BY "time_bucket" ASC`,
      fillGaps,
    ]
      .filter(Boolean)
      .join("\n")

    return {
      sql,
      params,
      description: `Time series: ${query.metric.fn}${query.metric.column ? `(${query.metric.column})` : ""} by ${query.bucket} from ${query.table}`,
    }
  }

  /**
   * Generate a funnel analysis query.
   */
  funnel(query: FunnelQuery): AnalyticsQueryResult {
    validateTable(query.table)
    if (query.steps.length < 2) {
      throw new AnalyticsQueryError("Funnel requires at least 2 steps")
    }

    const params: unknown[] = []
    const ctes: string[] = []
    const windowMs = query.windowMs ?? 7 * 24 * 60 * 60 * 1000 // 7 days default

    // Build CTE for each funnel step
    for (let i = 0; i < query.steps.length; i++) {
      const step = query.steps[i]
      const conditions = buildFilterConditions([step.filter], params)
      const timeRangeConditions = query.timeRange
        ? buildTimeRangeConditions(query.timeColumn, query.timeRange, params)
        : []
      const allConditions = [...conditions, ...timeRangeConditions]
      const whereClause = allConditions.length > 0 ? `WHERE ${allConditions.join(" AND ")}` : ""

      if (i === 0) {
        ctes.push(
          `step_${i} AS (\n  SELECT DISTINCT "${sanitize(query.userColumn)}", MIN("${sanitize(query.timeColumn)}") AS step_time\n  FROM "${sanitize(query.table)}"\n  ${whereClause}\n  GROUP BY "${sanitize(query.userColumn)}"\n)`,
        )
      } else {
        ctes.push(
          `step_${i} AS (\n  SELECT DISTINCT e."${sanitize(query.userColumn)}", MIN(e."${sanitize(query.timeColumn)}") AS step_time\n  FROM "${sanitize(query.table)}" e\n  INNER JOIN step_${i - 1} prev ON e."${sanitize(query.userColumn)}" = prev."${sanitize(query.userColumn)}"\n  ${whereClause.replace("WHERE", `WHERE e."${sanitize(query.timeColumn)}" >= prev.step_time AND`)}\n)`,
        )
      }
    }

    // Final SELECT counts each step
    const stepCounts = query.steps
      .map((_, i) => `(SELECT COUNT(*) FROM step_${i}) AS "step_${i}_count"`)
      .join(",\n  ")

    const sql = `WITH ${ctes.join(",\n")}\nSELECT\n  ${stepCounts};`

    return {
      sql,
      params,
      description: `Funnel: ${query.steps.map((s) => s.name).join(" → ")}`,
    }
  }

  /**
   * Generate a retention cohort analysis query.
   */
  retention(query: RetentionQuery): AnalyticsQueryResult {
    validateTable(query.table)

    const params: unknown[] = []
    const bucketExpr = buildTimeBucketExpression(query.timeColumn, query.cohortBucket)

    const timeRangeConditions = query.timeRange
      ? buildTimeRangeConditions(query.timeColumn, query.timeRange, params)
      : []
    const whereClause = timeRangeConditions.length > 0
      ? `WHERE ${timeRangeConditions.join(" AND ")}`
      : ""

    const periodSelects = Array.from({ length: query.retentionPeriods }, (_, i) => {
      const interval = `${i + 1} ${query.cohortBucket}${i + 1 > 1 ? "s" : ""}`
      return `COUNT(DISTINCT CASE WHEN activity.activity_bucket = cohorts.cohort + INTERVAL '${interval}' THEN activity."${sanitize(query.userColumn)}" END) AS "period_${i + 1}"`
    }).join(",\n    ")

    const sql = [
      `WITH cohorts AS (`,
      `  SELECT "${sanitize(query.userColumn)}", ${bucketExpr} AS cohort`,
      `  FROM "${sanitize(query.table)}"`,
      whereClause ? `  ${whereClause}` : "",
      `  GROUP BY "${sanitize(query.userColumn)}"`,
      `  HAVING ${bucketExpr} = MIN(${bucketExpr})`,
      `),`,
      `activity AS (`,
      `  SELECT "${sanitize(query.userColumn)}", ${bucketExpr} AS activity_bucket`,
      `  FROM "${sanitize(query.table)}"`,
      `  GROUP BY "${sanitize(query.userColumn)}", ${bucketExpr}`,
      `)`,
      `SELECT`,
      `  cohorts.cohort,`,
      `  COUNT(DISTINCT cohorts."${sanitize(query.userColumn)}") AS cohort_size,`,
      `    ${periodSelects}`,
      `FROM cohorts`,
      `LEFT JOIN activity ON cohorts."${sanitize(query.userColumn)}" = activity."${sanitize(query.userColumn)}"`,
      `GROUP BY cohorts.cohort`,
      `ORDER BY cohorts.cohort;`,
    ].filter(Boolean).join("\n")

    return {
      sql,
      params,
      description: `Retention: ${query.retentionPeriods} ${query.cohortBucket} periods`,
    }
  }

  /**
   * Generate a Top-N ranking query.
   */
  topN(query: TopNQuery): AnalyticsQueryResult {
    validateTable(query.table)

    const params: unknown[] = []
    const metricExpr = buildMetricExpression(query.metric)
    const groupCols = [
      `"${sanitize(query.rankColumn)}"`,
      ...(query.groupBy?.map((c) => `"${sanitize(c)}"`) ?? []),
    ]

    const conditions = buildFilterConditions(query.filters ?? [], params)
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

    params.push(query.n)
    const limitParam = `$${params.length}`

    const sql = [
      `SELECT ${groupCols.join(", ")},`,
      `  ${metricExpr} AS "value",`,
      `  RANK() OVER (ORDER BY ${metricExpr} DESC) AS "rank"`,
      `FROM "${sanitize(query.table)}"`,
      whereClause,
      `GROUP BY ${groupCols.join(", ")}`,
      `ORDER BY "value" DESC`,
      `LIMIT ${limitParam};`,
    ].filter(Boolean).join("\n")

    return {
      sql,
      params,
      description: `Top ${query.n} by ${query.metric.fn}${query.metric.column ? `(${query.metric.column})` : ""} on ${query.table}`,
    }
  }

  /**
   * Generate a comparison query (period-over-period).
   */
  comparison(config: {
    table: string
    timeColumn: string
    metric: MetricDefinition
    currentRange: TimeRange
    previousRange: TimeRange
    groupBy?: string[]
  }): AnalyticsQueryResult {
    const params: unknown[] = []
    const metricExpr = buildMetricExpression(config.metric)
    const groupCols = config.groupBy?.map((c) => `"${sanitize(c)}"`) ?? []

    const currentConditions = buildTimeRangeConditions(config.timeColumn, config.currentRange, params)
    const previousConditions = buildTimeRangeConditions(config.timeColumn, config.previousRange, params)

    const groupByClause = groupCols.length > 0 ? `, ${groupCols.join(", ")}` : ""
    const groupBySQL = groupCols.length > 0 ? `GROUP BY ${groupCols.join(", ")}` : ""

    const sql = [
      `WITH current_period AS (`,
      `  SELECT ${metricExpr} AS value${groupByClause}`,
      `  FROM "${sanitize(config.table)}"`,
      `  WHERE ${currentConditions.join(" AND ")}`,
      `  ${groupBySQL}`,
      `),`,
      `previous_period AS (`,
      `  SELECT ${metricExpr} AS value${groupByClause}`,
      `  FROM "${sanitize(config.table)}"`,
      `  WHERE ${previousConditions.join(" AND ")}`,
      `  ${groupBySQL}`,
      `)`,
      `SELECT`,
      `  c.value AS current_value,`,
      `  p.value AS previous_value,`,
      `  CASE WHEN p.value > 0 THEN ROUND(((c.value - p.value) / p.value * 100)::numeric, 2) ELSE NULL END AS change_pct`,
      `FROM current_period c, previous_period p;`,
    ].join("\n")

    return {
      sql,
      params,
      description: `Period comparison: ${config.metric.fn} on ${config.table}`,
    }
  }
}

// ─── SQL Helpers ─────────────────────────────────────────────────────────────

function buildTimeBucketExpression(column: string, bucket: TimeBucket): string {
  const col = `"${sanitize(column)}"`
  switch (bucket) {
    case "minute":
      return `date_trunc('minute', ${col})`
    case "hour":
      return `date_trunc('hour', ${col})`
    case "day":
      return `date_trunc('day', ${col})`
    case "week":
      return `date_trunc('week', ${col})`
    case "month":
      return `date_trunc('month', ${col})`
    case "quarter":
      return `date_trunc('quarter', ${col})`
    case "year":
      return `date_trunc('year', ${col})`
    default:
      return `date_trunc('day', ${col})`
  }
}

function buildMetricExpression(metric: MetricDefinition): string {
  const col = metric.column ? `"${sanitize(metric.column)}"` : "*"
  switch (metric.fn) {
    case "count":
      return `COUNT(${col})`
    case "count_distinct":
      return `COUNT(DISTINCT ${col})`
    case "sum":
      return `SUM(${col})`
    case "avg":
      return `AVG(${col})`
    case "min":
      return `MIN(${col})`
    case "max":
      return `MAX(${col})`
    case "percentile":
      return `PERCENTILE_CONT(${metric.percentile ?? 0.5}) WITHIN GROUP (ORDER BY ${col})`
    default:
      return `COUNT(${col})`
  }
}

function buildFilterConditions(filters: FilterCondition[], params: unknown[]): string[] {
  return filters.map((f) => {
    const col = `"${sanitize(f.column)}"`
    switch (f.operator) {
      case "=":
        params.push(f.value)
        return `${col} = $${params.length}`
      case "!=":
        params.push(f.value)
        return `${col} != $${params.length}`
      case ">":
        params.push(f.value)
        return `${col} > $${params.length}`
      case "<":
        params.push(f.value)
        return `${col} < $${params.length}`
      case ">=":
        params.push(f.value)
        return `${col} >= $${params.length}`
      case "<=":
        params.push(f.value)
        return `${col} <= $${params.length}`
      case "in":
        params.push(f.value)
        return `${col} = ANY($${params.length})`
      case "not_in":
        params.push(f.value)
        return `${col} != ALL($${params.length})`
      case "like":
        params.push(f.value)
        return `${col} LIKE $${params.length}`
      case "is_null":
        return `${col} IS NULL`
      case "is_not_null":
        return `${col} IS NOT NULL`
      default:
        return `TRUE`
    }
  })
}

function buildTimeRangeConditions(
  column: string,
  range: TimeRange,
  params: unknown[],
): string[] {
  const col = `"${sanitize(column)}"`
  const conditions: string[] = []

  if (range.last) {
    const interval = parseLastInterval(range.last)
    conditions.push(`${col} >= NOW() - INTERVAL '${interval}'`)
  } else {
    if (range.start) {
      params.push(range.start instanceof Date ? range.start.toISOString() : range.start)
      conditions.push(`${col} >= $${params.length}`)
    }
    if (range.end) {
      params.push(range.end instanceof Date ? range.end.toISOString() : range.end)
      conditions.push(`${col} <= $${params.length}`)
    }
  }

  return conditions
}

function parseLastInterval(last: string): string {
  const match = last.match(/^(\d+)([mhdwMy])$/)
  if (!match) return "7 days"

  const [, num, unit] = match
  const units: Record<string, string> = {
    m: "minutes",
    h: "hours",
    d: "days",
    w: "weeks",
    M: "months",
    y: "years",
  }

  return `${num} ${units[unit] ?? "days"}`
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "")
}

function validateTable(table: string): void {
  if (!table || table.trim() === "") {
    throw new AnalyticsQueryError("Table name is required")
  }
}

function validateColumn(column: string): void {
  if (!column || column.trim() === "") {
    throw new AnalyticsQueryError("Column name is required")
  }
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class AnalyticsQueryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AnalyticsQueryError"
  }
}
