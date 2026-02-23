/**
 * Production load test suite for ReactiveBase.
 * Tests concurrent subscription handling, invalidation throughput,
 * and memory efficiency using the in-process engine.
 */

import { describe, it, expect } from "vitest"
import { SubscriptionRegistry } from "../reactivity/subscription-registry.js"
import { InvalidationEvaluator } from "../reactivity/invalidation-evaluator.js"
import { hashResult } from "../reactivity/result-differ.js"
import { QueryBuilder } from "../query-builder/query-builder.js"
import { bench } from "../benchmark/benchmark.js"

describe("Load: Subscription Registry at Scale", () => {
  it("handles 10K concurrent subscriptions", () => {
    const registry = new SubscriptionRegistry()

    for (let i = 0; i < 10_000; i++) {
      registry.register({
        id: `sub_${i}`,
        queryName: `tasks.list`,
        args: { userId: `u${i % 100}` },
        connectionId: `conn_${i % 500}`,
        dependencies: [{ table: "tasks", filters: { assigneeId: `u${i % 100}` } }],
        lastResult: [{ id: String(i) }],
        lastResultHash: `hash_${i}`,
      })
    }

    expect(registry.size).toBe(10_000)

    // Lookup performance
    const subs = registry.getSubscriptionsForTable("tasks")
    expect(subs.length).toBe(10_000)
  })

  it("handles rapid subscribe/unsubscribe cycles", () => {
    const registry = new SubscriptionRegistry()

    // Simulate 1000 connections, each subscribing to 10 queries
    for (let conn = 0; conn < 1000; conn++) {
      for (let q = 0; q < 10; q++) {
        registry.register({
          id: `sub_${conn}_${q}`,
          queryName: `query_${q}`,
          args: {},
          connectionId: `conn_${conn}`,
          dependencies: [{ table: `table_${q % 5}`, filters: {} }],
          lastResult: [],
          lastResultHash: "hash",
        })
      }
    }

    expect(registry.size).toBe(10_000)

    // Remove half the connections
    for (let conn = 0; conn < 500; conn++) {
      registry.removeConnection(`conn_${conn}`)
    }

    expect(registry.size).toBe(5_000)
  })
})

describe("Load: Filter-Level Invalidation at Scale", () => {
  it("evaluates invalidation across 10K subscriptions with filter precision", () => {
    const registry = new SubscriptionRegistry()
    const evaluator = new InvalidationEvaluator(registry, "filter")

    // 10K subscriptions, each filtering for a different user
    for (let i = 0; i < 10_000; i++) {
      registry.register({
        id: `sub_${i}`,
        queryName: "tasks.list",
        args: { userId: `u${i}` },
        connectionId: `conn_${i % 500}`,
        dependencies: [{ table: "tasks", filters: { assigneeId: `u${i}` } }],
        lastResult: [],
        lastResultHash: "hash",
      })
    }

    // Mutate ONE user's tasks — only 1 subscription should be invalidated
    const invalidated = evaluator.evaluate([
      {
        table: "tasks",
        operation: "insert",
        affectedFilters: { assigneeId: "u42" },
      },
    ])

    expect(invalidated).toHaveLength(1)
    expect(invalidated[0].subscriptionId).toBe("sub_42")
  })

  it("handles broadcast invalidation (no filter data)", () => {
    const registry = new SubscriptionRegistry()
    const evaluator = new InvalidationEvaluator(registry, "filter")

    for (let i = 0; i < 1_000; i++) {
      registry.register({
        id: `sub_${i}`,
        queryName: "tasks.list",
        args: {},
        connectionId: `conn_${i}`,
        dependencies: [{ table: "tasks", filters: { assigneeId: `u${i}` } }],
        lastResult: [],
        lastResultHash: "hash",
      })
    }

    // No filter data → falls back to table-level → invalidates all
    const invalidated = evaluator.evaluate([
      {
        table: "tasks",
        operation: "update",
      },
    ])

    expect(invalidated).toHaveLength(1_000)
  })
})

describe("Load: Query Builder Performance", () => {
  it("builds 10K queries without performance degradation", async () => {
    const result = await bench(
      "query-builder-10k",
      () => {
        new QueryBuilder("tasks")
          .where({ assigneeId: "u1", done: false })
          .where("priority", "in", ["high", "critical"])
          .orderBy("createdAt", "desc")
          .limit(20)
          .build()
      },
      { iterations: 10_000, warmup: 100 },
    )

    expect(result.avgMs).toBeLessThan(1) // Each build should be <1ms
    expect(result.p99Ms).toBeLessThan(5)
  })
})

describe("Load: Result Hashing Performance", () => {
  it("hashes large result sets efficiently", async () => {
    const largeResult = Array.from({ length: 1000 }, (_, i) => ({
      id: String(i),
      title: `Task ${i}`,
      done: i % 3 === 0,
      priority: ["low", "medium", "high", "critical"][i % 4],
      createdAt: new Date().toISOString(),
      description: "Lorem ipsum ".repeat(10),
    }))

    const result = await bench(
      "hash-1k-rows",
      () => {
        hashResult(largeResult)
      },
      { iterations: 100, warmup: 10 },
    )

    expect(result.avgMs).toBeLessThan(50) // 1K rows should hash in <50ms
  })
})

describe("Load: Memory Efficiency", () => {
  it("subscription memory footprint is reasonable", () => {
    const registry = new SubscriptionRegistry()

    const before = process.memoryUsage().heapUsed

    for (let i = 0; i < 50_000; i++) {
      registry.register({
        id: `sub_${i}`,
        queryName: "tasks.list",
        args: { userId: `u${i % 100}` },
        connectionId: `conn_${i % 1000}`,
        dependencies: [{ table: "tasks", filters: { assigneeId: `u${i % 100}` } }],
        lastResult: null,
        lastResultHash: "h",
      })
    }

    const after = process.memoryUsage().heapUsed
    const bytesPerSub = (after - before) / 50_000

    // Each subscription should use less than 2KB
    expect(bytesPerSub).toBeLessThan(2048)
    expect(registry.size).toBe(50_000)
  })
})
