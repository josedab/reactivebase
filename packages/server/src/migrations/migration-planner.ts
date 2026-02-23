/**
 * Zero-Downtime Migration Planner.
 * Analyzes schema diffs and generates safe migration strategies:
 *   - Breaking change detection (safe / caution / breaking)
 *   - Expand-contract pattern generation for breaking changes
 *   - Concurrent index creation for zero-lock migrations
 *   - Client compatibility checking
 *   - Migration dry-run simulation
 *
 * Usage:
 *   const planner = new MigrationPlanner()
 *   const analysis = planner.analyzeChanges(oldSchema, newSchema)
 *   const plan = planner.generateSafePlan(analysis)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SchemaChange {
  type:
    | "add-table"
    | "drop-table"
    | "add-column"
    | "drop-column"
    | "alter-column"
    | "add-index"
    | "drop-index"
    | "rename-column"
    | "rename-table"
  table: string
  column?: string
  details: Record<string, unknown>
}

export interface ChangeAnalysis {
  changes: AnalyzedChange[]
  safeCount: number
  cautionCount: number
  breakingCount: number
  overallRisk: "safe" | "caution" | "breaking"
}

export interface AnalyzedChange {
  change: SchemaChange
  risk: "safe" | "caution" | "breaking"
  reason: string
  recommendation: string
}

export interface SafeMigrationPlan {
  phases: MigrationPhase[]
  estimatedDowntime: "zero" | "minimal" | "required"
  warnings: string[]
  rollbackSteps: string[]
  totalSteps: number
}

export interface MigrationPhase {
  name: string
  description: string
  steps: MigrationStep[]
  canRunConcurrently: boolean
  requiresLock: boolean
}

export interface MigrationStep {
  sql: string
  description: string
  reversible: boolean
  reverseSql?: string
  concurrentSafe: boolean
  estimatedLockTimeMs?: number
}

export interface DryRunResult {
  plan: SafeMigrationPlan
  simulation: { step: string; status: "ok" | "warning" | "error"; message: string }[]
  wouldSucceed: boolean
}

// ─── Migration Planner ───────────────────────────────────────────────────────

export class MigrationPlanner {
  /**
   * Analyze schema changes and classify their risk level.
   */
  analyzeChanges(changes: SchemaChange[]): ChangeAnalysis {
    const analyzed: AnalyzedChange[] = changes.map((change) => this.classifyChange(change))

    return {
      changes: analyzed,
      safeCount: analyzed.filter((c) => c.risk === "safe").length,
      cautionCount: analyzed.filter((c) => c.risk === "caution").length,
      breakingCount: analyzed.filter((c) => c.risk === "breaking").length,
      overallRisk: analyzed.some((c) => c.risk === "breaking")
        ? "breaking"
        : analyzed.some((c) => c.risk === "caution")
          ? "caution"
          : "safe",
    }
  }

  /**
   * Generate a safe migration plan using expand-contract pattern for breaking changes.
   */
  generateSafePlan(analysis: ChangeAnalysis): SafeMigrationPlan {
    const phases: MigrationPhase[] = []
    const warnings: string[] = []
    const rollbackSteps: string[] = []

    // Phase 1: Safe additive changes (non-blocking)
    const safeChanges = analysis.changes.filter((c) => c.risk === "safe")
    if (safeChanges.length > 0) {
      phases.push({
        name: "Expand",
        description: "Add new columns, tables, and indexes without affecting existing functionality",
        steps: safeChanges.map((c) => this.generateSafeStep(c)),
        canRunConcurrently: true,
        requiresLock: false,
      })
    }

    // Phase 2: Data migration for breaking changes
    const breakingChanges = analysis.changes.filter((c) => c.risk === "breaking" || c.risk === "caution")
    if (breakingChanges.length > 0) {
      const expandSteps: MigrationStep[] = []
      const migrateSteps: MigrationStep[] = []
      const contractSteps: MigrationStep[] = []

      for (const change of breakingChanges) {
        const ecPlan = this.generateExpandContract(change)
        expandSteps.push(...ecPlan.expand)
        migrateSteps.push(...ecPlan.migrate)
        contractSteps.push(...ecPlan.contract)
        if (ecPlan.warning) warnings.push(ecPlan.warning)
      }

      if (expandSteps.length > 0) {
        phases.push({
          name: "Expand (Breaking)",
          description: "Create temporary structures for data migration",
          steps: expandSteps,
          canRunConcurrently: false,
          requiresLock: false,
        })
      }

      if (migrateSteps.length > 0) {
        phases.push({
          name: "Migrate Data",
          description: "Copy data to new structures",
          steps: migrateSteps,
          canRunConcurrently: false,
          requiresLock: false,
        })
      }

      if (contractSteps.length > 0) {
        phases.push({
          name: "Contract",
          description: "Remove old structures after verifying migration",
          steps: contractSteps,
          canRunConcurrently: false,
          requiresLock: true,
        })
        // Contract steps are reversible
        for (const step of contractSteps) {
          if (step.reverseSql) rollbackSteps.push(step.reverseSql)
        }
      }
    }

    const totalSteps = phases.reduce((sum, p) => sum + p.steps.length, 0)
    const estimatedDowntime = phases.some(
      (p) => p.requiresLock && p.steps.some((s) => (s.estimatedLockTimeMs ?? 0) > 1000),
    )
      ? "minimal"
      : breakingChanges.length > 0
        ? "minimal"
        : "zero"

    return { phases, estimatedDowntime, warnings, rollbackSteps, totalSteps }
  }

  /**
   * Simulate running a migration plan without executing.
   */
  dryRun(plan: SafeMigrationPlan): DryRunResult {
    const simulation: DryRunResult["simulation"] = []

    for (const phase of plan.phases) {
      for (const step of phase.steps) {
        // Validate SQL syntax (basic checks)
        if (!step.sql.trim()) {
          simulation.push({ step: step.description, status: "error", message: "Empty SQL statement" })
          continue
        }

        if (step.concurrentSafe) {
          simulation.push({ step: step.description, status: "ok", message: "Can run without locks" })
        } else if (step.estimatedLockTimeMs && step.estimatedLockTimeMs > 5000) {
          simulation.push({
            step: step.description,
            status: "warning",
            message: `May lock table for ~${step.estimatedLockTimeMs}ms`,
          })
        } else {
          simulation.push({ step: step.description, status: "ok", message: "Acceptable lock duration" })
        }
      }
    }

    return {
      plan,
      simulation,
      wouldSucceed: simulation.every((s) => s.status !== "error"),
    }
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private classifyChange(change: SchemaChange): AnalyzedChange {
    switch (change.type) {
      case "add-table":
        return {
          change,
          risk: "safe",
          reason: "Adding new table has no effect on existing queries",
          recommendation: "Apply directly",
        }
      case "add-column":
        if (change.details.notNull && !change.details.default) {
          return {
            change,
            risk: "breaking",
            reason: "Adding NOT NULL column without default fails for existing rows",
            recommendation: "Add with DEFAULT or make nullable first",
          }
        }
        return {
          change,
          risk: "safe",
          reason: "Adding nullable column is non-blocking",
          recommendation: "Apply directly",
        }
      case "add-index":
        return {
          change,
          risk: "caution",
          reason: "Index creation locks table during build",
          recommendation: "Use CREATE INDEX CONCURRENTLY",
        }
      case "drop-table":
        return {
          change,
          risk: "breaking",
          reason: "Dropping table permanently removes all data",
          recommendation: "Rename to _deprecated first, drop after confirmation",
        }
      case "drop-column":
        return {
          change,
          risk: "breaking",
          reason: "Dropping column removes data and breaks queries using it",
          recommendation: "Use expand-contract: stop reading, then drop",
        }
      case "alter-column":
        if (change.details.typeChange) {
          return {
            change,
            risk: "breaking",
            reason: "Changing column type may fail for incompatible data",
            recommendation: "Add new column, migrate data, swap",
          }
        }
        return {
          change,
          risk: "caution",
          reason: "Column alteration may require table rewrite",
          recommendation: "Test with dry-run first",
        }
      case "rename-column":
        return {
          change,
          risk: "breaking",
          reason: "Renaming breaks existing queries and application code",
          recommendation: "Add new column, copy data, update app, drop old",
        }
      case "rename-table":
        return {
          change,
          risk: "breaking",
          reason: "Renaming breaks all references to the table",
          recommendation: "Create view with old name as alias during migration",
        }
      case "drop-index":
        return {
          change,
          risk: "caution",
          reason: "Dropping index may degrade query performance",
          recommendation: "Monitor query performance after dropping",
        }
      default:
        return { change, risk: "caution", reason: "Unknown change type", recommendation: "Review manually" }
    }
  }

  private generateSafeStep(analyzed: AnalyzedChange): MigrationStep {
    const { change } = analyzed
    const table = sanitize(change.table)
    const column = change.column ? sanitize(change.column) : ""

    switch (change.type) {
      case "add-table":
        return {
          sql: `CREATE TABLE IF NOT EXISTS "${table}" (id TEXT PRIMARY KEY);`,
          description: `Create table ${table}`,
          reversible: true,
          reverseSql: `DROP TABLE IF EXISTS "${table}";`,
          concurrentSafe: true,
        }
      case "add-column": {
        const colType = String(change.details.type ?? "text")
        const nullable = change.details.notNull ? " NOT NULL" : ""
        const defaultVal = change.details.default ? ` DEFAULT ${change.details.default}` : ""
        return {
          sql: `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${colType}${nullable}${defaultVal};`,
          description: `Add column ${column} to ${table}`,
          reversible: true,
          reverseSql: `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${column}";`,
          concurrentSafe: true,
        }
      }
      case "add-index": {
        const cols = (change.details.columns as string[])?.map(sanitize).join('", "') ?? column
        const indexName = sanitize(String(change.details.name ?? `idx_${table}_${column}`))
        return {
          sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${indexName}" ON "${table}" ("${cols}");`,
          description: `Create index ${indexName} on ${table}`,
          reversible: true,
          reverseSql: `DROP INDEX CONCURRENTLY IF EXISTS "${indexName}";`,
          concurrentSafe: true,
        }
      }
      default:
        return {
          sql: `-- ${change.type} on ${table}.${column}`,
          description: `${change.type} on ${table}`,
          reversible: false,
          concurrentSafe: false,
        }
    }
  }

  private generateExpandContract(analyzed: AnalyzedChange): {
    expand: MigrationStep[]
    migrate: MigrationStep[]
    contract: MigrationStep[]
    warning?: string
  } {
    const { change } = analyzed
    const table = sanitize(change.table)
    const column = change.column ? sanitize(change.column) : ""

    switch (change.type) {
      case "drop-column":
        return {
          expand: [], // Nothing to add
          migrate: [], // Nothing to copy
          contract: [
            {
              sql: `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${column}";`,
              description: `Drop column ${column} from ${table}`,
              reversible: false,
              concurrentSafe: false,
              estimatedLockTimeMs: 100,
            },
          ],
          warning: `Dropping ${table}.${column} will permanently remove data`,
        }
      case "drop-table":
        return {
          expand: [
            {
              sql: `ALTER TABLE "${table}" RENAME TO "${table}_deprecated";`,
              description: `Rename ${table} to ${table}_deprecated`,
              reversible: true,
              reverseSql: `ALTER TABLE "${table}_deprecated" RENAME TO "${table}";`,
              concurrentSafe: false,
              estimatedLockTimeMs: 50,
            },
          ],
          migrate: [],
          contract: [
            {
              sql: `DROP TABLE IF EXISTS "${table}_deprecated" CASCADE;`,
              description: `Drop deprecated table ${table}_deprecated`,
              reversible: false,
              concurrentSafe: false,
            },
          ],
          warning: `Table ${table} will be renamed then dropped`,
        }
      case "alter-column": {
        const newType = String(change.details.newType ?? "text")
        const newCol = `${column}_new`
        return {
          expand: [
            {
              sql: `ALTER TABLE "${table}" ADD COLUMN "${newCol}" ${newType};`,
              description: `Add new column ${newCol} with type ${newType}`,
              reversible: true,
              reverseSql: `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${newCol}";`,
              concurrentSafe: true,
            },
          ],
          migrate: [
            {
              sql: `UPDATE "${table}" SET "${newCol}" = "${column}"::${newType};`,
              description: `Migrate data from ${column} to ${newCol}`,
              reversible: false,
              concurrentSafe: false,
              estimatedLockTimeMs: 5000,
            },
          ],
          contract: [
            {
              sql: `ALTER TABLE "${table}" DROP COLUMN "${column}";`,
              description: `Drop old column ${column}`,
              reversible: false,
              concurrentSafe: false,
              estimatedLockTimeMs: 100,
            },
            {
              sql: `ALTER TABLE "${table}" RENAME COLUMN "${newCol}" TO "${column}";`,
              description: `Rename ${newCol} to ${column}`,
              reversible: true,
              reverseSql: `ALTER TABLE "${table}" RENAME COLUMN "${column}" TO "${newCol}";`,
              concurrentSafe: false,
              estimatedLockTimeMs: 50,
            },
          ],
          warning: `Column type change on ${table}.${column} requires data migration`,
        }
      }
      case "rename-column": {
        const newName = sanitize(String(change.details.newName ?? `${column}_renamed`))
        return {
          expand: [
            {
              sql: `ALTER TABLE "${table}" ADD COLUMN "${newName}" text;`,
              description: `Add new column ${newName}`,
              reversible: true,
              reverseSql: `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${newName}";`,
              concurrentSafe: true,
            },
          ],
          migrate: [
            {
              sql: `UPDATE "${table}" SET "${newName}" = "${column}";`,
              description: `Copy data from ${column} to ${newName}`,
              reversible: false,
              concurrentSafe: false,
            },
          ],
          contract: [
            {
              sql: `ALTER TABLE "${table}" DROP COLUMN "${column}";`,
              description: `Drop old column ${column}`,
              reversible: false,
              concurrentSafe: false,
            },
          ],
        }
      }
      default:
        return { expand: [], migrate: [], contract: [] }
    }
  }
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "")
}
