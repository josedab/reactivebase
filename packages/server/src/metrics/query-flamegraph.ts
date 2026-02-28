/**
 * Query flamegraph visualization and configurable alert rule engine
 * for ReactiveBase observability. Traces query lifecycle phases
 * (parse → plan → execute → invalidate → deliver) and provides
 * interactive HTML flamegraph rendering.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type FlamePhase = "parse" | "plan" | "execute" | "invalidate" | "deliver"

export interface FlameNode {
  phase: FlamePhase
  startTime: number
  endTime: number
  durationMs: number
  metadata?: Record<string, unknown>
  children: FlameNode[]
}

export interface FlameTrace {
  queryId: string
  queryName: string
  startTime: number
  endTime: number
  totalDurationMs: number
  nodes: FlameNode[]
}

export type AlertSeverityLevel = "info" | "warning" | "critical"

export interface AlertRuleDefinition {
  id: string
  name: string
  /** Metric key path to evaluate (e.g. "queries.p99LatencyMs") */
  metric: string
  /** Operator for comparison */
  operator: "gt" | "lt" | "gte" | "lte" | "eq"
  /** Alert fires when metric crosses this value */
  threshold: number
  /** Rolling window in ms for rate-based rules */
  windowMs?: number
  severity: AlertSeverityLevel
  /** Cooldown period in ms before the same rule can fire again */
  cooldownMs?: number
  enabled: boolean
  /** Optional description of what the rule detects */
  description?: string
}

export interface ActiveAlert {
  id: string
  ruleId: string
  ruleName: string
  severity: AlertSeverityLevel
  message: string
  value: number
  threshold: number
  firedAt: number
  acknowledged: boolean
  acknowledgedAt?: number
}

export interface AlertEvaluation {
  ruleId: string
  ruleName: string
  passed: boolean
  value: number
  threshold: number
  timestamp: number
}

// ─── QueryFlamegraph ─────────────────────────────────────────────────────────

interface ActiveTrace {
  queryId: string
  queryName: string
  startTime: number
  currentPhase?: FlamePhase
  phaseStart?: number
  nodes: FlameNode[]
}

export class QueryFlamegraph {
  private activeTraces = new Map<string, ActiveTrace>()
  private completedTraces = new Map<string, FlameTrace>()
  private tracesByName = new Map<string, FlameTrace[]>()
  private maxCompletedTraces = 1000

  /**
   * Begin tracing a query lifecycle.
   */
  startTrace(queryId: string, queryName: string): void {
    this.activeTraces.set(queryId, {
      queryId,
      queryName,
      startTime: Date.now(),
      nodes: [],
    })
  }

  /**
   * Record a lifecycle phase for an active trace.
   */
  addPhase(queryId: string, phase: FlamePhase, metadata?: Record<string, unknown>): void {
    const trace = this.activeTraces.get(queryId)
    if (!trace) return

    const now = Date.now()

    // Close previous phase if open
    if (trace.currentPhase != null && trace.phaseStart != null) {
      trace.nodes.push({
        phase: trace.currentPhase,
        startTime: trace.phaseStart,
        endTime: now,
        durationMs: now - trace.phaseStart,
        metadata: undefined,
        children: [],
      })
    }

    trace.currentPhase = phase
    trace.phaseStart = now

    // Attach metadata to be stored when phase closes
    if (metadata) {
      const pendingNode = trace.nodes[trace.nodes.length - 1]
      if (pendingNode) pendingNode.metadata = metadata
    }
  }

  /**
   * Complete and store a trace.
   */
  endTrace(queryId: string): void {
    const trace = this.activeTraces.get(queryId)
    if (!trace) return

    const now = Date.now()

    // Close last open phase
    if (trace.currentPhase != null && trace.phaseStart != null) {
      trace.nodes.push({
        phase: trace.currentPhase,
        startTime: trace.phaseStart,
        endTime: now,
        durationMs: now - trace.phaseStart,
        children: [],
      })
    }

    const completed: FlameTrace = {
      queryId: trace.queryId,
      queryName: trace.queryName,
      startTime: trace.startTime,
      endTime: now,
      totalDurationMs: now - trace.startTime,
      nodes: trace.nodes,
    }

    this.completedTraces.set(queryId, completed)
    this.activeTraces.delete(queryId)

    // Index by name for aggregation
    if (!this.tracesByName.has(trace.queryName)) {
      this.tracesByName.set(trace.queryName, [])
    }
    const nameTraces = this.tracesByName.get(trace.queryName)!
    nameTraces.push(completed)
    if (nameTraces.length > this.maxCompletedTraces) {
      nameTraces.shift()
    }

    // Bound total completed traces
    if (this.completedTraces.size > this.maxCompletedTraces) {
      const oldest = this.completedTraces.keys().next().value
      if (oldest) this.completedTraces.delete(oldest)
    }
  }

