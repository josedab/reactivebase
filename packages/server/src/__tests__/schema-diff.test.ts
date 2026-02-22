import { describe, it, expect } from "vitest"
import { diffSchema, generateDiffSQL, introspectionQueries, type DatabaseState } from "../migrations/schema-diff.js"
import { defineSchema, defineTable, v } from "../schema/index.js"

const schema = defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    role: v.enum("admin", "member"),
  }).index("by_email", ["email"], { unique: true }),

  tasks: defineTable({
    title: v.string(),
    done: v.boolean({ default: false }),
    priority: v.enum("low", "medium", "high"),
    assigneeId: v.id("users"),
  }).index("by_assignee", ["assigneeId"]),
})

describe("diffSchema", () => {
  it("detects new tables", () => {
    const dbState: DatabaseState = { tables: ["users"], columns: [
      { table: "users", column: "id", dataType: "text", isNullable: false, defaultValue: null },
      { table: "users", column: "name", dataType: "text", isNullable: false, defaultValue: null },
      { table: "users", column: "email", dataType: "text", isNullable: false, defaultValue: null },
      { table: "users", column: "role", dataType: "text", isNullable: false, defaultValue: null },
    ], indexes: [] }

    const diff = diffSchema(schema, dbState)
    expect(diff.addTables).toContain("tasks")
    expect(diff.dropTables).toHaveLength(0)
  })

  it("detects dropped tables", () => {
    const dbState: DatabaseState = {
      tables: ["users", "tasks", "old_logs"],
      columns: [
        { table: "users", column: "id", dataType: "text", isNullable: false, defaultValue: null },
        { table: "users", column: "name", dataType: "text", isNullable: false, defaultValue: null },
        { table: "users", column: "email", dataType: "text", isNullable: false, defaultValue: null },
        { table: "users", column: "role", dataType: "text", isNullable: false, defaultValue: null },
        { table: "tasks", column: "id", dataType: "text", isNullable: false, defaultValue: null },
        { table: "tasks", column: "title", dataType: "text", isNullable: false, defaultValue: null },
        { table: "tasks", column: "done", dataType: "boolean", isNullable: false, defaultValue: null },
        { table: "tasks", column: "priority", dataType: "text", isNullable: false, defaultValue: null },
        { table: "tasks", column: "assigneeId", dataType: "text", isNullable: false, defaultValue: null },
        { table: "old_logs", column: "id", dataType: "text", isNullable: false, defaultValue: null },
      ],
      indexes: [],
    }

    const diff = diffSchema(schema, dbState)
    expect(diff.dropTables).toContain("old_logs")
    expect(diff.isDestructive).toBe(true)
  })

  it("detects new columns", () => {
    const dbState: DatabaseState = {
      tables: ["users"],
      columns: [
        { table: "users", column: "id", dataType: "text", isNullable: false, defaultValue: null },
        { table: "users", column: "name", dataType: "text", isNullable: false, defaultValue: null },
        // email and role are missing
      ],
      indexes: [],
    }

    const diff = diffSchema(schema, dbState)
    expect(diff.addColumns).toHaveLength(2)
    expect(diff.addColumns.map(c => c.column)).toContain("email")
    expect(diff.addColumns.map(c => c.column)).toContain("role")
  })

  it("detects dropped columns", () => {
    const dbState: DatabaseState = {
      tables: ["users"],
      columns: [
        { table: "users", column: "id", dataType: "text", isNullable: false, defaultValue: null },
        { table: "users", column: "name", dataType: "text", isNullable: false, defaultValue: null },
        { table: "users", column: "email", dataType: "text", isNullable: false, defaultValue: null },
        { table: "users", column: "role", dataType: "text", isNullable: false, defaultValue: null },
        { table: "users", column: "old_field", dataType: "text", isNullable: true, defaultValue: null },
      ],
      indexes: [],
    }

    const diff = diffSchema(schema, dbState)
    expect(diff.dropColumns).toHaveLength(1)
    expect(diff.dropColumns[0].column).toBe("old_field")
    expect(diff.isDestructive).toBe(true)
  })

  it("detects new indexes", () => {
    const dbState: DatabaseState = {
      tables: ["users"],
      columns: [
        { table: "users", column: "id", dataType: "text", isNullable: false, defaultValue: null },
        { table: "users", column: "name", dataType: "text", isNullable: false, defaultValue: null },
        { table: "users", column: "email", dataType: "text", isNullable: false, defaultValue: null },
        { table: "users", column: "role", dataType: "text", isNullable: false, defaultValue: null },
      ],
      indexes: [], // No indexes exist yet
    }

    const diff = diffSchema(schema, dbState)
    expect(diff.addIndexes).toHaveLength(1) // by_email
    expect(diff.addIndexes[0].name).toBe("users_by_email")
  })

  it("ignores internal tables (prefixed with _)", () => {
    const dbState: DatabaseState = {
      tables: ["users", "tasks", "_reactivebase_migrations"],
      columns: [
        { table: "users", column: "id", dataType: "text", isNullable: false, defaultValue: null },
        { table: "users", column: "name", dataType: "text", isNullable: false, defaultValue: null },
        { table: "users", column: "email", dataType: "text", isNullable: false, defaultValue: null },
        { table: "users", column: "role", dataType: "text", isNullable: false, defaultValue: null },
        { table: "tasks", column: "id", dataType: "text", isNullable: false, defaultValue: null },
        { table: "tasks", column: "title", dataType: "text", isNullable: false, defaultValue: null },
        { table: "tasks", column: "done", dataType: "boolean", isNullable: false, defaultValue: null },
        { table: "tasks", column: "priority", dataType: "text", isNullable: false, defaultValue: null },
        { table: "tasks", column: "assigneeId", dataType: "text", isNullable: false, defaultValue: null },
      ],
      indexes: [
        { table: "users", name: "users_by_email", columns: ["email"], unique: true },
        { table: "tasks", name: "tasks_by_assignee", columns: ["assigneeId"], unique: false },
      ],
    }

    const diff = diffSchema(schema, dbState)
    expect(diff.dropTables).not.toContain("_reactivebase_migrations")
  })

  it("reports no changes for matching schema", () => {
    const dbState: DatabaseState = {
      tables: ["users", "tasks"],
      columns: [
        { table: "users", column: "id", dataType: "text", isNullable: false, defaultValue: null },
        { table: "users", column: "name", dataType: "text", isNullable: false, defaultValue: null },
        { table: "users", column: "email", dataType: "text", isNullable: false, defaultValue: null },
        { table: "users", column: "role", dataType: "text", isNullable: false, defaultValue: null },
        { table: "tasks", column: "id", dataType: "text", isNullable: false, defaultValue: null },
        { table: "tasks", column: "title", dataType: "text", isNullable: false, defaultValue: null },
        { table: "tasks", column: "done", dataType: "boolean", isNullable: false, defaultValue: null },
        { table: "tasks", column: "priority", dataType: "text", isNullable: false, defaultValue: null },
        { table: "tasks", column: "assigneeId", dataType: "text", isNullable: false, defaultValue: null },
      ],
      indexes: [
        { table: "users", name: "users_by_email", columns: ["email"], unique: true },
        { table: "tasks", name: "tasks_by_assignee", columns: ["assigneeId"], unique: false },
      ],
    }

    const diff = diffSchema(schema, dbState)
    expect(diff.addTables).toHaveLength(0)
    expect(diff.dropTables).toHaveLength(0)
    expect(diff.addColumns).toHaveLength(0)
    expect(diff.dropColumns).toHaveLength(0)
    expect(diff.isDestructive).toBe(false)
  })
})

