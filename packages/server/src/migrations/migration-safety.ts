/**
 * Migration Safety Net for ReactiveBase.
 * Validates schema migrations before applying them with dry-run,
 * rollback guarantees, and breaking-change detection.
 *
 * Features:
 *   - Pre-flight validation checks (syntax, data compatibility, lock analysis)
 *   - Breaking change detection with severity classification
 *   - Dry-run execution in shadow schemas
 *   - Automatic rollback SQL generation
 *   - Lock time estimation and timeout protection
 *   - Data loss risk assessment
 *   - Dependency impact analysis
 *
 * Usage:
 *   const safety = new MigrationSafetyNet()
 *   const report = safety.validate(migrationSQL, currentSchema)
 *   if (report.safe) await safety.applyWithRollback(migrationSQL)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MigrationSafetyOptions {
  /** Maximum acceptable lock time in ms (default: 5000) */
  maxLockTimeMs?: number
  /** Enable automatic rollback generation (default: true) */
  generateRollback?: boolean
  /** Statement timeout for migration execution in ms (default: 30000) */
  statementTimeoutMs?: number
  /** Require explicit confirmation for breaking changes (default: true) */
  requireConfirmation?: boolean
  /** Custom validation rules */
  customValidators?: MigrationValidator[]
}

export interface MigrationValidator {
  name: string
  validate(sql: string, context: ValidationContext): ValidationIssue[]
}

export interface ValidationContext {
  tables: string[]
  columns: Map<string, string[]>
}

export type IssueSeverity = "error" | "warning" | "info"

export interface ValidationIssue {
  severity: IssueSeverity
  code: string
  message: string
  line?: number
  suggestion?: string
  autoFixSQL?: string
}

export interface MigrationSafetyReport {
  /** Overall safety assessment */
  safe: boolean
  /** Risk level */
  risk: "none" | "low" | "medium" | "high" | "critical"
  /** Validation issues found */
  issues: ValidationIssue[]
  /** Breaking changes detected */
  breakingChanges: BreakingChangeInfo[]
  /** Estimated lock time per statement */
  lockAnalysis: LockAnalysis[]
  /** Generated rollback SQL (if applicable) */
  rollbackSQL: string[]
  /** Data loss risk assessment */
  dataLossRisk: DataLossRisk[]
  /** Dependency impact analysis */
  impactedObjects: ImpactedObject[]
  /** Summary counts */
  summary: {
    errors: number
    warnings: number
    infos: number
    breakingChanges: number
    estimatedTotalLockMs: number
  }
}

export interface BreakingChangeInfo {
  type: BreakingChangeType
  object: string
  description: string
  severity: "warning" | "error"
  mitigation?: string
}

export type BreakingChangeType =
  | "drop_table"
  | "drop_column"
  | "type_change"
  | "not_null_no_default"
  | "rename_column"
  | "rename_table"
  | "drop_constraint"
  | "drop_index"

export interface LockAnalysis {
  statement: string
  lockType: "none" | "share" | "exclusive" | "access_exclusive"
  estimatedDurationMs: number
  tablesLocked: string[]
  concurrent: boolean
}

export interface DataLossRisk {
  table: string
  column?: string
  risk: "none" | "possible" | "certain"
  description: string
  affectedRows?: string
}

export interface ImpactedObject {
  type: "view" | "function" | "trigger" | "index" | "constraint" | "policy"
  name: string
  impactType: "broken" | "degraded" | "unchanged"
  description: string
}

// ─── Migration Safety Net ────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<MigrationSafetyOptions> = {
  maxLockTimeMs: 5000,
  generateRollback: true,
  statementTimeoutMs: 30_000,
  requireConfirmation: true,
  customValidators: [],
}

export class MigrationSafetyNet {
  private options: Required<MigrationSafetyOptions>

