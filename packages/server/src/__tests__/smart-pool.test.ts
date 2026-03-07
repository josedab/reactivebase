import { describe, it, expect } from "vitest"
import {
  SmartPool,
  QueryDeduplicator,
  AdaptivePoolSizer,
  SubscriptionCoalescer,
  BatchInvalidationEvaluator,
  BackpressureError,
  PoolExhaustedError,
  createSmartPool,
  createQueryDeduplicator,
  createSubscriptionCoalescer,
} from "../smart-pool/index.js"

describe("smart-pool", () => {
  it("should export all expected symbols", () => {
    expect(SmartPool).toBeDefined()
    expect(QueryDeduplicator).toBeDefined()
    expect(AdaptivePoolSizer).toBeDefined()
    expect(SubscriptionCoalescer).toBeDefined()
    expect(BatchInvalidationEvaluator).toBeDefined()
    expect(BackpressureError).toBeDefined()
    expect(PoolExhaustedError).toBeDefined()
    expect(createSmartPool).toBeDefined()
    expect(createQueryDeduplicator).toBeDefined()
    expect(createSubscriptionCoalescer).toBeDefined()
  })

  it("should create a QueryDeduplicator via factory", () => {
    const deduplicator = createQueryDeduplicator()
    expect(deduplicator).toBeInstanceOf(QueryDeduplicator)
  })

  it("should test deduplication of identical concurrent queries", async () => {
    const deduplicator = createQueryDeduplicator()
    const sql = "SELECT * FROM users WHERE id = $1"
    const params = [42]

    // First query is registered (no in-flight match)
    const coalesced1 = deduplicator.tryCoalesce(sql, params)
    expect(coalesced1).toBeNull()

    // Register the query
    const { entry, promise: promise1 } = deduplicator.register(sql, params)

    // Second identical query should coalesce
    const promise2 = deduplicator.tryCoalesce(sql, params)
    expect(promise2).not.toBeNull()

    // Resolve the original query
    const result = { rows: [{ id: 42, name: "Alice" }], rowCount: 1 }
    deduplicator.resolve(entry.hash, result)

    // Both waiters should receive the same result
    const r1 = await promise1
    const r2 = await promise2!
    expect(r1).toEqual(result)
    expect(r2).toEqual(result)
    expect(deduplicator.totalCoalesced).toBe(1)
  })

  it("should throw PoolExhaustedError with correct message", () => {
    const error = new PoolExhaustedError(10, 10)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain("pool exhausted")
  })

  it("should test pool exhaustion under high concurrency", () => {
    const error = new PoolExhaustedError(20, 20)
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(PoolExhaustedError)
    expect(error.code).toBe("POOL_EXHAUSTED")
    expect(error.activeConnections).toBe(20)
    expect(error.maxConnections).toBe(20)
    expect(error.message).toContain("pool exhausted")
    expect(error.message).toContain("20/20")

    // BackpressureError should also work properly
    const bpError = new BackpressureError(1000, 1000)
    expect(bpError.code).toBe("BACKPRESSURE")
    expect(bpError.statusCode).toBe(503)
    expect(bpError.pendingCount).toBe(1000)
    expect(bpError.maxPending).toBe(1000)
  })
})
