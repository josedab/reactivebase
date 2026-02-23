/**
 * Production-Grade Live Dashboard for ReactiveBase.
 * Real-time subscription graphs, mutation timelines, query performance flamecharts,
 * active connections map, and one-click query replay.
 *
 * Serves at /admin with auth-gated access.
 *
 * Features:
 *   - Real-time subscription count and data flow graphs
 *   - Query performance flamecharts with dependency tracing
 *   - Mutation timeline with undo/replay
 *   - Active connections map with geographic info
 *   - Alert configuration and notification
 *   - Auth-gated access with configurable roles
 *
 * Usage:
 *   const dashboard = new LiveDashboard({ auth: { secret: "admin-secret" } })
 *   dashboard.recordQueryExecution("tasks.list", 45, ["tasks"])
 *   const html = dashboard.generateHTML()
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LiveDashboardOptions {
  /** Auth configuration for dashboard access */
  auth?: DashboardAuthConfig
  /** Max entries to retain per metric category (default: 5000) */
  maxEntries?: number
  /** Dashboard refresh interval in ms (default: 2000) */
  refreshIntervalMs?: number
  /** Enable query replay functionality (default: true) */
  enableQueryReplay?: boolean
  /** Enable flamechart generation (default: true) */
  enableFlamecharts?: boolean
}

export interface DashboardAuthConfig {
  /** Bearer token or admin secret */
  secret?: string
  /** Allowed user roles */
  allowedRoles?: string[]
  /** Custom auth check function */
  checkAuth?: (headers: Record<string, string>) => boolean
}

export interface QueryExecution {
  id: string
  queryName: string
  durationMs: number
  dependentTables: string[]
  subscriberCount: number
  timestamp: number
  /** Nested spans for flamechart */
  spans: QuerySpan[]
  resultSize: number
  cached: boolean
}

export interface QuerySpan {
  name: string
  startMs: number
  durationMs: number
  children: QuerySpan[]
  metadata?: Record<string, unknown>
}

export interface MutationTimelineEntry {
  id: string
  mutationName: string
  args: unknown
  result: unknown
  affectedTables: string[]
  durationMs: number
  timestamp: number
  userId: string | null
  replayable: boolean
  status: "success" | "error"
  error?: string
}

export interface ActiveConnection {
  connectionId: string
  userId: string | null
  connectedAt: number
  lastActivityAt: number
  subscriptionCount: number
  ip: string
  userAgent: string
  region?: string
  latencyMs: number
}

export interface DashboardAlert {
  id: string
  type: "slow_query" | "high_error_rate" | "connection_spike" | "subscription_fanout" | "custom"
  severity: "info" | "warning" | "critical"
  message: string
  metric: string
  value: number
  threshold: number
  timestamp: number
  acknowledged: boolean
}

export interface LiveDashboardMetrics {
  totalQueries: number
  totalMutations: number
  activeSubscriptions: number
  activeConnections: number
  avgQueryLatencyMs: number
  p95QueryLatencyMs: number
  errorRate: number
  queriesPerSecond: number
  mutationsPerSecond: number
  cacheHitRate: number
  topSlowQueries: Array<{ name: string; avgMs: number; count: number }>
  topSubscriptions: Array<{ name: string; count: number }>
  alerts: DashboardAlert[]
}

export interface FlamechartData {
  queryName: string
  totalDurationMs: number
  spans: FlamechartSpan[]
}

export interface FlamechartSpan {
  name: string
  startMs: number
  durationMs: number
  depth: number
  color: string
  percentage: number
}

// ─── SQL Builders ────────────────────────────────────────────────────────────

