// --------------------------------------------------------------------------
// Embedded Analytics & Materialized Dashboards
// Pre-computed aggregation pipelines and embeddable live-updating chart components
// --------------------------------------------------------------------------

import { createHmac } from "node:crypto"

// ── Types ──────────────────────────────────────────────────────────────────

export interface AggregationPipeline {
  id: string
  name: string
  source: string
  stages: AggregationStage[]
  schedule?: CronSchedule
  refreshMode: "realtime" | "scheduled" | "manual"
  createdAt: number
  updatedAt: number
}

export type AggregationStage = MatchStage | GroupStage | SortStage | LimitStage | ProjectStage | WindowStage

export interface MatchStage {
  type: "match"
  conditions: Record<string, unknown>
}

export interface GroupStage {
  type: "group"
  by: string[]
  aggregations: AggregationFunction[]
}

export interface SortStage {
  type: "sort"
  fields: Array<{ field: string; direction: "asc" | "desc" }>
}

export interface LimitStage {
  type: "limit"
  count: number
}

export interface ProjectStage {
  type: "project"
  fields: Record<string, string | boolean>
}

export interface WindowStage {
  type: "window"
  partitionBy: string[]
  orderBy: string
  functions: WindowFunction[]
}

export interface AggregationFunction {
  name: string
  op: "count" | "sum" | "avg" | "min" | "max" | "distinct_count" | "percentile"
  field?: string
  percentile?: number
}

export interface WindowFunction {
  name: string
  op: "row_number" | "rank" | "dense_rank" | "lag" | "lead" | "running_sum" | "moving_avg"
  field?: string
  windowSize?: number
}

export interface CronSchedule {
  expression: string
  timezone?: string
}

export interface MaterializedResult {
  pipelineId: string
  rows: Record<string, unknown>[]
  computedAt: number
  rowCount: number
  stale: boolean
}

export interface DashboardDefinition {
  id: string
  name: string
  description: string
  widgets: DashboardWidget[]
  layout: LayoutConfig
  refreshIntervalMs?: number
  createdAt: number
  updatedAt: number
}

export interface DashboardWidget {
  id: string
  type: WidgetType
  title: string
  pipelineId: string
  config: WidgetConfig
  position: { x: number; y: number; width: number; height: number }
}

export type WidgetType =
  | "bar-chart"
  | "line-chart"
  | "pie-chart"
  | "area-chart"
  | "table"
  | "metric"
  | "gauge"
  | "heatmap"
  | "scatter"

export interface WidgetConfig {
  xField?: string
  yField?: string
  seriesField?: string
  valueField?: string
  labelField?: string
  colors?: string[]
  showLegend?: boolean
  showGrid?: boolean
  stacked?: boolean
  format?: string
  thresholds?: Threshold[]
}

export interface Threshold {
  value: number
  color: string
  label?: string
}

export interface LayoutConfig {
  columns: number
  rowHeight: number
  gap: number
}

export interface EmbedConfig {
  dashboardId: string
  theme: "light" | "dark" | "auto"
  allowInteraction: boolean
  token?: string
  width?: string
  height?: string
}

export interface AnalyticsOptions {
  maxPipelines?: number
  maxWidgetsPerDashboard?: number
  defaultRefreshMs?: number
  cacheResults?: boolean
}

export interface AnalyticsStats {
  pipelineCount: number
  dashboardCount: number
  totalComputations: number
  avgComputeTimeMs: number
  cacheHitRate: number
}

// ── Error ──────────────────────────────────────────────────────────────────

export class AnalyticsError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = "AnalyticsError"
  }
}

// ── SQL Builders ───────────────────────────────────────────────────────────

export function buildCreateAnalyticsTablesSQL(): string {
  return `
    CREATE TABLE IF NOT EXISTS _rb_analytics_pipelines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source TEXT NOT NULL,
      stages JSONB NOT NULL DEFAULT '[]',
      schedule JSONB,
      refresh_mode TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS _rb_analytics_results (
      pipeline_id TEXT NOT NULL REFERENCES _rb_analytics_pipelines(id) ON DELETE CASCADE,
      rows JSONB NOT NULL DEFAULT '[]',
      row_count INTEGER NOT NULL DEFAULT 0,
      computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (pipeline_id)
    );

    CREATE TABLE IF NOT EXISTS _rb_analytics_dashboards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      widgets JSONB NOT NULL DEFAULT '[]',
      layout JSONB NOT NULL DEFAULT '{}',
      refresh_interval_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `
}

