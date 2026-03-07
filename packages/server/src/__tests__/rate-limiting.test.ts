import { describe, it, expect } from "vitest"
import {
  RateLimitEngine,
  SlidingWindowLimiter,
  TokenBucketLimiter,
  UsageMeter,
  AdvancedRateLimitError,
  createRateLimitEngine,
  createUsageMeter,
} from "../rate-limiting/index.js"

describe("rate-limiting", () => {
  it("should export all expected symbols", () => {
    expect(RateLimitEngine).toBeDefined()
    expect(SlidingWindowLimiter).toBeDefined()
    expect(TokenBucketLimiter).toBeDefined()
    expect(UsageMeter).toBeDefined()
    expect(AdvancedRateLimitError).toBeDefined()
    expect(createRateLimitEngine).toBeDefined()
    expect(createUsageMeter).toBeDefined()
  })

  it("should create a SlidingWindowLimiter instance", () => {
    const limiter = new SlidingWindowLimiter(10, 1000)
    expect(limiter).toBeInstanceOf(SlidingWindowLimiter)
  })

  it("should test sliding window rate limiting over time", () => {
    const limiter = new SlidingWindowLimiter(3, 1000)

    const r1 = limiter.check("key1")
    expect(r1.allowed).toBe(true)
    expect(r1.remaining).toBe(2)

    const r2 = limiter.check("key1")
    expect(r2.allowed).toBe(true)
    expect(r2.remaining).toBe(1)

    const r3 = limiter.check("key1")
    expect(r3.allowed).toBe(true)
    expect(r3.remaining).toBe(0)

    // Fourth request should be denied
    const r4 = limiter.check("key1")
    expect(r4.allowed).toBe(false)
    expect(r4.remaining).toBe(0)
    expect(r4.retryAfterMs).toBeGreaterThan(0)

    // Different key should still work
    const r5 = limiter.check("key2")
    expect(r5.allowed).toBe(true)
    expect(r5.remaining).toBe(2)
  })

  it("should create a TokenBucketLimiter instance", () => {
    const limiter = new TokenBucketLimiter(100, 10, 1000)
    expect(limiter).toBeInstanceOf(TokenBucketLimiter)
  })

  it("should test token bucket refill behavior", () => {
    // capacity=3, refillRate=1, refillInterval=100ms
    const limiter = new TokenBucketLimiter(3, 1, 100)

    // Consume all 3 tokens
    expect(limiter.check("k").allowed).toBe(true)
    expect(limiter.check("k").allowed).toBe(true)
    expect(limiter.check("k").allowed).toBe(true)

    // Should be denied now
    const denied = limiter.check("k")
    expect(denied.allowed).toBe(false)
    expect(denied.retryAfterMs).toBeGreaterThan(0)

    // Reset should restore tokens
    limiter.reset("k")
    const afterReset = limiter.check("k")
    expect(afterReset.allowed).toBe(true)
    expect(afterReset.remaining).toBe(2)
  })
})
