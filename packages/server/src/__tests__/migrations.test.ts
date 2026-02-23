import { describe, it, expect } from "vitest"
import { generateCreateTableSQL, generateIndexSQL, generateMigrationSQL } from "../schema/migrations.js"
import { defineSchema, defineTable, v } from "../schema/index.js"

describe("migration generation", () => {
  it("generates CREATE TABLE SQL", () => {
    const sql = generateCreateTableSQL("users", {
      name: v.string(),
      email: v.string(),
      age: v.optional(v.integer()),
    })

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "users"')
    expect(sql).toContain('"name" text NOT NULL')
    expect(sql).toContain('"email" text NOT NULL')
    expect(sql).toContain('"age" integer')
    expect(sql).toContain("id text PRIMARY KEY")
  })

  it("generates default values", () => {
    const sql = generateCreateTableSQL("tasks", {
      done: v.boolean({ default: false }),
      createdAt: v.timestamp({ default: "now" }),
    })

    expect(sql).toContain("DEFAULT false")
    expect(sql).toContain("DEFAULT now()")
  })

  it("generates enum check constraints", () => {
    const sql = generateCreateTableSQL("tasks", {
      priority: v.enum("low", "medium", "high"),
    })

    expect(sql).toContain("CHECK")
    expect(sql).toContain("'low'")
    expect(sql).toContain("'medium'")
    expect(sql).toContain("'high'")
  })

  it("generates index SQL", () => {
    const sql = generateIndexSQL("users", "users_by_email", ["email"], true)

    expect(sql).toContain("CREATE UNIQUE INDEX")
    expect(sql).toContain('"users_by_email"')
    expect(sql).toContain('ON "users"')
    expect(sql).toContain('"email"')
  })

  it("generates full migration from schema", () => {
    const schema = defineSchema({
      users: defineTable({
        name: v.string(),
        email: v.string(),
      }).index("by_email", ["email"], { unique: true }),

      tasks: defineTable({
        title: v.string(),
        assigneeId: v.id("users"),
      }).index("by_assignee", ["assigneeId"]),
    })

    const migration = generateMigrationSQL(schema)

    expect(migration.up).toContain("_reactivebase_migrations")
    expect(migration.up).toContain('CREATE TABLE IF NOT EXISTS "users"')
    expect(migration.up).toContain('CREATE TABLE IF NOT EXISTS "tasks"')
    expect(migration.up).toContain("CREATE UNIQUE INDEX")
    expect(migration.down).toContain('DROP TABLE IF EXISTS "users"')
    expect(migration.down).toContain('DROP TABLE IF EXISTS "tasks"')
  })
})