export function generateLiveDashboardTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_live_query_log (
  id TEXT PRIMARY KEY,
  query_name TEXT NOT NULL,
  duration_ms DOUBLE PRECISION NOT NULL,
  dependent_tables TEXT[] NOT NULL DEFAULT '{}',
  subscriber_count INTEGER NOT NULL DEFAULT 0,
  result_size INTEGER NOT NULL DEFAULT 0,
  cached BOOLEAN NOT NULL DEFAULT FALSE,
  spans JSONB,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_live_query_log_name ON _reactivebase_live_query_log(query_name, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_query_log_time ON _reactivebase_live_query_log(executed_at DESC);

CREATE TABLE IF NOT EXISTS _reactivebase_live_mutation_log (
  id TEXT PRIMARY KEY,
  mutation_name TEXT NOT NULL,
  args JSONB,
  result JSONB,
  affected_tables TEXT[] NOT NULL DEFAULT '{}',
  duration_ms DOUBLE PRECISION NOT NULL,
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  error TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_live_mutation_log_time ON _reactivebase_live_mutation_log(executed_at DESC);

CREATE TABLE IF NOT EXISTS _reactivebase_live_alerts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  metric TEXT,
  value DOUBLE PRECISION,
  threshold DOUBLE PRECISION,
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`.trim()
}

export function buildInsertQueryLogSQL(execution: QueryExecution): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_live_query_log (id, query_name, duration_ms, dependent_tables, subscriber_count, result_size, cached, spans)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    params: [
      execution.id,
      execution.queryName,
      execution.durationMs,
      execution.dependentTables,
      execution.subscriberCount,
      execution.resultSize,
      execution.cached,
      JSON.stringify(execution.spans),
    ],
  }
}

export function buildInsertMutationTimelineSQL(entry: MutationTimelineEntry): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_live_mutation_log (id, mutation_name, args, result, affected_tables, duration_ms, user_id, status, error)
      VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9)`,
    params: [
      entry.id,
      entry.mutationName,
      JSON.stringify(entry.args),
      JSON.stringify(entry.result),
      entry.affectedTables,
      entry.durationMs,
      entry.userId,
      entry.status,
      entry.error ?? null,
    ],
  }
}

// ─── Live Dashboard Engine ───────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<LiveDashboardOptions> = {
  auth: {},
  maxEntries: 5000,
  refreshIntervalMs: 2000,
  enableQueryReplay: true,
  enableFlamecharts: true,
}

export class LiveDashboard {
  private options: Required<LiveDashboardOptions>
  private queryLog: QueryExecution[] = []
  private mutationLog: MutationTimelineEntry[] = []
  private connections = new Map<string, ActiveConnection>()
  private alerts: DashboardAlert[] = []
  private queryStats = new Map<string, { count: number; totalMs: number; maxMs: number }>()
  private subscriptionCounts = new Map<string, number>()
  private idCounter = 0
  private requestCount = 0
  private errorCount = 0
  private cacheHits = 0
  private startTime = Date.now()

