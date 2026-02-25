/**
 * Migration Copilot.
 * Analyzes database migrations for safety, suggests strategies,
 * generates rollback plans, and estimates migration impact.
 *
 * Features:
 *   - Migration safety analysis (destructive changes, data loss risk)
 *   - Safe migration strategy suggestions (add → backfill → swap → drop)
 *   - Slow query index optimization suggestions
 *   - Automatic rollback plan generation
 *   - Downtime and lock duration estimation
 *   - Common migration pitfall detection
 *
 * Usage:
 *   const copilot = new MigrationCopilot()
 *   const analysis = copilot.analyzeMigration(migrationSQL)
 *   const rollback = copilot.generateRollbackPlan(migrationSQL)
 */

import type { AiProviderAdapter, SchemaInfo } from "./ai-assistant.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MigrationAnalysis {
  /** Overall risk level */
  riskLevel: "low" | "medium" | "high" | "critical"
  /** Identified issues */
  issues: MigrationIssue[]
  /** Improvement suggestions */
  suggestions: string[]
  /** Estimated migration duration (human-readable) */
  estimatedDuration: string
}

export interface MigrationIssue {
  type: "destructive" | "data-loss" | "locking" | "performance" | "compatibility"
  description: string
  severity: "info" | "warning" | "critical"
  line?: number
}

export interface MigrationSafetyCheck {
  /** Name of the check */
  check: string
  /** Whether the check passed */
  passed: boolean
  /** Descriptive message */
  message: string
  /** Severity if check failed */
  severity: "info" | "warning" | "critical"
}

export interface IndexOptimization {
  /** Table to optimize */
  table: string
  /** Columns to index */
  columns: string[]
  /** Index type */
  type: "btree" | "hash" | "composite" | "partial"
  /** Why this index helps */
  reason: string
  /** Estimated improvement description */
  estimatedImprovement: string
}

export interface MigrationImpact {
  /** Estimated downtime */
  estimatedDowntime: string
  /** Estimated lock duration */
  lockDuration: string
  /** Tables affected */
  tablesAffected: string[]
  /** Whether the migration is backwards-compatible */
  backwardsCompatible: boolean
  /** Data impact description */
  dataImpact: string
}

export interface RollbackPlan {
  /** SQL statements for rollback */
  steps: RollbackStep[]
  /** Warnings about rollback limitations */
  warnings: string[]
  /** Whether full rollback is possible */
  fullRollbackPossible: boolean
}

export interface RollbackStep {
  /** Description of this rollback step */
  description: string
  /** SQL to execute */
  sql: string
  /** Whether data may be lost in rollback */
  dataLossRisk: boolean
}

export interface SafeMigrationStrategy {
  /** Ordered phases of the migration */
  phases: MigrationPhase[]
  /** Total estimated duration */
  totalDuration: string
  /** Whether zero-downtime is achievable */
  zeroDowntime: boolean
}

export interface MigrationPhase {
  /** Phase name */
  name: string
  /** Description of what happens */
  description: string
  /** SQL statements for this phase */
  sql: string[]
  /** Whether this phase can be rolled back */
  reversible: boolean
}

export interface MigrationCopilotOptions {
  aiProvider?: AiProviderAdapter
}

// ─── Patterns ────────────────────────────────────────────────────────────────

const DESTRUCTIVE_PATTERNS = [
  {
    pattern: /DROP\s+TABLE/gi,
    type: "destructive" as const,
    severity: "critical" as const,
    description: "Drops a table — all data will be permanently lost",
  },
  {
    pattern: /DROP\s+COLUMN/gi,
    type: "data-loss" as const,
    severity: "critical" as const,
    description: "Drops a column — column data will be permanently lost",
  },
  {
    pattern: /TRUNCATE/gi,
    type: "data-loss" as const,
    severity: "critical" as const,
    description: "Truncates a table — all rows will be deleted",
  },
  {
    pattern: /DROP\s+INDEX/gi,
    type: "performance" as const,
    severity: "warning" as const,
    description: "Drops an index — queries may slow down",
  },
  {
    pattern: /ALTER\s+TABLE\s+\w+\s+RENAME/gi,
    type: "compatibility" as const,
    severity: "warning" as const,
    description: "Renames a table or column — existing code referencing the old name will break",
  },
]