describe("generateDiffSQL", () => {
  it("generates ALTER TABLE ADD COLUMN SQL", () => {
    const dbState: DatabaseState = {
      tables: ["users"],
      columns: [
        { table: "users", column: "id", dataType: "text", isNullable: false, defaultValue: null },
        { table: "users", column: "name", dataType: "text", isNullable: false, defaultValue: null },
      ],
      indexes: [],
    }

    const diff = diffSchema(schema, dbState)
    const { up, down } = generateDiffSQL(diff, schema)

    expect(up).toContain("ALTER TABLE")
    expect(up).toContain("ADD COLUMN")
    expect(up).toContain('"email"')
    expect(down).toContain("DROP COLUMN")
  })

  it("generates CREATE TABLE for new tables", () => {
    const dbState: DatabaseState = { tables: [], columns: [], indexes: [] }
    const diff = diffSchema(schema, dbState)
    const { up, down } = generateDiffSQL(diff, schema)

    expect(up).toContain('CREATE TABLE IF NOT EXISTS "users"')
    expect(up).toContain('CREATE TABLE IF NOT EXISTS "tasks"')
    expect(down).toContain('DROP TABLE')
  })
})

describe("introspectionQueries", () => {
  it("returns valid SQL queries", () => {
    const queries = introspectionQueries()
    expect(queries.tablesSQL).toContain("information_schema.tables")
    expect(queries.columnsSQL).toContain("information_schema.columns")
    expect(queries.indexesSQL).toContain("pg_index")
  })
})