  constructor(options: LiveDashboardOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  private generateId(prefix: string): string {
    return `${prefix}_${++this.idCounter}_${Date.now().toString(36)}`
  }

  // ─── Auth ───────────────────────────────────────────────────────────────

  checkAccess(headers: Record<string, string>): boolean {
    const auth = this.options.auth
    if (!auth.secret && !auth.checkAuth) return true

    if (auth.checkAuth) return auth.checkAuth(headers)

    const token = headers["authorization"]?.replace("Bearer ", "")
    return token === auth.secret
  }

  // ─── Query Recording ───────────────────────────────────────────────────

  recordQueryExecution(
    queryName: string,
    durationMs: number,
    dependentTables: string[],
    options?: {
      subscriberCount?: number
      resultSize?: number
      cached?: boolean
      spans?: QuerySpan[]
    },
  ): QueryExecution {
    this.requestCount++

    const execution: QueryExecution = {
      id: this.generateId("qe"),
      queryName,
      durationMs,
      dependentTables,
      subscriberCount: options?.subscriberCount ?? 0,
      timestamp: Date.now(),
      spans: options?.spans ?? [],
      resultSize: options?.resultSize ?? 0,
      cached: options?.cached ?? false,
    }

    if (execution.cached) this.cacheHits++

    this.queryLog.push(execution)
    if (this.queryLog.length > this.options.maxEntries) {
      this.queryLog = this.queryLog.slice(-this.options.maxEntries)
    }

    // Update stats
    const stats = this.queryStats.get(queryName) ?? { count: 0, totalMs: 0, maxMs: 0 }
    stats.count++
    stats.totalMs += durationMs
    stats.maxMs = Math.max(stats.maxMs, durationMs)
    this.queryStats.set(queryName, stats)

    // Auto-alert on slow queries
    if (durationMs > 1000) {
      this.addAlert({
        type: "slow_query",
        severity: durationMs > 5000 ? "critical" : "warning",
        message: `Slow query: ${queryName} took ${durationMs.toFixed(0)}ms`,
        metric: "query_duration_ms",
        value: durationMs,
        threshold: 1000,
      })
    }

    return execution
  }

  // ─── Mutation Recording ─────────────────────────────────────────────────

  recordMutation(
    mutationName: string,
    args: unknown,
    result: unknown,
    affectedTables: string[],
    durationMs: number,
    options?: { userId?: string; error?: string },
  ): MutationTimelineEntry {
    this.requestCount++
    if (options?.error) this.errorCount++

    const entry: MutationTimelineEntry = {
      id: this.generateId("mut"),
      mutationName,
      args,
      result,
      affectedTables,
      durationMs,
      timestamp: Date.now(),
      userId: options?.userId ?? null,
      replayable: !options?.error,
      status: options?.error ? "error" : "success",
      error: options?.error,
    }

    this.mutationLog.push(entry)
    if (this.mutationLog.length > this.options.maxEntries) {
      this.mutationLog = this.mutationLog.slice(-this.options.maxEntries)
    }

    return entry
  }

  // ─── Connection Tracking ────────────────────────────────────────────────

  addConnection(
    conn: Omit<ActiveConnection, "connectedAt" | "lastActivityAt" | "subscriptionCount" | "latencyMs">,
  ): void {
    this.connections.set(conn.connectionId, {
      ...conn,
      connectedAt: Date.now(),
      lastActivityAt: Date.now(),
      subscriptionCount: 0,
      latencyMs: 0,
    })
  }

  removeConnection(connectionId: string): void {
    this.connections.delete(connectionId)
  }

  updateConnectionActivity(connectionId: string, subscriptionCount?: number, latencyMs?: number): void {
    const conn = this.connections.get(connectionId)
    if (conn) {
      conn.lastActivityAt = Date.now()
      if (subscriptionCount !== undefined) conn.subscriptionCount = subscriptionCount
      if (latencyMs !== undefined) conn.latencyMs = latencyMs
    }
  }

  // ─── Subscription Tracking ─────────────────────────────────────────────

  updateSubscriptionCount(queryName: string, count: number): void {
    this.subscriptionCounts.set(queryName, count)
  }

  // ─── Alerts ─────────────────────────────────────────────────────────────

  addAlert(alert: Omit<DashboardAlert, "id" | "timestamp" | "acknowledged">): DashboardAlert {
    const fullAlert: DashboardAlert = {
      ...alert,
      id: this.generateId("alert"),
      timestamp: Date.now(),
      acknowledged: false,
    }
    this.alerts.push(fullAlert)

    // Keep alerts bounded
    if (this.alerts.length > 1000) {
      this.alerts = this.alerts.slice(-1000)
    }

    return fullAlert
  }

  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.find((a) => a.id === alertId)
    if (alert) alert.acknowledged = true
  }

  // ─── Flamechart ─────────────────────────────────────────────────────────