const LOCKING_PATTERNS = [
  {
    pattern: /ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN\s+\w+\s+\w+\s+NOT\s+NULL(?!\s+DEFAULT)/gi,
    severity: "critical" as const,
    description: "Adding NOT NULL column without DEFAULT requires full table rewrite and lock",
  },
  {
    pattern: /CREATE\s+INDEX(?!\s+CONCURRENTLY)/gi,
    severity: "warning" as const,
    description: "Creating index without CONCURRENTLY locks writes on the table",
  },
  {
    pattern: /ALTER\s+TABLE\s+\w+\s+ALTER\s+COLUMN\s+\w+\s+TYPE/gi,
    severity: "warning" as const,
    description: "Changing column type requires table rewrite",
  },
]

// ─── Migration Copilot Engine ────────────────────────────────────────────────

export class MigrationCopilot {
  private aiProvider?: AiProviderAdapter

  constructor(options: MigrationCopilotOptions = {}) {
    this.aiProvider = options.aiProvider
  }

  /**
   * Analyze a migration for safety issues.
   */
  analyzeMigration(migration: string): MigrationAnalysis {
    const issues: MigrationIssue[] = []
    const suggestions: string[] = []

    const lines = migration.split("\n")

    // Check destructive patterns
    for (const dp of DESTRUCTIVE_PATTERNS) {
      let match: RegExpExecArray | null
      const re = new RegExp(dp.pattern.source, dp.pattern.flags)
      while ((match = re.exec(migration)) !== null) {
        const line = migration.substring(0, match.index).split("\n").length
        issues.push({
          type: dp.type,
          description: dp.description,
          severity: dp.severity,
          line,
        })
      }
    }

    // Check locking patterns
    for (const lp of LOCKING_PATTERNS) {
      let match: RegExpExecArray | null
      const re = new RegExp(lp.pattern.source, lp.pattern.flags)
      while ((match = re.exec(migration)) !== null) {
        const line = migration.substring(0, match.index).split("\n").length
        issues.push({
          type: "locking",
          description: lp.description,
          severity: lp.severity,
          line,
        })
      }
    }

    // Check for missing transaction wrapper
    if (!migration.toLowerCase().includes("begin") && lines.length > 1) {
      suggestions.push("Consider wrapping migration in a transaction (BEGIN/COMMIT) for atomicity")
    }

    // Check for large data modifications
    if (/UPDATE\s+\w+\s+SET/.test(migration) && !/WHERE/.test(migration.split(/UPDATE\s+\w+\s+SET/)[1] ?? "")) {
      issues.push({
        type: "performance",
        description: "UPDATE without WHERE clause affects all rows — may be slow and lock the table",
        severity: "warning",
      })
      suggestions.push("Add a WHERE clause or batch the UPDATE into smaller chunks")
    }

    // Suggest safe patterns
    if (issues.some((i) => i.type === "destructive" || i.type === "data-loss")) {
      suggestions.push("Use the add-new → backfill → swap → drop pattern for safer migrations")
      suggestions.push("Create a backup before running destructive migrations")
    }

    if (issues.some((i) => i.type === "locking")) {
      suggestions.push("Use CREATE INDEX CONCURRENTLY to avoid locking writes")
      suggestions.push("Schedule locking migrations during low-traffic periods")
    }

    // Determine risk level
    const riskLevel = this.calculateRiskLevel(issues)

    // Estimate duration based on complexity
    const stmtCount = (migration.match(/;\s*$/gm) ?? []).length || 1
    const estimatedDuration = this.estimateDuration(stmtCount, issues)

    return { riskLevel, issues, suggestions, estimatedDuration }
  }

