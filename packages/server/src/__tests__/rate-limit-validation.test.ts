import { describe, it, expect } from "vitest"
import { RateLimiter, RateLimitError, rateLimit } from "../validation/rate-limit.js"
import { validateArgs, ValidationError, s } from "../validation/args-validation.js"
import { createAuthContext } from "../auth/auth.js"

describe("RateLimiter", () => {
  it("allows requests within limit", () => {
    const limiter = new RateLimiter({ limit: 3, window: 60_000 })
    expect(limiter.check("user1").allowed).toBe(true)
    expect(limiter.check("user1").allowed).toBe(true)
    expect(limiter.check("user1").allowed).toBe(true)
    expect(limiter.check("user1").remaining).toBe(0)
  })

  it("blocks requests exceeding limit", () => {
    const limiter = new RateLimiter({ limit: 2, window: 60_000 })
    limiter.check("user1")
    limiter.check("user1")
    const result = limiter.check("user1")
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    limiter.stop()
  })

  it("tracks separate keys independently", () => {
    const limiter = new RateLimiter({ limit: 1, window: 60_000 })
    expect(limiter.check("a").allowed).toBe(true)
    expect(limiter.check("b").allowed).toBe(true)
    expect(limiter.check("a").allowed).toBe(false)
    limiter.stop()
  })

  it("resets a key", () => {
    const limiter = new RateLimiter({ limit: 1, window: 60_000 })
    limiter.check("user1")
    limiter.reset("user1")
    expect(limiter.check("user1").allowed).toBe(true)
    limiter.stop()
  })
})

describe("rateLimit middleware", () => {
  it("creates middleware that enforces limits", () => {
    const mw = rateLimit({ limit: 2, window: 60_000 })
    const ctx = {
      functionName: "test",
      functionType: "mutation" as const,
      args: {},
      auth: createAuthContext("user1"),
      state: Object.freeze({}),
    }

    expect(() => mw.before!(ctx)).not.toThrow()
    expect(() => mw.before!(ctx)).not.toThrow()
    expect(() => mw.before!(ctx)).toThrow(RateLimitError)
  })

  it("skips non-targeted function types", () => {
    const mw = rateLimit({ limit: 1, window: 60_000, functionTypes: ["mutation"] })
    const ctx = {
      functionName: "test",
      functionType: "query" as const,
      args: {},
      auth: createAuthContext("user1"),
      state: Object.freeze({}),
    }

    // Should not throw even after many calls since queries are excluded
    for (let i = 0; i < 10; i++) mw.before!(ctx)
  })
})

describe("validateArgs", () => {
  it("validates required string fields", () => {
    const schema = { title: s.string() }
    expect(() => validateArgs({ title: "Hello" }, schema)).not.toThrow()
    expect(() => validateArgs({}, schema)).toThrow(ValidationError)
    expect(() => validateArgs({ title: 123 }, schema)).toThrow(ValidationError)
  })

  it("validates optional fields", () => {
    const schema = { name: s.string().optional() }
    expect(() => validateArgs({}, schema)).not.toThrow()
    expect(() => validateArgs({ name: "test" }, schema)).not.toThrow()
  })

  it("validates string min/max length", () => {
    const schema = { title: s.string().min(3).max(10) }
    expect(() => validateArgs({ title: "Hi" }, schema)).toThrow("Min length")
    expect(() => validateArgs({ title: "Hello" }, schema)).not.toThrow()
    expect(() => validateArgs({ title: "A".repeat(20) }, schema)).toThrow("Max length")
  })

  it("validates email format", () => {
    const schema = { email: s.string().email() }
    expect(() => validateArgs({ email: "test@example.com" }, schema)).not.toThrow()
    expect(() => validateArgs({ email: "invalid" }, schema)).toThrow("email")
  })

  it("validates number fields", () => {
    const schema = { age: s.number().min(0).max(150).integer() }
    expect(() => validateArgs({ age: 25 }, schema)).not.toThrow()
    expect(() => validateArgs({ age: -1 }, schema)).toThrow("Min")
    expect(() => validateArgs({ age: 3.5 }, schema)).toThrow("integer")
  })

  it("validates boolean fields", () => {
    const schema = { done: s.boolean() }
    expect(() => validateArgs({ done: true }, schema)).not.toThrow()
    expect(() => validateArgs({ done: "yes" }, schema)).toThrow("boolean")
  })

  it("validates array fields", () => {
    const schema = { tags: s.array().minLength(1) }
    expect(() => validateArgs({ tags: ["a"] }, schema)).not.toThrow()
    expect(() => validateArgs({ tags: [] }, schema)).toThrow("Min items")
  })

  it("collects multiple errors", () => {
    const schema = { name: s.string(), age: s.number() }
    try {
      validateArgs({}, schema)
    } catch (e: unknown) {
      expect((e as ValidationError).errors).toHaveLength(2)
    }
  })

  it("rejects non-object args", () => {
    expect(() => validateArgs("string", { x: s.string() })).toThrow("must be an object")
  })
})