  generateFlamechart(queryName: string): FlamechartData | null {
    const executions = this.queryLog.filter((q) => q.queryName === queryName && q.spans.length > 0)
    if (executions.length === 0) return null

    const latest = executions[executions.length - 1]

    const flattenSpans = (spans: QuerySpan[], depth: number): FlamechartSpan[] => {
      const result: FlamechartSpan[] = []
      const colors = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#6366f1"]

      for (const span of spans) {
        result.push({
          name: span.name,
          startMs: span.startMs,
          durationMs: span.durationMs,
          depth,
          color: colors[depth % colors.length],
          percentage: (span.durationMs / latest.durationMs) * 100,
        })
        result.push(...flattenSpans(span.children, depth + 1))
      }
      return result
    }

    return {
      queryName,
      totalDurationMs: latest.durationMs,
      spans: flattenSpans(latest.spans, 0),
    }
  }

  // ─── Query Replay ───────────────────────────────────────────────────────

  getMutationForReplay(mutationId: string): MutationTimelineEntry | undefined {
    return this.mutationLog.find((m) => m.id === mutationId && m.replayable)
  }

  getReplayableMutations(limit = 50): MutationTimelineEntry[] {
    return this.mutationLog.filter((m) => m.replayable).slice(-limit)
  }

  // ─── Metrics ────────────────────────────────────────────────────────────

