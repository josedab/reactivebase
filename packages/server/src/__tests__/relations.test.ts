import { describe, it, expect } from "vitest"
import { resolveRelations, buildQueryWithIncludes } from "../query-builder/relation-resolver.js"
import { defineSchema, defineTable, v } from "../schema/index.js"

const schema = defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
  }),
  tasks: defineTable({
    title: v.string(),
    assigneeId: v.id("users"),
    done: v.boolean(),
  })
    .relation("assignee", { from: "assigneeId", to: "users" })
    .relation("comments", { from: "id", to: "comments.taskId" }),
  comments: defineTable({
    taskId: v.id("tasks"),
    authorId: v.id("users"),
    body: v.string(),
  })
    .relation("author", { from: "authorId", to: "users" }),
})

describe("resolveRelations", () => {
  it("resolves a belongs-to relation", () => {
    const resolved = resolveRelations(schema, "tasks", {
      assignee: { relation: "assignee" },
    })

    expect(resolved).toHaveLength(1)
    expect(resolved[0].sourceColumn).toBe("assigneeId")
    expect(resolved[0].targetTable).toBe("users")
    expect(resolved[0].targetColumn).toBe("id")
  })

  it("resolves a has-many relation", () => {
    const resolved = resolveRelations(schema, "tasks", {
      comments: { relation: "comments" },
    })

    expect(resolved).toHaveLength(1)
    expect(resolved[0].sourceColumn).toBe("id")
    expect(resolved[0].targetTable).toBe("comments")
    expect(resolved[0].targetColumn).toBe("taskId")
  })

  it("resolves multiple relations at once", () => {
    const resolved = resolveRelations(schema, "tasks", {
      assignee: { relation: "assignee" },
      comments: { relation: "comments" },
    })

    expect(resolved).toHaveLength(2)
  })

  it("throws for unknown relation", () => {
    expect(() =>
      resolveRelations(schema, "tasks", {
        unknown: { relation: "unknown" },
      }),
    ).toThrow('Relation "unknown" not found')
  })
})

describe("buildQueryWithIncludes", () => {
  it("wraps base query with lateral joins", () => {
    const resolved = resolveRelations(schema, "tasks", {
      comments: { relation: "comments" },
    })

    const { sql } = buildQueryWithIncludes(
      'SELECT "tasks".* FROM "tasks"',
      [],
      "tasks",
      resolved,
    )

    expect(sql).toContain("_base")
    expect(sql).toContain("LEFT JOIN LATERAL")
    expect(sql).toContain('"comments"')
    expect(sql).toContain("json_agg")
  })

  it("returns unmodified query when no relations", () => {
    const { sql, params } = buildQueryWithIncludes(
      'SELECT * FROM "tasks"',
      [1],
      "tasks",
      [],
    )

    expect(sql).toBe('SELECT * FROM "tasks"')
    expect(params).toEqual([1])
  })

  it("supports limit in relation config", () => {
    const resolved = resolveRelations(schema, "tasks", {
      comments: { relation: "comments", limit: 5 },
    })

    const { sql } = buildQueryWithIncludes(
      'SELECT "tasks".* FROM "tasks"',
      [],
      "tasks",
      resolved,
    )

    expect(sql).toContain("LIMIT 5")
  })

  it("supports orderBy in relation config", () => {
    const resolved = resolveRelations(schema, "tasks", {
      comments: { relation: "comments", orderBy: { createdAt: "desc" } },
    })

    const { sql } = buildQueryWithIncludes(
      'SELECT "tasks".* FROM "tasks"',
      [],
      "tasks",
      resolved,
    )

    expect(sql).toContain("ORDER BY")
    expect(sql).toContain("DESC")
  })
})
