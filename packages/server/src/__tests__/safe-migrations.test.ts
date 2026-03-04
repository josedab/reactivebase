/**
 * Tests for MigrationAnalyzer and SafeMigrationExecutor —
 * schema operation classification, SQL generation, and execution state management.
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
  MigrationAnalyzer,
  SafeMigrationExecutor,
  SafeMigrationError,
  UnsafeMigrationError,
} from "../safe-migrations/safe-migrations.js"
import type { SchemaOperation, MigrationPlan } from "../safe-migrations/safe-migrations.js"

// ─── MigrationAnalyzer — classifyOperation ───────────────────────────────────

describe("MigrationAnalyzer — classifyOperation", () => {
  let analyzer: MigrationAnalyzer

  beforeEach(() => {
    analyzer = new MigrationAnalyzer()
  })

  it("classifies add_column as safe", () => {
    const op = analyzer.classifyOperation({ type: "add_column", table: "users", column: "bio" })
    expect(op.safety).toBe("safe")
    expect(op.reason).toContain("safe")
  })

  it("classifies add_column with default as safe", () => {
    const op = analyzer.classifyOperation({
      type: "add_column",
      table: "users",
      column: "active",
      defaultValue: "true",
    })
    expect(op.safety).toBe("safe")
    expect(op.reason).toContain("default")
  })

  it("classifies drop_column as requires_dual_write", () => {
    const op = analyzer.classifyOperation({ type: "drop_column", table: "users", column: "old_col" })
    expect(op.safety).toBe("requires_dual_write")
    expect(op.reason).toContain("dual-write")
  })

  it("classifies rename_column as requires_dual_write", () => {
    const op = analyzer.classifyOperation({
      type: "rename_column",
      table: "users",
      column: "name",
      newName: "full_name",
    })
    expect(op.safety).toBe("requires_dual_write")
    expect(op.reason).toContain("expand")
  })

  it("classifies alter_column_type as requires_backfill", () => {
    const op = analyzer.classifyOperation({
      type: "alter_column_type",
      table: "users",
      column: "age",
      oldType: "text",
      newType: "integer",
    })
    expect(op.safety).toBe("requires_backfill")
    expect(op.reason).toContain("backfill")
  })

  it("classifies add_table as safe", () => {
    const op = analyzer.classifyOperation({ type: "add_table", table: "comments" })
    expect(op.safety).toBe("safe")
    expect(op.reason).toContain("always safe")
  })

  it("classifies drop_table as unsafe", () => {
    const op = analyzer.classifyOperation({ type: "drop_table", table: "old_table" })
    expect(op.safety).toBe("unsafe")
    expect(op.reason).toContain("lose all data")
  })

  it("classifies rename_table as requires_dual_write", () => {
    const op = analyzer.classifyOperation({ type: "rename_table", table: "users", newName: "accounts" })
    expect(op.safety).toBe("requires_dual_write")
  })

  it("classifies add_index as safe", () => {
    const op = analyzer.classifyOperation({
      type: "add_index",
      table: "users",
      column: "email",
      indexName: "idx_email",
    })
    expect(op.safety).toBe("safe")
    expect(op.reason).toContain("CONCURRENTLY")
  })

  it("classifies drop_index as safe", () => {
    const op = analyzer.classifyOperation({ type: "drop_index", table: "users", indexName: "idx_old" })
    expect(op.safety).toBe("safe")
  })

  it("classifies add_constraint as requires_backfill", () => {
    const op = analyzer.classifyOperation({ type: "add_constraint", table: "users", constraintName: "check_age" })
    expect(op.safety).toBe("requires_backfill")
    expect(op.reason).toContain("validating")
  })

  it("classifies drop_constraint as safe", () => {
    const op = analyzer.classifyOperation({ type: "drop_constraint", table: "users", constraintName: "old_check" })
    expect(op.safety).toBe("safe")
  })

  it("classifies add_not_null as requires_backfill", () => {
    const op = analyzer.classifyOperation({ type: "add_not_null", table: "users", column: "email" })
    expect(op.safety).toBe("requires_backfill")
    expect(op.reason).toContain("backfilling")
  })

  it("classifies drop_not_null as safe", () => {
    const op = analyzer.classifyOperation({ type: "drop_not_null", table: "users", column: "bio" })
    expect(op.safety).toBe("safe")
  })
})

// ─── MigrationAnalyzer — analyze (migration plans) ──────────────────────────

describe("MigrationAnalyzer — analyze", () => {
  let analyzer: MigrationAnalyzer

  beforeEach(() => {
    analyzer = new MigrationAnalyzer()
  })

  it("produces a plan with correct metadata", () => {
    const plan = analyzer.analyze("m1", "Add bio column", [
      { type: "add_column", table: "users", column: "bio", newType: "text" },
    ])
    expect(plan.id).toBe("m1")
    expect(plan.name).toBe("Add bio column")
    expect(plan.operations.length).toBe(1)
  })

  it("overall safety is safe for additive-only operations", () => {
    const plan = analyzer.analyze("m1", "Safe migration", [
      { type: "add_column", table: "users", column: "bio" },
      { type: "add_table", table: "comments" },
      { type: "add_index", table: "users", column: "email", indexName: "idx_email" },
    ])
    expect(plan.overallSafety).toBe("safe")
  })

  it("overall safety is unsafe when drop_table is present", () => {
    const plan = analyzer.analyze("m1", "Dangerous migration", [
      { type: "add_column", table: "users", column: "bio" },
      { type: "drop_table", table: "old_table" },
    ])
    expect(plan.overallSafety).toBe("unsafe")
  })

  it("overall safety is requires_dual_write for renames", () => {
    const plan = analyzer.analyze("m1", "Rename migration", [
      { type: "rename_column", table: "users", column: "name", newName: "full_name", newType: "text" },
    ])
    expect(plan.overallSafety).toBe("requires_dual_write")
  })

  it("generates expand SQL for add_column", () => {
    const plan = analyzer.analyze("m1", "test", [
      { type: "add_column", table: "users", column: "bio", newType: "text" },
    ])
    expect(plan.expandSQL.some((s) => s.includes("ADD COLUMN") && s.includes('"bio"'))).toBe(true)
  })

  it("generates expand SQL with default value", () => {
    const plan = analyzer.analyze("m1", "test", [
      { type: "add_column", table: "users", column: "active", newType: "boolean", defaultValue: "true" },
    ])
    expect(plan.expandSQL.some((s) => s.includes("DEFAULT true"))).toBe(true)
  })

  it("rejects unsafe default values (SQL injection)", () => {
    expect(() =>
      analyzer.analyze("m1", "test", [
        { type: "add_column", table: "users", column: "x", defaultValue: "'; DROP TABLE users; --" },
      ]),
    ).toThrow(SafeMigrationError)
  })

  it("generates contract SQL for drop_column", () => {
    const plan = analyzer.analyze("m1", "test", [{ type: "drop_column", table: "users", column: "old_col" }])
    expect(plan.contractSQL.some((s) => s.includes("DROP COLUMN"))).toBe(true)
  })

  it("generates backfill SQL for rename_column", () => {
    const plan = analyzer.analyze("m1", "test", [
      { type: "rename_column", table: "users", column: "name", newName: "full_name", newType: "text" },
    ])
    expect(plan.backfillSQL.length).toBeGreaterThan(0)
    expect(plan.backfillSQL[0]).toContain("Backfill")
  })

  it("generates dual-write trigger SQL for rename", () => {
    const plan = analyzer.analyze("m1", "test", [
      { type: "rename_column", table: "users", column: "name", newName: "full_name", newType: "text" },
    ])
    expect(plan.dualWriteTriggerSQL.length).toBeGreaterThan(0)
    expect(plan.dualWriteTriggerSQL[0]).toContain("TRIGGER")
  })

  it("generates concurrent index creation", () => {
    const plan = analyzer.analyze("m1", "test", [
      { type: "add_index", table: "users", column: "email", indexName: "idx_email" },
    ])
    expect(plan.expandSQL.some((s) => s.includes("CONCURRENTLY"))).toBe(true)
  })

  it("sets lock/statement timeout in expand SQL", () => {
    const plan = analyzer.analyze("m1", "test", [{ type: "add_column", table: "users", column: "x" }])
    expect(plan.expandSQL.some((s) => s.includes("lock_timeout"))).toBe(true)
    expect(plan.expandSQL.some((s) => s.includes("statement_timeout"))).toBe(true)
  })

  it("tracks affected tables in impact", () => {
    const plan = analyzer.analyze("m1", "test", [
      { type: "add_column", table: "users", column: "x" },
      { type: "add_column", table: "orders", column: "y" },
    ])
    expect(plan.estimatedImpact.tablesAffected).toEqual(["users", "orders"])
  })

  it("sets requiresTableRewrite for type changes", () => {
    const plan = analyzer.analyze("m1", "test", [
      { type: "alter_column_type", table: "users", column: "age", newType: "integer" },
    ])
    expect(plan.estimatedImpact.requiresTableRewrite).toBe(true)
  })

  it("sets requiresSubscriptionUpdate for drops", () => {
    const plan = analyzer.analyze("m1", "test", [{ type: "drop_column", table: "users", column: "old_col" }])
    expect(plan.estimatedImpact.requiresSubscriptionUpdate).toBe(true)
  })

  it("generates warnings for drop operations", () => {
    const plan = analyzer.analyze("m1", "test", [{ type: "drop_table", table: "legacy" }])
    expect(plan.warnings.length).toBeGreaterThan(0)
    expect(plan.warnings[0]).toContain("legacy")
  })

  it("generates rollback SQL for expand phase", () => {
    const plan = analyzer.analyze("m1", "test", [{ type: "add_column", table: "users", column: "bio" }])
    expect(plan.rollbackExpandSQL.some((s) => s.includes("DROP COLUMN"))).toBe(true)
  })

  it("handles add_not_null with backfill", () => {
    const plan = analyzer.analyze("m1", "test", [
      { type: "add_not_null", table: "users", column: "email", defaultValue: "''" },
    ])
    expect(plan.backfillSQL.some((s) => s.includes("IS NULL"))).toBe(true)
    expect(plan.contractSQL.some((s) => s.includes("SET NOT NULL"))).toBe(true)
  })

  it("handles drop_not_null", () => {
    const plan = analyzer.analyze("m1", "test", [{ type: "drop_not_null", table: "users", column: "bio" }])
    expect(plan.expandSQL.some((s) => s.includes("DROP NOT NULL"))).toBe(true)
  })

  it("respects custom options", () => {
    const plan = analyzer.analyze("m1", "test", [{ type: "add_column", table: "users", column: "x" }], {
      lockTimeout: "10s",
      statementTimeout: "60s",
    })
    expect(plan.expandSQL.some((s) => s.includes("10s"))).toBe(true)
  })
})

// ─── MigrationAnalyzer — generateDiffPreview ─────────────────────────────────

describe("MigrationAnalyzer — generateDiffPreview", () => {
  it("generates a visual diff preview", () => {
    const analyzer = new MigrationAnalyzer()
    const plan = analyzer.analyze("m1", "Test migration", [
      { type: "add_column", table: "users", column: "bio" },
      { type: "drop_table", table: "legacy" },
    ])
    const preview = analyzer.generateDiffPreview(plan)

    expect(preview).toContain("Test migration")
    expect(preview).toContain("UNSAFE")
    expect(preview).toContain("ADD COLUMN")
    expect(preview).toContain("DROP TABLE")
    expect(preview).toContain("Operations:")
    expect(preview).toContain("Impact:")
  })
})

// ─── SafeMigrationExecutor ───────────────────────────────────────────────────

describe("SafeMigrationExecutor", () => {
  let executor: SafeMigrationExecutor
  let plan: MigrationPlan

  beforeEach(() => {
    executor = new SafeMigrationExecutor()
    const analyzer = new MigrationAnalyzer()
    plan = analyzer.analyze("m1", "test", [
      { type: "rename_column", table: "users", column: "name", newName: "full_name", newType: "text" },
    ])
  })

  it("starts migration in expand phase", () => {
    const state = executor.startMigration(plan)
    expect(state.migrationId).toBe("m1")
    expect(state.currentPhase).toBe("expand")
    expect(state.completedPhases).toEqual([])
  })

  it("advances through phases", () => {
    executor.startMigration(plan)

    const phase1 = executor.advancePhase()
    expect(phase1).toBe("dual_write")

    const phase2 = executor.advancePhase()
    expect(phase2).toBe("backfill")

    const phase3 = executor.advancePhase()
    expect(phase3).toBe("contract")

    const done = executor.advancePhase()
    expect(done).toBeNull()
  })

  it("returns SQL for each phase", () => {
    executor.startMigration(plan)

    const expandSQL = executor.getPhaseSQL(plan, "expand")
    expect(expandSQL.length).toBeGreaterThan(0)

    const dualWriteSQL = executor.getPhaseSQL(plan, "dual_write")
    expect(dualWriteSQL.length).toBeGreaterThan(0)

    const backfillSQL = executor.getPhaseSQL(plan, "backfill")
    expect(backfillSQL.length).toBeGreaterThan(0)

    const contractSQL = executor.getPhaseSQL(plan, "contract")
    expect(contractSQL.length).toBeGreaterThan(0)
  })

  it("getRollbackSQL includes expand rollback", () => {
    executor.startMigration(plan)
    executor.advancePhase() // complete expand

    const rollback = executor.getRollbackSQL(plan)
    expect(rollback.length).toBeGreaterThan(0)
  })

  it("throws when advancing without starting", () => {
    expect(() => executor.advancePhase()).toThrow(SafeMigrationError)
  })

  it("getState returns null before starting", () => {
    expect(executor.getState()).toBeNull()
  })

  it("getState returns copy of current state", () => {
    executor.startMigration(plan)
    const s1 = executor.getState()
    const s2 = executor.getState()
    expect(s1).toEqual(s2)
    expect(s1).not.toBe(s2)
  })

  it("complete resets the executor", () => {
    executor.startMigration(plan)
    executor.complete()
    expect(executor.getState()).toBeNull()
  })

  it("getRollbackSQL returns empty when no migration", () => {
    expect(executor.getRollbackSQL(plan)).toEqual([])
  })
})

// ─── Error classes ───────────────────────────────────────────────────────────

describe("Error classes", () => {
  it("SafeMigrationError has correct name and code", () => {
    const err = new SafeMigrationError("test")
    expect(err.name).toBe("SafeMigrationError")
    expect(err.code).toBe("SAFE_MIGRATION_ERROR")
    expect(err.message).toBe("test")
  })

  it("UnsafeMigrationError has operations and code", () => {
    const ops: SchemaOperation[] = [{ type: "drop_table", table: "users", safety: "unsafe", reason: "data loss" }]
    const err = new UnsafeMigrationError(ops, "Unsafe!")
    expect(err.name).toBe("UnsafeMigrationError")
    expect(err.code).toBe("UNSAFE_MIGRATION")
    expect(err.operations).toEqual(ops)
  })
})