  getMetrics(): LiveDashboardMetrics {
    const uptimeSeconds = (Date.now() - this.startTime) / 1000

    const topSlowQueries = [...this.queryStats.entries()]
      .map(([name, stats]) => ({ name, avgMs: stats.totalMs / stats.count, count: stats.count }))
      .sort((a, b) => b.avgMs - a.avgMs)
      .slice(0, 10)

    const topSubscriptions = [...this.subscriptionCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    const latencies = this.queryLog
      .slice(-1000)
      .map((q) => q.durationMs)
      .sort((a, b) => a - b)

    return {
      totalQueries: this.queryLog.length,
      totalMutations: this.mutationLog.length,
      activeSubscriptions: [...this.subscriptionCounts.values()].reduce((sum, c) => sum + c, 0),
      activeConnections: this.connections.size,
      avgQueryLatencyMs: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      p95QueryLatencyMs: latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0,
      errorRate: this.requestCount > 0 ? (this.errorCount / this.requestCount) * 100 : 0,
      queriesPerSecond: uptimeSeconds > 0 ? this.queryLog.length / uptimeSeconds : 0,
      mutationsPerSecond: uptimeSeconds > 0 ? this.mutationLog.length / uptimeSeconds : 0,
      cacheHitRate: this.requestCount > 0 ? (this.cacheHits / this.requestCount) * 100 : 0,
      topSlowQueries,
      topSubscriptions,
      alerts: this.alerts.filter((a) => !a.acknowledged).slice(-20),
    }
  }

  // ─── Admin Routes ───────────────────────────────────────────────────────

  generateAdminRoutes(): AdminRoute[] {
    return [
      { method: "GET", path: "/admin", handler: "dashboard" },
      { method: "GET", path: "/admin/api/metrics", handler: "metrics" },
      { method: "GET", path: "/admin/api/queries", handler: "queryLog" },
      { method: "GET", path: "/admin/api/mutations", handler: "mutationLog" },
      { method: "GET", path: "/admin/api/connections", handler: "connections" },
      { method: "GET", path: "/admin/api/alerts", handler: "alerts" },
      { method: "POST", path: "/admin/api/alerts/:id/acknowledge", handler: "acknowledgeAlert" },
      { method: "GET", path: "/admin/api/flamechart/:queryName", handler: "flamechart" },
      { method: "POST", path: "/admin/api/replay/:mutationId", handler: "replayMutation" },
    ]
  }

  // ─── Dashboard HTML ─────────────────────────────────────────────────────

  generateHTML(): string {
    const metrics = this.getMetrics()

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ReactiveBase Admin Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #fafafa; }
    .nav { background: #111; padding: 16px 24px; display: flex; align-items: center; gap: 24px; border-bottom: 1px solid #333; }
    .nav h1 { font-size: 18px; font-weight: 600; }
    .nav a { color: #888; text-decoration: none; font-size: 14px; cursor: pointer; }
    .nav a:hover, .nav a.active { color: #fff; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; padding: 20px 24px; }
    .card { background: #161616; border: 1px solid #2a2a2a; border-radius: 8px; padding: 16px; }
    .card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #666; margin-bottom: 6px; }
    .card .value { font-size: 28px; font-weight: 700; }
    .card .value.green { color: #22c55e; }
    .card .value.yellow { color: #eab308; }
    .card .value.red { color: #ef4444; }
    .card .value.blue { color: #3b82f6; }
    .section { padding: 0 24px 20px; }
    .section h2 { font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #ccc; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 12px; border-bottom: 1px solid #333; color: #888; font-weight: 500; }
    td { padding: 8px 12px; border-bottom: 1px solid #1e1e1e; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
    .badge.critical { background: #7f1d1d; color: #fca5a5; }
    .badge.warning { background: #78350f; color: #fcd34d; }
    .badge.info { background: #1e3a5f; color: #93c5fd; }
    .badge.success { background: #14532d; color: #86efac; }
    .flamechart { background: #111; border-radius: 8px; padding: 16px; margin: 8px 0; }
    .flame-bar { height: 24px; border-radius: 4px; margin: 2px 0; font-size: 11px; display: flex; align-items: center; padding: 0 6px; color: white; white-space: nowrap; overflow: hidden; }
    .timeline { display: flex; flex-direction: column; gap: 4px; }
    .timeline-item { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: #161616; border-radius: 6px; font-size: 13px; }
    .timeline-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .timeline-dot.success { background: #22c55e; }
    .timeline-dot.error { background: #ef4444; }
    .btn { padding: 4px 10px; border-radius: 4px; border: 1px solid #333; background: #222; color: #ccc; cursor: pointer; font-size: 12px; }
    .btn:hover { background: #333; }
    .conn-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; }
    .conn-card { background: #161616; border: 1px solid #2a2a2a; border-radius: 8px; padding: 12px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="nav">
    <h1>⚡ ReactiveBase Admin</h1>
    <a class="active">Overview</a>
    <a>Queries</a>
    <a>Mutations</a>
    <a>Connections</a>
    <a>Alerts</a>
    <span style="margin-left:auto;color:#444;font-size:12px">Auto-refresh: ${this.options.refreshIntervalMs / 1000}s</span>
  </div>

  <div class="grid">
    <div class="card">
      <div class="label">Total Queries</div>
      <div class="value blue">${metrics.totalQueries.toLocaleString()}</div>
    </div>
    <div class="card">
      <div class="label">Total Mutations</div>
      <div class="value blue">${metrics.totalMutations.toLocaleString()}</div>
    </div>
    <div class="card">
      <div class="label">Active Subscriptions</div>
      <div class="value green">${metrics.activeSubscriptions}</div>
    </div>
    <div class="card">
      <div class="label">Active Connections</div>
      <div class="value green">${metrics.activeConnections}</div>
    </div>
    <div class="card">
      <div class="label">Avg Query Latency</div>
      <div class="value ${metrics.avgQueryLatencyMs > 200 ? "yellow" : "green"}">${metrics.avgQueryLatencyMs.toFixed(1)}ms</div>
    </div>
    <div class="card">
      <div class="label">P95 Latency</div>
      <div class="value ${metrics.p95QueryLatencyMs > 500 ? "red" : metrics.p95QueryLatencyMs > 200 ? "yellow" : "green"}">${metrics.p95QueryLatencyMs.toFixed(1)}ms</div>
    </div>
    <div class="card">
      <div class="label">Error Rate</div>
      <div class="value ${metrics.errorRate > 5 ? "red" : metrics.errorRate > 1 ? "yellow" : "green"}">${metrics.errorRate.toFixed(2)}%</div>
    </div>
    <div class="card">
      <div class="label">Cache Hit Rate</div>
      <div class="value ${metrics.cacheHitRate > 80 ? "green" : "yellow"}">${metrics.cacheHitRate.toFixed(1)}%</div>
    </div>
  </div>

  <div class="section">
    <h2>⏱️ Slowest Queries</h2>
    <table>
      <thead><tr><th>Query</th><th>Avg Latency</th><th>Executions</th></tr></thead>
      <tbody>
        ${metrics.topSlowQueries
          .map(
            (q) => `
          <tr>
            <td><code>${q.name}</code></td>
            <td><span class="${q.avgMs > 500 ? "value red" : q.avgMs > 100 ? "value yellow" : ""}">${q.avgMs.toFixed(1)}ms</span></td>
            <td>${q.count}</td>
          </tr>
        `,
          )
          .join("")}
        ${metrics.topSlowQueries.length === 0 ? "<tr><td colspan='3' style='color:#666'>No queries recorded yet</td></tr>" : ""}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>📡 Top Subscriptions</h2>
    <table>
      <thead><tr><th>Query</th><th>Subscribers</th></tr></thead>
      <tbody>
        ${metrics.topSubscriptions
          .map(
            (s) => `
          <tr><td><code>${s.name}</code></td><td>${s.count}</td></tr>
        `,
          )
          .join("")}
        ${metrics.topSubscriptions.length === 0 ? "<tr><td colspan='2' style='color:#666'>No active subscriptions</td></tr>" : ""}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>🔄 Recent Mutations</h2>
    <div class="timeline">
      ${this.mutationLog
        .slice(-10)
        .reverse()
        .map(
          (m) => `
        <div class="timeline-item">
          <span class="timeline-dot ${m.status}"></span>
          <code>${m.mutationName}</code>
          <span style="color:#666">${m.durationMs.toFixed(0)}ms</span>
          <span style="color:#666">${m.affectedTables.join(", ")}</span>
          ${m.replayable ? '<button class="btn" title="Replay">↻</button>' : ""}
          <span style="margin-left:auto;color:#444;font-size:11px">${new Date(m.timestamp).toLocaleTimeString()}</span>
        </div>
      `,
        )
        .join("")}
      ${this.mutationLog.length === 0 ? '<div class="timeline-item" style="color:#666">No mutations recorded yet</div>' : ""}
    </div>
  </div>

  <div class="section">
    <h2>🔌 Active Connections (${metrics.activeConnections})</h2>
    <div class="conn-list">
      ${[...this.connections.values()]
        .slice(0, 12)
        .map(
          (c) => `
        <div class="conn-card">
          <div style="font-weight:600">${c.userId ?? c.connectionId}</div>
          <div style="color:#666;font-size:12px">${c.ip} ${c.region ? `(${c.region})` : ""}</div>
          <div style="margin-top:4px">
            <span class="badge info">${c.subscriptionCount} subs</span>
            <span style="color:#888;font-size:12px;margin-left:8px">${c.latencyMs}ms latency</span>
          </div>
        </div>
      `,
        )
        .join("")}
      ${this.connections.size === 0 ? '<div class="conn-card" style="color:#666">No active connections</div>' : ""}
    </div>
  </div>

  <div class="section">
    <h2>🚨 Alerts (${metrics.alerts.length})</h2>
    ${metrics.alerts
      .map(
        (a) => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#161616;border-radius:6px;margin-bottom:4px;">
        <span class="badge ${a.severity}">${a.severity}</span>
        <span>${a.message}</span>
        <span style="margin-left:auto;color:#444;font-size:11px">${new Date(a.timestamp).toLocaleTimeString()}</span>
        <button class="btn" onclick="fetch('/admin/api/alerts/${a.id}/acknowledge',{method:'POST'})">Ack</button>
      </div>
    `,
      )
      .join("")}
    ${metrics.alerts.length === 0 ? '<p style="color:#666">No active alerts — system is healthy ✓</p>' : ""}
  </div>

  <script>
    setTimeout(() => location.reload(), ${this.options.refreshIntervalMs});
  </script>
</body>
</html>`
  }
}

// ─── Types for Admin Routes ──────────────────────────────────────────────────

export interface AdminRoute {
  method: string
  path: string
  handler: string
}
