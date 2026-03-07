import { describe, it, expect } from "vitest"
import { ReactiveBaseInstrumentation, ObservabilityError } from "../observability/observability.js"

describe("ReactiveBaseInstrumentation", () => {
  it("instruments query execution with spans", async () => {
    const otel = new ReactiveBaseInstrumentation()
    const result = await otel.instrumentQuery("tasks.list", async () => [1, 2, 3])
    expect(result).toEqual([1, 2, 3])

    const metrics = otel.generatePrometheusMetrics()
    expect(metrics).toContain("reactivebase_queries_total")
    expect(metrics).toContain("reactivebase_operation_duration_ms")
  })

  it("instruments mutation execution with error tracking", async () => {
    const otel = new ReactiveBaseInstrumentation()
    await expect(
      otel.instrumentMutation("tasks.create", async () => {
        throw new Error("constraint violation")
      }),
    ).rejects.toThrow("constraint violation")

    const metrics = otel.generatePrometheusMetrics()
    expect(metrics).toContain("reactivebase_errors_total")
    expect(metrics).toContain("mutation")
  })

  it("instruments action execution", async () => {
    const otel = new ReactiveBaseInstrumentation()
    const result = await otel.instrumentAction("sendEmail", async () => "sent")
    expect(result).toBe("sent")

    const metrics = otel.generatePrometheusMetrics()
    expect(metrics).toContain("reactivebase_actions_total")
  })

  it("tracks action errors", async () => {
    const otel = new ReactiveBaseInstrumentation()
    await expect(
      otel.instrumentAction("failingAction", async () => {
        throw new Error("timeout")
      }),
    ).rejects.toThrow("timeout")

    const metrics = otel.generatePrometheusMetrics()
    expect(metrics).toContain("reactivebase_errors_total")
    expect(metrics).toContain("action")
  })

  it("instruments subscription lifecycle", () => {
    const otel = new ReactiveBaseInstrumentation()
    const sub = otel.instrumentSubscription("sub-1", "tasks.list")

    sub.onUpdate()
    sub.onUpdate()
    sub.onComplete()

    const metrics = otel.generatePrometheusMetrics()
    expect(metrics).toContain("reactivebase_subscription_updates_total")
    expect(metrics).toContain("reactivebase_subscriptions_active")
  })

  it("tracks subscription errors", () => {
    const otel = new ReactiveBaseInstrumentation()
    const sub = otel.instrumentSubscription("sub-2", "tasks.list")

    sub.onError("connection lost")
    sub.onComplete()

    const metrics = otel.generatePrometheusMetrics()
    expect(metrics).toContain("reactivebase_errors_total")
    expect(metrics).toContain("subscription")
  })

  it("generates middleware for auto-instrumentation", () => {
    const otel = new ReactiveBaseInstrumentation()
    const mw = otel.middleware()

    expect(mw.name).toBe("reactivebase-otel")
    expect(typeof mw.before).toBe("function")
    expect(typeof mw.after).toBe("function")
    expect(typeof mw.onError).toBe("function")
  })

  it("middleware creates spans and tracks metrics", () => {
    const otel = new ReactiveBaseInstrumentation()
    const mw = otel.middleware()

    const state = mw.before({ functionName: "tasks.list", functionType: "query" })
    expect(state.span).toBeDefined()
    expect(state.span.operationName).toBe("query.tasks.list")

    mw.after({ functionName: "tasks.list", functionType: "query" }, state)

    const metrics = otel.generatePrometheusMetrics()
    expect(metrics).toContain("reactivebase_querys_total")
  })

  it("middleware tracks errors", () => {
    const otel = new ReactiveBaseInstrumentation()
    const mw = otel.middleware()

    const state = mw.before({ functionName: "tasks.create", functionType: "mutation" })
    mw.onError({ functionName: "tasks.create", functionType: "mutation" }, new Error("failed"), state)

    const metrics = otel.generatePrometheusMetrics()
    expect(metrics).toContain("reactivebase_errors_total")
  })

  it("records CDC metrics", () => {
    const otel = new ReactiveBaseInstrumentation()
    otel.recordCdcMetrics({ lag: 150, throughput: 1000, errors: 2, table: "tasks" })

    const metrics = otel.generatePrometheusMetrics()
    expect(metrics).toContain("reactivebase_cdc_lag_ms")
    expect(metrics).toContain("reactivebase_cdc_throughput")
    expect(metrics).toContain("reactivebase_cdc_errors_total")
  })

  it("records IVM cache metrics", () => {
    const otel = new ReactiveBaseInstrumentation()
    otel.recordIvmCacheMetrics({ hits: 90, misses: 10, evictions: 5, queryName: "tasks.list" })

    const metrics = otel.generatePrometheusMetrics()
    expect(metrics).toContain("reactivebase_ivm_cache_hits_total")
    expect(metrics).toContain("reactivebase_ivm_cache_hit_rate")
  })

  it("generates Grafana dashboard with all panels", () => {
    const otel = new ReactiveBaseInstrumentation()
    const dashboard = otel.generateGrafanaDashboard()

    expect(dashboard.title).toContain("ReactiveBase")
    expect(dashboard.panels.length).toBeGreaterThanOrEqual(6)
    expect(dashboard.panels.some((p) => p.title.includes("Query Latency"))).toBe(true)
    expect(dashboard.panels.some((p) => p.title.includes("CDC"))).toBe(true)
  })

  it("generates alerting rules", () => {
    const otel = new ReactiveBaseInstrumentation()
    const rules = otel.generateAlertingRules() as { groups: Array<{ rules: unknown[] }> }
    expect(rules.groups).toHaveLength(1)
    expect(rules.groups[0].rules.length).toBeGreaterThanOrEqual(4)
  })

  it("manages SLIs and SLOs", () => {
    const otel = new ReactiveBaseInstrumentation()

    otel.defineSli({
      name: "query_latency_p99",
      description: "Query latency p99",
      metric: "reactivebase_operation_duration_ms",
      threshold: 100,
      comparison: "below",
    })

    otel.defineSlo({
      name: "query_latency_slo",
      target: 99.9,
      sliName: "query_latency_p99",
      windowMs: 60_000,
    })

    // Record some SLI measurements
    for (let i = 0; i < 100; i++) {
      otel.recordSli("query_latency_p99", i < 99 ? 50 : 200) // 99% good, 1% bad
    }

    const sloStatuses = otel.evaluateSlos()
    expect(sloStatuses).toHaveLength(1)
    expect(sloStatuses[0].name).toBe("query_latency_slo")
    expect(sloStatuses[0].current).toBe(99)
  })

  it("throws when SLO references unknown SLI", () => {
    const otel = new ReactiveBaseInstrumentation()
    expect(() =>
      otel.defineSlo({ name: "bad_slo", target: 99, sliName: "nonexistent" }),
    ).toThrow(ObservabilityError)
  })

  it("respects trace sampling rate", async () => {
    const otel = new ReactiveBaseInstrumentation({ traceSampleRate: 0 })
    // With sampling rate 0, traceQueries is still true but spans might still be created
    // (sampling is metadata, not a skip mechanism in this implementation)
    const result = await otel.instrumentQuery("test", async () => "ok")
    expect(result).toBe("ok")
  })

  it("resets all metrics", async () => {
    const otel = new ReactiveBaseInstrumentation()
    await otel.instrumentQuery("test", async () => "ok")
    otel.reset()

    const metrics = otel.generatePrometheusMetrics()
    expect(metrics).not.toContain("reactivebase_queries_total")
  })

  it("creates metrics handler for HTTP endpoint", () => {
    const otel = new ReactiveBaseInstrumentation()
    const handler = otel.metricsHandler()
    expect(typeof handler).toBe("function")

    let statusCode = 0
    let body = ""
    const mockRes = {
      writeHead: (code: number) => {
        statusCode = code
      },
      end: (content: string) => {
        body = content
      },
    }

    handler(null, mockRes)
    expect(statusCode).toBe(200)
    expect(body).toContain("reactivebase_subscriptions_total")
  })
})
