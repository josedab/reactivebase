import { describe, it, expect, beforeEach } from "vitest"
import { MigrationManager } from "../migrations/migration-manager.js"
import { defineSchema, defineTable, v } from "../schema/index.js"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rm } from "node:fs/promises"

const testDir = join(tmpdir(), `rb-migrations-${Date.now()}`)
const schema = defineSchema({
  users: defineTable({ name: v.string(), email: v.string() }),
  tasks: defineTable({ title: v.string(), done: v.boolean({ default: false }) }),
})

describe("MigrationManager", () => {
  let manager: MigrationManager

  beforeEach(async () => {
    const dir = join(testDir, String(Date.now()))
    manager = new MigrationManager(dir)
  })

  it("generates migration files", async () => {
    const result = await manager.generate(schema, "initial")

    expect(result.version).toBeDefined()
    expect(result.name).toBe("initial")
    expect(result.upSQL).toContain("CREATE TABLE")
    expect(result.downSQL).toContain("DROP TABLE")
  })

  it("lists migration files", async () => {
    await manager.generate(schema, "first")
    await new Promise((r) => setTimeout(r, 10)) // Ensure different timestamps
    await manager.generate(schema, "second")

    const files = await manager.getMigrationFiles()
    expect(files).toHaveLength(2)
    expect(files[0].name).toBe("first")
    expect(files[1].name).toBe("second")
  })

  it("returns empty for non-existent dir", async () => {
    const m = new MigrationManager("/nonexistent/path")
    const files = await m.getMigrationFiles()
    expect(files).toHaveLength(0)
  })
})

describe("MigrationManager with mock DB", () => {
  const appliedVersions: string[] = []
  const executedSQL: string[] = []

  function createMockQuery() {
    return async (sql: string, params?: unknown[]) => {
      executedSQL.push(sql)

      if (sql.includes('CREATE TABLE IF NOT EXISTS "_reactivebase_migrations"')) {
        return { rows: [] }
      }
      if (sql.includes("SELECT version") && sql.includes("_reactivebase_migrations")) {
        return {
          rows: appliedVersions.map((v) => ({
            version: v,
            name: "test",
            appliedAt: new Date().toISOString(),
          })),
        }
      }
      if (sql.includes('INSERT INTO "_reactivebase_migrations"')) {
        appliedVersions.push(params?.[0] as string)
        return { rows: [] }
      }
      if (sql.includes('DELETE FROM "_reactivebase_migrations"')) {
        const idx = appliedVersions.indexOf(params?.[0] as string)
        if (idx >= 0) appliedVersions.splice(idx, 1)
        return { rows: [] }
      }
      return { rows: [] }
    }
  }

  beforeEach(() => {
    appliedVersions.length = 0
    executedSQL.length = 0
  })

  it("applies pending migrations", async () => {
    const dir = join(testDir, `apply-${Date.now()}`)
    const manager = new MigrationManager(dir, createMockQuery())

    await manager.generate(schema, "init")

    const result = await manager.apply()
    expect(result.applied).toHaveLength(1)
    expect(appliedVersions).toHaveLength(1)
  })

  it("skips already applied migrations", async () => {
    const dir = join(testDir, `skip-${Date.now()}`)
    const manager = new MigrationManager(dir, createMockQuery())

    const generated = await manager.generate(schema, "init")

    // Apply first time
    await manager.apply()
    expect(appliedVersions).toHaveLength(1)

    // Apply again — should skip
    const result2 = await manager.apply()
    expect(result2.applied).toHaveLength(0)
  })

  it("reports migration status", async () => {
    const dir = join(testDir, `status-${Date.now()}`)
    const manager = new MigrationManager(dir, createMockQuery())

    await manager.generate(schema, "v1")

    const statusBefore = await manager.status()
    expect(statusBefore.total).toBe(1)
    expect(statusBefore.pending).toBe(1)
    expect(statusBefore.applied).toBe(0)

    await manager.apply()

    const statusAfter = await manager.status()
    expect(statusAfter.applied).toBe(1)
    expect(statusAfter.pending).toBe(0)
  })

  it("rolls back the last migration", async () => {
    const dir = join(testDir, `rollback-${Date.now()}`)
    const manager = new MigrationManager(dir, createMockQuery())

    await manager.generate(schema, "init")
    await manager.apply()
    expect(appliedVersions).toHaveLength(1)

    const result = await manager.rollback()
    expect(result.rolledBack).toBeDefined()
    expect(appliedVersions).toHaveLength(0)
  })

  it("returns message when no migrations to rollback", async () => {
    const dir = join(testDir, `empty-rollback-${Date.now()}`)
    const manager = new MigrationManager(dir, createMockQuery())

    const result = await manager.rollback()
    expect(result.rolledBack).toBeNull()
    expect(result.message).toContain("No migrations")
  })
})
