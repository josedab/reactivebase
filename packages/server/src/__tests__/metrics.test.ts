import { describe, it, expect } from "vitest"
import { MetricsCollector } from "../metrics/metrics.js"

describe("MetricsCollector", () => {
  it("tracks query executions", () => {
    const metrics = new MetricsCollector()

    metrics.recordQuery("query:listTasks", 5)
    metrics.recordQuery("query:listTasks", 10)
    metrics.recordQuery("query:listTasks", 3, true)

    const snap = metrics.getSnapshot()
    expect(snap.queries.totalExecuted).toBe(3)
    expect(snap.queries.totalErrors).toBe(1)
    expect(snap.queries.avgLatencyMs).toBe(6)
  })

  it("tracks mutation executions", () => {
    const metrics = new MetricsCollector()

    metrics.recordMutation("mutation:updateTask", 15)
    metrics.recordMutation("mutation:updateTask", 20, false, 1)

    const snap = metrics.getSnapshot()
    expect(snap.mutations.totalExecuted).toBe(2)
    expect(snap.mutations.totalRetries).toBe(1)
    expect(snap.mutations.avgLatencyMs).toBe(17.5)
  })

  it("tracks subscription lifecycle", () => {
    const metrics = new MetricsCollector()

    metrics.recordSubscription("created")
    metrics.recordSubscription("created")
    metrics.recordSubscription("created")
    metrics.recordSubscription("removed")

    const snap = metrics.getSnapshot()
    expect(snap.subscriptions.totalCreated).toBe(3)
    expect(snap.subscriptions.totalRemoved).toBe(1)
    expect(snap.subscriptions.currentActive).toBe(2)
  })

  it("tracks invalidation metrics", () => {
    const metrics = new MetricsCollector()

    metrics.recordInvalidation(2, 5, 20)
    metrics.recordInvalidation(3, 3, 15)

    const snap = metrics.getSnapshot()
    expect(snap.invalidations.totalEvaluations).toBe(2)
    expect(snap.invalidations.totalInvalidated).toBe(8)
    expect(snap.invalidations.totalSkipped).toBe(27)
    expect(snap.invalidations.avgEvaluationTimeMs).toBe(2.5)
  })

  it("computes per-connection subscription average", () => {
    const metrics = new MetricsCollector()

    metrics.setConnections(5)
    metrics.recordSubscription("created")
    metrics.recordSubscription("created")
    metrics.recordSubscription("created")
    metrics.recordSubscription("created")
    metrics.recordSubscription("created")
    metrics.recordSubscription("created")
    metrics.recordSubscription("created")
    metrics.recordSubscription("created")
    metrics.recordSubscription("created")
    metrics.recordSubscription("created")

    const snap = metrics.getSnapshot()
    expect(snap.subscriptions.avgPerConnection).toBe(2)
  })

  it("tracks p99 latency", () => {
    const metrics = new MetricsCollector()

    for (let i = 1; i <= 100; i++) {
      metrics.recordQuery("query:test", i)
    }

    const snap = metrics.getSnapshot()
    expect(snap.queries.p99LatencyMs).toBe(99)
  })

  it("tracks per-function metrics", () => {
    const metrics = new MetricsCollector()

    metrics.recordQuery("query:listTasks", 5)
    metrics.recordQuery("query:listTasks", 10)
    metrics.recordQuery("query:getUser", 3)

    const snap = metrics.getSnapshot()
    expect(snap.queries.byFunction["listTasks"]).toBeDefined()
    expect(snap.queries.byFunction["listTasks"].calls).toBe(2)
    expect(snap.queries.byFunction["getUser"].calls).toBe(1)
  })

  it("reports uptime", () => {
    const metrics = new MetricsCollector()
    const snap = metrics.getSnapshot()
    expect(snap.uptime).toBeGreaterThanOrEqual(0)
  })

  it("resets all metrics", () => {
    const metrics = new MetricsCollector()

    metrics.recordQuery("query:test", 5)
    metrics.recordMutation("mutation:test", 10)
    metrics.recordSubscription("created")

    metrics.reset()

    const snap = metrics.getSnapshot()
    expect(snap.queries.totalExecuted).toBe(0)
    expect(snap.mutations.totalExecuted).toBe(0)
    expect(snap.subscriptions.currentActive).toBe(0)
  })

  it("circular buffer wraps correctly under heavy load", () => {
    const metrics = new MetricsCollector()

    // Record more than the default 10K buffer size
    for (let i = 0; i < 15_000; i++) {
      metrics.recordQuery("query:heavy", i % 100)
    }

    const snap = metrics.getSnapshot()
    expect(snap.queries.totalExecuted).toBe(15_000)
    // Average should be computed from the last 10K entries (indices 5000-14999)
    expect(snap.queries.avgLatencyMs).toBeGreaterThan(0)
    expect(snap.queries.p99LatencyMs).toBeGreaterThan(0)
  })
})