  /**
   * Suggest a safe migration strategy (add new → backfill → swap → drop).
   */
  suggestSafeStrategy(migration: string): SafeMigrationStrategy {
    const phases: MigrationPhase[] = []
    const hasDropColumn = /DROP\s+COLUMN\s+"?(\w+)"?/i.test(migration)
    const hasDropTable = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/i.test(migration)
    const hasRename = /RENAME\s+(COLUMN\s+)?"?(\w+)"?\s+TO\s+"?(\w+)"?/i.test(migration)
    const hasAddNotNull = /ADD\s+COLUMN\s+"?(\w+)"?\s+(\w+)\s+NOT\s+NULL/i.test(migration)

    if (hasDropColumn || hasRename) {
      const colMatch =
        /DROP\s+COLUMN\s+"?(\w+)"?/i.exec(migration) ??
        /RENAME\s+(?:COLUMN\s+)?"?(\w+)"?\s+TO\s+"?(\w+)"?/i.exec(migration)
      const oldCol = colMatch?.[1] ?? "old_column"
      const newCol = colMatch?.[2] ?? "new_column"
      const tableMatch = /ALTER\s+TABLE\s+"?(\w+)"?/i.exec(migration)
      const tableName = tableMatch?.[1] ?? "table"

      phases.push({
        name: "Add new column",
        description: `Add the new column "${newCol}" alongside the existing "${oldCol}"`,
        sql: [`ALTER TABLE "${tableName}" ADD COLUMN "${newCol}" TEXT;`],
        reversible: true,
      })

      phases.push({
        name: "Backfill data",
        description: `Copy data from "${oldCol}" to "${newCol}" in batches`,
        sql: [`UPDATE "${tableName}" SET "${newCol}" = "${oldCol}" WHERE "${newCol}" IS NULL LIMIT 1000;`],
        reversible: true,
      })

      phases.push({
        name: "Update application code",
        description: `Update application to read from "${newCol}" instead of "${oldCol}"`,
        sql: ["-- Deploy application code that reads/writes the new column"],
        reversible: true,
      })

      phases.push({
        name: "Drop old column",
        description: `Remove the old column "${oldCol}" after verification`,
        sql: [`ALTER TABLE "${tableName}" DROP COLUMN "${oldCol}";`],
        reversible: false,
      })
    } else if (hasDropTable) {
      const tableMatch = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/i.exec(migration)
      const tableName = tableMatch?.[1] ?? "table"

      phases.push({
        name: "Stop writes",
        description: `Stop all writes to "${tableName}" in application code`,
        sql: ["-- Deploy application code that no longer writes to the table"],
        reversible: true,
      })

      phases.push({
        name: "Create backup",
        description: `Backup "${tableName}" data before dropping`,
        sql: [`CREATE TABLE "${tableName}_backup" AS SELECT * FROM "${tableName}";`],
        reversible: true,
      })

      phases.push({
        name: "Drop table",
        description: `Drop the table after verifying no dependencies remain`,
        sql: [`DROP TABLE "${tableName}";`],
        reversible: false,
      })
    } else if (hasAddNotNull) {
      const colMatch = /ADD\s+COLUMN\s+"?(\w+)"?\s+(\w+)\s+NOT\s+NULL/i.exec(migration)
      const colName = colMatch?.[1] ?? "column"
      const colType = colMatch?.[2] ?? "TEXT"
      const tableMatch = /ALTER\s+TABLE\s+"?(\w+)"?/i.exec(migration)
      const tableName = tableMatch?.[1] ?? "table"

      phases.push({
        name: "Add nullable column",
        description: `Add "${colName}" as nullable first to avoid table lock`,
        sql: [`ALTER TABLE "${tableName}" ADD COLUMN "${colName}" ${colType};`],
        reversible: true,
      })

      phases.push({
        name: "Backfill defaults",
        description: `Set default values for existing rows in batches`,
        sql: [`UPDATE "${tableName}" SET "${colName}" = '' WHERE "${colName}" IS NULL LIMIT 1000;`],
        reversible: true,
      })

      phases.push({
        name: "Add NOT NULL constraint",
        description: `Add the NOT NULL constraint after all rows have values`,
        sql: [`ALTER TABLE "${tableName}" ALTER COLUMN "${colName}" SET NOT NULL;`],
        reversible: true,
      })
    } else {
      // Simple migration — wrap in a single phase
      phases.push({
        name: "Execute migration",
        description: "Apply migration changes",
        sql: migration
          .split(";")
          .filter((s) => s.trim())
          .map((s) => s.trim() + ";"),
        reversible: !DESTRUCTIVE_PATTERNS.some((dp) => dp.pattern.test(migration)),
      })
    }

    const hasIrreversible = phases.some((p) => !p.reversible)
    const phaseCount = phases.length
    const totalDuration = phaseCount <= 1 ? "< 5 minutes" : phaseCount <= 3 ? "15-30 minutes" : "1-2 hours"

    return {
      phases,
      totalDuration,
      zeroDowntime: !hasIrreversible && !hasAddNotNull,
    }
  }