export function buildUpsertPipelineSQL(): string {
  return `
    INSERT INTO _rb_analytics_pipelines (id, name, source, stages, schedule, refresh_mode, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (id) DO UPDATE SET name = $2, source = $3, stages = $4,
      schedule = $5, refresh_mode = $6, updated_at = NOW()
  `
}

export function buildUpsertResultSQL(): string {
  return `
    INSERT INTO _rb_analytics_results (pipeline_id, rows, row_count)
    VALUES ($1, $2, $3)
    ON CONFLICT (pipeline_id) DO UPDATE SET rows = $2, row_count = $3, computed_at = NOW()
  `
}

export function buildGetResultSQL(): string {
  return `SELECT pipeline_id, rows, row_count, computed_at FROM _rb_analytics_results WHERE pipeline_id = $1`
}

export function buildUpsertDashboardSQL(): string {
  return `
    INSERT INTO _rb_analytics_dashboards (id, name, description, widgets, layout, refresh_interval_ms, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (id) DO UPDATE SET name = $2, description = $3, widgets = $4,
      layout = $5, refresh_interval_ms = $6, updated_at = NOW()
  `
}

export function buildGetDashboardSQL(): string {
  return `SELECT * FROM _rb_analytics_dashboards WHERE id = $1`
}

// ── Pipeline to SQL compiler ───────────────────────────────────────────────

export function compilePipelineToSQL(pipeline: AggregationPipeline): string {
  let sql = `SELECT * FROM ${escapeSqlIdentifier(pipeline.source)}`
  const parts: string[] = []

  for (const stage of pipeline.stages) {
    switch (stage.type) {
      case "match": {
        const conditions = Object.entries(stage.conditions)
          .map(([k, v]) => `${escapeSqlIdentifier(k)} = ${escapeSqlLiteral(v)}`)
          .join(" AND ")
        if (conditions) parts.push(`WHERE ${conditions}`)
        break
      }
      case "group": {
        const groupBy = stage.by.map(escapeSqlIdentifier).join(", ")
        const aggs = stage.aggregations
          .map((a) => {
            const field = a.field ? escapeSqlIdentifier(a.field) : "*"
            switch (a.op) {
              case "count":
                return `COUNT(${field}) AS ${escapeSqlIdentifier(a.name)}`
              case "sum":
                return `SUM(${field}) AS ${escapeSqlIdentifier(a.name)}`
              case "avg":
                return `AVG(${field}) AS ${escapeSqlIdentifier(a.name)}`
              case "min":
                return `MIN(${field}) AS ${escapeSqlIdentifier(a.name)}`
              case "max":
                return `MAX(${field}) AS ${escapeSqlIdentifier(a.name)}`
              case "distinct_count":
                return `COUNT(DISTINCT ${field}) AS ${escapeSqlIdentifier(a.name)}`
              default:
                return `COUNT(${field}) AS ${escapeSqlIdentifier(a.name)}`
            }
          })
          .join(", ")
        sql = `SELECT ${groupBy}, ${aggs} FROM ${escapeSqlIdentifier(pipeline.source)}`
        parts.push(`GROUP BY ${groupBy}`)
        break
      }
      case "sort": {
        const orderBy = stage.fields
          .map((f) => `${escapeSqlIdentifier(f.field)} ${f.direction.toUpperCase()}`)
          .join(", ")
        parts.push(`ORDER BY ${orderBy}`)
        break
      }
      case "limit":
        parts.push(`LIMIT ${Math.max(1, Math.floor(stage.count))}`)
        break
      case "project": {
        const fields = Object.entries(stage.fields)
          .filter(([, v]) => v !== false)
          .map(([k, v]) =>
            typeof v === "string" ? `${escapeSqlIdentifier(v)} AS ${escapeSqlIdentifier(k)}` : escapeSqlIdentifier(k),
          )
          .join(", ")
        if (fields) sql = sql.replace("SELECT *", `SELECT ${fields}`)
        break
      }
    }
  }

  return `${sql} ${parts.join(" ")}`.trim()
}

function escapeSqlIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function escapeSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "number") return String(value)
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  return `'${String(value).replace(/'/g, "''")}'`
}

// ── In-Memory Aggregation Engine ───────────────────────────────────────────

export class AggregationEngine {
  execute(stages: AggregationStage[], rows: Record<string, unknown>[]): Record<string, unknown>[] {
    let result = [...rows]

    for (const stage of stages) {
      result = this.applyStage(stage, result)
    }

    return result
  }

