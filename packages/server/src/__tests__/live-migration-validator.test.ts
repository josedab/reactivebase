import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  LiveMigrationValidator,
  MigrationCIReporter,
  MigrationValidationError,
  type ShadowDatabase,
} from "../migrations/live-migration-validator.js"

// ── Helpers ───────────────────────────────────────────────────────────────────

let validator: LiveMigrationValidator

beforeEach(() => {
  validator = new LiveMigrationValidator()
})

// ── analyze() ─────────────────────────────────────────────────────────────────

describe("LiveMigrationValidator.analyze()", () => {
  it("returns safe empty analysis for empty SQL", () => {
    const result = validator.analyze("")
    expect(result.safe).toBe(true)
    expect(result.risk).toBe("none")
    expect(result.breakingChanges).toHaveLength(0)
    expect(result.summary.totalStatements).toBe(0)
  })

  it("returns safe empty analysis for whitespace-only SQL", () => {
    const result = validator.analyze("   \n  ")
    expect(result.safe).toBe(true)
  })

  it("detects DROP TABLE as breaking change", () => {
    const result = validator.analyze("DROP TABLE users")
    expect(result.safe).toBe(false)
    expect(result.breakingChanges.some((bc) => bc.type === "drop_table")).toBe(true)
    expect(result.breakingChanges[0].severity).toBe("error")
    expect(result.risk).toBe("critical")
  })

  it("detects DROP COLUMN as breaking change", () => {
    const result = validator.analyze("ALTER TABLE users DROP COLUMN email")
    expect(result.breakingChanges.some((bc) => bc.type === "drop_column")).toBe(true)
    expect(result.breakingChanges[0].object).toBe("users.email")
  })

  it("detects column TYPE change", () => {
    const result = validator.analyze("ALTER TABLE users ALTER COLUMN age TYPE bigint")
    expect(result.breakingChanges.some((bc) => bc.type === "type_change")).toBe(true)
    expect(result.breakingChanges[0].severity).toBe("warning")
  })

  it("detects ADD COLUMN NOT NULL without DEFAULT", () => {
    const result = validator.analyze("ALTER TABLE users ADD COLUMN name text NOT NULL")
    expect(result.breakingChanges.some((bc) => bc.type === "not_null_added")).toBe(true)
  })

  it("detects ADD CONSTRAINT without NOT VALID", () => {
    const result = validator.analyze(
      "ALTER TABLE users ADD CONSTRAINT fk_team FOREIGN KEY (team_id) REFERENCES teams(id)",
    )
    expect(result.breakingChanges.some((bc) => bc.type === "constraint_added")).toBe(true)
  })

  it("detects RENAME TABLE", () => {
    const result = validator.analyze("ALTER TABLE users RENAME TO accounts")
    expect(result.breakingChanges.some((bc) => bc.type === "rename_table")).toBe(true)
  })

  it("detects RENAME COLUMN", () => {
    const result = validator.analyze("ALTER TABLE users RENAME COLUMN name TO full_name")
    expect(result.breakingChanges.some((bc) => bc.type === "rename_column")).toBe(true)
    expect(result.breakingChanges[0].object).toBe("users.name")
  })

  it("safe ADD COLUMN (nullable) does not produce breaking changes", () => {
    const result = validator.analyze("ALTER TABLE users ADD COLUMN bio text")
    expect(result.breakingChanges).toHaveLength(0)
    expect(result.safe).toBe(true)
  })

  it("safe CREATE TABLE has no breaking changes", () => {
    const result = validator.analyze("CREATE TABLE tasks (id uuid PRIMARY KEY, title text)")
    expect(result.safe).toBe(true)
    expect(result.risk).toBe("none")
  })

  it("detects multiple concurrent changes", () => {
    const sql = `
      ALTER TABLE users DROP COLUMN email;
      ALTER TABLE users RENAME COLUMN name TO full_name;
      ALTER TABLE orders ALTER COLUMN total TYPE numeric
    `
    const result = validator.analyze(sql)
    expect(result.breakingChanges.length).toBeGreaterThanOrEqual(3)
    expect(result.summary.breakingChangeCount).toBeGreaterThanOrEqual(3)
  })
})

// ── Lock Duration Estimation ────────────────────────────────────────────────