  /**
   * Analyze slow queries and suggest index optimizations.
   */
  suggestIndexOptimizations(schema: SchemaInfo, slowQueries: string[]): IndexOptimization[] {
    const optimizations: IndexOptimization[] = []
    const seen = new Set<string>()

    for (const query of slowQueries) {
      // Extract WHERE clause columns
      const whereMatches = query.matchAll(/WHERE\s+(?:"?(\w+)"?\s*(?:=|<|>|<=|>=|LIKE|IN|IS))/gi)
      for (const match of whereMatches) {
        const col = match[1]
        // Find which table this column belongs to
        const tableMatch = /FROM\s+"?(\w+)"?/i.exec(query)
        const tableName = tableMatch?.[1]
        if (!tableName) continue

        const table = schema.tables.find((t) => t.name === tableName)
        if (!table) continue

        const hasIndex = table.indexes.some((i) => i.columns.includes(col))
        const key = `${tableName}.${col}`
        if (!hasIndex && !seen.has(key)) {
          seen.add(key)
          optimizations.push({
            table: tableName,
            columns: [col],
            type: "btree",
            reason: `Column "${col}" is used in WHERE clause but not indexed`,
            estimatedImprovement: "10-100x faster filtering on this column",
          })
        }
      }

      // Extract ORDER BY columns
      const orderMatch = /ORDER\s+BY\s+"?(\w+)"?/i.exec(query)
      if (orderMatch) {
        const col = orderMatch[1]
        const tableMatch = /FROM\s+"?(\w+)"?/i.exec(query)
        const tableName = tableMatch?.[1]
        if (tableName) {
          const table = schema.tables.find((t) => t.name === tableName)
          const key = `${tableName}.${col}`
          if (table && !table.indexes.some((i) => i.columns.includes(col)) && !seen.has(key)) {
            seen.add(key)
            optimizations.push({
              table: tableName,
              columns: [col],
              type: "btree",
              reason: `Column "${col}" is used in ORDER BY but not indexed`,
              estimatedImprovement: "Eliminates sort operation for ordered queries",
            })
          }
        }
      }

      // Detect composite index opportunities (WHERE col1 = X AND col2 = Y)
      const compositeMatch = query.match(/WHERE\s+"?(\w+)"?\s*=\s*\S+\s+AND\s+"?(\w+)"?\s*=\s*\S+/i)
      if (compositeMatch) {
        const tableMatch = /FROM\s+"?(\w+)"?/i.exec(query)
        const tableName = tableMatch?.[1]
        if (tableName) {
          const key = `${tableName}.${compositeMatch[1]},${compositeMatch[2]}`
          if (!seen.has(key)) {
            seen.add(key)
            optimizations.push({
              table: tableName,
              columns: [compositeMatch[1], compositeMatch[2]],
              type: "composite",
              reason: `Columns "${compositeMatch[1]}" and "${compositeMatch[2]}" are filtered together`,
              estimatedImprovement: "Single index lookup instead of two separate scans",
            })
          }
        }
      }

      // Detect JOIN column indexing needs
      const joinMatches = query.matchAll(/JOIN\s+"?(\w+)"?\s+ON\s+"?\w+"?\."?(\w+)"?\s*=\s*"?\w+"?\."?(\w+)"?/gi)
      for (const jm of joinMatches) {
        const joinTable = jm[1]
        const joinCol = jm[2]
        const table = schema.tables.find((t) => t.name === joinTable)
        const key = `${joinTable}.${joinCol}`
        if (table && !table.indexes.some((i) => i.columns.includes(joinCol)) && !seen.has(key)) {
          seen.add(key)
          optimizations.push({
            table: joinTable,
            columns: [joinCol],
            type: "btree",
            reason: `Column "${joinCol}" is used in JOIN but not indexed`,
            estimatedImprovement: "Dramatically faster join operations",
          })
        }
      }
    }

    return optimizations
  }

