import { describe, it, expect } from "vitest"
import { ProfileEngine, deepMerge } from "../config-profiles/config-profiles.js"

describe("ProfileEngine", () => {
  it("lists all built-in profiles", () => {
    const engine = new ProfileEngine()
    const profiles = engine.listProfiles()

    expect(profiles.length).toBeGreaterThanOrEqual(5)
    expect(profiles.some((p) => p.name === "saas")).toBe(true)
    expect(profiles.some((p) => p.name === "edge")).toBe(true)
    expect(profiles.some((p) => p.name === "collaborative")).toBe(true)
    expect(profiles.some((p) => p.name === "analytics")).toBe(true)
    expect(profiles.some((p) => p.name === "minimal")).toBe(true)
    expect(profiles.every((p) => p.builtin)).toBe(true)
  })

  it("resolves a built-in profile", () => {
    const engine = new ProfileEngine()
    const config = engine.resolveProfile("saas")

    expect(config.database?.poolSize).toBe(20)
    expect(config.auth?.provider).toBe("jwt")
    expect(config.tenancy?.isolation).toBe("row")
    expect(config.cdc?.mode).toBe("logical-replication")
  })

  it("resolves profile inheritance", () => {
    const engine = new ProfileEngine()
    const config = engine.resolveProfile("edge")

    // Should have minimal's defaults merged with edge's overrides
    expect(config.database?.poolSize).toBe(10) // edge override
    expect(config.server?.port).toBe(4000) // inherited from minimal
    expect(config.cache?.enabled).toBe(true) // edge-specific
  })

  it("merges multiple profiles", () => {
    const engine = new ProfileEngine()
    const config = engine.mergeProfiles("minimal", "saas")

    expect(config.database?.poolSize).toBe(20) // saas overrides minimal
    expect(config.auth?.provider).toBe("jwt") // from saas
  })

  it("applies overrides on top of profile", () => {
    const engine = new ProfileEngine()
    const config = engine.applyOverrides("saas", {
      database: { poolSize: 50 },
      server: { port: 8080 },
    })

    expect(config.database?.poolSize).toBe(50) // overridden
    expect(config.server?.port).toBe(8080) // overridden
    expect(config.auth?.provider).toBe("jwt") // preserved from saas
  })

  it("registers and resolves custom profiles", () => {
    const engine = new ProfileEngine()
    engine.registerProfile({
      name: "custom",
      description: "Custom test profile",
      extends: "minimal",
      config: {
        database: { poolSize: 42 },
        cache: { enabled: true, ttlMs: 99_000 },
      },
    })

    const config = engine.resolveProfile("custom")
    expect(config.database?.poolSize).toBe(42)
    expect(config.cache?.ttlMs).toBe(99_000)

    const profiles = engine.listProfiles()
    expect(profiles.some((p) => p.name === "custom" && !p.builtin)).toBe(true)
  })

  it("throws on unknown profile", () => {
    const engine = new ProfileEngine()
    expect(() => engine.resolveProfile("nonexistent")).toThrow('Unknown profile: "nonexistent"')
  })

  it("validates profile configurations", () => {
    const engine = new ProfileEngine()

    const valid = engine.validateProfile({ database: { poolSize: 10 }, server: { port: 4000 } })
    expect(valid.valid).toBe(true)
    expect(valid.errors).toHaveLength(0)

    const invalid = engine.validateProfile({ database: { poolSize: -1 }, server: { port: 999999 } })
    expect(invalid.valid).toBe(false)
    expect(invalid.errors.length).toBeGreaterThan(0)
  })

  it("emits warnings for risky configurations", () => {
    const engine = new ProfileEngine()
    const result = engine.validateProfile({ database: { poolSize: 200 } })

    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toContain("resource exhaustion")
  })
})

describe("deepMerge", () => {
  it("deeply merges nested objects", () => {
    const base = { a: { b: 1, c: 2 }, d: 3 }
    const override = { a: { b: 10, e: 5 }, f: 6 }

    const result = deepMerge(base, override) as Record<string, unknown>
    const a = result.a as Record<string, number>

    expect(a.b).toBe(10) // overridden
    expect(a.c).toBe(2) // preserved
    expect(a.e).toBe(5) // added
    expect(result.d).toBe(3) // preserved
    expect(result.f).toBe(6) // added
  })

  it("does not mutate inputs", () => {
    const base = { a: { b: 1 } }
    const override = { a: { b: 2 } }

    deepMerge(base, override)
    expect((base.a as { b: number }).b).toBe(1)
  })
})