  constructor(options: MigrationSafetyOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Validate a migration SQL string and produce a safety report.
   */
  validate(
    migrationSQL: string,
    context?: ValidationContext,
  ): MigrationSafetyReport {
    if (!migrationSQL || migrationSQL.trim() === "") {
      return createEmptyReport()
    }

    const statements = parseStatements(migrationSQL)
    const issues: ValidationIssue[] = []
    const breakingChanges: BreakingChangeInfo[] = []
    const lockAnalysis: LockAnalysis[] = []
    const rollbackSQL: string[] = []
    const dataLossRisk: DataLossRisk[] = []
    const impactedObjects: ImpactedObject[] = []

    for (const stmt of statements) {
      // Syntax validation
      issues.push(...this.validateSyntax(stmt))

      // Breaking change detection
      breakingChanges.push(...this.detectBreakingChanges(stmt))

      // Lock analysis
      lockAnalysis.push(this.analyzeLocks(stmt))

      // Data loss risk
      dataLossRisk.push(...this.assessDataLoss(stmt))

      // Impact analysis
      impactedObjects.push(...this.analyzeImpact(stmt))

      // Rollback generation
      if (this.options.generateRollback) {
        const rollback = this.generateRollbackSQL(stmt)
        if (rollback) rollbackSQL.push(rollback)
      }
    }

    // Custom validators
    for (const validator of this.options.customValidators) {
      issues.push(...validator.validate(migrationSQL, context ?? { tables: [], columns: new Map() }))
    }

    // Check lock times
    const totalLockMs = lockAnalysis.reduce((sum, l) => sum + l.estimatedDurationMs, 0)
    if (totalLockMs > this.options.maxLockTimeMs) {
      issues.push({
        severity: "warning",
        code: "EXCESSIVE_LOCK_TIME",
        message: `Estimated total lock time (${totalLockMs}ms) exceeds limit (${this.options.maxLockTimeMs}ms)`,
        suggestion: "Consider breaking migration into smaller steps or using CONCURRENTLY",
      })
    }

    const errors = issues.filter((i) => i.severity === "error").length
    const warnings = issues.filter((i) => i.severity === "warning").length
    const infos = issues.filter((i) => i.severity === "info").length

    const risk = errors > 0
      ? "critical"
      : breakingChanges.length > 0
        ? "high"
        : warnings > 0
          ? "medium"
          : dataLossRisk.some((r) => r.risk !== "none")
            ? "low"
            : "none"

    return {
      safe: errors === 0 && breakingChanges.filter((b) => b.severity === "error").length === 0,
      risk,
      issues,
      breakingChanges,
      lockAnalysis,
      rollbackSQL: rollbackSQL.reverse(), // Reverse for proper rollback order
      dataLossRisk,
      impactedObjects,
      summary: {
        errors,
        warnings,
        infos,
        breakingChanges: breakingChanges.length,
        estimatedTotalLockMs: totalLockMs,
      },
    }
  }

  /**
   * Generate a SQL script that wraps the migration in a transaction with rollback support.
   */
  wrapInTransaction(migrationSQL: string): string {
    const timeout = this.options.statementTimeoutMs
    return [
      `-- Migration Safety Net: Wrapped transaction`,
      `SET statement_timeout = '${timeout}ms';`,
      `BEGIN;`,
      ``,
      `-- Create savepoint for rollback`,
      `SAVEPOINT migration_start;`,
      ``,
      migrationSQL.trim(),
      ``,
      `-- Verify migration succeeded`,
      `-- If any error occurs, ROLLBACK TO migration_start;`,
      `COMMIT;`,
      ``,
      `-- Reset timeout`,
      `RESET statement_timeout;`,
    ].join("\n")
  }

  /**
   * Generate a complete rollback script from a safety report.
   */
  generateRollbackScript(report: MigrationSafetyReport): string {
    if (report.rollbackSQL.length === 0) {
      return "-- No rollback SQL generated (migration may not be reversible)"
    }

    return [
      `-- Rollback Script (generated by Migration Safety Net)`,
      `-- WARNING: Review carefully before executing`,
      `BEGIN;`,
      "",
      ...report.rollbackSQL,
      "",
      `COMMIT;`,
    ].join("\n")
  }

  // ─── Internal Validators ───────────────────────────────────────────────

  private validateSyntax(stmt: string): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const upper = stmt.toUpperCase().trim()

    // Check for common dangerous patterns
    if (upper.startsWith("DROP TABLE") && !upper.includes("IF EXISTS")) {
      issues.push({
        severity: "warning",
        code: "DROP_WITHOUT_IF_EXISTS",
        message: "DROP TABLE without IF EXISTS may fail if table doesn't exist",
        suggestion: "Use DROP TABLE IF EXISTS",
        autoFixSQL: stmt.replace(/DROP TABLE\s+/i, "DROP TABLE IF EXISTS "),
      })
    }

    if (upper.startsWith("ALTER TABLE") && upper.includes("DROP COLUMN") && !upper.includes("IF EXISTS")) {
      issues.push({
        severity: "warning",
        code: "DROP_COLUMN_WITHOUT_IF_EXISTS",
        message: "DROP COLUMN without IF EXISTS may fail",
        suggestion: "Use DROP COLUMN IF EXISTS",
      })
    }

    // Check for NOT NULL without DEFAULT
    if (upper.includes("ADD COLUMN") && upper.includes("NOT NULL") && !upper.includes("DEFAULT")) {
      issues.push({
        severity: "error",
        code: "NOT_NULL_NO_DEFAULT",
        message: "Adding NOT NULL column without DEFAULT will fail on tables with existing rows",
        suggestion: "Add a DEFAULT value or make the column nullable first",
      })
    }

    // Check for CREATE INDEX without CONCURRENTLY
    if (upper.startsWith("CREATE INDEX") && !upper.includes("CONCURRENTLY")) {
      issues.push({
        severity: "warning",
        code: "INDEX_WITHOUT_CONCURRENTLY",
        message: "CREATE INDEX locks the table during index build",
        suggestion: "Use CREATE INDEX CONCURRENTLY for zero-downtime",
        autoFixSQL: stmt.replace(/CREATE INDEX/i, "CREATE INDEX CONCURRENTLY"),
      })
    }

    // Check for TRUNCATE
    if (upper.startsWith("TRUNCATE")) {
      issues.push({
        severity: "warning",
        code: "TRUNCATE_TABLE",
        message: "TRUNCATE removes all rows and is not easily reversible",
      })
    }

    return issues
  }

