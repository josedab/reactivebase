/**
 * Live Migration Validator for ReactiveBase.
 * Pre-flight migration analysis with shadow execution, rollback generation,
 * breaking change detection, and CI/CD integration for GitHub Actions.
 *
 * Features:
 *   - Comprehensive migration analysis (breaking changes, lock duration, data loss)
 *   - Shadow execution against ephemeral in-memory instance
 *   - Automatic rollback SQL generation
 *   - Lock duration estimation based on operation type and table size
 *   - GitHub Actions CI integration with PR comment generation
 *
 * Usage:
 *   const validator = new LiveMigrationValidator()
 *   const analysis = validator.analyze(migrationSQL)
 *   if (analysis.safe) await validator.simulateOnShadow(migrationSQL)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MigrationAnalysisResult {
  /** Overall safety assessment */
  safe: boolean
  /** Risk level */
  risk: "none" | "low" | "medium" | "high" | "critical"
  /** Breaking changes detected */
  breakingChanges: BreakingChange[]
  /** Lock duration estimates per statement */
  lockEstimates: LockEstimate[]
  /** Data loss risks */
  dataLossRisks: DataLossInfo[]
  /** Generated rollback plan */
  rollbackPlan: RollbackPlan
  /** Summary statistics */
  summary: {
    totalStatements: number
    breakingChangeCount: number
    estimatedTotalLockMs: number
    dataLossRiskCount: number
    hasIrreversibleChanges: boolean
  }
}

export interface BreakingChange {
  /** Type of breaking change */
  type:
    | "drop_table"
    | "drop_column"
    | "type_change"
    | "not_null_added"
    | "constraint_added"
    | "rename_column"
    | "rename_table"
  /** Affected object (table or table.column) */
  object: string
  /** Human-readable description */
  description: string
  /** Severity classification */
  severity: "warning" | "error"
  /** Suggested mitigation strategy */
  mitigation?: string
}

export interface LockEstimate {
  /** Truncated SQL statement */
  statement: string
  /** Type of lock acquired */
  lockType: "none" | "share" | "exclusive" | "access_exclusive"
  /** Estimated duration in ms */
  estimatedMs: number
  /** Tables affected by the lock */
  tablesAffected: string[]
  /** Whether the operation can run concurrently */
  canRunConcurrently: boolean
  /** Scaling factor applied from table stats */
  scalingFactor: number
}

export interface RollbackPlan {
  /** Whether full rollback is possible */
  reversible: boolean
  /** Ordered rollback SQL statements */
  statements: string[]
  /** Warnings about irreversible operations */
  warnings: string[]
}

export interface ShadowExecutionResult {
  /** Whether the migration applied successfully */
  success: boolean
  /** Error message if migration failed */
  error?: string
  /** Duration of shadow execution in ms */
  durationMs: number
  /** Row counts per table after migration */
  tableCounts: Record<string, number>
  /** Schema changes detected after migration */
  schemaChanges: string[]
}

export interface CIReportOptions {
  /** Include rollback SQL in report (default: true) */
  includeRollback?: boolean
  /** Include lock estimates in report (default: true) */
  includeLockEstimates?: boolean
  /** Maximum breaking changes before blocking merge (default: 0) */
  maxBreakingChanges?: number
  /** Maximum acceptable total lock time in ms (default: 5000) */
  maxLockTimeMs?: number
  /** Repository owner/name for GitHub links */
  repository?: string
}

export interface TableStats {
  /** Table name */
  table: string
  /** Estimated row count */
  rowCount: number
  /** Table size in bytes */
  sizeBytes?: number
}

/** Minimal interface for an in-memory SQL executor (e.g. PGlite) */
export interface ShadowDatabase {
  exec(sql: string): Promise<{ rows: Record<string, unknown>[]; affectedRows?: number }>
  close(): Promise<void>
}

interface DataLossInfo {
  table: string
  column?: string
  risk: "none" | "possible" | "certain"
  description: string
}

// ─── SQL Helpers ─────────────────────────────────────────────────────────────

function _buildAnalyzeStatementSQL(stmt: string): string {
  return `EXPLAIN (COSTS OFF) ${stmt}`
}

function buildTableRowCountSQL(table: string): string {
  const safe = sanitizeIdentifier(table)
  return `SELECT count(*) AS cnt FROM "${safe}"`
}

