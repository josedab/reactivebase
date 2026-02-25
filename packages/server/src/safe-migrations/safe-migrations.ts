/**
 * Zero-Downtime Schema Migrations (Expand/Contract pattern).
 *
 * Automates the expand-and-contract migration strategy:
 * 1. EXPAND: Add new columns/tables, create dual-write triggers
 * 2. MIGRATE: Backfill data, dual-write during transition
 * 3. CONTRACT: Drop old columns/tables after verification
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type MigrationSafety = "safe" | "unsafe" | "requires_backfill" | "requires_dual_write"

export type OperationType =
  | "add_column"
  | "drop_column"
  | "rename_column"
  | "alter_column_type"
  | "add_table"
  | "drop_table"
  | "rename_table"
  | "add_index"
  | "drop_index"
  | "add_constraint"
  | "drop_constraint"
  | "add_not_null"
  | "drop_not_null"

export interface SchemaOperation {
  type: OperationType
  table: string
  column?: string
  newName?: string
  oldType?: string
  newType?: string
  defaultValue?: string
  indexName?: string
  constraintName?: string
  safety: MigrationSafety
  reason?: string
}

export interface MigrationPlan {
  /** Unique migration ID */
  id: string
  /** Human-readable name */
  name: string
  /** Detected schema operations */
  operations: SchemaOperation[]
  /** Overall safety classification */
  overallSafety: MigrationSafety
  /** Expand phase SQL (safe to apply with traffic) */
  expandSQL: string[]
  /** Backfill SQL (data migration) */
  backfillSQL: string[]
  /** Contract phase SQL (cleanup after verification) */
  contractSQL: string[]
  /** Dual-write trigger SQL */
  dualWriteTriggerSQL: string[]
  /** Rollback SQL for each phase */
  rollbackExpandSQL: string[]
  rollbackContractSQL: string[]
  /** Warnings and recommendations */
  warnings: string[]
  /** Estimated impact */
  estimatedImpact: MigrationImpact
}

export interface MigrationImpact {
  /** Tables affected */
  tablesAffected: string[]
  /** Whether a table rewrite is needed */
  requiresTableRewrite: boolean
  /** Whether existing subscriptions need updating */
  requiresSubscriptionUpdate: boolean
  /** Estimated rows to backfill */
  estimatedBackfillRows?: number
}

export interface ExpandContractOptions {
  /** Prefix for dual-write triggers */
  triggerPrefix?: string
  /** Backfill batch size */
  backfillBatchSize?: number
  /** Lock timeout for DDL operations (default: '5s') */
  lockTimeout?: string
  /** Statement timeout for DDL operations (default: '30s') */
  statementTimeout?: string
}

const DEFAULT_OPTIONS: Required<ExpandContractOptions> = {
  triggerPrefix: "_rb_dualwrite_",
  backfillBatchSize: 1000,
  lockTimeout: "5s",
  statementTimeout: "30s",
}

const SAFE_DEFAULT_VALUE_RE =
  /^(?:'[^']*'|\d+(?:\.\d+)?|true|false|NULL|gen_random_uuid\(\)|NOW\(\)|CURRENT_TIMESTAMP)$/i

