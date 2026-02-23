import { describe, it, expect } from "vitest"
import { schemaToVisualModel, visualModelToCode, generateDashboardHTML } from "../dashboard/schema-visualizer.js"
import { defineSchema, defineTable, v } from "../schema/index.js"

const schema = defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    role: v.enum("admin", "member"),
  }).index("by_email", ["email"], { unique: true }),

  tasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    assigneeId: v.id("users"),
    done: v.boolean({ default: false }),
    embedding: v.vector(1536),
  })
    .index("by_assignee", ["assigneeId"])
    .vectorIndex("embedding_idx", "embedding", { metric: "cosine" })
    .relation("assignee", { from: "assigneeId", to: "users" })
    .relation("comments", { from: "id", to: "comments.taskId" }),

  comments: defineTable({
    taskId: v.id("tasks"),
    body: v.string(),
    createdAt: v.timestamp({ default: "now" }),
  })
    .index("by_task", ["taskId"])
    .relation("task", { from: "taskId", to: "tasks" }),
})

describe("schemaToVisualModel", () => {
  it("converts schema to visual model", () => {
    const model = schemaToVisualModel(schema)

    expect(model.tables).toHaveLength(3)
    expect(model.tables[0].name).toBe("users")
    expect(model.tables[1].name).toBe("tasks")
    expect(model.tables[2].name).toBe("comments")
  })

  it("extracts columns with correct types", () => {
    const model = schemaToVisualModel(schema)
    const tasks = model.tables.find((t) => t.name === "tasks")!

    // Should have id + 5 defined columns
    expect(tasks.columns.length).toBe(6)

    const idCol = tasks.columns.find((c) => c.name === "id")!
    expect(idCol.isId).toBe(true)

    const assigneeCol = tasks.columns.find((c) => c.name === "assigneeId")!
    expect(assigneeCol.referencedTable).toBe("users")

    const descCol = tasks.columns.find((c) => c.name === "description")!
    expect(descCol.isOptional).toBe(true)

    const embeddingCol = tasks.columns.find((c) => c.name === "embedding")!
    expect(embeddingCol.type).toBe("vector")
    expect(embeddingCol.dimensions).toBe(1536)
  })

  it("extracts indexes including vector indexes", () => {
    const model = schemaToVisualModel(schema)
    const tasks = model.tables.find((t) => t.name === "tasks")!

    expect(tasks.indexes).toHaveLength(2)
    const vectorIdx = tasks.indexes.find((i) => i.name === "embedding_idx")
    expect(vectorIdx?.type).toBe("hnsw")
  })

  it("extracts relations with correct types", () => {
    const model = schemaToVisualModel(schema)

    const belongsTo = model.relations.find((r) => r.name === "assignee")!
    expect(belongsTo.type).toBe("belongs_to")
    expect(belongsTo.fromTable).toBe("tasks")
    expect(belongsTo.toTable).toBe("users")

    const hasMany = model.relations.find((r) => r.name === "comments")!
    expect(hasMany.type).toBe("has_many")
    expect(hasMany.fromTable).toBe("tasks")
    expect(hasMany.toTable).toBe("comments")
  })

  it("assigns grid positions to tables", () => {
    const model = schemaToVisualModel(schema)
    for (const table of model.tables) {
      expect(table.position).toBeDefined()
      expect(table.position!.x).toBeGreaterThanOrEqual(0)
      expect(table.position!.y).toBeGreaterThanOrEqual(0)
    }
  })
})

describe("visualModelToCode", () => {
  it("generates valid schema code from visual model", () => {
    const model = schemaToVisualModel(schema)
    const code = visualModelToCode(model)

    expect(code).toContain("import { defineSchema, defineTable, v }")
    expect(code).toContain("defineSchema({")
    expect(code).toContain("users: defineTable({")
    expect(code).toContain("tasks: defineTable({")
    expect(code).toContain("comments: defineTable({")
    expect(code).toContain("v.string()")
    expect(code).toContain("v.optional(v.string())")
    expect(code).toContain('v.id("users")')
    expect(code).toContain("v.vector(1536)")
    expect(code).toContain('.relation("assignee"')
  })

  it("round-trips schema → visual → code", () => {
    const model = schemaToVisualModel(schema)
    const code = visualModelToCode(model)

    // Verify the generated code has all tables
    expect(code).toContain("users:")
    expect(code).toContain("tasks:")
    expect(code).toContain("comments:")

    // Verify indexes
    expect(code).toContain('.index("by_email"')
    expect(code).toContain('.index("by_assignee"')
    expect(code).toContain('.vectorIndex("embedding_idx"')
  })
})

describe("generateDashboardHTML", () => {
  it("generates valid HTML", () => {
    const model = schemaToVisualModel(schema)
    const html = generateDashboardHTML(model)

    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("ReactiveBase")
    expect(html).toContain("3 tables")
    expect(html).toContain("users")
    expect(html).toContain("tasks")
    expect(html).toContain("comments")
  })

  it("includes relations in dashboard", () => {
    const model = schemaToVisualModel(schema)
    const html = generateDashboardHTML(model)

    expect(html).toContain("Relations")
    expect(html).toContain("assignee")
  })

  it("embeds schema JSON for client-side use", () => {
    const model = schemaToVisualModel(schema)
    const html = generateDashboardHTML(model)

    expect(html).toContain("const schema =")
  })
})