  private applyStage(stage: AggregationStage, rows: Record<string, unknown>[]): Record<string, unknown>[] {
    switch (stage.type) {
      case "match":
        return rows.filter((row) => Object.entries(stage.conditions).every(([k, v]) => row[k] === v))
      case "group":
        return this.applyGroup(stage, rows)
      case "sort":
        return this.applySort(stage, rows)
      case "limit":
        return rows.slice(0, stage.count)
      case "project":
        return this.applyProject(stage, rows)
      case "window":
        return this.applyWindow(stage, rows)
      default:
        return rows
    }
  }

  private applyGroup(stage: GroupStage, rows: Record<string, unknown>[]): Record<string, unknown>[] {
    const groups = new Map<string, Record<string, unknown>[]>()

    for (const row of rows) {
      const key = stage.by.map((f) => String(row[f] ?? "")).join("|")
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(row)
    }

    const result: Record<string, unknown>[] = []
    for (const [, groupRows] of groups) {
      const agg: Record<string, unknown> = {}
      for (const field of stage.by) {
        agg[field] = groupRows[0][field]
      }
      for (const fn of stage.aggregations) {
        agg[fn.name] = this.computeAgg(fn, groupRows)
      }
      result.push(agg)
    }

    return result
  }

  private computeAgg(fn: AggregationFunction, rows: Record<string, unknown>[]): unknown {
    const values = fn.field ? rows.map((r) => r[fn.field!]).filter((v) => v !== null && v !== undefined) : rows
    switch (fn.op) {
      case "count":
        return values.length
      case "sum":
        return (values as number[]).reduce((a, b) => a + (Number(b) || 0), 0)
      case "avg": {
        const nums = values as number[]
        return nums.length > 0 ? nums.reduce((a, b) => a + (Number(b) || 0), 0) / nums.length : 0
      }
      case "min":
        return Math.min(...(values as number[]).map(Number).filter((n) => !isNaN(n)))
      case "max":
        return Math.max(...(values as number[]).map(Number).filter((n) => !isNaN(n)))
      case "distinct_count":
        return new Set(values.map(String)).size
      default:
        return values.length
    }
  }

  private applySort(stage: SortStage, rows: Record<string, unknown>[]): Record<string, unknown>[] {
    return [...rows].sort((a, b) => {
      for (const { field, direction } of stage.fields) {
        const av = a[field]
        const bv = b[field]
        if (av === bv) continue
        const cmp = av! < bv! ? -1 : 1
        return direction === "asc" ? cmp : -cmp
      }
      return 0
    })
  }

  private applyProject(stage: ProjectStage, rows: Record<string, unknown>[]): Record<string, unknown>[] {
    return rows.map((row) => {
      const result: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(stage.fields)) {
        if (v === false) continue
        result[k] = typeof v === "string" ? row[v] : row[k]
      }
      return result
    })
  }

  private applyWindow(stage: WindowStage, rows: Record<string, unknown>[]): Record<string, unknown>[] {
    // Group rows by partition
    const partitions = new Map<string, Record<string, unknown>[]>()
    for (const row of rows) {
      const key = stage.partitionBy.map((f) => String(row[f] ?? "")).join("|")
      if (!partitions.has(key)) partitions.set(key, [])
      partitions.get(key)!.push(row)
    }

    const result: Record<string, unknown>[] = []
    for (const [, partition] of partitions) {
      // Sort partition
      partition.sort((a, b) => {
        const av = a[stage.orderBy]
        const bv = b[stage.orderBy]
        return av! < bv! ? -1 : av! > bv! ? 1 : 0
      })

      for (let i = 0; i < partition.length; i++) {
        const row = { ...partition[i] }
        for (const fn of stage.functions) {
          switch (fn.op) {
            case "row_number":
              row[fn.name] = i + 1
              break
            case "running_sum": {
              let sum = 0
              for (let j = 0; j <= i; j++) {
                sum += Number(partition[j][fn.field!] || 0)
              }
              row[fn.name] = sum
              break
            }
            case "moving_avg": {
              const size = fn.windowSize || 3
              const start = Math.max(0, i - size + 1)
              let sum = 0
              for (let j = start; j <= i; j++) {
                sum += Number(partition[j][fn.field!] || 0)
              }
              row[fn.name] = sum / (i - start + 1)
              break
            }
            case "lag":
              row[fn.name] = i > 0 ? partition[i - 1][fn.field!] : null
              break
            case "lead":
              row[fn.name] = i < partition.length - 1 ? partition[i + 1][fn.field!] : null
              break
          }
        }
        result.push(row)
      }
    }

    return result
  }
}

// ── Embed Token Generator ──────────────────────────────────────────────────

export function generateEmbedToken(dashboardId: string, secret: string): string {
  const payload = `${dashboardId}:${Date.now()}`
  const signature = createHmac("sha256", secret).update(payload).digest("base64url")
  return Buffer.from(`${payload}:${signature}`).toString("base64url")
}

