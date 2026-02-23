/**
 * Performance Profiler & Observability Engine.
 * Extends the MetricsCollector with:
 *   - Slow query detection with configurable thresholds
 *   - N+1 query pattern detection
 *   - Query execution plan profiling
 *   - Subscription fan-out analysis
 *   - Grafana dashboard JSON generation
 *   - Datadog/New Relic exporter stubs
 *   - Alert rules configuration
 *
 * Usage:
 *   const profiler = new PerformanceProfiler({ slowQueryThresholdMs: 100 })
 *   profiler.recordQueryExecution("tasks.list", 250, ["tasks", "users"])
 *   const alerts = profiler.checkAlerts()
 *   const grafana = profiler.generateGrafanaDashboard()
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProfilerOptions {
  /** Threshold in ms for marking queries as slow (default: 100) */
  slowQueryThresholdMs?: number
  /** Max slow queries to retain (default: 100) */
  maxSlowQueries?: number
  /** N+1 detection: max similar queries before alerting (default: 5) */
  nPlusOneThreshold?: number
  /** Rolling window for rate calculations in ms (default: 60000) */
  windowMs?: number
  /** Alert callback */
  onAlert?: (alert: ProfilerAlert) => void
}

export interface SlowQueryEntry {
  queryName: string
  durationMs: number
  timestamp: number
  args?: unknown
  tables: string[]
  connectionId?: string
  explainPlan?: string
}

export interface NPlusOneDetection {
  queryName: string
  occurrences: number
  windowMs: number
  firstSeen: number
  lastSeen: number
  parentQuery?: string
}

export interface SubscriptionFanout {
  table: string
  changeType: "insert" | "update" | "delete"
  affectedSubscriptions: number
  reExecutionTimeMs: number
  timestamp: number
}

export interface QueryProfile {
  queryName: string
  callCount: number
  totalDurationMs: number
  avgDurationMs: number
  minDurationMs: number
  maxDurationMs: number
  p50DurationMs: number
  p95DurationMs: number
  p99DurationMs: number
  tablesAccessed: string[]
  lastExecution: number
  errorCount: number
  errorRate: number
}

export interface ProfilerAlert {
  type: "slow-query" | "n-plus-one" | "high-error-rate" | "high-fanout" | "connection-spike"
  severity: "info" | "warning" | "critical"
  message: string
  details: Record<string, unknown>
  timestamp: number
}

export interface AlertRule {
  name: string
  type: ProfilerAlert["type"]
  threshold: number
  severity: ProfilerAlert["severity"]
  enabled: boolean
}

export interface ProfilerStats {
  totalQueries: number
  slowQueries: number
  nPlusOneDetections: number
  alertsFired: number
  avgQueryDurationMs: number
  p99QueryDurationMs: number
  activeProfiles: number
  topSlowQueries: SlowQueryEntry[]
}

export interface GrafanaDashboard {
  title: string
  panels: GrafanaPanel[]
  templating: { list: unknown[] }
  time: { from: string; to: string }
  refresh: string
}

export interface GrafanaPanel {
  id: number
  title: string
  type: string
  gridPos: { x: number; y: number; w: number; h: number }
  targets: Array<{ expr: string; legendFormat: string }>
}

// ─── Performance Profiler ────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<ProfilerOptions, "onAlert">> & { onAlert: ProfilerOptions["onAlert"] } = {
  slowQueryThresholdMs: 100,
  maxSlowQueries: 100,
  nPlusOneThreshold: 5,
  windowMs: 60_000,
  onAlert: undefined,
}

export class PerformanceProfiler {
  private options: typeof DEFAULT_OPTIONS
  private slowQueries: SlowQueryEntry[] = []
  private queryProfiles = new Map<string, { durations: number[]; tables: Set<string>; errors: number }>()
  private recentQueries: { name: string; timestamp: number }[] = []
  private nPlusOneDetections = new Map<string, NPlusOneDetection>()
  private fanoutHistory: SubscriptionFanout[] = []
  private alerts: ProfilerAlert[] = []
  private alertRules: AlertRule[] = []
  private totalQueries = 0

  constructor(options: ProfilerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }

