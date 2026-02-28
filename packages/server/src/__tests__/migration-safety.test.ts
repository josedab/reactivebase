import { describe, it, expect } from "vitest"
import { MigrationSafetyNet } from "../migrations/migration-safety.js"

describe("MigrationSafetyNet", () => {
  const safety = new MigrationSafetyNet()

  describe("validate", () => {
    it("returns safe for empty migration", () => {
      const report = safety.validate("")
      expect(report.safe).toBe(true)
      expect(report.risk).toBe("none")
    })

    it("marks safe migrations as safe", () => {
      const report = safety.validate('CREATE TABLE IF NOT EXISTS "tasks" (id TEXT PRIMARY KEY, title TEXT);')
      expect(report.safe).toBe(true)
      expect(report.breakingChanges).toHaveLength(0)
    })

    it("detects DROP TABLE as breaking", () => {
      const report = safety.validate('DROP TABLE users;')
      expect(report.safe).toBe(false)
      expect(report.breakingChanges.length).toBeGreaterThan(0)
      expect(report.breakingChanges[0].type).toBe("drop_table")
    })

    it("detects DROP COLUMN as breaking", () => {
      const report = safety.validate('ALTER TABLE users DROP COLUMN email;')
      expect(report.breakingChanges.some((c) => c.type === "drop_column")).toBe(true)
    })

    it("detects NOT NULL without DEFAULT", () => {
      const report = safety.validate('ALTER TABLE users ADD COLUMN name TEXT NOT NULL;')
      expect(report.issues.some((i) => i.code === "NOT_NULL_NO_DEFAULT")).toBe(true)
      expect(report.safe).toBe(false)
    })

    it("warns about CREATE INDEX without CONCURRENTLY", () => {
      const report = safety.validate('CREATE INDEX idx_users_name ON users (name);')
      expect(report.issues.some((i) => i.code === "INDEX_WITHOUT_CONCURRENTLY")).toBe(true)
    })

    it("does not warn about CONCURRENTLY indexes", () => {
      const report = safety.validate('CREATE INDEX CONCURRENTLY idx_users_name ON users (name);')
      expect(report.issues.some((i) => i.code === "INDEX_WITHOUT_CONCURRENTLY")).toBe(false)
    })

    it("warns about DROP without IF EXISTS", () => {
      const report = safety.validate('DROP TABLE users;')
      expect(report.issues.some((i) => i.code === "DROP_WITHOUT_IF_EXISTS")).toBe(true)
    })

    it("detects type changes", () => {
      const report = safety.validate('ALTER TABLE users ALTER COLUMN age TYPE bigint;')
      expect(report.breakingChanges.some((c) => c.type === "type_change")).toBe(true)
    })

    it("detects table rename", () => {
      const report = safety.validate('ALTER TABLE users RENAME TO accounts;')
      expect(report.breakingChanges.some((c) => c.type === "rename_table")).toBe(true)
    })

    it("detects column rename", () => {
      const report = safety.validate('ALTER TABLE users RENAME COLUMN name TO full_name;')
      expect(report.breakingChanges.some((c) => c.type === "rename_column")).toBe(true)
    })

    it("warns about TRUNCATE", () => {
      const report = safety.validate('TRUNCATE TABLE users;')
      expect(report.issues.some((i) => i.code === "TRUNCATE_TABLE")).toBe(true)
    })
  })

  describe("lock analysis", () => {
    it("estimates lock time for ALTER TABLE", () => {
      const report = safety.validate('ALTER TABLE users ADD COLUMN bio TEXT;')
      expect(report.lockAnalysis.length).toBeGreaterThan(0)
      expect(report.lockAnalysis[0].lockType).toBe("access_exclusive")
    })

    it("reports no locks for CREATE TABLE", () => {
      const report = safety.validate('CREATE TABLE tasks (id TEXT);')
      expect(report.lockAnalysis[0].lockType).toBe("none")
    })

    it("reports concurrent for CONCURRENTLY", () => {
      const report = safety.validate('CREATE INDEX CONCURRENTLY idx ON users (name);')
      expect(report.lockAnalysis[0].concurrent).toBe(true)
    })

    it("warns when lock time exceeds limit", () => {
      const strict = new MigrationSafetyNet({ maxLockTimeMs: 1 })
      const report = strict.validate('ALTER TABLE users DROP COLUMN email;')
      expect(report.issues.some((i) => i.code === "EXCESSIVE_LOCK_TIME")).toBe(true)
    })
  })

  describe("rollback generation", () => {
    it("generates rollback for CREATE TABLE", () => {
      const report = safety.validate('CREATE TABLE tasks (id TEXT);')
      expect(report.rollbackSQL.some((s) => s.includes("DROP TABLE"))).toBe(true)
    })

    it("generates rollback for ADD COLUMN", () => {
      const report = safety.validate('ALTER TABLE users ADD COLUMN bio TEXT;')
      expect(report.rollbackSQL.some((s) => s.includes("DROP COLUMN"))).toBe(true)
    })

    it("generates rollback for CREATE INDEX", () => {
      const report = safety.validate('CREATE INDEX CONCURRENTLY idx_name ON users (name);')
      expect(report.rollbackSQL.some((s) => s.includes("DROP INDEX"))).toBe(true)
    })

    it("generates rollback for RENAME TABLE", () => {
      const report = safety.validate('ALTER TABLE users RENAME TO accounts;')
      expect(report.rollbackSQL.some((s) => s.includes("RENAME TO"))).toBe(true)
    })

    it("generates rollback for RENAME COLUMN", () => {
      const report = safety.validate('ALTER TABLE users RENAME COLUMN name TO full_name;')
      expect(report.rollbackSQL.some((s) => s.includes("RENAME COLUMN"))).toBe(true)
    })
  })

  describe("data loss risk", () => {
    it("identifies certain data loss for DROP TABLE", () => {
      const report = safety.validate('DROP TABLE users;')
      expect(report.dataLossRisk.some((r) => r.risk === "certain")).toBe(true)
    })

    it("identifies certain data loss for DROP COLUMN", () => {
      const report = safety.validate('ALTER TABLE users DROP COLUMN email;')
      expect(report.dataLossRisk.some((r) => r.risk === "certain")).toBe(true)
    })

    it("identifies data loss for TRUNCATE", () => {
      const report = safety.validate('TRUNCATE TABLE users;')
      expect(report.dataLossRisk.some((r) => r.risk === "certain")).toBe(true)
    })

    it("no data loss for safe operations", () => {
      const report = safety.validate('ALTER TABLE users ADD COLUMN bio TEXT;')
      expect(report.dataLossRisk).toHaveLength(0)
    })
  })

  describe("impact analysis", () => {
    it("identifies impacted views on DROP TABLE", () => {
      const report = safety.validate('DROP TABLE users;')
      expect(report.impactedObjects.some((o) => o.type === "view")).toBe(true)
    })

    it("identifies degraded performance on DROP INDEX", () => {
      const report = safety.validate('DROP INDEX idx_users_email;')
      expect(report.impactedObjects.some((o) => o.type === "index" && o.impactType === "degraded")).toBe(true)
    })
  })

  describe("wrapInTransaction", () => {
    it("wraps migration in transaction", () => {
      const sql = safety.wrapInTransaction('ALTER TABLE users ADD COLUMN bio TEXT;')
      expect(sql).toContain("BEGIN")
      expect(sql).toContain("SAVEPOINT")
      expect(sql).toContain("COMMIT")
      expect(sql).toContain("statement_timeout")
    })
  })

  describe("generateRollbackScript", () => {
    it("generates full rollback script", () => {
      const report = safety.validate('CREATE TABLE tasks (id TEXT); CREATE INDEX idx ON tasks (id);')
      const script = safety.generateRollbackScript(report)
      expect(script).toContain("BEGIN")
      expect(script).toContain("DROP TABLE")
      expect(script).toContain("DROP INDEX")
      expect(script).toContain("COMMIT")
    })
  })

  describe("multi-statement migration", () => {
    it("validates compound migration", () => {
      const report = safety.validate(`
        CREATE TABLE orders (id TEXT PRIMARY KEY);
        ALTER TABLE orders ADD COLUMN user_id TEXT;
        CREATE INDEX CONCURRENTLY idx_orders_user ON orders (user_id);
      `)
      expect(report.safe).toBe(true)
      expect(report.lockAnalysis.length).toBe(3)
    })
  })

  describe("custom validators", () => {
    it("runs custom validators", () => {
      const customSafety = new MigrationSafetyNet({
        customValidators: [
          {
            name: "no-public-schema",
            validate(sql) {
              if (sql.includes("public.")) {
                return [{
                  severity: "warning",
                  code: "PUBLIC_SCHEMA",
                  message: "Avoid explicit public schema references",
                }]
              }
              return []
            },
          },
        ],
      })
      const report = customSafety.validate('CREATE TABLE public.users (id TEXT);')
      expect(report.issues.some((i) => i.code === "PUBLIC_SCHEMA")).toBe(true)
    })
  })

  describe("summary", () => {
    it("provides accurate summary", () => {
      const report = safety.validate(`
        DROP TABLE users;
        ALTER TABLE orders ADD COLUMN name TEXT NOT NULL;
      `)
      expect(report.summary.errors).toBeGreaterThan(0)
      expect(report.summary.breakingChanges).toBeGreaterThan(0)
      expect(report.summary.estimatedTotalLockMs).toBeGreaterThan(0)
    })
  })
})
