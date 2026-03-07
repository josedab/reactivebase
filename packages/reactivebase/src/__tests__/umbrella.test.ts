/**
 * Umbrella package export verification — ensures all re-exported symbols
 * from @reactivebase/server and @reactivebase/client are accessible.
 */

import { describe, it, expect } from "vitest"

describe("reactivebase umbrella package", () => {
  it("re-exports schema definition functions from server", async () => {
    const mod = await import("../index.js")
    expect(typeof mod.defineSchema).toBe("function")
    expect(typeof mod.defineTable).toBe("function")
    expect(mod.v).toBeDefined()
  })

  it("re-exports function definition helpers from server", async () => {
    const mod = await import("../index.js")
    expect(typeof mod.query).toBe("function")
    expect(typeof mod.mutation).toBe("function")
    expect(typeof mod.action).toBe("function")
  })

  it("re-exports server configuration from server", async () => {
    const mod = await import("../index.js")
    expect(typeof mod.defineConfig).toBe("function")
    expect(typeof mod.createReactiveBaseServer).toBe("function")
  })

  it("re-exports ReactiveBaseClient from client", async () => {
    const mod = await import("../index.js")
    expect(mod.ReactiveBaseClient).toBeDefined()
  })

  it("defineSchema creates a valid schema object", async () => {
    const { defineSchema, defineTable, v } = await import("../index.js")
    const schema = defineSchema({
      tasks: defineTable({
        title: v.string(),
        done: v.boolean({ default: false }),
      }),
    })
    expect(schema.tableNames).toContain("tasks")
  })

  it("query/mutation/action create RegisteredFunction objects", async () => {
    const { query, mutation, action } = await import("../index.js")

    const q = query(async () => [])
    expect(q.type).toBe("query")

    const m = mutation(async () => ({}))
    expect(m.type).toBe("mutation")

    const a = action(async () => {})
    expect(a.type).toBe("action")
  })
})

describe("reactivebase/server subpath", () => {
  it("exports server-specific functions", async () => {
    const mod = await import("../server.js")
    expect(typeof mod.createReactiveBaseServer).toBe("function")
    expect(typeof mod.defineConfig).toBe("function")
    expect(typeof mod.createAuthContext).toBe("function")
  })

  it("exports schema and function helpers", async () => {
    const mod = await import("../server.js")
    expect(typeof mod.defineSchema).toBe("function")
    expect(typeof mod.defineTable).toBe("function")
    expect(typeof mod.query).toBe("function")
    expect(typeof mod.mutation).toBe("function")
    expect(typeof mod.action).toBe("function")
    expect(mod.v).toBeDefined()
  })

  it("createAuthContext creates valid auth context", async () => {
    const { createAuthContext } = await import("../server.js")
    const auth = createAuthContext("user-1", { role: "admin" })
    expect(auth.userId).toBe("user-1")
    expect(auth.claims.role).toBe("admin")
  })
})