function buildListTablesSQL(): string {
  return `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
}

function sanitizeIdentifier(id: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) {
    throw new MigrationValidationError(`Invalid SQL identifier: ${id}`)
  }
  return id
}

// ─── Live Migration Validator ────────────────────────────────────────────────

const BASE_LOCK_ESTIMATES: Record<string, number> = {
  add_column: 10,
  add_column_not_null: 5000,
  drop_column: 5000,
  type_change: 10000,
  add_constraint: 8000,
  drop_constraint: 100,
  create_index: 10000,
  create_index_concurrently: 0,
  drop_table: 50,
  truncate: 50,
  create_table: 0,
  rename: 100,
}

export class LiveMigrationValidator {
  /**
   * Perform a comprehensive pre-flight analysis of a migration SQL string.
   * Detects breaking changes, estimates lock duration, and identifies data loss risks.
   */
  analyze(migrationSQL: string): MigrationAnalysisResult {
    if (!migrationSQL || migrationSQL.trim() === "") {
      return createEmptyAnalysis()
    }

    const statements = parseStatements(migrationSQL)
    const breakingChanges: BreakingChange[] = []
    const lockEstimates: LockEstimate[] = []
    const dataLossRisks: DataLossInfo[] = []
    const rollbackStatements: string[] = []
    const rollbackWarnings: string[] = []

    for (const stmt of statements) {
      breakingChanges.push(...this.detectBreakingChanges(stmt))
      lockEstimates.push(this.estimateLockDuration(stmt))
      dataLossRisks.push(...this.assessDataLoss(stmt))

      const rollback = this.generateRollbackForStatement(stmt)
      if (rollback.reversible) {
        rollbackStatements.push(...rollback.statements)
      } else {
        rollbackWarnings.push(...rollback.warnings)
      }
    }

    // Reverse rollback order for proper undo sequence
    rollbackStatements.reverse()

    const totalLockMs = lockEstimates.reduce((sum, l) => sum + l.estimatedMs, 0)
    const hasIrreversible = rollbackWarnings.length > 0

    const risk = this.classifyRisk(breakingChanges, dataLossRisks, totalLockMs)

    return {
      safe: breakingChanges.filter((b) => b.severity === "error").length === 0,
      risk,
      breakingChanges,
      lockEstimates,
      dataLossRisks,
      rollbackPlan: {
        reversible: !hasIrreversible,
        statements: rollbackStatements,
        warnings: rollbackWarnings,
      },
      summary: {
        totalStatements: statements.length,
        breakingChangeCount: breakingChanges.length,
        estimatedTotalLockMs: totalLockMs,
        dataLossRiskCount: dataLossRisks.filter((r) => r.risk !== "none").length,
        hasIrreversibleChanges: hasIrreversible,
      },
    }
  }

  /**
   * Run the migration against an ephemeral in-memory database instance.
   * Optionally seeds sample data before applying the migration.
   */
  async simulateOnShadow(
    migrationSQL: string,
    sampleData?: { setupSQL: string },
    shadowDb?: ShadowDatabase,
  ): Promise<ShadowExecutionResult> {
    if (!shadowDb) {
      throw new MigrationValidationError(
        "A ShadowDatabase instance is required for shadow execution. " +
          "Provide a PGlite-compatible instance via the shadowDb parameter.",
      )
    }

    const startTime = Date.now()
    const tableCounts: Record<string, number> = {}
    const schemaChanges: string[] = []

    try {
      // Seed sample data if provided
      if (sampleData?.setupSQL) {
        await shadowDb.exec(sampleData.setupSQL)
      }

      // Capture pre-migration state
      const preTablesResult = await shadowDb.exec(buildListTablesSQL())
      const preTables = new Set(preTablesResult.rows.map((r) => String(r.name)))

      // Apply migration
      await shadowDb.exec(migrationSQL)

      // Capture post-migration state
      const postTablesResult = await shadowDb.exec(buildListTablesSQL())
      const postTables = new Set(postTablesResult.rows.map((r) => String(r.name)))

      // Detect schema changes
      for (const t of postTables) {
        if (!preTables.has(t)) schemaChanges.push(`Table added: ${t}`)
      }
      for (const t of preTables) {
        if (!postTables.has(t)) schemaChanges.push(`Table removed: ${t}`)
      }

      // Collect row counts
      for (const t of postTables) {
        try {
          const countResult = await shadowDb.exec(buildTableRowCountSQL(t))
          tableCounts[t] = Number(countResult.rows[0]?.cnt ?? 0)
        } catch {
          tableCounts[t] = -1
        }
      }

      return {
        success: true,
        durationMs: Date.now() - startTime,
        tableCounts,
        schemaChanges,
      }
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
        tableCounts,
        schemaChanges,
      }
    } finally {
      await shadowDb.close().catch(() => {})
    }
  }

  /**
   * Generate a complete rollback plan for a migration SQL string.
   */
  generateRollbackSQL(migrationSQL: string): RollbackPlan {
    if (!migrationSQL || migrationSQL.trim() === "") {
      return { reversible: true, statements: [], warnings: [] }
    }

    const statements = parseStatements(migrationSQL)
    const rollbackStatements: string[] = []
    const warnings: string[] = []

    for (const stmt of statements) {
      const result = this.generateRollbackForStatement(stmt)
      rollbackStatements.push(...result.statements)
      warnings.push(...result.warnings)
    }

    // Reverse for proper undo order
    rollbackStatements.reverse()

    return {
      reversible: warnings.length === 0,
      statements: rollbackStatements,
      warnings,
    }
  }

  /**
   * Estimate lock duration for a migration, optionally using table statistics
   * to scale estimates based on actual table size.
   */
  estimateLockDuration(migrationSQL: string, tableStats?: TableStats[]): LockEstimate {
    const upper = migrationSQL.toUpperCase().trim()
    const tables = extractTablesFromStatement(migrationSQL)
    const statsMap = new Map((tableStats ?? []).map((s) => [s.table.toLowerCase(), s]))

    // Determine operation type and base estimate
    const { lockType, baseMs, canConcurrent } = classifyLockOperation(upper)

    // Apply scaling factor based on table size
    let scalingFactor = 1
    if (tables.length > 0 && statsMap.size > 0) {
      const primaryTable = tables[0].toLowerCase()
      const stats = statsMap.get(primaryTable)
      if (stats) {
        // Scale based on row count: every 100k rows adds ~2x
        scalingFactor = Math.max(1, Math.log10(Math.max(stats.rowCount, 1)) / 5)
      }
    }

    const estimatedMs = Math.round(baseMs * scalingFactor)

    return {
      statement: migrationSQL.slice(0, 80),
      lockType,
      estimatedMs,
      tablesAffected: tables,
      canRunConcurrently: canConcurrent,
      scalingFactor,
    }
  }

  /**
   * Detect breaking changes in a migration SQL string.
   * Identifies column drops, type changes, constraint additions on populated tables.
   */
  detectBreakingChanges(migrationSQL: string): BreakingChange[] {
    const changes: BreakingChange[] = []
    const statements = parseStatements(migrationSQL)

    for (const stmt of statements) {
      changes.push(...this.detectBreakingChangesInStatement(stmt))
    }

    return changes
  }

  // ─── Private ───────────────────────────────────────────────────────────

  private detectBreakingChangesInStatement(stmt: string): BreakingChange[] {
    const changes: BreakingChange[] = []
    const upper = stmt.toUpperCase().trim()

    // DROP TABLE
    const dropTableMatch = stmt.match(/DROP TABLE\s+(?:IF EXISTS\s+)?(?:"?(\w+)"?)/i)
    if (dropTableMatch) {
      changes.push({
        type: "drop_table",
        object: dropTableMatch[1],
        description: `Dropping table "${dropTableMatch[1]}" removes all data permanently`,
        severity: "error",
        mitigation: "Rename to _deprecated first, drop after verification period",
      })
    }

    // DROP COLUMN
    const dropColMatch = stmt.match(/ALTER TABLE\s+"?(\w+)"?\s+DROP COLUMN\s+(?:IF EXISTS\s+)?"?(\w+)"?/i)
    if (dropColMatch) {
      changes.push({
        type: "drop_column",
        object: `${dropColMatch[1]}.${dropColMatch[2]}`,
        description: `Dropping column "${dropColMatch[2]}" from "${dropColMatch[1]}" is irreversible`,
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
        description: `Changing type of "${typeChangeMatch[2]}" to ${typeChangeMatch[3]} may cause data loss`,
        severity: "warning",
        mitigation: "Use expand-contract pattern: add new column, migrate data, swap",
      })
    }

    // ADD NOT NULL without DEFAULT
    const notNullMatch = stmt.match(
      /ALTER TABLE\s+"?(\w+)"?\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?\s+\w+.*NOT NULL(?!\s+DEFAULT)/i,
    )
    if (notNullMatch) {
      changes.push({
        type: "not_null_added",
        object: `${notNullMatch[1]}.${notNullMatch[2]}`,
        description: `Adding NOT NULL column "${notNullMatch[2]}" without default will fail on populated tables`,
        severity: "error",
        mitigation: "Add a DEFAULT value or make the column nullable first",
      })
    }

    // ADD CONSTRAINT on existing table
    const constraintMatch = stmt.match(/ALTER TABLE\s+"?(\w+)"?\s+ADD CONSTRAINT\s+"?(\w+)"?/i)
    if (constraintMatch && !upper.includes("NOT VALID")) {
      changes.push({
        type: "constraint_added",
        object: `${constraintMatch[1]}.${constraintMatch[2]}`,
        description: `Adding constraint "${constraintMatch[2]}" locks table and validates all rows`,
        severity: "warning",
        mitigation: "Add constraint as NOT VALID first, then VALIDATE CONSTRAINT separately",
      })
    }

    // RENAME TABLE
    const renameTableMatch = stmt.match(/ALTER TABLE\s+"?(\w+)"?\s+RENAME TO\s+"?(\w+)"?/i)
    if (renameTableMatch) {
      changes.push({
        type: "rename_table",
        object: renameTableMatch[1],
        description: `Renaming "${renameTableMatch[1]}" to "${renameTableMatch[2]}" breaks existing queries`,
        severity: "warning",
        mitigation: "Create a view with the old name as an alias",
      })
    }

    // RENAME COLUMN
    const renameColMatch = stmt.match(/ALTER TABLE\s+"?(\w+)"?\s+RENAME COLUMN\s+"?(\w+)"?\s+TO\s+"?(\w+)"?/i)
    if (renameColMatch) {
      changes.push({
        type: "rename_column",
        object: `${renameColMatch[1]}.${renameColMatch[2]}`,
        description: `Renaming column "${renameColMatch[2]}" to "${renameColMatch[3]}" breaks existing queries`,
        severity: "warning",
        mitigation: "Add new column, copy data, update code, drop old column",
      })
    }

    return changes
  }

  private assessDataLoss(stmt: string): DataLossInfo[] {
    const risks: DataLossInfo[] = []

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

    const truncateMatch = stmt.match(/TRUNCATE\s+(?:TABLE\s+)?(?:"?(\w+)"?)/i)
    if (truncateMatch) {
      risks.push({
        table: truncateMatch[1],
        risk: "certain",
        description: `All rows in "${truncateMatch[1]}" will be removed`,
      })
    }

    const typeChangeMatch = stmt.match(/ALTER TABLE\s+"?(\w+)"?\s+ALTER COLUMN\s+"?(\w+)"?\s+(?:SET DATA\s+)?TYPE/i)
    if (typeChangeMatch) {
      risks.push({
        table: typeChangeMatch[1],
        column: typeChangeMatch[2],
        risk: "possible",
        description: `Type change on "${typeChangeMatch[2]}" may cause data truncation or loss`,
      })
    }

    return risks
  }

  private generateRollbackForStatement(stmt: string): RollbackPlan {
    const upper = stmt.toUpperCase().trim()

    // CREATE TABLE -> DROP TABLE
    const createTableMatch = stmt.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"?(\w+)"?)/i)
    if (createTableMatch) {
      return {
        reversible: true,
        statements: [`DROP TABLE IF EXISTS "${createTableMatch[1]}" CASCADE;`],
        warnings: [],
      }
    }

    // ADD COLUMN -> DROP COLUMN
    const addColMatch = stmt.match(/ALTER TABLE\s+"?(\w+)"?\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?/i)
    if (addColMatch) {
      return {
        reversible: true,
        statements: [`ALTER TABLE "${addColMatch[1]}" DROP COLUMN IF EXISTS "${addColMatch[2]}";`],
        warnings: [],
      }
    }

    // CREATE INDEX -> DROP INDEX
    const createIdxMatch = stmt.match(
      /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF NOT EXISTS\s+)?"?(\w+)"?/i,
    )
    if (createIdxMatch) {
      return {
        reversible: true,
        statements: [`DROP INDEX IF EXISTS "${createIdxMatch[1]}";`],
        warnings: [],
      }
    }

    // RENAME TABLE -> RENAME back
    const renameTableMatch = stmt.match(/ALTER TABLE\s+"?(\w+)"?\s+RENAME TO\s+"?(\w+)"?/i)
    if (renameTableMatch) {
      return {
        reversible: true,
        statements: [`ALTER TABLE "${renameTableMatch[2]}" RENAME TO "${renameTableMatch[1]}";`],
        warnings: [],
      }
    }

    // RENAME COLUMN -> RENAME back
    const renameColMatch = stmt.match(/ALTER TABLE\s+"?(\w+)"?\s+RENAME COLUMN\s+"?(\w+)"?\s+TO\s+"?(\w+)"?/i)
    if (renameColMatch) {
      return {
        reversible: true,
        statements: [
          `ALTER TABLE "${renameColMatch[1]}" RENAME COLUMN "${renameColMatch[3]}" TO "${renameColMatch[2]}";`,
        ],
        warnings: [],
      }
    }

    // ADD CONSTRAINT -> DROP CONSTRAINT
    const addConstraintMatch = stmt.match(/ALTER TABLE\s+"?(\w+)"?\s+ADD CONSTRAINT\s+"?(\w+)"?/i)
    if (addConstraintMatch) {
      return {
        reversible: true,
        statements: [`ALTER TABLE "${addConstraintMatch[1]}" DROP CONSTRAINT IF EXISTS "${addConstraintMatch[2]}";`],
        warnings: [],
      }
    }

    // Irreversible operations
    if (upper.startsWith("DROP TABLE") || upper.includes("DROP COLUMN") || upper.startsWith("TRUNCATE")) {
      const desc = stmt.slice(0, 60)
      return {
        reversible: false,
        statements: [],
        warnings: [`Cannot auto-rollback destructive operation: ${desc}...`],
      }
    }

    // Type changes are not safely reversible
    if (upper.includes("ALTER COLUMN") && upper.includes("TYPE")) {
      return {
        reversible: false,
        statements: [],
        warnings: [`Cannot auto-rollback type change: ${stmt.slice(0, 60)}...`],
      }
    }

    return { reversible: true, statements: [], warnings: [] }
  }

  private classifyRisk(
    breakingChanges: BreakingChange[],
    dataLossRisks: DataLossInfo[],
    totalLockMs: number,
  ): MigrationAnalysisResult["risk"] {
    const errorCount = breakingChanges.filter((b) => b.severity === "error").length
    const certainDataLoss = dataLossRisks.filter((r) => r.risk === "certain").length

    if (errorCount > 0 || certainDataLoss > 0) return "critical"
    if (breakingChanges.length > 0) return "high"
    if (totalLockMs > 10000) return "medium"
    if (dataLossRisks.some((r) => r.risk === "possible")) return "low"
    return "none"
  }
}

// ─── Migration CI Reporter ───────────────────────────────────────────────────

const DEFAULT_CI_OPTIONS: Required<CIReportOptions> = {
  includeRollback: true,
  includeLockEstimates: true,
  maxBreakingChanges: 0,
  maxLockTimeMs: 5000,
  repository: "",
}

export class MigrationCIReporter {
  private options: Required<CIReportOptions>

  constructor(options: CIReportOptions = {}) {
    this.options = { ...DEFAULT_CI_OPTIONS, ...options }
  }

  /**
   * Format a migration analysis result as a GitHub PR comment in markdown.
   */
  generatePRComment(analysis: MigrationAnalysisResult): string {
    const emoji = analysis.safe ? (analysis.risk === "none" ? "✅" : "⚠️") : "❌"
    const lines: string[] = [
      `## ${emoji} Migration Validation Report`,
      "",
      `**Status:** ${analysis.safe ? "SAFE" : "UNSAFE"}`,
      `**Risk Level:** ${analysis.risk.toUpperCase()}`,
      `**Statements:** ${analysis.summary.totalStatements}`,
      "",
    ]

    // Breaking changes section
    if (analysis.breakingChanges.length > 0) {
      lines.push(`### 🚨 Breaking Changes (${analysis.breakingChanges.length})`, "")
      lines.push("| Type | Object | Severity | Description |")
      lines.push("|------|--------|----------|-------------|")
      for (const bc of analysis.breakingChanges) {
        const icon = bc.severity === "error" ? "🔴" : "🟡"
        lines.push(`| ${icon} ${bc.type} | \`${bc.object}\` | ${bc.severity} | ${bc.description} |`)
      }
      lines.push("")
      // Mitigations
      const mitigations = analysis.breakingChanges.filter((bc) => bc.mitigation)
      if (mitigations.length > 0) {
        lines.push("<details>", "<summary>Suggested Mitigations</summary>", "")
        for (const bc of mitigations) {
          lines.push(`- **${bc.object}**: ${bc.mitigation}`)
        }
        lines.push("", "</details>", "")
      }
    }

    // Lock estimates section
    if (this.options.includeLockEstimates && analysis.lockEstimates.length > 0) {
      const totalMs = analysis.summary.estimatedTotalLockMs
      const lockEmoji = totalMs > this.options.maxLockTimeMs ? "🔴" : totalMs > 1000 ? "🟡" : "🟢"
      lines.push(`### ${lockEmoji} Lock Duration Estimate: ${totalMs}ms`, "")
      lines.push("| Statement | Lock Type | Duration | Tables |")
      lines.push("|-----------|-----------|----------|--------|")
      for (const le of analysis.lockEstimates) {
        lines.push(
          `| \`${le.statement}\` | ${le.lockType} | ${le.estimatedMs}ms | ${le.tablesAffected.join(", ") || "—"} |`,
        )
      }
      lines.push("")
    }

    // Data loss risks section
    const dataLossRisks = analysis.dataLossRisks.filter((r) => r.risk !== "none")
    if (dataLossRisks.length > 0) {
      lines.push(`### ⚠️ Data Loss Risks (${dataLossRisks.length})`, "")
      for (const dlr of dataLossRisks) {
        const icon = dlr.risk === "certain" ? "🔴" : "🟡"
        const target = dlr.column ? `${dlr.table}.${dlr.column}` : dlr.table
        lines.push(`- ${icon} **${target}** (${dlr.risk}): ${dlr.description}`)
      }
      lines.push("")
    }

    // Rollback plan section
    if (this.options.includeRollback) {
      const rbIcon = analysis.rollbackPlan.reversible ? "✅" : "⚠️"
      lines.push(
        `### ${rbIcon} Rollback Plan: ${analysis.rollbackPlan.reversible ? "Fully Reversible" : "Partially Reversible"}`,
        "",
      )
      if (analysis.rollbackPlan.warnings.length > 0) {
        for (const w of analysis.rollbackPlan.warnings) {
          lines.push(`> ⚠️ ${w}`)
        }
        lines.push("")
      }
      if (analysis.rollbackPlan.statements.length > 0) {
        lines.push("<details>", "<summary>Rollback SQL</summary>", "", "```sql")
        for (const s of analysis.rollbackPlan.statements) {
          lines.push(s)
        }
        lines.push("```", "", "</details>", "")
      }
    }

    // Summary
    lines.push("---")
    lines.push(
      `*Generated by ReactiveBase Migration Validator* | ` +
        `${analysis.summary.breakingChangeCount} breaking changes, ` +
        `${analysis.summary.estimatedTotalLockMs}ms estimated lock time`,
    )

    return lines.join("\n")
  }

  /**
   * Determine whether a PR should be blocked from merging based on the analysis.
   */
  shouldBlockMerge(analysis: MigrationAnalysisResult): boolean {
    if (analysis.breakingChanges.filter((b) => b.severity === "error").length > this.options.maxBreakingChanges) {
      return true
    }
    if (analysis.summary.estimatedTotalLockMs > this.options.maxLockTimeMs) {
      return true
    }
    if (analysis.summary.hasIrreversibleChanges && analysis.risk === "critical") {
      return true
    }
    return false
  }

  /**
   * Generate a GitHub Actions workflow YAML for CI migration validation.
   */
  generateGitHubActionYAML(): string {
    return `# Generated by ReactiveBase Migration Validator
name: Migration Validation

on:
  pull_request:
    paths:
      - 'migrations/**'
      - 'packages/**/migrations/**'
      - '**/*.sql'

permissions:
  pull-requests: write
  contents: read

jobs:
  validate-migration:
    name: Validate Migration Safety
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci

      - name: Find Migration Files
        id: migrations
        run: |
          FILES=$(git diff --name-only origin/\${{ github.base_ref }} -- '*.sql' 'migrations/**' | tr '\\n' ' ')
          echo "files=\${FILES}" >> "\$GITHUB_OUTPUT"

      - name: Validate Migrations
        id: validate
        run: |
          node -e "
            const { LiveMigrationValidator, MigrationCIReporter } = require('./packages/server');
            const fs = require('fs');
            const files = '\${{ steps.migrations.outputs.files }}'.trim().split(' ').filter(Boolean);
            const validator = new LiveMigrationValidator();
            const reporter = new MigrationCIReporter({
              maxBreakingChanges: ${this.options.maxBreakingChanges},
              maxLockTimeMs: ${this.options.maxLockTimeMs},
            });
            let blocked = false;
            let comments = [];
            for (const file of files) {
              if (!fs.existsSync(file)) continue;
              const sql = fs.readFileSync(file, 'utf8');
              const analysis = validator.analyze(sql);
              comments.push('### ' + file + '\\\\n' + reporter.generatePRComment(analysis));
              if (reporter.shouldBlockMerge(analysis)) blocked = true;
            }
            fs.writeFileSync('/tmp/migration-report.md', comments.join('\\\\n---\\\\n'));
            if (blocked) process.exit(1);
          "

      - name: Comment on PR
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const body = fs.readFileSync('/tmp/migration-report.md', 'utf8');
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const existing = comments.find(c => c.body.includes('Migration Validation Report'));
            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existing.id,
                body,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body,
              });
            }
`
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

function classifyLockOperation(upper: string): {
  lockType: LockEstimate["lockType"]
  baseMs: number
  canConcurrent: boolean
} {
  if (upper.includes("CONCURRENTLY")) {
    return { lockType: "share", baseMs: BASE_LOCK_ESTIMATES.create_index_concurrently, canConcurrent: true }
  }

  if (upper.startsWith("ALTER TABLE")) {
    if (upper.includes("ADD COLUMN") && upper.includes("NOT NULL") && !upper.includes("DEFAULT")) {
      return { lockType: "access_exclusive", baseMs: BASE_LOCK_ESTIMATES.add_column_not_null, canConcurrent: false }
    }
    if (upper.includes("ADD COLUMN")) {
      return { lockType: "access_exclusive", baseMs: BASE_LOCK_ESTIMATES.add_column, canConcurrent: false }
    }
    if (upper.includes("DROP COLUMN")) {
      return { lockType: "access_exclusive", baseMs: BASE_LOCK_ESTIMATES.drop_column, canConcurrent: false }
    }
    if (upper.includes("TYPE")) {
      return { lockType: "access_exclusive", baseMs: BASE_LOCK_ESTIMATES.type_change, canConcurrent: false }
    }
    if (upper.includes("ADD CONSTRAINT")) {
      return { lockType: "access_exclusive", baseMs: BASE_LOCK_ESTIMATES.add_constraint, canConcurrent: false }
    }
    if (upper.includes("DROP CONSTRAINT")) {
      return { lockType: "access_exclusive", baseMs: BASE_LOCK_ESTIMATES.drop_constraint, canConcurrent: false }
    }
    if (upper.includes("RENAME")) {
      return { lockType: "access_exclusive", baseMs: BASE_LOCK_ESTIMATES.rename, canConcurrent: false }
    }
    return { lockType: "access_exclusive", baseMs: 100, canConcurrent: false }
  }

  if (upper.startsWith("CREATE INDEX")) {
    return { lockType: "share", baseMs: BASE_LOCK_ESTIMATES.create_index, canConcurrent: true }
  }

  if (upper.startsWith("DROP TABLE") || upper.startsWith("TRUNCATE")) {
    return { lockType: "access_exclusive", baseMs: BASE_LOCK_ESTIMATES.drop_table, canConcurrent: false }
  }

  if (upper.startsWith("CREATE TABLE")) {
    return { lockType: "none", baseMs: BASE_LOCK_ESTIMATES.create_table, canConcurrent: false }
  }

  return { lockType: "none", baseMs: 0, canConcurrent: false }
}

function createEmptyAnalysis(): MigrationAnalysisResult {
  return {
    safe: true,
    risk: "none",
    breakingChanges: [],
    lockEstimates: [],
    dataLossRisks: [],
    rollbackPlan: { reversible: true, statements: [], warnings: [] },
    summary: {
      totalStatements: 0,
      breakingChangeCount: 0,
      estimatedTotalLockMs: 0,
      dataLossRiskCount: 0,
      hasIrreversibleChanges: false,
    },
  }
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class MigrationValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MigrationValidationError"
  }
}
