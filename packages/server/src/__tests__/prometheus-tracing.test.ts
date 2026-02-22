import { describe, it, expect } from "vitest"
import { toPrometheusFormat } from "../metrics/prometheus.js"
import { NoopTracer, ConsoleTracer, traced } from "../metrics/tracing.js"
import type { MetricsSnapshot } from "../metrics/metrics.js"

const mockSnapshot: MetricsSnapshot = {
  server: { connections: 5, activeSubscriptions: 20, pendingJobs: 3 },
  queries: {
    totalExecuted: 100,
    totalErrors: 2,
    avgLatencyMs: 5.5,
    p99LatencyMs: 45,
    byFunction: {
      listTasks: { name: "listTasks", calls: 80, errors: 1, totalLatencyMs: 400, avgLatencyMs: 5, lastCalledAt: Date.now() },
    },
  },
  mutations: {
    totalExecuted: 30,
    totalErrors: 1,
    totalRetries: 2,
    avgLatencyMs: 15,
    p99LatencyMs: 90,
    byFunction: {},
  },
  subscriptions: { totalCreated: 50, totalRemoved: 30, currentActive: 20, avgPerConnection: 4 },
  invalidations: {
    totalEvaluations: 25,
    totalInvalidated: 15,
    totalSkipped: 10,
    avgEvaluationTimeMs: 2,
    falseInvalidationRate: 0.4,
  },
  uptime: 60000,
}

describe("Prometheus format", () => {
  it("generates valid Prometheus exposition format", () => {
    const output = toPrometheusFormat(mockSnapshot)

    expect(output).toContain("# HELP reactivebase_connections")
    expect(output).toContain("# TYPE reactivebase_connections gauge")
    expect(output).toContain("reactivebase_connections 5")

    expect(output).toContain("reactivebase_queries_total 100")
    expect(output).toContain("reactivebase_mutations_total 30")
    expect(output).toContain("reactivebase_subscriptions_active 20")

    // Per-function metrics
    expect(output).toContain('reactivebase_query_calls_total{function="listTasks"} 80')

    // Ends with newline
    expect(output.endsWith("\n")).toBe(true)
  })

  it("includes all metric types", () => {
    const output = toPrometheusFormat(mockSnapshot)

    const gaugeCount = (output.match(/# TYPE .+ gauge/g) || []).length
    const counterCount = (output.match(/# TYPE .+ counter/g) || []).length

    expect(gaugeCount).toBeGreaterThanOrEqual(8)
    expect(counterCount).toBeGreaterThanOrEqual(7)
  })
})

describe("Tracing", () => {
  it("NoopTracer creates spans that do nothing", () => {
    const tracer = new NoopTracer()
    const span = tracer.startSpan("test")
    span.setAttribute("key", "value")
    span.setStatus("ok")
    span.end()
    // Should not throw
  })

  it("traced() wraps successful function", async () => {
    const tracer = new NoopTracer()
    const result = await traced(tracer, "test-op", { type: "query" }, async () => {
      return 42
    })
    expect(result).toBe(42)
  })

  it("traced() propagates errors", async () => {
    const tracer = new NoopTracer()
    await expect(
      traced(tracer, "failing-op", {}, async () => {
        throw new Error("test error")
      }),
    ).rejects.toThrow("test error")
  })

  it("ConsoleTracer records attributes", () => {
    const tracer = new ConsoleTracer()
    const span = tracer.startSpan("test", { component: "query" })
    span.setAttribute("table", "tasks")
    span.setStatus("ok")
    span.end()
    // Just verify it doesn't throw
  })
})