  /**
   * Generate a rollback plan for a migration.
   */
  generateRollbackPlan(migration: string): RollbackPlan {
    const steps: RollbackStep[] = []
    const warnings: string[] = []
    let fullRollbackPossible = true

    const statements = migration
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)

    for (const stmt of statements) {
      const _upper = stmt.toUpperCase()

      if (/CREATE\s+TABLE\s+/i.test(stmt)) {
        const tableMatch = /CREATE\s+TABLE\s+"?(\w+)"?/i.exec(stmt)
        const name = tableMatch?.[1] ?? "unknown"
        steps.push({
          description: `Drop table "${name}"`,
          sql: `DROP TABLE IF EXISTS "${name}";`,
          dataLossRisk: false,
        })
      } else if (/DROP\s+TABLE\s+/i.test(stmt)) {
        const tableMatch = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/i.exec(stmt)
        const name = tableMatch?.[1] ?? "unknown"
        steps.push({
          description: `Recreate table "${name}" (DATA WILL BE LOST)`,
          sql: `-- Cannot automatically recreate "${name}" — restore from backup`,
          dataLossRisk: true,
        })
        warnings.push(`Cannot restore data for dropped table "${name}" — use backup`)
        fullRollbackPossible = false
      } else if (/ALTER\s+TABLE\s+"?\w+"?\s+ADD\s+COLUMN/i.test(stmt)) {
        const tableMatch = /ALTER\s+TABLE\s+"?(\w+)"?/i.exec(stmt)
        const colMatch = /ADD\s+COLUMN\s+"?(\w+)"?/i.exec(stmt)
        const table = tableMatch?.[1] ?? "unknown"
        const col = colMatch?.[1] ?? "unknown"
        steps.push({
          description: `Drop column "${col}" from "${table}"`,
          sql: `ALTER TABLE "${table}" DROP COLUMN "${col}";`,
          dataLossRisk: false,
        })
      } else if (/ALTER\s+TABLE\s+"?\w+"?\s+DROP\s+COLUMN/i.test(stmt)) {
        const tableMatch = /ALTER\s+TABLE\s+"?(\w+)"?/i.exec(stmt)
        const colMatch = /DROP\s+COLUMN\s+"?(\w+)"?/i.exec(stmt)
        const table = tableMatch?.[1] ?? "unknown"
        const col = colMatch?.[1] ?? "unknown"
        steps.push({
          description: `Recreate column "${col}" on "${table}" (DATA WILL BE LOST)`,
          sql: `-- Cannot automatically recreate "${table}.${col}" — restore from backup`,
          dataLossRisk: true,
        })
        warnings.push(`Cannot restore data for dropped column "${table}.${col}"`)
        fullRollbackPossible = false
      } else if (/CREATE\s+INDEX/i.test(stmt)) {
        const idxMatch = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?"?(\w+)"?/i.exec(stmt)
        const name = idxMatch?.[1] ?? "unknown"
        steps.push({
          description: `Drop index "${name}"`,
          sql: `DROP INDEX IF EXISTS "${name}";`,
          dataLossRisk: false,
        })
      } else if (/DROP\s+INDEX/i.test(stmt)) {
        const idxMatch = /DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/i.exec(stmt)
        const name = idxMatch?.[1] ?? "unknown"
        steps.push({
          description: `Recreate index "${name}"`,
          sql: `-- Recreate index "${name}" — original definition needed`,
          dataLossRisk: false,
        })
        warnings.push(`Index "${name}" definition needed to recreate it`)
      } else if (/ALTER\s+TABLE.*RENAME/i.test(stmt)) {
        const renameMatch = /RENAME\s+(?:COLUMN\s+)?"?(\w+)"?\s+TO\s+"?(\w+)"?/i.exec(stmt)
        const tableMatch = /ALTER\s+TABLE\s+"?(\w+)"?/i.exec(stmt)
        if (renameMatch && tableMatch) {
          const table = tableMatch[1]
          steps.push({
            description: `Rename "${renameMatch[2]}" back to "${renameMatch[1]}" on "${table}"`,
            sql: `ALTER TABLE "${table}" RENAME COLUMN "${renameMatch[2]}" TO "${renameMatch[1]}";`,
            dataLossRisk: false,
          })
        }
      }
    }