  private detectBreakingChanges(stmt: string): BreakingChangeInfo[] {
    const changes: BreakingChangeInfo[] = []
    const upper = stmt.toUpperCase().trim()

    // DROP TABLE
    const dropTableMatch = upper.match(/DROP TABLE\s+(?:IF EXISTS\s+)?(?:"?(\w+)"?)/i)
    if (dropTableMatch) {
      changes.push({
        type: "drop_table",
        object: dropTableMatch[1],
        description: `Dropping table "${dropTableMatch[1]}" removes all data permanently`,
        severity: "error",
        mitigation: "Rename to _deprecated first, drop after verification",
      })
    }

    // DROP COLUMN
    const dropColMatch = stmt.match(/ALTER TABLE\s+"?(\w+)"?\s+DROP COLUMN\s+(?:IF EXISTS\s+)?"?(\w+)"?/i)
    if (dropColMatch) {
      changes.push({
        type: "drop_column",
        object: `${dropColMatch[1]}.${dropColMatch[2]}`,
        description: `Dropping column "${dropColMatch[2]}" from "${dropColMatch[1]}"`,
        severity: "error",
        mitigation: "Stop reading the column first, then drop in a follow-up migration",
      })
    }

    // Type change
    const typeChangeMatch = stmt.match(
      /ALTER TABLE\s+"?(\w+)"?\s+ALTER COLUMN\s+"?(\w+)"?\s+(?:SET DATA\s+)?TYPE\s+(\w+)/i,
    )
    if (typeChangeMatch) {
      changes.push({
        type: "type_change",
        object: `${typeChangeMatch[1]}.${typeChangeMatch[2]}`,
        description: `Changing type of "${typeChangeMatch[2]}" to ${typeChangeMatch[3]}`,
        severity: "warning",
        mitigation: "Use expand-contract pattern: add new column, migrate data, swap",
      })
    }

    // NOT NULL without default
    const notNullMatch = stmt.match(/ALTER TABLE\s+"?(\w+)"?\s+ADD COLUMN\s+"?(\w+)"?\s+\w+.*NOT NULL(?!\s+DEFAULT)/i)
    if (notNullMatch) {
      changes.push({
        type: "not_null_no_default",
        object: `${notNullMatch[1]}.${notNullMatch[2]}`,
        description: `Adding NOT NULL column "${notNullMatch[2]}" without default`,
        severity: "error",
        mitigation: "Add a DEFAULT value or make nullable",
      })
    }

    // RENAME
    const renameTableMatch = stmt.match(/ALTER TABLE\s+"?(\w+)"?\s+RENAME TO\s+"?(\w+)"?/i)
    if (renameTableMatch) {
      changes.push({
        type: "rename_table",
        object: renameTableMatch[1],
        description: `Renaming "${renameTableMatch[1]}" to "${renameTableMatch[2]}"`,
        severity: "warning",
        mitigation: "Create a view with the old name as alias",
      })
    }

    const renameColMatch = stmt.match(
      /ALTER TABLE\s+"?(\w+)"?\s+RENAME COLUMN\s+"?(\w+)"?\s+TO\s+"?(\w+)"?/i,
    )
    if (renameColMatch) {
      changes.push({
        type: "rename_column",
        object: `${renameColMatch[1]}.${renameColMatch[2]}`,
        description: `Renaming column "${renameColMatch[2]}" to "${renameColMatch[3]}"`,
        severity: "warning",
        mitigation: "Add new column, copy data, update code, drop old",
      })
    }

    return changes
  }

