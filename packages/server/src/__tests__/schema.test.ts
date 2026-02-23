import { describe, it, expect } from "vitest"
import { defineSchema, defineTable, v } from "../schema/index.js"

describe("schema definition", () => {
  it("creates a schema with tables", () => {
    const schema = defineSchema({
      users: defineTable({
        name: v.string(),
        email: v.string(),
      }),
      tasks: defineTable({
        title: v.string(),
        done: v.boolean({ default: false }),
      }),
    })

    expect(schema.tableNames).toEqual(["users", "tasks"])
    expect(schema.tables.users.name).toBe("users")
    expect(schema.tables.tasks.name).toBe("tasks")
  })

  it("supports indexes", () => {
    const schema = defineSchema({
      users: defineTable({
        name: v.string(),
        email: v.string(),
      })
        .index("by_email", ["email"], { unique: true })
        .index("by_name", ["name"]),
    })

    expect(schema.tables.users.indexes).toHaveLength(2)
    expect(schema.tables.users.indexes[0].name).toBe("by_email")
    expect(schema.tables.users.indexes[0].unique).toBe(true)
    expect(schema.tables.users.indexes[1].name).toBe("by_name")
    expect(schema.tables.users.indexes[1].unique).toBe(false)
  })

  it("supports relations", () => {
    const schema = defineSchema({
      users: defineTable({
        name: v.string(),
      }),
      tasks: defineTable({
        title: v.string(),
        assigneeId: v.id("users"),
      }).relation("assignee", { from: "assigneeId", to: "users" }),
    })

    expect(schema.tables.tasks.relations).toHaveLength(1)
    expect(schema.tables.tasks.relations[0].name).toBe("assignee")
  })

  it("validates foreign key references", () => {
    expect(() => {
      defineSchema({
        tasks: defineTable({
          assigneeId: v.id("nonexistent"),
        }),
      })
    }).toThrow('references non-existent table "nonexistent"')
  })

  it("validates index columns exist", () => {
    expect(() => {
      defineSchema({
        users: defineTable({
          name: v.string(),
        }).index("by_email", ["email" as never]),
      })
    }).toThrow('references non-existent column "email"')
  })
})
