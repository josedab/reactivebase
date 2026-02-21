import { describe, it, expect } from "vitest"
import { QueryBuilder } from "../query-builder/query-builder.js"

describe("query builder", () => {
  it("builds a simple SELECT query", () => {
    const qb = new QueryBuilder("tasks")
    const built = qb.build()

    expect(built.sql).toBe('SELECT "tasks".*\nFROM "tasks"')
    expect(built.params).toEqual([])
  })

  it("builds a query with WHERE clause", () => {
    const qb = new QueryBuilder("tasks").where({ done: false })
    const built = qb.build()

    expect(built.sql).toContain('WHERE "done" = $1')
    expect(built.params).toEqual([false])
  })

  it("builds a query with multiple WHERE conditions", () => {
    const qb = new QueryBuilder("tasks")
      .where({ assigneeId: "user1" })
      .where("priority", "in", ["high", "critical"])
    const built = qb.build()

    expect(built.sql).toContain('WHERE "assigneeId" = $1 AND "priority" = ANY($2)')
    expect(built.params).toEqual(["user1", ["high", "critical"]])
  })

  it("builds a query with ORDER BY", () => {
    const qb = new QueryBuilder("tasks")
      .orderBy("priority", "desc")
      .orderBy("createdAt", "asc")
    const built = qb.build()

    expect(built.sql).toContain('ORDER BY "priority" DESC, "createdAt" ASC')
  })

  it("builds a query with LIMIT and OFFSET", () => {
    const qb = new QueryBuilder("tasks").limit(20).offset(10)
    const built = qb.build()

    expect(built.sql).toContain("LIMIT 20")
    expect(built.sql).toContain("OFFSET 10")
  })

  it("builds a query with JOIN", () => {
    const qb = new QueryBuilder("tasks")
      .join("users", "assigneeId", "id")
    const built = qb.build()

    expect(built.sql).toContain(
      'INNER JOIN "users" ON "tasks"."assigneeId" = "users"."id"',
    )
  })

  it("builds a query with GROUP BY", () => {
    const qb = new QueryBuilder("tasks")
      .groupBy("priority")
      .select("priority", 'COUNT(*) as "count"')
    const built = qb.build()

    expect(built.sql).toContain('GROUP BY "priority"')
  })

  it("is immutable - chaining creates new instances", () => {
    const base = new QueryBuilder("tasks")
    const filtered = base.where({ done: false })
    const ordered = filtered.orderBy("priority", "desc")

    const baseBuilt = base.build()
    const filteredBuilt = filtered.build()
    const orderedBuilt = ordered.build()

    expect(baseBuilt.params).toEqual([])
    expect(filteredBuilt.params).toEqual([false])
    expect(orderedBuilt.sql).toContain("ORDER BY")
    expect(filteredBuilt.sql).not.toContain("ORDER BY")
  })

  it("tracks dependencies", () => {
    const qb = new QueryBuilder("tasks")
      .where({ assigneeId: "user1", done: false })
      .join("users", "assigneeId")

    const deps = qb.getDependencies()

    expect(deps).toHaveLength(2)
    expect(deps[0].table).toBe("tasks")
    expect(deps[0].filters).toEqual({ assigneeId: "user1", done: false })
    expect(deps[1].table).toBe("users")
  })

  it("handles comparison operators", () => {
    const qb = new QueryBuilder("tasks")
      .where("dueDate", "<", new Date("2026-01-01"))
      .where("priority", ">=", 3)
    const built = qb.build()

    expect(built.sql).toContain('"dueDate" < $1')
    expect(built.sql).toContain('"priority" >= $2')
  })
})
