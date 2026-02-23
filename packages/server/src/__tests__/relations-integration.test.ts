import { describe, it, expect } from "vitest"
import { defineSchema, defineTable, v } from "../schema/index.js"
import { QueryBuilder } from "../query-builder/query-builder.js"
import { resolveRelations, buildQueryWithIncludes } from "../query-builder/relation-resolver.js"

/**
 * End-to-end tests for query building with relations.
 * Validates that the full pipeline from schema → query builder → SQL
 * produces correct, executable SQL.
 */

const schema = defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    role: v.enum("admin", "member"),
  }),
  teams: defineTable({
    name: v.string(),
    ownerId: v.id("users"),
  })
    .relation("owner", { from: "ownerId", to: "users" })
    .relation("members", { from: "id", to: "team_members.teamId" }),
  team_members: defineTable({
    teamId: v.id("teams"),
    userId: v.id("users"),
    role: v.string(),
  })
    .relation("team", { from: "teamId", to: "teams" })
    .relation("user", { from: "userId", to: "users" }),
  tasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    assigneeId: v.id("users"),
    teamId: v.id("teams"),
    done: v.boolean({ default: false }),
    priority: v.enum("low", "medium", "high", "critical"),
  })
    .index("by_assignee", ["assigneeId"])
    .index("by_team_status", ["teamId", "done"])
    .relation("assignee", { from: "assigneeId", to: "users" })
    .relation("team", { from: "teamId", to: "teams" })
    .relation("comments", { from: "id", to: "comments.taskId" }),
  comments: defineTable({
    taskId: v.id("tasks"),
    authorId: v.id("users"),
    body: v.string(),
    createdAt: v.timestamp({ default: "now" }),
  })
    .relation("task", { from: "taskId", to: "tasks" })
    .relation("author", { from: "authorId", to: "users" }),
})

describe("query builder with relations - SQL generation", () => {
  it("generates valid SQL for a filtered query with includes", () => {
    const builder = new QueryBuilder("tasks")
      .where({ assigneeId: "user_1", done: false })
      .orderBy("priority", "desc")
      .limit(20)

    const built = builder.build()

    // Resolve relations and wrap with lateral joins
    const resolved = resolveRelations(schema, "tasks", {
      assignee: { relation: "assignee" },
      comments: { relation: "comments", limit: 10, orderBy: { createdAt: "desc" } },
    })

    const { sql, params } = buildQueryWithIncludes(built.sql, built.params, "tasks", resolved)

    // SQL structure checks
    expect(sql).toContain('SELECT "_base".*')
    expect(sql).toContain("_rel_assignee")
    expect(sql).toContain("_rel_comments")
    expect(sql).toContain("LEFT JOIN LATERAL")
    expect(sql).toContain("json_agg")

    // Comments relation should have limit and order
    expect(sql).toContain("LIMIT 10")
    expect(sql).toContain("ORDER BY")
    expect(sql).toContain("DESC")

    // Base query params preserved
    expect(params).toEqual(["user_1", false])
  })

  it("generates correct SQL for belongs-to relation", () => {
    const builder = new QueryBuilder("comments").where({ taskId: "task_1" })

    const built = builder.build()

    const resolved = resolveRelations(schema, "comments", {
      author: { relation: "author" },
    })

    const { sql } = buildQueryWithIncludes(built.sql, built.params, "comments", resolved)

    // Should join users table via authorId → users.id
    expect(sql).toContain('"users"."id" = "_base"."authorId"')
    expect(sql).toContain("COALESCE")
  })

  it("generates correct SQL for has-many relation", () => {
    const builder = new QueryBuilder("tasks")

    const built = builder.build()

    const resolved = resolveRelations(schema, "tasks", {
      comments: { relation: "comments" },
    })

    const { sql } = buildQueryWithIncludes(built.sql, built.params, "tasks", resolved)

    // Should join comments table via comments.taskId → tasks.id
    expect(sql).toContain('"comments"."taskId" = "_base"."id"')
  })

  it("combines joins and includes correctly", () => {
    const builder = new QueryBuilder("tasks")
      .where({ teamId: "team_1" })
      .join("users", "assigneeId", "id", "LEFT")
      .select("tasks.*", "users.name as assigneeName")

    const built = builder.build()

    // The base query should have both the join and the where
    expect(built.sql).toContain('LEFT JOIN "users"')
    expect(built.sql).toContain('"assigneeId"')

    // Dependencies should track both tables
    const deps = builder.getDependencies()
    expect(deps.some((d) => d.table === "tasks")).toBe(true)
    expect(deps.some((d) => d.table === "users")).toBe(true)
  })

  it("tracks dependencies through relation includes", () => {
    const builder = new QueryBuilder("tasks").where({ assigneeId: "user_1" })

    const deps = builder.getDependencies()

    // Base dependency
    expect(deps).toContainEqual({
      table: "tasks",
      filters: { assigneeId: "user_1" },
    })
  })
})

describe("schema relation validation", () => {
  it("schema has correct relation definitions", () => {
    const tasksTable = schema.tables["tasks"]
    expect(tasksTable.relations).toHaveLength(3)

    const assigneeRel = tasksTable.relations.find((r) => r.name === "assignee")
    expect(assigneeRel).toBeDefined()
    expect(assigneeRel!.from).toBe("assigneeId")
    expect(assigneeRel!.to).toBe("users")

    const commentsRel = tasksTable.relations.find((r) => r.name === "comments")
    expect(commentsRel).toBeDefined()
    expect(commentsRel!.from).toBe("id")
    expect(commentsRel!.to).toBe("comments.taskId")
  })

  it("schema validates all foreign key references", () => {
    // All v.id() references should resolve to valid tables
    for (const tableName of schema.tableNames) {
      const table = schema.tables[tableName]
      for (const [colName, validator] of Object.entries(table.columns)) {
        if (validator.referencedTable) {
          expect(
            schema.tableNames,
            `Column ${tableName}.${colName} references non-existent table ${validator.referencedTable}`,
          ).toContain(validator.referencedTable)
        }
      }
    }
  })

  it("indexes reference valid columns", () => {
    for (const tableName of schema.tableNames) {
      const table = schema.tables[tableName]
      for (const index of table.indexes) {
        for (const col of index.columns) {
          expect(
            Object.keys(table.columns),
            `Index ${index.name} on ${tableName} references non-existent column ${col}`,
          ).toContain(col)
        }
      }
    }
  })
})
