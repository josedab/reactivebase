/**
 * Dashboard v2: Query Inspector, Subscription Heatmap, Data Browser, and Mutation Replay.
 * Extends the existing dashboard with advanced observability features.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QueryInspectorEntry {
  queryName: string
  subscriberCount: number
  avgLatencyMs: number
  p50LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  totalExecutions: number
  totalInvalidations: number
  lastExecutedAt: number
  dependencies: string[]
  /** Postgres EXPLAIN output */
  explainPlan?: string
}

export interface SubscriptionHeatmapEntry {
  table: string
  queryName: string
  subscriberCount: number
  invalidationsPerMinute: number
  /** Heat score: higher means more active */
  heat: number
}

export interface DataBrowserOptions {
  table: string
  page?: number
  pageSize?: number
  sortBy?: string
  sortDirection?: "asc" | "desc"
  filters?: DataBrowserFilter[]
}

export interface DataBrowserFilter {
  column: string
  operator: "=" | "!=" | ">" | "<" | ">=" | "<=" | "like" | "in" | "is_null" | "is_not_null"
  value?: unknown
}

export interface DataBrowserResult {
  rows: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
  columns: DataBrowserColumn[]
}

export interface DataBrowserColumn {
  name: string
  type: string
  nullable: boolean
  isPrimaryKey: boolean
  isForeignKey: boolean
  referencedTable?: string
}

export interface MutationReplayEntry {
  id: string
  mutationName: string
  args: unknown
  result: unknown
  error?: string
  durationMs: number
  executedAt: number
  userId?: string
  transactionId?: string
  affectedTables: string[]
  affectedRowIds: string[]
}

export interface MutationReplayOptions {
  limit?: number
  mutationName?: string
  table?: string
  since?: number
  userId?: string
}

export interface DashboardV2Metrics {
  overview: {
    activeConnections: number
    activeSubscriptions: number
    queriesPerSecond: number
    mutationsPerSecond: number
    avgQueryLatencyMs: number
    avgMutationLatencyMs: number
    errorRate: number
    uptime: number
  }
  topQueries: QueryInspectorEntry[]
  subscriptionHeatmap: SubscriptionHeatmapEntry[]
  recentMutations: MutationReplayEntry[]
  connectionPool: {
    total: number
    active: number
    idle: number
    waiting: number
    maxSize: number
  }
  slowQueries: {
    queryName: string
    latencyMs: number
    executedAt: number
    explainPlan?: string
  }[]
}

// ─── Persistence SQL ─────────────────────────────────────────────────────────