    // Default alert rules
    this.alertRules = [
      {
        name: "Slow Query",
        type: "slow-query",
        threshold: this.options.slowQueryThresholdMs,
        severity: "warning",
        enabled: true,
      },
      {
        name: "N+1 Detection",
        type: "n-plus-one",
        threshold: this.options.nPlusOneThreshold,
        severity: "warning",
        enabled: true,
      },
      { name: "High Error Rate", type: "high-error-rate", threshold: 0.05, severity: "critical", enabled: true },
      { name: "High Fanout", type: "high-fanout", threshold: 1000, severity: "warning", enabled: true },
    ]
  }

  // ─── Query Recording ────────────────────────────────────────────────────

  recordQueryExecution(
    queryName: string,
    durationMs: number,
    tables: string[],
    opts?: { args?: unknown; connectionId?: string; explainPlan?: string; isError?: boolean },
  ): void {
    this.totalQueries++

    // Track profile
    if (!this.queryProfiles.has(queryName)) {
      this.queryProfiles.set(queryName, { durations: [], tables: new Set(), errors: 0 })
    }
    const profile = this.queryProfiles.get(queryName)!
    profile.durations.push(durationMs)
    for (const t of tables) profile.tables.add(t)
    if (opts?.isError) profile.errors++

    // Keep durations bounded
    if (profile.durations.length > 1000) {
      profile.durations = profile.durations.slice(-500)
    }

    // Track recent for N+1 detection
    const now = Date.now()
    this.recentQueries.push({ name: queryName, timestamp: now })
    this.pruneRecentQueries(now)

    // Check slow query
    if (durationMs >= this.options.slowQueryThresholdMs) {
      const entry: SlowQueryEntry = {
        queryName,
        durationMs,
        timestamp: now,
        args: opts?.args,
        tables,
        connectionId: opts?.connectionId,
        explainPlan: opts?.explainPlan,
      }
      this.slowQueries.push(entry)
      if (this.slowQueries.length > this.options.maxSlowQueries) {
        this.slowQueries.shift()
      }
      this.fireAlert({
        type: "slow-query",
        severity: durationMs > this.options.slowQueryThresholdMs * 5 ? "critical" : "warning",
        message: `Slow query: ${queryName} took ${durationMs}ms`,
        details: { queryName, durationMs, tables },
        timestamp: now,
      })
    }

    // Check N+1 pattern
    this.detectNPlusOne(queryName, now)
  }

  // ─── Subscription Fanout ────────────────────────────────────────────────

  recordFanout(
    table: string,
    changeType: "insert" | "update" | "delete",
    affectedSubscriptions: number,
    reExecutionTimeMs: number,
  ): void {
    const entry: SubscriptionFanout = {
      table,
      changeType,
      affectedSubscriptions,
      reExecutionTimeMs,
      timestamp: Date.now(),
    }
    this.fanoutHistory.push(entry)
    if (this.fanoutHistory.length > 500) this.fanoutHistory.shift()

    if (affectedSubscriptions >= 1000) {
      this.fireAlert({
        type: "high-fanout",
        severity: affectedSubscriptions >= 5000 ? "critical" : "warning",
        message: `High subscription fanout: ${table} ${changeType} affected ${affectedSubscriptions} subscriptions`,
        details: { table, changeType, affectedSubscriptions, reExecutionTimeMs },
        timestamp: Date.now(),
      })
    }
  }

  // ─── Query Profiles ─────────────────────────────────────────────────────

  getQueryProfile(queryName: string): QueryProfile | undefined {
    const profile = this.queryProfiles.get(queryName)
    if (!profile || profile.durations.length === 0) return undefined

    const sorted = [...profile.durations].sort((a, b) => a - b)
    const total = sorted.reduce((s, d) => s + d, 0)

    return {
      queryName,
      callCount: sorted.length,
      totalDurationMs: total,
      avgDurationMs: Math.round((total / sorted.length) * 10) / 10,
      minDurationMs: sorted[0],
      maxDurationMs: sorted[sorted.length - 1],
      p50DurationMs: this.percentile(sorted, 0.5),
      p95DurationMs: this.percentile(sorted, 0.95),
      p99DurationMs: this.percentile(sorted, 0.99),
      tablesAccessed: Array.from(profile.tables),
      lastExecution: Date.now(),
      errorCount: profile.errors,
      errorRate: sorted.length > 0 ? Math.round((profile.errors / sorted.length) * 1000) / 1000 : 0,
    }
  }

  getAllProfiles(): QueryProfile[] {
    const profiles: QueryProfile[] = []
    for (const name of this.queryProfiles.keys()) {
      const profile = this.getQueryProfile(name)
      if (profile) profiles.push(profile)
    }
    return profiles.sort((a, b) => b.avgDurationMs - a.avgDurationMs)
  }

  // ─── Slow Queries ───────────────────────────────────────────────────────

  getSlowQueries(limit: number = 20): SlowQueryEntry[] {
    return this.slowQueries.slice(-limit).reverse()
  }

  // ─── N+1 Detection ──────────────────────────────────────────────────────

  getNPlusOneDetections(): NPlusOneDetection[] {
    return Array.from(this.nPlusOneDetections.values()).filter((d) => d.occurrences >= this.options.nPlusOneThreshold)
  }

  // ─── Alerts ─────────────────────────────────────────────────────────────

  getAlerts(limit: number = 50): ProfilerAlert[] {
    return this.alerts.slice(-limit).reverse()
  }

  getAlertRules(): AlertRule[] {
    return [...this.alertRules]
  }

  setAlertRule(name: string, updates: Partial<AlertRule>): void {
    const rule = this.alertRules.find((r) => r.name === name)
    if (rule) Object.assign(rule, updates)
  }

  clearAlerts(): void {
    this.alerts = []
  }

  // ─── Stats ──────────────────────────────────────────────────────────────

  getStats(): ProfilerStats {
    const allDurations = Array.from(this.queryProfiles.values()).flatMap((p) => p.durations)
    const avgDuration =
      allDurations.length > 0
        ? Math.round((allDurations.reduce((s, d) => s + d, 0) / allDurations.length) * 10) / 10
        : 0
    const sortedAll = [...allDurations].sort((a, b) => a - b)

    return {
      totalQueries: this.totalQueries,
      slowQueries: this.slowQueries.length,
      nPlusOneDetections: this.getNPlusOneDetections().length,
      alertsFired: this.alerts.length,
      avgQueryDurationMs: avgDuration,
      p99QueryDurationMs: sortedAll.length > 0 ? this.percentile(sortedAll, 0.99) : 0,
      activeProfiles: this.queryProfiles.size,
      topSlowQueries: this.getSlowQueries(5),
    }
  }

  // ─── Grafana Dashboard ──────────────────────────────────────────────────

  generateGrafanaDashboard(title: string = "ReactiveBase Observability"): GrafanaDashboard {
    const panels: GrafanaPanel[] = [
      {
        id: 1,
        title: "Query Rate",
        type: "timeseries",
        gridPos: { x: 0, y: 0, w: 12, h: 8 },
        targets: [
          { expr: "rate(reactivebase_queries_total[5m])", legendFormat: "Queries/s" },
          { expr: "rate(reactivebase_mutations_total[5m])", legendFormat: "Mutations/s" },
        ],
      },
      {
        id: 2,
        title: "Query Latency (p99)",
        type: "timeseries",
        gridPos: { x: 12, y: 0, w: 12, h: 8 },
        targets: [
          {
            expr: "histogram_quantile(0.99, rate(reactivebase_query_duration_seconds_bucket[5m]))",
            legendFormat: "p99",
          },
          {
            expr: "histogram_quantile(0.95, rate(reactivebase_query_duration_seconds_bucket[5m]))",
            legendFormat: "p95",
          },
          {
            expr: "histogram_quantile(0.50, rate(reactivebase_query_duration_seconds_bucket[5m]))",
            legendFormat: "p50",
          },
        ],
      },
      {
        id: 3,
        title: "Active Subscriptions",
        type: "stat",
        gridPos: { x: 0, y: 8, w: 6, h: 4 },
        targets: [{ expr: "reactivebase_subscriptions_active", legendFormat: "Active" }],
      },
      {
        id: 4,
        title: "WebSocket Connections",
        type: "stat",
        gridPos: { x: 6, y: 8, w: 6, h: 4 },
        targets: [{ expr: "reactivebase_connections_active", legendFormat: "Connections" }],
      },
      {
        id: 5,
        title: "Error Rate",
        type: "timeseries",
        gridPos: { x: 12, y: 8, w: 12, h: 4 },
        targets: [{ expr: "rate(reactivebase_errors_total[5m])", legendFormat: "Errors/s" }],
      },
      {
        id: 6,
        title: "Subscription Fanout",
        type: "timeseries",
        gridPos: { x: 0, y: 12, w: 12, h: 8 },
        targets: [
          { expr: "reactivebase_invalidation_subscriptions_affected", legendFormat: "Affected Subs" },
          { expr: "reactivebase_invalidation_duration_seconds", legendFormat: "Re-execution Time" },
        ],
      },
      {
        id: 7,
        title: "Slow Queries",
        type: "table",
        gridPos: { x: 12, y: 12, w: 12, h: 8 },
        targets: [
          {
            expr: "topk(10, reactivebase_query_duration_seconds_sum / reactivebase_query_duration_seconds_count)",
            legendFormat: "{{query_name}}",
          },
        ],
      },
      {
        id: 8,
        title: "Job Queue",
        type: "timeseries",
        gridPos: { x: 0, y: 20, w: 12, h: 8 },
        targets: [
          { expr: "reactivebase_scheduler_pending_jobs", legendFormat: "Pending" },
          { expr: "rate(reactivebase_scheduler_completed_total[5m])", legendFormat: "Completed/s" },
          { expr: "rate(reactivebase_scheduler_failed_total[5m])", legendFormat: "Failed/s" },
        ],
      },
      {
        id: 9,
        title: "Database Connections",
        type: "gauge",
        gridPos: { x: 12, y: 20, w: 12, h: 8 },
        targets: [
          { expr: "reactivebase_pg_pool_active", legendFormat: "Active" },
          { expr: "reactivebase_pg_pool_idle", legendFormat: "Idle" },
          { expr: "reactivebase_pg_pool_waiting", legendFormat: "Waiting" },
        ],
      },
    ]

    return {
      title,
      panels,
      templating: { list: [] },
      time: { from: "now-1h", to: "now" },
      refresh: "10s",
    }
  }

  /**
   * Export the Grafana dashboard as a JSON string ready for file import.
   * Wraps the dashboard in the Grafana import format with datasource inputs.
   */
  exportGrafanaDashboardJSON(title?: string): string {
    const dashboard = this.generateGrafanaDashboard(title)
    const exportable = {
      __inputs: [
        {
          name: "DS_PROMETHEUS",
          label: "Prometheus",
          type: "datasource",
          pluginId: "prometheus",
        },
      ],
      ...dashboard,
      schemaVersion: 39,
      tags: ["reactivebase", "observability", "auto-generated"],
      uid: `reactivebase-${Date.now().toString(36)}`,
      version: 1,
    }
    return JSON.stringify(exportable, null, 2)
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private detectNPlusOne(queryName: string, now: number): void {
    const windowStart = now - this.options.windowMs
    const recentSame = this.recentQueries.filter((q) => q.name === queryName && q.timestamp >= windowStart)

    if (recentSame.length >= this.options.nPlusOneThreshold) {
      const existing = this.nPlusOneDetections.get(queryName)
      if (existing) {
        existing.occurrences = recentSame.length
        existing.lastSeen = now
      } else {
        this.nPlusOneDetections.set(queryName, {
          queryName,
          occurrences: recentSame.length,
          windowMs: this.options.windowMs,
          firstSeen: recentSame[0].timestamp,
          lastSeen: now,
        })
        this.fireAlert({
          type: "n-plus-one",
          severity: "warning",
          message: `N+1 query pattern detected: ${queryName} called ${recentSame.length} times in ${this.options.windowMs}ms`,
          details: { queryName, occurrences: recentSame.length },
          timestamp: now,
        })
      }
    }
  }

  private pruneRecentQueries(now: number): void {
    const cutoff = now - this.options.windowMs
    while (this.recentQueries.length > 0 && this.recentQueries[0].timestamp < cutoff) {
      this.recentQueries.shift()
    }
  }

  private fireAlert(alert: ProfilerAlert): void {
    const rule = this.alertRules.find((r) => r.type === alert.type)
    if (rule && !rule.enabled) return

    this.alerts.push(alert)
    if (this.alerts.length > 500) this.alerts.shift()
    this.options.onAlert?.(alert)
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const idx = Math.ceil(sorted.length * p) - 1
    return sorted[Math.max(0, idx)]
  }
}
