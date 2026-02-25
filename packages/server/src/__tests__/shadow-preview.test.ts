import { describe, it, expect } from "vitest"
import {
  MigrationPreview,
  buildCreateShadowSchemaSQL,
  buildDropShadowSchemaSQL,
  buildCopySchemaSQL,
  buildSetSearchPathSQL,
  buildExplainAnalyzeSQL,
  buildMissingIndexCheckSQL,
  type PoolLike,
  type PoolClientLike,
  type _MigrationPreviewRequest,
} from "../migrations/shadow-preview.js"

describe("Shadow Preview SQL Helpers", () => {
  it("builds CREATE SCHEMA SQL", () => {
    const sql = buildCreateShadowSchemaSQL("_shadow_test")
    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS "_shadow_test"')
  })

  it("builds DROP SCHEMA SQL with CASCADE", () => {
    const sql = buildDropShadowSchemaSQL("_shadow_test")
    expect(sql).toContain('DROP SCHEMA IF EXISTS "_shadow_test" CASCADE')
  })

  it("builds copy schema SQL using DO block", () => {
    const sql = buildCopySchemaSQL("public", "_shadow_test")
    expect(sql).toContain("pg_tables")
    expect(sql).toContain("_shadow_test")
    expect(sql).toContain("INCLUDING ALL")
  })

  it("builds SET search_path SQL", () => {
    const sql = buildSetSearchPathSQL("_shadow_test")
    expect(sql).toContain('SET search_path TO "_shadow_test"')
  })

  it("builds EXPLAIN ANALYZE SQL", () => {
    const sql = buildExplainAnalyzeSQL("SELECT * FROM tasks")
    expect(sql).toContain("EXPLAIN (ANALYZE, FORMAT JSON)")
    expect(sql).toContain("SELECT * FROM tasks")
  })

  it("builds missing index check SQL with parameterized schema", () => {
    const { sql, params } = buildMissingIndexCheckSQL("_shadow_test")
    expect(sql).toContain("pg_stat_user_tables")
    expect(sql).toContain("schemaname = $1")
    expect(params).toEqual(["_shadow_test"])
  })
})

describe("MigrationPreview", () => {
  function createMockPool(
    options: {
      migrationFails?: boolean
      queryFails?: boolean
    } = {},
  ): PoolLike {
    const queries: string[] = []
    return {
      async connect(): Promise<PoolClientLike> {
        return {
          async query(sql: string, _params?: unknown[]) {
            queries.push(sql)
            if (options.migrationFails && sql.includes("ALTER TABLE")) {
              throw new Error("column does not exist")
            }
            if (options.queryFails && sql.includes("SELECT * FROM tasks")) {
              throw new Error("relation does not exist")
            }
            return { rows: [], rowCount: 0 }
          },
          release() {},
        }
      },
    }
  }

  it("runs a successful migration preview", async () => {
    const pool = createMockPool()
    const preview = new MigrationPreview(pool, { autoCleanup: true })

    const report = await preview.run({
      migrationSQL: 'ALTER TABLE tasks ADD COLUMN "priority" integer;',
      recentQueries: [{ sql: "SELECT * FROM tasks", avgDurationMs: 10 }],
    })

    expect(report.status).toBe("safe")
    expect(report.migration.applied).toBe(true)
    expect(report.breakingChanges).toHaveLength(0)
    expect(report.durationMs).toBeGreaterThanOrEqual(0)
    expect(report.summary).toContain("SAFE")
  })

  it("reports breaking changes when migration fails", async () => {
    const pool = createMockPool({ migrationFails: true })
    const preview = new MigrationPreview(pool)

    const report = await preview.run({
      migrationSQL: "ALTER TABLE tasks DROP COLUMN nonexistent;",
      recentQueries: [],
    })

    expect(report.status).toBe("breaking")
    expect(report.migration.applied).toBe(false)
    expect(report.migration.error).toContain("column does not exist")
    expect(report.breakingChanges.length).toBeGreaterThan(0)
  })

  it("reports query failures as breaking changes", async () => {
    const pool = createMockPool({ queryFails: true })
    const preview = new MigrationPreview(pool)

    const report = await preview.run({
      migrationSQL: 'ALTER TABLE tasks ADD COLUMN "x" integer;',
      recentQueries: [{ sql: "SELECT * FROM tasks", functionName: "listTasks" }],
    })

    expect(report.queryResults).toHaveLength(1)
    expect(report.queryResults[0].status).toBe("error")
    expect(report.breakingChanges.length).toBeGreaterThan(0)
  })

  it("generates a PR comment", async () => {
    const pool = createMockPool()
    const preview = new MigrationPreview(pool)

    const report = await preview.run({
      migrationSQL: 'ALTER TABLE tasks ADD COLUMN "priority" integer;',
      recentQueries: [],
    })

    const comment = preview.generatePRComment(report, "Add priority column")
    expect(comment).toContain("Migration Preview Report")
    expect(comment).toContain("SAFE")
    expect(comment).toContain("Add priority column")
  })

  it("respects maxReplayQueries option", async () => {
    const pool = createMockPool()
    const preview = new MigrationPreview(pool, { maxReplayQueries: 2 })

    const queries = Array.from({ length: 10 }, (_, i) => ({
      sql: `SELECT * FROM t${i}`,
    }))
    const report = await preview.run({
      migrationSQL: "SELECT 1;",
      recentQueries: queries,
    })

    expect(report.queryResults.length).toBeLessThanOrEqual(2)
  })
})