  /**
   * Return the flamegraph data for a specific query execution.
   */
  getFlameData(queryId: string): FlameTrace | undefined {
    return this.completedTraces.get(queryId)
  }

  /**
   * Generate a self-contained interactive HTML flamegraph.
   */
  generateFlameHTML(queryId: string): string | undefined {
    const trace = this.completedTraces.get(queryId)
    if (!trace) return undefined

    const phaseColors: Record<FlamePhase, string> = {
      parse: "#38bdf8",
      plan: "#a78bfa",
      execute: "#34d399",
      invalidate: "#fbbf24",
      deliver: "#f87171",
    }

    const totalMs = trace.totalDurationMs || 1
    const bars = trace.nodes
      .map((node) => {
        const widthPct = ((node.durationMs / totalMs) * 100).toFixed(2)
        const color = phaseColors[node.phase] ?? "#64748b"
        const meta = node.metadata ? ` | ${JSON.stringify(node.metadata)}` : ""
        return `<div class="bar" style="width:${widthPct}%;background:${color}" title="${node.phase}: ${node.durationMs}ms${escapeHtml(meta)}">${node.phase} (${node.durationMs}ms)</div>`
      })
      .join("\n        ")

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Flamegraph: ${escapeHtml(trace.queryName)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; background: #0f172a; color: #e2e8f0; }
    h1 { font-size: 1.25rem; margin-bottom: 4px; }
    .meta { color: #94a3b8; font-size: 0.85rem; margin-bottom: 16px; }
    .flame { display: flex; gap: 2px; height: 40px; align-items: stretch; }
    .bar { display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: #0f172a;
           font-weight: 600; border-radius: 4px; cursor: pointer; min-width: 24px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar:hover { opacity: 0.85; }
    .legend { display: flex; gap: 16px; margin-top: 16px; font-size: 0.8rem; }
    .legend-item { display: flex; align-items: center; gap: 4px; }
    .legend-color { width: 12px; height: 12px; border-radius: 2px; }
    table { margin-top: 16px; width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #334155; }
    th { color: #94a3b8; }
  </style>
</head>
<body>
  <h1>Query Flamegraph: ${escapeHtml(trace.queryName)}</h1>
  <div class="meta">ID: ${escapeHtml(trace.queryId)} | Total: ${trace.totalDurationMs}ms | ${new Date(trace.startTime).toISOString()}</div>

  <div class="flame">
    ${bars}
  </div>

  <div class="legend">
    ${Object.entries(phaseColors)
      .map(
        ([phase, color]) =>
          `<div class="legend-item"><div class="legend-color" style="background:${color}"></div>${phase}</div>`,
      )
      .join("\n    ")}
  </div>

  <table>
    <tr><th>Phase</th><th>Duration</th><th>Start</th><th>End</th></tr>
    ${trace.nodes.map((n) => `<tr><td>${n.phase}</td><td>${n.durationMs}ms</td><td>${new Date(n.startTime).toISOString()}</td><td>${new Date(n.endTime).toISOString()}</td></tr>`).join("\n    ")}
  </table>
</body>
</html>`
  }

  /**
   * Aggregate flamegraph data across multiple executions of the same query.
   */
  getAggregatedFlameData(
    queryName: string,
    timeRange?: { from: number; to: number },
  ):
    | {
        queryName: string
        executions: number
        avgDurationMs: number
        phases: Record<FlamePhase, { avgMs: number; minMs: number; maxMs: number; count: number }>
      }
    | undefined {
    const traces = this.tracesByName.get(queryName)
    if (!traces || traces.length === 0) return undefined

    const filtered = timeRange
      ? traces.filter((t) => t.startTime >= timeRange.from && t.startTime <= timeRange.to)
      : traces

    if (filtered.length === 0) return undefined

    const phaseStats = new Map<FlamePhase, { total: number; min: number; max: number; count: number }>()
    let totalDuration = 0

    for (const trace of filtered) {
      totalDuration += trace.totalDurationMs
      for (const node of trace.nodes) {
        const existing = phaseStats.get(node.phase)
        if (existing) {
          existing.total += node.durationMs
          existing.min = Math.min(existing.min, node.durationMs)
          existing.max = Math.max(existing.max, node.durationMs)
          existing.count++
        } else {
          phaseStats.set(node.phase, {
            total: node.durationMs,
            min: node.durationMs,
            max: node.durationMs,
            count: 1,
          })
        }
      }
    }

    const phases = {} as Record<FlamePhase, { avgMs: number; minMs: number; maxMs: number; count: number }>
    for (const [phase, stats] of phaseStats) {
      phases[phase] = {
        avgMs: Math.round((stats.total / stats.count) * 10) / 10,
        minMs: stats.min,
        maxMs: stats.max,
        count: stats.count,
      }
    }

    return {
      queryName,
      executions: filtered.length,
      avgDurationMs: Math.round((totalDuration / filtered.length) * 10) / 10,
      phases,
    }
  }
}

// ─── AlertRuleEngine ─────────────────────────────────────────────────────────

export class AlertRuleEngine {
  private rules = new Map<string, AlertRuleDefinition>()
  private activeAlerts = new Map<string, ActiveAlert>()
  private lastFired = new Map<string, number>()
  private alertCounter = 0

  constructor(rules?: AlertRuleDefinition[]) {
    for (const rule of rules ?? defaultAlertRules()) {
      this.rules.set(rule.id, rule)
    }
  }

  /**
   * Add or replace an alert rule.
   */
  addRule(rule: AlertRuleDefinition): void {
    this.rules.set(rule.id, rule)
  }

  /**
   * Remove an alert rule by id.
   */
  removeRule(ruleId: string): boolean {
    return this.rules.delete(ruleId)
  }

  /**
   * Get all configured rules.
   */
  getRules(): AlertRuleDefinition[] {
    return Array.from(this.rules.values())
  }

  /**
   * Evaluate all enabled rules against the given metrics.
   * Returns evaluation results and fires alerts for violations.
   */
  evaluate(metrics: Record<string, unknown>): AlertEvaluation[] {
    const results: AlertEvaluation[] = []
    const now = Date.now()

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue

      const value = resolveMetricPath(metrics, rule.metric)
      if (value === undefined) continue

      const passed = this.checkThreshold(value, rule.operator, rule.threshold)

      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        passed,
        value,
        threshold: rule.threshold,
        timestamp: now,
      })

      if (passed) {
        // Check cooldown
        const lastFiredAt = this.lastFired.get(rule.id) ?? 0
        if (rule.cooldownMs && now - lastFiredAt < rule.cooldownMs) continue

        this.alertCounter++
        const alert: ActiveAlert = {
          id: `alert-${this.alertCounter}`,
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          message: `${rule.name}: ${rule.metric} = ${value} ${rule.operator} ${rule.threshold}`,
          value,
          threshold: rule.threshold,
          firedAt: now,
          acknowledged: false,
        }
        this.activeAlerts.set(alert.id, alert)
        this.lastFired.set(rule.id, now)
      }
    }

    return results
  }

  /**
   * Return all currently active alerts.
   */
  getActiveAlerts(): ActiveAlert[] {
    return Array.from(this.activeAlerts.values())
  }

  /**
   * Acknowledge an active alert.
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.activeAlerts.get(alertId)
    if (!alert) return false
    alert.acknowledged = true
    alert.acknowledgedAt = Date.now()
    return true
  }

  /**
   * Clear all active alerts.
   */
  clearAlerts(): void {
    this.activeAlerts.clear()
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private checkThreshold(value: number, operator: AlertRuleDefinition["operator"], threshold: number): boolean {
    switch (operator) {
      case "gt":
        return value > threshold
      case "lt":
        return value < threshold
      case "gte":
        return value >= threshold
      case "lte":
        return value <= threshold
      case "eq":
        return value === threshold
    }
  }
}

// ─── Built-in Alert Rules ────────────────────────────────────────────────────

export function defaultAlertRules(): AlertRuleDefinition[] {
  return [
    {
      id: "slow-queries-p99",
      name: "Slow Queries (>P99)",
      metric: "queries.p99LatencyMs",
      operator: "gt",
      threshold: 500,
      severity: "warning",
      cooldownMs: 60_000,
      enabled: true,
      description: "Fires when P99 query latency exceeds 500ms",
    },
    {
      id: "high-invalidation-rate",
      name: "High Invalidation Rate",
      metric: "invalidations.totalInvalidations",
      operator: "gt",
      threshold: 10_000,
      severity: "warning",
      cooldownMs: 60_000,
      enabled: true,
      description: "Fires when total invalidations exceed 10,000 in the current window",
    },
    {
      id: "connection-pool-exhaustion",
      name: "Connection Pool Exhaustion",
      metric: "server.connections",
      operator: "gt",
      threshold: 950,
      severity: "critical",
      cooldownMs: 30_000,
      enabled: true,
      description: "Fires when active connections approach pool maximum",
    },
    {
      id: "high-error-rate",
      name: "High Error Rate",
      metric: "queries.totalErrors",
      operator: "gt",
      threshold: 100,
      severity: "critical",
      cooldownMs: 60_000,
      enabled: true,
      description: "Fires when query error count exceeds threshold",
    },
  ]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveMetricPath(obj: Record<string, unknown>, path: string): number | undefined {
  const parts = path.split(".")
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === "number" ? current : undefined
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
