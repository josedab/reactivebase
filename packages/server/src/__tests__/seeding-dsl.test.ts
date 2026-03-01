import { describe, it, expect } from "vitest"
import { SeededRandom, DataGenerator, SeedEngine } from "../seeding-dsl/seeding-dsl.js"
import type { SeedingProfile } from "../seeding-dsl/seeding-dsl.js"

describe("SeededRandom", () => {
  it("produces deterministic sequences", () => {
    const rng1 = new SeededRandom(42)
    const rng2 = new SeededRandom(42)

    const seq1 = Array.from({ length: 10 }, () => rng1.next())
    const seq2 = Array.from({ length: 10 }, () => rng2.next())

    expect(seq1).toEqual(seq2)
  })

  it("produces different sequences for different seeds", () => {
    const rng1 = new SeededRandom(1)
    const rng2 = new SeededRandom(2)

    expect(rng1.next()).not.toBe(rng2.next())
  })

  it("picks from arrays", () => {
    const rng = new SeededRandom(42)
    const items = ["a", "b", "c", "d"]
    const picked = rng.pick(items)
    expect(items).toContain(picked)
  })

  it("generates integers in range", () => {
    const rng = new SeededRandom(42)
    for (let i = 0; i < 100; i++) {
      const val = rng.nextInt(5, 10)
      expect(val).toBeGreaterThanOrEqual(5)
      expect(val).toBeLessThanOrEqual(10)
    }
  })
})

describe("DataGenerator", () => {
  it("generates deterministic data with seed", () => {
    const gen1 = new DataGenerator(42)
    const gen2 = new DataGenerator(42)

    expect(gen1.firstName()).toBe(gen2.firstName())
    expect(gen1.email()).toBe(gen2.email())
  })

  it("generates valid emails", () => {
    const gen = new DataGenerator(42)
    const email = gen.email()
    expect(email).toContain("@")
    expect(email).toContain("example.com")
  })

  it("generates UUIDs", () => {
    const gen = new DataGenerator(42)
    const uuid = gen.uuid()
    expect(uuid.split("-")).toHaveLength(5)
  })

  it("generates various types via generate()", () => {
    const gen = new DataGenerator(42)

    expect(typeof gen.generate("firstName")).toBe("string")
    expect(typeof gen.generate("integer")).toBe("number")
    expect(typeof gen.generate("boolean")).toBe("boolean")
    expect(typeof gen.generate("date")).toBe("string")
    expect(typeof gen.generate("url")).toBe("string")
  })

  it("throws on unknown generator", () => {
    const gen = new DataGenerator(42)
    expect(() => gen.generate("nonexistent")).toThrow('Unknown generator: "nonexistent"')
  })
})

describe("SeedEngine", () => {
  const profile: SeedingProfile = {
    name: "test",
    size: "tiny",
    deterministic: true,
    seed: 42,
    tables: {
      users: {
        count: 5,
        columns: {
          id: { type: "faker", generator: "uuid" },
          name: { type: "faker", generator: "fullName" },
          email: { type: "faker", generator: "email" },
          role: { type: "enum", values: ["admin", "user", "editor"] },
        },
      },
      posts: {
        count: 10,
        columns: {
          id: { type: "faker", generator: "uuid" },
          title: { type: "faker", generator: "sentence" },
          authorId: { type: "reference", table: "users" },
          status: { type: "enum", values: ["draft", "published"] },
          order: { type: "sequence", start: 1 },
        },
      },
    },
  }

  it("creates execution plan with topological order", () => {
    const engine = new SeedEngine(42)
    const plan = engine.plan(profile)

    expect(plan.tables).toHaveLength(2)
    expect(plan.insertionOrder.indexOf("users")).toBeLessThan(plan.insertionOrder.indexOf("posts"))
    expect(plan.totalRows).toBe(15) // 5 users + 10 posts (tiny = 1x multiplier)
  })

  it("generates rows with correct column values", () => {
    const engine = new SeedEngine(42)
    const rows = engine.generateRows("users", profile.tables.users, 5)

    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect(row.id).toBeDefined()
      expect(row.name).toBeDefined()
      expect(row.email).toContain("@")
      expect(["admin", "user", "editor"]).toContain(row.role)
    }
  })

  it("resolves references to previously generated tables", () => {
    const engine = new SeedEngine(42)

    // Generate users first
    engine.generateRows("users", profile.tables.users, 5)

    // Then generate posts with references
    const posts = engine.generateRows("posts", profile.tables.posts, 10)

    const userIds = engine.getGeneratedIds("users")
    for (const post of posts) {
      // authorId should be one of the user IDs (or null if empty)
      if (userIds.length > 0) {
        expect(userIds).toContain(post.authorId)
      }
    }
  })

  it("generates sequences", () => {
    const engine = new SeedEngine(42)
    const rows = engine.generateRows("posts", profile.tables.posts, 5)

    expect(rows[0].order).toBe(1)
    expect(rows[1].order).toBe(2)
    expect(rows[4].order).toBe(5)
  })

  it("produces deterministic output with same seed", () => {
    const engine1 = new SeedEngine(42)
    const engine2 = new SeedEngine(42)

    const rows1 = engine1.generateRows("users", profile.tables.users, 5)
    const rows2 = engine2.generateRows("users", profile.tables.users, 5)

    expect(rows1).toEqual(rows2)
  })
})