export function generateDashboardV2TableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_mutation_log (
  id TEXT PRIMARY KEY,
  mutation_name TEXT NOT NULL,
  args JSONB NOT NULL DEFAULT '{}',
  result JSONB,
  error TEXT,
  duration_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
  user_id TEXT,
  transaction_id TEXT,
  affected_tables TEXT[] NOT NULL DEFAULT '{}',
  affected_row_ids TEXT[] NOT NULL DEFAULT '{}',
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mutation_log_name
  ON _reactivebase_mutation_log(mutation_name);
CREATE INDEX IF NOT EXISTS idx_mutation_log_executed
  ON _reactivebase_mutation_log(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_mutation_log_user
  ON _reactivebase_mutation_log(user_id);

CREATE TABLE IF NOT EXISTS _reactivebase_query_stats (
  query_name TEXT PRIMARY KEY,
  total_executions BIGINT NOT NULL DEFAULT 0,
  total_invalidations BIGINT NOT NULL DEFAULT 0,
  total_latency_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
  min_latency_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
  max_latency_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
  last_executed_at TIMESTAMPTZ,
  dependencies TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`.trim()
}

export function buildInsertMutationLogSQL(entry: MutationReplayEntry): {
  sql: string
  params: unknown[]
} {
  return {
    sql: `INSERT INTO _reactivebase_mutation_log
  (id, mutation_name, args, result, error, duration_ms, user_id, transaction_id, affected_tables, affected_row_ids)
VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9, $10)`,
    params: [
      entry.id,
      entry.mutationName,
      JSON.stringify(entry.args),
      JSON.stringify(entry.result),
      entry.error ?? null,
      entry.durationMs,
      entry.userId ?? null,
      entry.transactionId ?? null,
      entry.affectedTables,
      entry.affectedRowIds,
    ],
  }
}

export function buildQueryMutationLogSQL(options: MutationReplayOptions): {
  sql: string
  params: unknown[]
} {
  const conditions: string[] = []
  const params: unknown[] = []
  let paramIdx = 1

  if (options.mutationName) {
    conditions.push(`mutation_name = $${paramIdx++}`)
    params.push(options.mutationName)
  }
  if (options.table) {
    conditions.push(`$${paramIdx++} = ANY(affected_tables)`)
    params.push(options.table)
  }
  if (options.since) {
    conditions.push(`executed_at >= to_timestamp($${paramIdx++})`)
    params.push(options.since / 1000)
  }
  if (options.userId) {
    conditions.push(`user_id = $${paramIdx++}`)
    params.push(options.userId)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const limit = options.limit ?? 50

  return {
    sql: `SELECT * FROM _reactivebase_mutation_log ${where} ORDER BY executed_at DESC LIMIT ${limit}`,
    params,
  }
}

export function buildUpdateQueryStatsSQL(
  queryName: string,
  latencyMs: number,
  dependencies: string[],
): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_query_stats
  (query_name, total_executions, total_latency_ms, min_latency_ms, max_latency_ms, last_executed_at, dependencies)
VALUES ($1, 1, $2, $2, $2, NOW(), $3)
ON CONFLICT (query_name) DO UPDATE SET
  total_executions = _reactivebase_query_stats.total_executions + 1,
  total_latency_ms = _reactivebase_query_stats.total_latency_ms + $2,
  min_latency_ms = LEAST(_reactivebase_query_stats.min_latency_ms, $2),
  max_latency_ms = GREATEST(_reactivebase_query_stats.max_latency_ms, $2),
  last_executed_at = NOW(),
  dependencies = $3,
  updated_at = NOW()`,
    params: [queryName, latencyMs, dependencies],
  }
}

