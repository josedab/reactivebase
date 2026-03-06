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

  it.todo("should test deduplication of identical concurrent queries")

  it("should throw PoolExhaustedError with correct message", () => {
    const error = new PoolExhaustedError(10, 10)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain("pool exhausted")
  })

  it.todo("should test pool exhaustion under high concurrency")
})