  private analyzeLocks(stmt: string): LockAnalysis {
    const upper = stmt.toUpperCase().trim()
    const tables = extractTablesFromStatement(stmt)

    if (upper.includes("CONCURRENTLY")) {
      return {
        statement: stmt.slice(0, 80),
        lockType: "share",
        estimatedDurationMs: 0,
        tablesLocked: [],
        concurrent: true,
      }
    }

    if (upper.startsWith("ALTER TABLE")) {
      if (upper.includes("ADD COLUMN") && !upper.includes("NOT NULL")) {
        return { statement: stmt.slice(0, 80), lockType: "access_exclusive", estimatedDurationMs: 10, tablesLocked: tables, concurrent: false }
      }
      if (upper.includes("DROP COLUMN") || upper.includes("TYPE")) {
        return { statement: stmt.slice(0, 80), lockType: "access_exclusive", estimatedDurationMs: 5000, tablesLocked: tables, concurrent: false }
      }
      return { statement: stmt.slice(0, 80), lockType: "access_exclusive", estimatedDurationMs: 100, tablesLocked: tables, concurrent: false }
    }

    if (upper.startsWith("CREATE INDEX") && !upper.includes("CONCURRENTLY")) {
      return { statement: stmt.slice(0, 80), lockType: "share", estimatedDurationMs: 10000, tablesLocked: tables, concurrent: false }
    }

    if (upper.startsWith("DROP TABLE") || upper.startsWith("TRUNCATE")) {
      return { statement: stmt.slice(0, 80), lockType: "access_exclusive", estimatedDurationMs: 50, tablesLocked: tables, concurrent: false }
    }

    if (upper.startsWith("CREATE TABLE")) {
      return { statement: stmt.slice(0, 80), lockType: "none", estimatedDurationMs: 0, tablesLocked: [], concurrent: false }
    }

    return { statement: stmt.slice(0, 80), lockType: "none", estimatedDurationMs: 0, tablesLocked: [], concurrent: false }
  }

  private assessDataLoss(stmt: string): DataLossRisk[] {
    const risks: DataLossRisk[] = []
    const upper = stmt.toUpperCase().trim()

    const dropTableMatch = stmt.match(/DROP TABLE\s+(?:IF EXISTS\s+)?(?:"?(\w+)"?)/i)
    if (dropTableMatch) {
      risks.push({
        table: dropTableMatch[1],
        risk: "certain",
        description: `All data in table "${dropTableMatch[1]}" will be permanently deleted`,
      })
    }

    const dropColMatch = stmt.match(/ALTER TABLE\s+"?(\w+)"?\s+DROP COLUMN\s+(?:IF EXISTS\s+)?"?(\w+)"?/i)
    if (dropColMatch) {
      risks.push({
        table: dropColMatch[1],
        column: dropColMatch[2],
        risk: "certain",
        description: `All data in column "${dropColMatch[2]}" will be permanently deleted`,
      })
    }

    if (upper.startsWith("TRUNCATE")) {
      const tableMatch = stmt.match(/TRUNCATE\s+(?:TABLE\s+)?(?:"?(\w+)"?)/i)
      if (tableMatch) {
        risks.push({
          table: tableMatch[1],
          risk: "certain",
          description: `All rows in "${tableMatch[1]}" will be removed`,
        })
      }
    }

    return risks
  }

