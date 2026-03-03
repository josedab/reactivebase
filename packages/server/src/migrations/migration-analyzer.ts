/**
 * Enhanced Migration Preview with Destructive Operation Detection.
 *
 * Extends shadow-preview.ts with:
 *   - Destructive operation detection (column drops, type changes, table drops)
 *   - Row count estimation for data migrations
 *   - PGlite-based fast in-process shadow execution
 *   - Rich CLI diff output for 'reactivebase migrate --preview'
 *
 * Usage:
 *   const analyzer = new MigrationAnalyzer()
 *   const analysis = analyzer.analyze(migrationSQL)
 *   const report = analyzer.formatReport(analysis)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DestructiveOperation {
  type:
    | "drop_table"
    | "drop_column"
    | "alter_type"
    | "drop_index"
    | "drop_constraint"
    | "truncate"
    | "rename_column"
    | "rename_table"
    | "not_null_added"
  table?: string
  column?: string
  severity: "critical" | "warning" | "info"
  description: string
  suggestion?: string
}

export interface MigrationStatement {
  sql: string
  type: "ddl" | "dml" | "other"
  operation: string
  table?: string
  column?: string
  isDestructive: boolean
  destructiveOps: DestructiveOperation[]
}

export interface MigrationAnalysis {
  statements: MigrationStatement[]
  destructiveOps: DestructiveOperation[]
  totalStatements: number
  destructiveCount: number
  safeCount: number
  hasCritical: boolean
  estimatedRowCounts: RowCountEstimate[]
  summary: string
}

export interface RowCountEstimate {
  table: string
  operation: "insert" | "update" | "delete" | "migrate"
  estimatedRows: number | "unknown"
  sql: string
}

export interface MigrationDiffLine {
  type: "add" | "remove" | "modify" | "context" | "warning" | "header"
  content: string
  lineNumber?: number
}

// ─── SQL Patterns ────────────────────────────────────────────────────────────

const DESTRUCTIVE_PATTERNS: Array<{
  pattern: RegExp
  type: DestructiveOperation["type"]
  severity: DestructiveOperation["severity"]
  description: (match: RegExpMatchArray) => string
  suggestion?: string
}> = [
  {
    pattern: /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["']?(\w+)["']?/i,
    type: "drop_table",
    severity: "critical",
    description: (m) => `Dropping table "${m[1]}" will permanently delete all data`,
    suggestion: "Consider renaming the table first and dropping after a safe period",
  },
  {
    pattern: /ALTER\s+TABLE\s+["']?(\w+)["']?\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?["']?(\w+)["']?/i,
    type: "drop_column",
    severity: "critical",
    description: (m) => `Dropping column "${m[2]}" from "${m[1]}" will permanently delete column data`,
    suggestion: "Use expand-contract: add new column, migrate data, then drop old column",
  },
  {
    pattern: /ALTER\s+TABLE\s+["']?(\w+)["']?\s+ALTER\s+COLUMN\s+["']?(\w+)["']?\s+(?:SET\s+DATA\s+)?TYPE\s+(\w+)/i,
    type: "alter_type",
    severity: "warning",
    description: (m) => `Changing type of "${m[1]}.${m[2]}" to ${m[3]} may cause data loss or lock the table`,
    suggestion: "Add a new column with the target type, backfill, then swap",
  },
  {
    pattern: /DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?["']?(\w+)["']?/i,
    type: "drop_index",
    severity: "warning",
    description: (m) => `Dropping index "${m[1]}" may degrade query performance`,
  },
  {
    pattern: /ALTER\s+TABLE\s+["']?(\w+)["']?\s+DROP\s+CONSTRAINT\s+["']?(\w+)["']?/i,
    type: "drop_constraint",
    severity: "warning",
    description: (m) => `Dropping constraint "${m[2]}" from "${m[1]}" may allow invalid data`,
  },
  {
    pattern: /TRUNCATE\s+(?:TABLE\s+)?["']?(\w+)["']?/i,
    type: "truncate",
    severity: "critical",
    description: (m) => `Truncating table "${m[1]}" will delete all rows`,
  },
  {
    pattern: /ALTER\s+TABLE\s+["']?(\w+)["']?\s+RENAME\s+COLUMN\s+["']?(\w+)["']?\s+TO\s+["']?(\w+)["']?/i,
    type: "rename_column",
    severity: "warning",
    description: (m) => `Renaming "${m[1]}.${m[2]}" to "${m[3]}" may break existing queries`,
  },
  {
    pattern: /ALTER\s+TABLE\s+["']?(\w+)["']?\s+RENAME\s+TO\s+["']?(\w+)["']?/i,
    type: "rename_table",
    severity: "warning",
    description: (m) => `Renaming table "${m[1]}" to "${m[2]}" may break existing queries`,
  },
  {
    pattern: /ALTER\s+TABLE\s+["']?(\w+)["']?\s+ALTER\s+COLUMN\s+["']?(\w+)["']?\s+SET\s+NOT\s+NULL/i,
    type: "not_null_added",
    severity: "warning",
    description: (m) => `Adding NOT NULL constraint to "${m[1]}.${m[2]}" will fail if null values exist`,
    suggestion: "Backfill null values before adding the constraint",
  },
]

const DML_PATTERNS: Array<{
  pattern: RegExp
  operation: string
}> = [
  { pattern: /INSERT\s+INTO\s+["']?(\w+)["']?/i, operation: "insert" },
  { pattern: /UPDATE\s+["']?(\w+)["']?/i, operation: "update" },
  { pattern: /DELETE\s+FROM\s+["']?(\w+)["']?/i, operation: "delete" },
]

// ─── Migration Analyzer ──────────────────────────────────────────────────────

export class MigrationAnalyzer {
  /**
   * Analyze a migration SQL string for destructive operations.
   */
  analyze(migrationSQL: string): MigrationAnalysis {
    const rawStatements = splitStatements(migrationSQL)
    const statements: MigrationStatement[] = []
    const allDestructiveOps: DestructiveOperation[] = []
    const rowEstimates: RowCountEstimate[] = []

    for (const sql of rawStatements) {
      const trimmed = sql.trim()
      if (!trimmed || trimmed.startsWith("--")) continue

      const destructiveOps: DestructiveOperation[] = []

      for (const pattern of DESTRUCTIVE_PATTERNS) {
        const match = trimmed.match(pattern.pattern)
        if (match) {
          const op: DestructiveOperation = {
            type: pattern.type,
            table: match[1],
            column: match[2],
            severity: pattern.severity,
            description: pattern.description(match),
            suggestion: pattern.suggestion,
          }
          destructiveOps.push(op)
          allDestructiveOps.push(op)
        }
      }

      // Detect DML operations and estimate row counts
      for (const dmlPattern of DML_PATTERNS) {
        const match = trimmed.match(dmlPattern.pattern)
        if (match) {
          rowEstimates.push({
            table: match[1],
            operation: dmlPattern.operation as RowCountEstimate["operation"],
            estimatedRows: estimateRowCount(trimmed),
            sql: trimmed.substring(0, 100),
          })
        }
      }

      const isDDL = /^(CREATE|ALTER|DROP|TRUNCATE)\s/i.test(trimmed)
      const isDML = /^(INSERT|UPDATE|DELETE)\s/i.test(trimmed)
      const operation = trimmed.split(/\s+/).slice(0, 2).join(" ").toUpperCase()

      statements.push({
        sql: trimmed,
        type: isDDL ? "ddl" : isDML ? "dml" : "other",
        operation,
        table: extractTable(trimmed),
        isDestructive: destructiveOps.length > 0,
        destructiveOps,
      })
    }

    const destructiveCount = statements.filter((s) => s.isDestructive).length
    const hasCritical = allDestructiveOps.some((o) => o.severity === "critical")

    return {
      statements,
      destructiveOps: allDestructiveOps,
      totalStatements: statements.length,
      destructiveCount,
      safeCount: statements.length - destructiveCount,
      hasCritical,
      estimatedRowCounts: rowEstimates,
      summary: this.buildSummary(statements.length, destructiveCount, hasCritical, allDestructiveOps),
    }
  }

  /**
   * Format an analysis as a rich CLI diff output.
   */
  formatCLIDiff(analysis: MigrationAnalysis): string {
    const lines: string[] = []
    const icon = analysis.hasCritical ? "❌" : analysis.destructiveCount > 0 ? "⚠️" : "✅"

    lines.push(`${icon} Migration Preview`)
    lines.push(`${"─".repeat(60)}`)
    lines.push(
      `Statements: ${analysis.totalStatements} total, ${analysis.safeCount} safe, ${analysis.destructiveCount} destructive`,
    )
    lines.push("")

    for (const stmt of analysis.statements) {
      const prefix = stmt.isDestructive ? "⚠" : "✓"
      lines.push(`  ${prefix} ${stmt.operation}${stmt.table ? ` ${stmt.table}` : ""}`)

      for (const op of stmt.destructiveOps) {
        const sevIcon = op.severity === "critical" ? "🔴" : "🟡"
        lines.push(`    ${sevIcon} ${op.description}`)
        if (op.suggestion) {
          lines.push(`       💡 ${op.suggestion}`)
        }
      }
    }

    if (analysis.estimatedRowCounts.length > 0) {
      lines.push("")
      lines.push("  Row Count Estimates:")
      for (const est of analysis.estimatedRowCounts) {
        lines.push(`    ${est.table}: ~${est.estimatedRows} rows (${est.operation})`)
      }
    }

    lines.push("")
    lines.push(`${"─".repeat(60)}`)
    lines.push(analysis.summary)

    return lines.join("\n")
  }

  /**
   * Format analysis as diff lines for structured rendering.
   */
  getDiffLines(analysis: MigrationAnalysis): MigrationDiffLine[] {
    const lines: MigrationDiffLine[] = []

    lines.push({ type: "header", content: "Migration Preview" })

    for (const stmt of analysis.statements) {
      if (stmt.isDestructive) {
        lines.push({
          type: "remove",
          content: `${stmt.operation}${stmt.table ? ` ${stmt.table}` : ""}`,
        })
        for (const op of stmt.destructiveOps) {
          lines.push({ type: "warning", content: op.description })
        }
      } else if (stmt.type === "ddl" && stmt.operation.includes("CREATE")) {
        lines.push({
          type: "add",
          content: `${stmt.operation}${stmt.table ? ` ${stmt.table}` : ""}`,
        })
      } else if (stmt.type === "ddl") {
        lines.push({
          type: "modify",
          content: `${stmt.operation}${stmt.table ? ` ${stmt.table}` : ""}`,
        })
      } else {
        lines.push({
          type: "context",
          content: `${stmt.operation}${stmt.table ? ` ${stmt.table}` : ""}`,
        })
      }
    }

    return lines
  }

  private buildSummary(total: number, destructive: number, hasCritical: boolean, ops: DestructiveOperation[]): string {
    if (total === 0) return "No migration statements found."
    if (destructive === 0) return `✅ Migration is safe: ${total} statement(s), no destructive operations.`
    if (hasCritical) {
      const criticalCount = ops.filter((o) => o.severity === "critical").length
      return `❌ CRITICAL: ${criticalCount} critical destructive operation(s) detected. Review carefully before applying.`
    }
    return `⚠️ WARNING: ${destructive} statement(s) with potentially destructive operations. Review before applying.`
  }
}

