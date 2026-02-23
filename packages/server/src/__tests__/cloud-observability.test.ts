import { describe, it, expect, beforeEach } from "vitest"
import { CloudObservability, generateObservabilityTableSQL } from "../cloud-platform/cloud-observability.js"

describe("CloudObservability", () => {
  let obs: CloudObservability

  beforeEach(() => {
    obs = new CloudObservability({ projectId: "proj-1" })
  })

  describe("metrics recording", () => {
    it("records and retrieves metrics", () => {
      obs.recordMetric("query_latency_ms", 42)
      obs.recordMetric("query_latency_ms", 55)
      const metrics = obs.getMetrics("query_latency_ms", 0)
      expect(metrics).toHaveLength(2)
      expect(metrics[0].value).toBe(42)
    })

    it("aggregates metrics with percentiles", () => {
      for (let i = 1; i <= 100; i++) obs.recordMetric("latency", i)
      const agg = obs.aggregateMetrics("latency", 0)
      expect(agg).not.toBeNull()
      expect(agg!.count).toBe(100)
      expect(agg!.min).toBe(1)
      expect(agg!.max).toBe(100)
      expect(agg!.avg).toBeCloseTo(50.5)
      expect(agg!.p95).toBeGreaterThanOrEqual(95)
    })

    it("returns null for unknown metric", () => {
      expect(obs.aggregateMetrics("nonexistent")).toBeNull()
    })

    it("trims metrics beyond maxDataPoints", () => {
      const small = new CloudObservability({ projectId: "p", maxDataPoints: 10 })
      for (let i = 0; i < 20; i++) small.recordMetric("x", i)
      expect(small.getMetrics("x", 0).length).toBeLessThanOrEqual(10)
    })
  })

  describe("health checks", () => {
    it("registers and records health checks", () => {
      obs.registerHealthCheck("hc-1", "API", "/health")
      obs.recordHealthCheckResult("hc-1", true, 50)
      const checks = obs.getHealthChecks()
      expect(checks).toHaveLength(1)
      expect(checks[0].status).toBe("healthy")
      expect(checks[0].uptimePercent).toBe(100)
    })

    it("marks degraded on high latency", () => {
      obs.registerHealthCheck("hc-1", "API", "/health")
      obs.recordHealthCheckResult("hc-1", true, 1500)
      expect(obs.getHealthChecks()[0].status).toBe("degraded")
    })

    it("marks unhealthy after consecutive failures", () => {
      obs.registerHealthCheck("hc-1", "API", "/health")
      obs.recordHealthCheckResult("hc-1", false, 0)
      obs.recordHealthCheckResult("hc-1", false, 0)
      obs.recordHealthCheckResult("hc-1", false, 0)
      expect(obs.getHealthChecks()[0].status).toBe("unhealthy")
      expect(obs.getHealthChecks()[0].uptimePercent).toBe(0)
    })

    it("throws on unknown health check", () => {
      expect(() => obs.recordHealthCheckResult("bad", true, 0)).toThrow()
    })
  })

  describe("alert rules", () => {
    it("triggers alerts when threshold exceeded", () => {
      obs.addAlertRule({
        name: "High latency",
        metric: "latency",
        condition: "gt",
        threshold: 100,
        windowMs: 60000,
        cooldownMs: 0,
        enabled: true,
      })
      obs.recordMetric("latency", 200)
      const alerts = obs.getAlerts(0)
      expect(alerts).toHaveLength(1)
      expect(alerts[0].ruleName).toBe("High latency")
      expect(alerts[0].value).toBe(200)
    })

    it("respects cooldown period", () => {
      obs.addAlertRule({
        name: "High latency",
        metric: "latency",
        condition: "gt",
        threshold: 100,
        windowMs: 60000,
        cooldownMs: 999999,
        enabled: true,
      })
      obs.recordMetric("latency", 200)
      obs.recordMetric("latency", 300)
      expect(obs.getAlerts(0)).toHaveLength(1) // second should be suppressed
    })

    it("does not trigger disabled rules", () => {
      obs.addAlertRule({
        name: "Disabled",
        metric: "latency",
        condition: "gt",
        threshold: 0,
        windowMs: 60000,
        cooldownMs: 0,
        enabled: false,
      })
      obs.recordMetric("latency", 999)
      expect(obs.getAlerts(0)).toHaveLength(0)
    })

    it("acknowledges alerts", () => {
      obs.addAlertRule({
        name: "Test",
        metric: "x",
        condition: "gt",
        threshold: 0,
        windowMs: 60000,
        cooldownMs: 0,
        enabled: true,
      })
      obs.recordMetric("x", 1)
      const alerts = obs.getAlerts(0)
      obs.acknowledgeAlert(alerts[0].id)
      expect(obs.getAlerts(0)[0].acknowledged).toBe(true)
    })
  })

  describe("TLS certificates", () => {
    it("registers and retrieves certificates", () => {
      obs.registerCertificate({
        domain: "example.com",
        issuer: "Let's Encrypt",
        validFrom: "2024-01-01",
        validTo: "2025-01-01",
        daysUntilExpiry: 365,
        status: "valid",
        autoRenew: true,
      })
      expect(obs.getCertificates()).toHaveLength(1)
      expect(obs.getCertificates()[0].domain).toBe("example.com")
    })
  })

  describe("snapshot", () => {
    it("produces a complete snapshot", () => {
      obs.recordMetric("query_latency_ms", 50)
      obs.registerHealthCheck("hc-1", "API", "/health")
      obs.recordHealthCheckResult("hc-1", true, 30)

      const snapshot = obs.getSnapshot()
      expect(snapshot.projectId).toBe("proj-1")
      expect(snapshot.healthChecks).toHaveLength(1)
      expect(snapshot.summary.uptimePercent).toBe(100)
    })
  })

  describe("dashboard HTML", () => {
    it("generates valid HTML", () => {
      const html = obs.generateDashboardHTML()
      expect(html).toContain("<!DOCTYPE html>")
      expect(html).toContain("ReactiveBase Cloud")
      expect(html).toContain("proj-1")
    })
  })

  describe("SQL builders", () => {
    it("generates observability table SQL", () => {
      const sql = generateObservabilityTableSQL()
      expect(sql).toContain("_reactivebase_cloud_metrics")
      expect(sql).toContain("_reactivebase_cloud_alerts")
    })
  })
})
