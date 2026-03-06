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
    // TODO: test sliding window rate limiting over time
    const limiter = new SlidingWindowLimiter(10, 1000)
    expect(limiter).toBeInstanceOf(SlidingWindowLimiter)
  })

  it("should create a TokenBucketLimiter instance", () => {
    // TODO: test token bucket refill behavior
    const limiter = new TokenBucketLimiter(100, 10, 1000)
    expect(limiter).toBeInstanceOf(TokenBucketLimiter)
  })
})