export function buildDataBrowserQuerySQL(options: DataBrowserOptions): {
  sql: string
  params: unknown[]
} {
  const conditions: string[] = []
  const params: unknown[] = []
  let paramIdx = 1

  for (const filter of options.filters ?? []) {
    switch (filter.operator) {
      case "is_null":
        conditions.push(`"${filter.column}" IS NULL`)
        break
      case "is_not_null":
        conditions.push(`"${filter.column}" IS NOT NULL`)
        break
      case "like":
        conditions.push(`"${filter.column}" ILIKE $${paramIdx++}`)
        params.push(filter.value)
        break
      case "in":
        conditions.push(`"${filter.column}" = ANY($${paramIdx++})`)
        params.push(filter.value)
        break
      default:
        conditions.push(`"${filter.column}" ${filter.operator} $${paramIdx++}`)
        params.push(filter.value)
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const orderBy = options.sortBy ? `ORDER BY "${options.sortBy}" ${options.sortDirection ?? "asc"}` : "ORDER BY 1"
  const page = options.page ?? 1
  const pageSize = options.pageSize ?? 50
  const offset = (page - 1) * pageSize

  return {
    sql: `SELECT * FROM "${options.table}" ${where} ${orderBy} LIMIT ${pageSize} OFFSET ${offset}`,
    params,
  }
}

// ─── DashboardV2 Engine ──────────────────────────────────────────────────────

export interface DashboardV2Options {
  /** Max mutation log entries to keep in memory (default: 1000) */
  maxMutationLog?: number
  /** Stats collection interval in ms (default: 1000) */
  statsInterval?: number
  /** Slow query threshold in ms (default: 100) */
  slowQueryThresholdMs?: number
}

const DEFAULT_DASHBOARD_V2_OPTIONS: Required<DashboardV2Options> = {
  maxMutationLog: 1000,
  statsInterval: 1000,
  slowQueryThresholdMs: 100,
}

export class DashboardV2Engine {
  private options: Required<DashboardV2Options>
  private queryStats = new Map<string, QueryInspectorEntry>()
  private mutationLog: MutationReplayEntry[] = []
  private heatmapData = new Map<string, SubscriptionHeatmapEntry>()
  private slowQueries: { queryName: string; latencyMs: number; executedAt: number; explainPlan?: string }[] = []
  private connectionStats = { active: 0, idle: 0, waiting: 0, total: 0, maxSize: 20 }
  private latencyBuckets = new Map<string, number[]>()

  constructor(options: DashboardV2Options = {}) {
    this.options = { ...DEFAULT_DASHBOARD_V2_OPTIONS, ...options }
  }

  get queryCount(): number {
    return this.queryStats.size
  }

  get mutationLogSize(): number {
    return this.mutationLog.length
  }

  // ─── Query Inspector ─────────────────────────────────────────────────────

  recordQueryExecution(
    queryName: string,
    latencyMs: number,
    dependencies: string[],
    subscriberCount: number = 0,
    explainPlan?: string,
  ): void {
    let entry = this.queryStats.get(queryName)
    if (!entry) {
      entry = {
        queryName,
        subscriberCount: 0,
        avgLatencyMs: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        totalExecutions: 0,
        totalInvalidations: 0,
        lastExecutedAt: 0,
        dependencies: [],
      }
      this.queryStats.set(queryName, entry)
      this.latencyBuckets.set(queryName, [])
    }

    entry.totalExecutions++
    entry.lastExecutedAt = Date.now()
    entry.dependencies = dependencies
    entry.subscriberCount = subscriberCount
    if (explainPlan) entry.explainPlan = explainPlan

    const buckets = this.latencyBuckets.get(queryName)!
    buckets.push(latencyMs)
    // Keep last 1000 samples
    if (buckets.length > 1000) buckets.splice(0, buckets.length - 1000)

    entry.avgLatencyMs = buckets.reduce((a, b) => a + b, 0) / buckets.length
    const sorted = [...buckets].sort((a, b) => a - b)
    entry.p50LatencyMs = sorted[Math.floor(sorted.length * 0.5)] ?? 0
    entry.p95LatencyMs = sorted[Math.floor(sorted.length * 0.95)] ?? 0
    entry.p99LatencyMs = sorted[Math.floor(sorted.length * 0.99)] ?? 0

    if (latencyMs >= this.options.slowQueryThresholdMs) {
      this.slowQueries.push({ queryName, latencyMs, executedAt: Date.now(), explainPlan })
      if (this.slowQueries.length > 100) this.slowQueries.splice(0, this.slowQueries.length - 100)
    }
  }

  recordQueryInvalidation(queryName: string): void {
    const entry = this.queryStats.get(queryName)
    if (entry) {
      entry.totalInvalidations++
    }
  }

  getQueryStats(queryName: string): QueryInspectorEntry | undefined {
    return this.queryStats.get(queryName)
  }

  getTopQueries(limit: number = 10): QueryInspectorEntry[] {
    return Array.from(this.queryStats.values())
      .sort((a, b) => b.subscriberCount - a.subscriberCount)
      .slice(0, limit)
  }

  getSlowQueries(limit: number = 20): typeof this.slowQueries {
    return this.slowQueries.slice(-limit)
  }

  // ─── Subscription Heatmap ────────────────────────────────────────────────

  updateHeatmap(table: string, queryName: string, subscriberCount: number, invalidationsPerMinute: number): void {
    const key = `${table}:${queryName}`
    const heat = subscriberCount * 0.4 + invalidationsPerMinute * 0.6
    this.heatmapData.set(key, { table, queryName, subscriberCount, invalidationsPerMinute, heat })
  }

  getHeatmap(): SubscriptionHeatmapEntry[] {
    return Array.from(this.heatmapData.values()).sort((a, b) => b.heat - a.heat)
  }

  // ─── Mutation Replay Log ─────────────────────────────────────────────────

  recordMutation(entry: MutationReplayEntry): void {
    this.mutationLog.push(entry)
    if (this.mutationLog.length > this.options.maxMutationLog) {
      this.mutationLog.splice(0, this.mutationLog.length - this.options.maxMutationLog)
    }
  }

  getMutationLog(options: MutationReplayOptions = {}): MutationReplayEntry[] {
    let results = this.mutationLog

    if (options.mutationName) {
      results = results.filter((m) => m.mutationName === options.mutationName)
    }
    if (options.table) {
      results = results.filter((m) => m.affectedTables.includes(options.table!))
    }
    if (options.since) {
      results = results.filter((m) => m.executedAt >= options.since!)
    }
    if (options.userId) {
      results = results.filter((m) => m.userId === options.userId)
    }

    const limit = options.limit ?? 50
    return results.slice(-limit).reverse()
  }

  getMutationById(id: string): MutationReplayEntry | undefined {
    return this.mutationLog.find((m) => m.id === id)
  }

  // ─── Connection Pool ─────────────────────────────────────────────────────

  updateConnectionPool(stats: typeof this.connectionStats): void {
    this.connectionStats = stats
  }

  getConnectionPool(): typeof this.connectionStats {
    return { ...this.connectionStats }
  }

  // ─── Aggregate Metrics ───────────────────────────────────────────────────

  getMetrics(): DashboardV2Metrics {
    const allQueries = Array.from(this.queryStats.values())
    const _totalQueriesExec = allQueries.reduce((a, q) => a + q.totalExecutions, 0)
    const totalMutations = this.mutationLog.length
    const totalErrors = this.mutationLog.filter((m) => m.error).length

    return {
      overview: {
        activeConnections: this.connectionStats.active,
        activeSubscriptions: allQueries.reduce((a, q) => a + q.subscriberCount, 0),
        queriesPerSecond: 0, // Would need time window tracking
        mutationsPerSecond: 0,
        avgQueryLatencyMs:
          allQueries.length > 0 ? allQueries.reduce((a, q) => a + q.avgLatencyMs, 0) / allQueries.length : 0,
        avgMutationLatencyMs:
          totalMutations > 0 ? this.mutationLog.reduce((a, m) => a + m.durationMs, 0) / totalMutations : 0,
        errorRate: totalMutations > 0 ? totalErrors / totalMutations : 0,
        uptime: 0,
      },
      topQueries: this.getTopQueries(),
      subscriptionHeatmap: this.getHeatmap(),
      recentMutations: this.getMutationLog({ limit: 20 }),
      connectionPool: this.getConnectionPool(),
      slowQueries: this.getSlowQueries(),
    }
  }

  // ─── Reset ───────────────────────────────────────────────────────────────

  reset(): void {
    this.queryStats.clear()
    this.mutationLog = []
    this.heatmapData.clear()
    this.slowQueries = []
    this.latencyBuckets.clear()
  }
}

// ─── Dashboard V2 HTML Generator ─────────────────────────────────────────────

export function generateDashboardV2HTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ReactiveBase Dashboard v2</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; }
  .header { padding: 12px 20px; border-bottom: 1px solid #30363d; display: flex; align-items: center; gap: 12px; }
  .header h1 { font-size: 16px; font-weight: 600; color: #58a6ff; }
  .badge { background: #238636; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; }
  .tabs { display: flex; border-bottom: 1px solid #30363d; padding: 0 20px; background: #161b22; }
  .tab { padding: 10px 16px; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent; color: #8b949e; }
  .tab.active { border-bottom-color: #58a6ff; color: #c9d1d9; }
  .panel { display: none; padding: 20px; }
  .panel.active { display: block; }
  .metrics-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .metric-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px; }
  .metric-value { font-size: 24px; font-weight: 700; color: #58a6ff; }
  .metric-label { font-size: 11px; color: #8b949e; margin-top: 2px; }
  .section { margin-bottom: 24px; }
  .section-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; color: #c9d1d9; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 12px; border-bottom: 1px solid #30363d; color: #8b949e; font-weight: 500; }
  td { padding: 8px 12px; border-bottom: 1px solid #21262d; }
  .heatmap-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
  .heat-cell { padding: 10px; border-radius: 6px; font-size: 11px; }
  .heat-low { background: #0d1117; border: 1px solid #30363d; }
  .heat-med { background: #161b22; border: 1px solid #d29922; }
  .heat-high { background: #1c1208; border: 1px solid #f0883e; }
  .heat-critical { background: #200c0c; border: 1px solid #da3633; }
  .pool-bar { height: 24px; border-radius: 4px; display: flex; overflow: hidden; margin-top: 8px; }
  .pool-active { background: #58a6ff; }
  .pool-idle { background: #238636; }
  .pool-waiting { background: #d29922; }
  .pool-free { background: #30363d; }
  .data-browser { background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
  .data-browser table { margin: 0; }
  .data-browser th { background: #0d1117; position: sticky; top: 0; }
  .mutation-entry { padding: 12px; border-bottom: 1px solid #21262d; font-size: 13px; }
  .mutation-name { color: #d2a8ff; font-weight: 600; }
  .mutation-time { color: #8b949e; font-size: 11px; }
  .mutation-error { color: #f85149; }
  .latency-bar { height: 4px; border-radius: 2px; background: #30363d; margin-top: 4px; }
  .latency-fill { height: 100%; border-radius: 2px; }
  .latency-good { background: #238636; }
  .latency-warn { background: #d29922; }
  .latency-bad { background: #da3633; }
  #status { font-size: 11px; color: #6e7681; margin-left: auto; }
</style>
</head>
<body>
<div class="header">
  <h1>⚡ ReactiveBase</h1>
  <span class="badge">Dashboard v2</span>
  <span id="status">Connecting...</span>
</div>
<div class="tabs">
  <div class="tab active" onclick="showTab('overview')">Overview</div>
  <div class="tab" onclick="showTab('queries')">Query Inspector</div>
  <div class="tab" onclick="showTab('heatmap')">Heatmap</div>
  <div class="tab" onclick="showTab('mutations')">Mutation Log</div>
  <div class="tab" onclick="showTab('data')">Data Browser</div>
  <div class="tab" onclick="showTab('pool')">Connection Pool</div>
</div>

<div id="overview" class="panel active">
  <div class="metrics-grid" id="overview-metrics"></div>
  <div class="section">
    <div class="section-title">Slow Queries</div>
    <table id="slow-queries-table"><thead><tr><th>Query</th><th>Latency</th><th>Time</th></tr></thead><tbody></tbody></table>
  </div>
</div>

<div id="queries" class="panel">
  <div class="section-title">Query Performance</div>
  <table id="query-table"><thead><tr><th>Query</th><th>Subscribers</th><th>Executions</th><th>Avg</th><th>P50</th><th>P95</th><th>P99</th><th>Invalidations</th></tr></thead><tbody></tbody></table>
</div>

<div id="heatmap" class="panel">
  <div class="section-title">Subscription Heatmap</div>
  <div class="heatmap-grid" id="heatmap-grid"></div>
</div>

<div id="mutations" class="panel">
  <div class="section-title">Recent Mutations</div>
  <div id="mutation-list"></div>
</div>

<div id="data" class="panel">
  <div class="section-title">Data Browser</div>
  <p style="color:#8b949e;font-size:13px;margin-bottom:12px">Select a table to browse data. (Requires /dashboard/api endpoint)</p>
  <div class="data-browser" id="data-browser-content">
    <p style="padding:16px;color:#6e7681">No table selected.</p>
  </div>
</div>

<div id="pool" class="panel">
  <div class="section-title">Connection Pool</div>
  <div id="pool-stats"></div>
  <div class="pool-bar" id="pool-bar"></div>
  <div style="display:flex;gap:16px;margin-top:8px;font-size:11px;color:#8b949e">
    <span>🔵 Active</span><span>🟢 Idle</span><span>🟡 Waiting</span><span>⬛ Free</span>
  </div>
</div>

<script>
function showTab(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById(name).classList.add('active');
  event.target.classList.add('active');
}

function fmt(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return typeof n === 'number' ? n.toFixed(1) : String(n);
}

function latencyClass(ms) { return ms < 50 ? 'latency-good' : ms < 200 ? 'latency-warn' : 'latency-bad'; }
function heatClass(h) { return h < 10 ? 'heat-low' : h < 50 ? 'heat-med' : h < 100 ? 'heat-high' : 'heat-critical'; }

async function refresh() {
  try {
    const r = await fetch('/dashboard/api/v2/metrics', {headers:{Accept:'application/json'}});
    const m = await r.json();
    const o = m.overview;
    document.getElementById('overview-metrics').innerHTML = [
      mc('Connections', o.activeConnections), mc('Subscriptions', o.activeSubscriptions),
      mc('Avg Query', fmt(o.avgQueryLatencyMs)+'ms'), mc('Avg Mutation', fmt(o.avgMutationLatencyMs)+'ms'),
      mc('Error Rate', (o.errorRate*100).toFixed(1)+'%'),
    ].join('');

    // Slow queries
    const sqBody = document.querySelector('#slow-queries-table tbody');
    sqBody.innerHTML = (m.slowQueries||[]).map(sq =>
      '<tr><td>'+sq.queryName+'</td><td>'+fmt(sq.latencyMs)+'ms</td><td>'+new Date(sq.executedAt).toLocaleTimeString()+'</td></tr>'
    ).join('') || '<tr><td colspan="3" style="color:#6e7681">No slow queries</td></tr>';

    // Query inspector
    const qBody = document.querySelector('#query-table tbody');
    qBody.innerHTML = (m.topQueries||[]).map(q =>
      '<tr><td>'+q.queryName+'</td><td>'+q.subscriberCount+'</td><td>'+q.totalExecutions+'</td>' +
      '<td>'+fmt(q.avgLatencyMs)+'ms</td><td>'+fmt(q.p50LatencyMs)+'ms</td><td>'+fmt(q.p95LatencyMs)+'ms</td><td>'+fmt(q.p99LatencyMs)+'ms</td>' +
      '<td>'+q.totalInvalidations+'</td></tr>'
    ).join('');

    // Heatmap
    document.getElementById('heatmap-grid').innerHTML = (m.subscriptionHeatmap||[]).map(h =>
      '<div class="heat-cell '+heatClass(h.heat)+'"><strong>'+h.queryName+'</strong><br>'+h.table+'<br>'+h.subscriberCount+' subs, '+fmt(h.invalidationsPerMinute)+'/min</div>'
    ).join('') || '<p style="color:#6e7681">No subscription data yet.</p>';

    // Mutations
    document.getElementById('mutation-list').innerHTML = (m.recentMutations||[]).map(mut =>
      '<div class="mutation-entry"><span class="mutation-name">'+mut.mutationName+'</span> <span class="mutation-time">'+new Date(mut.executedAt).toLocaleTimeString()+' ('+fmt(mut.durationMs)+'ms)</span>' +
      (mut.error ? '<div class="mutation-error">'+mut.error+'</div>' : '') +
      '<div style="color:#8b949e;font-size:11px;margin-top:2px">Tables: '+mut.affectedTables.join(', ')+'</div></div>'
    ).join('') || '<p style="color:#6e7681;padding:16px">No mutations recorded.</p>';

    // Pool
    const p = m.connectionPool;
    const maxP = p.maxSize || p.total || 20;
    document.getElementById('pool-stats').innerHTML =
      '<div style="font-size:13px">Active: '+p.active+' / Idle: '+p.idle+' / Waiting: '+p.waiting+' / Max: '+maxP+'</div>';
    document.getElementById('pool-bar').innerHTML =
      seg('pool-active', p.active/maxP*100)+seg('pool-idle', p.idle/maxP*100)+seg('pool-waiting', p.waiting/maxP*100)+seg('pool-free', Math.max(0,100-((p.active+p.idle+p.waiting)/maxP*100)));

    document.getElementById('status').textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch(e: unknown) {
    document.getElementById('status').textContent = 'Error: ' + e.message;
  }
}

function mc(label, value) { return '<div class="metric-card"><div class="metric-value">'+value+'</div><div class="metric-label">'+label+'</div></div>'; }
function seg(cls, pct) { return '<div class="'+cls+'" style="width:'+Math.max(0,pct)+'%"></div>'; }

refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`
}
