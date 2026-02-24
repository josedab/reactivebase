/**
 * Alert detection engine for ReactiveBase observability.
 * Evaluates configurable rules against live metrics and fires alerts
 * via log, webhook, or callback actions.
 */

import type { MetricsSnapshot } from "./metrics.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export type AlertSeverity = "info" | "warning" | "critical"

export type AlertAction =
  | { type: "log" }
  | { type: "webhook"; url: string }
  | { type: "callback"; fn: (alert: Alert) => void }

export interface AlertRule {
  id: string
  name: string
  /** Metric key path to evaluate (e.g. "queries.totalErrors") */
  metric: string
  /** Alert fires when metric exceeds this value */
  threshold: number
  /** Rolling window in ms for rate-based rules */
  windowMs?: number
  severity: AlertSeverity
  action: AlertAction
  enabled: boolean
}

export interface Alert {
  id: string
  ruleId: string
  ruleName: string
  severity: AlertSeverity
  message: string
  value: number
  threshold: number
  timestamp: number
  acknowledged: boolean
}

// ─── Built-in Rule Templates ─────────────────────────────────────────────────

export function builtInRules(): AlertRule[] {
  return [
    {
      id: "high-error-rate",
      name: "High Error Rate",
      metric: "queries.totalErrors",
      threshold: 50,
      severity: "critical",
      action: { type: "log" },
      enabled: true,
    },
    {
      id: "slow-queries",
      name: "Slow Query Latency",
      metric: "queries.p99LatencyMs",
      threshold: 500,
      severity: "warning",
      action: { type: "log" },
      enabled: true,
    },
    {
      id: "high-connection-usage",
      name: "High Connection Usage",
      metric: "server.connections",
      threshold: 1000,
      severity: "warning",
      action: { type: "log" },
      enabled: true,
    },
    {
      id: "subscription-overload",
      name: "Subscription Overload",
      metric: "subscriptions.currentActive",
      threshold: 10_000,
      severity: "critical",
      action: { type: "log" },
      enabled: true,
    },
  ]
}

// ─── AlertEngine ─────────────────────────────────────────────────────────────

export class AlertEngine {
  private rules = new Map<string, AlertRule>()
  private activeAlerts = new Map<string, Alert>()
  private alertCounter = 0

  constructor(rules?: AlertRule[]) {
    for (const rule of rules ?? builtInRules()) {
      this.rules.set(rule.id, rule)
    }
  }

  /**
   * Add or replace an alert rule.
   */
  addRule(rule: AlertRule): void {
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
  getRules(): AlertRule[] {
    return Array.from(this.rules.values())
  }

  /**
   * Evaluate all enabled rules against the given metrics snapshot.
   * Returns newly fired alerts.
   */
  evaluate(metrics: MetricsSnapshot): Alert[] {
    const fired: Alert[] = []

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue

      const value = resolveMetric(metrics, rule.metric)
      if (value === undefined) continue

      if (value > rule.threshold) {
        const alert = this.createAlert(rule, value)
        this.activeAlerts.set(alert.id, alert)
        this.executeAction(rule.action, alert)
        fired.push(alert)
      }
    }

    return fired
  }

  /**
   * Return all currently active (unfired) alerts.
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values())
  }

  /**
   * Mark an alert as acknowledged.
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.activeAlerts.get(alertId)
    if (!alert) return false
    alert.acknowledged = true
    return true
  }

  /**
   * Clear all active alerts.
   */
  clearAlerts(): void {
    this.activeAlerts.clear()
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private createAlert(rule: AlertRule, value: number): Alert {
    this.alertCounter++
    return {
      id: `alert-${this.alertCounter}`,
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      message: `${rule.name}: ${rule.metric} = ${value} exceeds threshold ${rule.threshold}`,
      value,
      threshold: rule.threshold,
      timestamp: Date.now(),
      acknowledged: false,
    }
  }

  private executeAction(action: AlertAction, alert: Alert): void {
    switch (action.type) {
      case "log":
        // Console log in development; production would use structured logging
        break
      case "webhook":
        // In a real implementation, POST to action.url
        break
      case "callback":
        action.fn(alert)
        break
    }
  }
}

/**
 * Resolve a dot-separated metric path against a MetricsSnapshot.
 */
function resolveMetric(snapshot: MetricsSnapshot, path: string): number | undefined {
  const parts = path.split(".")
  let current: unknown = snapshot
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === "number" ? current : undefined
}