describe("estimateLockDuration()", () => {
  it("returns low lock for ADD COLUMN", () => {
    const result = validator.estimateLockDuration("ALTER TABLE users ADD COLUMN bio text")
    expect(result.lockType).toBe("access_exclusive")
    expect(result.estimatedMs).toBeLessThanOrEqual(100)
  })

  it("returns high lock for ADD COLUMN NOT NULL", () => {
    const result = validator.estimateLockDuration("ALTER TABLE users ADD COLUMN status text NOT NULL")
    expect(result.estimatedMs).toBeGreaterThan(100)
  })

  it("returns zero lock for CREATE TABLE", () => {
    const result = validator.estimateLockDuration("CREATE TABLE test (id int)")
    expect(result.lockType).toBe("none")
    expect(result.estimatedMs).toBe(0)
  })

  it("returns share lock for CREATE INDEX CONCURRENTLY", () => {
    const result = validator.estimateLockDuration("CREATE INDEX CONCURRENTLY idx ON users (email)")
    expect(result.lockType).toBe("share")
    expect(result.canRunConcurrently).toBe(true)
  })

  it("scales estimate based on table stats", () => {
    const noStats = validator.estimateLockDuration("ALTER TABLE big_table DROP COLUMN x")
    const withStats = validator.estimateLockDuration("ALTER TABLE big_table DROP COLUMN x", [
      { table: "big_table", rowCount: 10_000_000 },
    ])
    expect(withStats.scalingFactor).toBeGreaterThan(noStats.scalingFactor)
  })
})

// ── simulateOnShadow() ──────────────────────────────────────────────────────

describe("simulateOnShadow()", () => {
  it("throws without shadow database", async () => {
    await expect(validator.simulateOnShadow("SELECT 1")).rejects.toThrow(MigrationValidationError)
  })

  it("executes migration on shadow and reports success", async () => {
    const mockDb: ShadowDatabase = {
      exec: vi
        .fn()
        .mockResolvedValueOnce({ rows: [], affectedRows: 0 }) // pre-migration tables
        .mockResolvedValueOnce({ rows: [], affectedRows: 0 }) // migration itself
        .mockResolvedValueOnce({ rows: [{ name: "new_table" }], affectedRows: 0 }) // post-migration tables
        .mockResolvedValueOnce({ rows: [{ cnt: 5 }], affectedRows: 0 }), // row count
      close: vi.fn().mockResolvedValue(undefined),
    }

    const result = await validator.simulateOnShadow("CREATE TABLE new_table (id int)", undefined, mockDb)
    expect(result.success).toBe(true)
    expect(result.schemaChanges).toContain("Table added: new_table")
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(mockDb.close).toHaveBeenCalled()
  })

  it("reports failure on SQL error", async () => {
    const mockDb: ShadowDatabase = {
      exec: vi
        .fn()
        .mockResolvedValueOnce({ rows: [], affectedRows: 0 }) // setup
        .mockResolvedValueOnce({ rows: [], affectedRows: 0 }) // pre tables
        .mockRejectedValueOnce(new Error("syntax error")), // migration fails
      close: vi.fn().mockResolvedValue(undefined),
    }

    const result = await validator.simulateOnShadow("INVALID SQL", { setupSQL: "SELECT 1" }, mockDb)
    expect(result.success).toBe(false)
    expect(result.error).toContain("syntax error")
  })
})

// ── generateRollbackSQL() ───────────────────────────────────────────────────

describe("generateRollbackSQL()", () => {
  it("generates DROP TABLE for CREATE TABLE", () => {
    const rollback = validator.generateRollbackSQL("CREATE TABLE tasks (id int)")
    expect(rollback.reversible).toBe(true)
    expect(rollback.statements.some((s) => s.includes("DROP TABLE"))).toBe(true)
  })

  it("generates DROP COLUMN for ADD COLUMN", () => {
    const rollback = validator.generateRollbackSQL("ALTER TABLE users ADD COLUMN bio text")
    expect(rollback.reversible).toBe(true)
    expect(rollback.statements.some((s) => s.includes("DROP COLUMN"))).toBe(true)
  })

  it("generates reverse RENAME for RENAME TABLE", () => {
    const rollback = validator.generateRollbackSQL("ALTER TABLE users RENAME TO accounts")
    expect(rollback.reversible).toBe(true)
    expect(rollback.statements.some((s) => s.includes("RENAME TO") && s.includes("users"))).toBe(true)
  })

  it("generates reverse RENAME for RENAME COLUMN", () => {
    const rollback = validator.generateRollbackSQL("ALTER TABLE users RENAME COLUMN name TO full_name")
    expect(rollback.reversible).toBe(true)
    expect(rollback.statements.some((s) => s.includes("RENAME COLUMN") && s.includes("name"))).toBe(true)
  })

  it("generates DROP INDEX for CREATE INDEX", () => {
    const rollback = validator.generateRollbackSQL("CREATE INDEX idx_email ON users (email)")
    expect(rollback.reversible).toBe(true)
    expect(rollback.statements.some((s) => s.includes("DROP INDEX"))).toBe(true)
  })

  it("generates DROP CONSTRAINT for ADD CONSTRAINT", () => {
    const rollback = validator.generateRollbackSQL("ALTER TABLE users ADD CONSTRAINT chk_age CHECK (age > 0)")
    expect(rollback.reversible).toBe(true)
    expect(rollback.statements.some((s) => s.includes("DROP CONSTRAINT"))).toBe(true)
  })

  it("marks DROP TABLE as irreversible", () => {
    const rollback = validator.generateRollbackSQL("DROP TABLE users")
    expect(rollback.reversible).toBe(false)
    expect(rollback.warnings.length).toBeGreaterThan(0)
  })

  it("marks type change as irreversible", () => {
    const rollback = validator.generateRollbackSQL("ALTER TABLE users ALTER COLUMN age TYPE bigint")
    expect(rollback.reversible).toBe(false)
  })

  it("empty SQL produces empty rollback", () => {
    const rollback = validator.generateRollbackSQL("")
    expect(rollback.reversible).toBe(true)
    expect(rollback.statements).toHaveLength(0)
  })

  it("reverses rollback order for proper undo sequence", () => {
    const sql = "CREATE TABLE a (id int); CREATE TABLE b (id int)"
    const rollback = validator.generateRollbackSQL(sql)
    // Last created should be dropped first
    expect(rollback.statements[0]).toContain("b")
    expect(rollback.statements[1]).toContain("a")
  })
})