export function generateEmbedSnippet(config: EmbedConfig): string {
  const params = new URLSearchParams({
    dashboard: config.dashboardId,
    theme: config.theme,
    interactive: String(config.allowInteraction),
  })
  if (config.token) params.set("token", config.token)

  const width = config.width || "100%"
  const height = config.height || "600px"

  return `<iframe src="/embed/dashboard?${params}" width="${width}" height="${height}" frameborder="0" style="border:none;border-radius:8px;"></iframe>`
}

// ── Analytics Engine (Main) ────────────────────────────────────────────────

export class AnalyticsEngine {
  private pipelines = new Map<string, AggregationPipeline>()
  private results = new Map<string, MaterializedResult>()
  private dashboards = new Map<string, DashboardDefinition>()
  private subscribers = new Map<string, Set<(result: MaterializedResult) => void>>()
  readonly aggregation = new AggregationEngine()
  private computeCount = 0
  private computeTimeSum = 0
  private cacheHits = 0
  private cacheMisses = 0

  constructor(private readonly options: AnalyticsOptions = {}) {}

  registerPipeline(pipeline: AggregationPipeline): void {
    const max = this.options.maxPipelines ?? 100
    if (this.pipelines.size >= max && !this.pipelines.has(pipeline.id)) {
      throw new AnalyticsError(`Max pipelines (${max}) reached`, "MAX_PIPELINES")
    }
    pipeline.updatedAt = Date.now()
    this.pipelines.set(pipeline.id, pipeline)
  }

  computePipeline(pipelineId: string, sourceData: Record<string, unknown>[]): MaterializedResult {
    const pipeline = this.pipelines.get(pipelineId)
    if (!pipeline) {
      throw new AnalyticsError(`Pipeline ${pipelineId} not found`, "PIPELINE_NOT_FOUND")
    }

    const start = Date.now()
    const rows = this.aggregation.execute(pipeline.stages, sourceData)
    const computeTime = Date.now() - start

    this.computeCount++
    this.computeTimeSum += computeTime

    const result: MaterializedResult = {
      pipelineId,
      rows,
      computedAt: Date.now(),
      rowCount: rows.length,
      stale: false,
    }

    this.results.set(pipelineId, result)
    this.cacheMisses++

    // Notify subscribers
    const subs = this.subscribers.get(pipelineId)
    if (subs) {
      for (const sub of subs) {
        try {
          sub(result)
        } catch {
          /* swallow */
        }
      }
    }

    return result
  }

  getResult(pipelineId: string): MaterializedResult | null {
    const result = this.results.get(pipelineId)
    if (result) this.cacheHits++
    else this.cacheMisses++
    return result || null
  }

  invalidatePipeline(pipelineId: string): void {
    const result = this.results.get(pipelineId)
    if (result) result.stale = true
  }

  onPipelineUpdate(pipelineId: string, callback: (result: MaterializedResult) => void): () => void {
    if (!this.subscribers.has(pipelineId)) this.subscribers.set(pipelineId, new Set())
    this.subscribers.get(pipelineId)!.add(callback)
    return () => this.subscribers.get(pipelineId)?.delete(callback)
  }

  saveDashboard(dashboard: DashboardDefinition): void {
    const maxWidgets = this.options.maxWidgetsPerDashboard ?? 50
    if (dashboard.widgets.length > maxWidgets) {
      throw new AnalyticsError(`Too many widgets (${dashboard.widgets.length} > ${maxWidgets})`, "MAX_WIDGETS")
    }
    dashboard.updatedAt = Date.now()
    this.dashboards.set(dashboard.id, dashboard)
  }

  getDashboard(id: string): DashboardDefinition | null {
    return this.dashboards.get(id) || null
  }

  listDashboards(): DashboardDefinition[] {
    return Array.from(this.dashboards.values())
  }

  deleteDashboard(id: string): boolean {
    return this.dashboards.delete(id)
  }

  getPipeline(id: string): AggregationPipeline | null {
    return this.pipelines.get(id) || null
  }

  listPipelines(): AggregationPipeline[] {
    return Array.from(this.pipelines.values())
  }

  getStats(): AnalyticsStats {
    return {
      pipelineCount: this.pipelines.size,
      dashboardCount: this.dashboards.size,
      totalComputations: this.computeCount,
      avgComputeTimeMs: this.computeCount > 0 ? this.computeTimeSum / this.computeCount : 0,
      cacheHitRate: this.cacheHits + this.cacheMisses > 0 ? this.cacheHits / (this.cacheHits + this.cacheMisses) : 0,
    }
  }
}
