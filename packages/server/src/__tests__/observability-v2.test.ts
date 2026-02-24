import { describe, it, expect, vi } from "vitest"
import { OtelInstrumentation, createAutoInstrumentedTracer } from "../metrics/otel-instrumentation.js"
import { RealtimeDashboard } from "../metrics/realtime-dashboard.js"
import { AlertEngine, builtInRules } from "../metrics/alert-engine.js"
import { MetricsCollector } from "../metrics/metrics.js"
import { NoopTracer, ConsoleTracer } from "../metrics/tracing.js"
import type { MetricsSnapshot } from "../metrics/metrics.js"
import type { Alert } from "../metrics/alert-engine.js"

// ─── OtelInstrumentation ────────────────────────────────────────────────────

describe("OtelInstrumentation", () => {
  it("instruments a query and returns result + duration", async () => {
    const inst = new OtelInstrumentation(new NoopTracer())
    const { result, durationMs } = await inst.instrumentQuery("tasks.list", async () => [1, 2, 3])
    expect(result).toEqual([1, 2, 3])
    expect(durationMs).toBeGreaterThanOrEqual(0)
  })

  it("instruments a mutation and returns result + duration", async () => {
    const inst = new OtelInstrumentation(new NoopTracer())
    const { result } = await inst.instrumentMutation("tasks.create", async () => ({ id: 1 }))
    expect(result).toEqual({ id: 1 })
  })

  it("instruments an action and returns result + duration", async () => {
    const inst = new OtelInstrumentation(new NoopTracer())
    const { result } = await inst.instrumentAction("sendEmail", async () => "sent")
    expect(result).toBe("sent")
  })

  it("propagates errors from instrumented functions", async () => {
    const inst = new OtelInstrumentation(new NoopTracer())
    await expect(
      inst.instrumentQuery("failing", async () => {
        throw new Error("db error")
      }),
    ).rejects.toThrow("db error")
  })

  it("creates spans with ConsoleTracer", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const inst = new OtelInstrumentation(new ConsoleTracer())
    await inst.instrumentQuery("tasks.list", async () => "ok")
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it("tracks subscription lifecycle", () => {
    const inst = new OtelInstrumentation(new NoopTracer())
    const sub = inst.instrumentSubscription("tasks.onChange")
    expect(sub.span).toBeDefined()
    const duration = sub.dispose()
    expect(duration).toBeGreaterThanOrEqual(0)
  })

  it("instruments connection pool", () => {
    const inst = new OtelInstrumentation(new NoopTracer())
    expect(inst.getConnectionPoolMetrics()).toBeNull()
    const pool = { totalCount: 10, activeCount: 5, idleCount: 4, waitingCount: 1 }
    inst.instrumentConnectionPool(pool)
    expect(inst.getConnectionPoolMetrics()).toEqual(pool)
  })

  it("respects sample rate of 0", async () => {
    const tracer = new ConsoleTracer()
    const spy = vi.spyOn(tracer, "startSpan")
    const inst = new OtelInstrumentation(tracer, { tracesSampleRate: 0 })
    await inst.instrumentQuery("tasks.list", async () => "ok")
    expect(spy).not.toHaveBeenCalled()
  })

  it("exposes config", () => {
    const inst = new OtelInstrumentation(new NoopTracer(), {
      serviceName: "myapp",
      endpoint: "http://localhost:4318",
    })
    const cfg = inst.getConfig()
    expect(cfg.serviceName).toBe("myapp")
    expect(cfg.endpoint).toBe("http://localhost:4318")
    expect(cfg.tracesSampleRate).toBe(1.0)
    expect(cfg.metricsInterval).toBe(60_000)
  })
})

describe("createAutoInstrumentedTracer", () => {
  it("creates an instrumentation instance with defaults", () => {
    const inst = createAutoInstrumentedTracer()
    expect(inst).toBeInstanceOf(OtelInstrumentation)
    inst.stopMetricsExport()
  })

  it("accepts a custom tracer", () => {
    const tracer = new ConsoleTracer()
    const inst = createAutoInstrumentedTracer({ serviceName: "test" }, tracer)
    expect(inst.getConfig().serviceName).toBe("test")
    inst.stopMetricsExport()
  })
})

// ─── RealtimeDashboard ──────────────────────────────────────────────────────

describe("RealtimeDashboard", () => {
  function createDashboard(): RealtimeDashboard {
    const collector = new MetricsCollector()
    collector.recordQuery("tasks.list", 15)
    collector.recordQuery("tasks.list", 25)
    collector.recordMutation("tasks.create", 10)
    collector.recordSubscription("created")
    return new RealtimeDashboard(collector)
  }

  it("returns current metrics snapshot", () => {
    const dash = createDashboard()
    const metrics = dash.getMetrics()
    expect(metrics.queries.totalExecuted).toBe(2)
    expect(metrics.mutations.totalExecuted).toBe(1)
    expect(metrics.subscriptions.currentActive).toBe(1)
  })

  it("tracks and filters slow queries", () => {
    const dash = createDashboard()
    dash.recordSlowQuery({ query: "tasks.list", duration: 50, timestamp: Date.now() })
    dash.recordSlowQuery({ query: "tasks.get", duration: 200, timestamp: Date.now(), explainPlanSummary: "seq scan" })
    dash.recordSlowQuery({ query: "users.list", duration: 10, timestamp: Date.now() })

    const slow = dash.getSlowQueries(100)
    expect(slow).toHaveLength(1)
    expect(slow[0].query).toBe("tasks.get")
    expect(slow[0].explainPlanSummary).toBe("seq scan")
  })

  it("tracks subscription heatmap", () => {
    const dash = createDashboard()
    dash.recordSubscriptionActivity("tasks", "tasks.onChange", 2.5)
    dash.recordSubscriptionActivity("tasks", "tasks.onChange", 3.5)
    dash.recordSubscriptionActivity("users", "users.onUpdate", 1.0)

    const heatmap = dash.getSubscriptionHeatmap()
    expect(heatmap).toHaveLength(2)

    const tasksEntry = heatmap.find((h) => h.table === "tasks")!
    expect(tasksEntry.count).toBe(2)
    expect(tasksEntry.avgUpdateFrequency).toBe(3.0)
  })

  it("tracks connection pool status", () => {
    const dash = createDashboard()
    dash.setConnectionPoolStatus({ total: 20, active: 8, idle: 10, waiting: 2, maxSize: 20 })
    const pool = dash.getConnectionPoolStatus()
    expect(pool.active).toBe(8)
    expect(pool.idle).toBe(10)
    expect(pool.maxSize).toBe(20)
  })

  it("tracks error breakdown", () => {
    const dash = createDashboard()
    dash.recordError("TypeError", "tasks.list")
    dash.recordError("TypeError", "tasks.list")
    dash.recordError("NotFoundError", "users.get")

    const errors = dash.getErrorBreakdown()
    expect(errors).toHaveLength(2)
    expect(errors.find((e) => e.type === "TypeError")!.count).toBe(2)
  })

  it("generates HTML dashboard", () => {
    const dash = createDashboard()
    dash.recordSlowQuery({ query: "tasks.list", duration: 300, timestamp: Date.now() })
    dash.recordSubscriptionActivity("tasks", "tasks.onChange", 1.0)
    dash.recordError("Error", "tasks.create")

    const html = dash.generateDashboardHTML()
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("ReactiveBase")
    expect(html).toContain('meta http-equiv="refresh"')
    expect(html).toContain("setTimeout")
    expect(html).toContain("Query Latency")
    expect(html).toContain("Active Subscriptions")
    expect(html).toContain("Connection Pool")
    expect(html).toContain("Slow Queries")
    expect(html).toContain("Subscription Heatmap")
    expect(html).toContain("Errors")
  })

  it("escapes HTML in dashboard output", () => {
    const dash = createDashboard()
    dash.recordSlowQuery({ query: "<script>alert(1)</script>", duration: 300, timestamp: Date.now() })
    const html = dash.generateDashboardHTML()
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })
})

// ─── AlertEngine ─────────────────────────────────────────────────────────────

describe("AlertEngine", () => {
  function makeSnapshot(overrides: Partial<MetricsSnapshot> = {}): MetricsSnapshot {
    return {
      server: { connections: 5, activeSubscriptions: 20, pendingJobs: 0 },
      queries: {
        totalExecuted: 100,
        totalErrors: 2,
        avgLatencyMs: 5,
        p99LatencyMs: 45,
        byFunction: {},
      },
      mutations: {
        totalExecuted: 30,
        totalErrors: 0,
        totalRetries: 0,
        avgLatencyMs: 10,
        p99LatencyMs: 50,
        byFunction: {},
      },
      subscriptions: { totalCreated: 50, totalRemoved: 30, currentActive: 20, avgPerConnection: 4 },
      invalidations: {
        totalEvaluations: 10,
        totalInvalidated: 5,
        totalSkipped: 5,
        avgEvaluationTimeMs: 2,
        falseInvalidationRate: 0.5,
      },
      uptime: 60000,
      ...overrides,
    }
  }

  it("initializes with built-in rules", () => {
    const engine = new AlertEngine()
    const rules = engine.getRules()
    expect(rules.length).toBe(4)
    expect(rules.map((r) => r.id)).toContain("high-error-rate")
    expect(rules.map((r) => r.id)).toContain("slow-queries")
    expect(rules.map((r) => r.id)).toContain("high-connection-usage")
    expect(rules.map((r) => r.id)).toContain("subscription-overload")
  })

  it("evaluates rules and fires alerts when thresholds exceeded", () => {
    const engine = new AlertEngine()
    const snapshot = makeSnapshot({
      queries: { totalExecuted: 1000, totalErrors: 100, avgLatencyMs: 50, p99LatencyMs: 800, byFunction: {} },
    })

    const alerts = engine.evaluate(snapshot)
    expect(alerts.length).toBeGreaterThanOrEqual(2)

    const errorAlert = alerts.find((a) => a.ruleId === "high-error-rate")
    expect(errorAlert).toBeDefined()
    expect(errorAlert!.value).toBe(100)

    const slowAlert = alerts.find((a) => a.ruleId === "slow-queries")
    expect(slowAlert).toBeDefined()
    expect(slowAlert!.value).toBe(800)
  })

  it("does not fire alerts when under threshold", () => {
    const engine = new AlertEngine()
    const snapshot = makeSnapshot()
    const alerts = engine.evaluate(snapshot)
    expect(alerts).toHaveLength(0)
  })

  it("supports adding and removing rules", () => {
    const engine = new AlertEngine([])
    expect(engine.getRules()).toHaveLength(0)

    engine.addRule({
      id: "custom",
      name: "Custom Rule",
      metric: "server.connections",
      threshold: 2,
      severity: "info",
      action: { type: "log" },
      enabled: true,
    })
    expect(engine.getRules()).toHaveLength(1)

    engine.removeRule("custom")
    expect(engine.getRules()).toHaveLength(0)
  })

  it("fires callback actions", () => {
    const fired: Alert[] = []
    const engine = new AlertEngine([
      {
        id: "cb-test",
        name: "Callback Test",
        metric: "server.connections",
        threshold: 1,
        severity: "warning",
        action: { type: "callback", fn: (alert) => fired.push(alert) },
        enabled: true,
      },
    ])

    engine.evaluate(makeSnapshot())
    expect(fired).toHaveLength(1)
    expect(fired[0].ruleId).toBe("cb-test")
  })

  it("tracks active alerts and supports acknowledgement", () => {
    const engine = new AlertEngine([
      {
        id: "test",
        name: "Test",
        metric: "server.connections",
        threshold: 1,
        severity: "info",
        action: { type: "log" },
        enabled: true,
      },
    ])

    engine.evaluate(makeSnapshot())
    const active = engine.getActiveAlerts()
    expect(active).toHaveLength(1)
    expect(active[0].acknowledged).toBe(false)

    const acked = engine.acknowledgeAlert(active[0].id)
    expect(acked).toBe(true)
    expect(engine.getActiveAlerts()[0].acknowledged).toBe(true)
  })

  it("returns false when acknowledging non-existent alert", () => {
    const engine = new AlertEngine([])
    expect(engine.acknowledgeAlert("nonexistent")).toBe(false)
  })

  it("clears all active alerts", () => {
    const engine = new AlertEngine([
      {
        id: "test",
        name: "Test",
        metric: "server.connections",
        threshold: 1,
        severity: "info",
        action: { type: "log" },
        enabled: true,
      },
    ])

    engine.evaluate(makeSnapshot())
    expect(engine.getActiveAlerts().length).toBeGreaterThan(0)

    engine.clearAlerts()
    expect(engine.getActiveAlerts()).toHaveLength(0)
  })

  it("skips disabled rules", () => {
    const engine = new AlertEngine([
      {
        id: "disabled",
        name: "Disabled",
        metric: "server.connections",
        threshold: 1,
        severity: "info",
        action: { type: "log" },
        enabled: false,
      },
    ])

    const alerts = engine.evaluate(makeSnapshot())
    expect(alerts).toHaveLength(0)
  })

  it("builtInRules returns expected set", () => {
    const rules = builtInRules()
    expect(rules.length).toBe(4)
    expect(rules.every((r) => r.enabled)).toBe(true)
  })
})