    // Reverse the steps for correct rollback order
    steps.reverse()

    return { steps, warnings, fullRollbackPossible }
  }

  /**
   * Estimate the impact of a migration.
   */
  estimateMigrationImpact(migration: string): MigrationImpact {
    const tablesAffected: string[] = []

    // Extract all table names mentioned
    const tableMatches = migration.matchAll(/(?:TABLE|FROM|INTO|UPDATE)\s+"?(\w+)"?/gi)
    for (const match of tableMatches) {
      if (!tablesAffected.includes(match[1])) {
        tablesAffected.push(match[1])
      }
    }

    const hasDestructive = DESTRUCTIVE_PATTERNS.some((dp) => dp.pattern.test(migration))
    const hasLocking = LOCKING_PATTERNS.some((lp) => lp.pattern.test(migration))
    const stmtCount = (migration.match(/;\s*$/gm) ?? []).length || 1

    // Estimate downtime
    let estimatedDowntime = "None"
    if (hasLocking) {
      estimatedDowntime = stmtCount > 5 ? "5-15 minutes" : "1-5 minutes"
    }
    if (hasDestructive) {
      estimatedDowntime = "Varies — depends on table size"
    }

    // Estimate lock duration
    let lockDuration = "None"
    if (/ADD\s+COLUMN.*NOT\s+NULL(?!\s+DEFAULT)/i.test(migration)) {
      lockDuration = "Full table rewrite duration"
    } else if (/CREATE\s+INDEX(?!\s+CONCURRENTLY)/i.test(migration)) {
      lockDuration = "Index creation duration (write lock)"
    } else if (hasLocking) {
      lockDuration = "Brief schema lock"
    }

    // Backwards compatibility
    const backwardsCompatible = !hasDestructive && !/RENAME/i.test(migration)

    // Data impact
    let dataImpact = "No data changes"
    if (/DROP\s+TABLE/i.test(migration)) {
      dataImpact = "Table(s) will be permanently dropped with all data"
    } else if (/DROP\s+COLUMN/i.test(migration)) {
      dataImpact = "Column(s) will be permanently dropped with their data"
    } else if (/TRUNCATE/i.test(migration)) {
      dataImpact = "All rows will be deleted"
    } else if (/UPDATE\s+\w+\s+SET/i.test(migration)) {
      dataImpact = "Existing data will be modified"
    } else if (/INSERT/i.test(migration)) {
      dataImpact = "New data will be added"
    }

    return {
      estimatedDowntime,
      lockDuration,
      tablesAffected,
      backwardsCompatible,
      dataImpact,
    }
  }

  /**
   * Validate a migration for common pitfalls.
   */
  validateMigration(migration: string): MigrationSafetyCheck[] {
    const checks: MigrationSafetyCheck[] = []

    // Check: Has transaction wrapper
    const hasTransaction = /BEGIN/i.test(migration) && /COMMIT/i.test(migration)
    checks.push({
      check: "transaction-wrapper",
      passed: hasTransaction,
      message: hasTransaction
        ? "Migration is wrapped in a transaction"
        : "Migration should be wrapped in BEGIN/COMMIT for atomicity",
      severity: "warning",
    })

    // Check: No DROP without IF EXISTS
    const hasUnsafeDrop = /DROP\s+(?:TABLE|INDEX)\s+(?!IF\s+EXISTS)"?\w+"?/i.test(migration)
    checks.push({
      check: "safe-drop",
      passed: !hasUnsafeDrop,
      message: hasUnsafeDrop
        ? "Use DROP ... IF EXISTS to prevent errors when object doesn't exist"
        : "All DROP statements use IF EXISTS",
      severity: "warning",
    })

    // Check: No destructive operations
    const hasDestructive = DESTRUCTIVE_PATTERNS.some((dp) => dp.severity === "critical" && dp.pattern.test(migration))
    checks.push({
      check: "no-destructive",
      passed: !hasDestructive,
      message: hasDestructive
        ? "Migration contains destructive operations (DROP TABLE/COLUMN, TRUNCATE)"
        : "No destructive operations detected",
      severity: "critical",
    })

    // Check: Concurrent index creation
    const hasNonConcurrentIndex = /CREATE\s+INDEX(?!\s+CONCURRENTLY)/i.test(migration)
    const hasIndex = /CREATE\s+INDEX/i.test(migration)
    checks.push({
      check: "concurrent-index",
      passed: !hasNonConcurrentIndex,
      message: hasNonConcurrentIndex
        ? "Use CREATE INDEX CONCURRENTLY to avoid write locks"
        : hasIndex
          ? "Index creation uses CONCURRENTLY"
          : "No index creation in migration",
      severity: "warning",
    })

    // Check: NOT NULL without DEFAULT
    const hasNotNullNoDefault = /ADD\s+COLUMN\s+\w+\s+\w+\s+NOT\s+NULL(?!\s+DEFAULT)/i.test(migration)
    checks.push({
      check: "not-null-default",
      passed: !hasNotNullNoDefault,
      message: hasNotNullNoDefault
        ? "Adding NOT NULL column without DEFAULT requires table rewrite — add as nullable first, then backfill"
        : "No NOT NULL columns without defaults",
      severity: "critical",
    })

    // Check: Data backup recommended
    const needsBackup = DESTRUCTIVE_PATTERNS.some(
      (dp) => (dp.type === "destructive" || dp.type === "data-loss") && dp.pattern.test(migration),
    )
    checks.push({
      check: "backup-recommended",
      passed: !needsBackup,
      message: needsBackup
        ? "Create a backup before running this migration — data loss is possible"
        : "No data loss risk detected",
      severity: needsBackup ? "critical" : "info",
    })

    return checks
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private calculateRiskLevel(issues: MigrationIssue[]): "low" | "medium" | "high" | "critical" {
    if (issues.some((i) => i.severity === "critical")) return "critical"
    if (issues.filter((i) => i.severity === "warning").length >= 3) return "high"
    if (issues.some((i) => i.severity === "warning")) return "medium"
    return "low"
  }

  private estimateDuration(stmtCount: number, issues: MigrationIssue[]): string {
    const hasLocking = issues.some((i) => i.type === "locking")
    const hasDestructive = issues.some((i) => i.type === "destructive")

    if (hasDestructive && hasLocking) return "5-30 minutes (depends on table size)"
    if (hasLocking) return "1-10 minutes"
    if (stmtCount > 10) return "1-5 minutes"
    if (stmtCount > 3) return "< 1 minute"
    return "< 10 seconds"
  }
}