function sanitizeDefaultValue(value: string): string {
  if (!SAFE_DEFAULT_VALUE_RE.test(value)) {
    throw new SafeMigrationError(`Unsafe default value: ${value}`)
  }
  return value
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class SafeMigrationError extends Error {
  readonly code = "SAFE_MIGRATION_ERROR"

  constructor(message: string) {
    super(message)
    this.name = "SafeMigrationError"
  }
}

export class UnsafeMigrationError extends Error {
  readonly code = "UNSAFE_MIGRATION"

  constructor(
    public readonly operations: SchemaOperation[],
    message: string,
  ) {
    super(message)
    this.name = "UnsafeMigrationError"
  }
}

// ─── Migration Analyzer ──────────────────────────────────────────────────────

/**
 * Analyze schema operations and classify them by safety level.
 */
export class MigrationAnalyzer {
  /**
   * Classify a single operation by its migration safety.
   */
  classifyOperation(op: Omit<SchemaOperation, "safety" | "reason">): SchemaOperation {
    switch (op.type) {
      case "add_column":
        if (op.defaultValue !== undefined) {
          return { ...op, safety: "safe", reason: "Adding column with default is safe" }
        }
        return { ...op, safety: "safe", reason: "Adding nullable column is safe (no existing rows affected)" }

      case "drop_column":
        return {
          ...op,
          safety: "requires_dual_write",
          reason: "Dropping column requires dual-write phase to ensure old code still works",
        }

      case "rename_column":
        return {
          ...op,
          safety: "requires_dual_write",
          reason: "Rename requires expand (add new), dual-write, then contract (drop old)",
        }

      case "alter_column_type":
        return {
          ...op,
          safety: "requires_backfill",
          reason: "Type change requires adding new column, backfilling, then swapping",
        }

      case "add_table":
        return { ...op, safety: "safe", reason: "Adding a new table is always safe" }

      case "drop_table":
        return {
          ...op,
          safety: "unsafe",
          reason: "Dropping table will lose all data. Use contract phase after verification.",
        }

      case "rename_table":
        return {
          ...op,
          safety: "requires_dual_write",
          reason: "Rename requires creating new table, dual-writing, then dropping old",
        }

      case "add_index":
        return { ...op, safety: "safe", reason: "CREATE INDEX CONCURRENTLY is non-blocking" }

      case "drop_index":
        return { ...op, safety: "safe", reason: "Dropping an index is safe (only affects performance)" }

      case "add_constraint":
        return {
          ...op,
          safety: "requires_backfill",
          reason: "Adding constraint requires validating existing data first",
        }

      case "drop_constraint":
        return { ...op, safety: "safe", reason: "Dropping a constraint is safe" }

      case "add_not_null":
        return {
          ...op,
          safety: "requires_backfill",
          reason: "Adding NOT NULL requires backfilling NULL values first",
        }

      case "drop_not_null":
        return { ...op, safety: "safe", reason: "Dropping NOT NULL is safe" }

      default:
        return { ...op, safety: "unsafe", reason: "Unknown operation type" }
    }
  }

  /**
   * Analyze a list of operations and produce a migration plan.
   */
  analyze(
    migrationId: string,
    name: string,
    operations: Array<Omit<SchemaOperation, "safety" | "reason">>,
    options: ExpandContractOptions = {},
  ): MigrationPlan {
    const opts = { ...DEFAULT_OPTIONS, ...options }
    const classified = operations.map((op) => this.classifyOperation(op))

    const overallSafety = this.computeOverallSafety(classified)
    const warnings: string[] = []
    const tablesAffected = [...new Set(classified.map((op) => op.table))]

    const expandSQL: string[] = []
    const backfillSQL: string[] = []
    const contractSQL: string[] = []
    const dualWriteTriggerSQL: string[] = []
    const rollbackExpandSQL: string[] = []
    const rollbackContractSQL: string[] = []

    // Set lock/statement timeouts for safety
    expandSQL.push(`SET LOCAL lock_timeout = '${opts.lockTimeout}';`)
    expandSQL.push(`SET LOCAL statement_timeout = '${opts.statementTimeout}';`)

    let requiresTableRewrite = false
    let requiresSubscriptionUpdate = false

    for (const op of classified) {
      switch (op.type) {
        case "add_column": {
          const defaultClause = op.defaultValue !== undefined ? ` DEFAULT ${sanitizeDefaultValue(op.defaultValue)}` : ""
          expandSQL.push(
            `ALTER TABLE "${op.table}" ADD COLUMN IF NOT EXISTS "${op.column}" ${op.newType ?? "text"}${defaultClause};`,
          )
          rollbackExpandSQL.push(`ALTER TABLE "${op.table}" DROP COLUMN IF EXISTS "${op.column}";`)
          break
        }

        case "drop_column": {
          // Expand: create a trigger to stop writing to the column
          dualWriteTriggerSQL.push(this.generateDualWriteStopTrigger(op.table, op.column!, opts.triggerPrefix))
          // Contract: actually drop the column
          contractSQL.push(`ALTER TABLE "${op.table}" DROP COLUMN IF EXISTS "${op.column}";`)
          rollbackContractSQL.push(`-- Cannot rollback column drop for "${op.table}"."${op.column}"`)
          warnings.push(
            `Column "${op.table}"."${op.column}" will be dropped in contract phase. Ensure no code references it.`,
          )
          requiresSubscriptionUpdate = true
          break
        }

        case "rename_column": {
          // Expand: add new column
          expandSQL.push(`ALTER TABLE "${op.table}" ADD COLUMN IF NOT EXISTS "${op.newName}" ${op.newType ?? "text"};`)
          // Backfill: copy data
          backfillSQL.push(this.generateBackfillSQL(op.table, op.column!, op.newName!, opts.backfillBatchSize))
          // Dual-write: trigger to sync old -> new
          dualWriteTriggerSQL.push(
            this.generateDualWriteSyncTrigger(op.table, op.column!, op.newName!, opts.triggerPrefix),
          )
          // Contract: drop old column and trigger
          contractSQL.push(`DROP TRIGGER IF EXISTS "${opts.triggerPrefix}${op.table}_${op.column}" ON "${op.table}";`)
          contractSQL.push(`DROP FUNCTION IF EXISTS "${opts.triggerPrefix}${op.table}_${op.column}_fn"();`)
          contractSQL.push(`ALTER TABLE "${op.table}" DROP COLUMN IF EXISTS "${op.column}";`)
          rollbackExpandSQL.push(`ALTER TABLE "${op.table}" DROP COLUMN IF EXISTS "${op.newName}";`)
          requiresSubscriptionUpdate = true
          break
        }

        case "alter_column_type": {
          const tempCol = `${op.column}_new`
          expandSQL.push(`ALTER TABLE "${op.table}" ADD COLUMN IF NOT EXISTS "${tempCol}" ${op.newType};`)
          backfillSQL.push(this.generateBackfillSQL(op.table, op.column!, tempCol, opts.backfillBatchSize))
          dualWriteTriggerSQL.push(this.generateDualWriteSyncTrigger(op.table, op.column!, tempCol, opts.triggerPrefix))
          contractSQL.push(`ALTER TABLE "${op.table}" DROP COLUMN IF EXISTS "${op.column}";`)
          contractSQL.push(`ALTER TABLE "${op.table}" RENAME COLUMN "${tempCol}" TO "${op.column}";`)
          rollbackExpandSQL.push(`ALTER TABLE "${op.table}" DROP COLUMN IF EXISTS "${tempCol}";`)
          requiresTableRewrite = true
          requiresSubscriptionUpdate = true
          break
        }

        case "add_table": {
          expandSQL.push(`CREATE TABLE IF NOT EXISTS "${op.table}" (id TEXT PRIMARY KEY);`)
          rollbackExpandSQL.push(`DROP TABLE IF EXISTS "${op.table}";`)
          break
        }

        case "drop_table": {
          contractSQL.push(`DROP TABLE IF EXISTS "${op.table}";`)
          warnings.push(`Table "${op.table}" will be dropped in contract phase. This is irreversible.`)
          requiresSubscriptionUpdate = true
          break
        }

        case "add_index": {
          expandSQL.push(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "${op.indexName}" ON "${op.table}" ("${op.column}");`)
          rollbackExpandSQL.push(`DROP INDEX CONCURRENTLY IF EXISTS "${op.indexName}";`)
          break
        }

        case "drop_index": {
          expandSQL.push(`DROP INDEX CONCURRENTLY IF EXISTS "${op.indexName}";`)
          break
        }

        case "add_not_null": {
          backfillSQL.push(
            `UPDATE "${op.table}" SET "${op.column}" = ${sanitizeDefaultValue(op.defaultValue ?? "''")} WHERE "${op.column}" IS NULL;`,
          )
          contractSQL.push(`ALTER TABLE "${op.table}" ALTER COLUMN "${op.column}" SET NOT NULL;`)
          break
        }

        case "drop_not_null": {
          expandSQL.push(`ALTER TABLE "${op.table}" ALTER COLUMN "${op.column}" DROP NOT NULL;`)
          break
        }

        default:
          warnings.push(`Unsupported operation type: ${op.type} on "${op.table}"`)
      }
    }

    return {
      id: migrationId,
      name,
      operations: classified,
      overallSafety,
      expandSQL,
      backfillSQL,
      contractSQL,
      dualWriteTriggerSQL,
      rollbackExpandSQL,
      rollbackContractSQL,
      warnings,
      estimatedImpact: {
        tablesAffected,
        requiresTableRewrite,
        requiresSubscriptionUpdate,
      },
    }
  }

  /**
   * Generate a visual diff preview of the migration plan.
   */
  generateDiffPreview(plan: MigrationPlan): string {
    const lines: string[] = []
    lines.push(`╔══════════════════════════════════════════════════╗`)
    lines.push(`║  Migration: ${plan.name.padEnd(36)} ║`)
    lines.push(`║  Safety: ${this.safetyBadge(plan.overallSafety).padEnd(39)} ║`)
    lines.push(`╚══════════════════════════════════════════════════╝`)
    lines.push("")

    // Operations
    lines.push("Operations:")
    for (const op of plan.operations) {
      const icon = this.safetyIcon(op.safety)
      const desc = this.describeOperation(op)
      lines.push(`  ${icon} ${desc}`)
      if (op.reason) {
        lines.push(`     └─ ${op.reason}`)
      }
    }
    lines.push("")

    // Phases
    if (plan.expandSQL.length > 0) {
      lines.push("Phase 1 - EXPAND (safe to apply with live traffic):")
      for (const sql of plan.expandSQL) {
        lines.push(`  + ${sql}`)
      }
      lines.push("")
    }

    if (plan.dualWriteTriggerSQL.length > 0) {
      lines.push("Phase 2 - DUAL WRITE (sync triggers):")
      for (const sql of plan.dualWriteTriggerSQL) {
        lines.push(`  ~ ${sql.split("\n")[0]}...`)
      }
      lines.push("")
    }

    if (plan.backfillSQL.length > 0) {
      lines.push("Phase 3 - BACKFILL (data migration):")
      for (const sql of plan.backfillSQL) {
        lines.push(`  → ${sql.split("\n")[0]}...`)
      }
      lines.push("")
    }

    if (plan.contractSQL.length > 0) {
      lines.push("Phase 4 - CONTRACT (cleanup after verification):")
      for (const sql of plan.contractSQL) {
        lines.push(`  - ${sql}`)
      }
      lines.push("")
    }

    // Warnings
    if (plan.warnings.length > 0) {
      lines.push("⚠ Warnings:")
      for (const w of plan.warnings) {
        lines.push(`  ⚠ ${w}`)
      }
      lines.push("")
    }

    // Impact
    lines.push("Impact:")
    lines.push(`  Tables: ${plan.estimatedImpact.tablesAffected.join(", ")}`)
    lines.push(`  Table rewrite: ${plan.estimatedImpact.requiresTableRewrite ? "Yes" : "No"}`)
    lines.push(`  Subscription update: ${plan.estimatedImpact.requiresSubscriptionUpdate ? "Yes" : "No"}`)

    return lines.join("\n")
  }

  private computeOverallSafety(ops: SchemaOperation[]): MigrationSafety {
    if (ops.some((op) => op.safety === "unsafe")) return "unsafe"
    if (ops.some((op) => op.safety === "requires_dual_write")) return "requires_dual_write"
    if (ops.some((op) => op.safety === "requires_backfill")) return "requires_backfill"
    return "safe"
  }

  private generateBackfillSQL(table: string, fromCol: string, toCol: string, batchSize: number): string {
    return `-- Backfill "${table}"."${toCol}" from "${fromCol}" in batches of ${batchSize}
DO $$
DECLARE
  batch_count INTEGER := 0;
BEGIN
  LOOP
    UPDATE "${table}"
    SET "${toCol}" = "${fromCol}"
    WHERE id IN (
      SELECT id FROM "${table}"
      WHERE "${toCol}" IS NULL
      LIMIT ${batchSize}
    );
    EXIT WHEN NOT FOUND;
    batch_count := batch_count + 1;
    RAISE NOTICE 'Backfill batch % complete', batch_count;
    PERFORM pg_sleep(0.1);
  END LOOP;
END $$;`
  }

  private generateDualWriteSyncTrigger(table: string, oldCol: string, newCol: string, prefix: string): string {
    const triggerName = `${prefix}${table}_${oldCol}`
    const fnName = `${triggerName}_fn`
    return `CREATE OR REPLACE FUNCTION "${fnName}"()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW."${newCol}" := NEW."${oldCol}";
  RETURN NEW;
END $$;

CREATE TRIGGER "${triggerName}"
BEFORE INSERT OR UPDATE ON "${table}"
FOR EACH ROW EXECUTE FUNCTION "${fnName}"();`
  }

  private generateDualWriteStopTrigger(table: string, column: string, _prefix: string): string {
    return `-- Dual-write stop for "${table}"."${column}": application should stop writing to this column`
  }

  private safetyIcon(safety: MigrationSafety): string {
    switch (safety) {
      case "safe":
        return "✅"
      case "requires_backfill":
        return "🔄"
      case "requires_dual_write":
        return "⚡"
      case "unsafe":
        return "❌"
    }
  }

  private safetyBadge(safety: MigrationSafety): string {
    switch (safety) {
      case "safe":
        return "✅ SAFE"
      case "requires_backfill":
        return "🔄 REQUIRES BACKFILL"
      case "requires_dual_write":
        return "⚡ REQUIRES DUAL-WRITE"
      case "unsafe":
        return "❌ UNSAFE"
    }
  }

  private describeOperation(op: SchemaOperation): string {
    switch (op.type) {
      case "add_column":
        return `ADD COLUMN "${op.table}"."${op.column}"`
      case "drop_column":
        return `DROP COLUMN "${op.table}"."${op.column}"`
      case "rename_column":
        return `RENAME COLUMN "${op.table}"."${op.column}" → "${op.newName}"`
      case "alter_column_type":
        return `ALTER TYPE "${op.table}"."${op.column}" → ${op.newType}`
      case "add_table":
        return `CREATE TABLE "${op.table}"`
      case "drop_table":
        return `DROP TABLE "${op.table}"`
      case "rename_table":
        return `RENAME TABLE "${op.table}" → "${op.newName}"`
      case "add_index":
        return `CREATE INDEX "${op.indexName}" ON "${op.table}"`
      case "drop_index":
        return `DROP INDEX "${op.indexName}"`
      case "add_not_null":
        return `ADD NOT NULL "${op.table}"."${op.column}"`
      case "drop_not_null":
        return `DROP NOT NULL "${op.table}"."${op.column}"`
      default:
        return `${op.type} on "${op.table}"`
    }
  }
}

// ─── Migration Executor ──────────────────────────────────────────────────────

export type MigrationPhase = "expand" | "dual_write" | "backfill" | "contract"

export interface MigrationExecutionState {
  migrationId: string
  currentPhase: MigrationPhase
  completedPhases: MigrationPhase[]
  startedAt: number
  error?: string
}

/**
 * Execute migration phases with safety checks and state tracking.
 */
export class SafeMigrationExecutor {
  private state: MigrationExecutionState | null = null

  /**
   * Start executing a migration plan phase by phase.
   */
  startMigration(plan: MigrationPlan): MigrationExecutionState {
    this.state = {
      migrationId: plan.id,
      currentPhase: "expand",
      completedPhases: [],
      startedAt: Date.now(),
    }
    return { ...this.state }
  }

  /**
   * Get SQL statements for a specific phase.
   */
  getPhaseSQL(plan: MigrationPlan, phase: MigrationPhase): string[] {
    switch (phase) {
      case "expand":
        return plan.expandSQL
      case "dual_write":
        return plan.dualWriteTriggerSQL
      case "backfill":
        return plan.backfillSQL
      case "contract":
        return plan.contractSQL
    }
  }

  /**
   * Mark current phase as complete and advance to next.
   */
  advancePhase(): MigrationPhase | null {
    if (!this.state) throw new SafeMigrationError("No migration in progress")

    this.state.completedPhases.push(this.state.currentPhase)

    const phases: MigrationPhase[] = ["expand", "dual_write", "backfill", "contract"]
    const currentIndex = phases.indexOf(this.state.currentPhase)
    const nextPhase = phases[currentIndex + 1]

    if (nextPhase) {
      this.state.currentPhase = nextPhase
      return nextPhase
    }

    return null
  }

  /**
   * Get rollback SQL for the current state.
   */
  getRollbackSQL(plan: MigrationPlan): string[] {
    if (!this.state) return []

    const rollback: string[] = []

    // Rollback in reverse order
    if (this.state.completedPhases.includes("contract") || this.state.currentPhase === "contract") {
      rollback.push(...plan.rollbackContractSQL)
    }
    if (this.state.completedPhases.includes("expand") || this.state.currentPhase === "expand") {
      rollback.push(...plan.rollbackExpandSQL)
    }

    return rollback
  }

  /**
   * Get current migration state.
   */
  getState(): MigrationExecutionState | null {
    return this.state ? { ...this.state } : null
  }

  /**
   * Complete the migration.
   */
  complete(): void {
    this.state = null
  }
}

// ─── Factory Functions ───────────────────────────────────────────────────────

export function createMigrationAnalyzer(): MigrationAnalyzer {
  return new MigrationAnalyzer()
}

export function createSafeMigrationExecutor(): SafeMigrationExecutor {
  return new SafeMigrationExecutor()
}
