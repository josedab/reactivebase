/**
 * Real-time metrics dashboard for ReactiveBase.
 * Aggregates data from MetricsCollector and PerformanceProfiler
 * and serves a single-page HTML dashboard at /dashboard.
 */

import type { MetricsSnapshot } from "./metrics.js"
import type { MetricsCollector } from "./metrics.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SlowQueryEntry {
  query: string
  duration: number
  timestamp: number
  explainPlanSummary?: string
}

export interface SubscriptionHeatmapEntry {
  table: string
  functionName: string
  count: number
  avgUpdateFrequency: number
}

export interface ConnectionPoolMetrics {
  total: number
  active: number
  idle: number
  waiting: number
  maxSize: number
}

export interface ErrorBreakdownEntry {
  type: string
  functionName: string
  count: number
  lastOccurrence: number
}

// ─── RealtimeDashboard ───────────────────────────────────────────────────────

export class RealtimeDashboard {
  private collector: MetricsCollector
  private slowQueryLog: SlowQueryEntry[] = []
  private heatmapEntries = new Map<string, SubscriptionHeatmapEntry>()
  private poolMetrics: ConnectionPoolMetrics = { total: 0, active: 0, idle: 0, waiting: 0, maxSize: 50 }
  private errorLog: ErrorBreakdownEntry[] = []
  private maxSlowQueries = 200

  constructor(collector: MetricsCollector) {
    this.collector = collector
  }

  /**
   * Return the current metrics snapshot from the collector.
   */
  getMetrics(): MetricsSnapshot {
    return this.collector.getSnapshot()
  }

  /**
   * Return queries exceeding the given latency threshold.
   */
  getSlowQueries(threshold: number): SlowQueryEntry[] {
    return this.slowQueryLog.filter((e) => e.duration >= threshold)
  }

  /**
   * Record a slow query entry.
   */
  recordSlowQuery(entry: SlowQueryEntry): void {
    this.slowQueryLog.push(entry)
    if (this.slowQueryLog.length > this.maxSlowQueries) {
      this.slowQueryLog.shift()
    }
  }

  /**
   * Return subscription distribution by table/function.
   */
  getSubscriptionHeatmap(): SubscriptionHeatmapEntry[] {
    return Array.from(this.heatmapEntries.values())
  }

  /**
   * Record or update a subscription heatmap entry.
   */
  recordSubscriptionActivity(table: string, functionName: string, updateFrequency: number): void {
    const key = `${table}:${functionName}`
    const existing = this.heatmapEntries.get(key)
    if (existing) {
      existing.count++
      existing.avgUpdateFrequency =
        (existing.avgUpdateFrequency * (existing.count - 1) + updateFrequency) / existing.count
    } else {
      this.heatmapEntries.set(key, { table, functionName, count: 1, avgUpdateFrequency: updateFrequency })
    }
  }

  /**
   * Return current connection pool utilization metrics.
   */
  getConnectionPoolStatus(): ConnectionPoolMetrics {
    return { ...this.poolMetrics }
  }

  /**
   * Update connection pool metrics.
   */
  setConnectionPoolStatus(metrics: ConnectionPoolMetrics): void {
    this.poolMetrics = { ...metrics }
  }

  /**
   * Return errors grouped by type and function.
   */
  getErrorBreakdown(): ErrorBreakdownEntry[] {
    return [...this.errorLog]
  }

  /**
   * Record an error occurrence.
   */
  recordError(type: string, functionName: string): void {
    const existing = this.errorLog.find((e) => e.type === type && e.functionName === functionName)
    if (existing) {
      existing.count++
      existing.lastOccurrence = Date.now()
    } else {
      this.errorLog.push({ type, functionName, count: 1, lastOccurrence: Date.now() })
    }
  }

  /**
   * Generate a self-contained HTML dashboard page.
   */
  generateDashboardHTML(): string {
    const snapshot = this.getMetrics()
    const slowQueries = this.slowQueryLog.slice(-10).reverse()
    const heatmap = this.getSubscriptionHeatmap()
    const pool = this.poolMetrics
    const errors = this.errorLog.slice(-10)

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="5">
  <title>ReactiveBase Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; background: #0f172a; color: #e2e8f0; }
    h1 { font-size: 1.5rem; margin-bottom: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .card { background: #1e293b; border-radius: 8px; padding: 16px; }
    .card h2 { font-size: 1rem; margin: 0 0 8px; color: #94a3b8; }
    .metric { font-size: 2rem; font-weight: 700; color: #38bdf8; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #334155; }
    th { color: #94a3b8; }
    .gauge-bar { height: 12px; border-radius: 6px; background: #334155; overflow: hidden; margin-top: 4px; }
    .gauge-fill { height: 100%; border-radius: 6px; background: #38bdf8; }
  </style>
</head>
<body>
  <h1>ReactiveBase Observability Dashboard</h1>
  <div class="grid">
    <div class="card">
      <h2>Query Latency</h2>
      <div class="metric">${snapshot.queries.avgLatencyMs.toFixed(1)} ms</div>
      <div>p99: ${snapshot.queries.p99LatencyMs.toFixed(1)} ms</div>
    </div>
    <div class="card">
      <h2>Active Subscriptions</h2>
      <div class="metric">${snapshot.subscriptions.currentActive}</div>
      <div>Created: ${snapshot.subscriptions.totalCreated} / Removed: ${snapshot.subscriptions.totalRemoved}</div>
    </div>
    <div class="card">
      <h2>Error Rate</h2>
      <div class="metric">${snapshot.queries.totalErrors + snapshot.mutations.totalErrors}</div>
      <div>Queries: ${snapshot.queries.totalErrors} / Mutations: ${snapshot.mutations.totalErrors}</div>
    </div>
    <div class="card">
      <h2>Connection Pool</h2>
      <div class="metric">${pool.active} / ${pool.maxSize}</div>
      <div class="gauge-bar"><div class="gauge-fill" style="width:${pool.maxSize > 0 ? Math.round((pool.active / pool.maxSize) * 100) : 0}%"></div></div>
      <div>Idle: ${pool.idle} / Waiting: ${pool.waiting}</div>
    </div>
  </div>

  <div class="grid" style="margin-top:16px">
    <div class="card">
      <h2>Slow Queries</h2>
      <table>
        <tr><th>Query</th><th>Duration</th><th>Explain</th></tr>
        ${slowQueries.map((q) => `<tr><td>${escapeHtml(q.query)}</td><td>${q.duration}ms</td><td>${escapeHtml(q.explainPlanSummary ?? "-")}</td></tr>`).join("")}
      </table>
    </div>
    <div class="card">
      <h2>Subscription Heatmap</h2>
      <table>
        <tr><th>Table</th><th>Function</th><th>Count</th><th>Avg Freq</th></tr>
        ${heatmap.map((h) => `<tr><td>${escapeHtml(h.table)}</td><td>${escapeHtml(h.functionName)}</td><td>${h.count}</td><td>${h.avgUpdateFrequency.toFixed(1)}/s</td></tr>`).join("")}
      </table>
    </div>
    <div class="card">
      <h2>Errors</h2>
      <table>
        <tr><th>Type</th><th>Function</th><th>Count</th></tr>
        ${errors.map((e) => `<tr><td>${escapeHtml(e.type)}</td><td>${escapeHtml(e.functionName)}</td><td>${e.count}</td></tr>`).join("")}
      </table>
    </div>
  </div>

  <script>setTimeout(() => location.reload(), 5000);</script>
</body>
</html>`
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