// ─── PGlite Shadow Execution ─────────────────────────────────────────────────

export interface PGliteShadowOptions {
  dataDir?: string
}

/**
 * Run a migration against an in-process PGlite instance for fast preview.
 * No external Postgres required.
 */
export async function runPGliteShadowPreview(
  migrationSQL: string,
  setupSQL?: string,
): Promise<{
  success: boolean
  error?: string
  durationMs: number
  analysis: MigrationAnalysis
}> {
  const analyzer = new MigrationAnalyzer()
  const analysis = analyzer.analyze(migrationSQL)
  const start = Date.now()

  try {
    const pgliteModule = await import("@electric-sql/pglite" as string)
    const PGlite = pgliteModule.PGlite ?? pgliteModule.default?.PGlite

    if (!PGlite) {
      return {
        success: false,
        error: "PGlite not available. Install: npm install @electric-sql/pglite",
        durationMs: Date.now() - start,
        analysis,
      }
    }

    const db = new PGlite("memory://")

    try {
      if (setupSQL) {
        await db.query(setupSQL)
      }

      await db.query(migrationSQL)

      return {
        success: true,
        durationMs: Date.now() - start,
        analysis,
      }
    } finally {
      await db.close()
    }
  } catch (error: unknown) {
    const isModuleError =
      (error as { code?: string }).code === "ERR_MODULE_NOT_FOUND" ||
      (error as { code?: string }).code === "MODULE_NOT_FOUND"

    return {
      success: !isModuleError,
      error: isModuleError
        ? "PGlite not installed. Run: npm install @electric-sql/pglite"
        : error instanceof Error
          ? error.message
          : String(error),
      durationMs: Date.now() - start,
      analysis,
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function extractTable(sql: string): string | undefined {
  const patterns = [
    /(?:CREATE|ALTER|DROP|TRUNCATE)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?["']?(\w+)["']?/i,
    /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+["']?(\w+)["']?/i,
    /(?:CREATE|DROP)\s+INDEX\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?["']?\w+["']?\s+ON\s+["']?(\w+)["']?/i,
  ]

  for (const pattern of patterns) {
    const match = sql.match(pattern)
    if (match) return match[1]
  }
  return undefined
}

function estimateRowCount(sql: string): number | "unknown" {
  // Simple heuristics for common patterns
  if (/SELECT\s+\*/i.test(sql) && !/WHERE/i.test(sql)) return "unknown"
  if (/LIMIT\s+(\d+)/i.test(sql)) {
    const match = sql.match(/LIMIT\s+(\d+)/i)
    return match ? parseInt(match[1], 10) : "unknown"
  }
  return "unknown"
}