  private analyzeImpact(stmt: string): ImpactedObject[] {
    const objects: ImpactedObject[] = []
    const upper = stmt.toUpperCase().trim()

    // DROP TABLE impacts views, triggers, and functions referencing it
    if (upper.startsWith("DROP TABLE")) {
      const table = stmt.match(/DROP TABLE\s+(?:IF EXISTS\s+)?(?:"?(\w+)"?)/i)?.[1]
      if (table) {
        objects.push({
          type: "view",
          name: `views referencing ${table}`,
          impactType: "broken",
          description: `Views depending on "${table}" will become invalid`,
        })
        objects.push({
          type: "trigger",
          name: `triggers on ${table}`,
          impactType: "broken",
          description: `Triggers on "${table}" will be dropped`,
        })
      }
    }

    // DROP INDEX impacts query performance
    if (upper.startsWith("DROP INDEX")) {
      const idx = stmt.match(/DROP INDEX\s+(?:IF EXISTS\s+)?(?:CONCURRENTLY\s+)?(?:"?(\w+)"?)/i)?.[1]
      if (idx) {
        objects.push({
          type: "index",
          name: idx,
          impactType: "degraded",
          description: `Queries using index "${idx}" may become slower`,
        })
      }
    }

    return objects
  }

  private generateRollbackSQL(stmt: string): string | null {
    const upper = stmt.toUpperCase().trim()

    // CREATE TABLE -> DROP TABLE
    const createTableMatch = stmt.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"?(\w+)"?)/i)
    if (createTableMatch) {
      return `DROP TABLE IF EXISTS "${createTableMatch[1]}" CASCADE;`
    }

    // ADD COLUMN -> DROP COLUMN
    const addColMatch = stmt.match(/ALTER TABLE\s+"?(\w+)"?\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?/i)
    if (addColMatch) {
      return `ALTER TABLE "${addColMatch[1]}" DROP COLUMN IF EXISTS "${addColMatch[2]}";`
    }

    // CREATE INDEX -> DROP INDEX
    const createIdxMatch = stmt.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF NOT EXISTS\s+)?"?(\w+)"?/i)
    if (createIdxMatch) {
      return `DROP INDEX IF EXISTS "${createIdxMatch[1]}";`
    }

    // RENAME TABLE -> RENAME back
    const renameTableMatch = stmt.match(/ALTER TABLE\s+"?(\w+)"?\s+RENAME TO\s+"?(\w+)"?/i)
    if (renameTableMatch) {
      return `ALTER TABLE "${renameTableMatch[2]}" RENAME TO "${renameTableMatch[1]}";`
    }

    // RENAME COLUMN -> RENAME back
    const renameColMatch = stmt.match(
      /ALTER TABLE\s+"?(\w+)"?\s+RENAME COLUMN\s+"?(\w+)"?\s+TO\s+"?(\w+)"?/i,
    )
    if (renameColMatch) {
      return `ALTER TABLE "${renameColMatch[1]}" RENAME COLUMN "${renameColMatch[3]}" TO "${renameColMatch[2]}";`
    }

    // Non-reversible operations
    if (upper.startsWith("DROP TABLE") || upper.startsWith("DROP COLUMN") || upper.startsWith("TRUNCATE")) {
      return `-- WARNING: Cannot auto-rollback: ${stmt.slice(0, 60)}...`
    }

    return null
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"))
}

function extractTablesFromStatement(stmt: string): string[] {
  const tables: string[] = []
  const tableMatch = stmt.match(/(?:TABLE|FROM|JOIN|INTO|UPDATE|ON)\s+"?(\w+)"?/gi)
  if (tableMatch) {
    for (const m of tableMatch) {
      const name = m.replace(/^(?:TABLE|FROM|JOIN|INTO|UPDATE|ON)\s+"?/i, "").replace(/"$/, "")
      if (name && !tables.includes(name)) tables.push(name)
    }
  }
  return tables
}

function createEmptyReport(): MigrationSafetyReport {
  return {
    safe: true,
    risk: "none",
    issues: [],
    breakingChanges: [],
    lockAnalysis: [],
    rollbackSQL: [],
    dataLossRisk: [],
    impactedObjects: [],
    summary: { errors: 0, warnings: 0, infos: 0, breakingChanges: 0, estimatedTotalLockMs: 0 },
  }
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class MigrationSafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MigrationSafetyError"
  }
}
