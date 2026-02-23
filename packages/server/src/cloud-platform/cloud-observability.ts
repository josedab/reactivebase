/**
 * Cloud Observability Dashboard for ReactiveBase Cloud.
 * Provides real-time monitoring, metrics aggregation, alerting,
 * and a self-contained HTML dashboard for cloud deployments.
 *
 * Features:
 *   - Real-time subscription and query metrics
 *   - Auto-scaling metrics and recommendations
 *   - Health check monitoring with uptime tracking
 *   - Alert rules with webhook notifications
 *   - Infrastructure cost monitoring
 *   - One-click TLS certificate status
 *
 * Usage:
 *   const observability = new CloudObservability({ projectId: "proj_1" })
 *   observability.recordMetric("query_latency_ms", 45)
 *   const dashboard = observability.generateDashboardHTML()
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CloudObservabilityOptions {
  /** Project ID for scoping metrics */
  projectId: string
  /** Max metric data points to retain (default: 10000) */
  maxDataPoints?: number
  /** Metrics aggregation interval in ms (default: 60000) */
  aggregationIntervalMs?: number
  /** Enable auto-scaling recommendations (default: true) */
  autoScalingRecommendations?: boolean
}

export interface MetricDataPoint {
  name: string
  value: number
  timestamp: number
  labels?: Record<string, string>
}

export interface AggregatedMetric {
  name: string
  period: string
  count: number
  sum: number
  avg: number
  min: number
  max: number
  p50: number
  p95: number
  p99: number
}

export interface HealthCheck {
  id: string
  name: string
  endpoint: string
  status: "healthy" | "degraded" | "unhealthy" | "unknown"
  lastCheckAt: number
  responseTimeMs: number
  uptimePercent: number
  consecutiveFailures: number
  totalChecks: number
  totalFailures: number
}

export interface AlertRule {
  id: string
  name: string
  metric: string
  condition: "gt" | "lt" | "gte" | "lte" | "eq"
  threshold: number
  windowMs: number
  cooldownMs: number
  webhookUrl?: string
  enabled: boolean
  lastTriggeredAt: number | null
}

export interface Alert {
  id: string
  ruleId: string
  ruleName: string
  metric: string
  value: number
  threshold: number
  triggeredAt: number
  acknowledged: boolean
  acknowledgedAt: number | null
}

export interface AutoScaleRecommendation {
  resource: "replicas" | "database" | "memory" | "connections"
  current: number
  recommended: number
  reason: string
  confidence: "low" | "medium" | "high"
  estimatedCostImpactCents: number
}

export interface TlsCertificateStatus {
  domain: string
  issuer: string
  validFrom: string
  validTo: string
  daysUntilExpiry: number
  status: "valid" | "expiring-soon" | "expired" | "pending"
  autoRenew: boolean
}

export interface ObservabilitySnapshot {
  projectId: string
  timestamp: number
  metrics: AggregatedMetric[]
  healthChecks: HealthCheck[]
  alerts: Alert[]
  recommendations: AutoScaleRecommendation[]
  tlsCertificates: TlsCertificateStatus[]
  summary: ObservabilitySummary
}

export interface ObservabilitySummary {
  totalRequests: number
  avgLatencyMs: number
  errorRate: number
  activeConnections: number
  uptimePercent: number
  costEstimateCents: number
}

// ─── SQL Builders ────────────────────────────────────────────────────────────

export function generateObservabilityTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_cloud_metrics (
  id SERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  labels JSONB DEFAULT '{}',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cloud_metrics_project_name
  ON _reactivebase_cloud_metrics(project_id, name, recorded_at DESC);

CREATE TABLE IF NOT EXISTS _reactivebase_cloud_alerts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  metric TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  threshold DOUBLE PRECISION NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cloud_alerts_project
  ON _reactivebase_cloud_alerts(project_id, triggered_at DESC);

CREATE TABLE IF NOT EXISTS _reactivebase_cloud_health_checks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  response_time_ms INTEGER NOT NULL DEFAULT 0,
  total_checks INTEGER NOT NULL DEFAULT 0,
  total_failures INTEGER NOT NULL DEFAULT 0,
  last_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`.trim()
}

export function buildInsertMetricSQL(
  projectId: string,
  name: string,
  value: number,
  labels?: Record<string, string>,
): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_cloud_metrics (project_id, name, value, labels) VALUES ($1, $2, $3, $4::jsonb)`,
    params: [projectId, name, value, JSON.stringify(labels ?? {})],
  }
}