// ── MigrationCIReporter ─────────────────────────────────────────────────────

describe("MigrationCIReporter", () => {
  it("generates PR comment markdown with risk level", () => {
    const analysis = validator.analyze("ALTER TABLE users DROP COLUMN email")
    const reporter = new MigrationCIReporter()
    const comment = reporter.generatePRComment(analysis)

    expect(comment).toContain("## ")
    expect(comment).toContain("Migration Validation Report")
    expect(comment).toContain("CRITICAL")
    expect(comment).toContain("Breaking Changes")
    expect(comment).toContain("drop_column")
    expect(comment).toContain("|") // table formatting
  })

  it("generates safe report for non-breaking migration", () => {
    const analysis = validator.analyze("CREATE TABLE logs (id int)")
    const reporter = new MigrationCIReporter()
    const comment = reporter.generatePRComment(analysis)

    expect(comment).toContain("✅")
    expect(comment).toContain("SAFE")
  })

  it("includes rollback section by default", () => {
    const analysis = validator.analyze("CREATE TABLE test (id int)")
    const reporter = new MigrationCIReporter({ includeRollback: true })
    const comment = reporter.generatePRComment(analysis)
    expect(comment).toContain("Rollback Plan")
  })

  it("includes lock estimate section", () => {
    const analysis = validator.analyze("ALTER TABLE users ADD COLUMN bio text")
    const reporter = new MigrationCIReporter({ includeLockEstimates: true })
    const comment = reporter.generatePRComment(analysis)
    expect(comment).toContain("Lock Duration")
  })

  it("shouldBlockMerge returns true for critical breaking changes", () => {
    const analysis = validator.analyze("ALTER TABLE users DROP COLUMN email")
    const reporter = new MigrationCIReporter({ maxBreakingChanges: 0 })
    expect(reporter.shouldBlockMerge(analysis)).toBe(true)
  })

  it("shouldBlockMerge returns false for safe migrations", () => {
    const analysis = validator.analyze("CREATE TABLE logs (id int)")
    const reporter = new MigrationCIReporter()
    expect(reporter.shouldBlockMerge(analysis)).toBe(false)
  })

  it("shouldBlockMerge respects maxLockTimeMs", () => {
    const analysis = validator.analyze("ALTER TABLE users DROP COLUMN x; ALTER TABLE users DROP COLUMN y")
    const reporter = new MigrationCIReporter({ maxBreakingChanges: 100, maxLockTimeMs: 1 })
    expect(reporter.shouldBlockMerge(analysis)).toBe(true)
  })

  it("generates GitHub Actions YAML", () => {
    const reporter = new MigrationCIReporter()
    const yaml = reporter.generateGitHubActionYAML()
    expect(yaml).toContain("Migration Validation")
    expect(yaml).toContain("pull_request")
    expect(yaml).toContain("actions/checkout")
  })
})

// ── MigrationValidationError ────────────────────────────────────────────────

describe("MigrationValidationError", () => {
  it("has correct name", () => {
    const err = new MigrationValidationError("test")
    expect(err.name).toBe("MigrationValidationError")
    expect(err).toBeInstanceOf(Error)
  })
})
