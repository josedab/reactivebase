import { describe, it, expect } from "vitest"
import { defineSchema, defineTable, v } from "../schema/index.js"
import { MiddlewareManager } from "../middleware/middleware.js"

describe("auto-timestamps on tables", () => {
  it("adds _createdAt and _updatedAt by default", () => {
    const table = defineTable({ name: v.string() })
    expect(table.columns._createdAt).toBeDefined()
    expect(table.columns._createdAt.type).toBe("timestamp")
    expect(table.columns._createdAt.options.default).toBe("now")
    expect(table.columns._updatedAt).toBeDefined()
    expect(table.columns._updatedAt.type).toBe("timestamp")
    expect(table.columns._updatedAt.options.default).toBe("now")
    expect(table.hasSystemTimestamps).toBe(true)
  })

  it("disables timestamps with disableTimestamps option", () => {
    const table = defineTable({ name: v.string() }, { disableTimestamps: true })
    expect(table.columns._createdAt).toBeUndefined()
    expect(table.columns._updatedAt).toBeUndefined()
    expect(table.hasSystemTimestamps).toBe(false)
  })

  it("does not overwrite user-defined timestamp fields", () => {
    const table = defineTable({
      name: v.string(),
      _createdAt: v.timestamp(),
    })
    // User's definition should be preserved (no default)
    expect(table.columns._createdAt.options.default).toBeUndefined()
  })

  it("works in defineSchema", () => {
    const schema = defineSchema({
      tasks: defineTable({ title: v.string() }),
    })
    expect(schema.tables.tasks.columns._createdAt).toBeDefined()
    expect(schema.tables.tasks.columns._updatedAt).toBeDefined()
  })
})

describe("middleware ordering and removal", () => {
  it("executes middleware in priority order", async () => {
    const manager = new MiddlewareManager()
    const order: string[] = []

    manager.use({
      name: "third",
      priority: 300,
      before: () => {
        order.push("third")
      },
    })
    manager.use({
      name: "first",
      priority: 10,
      before: () => {
        order.push("first")
      },
    })
    manager.use({
      name: "second",
      priority: 100,
      before: () => {
        order.push("second")
      },
    })

    await manager.runBefore({
      functionName: "test",
      functionType: "query",
      args: {},
      auth: { userId: null, claims: {} },
      state: Object.freeze({}),
    })

    expect(order).toEqual(["first", "second", "third"])
  })

  it("removes middleware by name", () => {
    const manager = new MiddlewareManager()
    manager.use({ name: "auth", before: () => {} })
    manager.use({ name: "logging", before: () => {} })

    expect(manager.count).toBe(2)
    expect(manager.remove("auth")).toBe(true)
    expect(manager.count).toBe(1)
    expect(manager.has("auth")).toBe(false)
    expect(manager.has("logging")).toBe(true)
  })

  it("returns false when removing non-existent middleware", () => {
    const manager = new MiddlewareManager()
    expect(manager.remove("nonexistent")).toBe(false)
  })

  it("gets middleware by name", () => {
    const manager = new MiddlewareManager()
    manager.use({ name: "auth", priority: 50, before: () => {} })
    const mw = manager.get("auth")
    expect(mw).toBeDefined()
    expect(mw?.name).toBe("auth")
    expect(mw?.priority).toBe(50)
  })

  it("uses default priority of 100 when not specified", async () => {
    const manager = new MiddlewareManager()
    const order: string[] = []

    manager.use({
      name: "explicit",
      priority: 50,
      before: () => {
        order.push("explicit")
      },
    })
    manager.use({
      name: "default",
      before: () => {
        order.push("default")
      },
    })

    await manager.runBefore({
      functionName: "test",
      functionType: "query",
      args: {},
      auth: { userId: null, claims: {} },
      state: Object.freeze({}),
    })

    expect(order).toEqual(["explicit", "default"])
  })
})