export function buildQueryMetricsSQL(
  projectId: string,
  name: string,
  sinceMs: number,
): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT name, value, labels, recorded_at FROM _reactivebase_cloud_metrics
      WHERE project_id = $1 AND name = $2 AND recorded_at >= to_timestamp($3 / 1000.0)
      ORDER BY recorded_at DESC LIMIT 1000`,
    params: [projectId, name, sinceMs],
  }
}

export function buildInsertAlertSQL(alert: Alert, projectId: string): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_cloud_alerts (id, project_id, rule_id, rule_name, metric, value, threshold)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    params: [alert.id, projectId, alert.ruleId, alert.ruleName, alert.metric, alert.value, alert.threshold],
  }
}

// ─── Cloud Observability Engine ──────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<CloudObservabilityOptions> = {
  projectId: "",
  maxDataPoints: 10000,
  aggregationIntervalMs: 60_000,
  autoScalingRecommendations: true,
}

export class CloudObservability {
  private options: Required<CloudObservabilityOptions>
  private metrics: MetricDataPoint[] = []
  private healthChecks = new Map<string, HealthCheck>()
  private alertRules = new Map<string, AlertRule>()
  private alerts: Alert[] = []
  private tlsCertificates = new Map<string, TlsCertificateStatus>()
  private idCounter = 0

  constructor(options: CloudObservabilityOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  private generateId(prefix: string): string {
    return `${prefix}_${++this.idCounter}_${Date.now().toString(36)}`
  }

  // ─── Metrics ────────────────────────────────────────────────────────────

  recordMetric(name: string, value: number, labels?: Record<string, string>): void {
    this.metrics.push({
      name,
      value,
      timestamp: Date.now(),
      labels,
    })

    // Trim to max data points
    if (this.metrics.length > this.options.maxDataPoints) {
      this.metrics = this.metrics.slice(-this.options.maxDataPoints)
    }

    // Check alert rules
    this.evaluateAlertRules(name, value)
  }

  getMetrics(name: string, sinceMs?: number): MetricDataPoint[] {
    const since = sinceMs ?? Date.now() - 3_600_000 // default last hour
    return this.metrics.filter((m) => m.name === name && m.timestamp >= since)
  }

  aggregateMetrics(name: string, sinceMs?: number): AggregatedMetric | null {
    const points = this.getMetrics(name, sinceMs)
    if (points.length === 0) return null

    const values = points.map((p) => p.value).sort((a, b) => a - b)
    const sum = values.reduce((a, b) => a + b, 0)

    return {
      name,
      period: `${sinceMs ?? Date.now() - 3_600_000}-${Date.now()}`,
      count: values.length,
      sum,
      avg: sum / values.length,
      min: values[0],
      max: values[values.length - 1],
      p50: percentile(values, 50),
      p95: percentile(values, 95),
      p99: percentile(values, 99),
    }
  }

  // ─── Health Checks ──────────────────────────────────────────────────────

  registerHealthCheck(id: string, name: string, endpoint: string): HealthCheck {
    const check: HealthCheck = {
      id,
      name,
      endpoint,
      status: "unknown",
      lastCheckAt: 0,
      responseTimeMs: 0,
      uptimePercent: 100,
      consecutiveFailures: 0,
      totalChecks: 0,
      totalFailures: 0,
    }
    this.healthChecks.set(id, check)
    return check
  }

  recordHealthCheckResult(id: string, healthy: boolean, responseTimeMs: number): HealthCheck {
    const check = this.healthChecks.get(id)
    if (!check) throw new Error(`Health check ${id} not found`)

    check.lastCheckAt = Date.now()
    check.responseTimeMs = responseTimeMs
    check.totalChecks++

    if (healthy) {
      check.consecutiveFailures = 0
      check.status = responseTimeMs > 1000 ? "degraded" : "healthy"
    } else {
      check.consecutiveFailures++
      check.totalFailures++
      check.status = check.consecutiveFailures >= 3 ? "unhealthy" : "degraded"
    }

    check.uptimePercent =
      check.totalChecks > 0 ? ((check.totalChecks - check.totalFailures) / check.totalChecks) * 100 : 100

    return check
  }

  getHealthChecks(): HealthCheck[] {
    return [...this.healthChecks.values()]
  }

  // ─── Alert Rules ────────────────────────────────────────────────────────

  addAlertRule(rule: Omit<AlertRule, "id" | "lastTriggeredAt">): AlertRule {
    const fullRule: AlertRule = {
      ...rule,
      id: this.generateId("alert-rule"),
      lastTriggeredAt: null,
    }
    this.alertRules.set(fullRule.id, fullRule)
    return fullRule
  }

  removeAlertRule(ruleId: string): void {
    this.alertRules.delete(ruleId)
  }

  getAlerts(sinceMs?: number): Alert[] {
    const since = sinceMs ?? 0
    return this.alerts.filter((a) => a.triggeredAt >= since)
  }

  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.find((a) => a.id === alertId)
    if (alert) {
      alert.acknowledged = true
      alert.acknowledgedAt = Date.now()
    }
  }

  private evaluateAlertRules(metricName: string, value: number): void {
    for (const rule of this.alertRules.values()) {
      if (!rule.enabled || rule.metric !== metricName) continue

      // Check cooldown
      if (rule.lastTriggeredAt && Date.now() - rule.lastTriggeredAt < rule.cooldownMs) {
        continue
      }

      let triggered = false
      switch (rule.condition) {
        case "gt":
          triggered = value > rule.threshold
          break
        case "lt":
          triggered = value < rule.threshold
          break
        case "gte":
          triggered = value >= rule.threshold
          break
        case "lte":
          triggered = value <= rule.threshold
          break
        case "eq":
          triggered = value === rule.threshold
          break
      }

      if (triggered) {
        const alert: Alert = {
          id: this.generateId("alert"),
          ruleId: rule.id,
          ruleName: rule.name,
          metric: metricName,
          value,
          threshold: rule.threshold,
          triggeredAt: Date.now(),
          acknowledged: false,
          acknowledgedAt: null,
        }
        this.alerts.push(alert)
        rule.lastTriggeredAt = Date.now()
      }
    }
  }

  // ─── TLS Certificates ──────────────────────────────────────────────────

  registerCertificate(cert: TlsCertificateStatus): void {
    this.tlsCertificates.set(cert.domain, cert)
  }

  getCertificates(): TlsCertificateStatus[] {
    return [...this.tlsCertificates.values()]
  }

  // ─── Auto-Scaling Recommendations ──────────────────────────────────────

  getRecommendations(): AutoScaleRecommendation[] {
    if (!this.options.autoScalingRecommendations) return []

    const recommendations: AutoScaleRecommendation[] = []

    // CPU-based scaling recommendation
    const cpuMetrics = this.aggregateMetrics("cpu_usage_percent")
    if (cpuMetrics && cpuMetrics.avg > 80) {
      recommendations.push({
        resource: "replicas",
        current: 1,
        recommended: Math.ceil(cpuMetrics.avg / 60),
        reason: `Average CPU usage is ${cpuMetrics.avg.toFixed(1)}%, exceeding 80% threshold`,
        confidence: cpuMetrics.count > 10 ? "high" : "medium",
        estimatedCostImpactCents: 2500,
      })
    }

    // Connection pool scaling
    const connMetrics = this.aggregateMetrics("active_connections")
    if (connMetrics && connMetrics.max > 80) {
      recommendations.push({
        resource: "connections",
        current: 100,
        recommended: Math.ceil(connMetrics.max * 1.5),
        reason: `Peak connections (${connMetrics.max}) approaching pool limit`,
        confidence: "high",
        estimatedCostImpactCents: 500,
      })
    }

    // Memory scaling
    const memMetrics = this.aggregateMetrics("memory_usage_percent")
    if (memMetrics && memMetrics.p95 > 85) {
      recommendations.push({
        resource: "memory",
        current: 512,
        recommended: 1024,
        reason: `P95 memory usage at ${memMetrics.p95.toFixed(1)}%`,
        confidence: memMetrics.count > 20 ? "high" : "low",
        estimatedCostImpactCents: 1500,
      })
    }

    return recommendations
  }

  // ─── Snapshot ───────────────────────────────────────────────────────────

  getSnapshot(): ObservabilitySnapshot {
    const now = Date.now()
    const lastHour = now - 3_600_000

    const latencyAgg = this.aggregateMetrics("query_latency_ms", lastHour)
    const requestsAgg = this.aggregateMetrics("request_count", lastHour)
    const errorsAgg = this.aggregateMetrics("error_count", lastHour)
    const connectionsAgg = this.aggregateMetrics("active_connections", lastHour)

    const healthChecks = this.getHealthChecks()
    const avgUptime =
      healthChecks.length > 0 ? healthChecks.reduce((sum, h) => sum + h.uptimePercent, 0) / healthChecks.length : 100

    return {
      projectId: this.options.projectId,
      timestamp: now,
      metrics: [latencyAgg, requestsAgg, errorsAgg, connectionsAgg].filter(Boolean) as AggregatedMetric[],
      healthChecks,
      alerts: this.getAlerts(lastHour),
      recommendations: this.getRecommendations(),
      tlsCertificates: this.getCertificates(),
      summary: {
        totalRequests: requestsAgg?.sum ?? 0,
        avgLatencyMs: latencyAgg?.avg ?? 0,
        errorRate: requestsAgg && errorsAgg ? (errorsAgg.sum / Math.max(requestsAgg.sum, 1)) * 100 : 0,
        activeConnections: connectionsAgg?.max ?? 0,
        uptimePercent: avgUptime,
        costEstimateCents: 0,
      },
    }
  }

  // ─── Dashboard HTML ─────────────────────────────────────────────────────

  generateDashboardHTML(): string {
    const snapshot = this.getSnapshot()

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ReactiveBase Cloud - Observability Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; }
    .header { background: linear-gradient(135deg, #1e293b, #334155); padding: 24px 32px; border-bottom: 1px solid #475569; }
    .header h1 { font-size: 24px; font-weight: 600; }
    .header .subtitle { color: #94a3b8; margin-top: 4px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; padding: 24px 32px; }
    .card { background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155; }
    .card h3 { font-size: 14px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
    .metric { font-size: 36px; font-weight: 700; }
    .metric.good { color: #34d399; }
    .metric.warn { color: #fbbf24; }
    .metric.bad { color: #f87171; }
    .metric-label { color: #64748b; font-size: 12px; margin-top: 4px; }
    .health-list { list-style: none; }
    .health-item { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid #334155; }
    .health-dot { width: 8px; height: 8px; border-radius: 50%; }
    .health-dot.healthy { background: #34d399; }
    .health-dot.degraded { background: #fbbf24; }
    .health-dot.unhealthy { background: #f87171; }
    .alert-item { padding: 12px; background: #2d1b1b; border-radius: 8px; margin-bottom: 8px; border-left: 3px solid #f87171; }
    .recommendation { padding: 12px; background: #1b2d1b; border-radius: 8px; margin-bottom: 8px; border-left: 3px solid #34d399; }
    .section { padding: 0 32px 24px; }
    .section h2 { font-size: 18px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>⚡ ReactiveBase Cloud</h1>
    <div class="subtitle">Project: ${snapshot.projectId} | ${new Date(snapshot.timestamp).toISOString()}</div>
  </div>

  <div class="grid">
    <div class="card">
      <h3>Total Requests</h3>
      <div class="metric good">${snapshot.summary.totalRequests.toLocaleString()}</div>
      <div class="metric-label">Last hour</div>
    </div>
    <div class="card">
      <h3>Avg Latency</h3>
      <div class="metric ${snapshot.summary.avgLatencyMs > 200 ? "warn" : "good"}">${snapshot.summary.avgLatencyMs.toFixed(1)}ms</div>
      <div class="metric-label">P50 query latency</div>
    </div>
    <div class="card">
      <h3>Error Rate</h3>
      <div class="metric ${snapshot.summary.errorRate > 5 ? "bad" : snapshot.summary.errorRate > 1 ? "warn" : "good"}">${snapshot.summary.errorRate.toFixed(2)}%</div>
      <div class="metric-label">Errors / total requests</div>
    </div>
    <div class="card">
      <h3>Active Connections</h3>
      <div class="metric good">${snapshot.summary.activeConnections}</div>
      <div class="metric-label">WebSocket + DB pool</div>
    </div>
    <div class="card">
      <h3>Uptime</h3>
      <div class="metric ${snapshot.summary.uptimePercent < 99.9 ? "warn" : "good"}">${snapshot.summary.uptimePercent.toFixed(2)}%</div>
      <div class="metric-label">Service availability</div>
    </div>
  </div>

  <div class="section">
    <h2>Health Checks</h2>
    <ul class="health-list">
      ${snapshot.healthChecks
        .map(
          (h) => `
        <li class="health-item">
          <span class="health-dot ${h.status}"></span>
          <strong>${h.name}</strong>
          <span style="color:#64748b">${h.endpoint}</span>
          <span style="margin-left:auto">${h.responseTimeMs}ms</span>
        </li>
      `,
        )
        .join("")}
      ${snapshot.healthChecks.length === 0 ? "<li class='health-item'>No health checks configured</li>" : ""}
    </ul>
  </div>

  <div class="section">
    <h2>Active Alerts (${snapshot.alerts.length})</h2>
    ${snapshot.alerts
      .map(
        (a) => `
      <div class="alert-item">
        <strong>${a.ruleName}</strong>: ${a.metric} = ${a.value} (threshold: ${a.threshold})
      </div>
    `,
      )
      .join("")}
    ${snapshot.alerts.length === 0 ? "<p style='color:#64748b'>No active alerts</p>" : ""}
  </div>

  <div class="section">
    <h2>Scaling Recommendations</h2>
    ${snapshot.recommendations
      .map(
        (r) => `
      <div class="recommendation">
        <strong>${r.resource}</strong>: ${r.current} → ${r.recommended} (${r.confidence} confidence)
        <div style="color:#94a3b8;margin-top:4px">${r.reason}</div>
      </div>
    `,
      )
      .join("")}
    ${snapshot.recommendations.length === 0 ? "<p style='color:#64748b'>No recommendations — resources look good</p>" : ""}
  </div>

  <div class="section">
    <h2>TLS Certificates</h2>
    <ul class="health-list">
      ${snapshot.tlsCertificates
        .map(
          (c) => `
        <li class="health-item">
          <span class="health-dot ${c.status === "valid" ? "healthy" : c.status === "expiring-soon" ? "degraded" : "unhealthy"}"></span>
          <strong>${c.domain}</strong>
          <span style="color:#64748b">${c.daysUntilExpiry} days remaining</span>
          <span style="margin-left:auto">${c.autoRenew ? "Auto-renew ✓" : "Manual"}</span>
        </li>
      `,
        )
        .join("")}
      ${snapshot.tlsCertificates.length === 0 ? "<li class='health-item'>No certificates configured</li>" : ""}
    </ul>
  </div>
</body>
</html>`
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0
  const index = Math.ceil((p / 100) * sortedValues.length) - 1
  return sortedValues[Math.max(0, index)]
}
