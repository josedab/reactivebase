/**
 * Live Migration Previews with Shadow Execution.
 *
 * Before applying a migration, spins up a shadow Postgres schema,
 * applies the migration, replays recent queries against it, and reports
 * breaking changes, performance regressions, and index recommendations.
 *
 * Usage:
 *   const preview = new MigrationPreview(pool)
 *   const report = await preview.run({
 *     migrationSQL: "ALTER TABLE tasks ADD COLUMN priority integer;",
 *     recentQueries: [...],
 *   })
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MigrationPreviewOptions {
  /** Shadow schema name prefix (default: "_shadow_preview_") */
  schemaPrefix?: string
  /** Max queries to replay (default: 100) */
  maxReplayQueries?: number
  /** Performance regression threshold percentage (default: 50) */
  regressionThresholdPct?: number
  /** Timeout per query replay in ms (default: 5000) */
  queryTimeoutMs?: number
  /** Auto-cleanup shadow schema (default: true) */
  autoCleanup?: boolean
}

export interface RecentQuery {
  sql: string
  params?: unknown[]
  functionName?: string
  avgDurationMs?: number
}

export interface MigrationPreviewRequest {
  /** SQL to apply in the shadow schema */
  migrationSQL: string
  /** Recent queries to replay for compatibility testing */
  recentQueries: RecentQuery[]
  /** Optional description of the migration */
  description?: string
}

export interface MigrationPreviewReport {
  /** Overall migration safety assessment */
  status: "safe" | "warning" | "breaking"
  /** Shadow schema used for the preview */
  shadowSchema: string
  /** Time taken for the entire preview */
  durationMs: number
  /** Migration application results */
  migration: {
    applied: boolean
    error?: string
    durationMs: number
  }
  /** Query replay results */
  queryResults: QueryReplayResult[]
  /** Breaking changes detected */
  breakingChanges: BreakingChange[]
  /** Performance regressions detected */
  performanceRegressions: PerformanceRegression[]
  /** Index recommendations */
  indexRecommendations: IndexRecommendation[]
  /** Summary for PR comment */
  summary: string
}

export interface QueryReplayResult {
  sql: string
  functionName?: string
  status: "success" | "error" | "timeout"
  error?: string
  originalDurationMs?: number
  shadowDurationMs: number
  rowCountDiff?: number
}

export interface BreakingChange {
  type: "column_removed" | "type_changed" | "constraint_added" | "query_error" | "table_removed"
  table?: string
  column?: string
  description: string
  affectedQueries: string[]
}

export interface PerformanceRegression {
  sql: string
  functionName?: string
  originalMs: number
  shadowMs: number
  regressionPct: number
}

export interface IndexRecommendation {
  table: string
  columns: string[]
  type: "btree" | "gin" | "gist"
  reason: string
  estimatedImpact: "high" | "medium" | "low"
}

// ─── SQL Helpers ─────────────────────────────────────────────────────────────

function sanitizeIdentifier(id: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) {
    throw new Error(`Invalid SQL identifier: ${id}`)
  }
  return id
}

export function buildCreateShadowSchemaSQL(schemaName: string): string {
  const safe = sanitizeIdentifier(schemaName)
  return `CREATE SCHEMA IF NOT EXISTS "${safe}";`
}

export function buildDropShadowSchemaSQL(schemaName: string): string {
  const safe = sanitizeIdentifier(schemaName)
  return `DROP SCHEMA IF EXISTS "${safe}" CASCADE;`
}

export function buildCopySchemaSQL(sourceSchema: string, targetSchema: string): string {
  const safeSource = sanitizeIdentifier(sourceSchema)
  const safeTarget = sanitizeIdentifier(targetSchema)
  // Copy tables structure from source to target schema
  return `
DO $$
DECLARE
  tbl RECORD;
BEGIN
  FOR tbl IN
    SELECT tablename FROM pg_tables WHERE schemaname = '${safeSource}'
  LOOP
    EXECUTE format('CREATE TABLE "${safeTarget}".%I (LIKE "${safeSource}".%I INCLUDING ALL)', tbl.tablename, tbl.tablename);
  END LOOP;
END $$;`
}

export function buildSetSearchPathSQL(schemaName: string): string {
  const safe = sanitizeIdentifier(schemaName)
  return `SET search_path TO "${safe}", public;`
}

export function buildExplainAnalyzeSQL(sql: string): string {
  return `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`
}

export function buildMissingIndexCheckSQL(schemaName: string): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT
      schemaname, relname AS table_name,
      seq_scan, seq_tup_read,
      idx_scan, idx_tup_fetch,
      seq_tup_read / GREATEST(seq_scan, 1) AS avg_rows_per_scan
    FROM pg_stat_user_tables
    WHERE schemaname = $1
      AND seq_scan > 0
      AND idx_scan = 0
    ORDER BY seq_tup_read DESC
    LIMIT 20`,
    params: [schemaName],
  }
}

// ─── Migration Preview Engine ────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<MigrationPreviewOptions> = {
  schemaPrefix: "_shadow_preview_",
  maxReplayQueries: 100,
  regressionThresholdPct: 50,
  queryTimeoutMs: 5000,
  autoCleanup: true,
}

export class MigrationPreview {
  private options: Required<MigrationPreviewOptions>
  private pool: PoolLike

  constructor(pool: PoolLike, options: MigrationPreviewOptions = {}) {
    this.pool = pool
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Run a full migration preview: create shadow, apply migration,
   * replay queries, analyze results.
   */
  async run(request: MigrationPreviewRequest): Promise<MigrationPreviewReport> {
    const startTime = Date.now()
    const shadowSchema = `${this.options.schemaPrefix}${Date.now()}`

    const breakingChanges: BreakingChange[] = []
    const regressions: PerformanceRegression[] = []
    const queryResults: QueryReplayResult[] = []
    const indexRecs: IndexRecommendation[] = []

    let migrationResult = { applied: false, durationMs: 0, error: undefined as string | undefined }

    const client = await this.pool.connect()
    try {
      // 1. Create shadow schema
      await client.query(buildCreateShadowSchemaSQL(shadowSchema))

      // 2. Copy current schema structure
      await client.query(buildCopySchemaSQL("public", shadowSchema))

      // 3. Apply migration in shadow
      const migStart = Date.now()
      try {
        await client.query(buildSetSearchPathSQL(shadowSchema))
        await client.query(request.migrationSQL)
        migrationResult = { applied: true, durationMs: Date.now() - migStart, error: undefined }
      } catch (err: unknown) {
        migrationResult = {
          applied: false,
          durationMs: Date.now() - migStart,
          error: err instanceof Error ? err.message : String(err),
        }
        breakingChanges.push({
          type: "query_error",
          description: `Migration failed to apply: ${migrationResult.error}`,
          affectedQueries: [],
        })
      }

      // 4. Replay queries if migration applied
      if (migrationResult.applied) {
        const queries = request.recentQueries.slice(0, this.options.maxReplayQueries)

        for (const q of queries) {
          const result = await this.replayQuery(client, q, shadowSchema)
          queryResults.push(result)

          if (result.status === "error") {
            breakingChanges.push({
              type: "query_error",
              description: `Query failed: ${result.error}`,
              affectedQueries: [result.sql],
            })
          }

          if (
            result.status === "success" &&
            q.avgDurationMs &&
            result.shadowDurationMs > q.avgDurationMs * (1 + this.options.regressionThresholdPct / 100)
          ) {
            regressions.push({
              sql: result.sql,
              functionName: q.functionName,
              originalMs: q.avgDurationMs,
              shadowMs: result.shadowDurationMs,
              regressionPct: Math.round(((result.shadowDurationMs - q.avgDurationMs) / q.avgDurationMs) * 100),
            })
          }
        }

        // 5. Check for missing indexes
        try {
          const { sql: idxSql, params: idxParams } = buildMissingIndexCheckSQL(shadowSchema)
          const idxResult = await client.query(idxSql, idxParams)
          for (const row of idxResult.rows as Record<string, unknown>[]) {
            const avgRows = parseInt(String(row.avg_rows_per_scan), 10)
            if (avgRows > 100) {
              indexRecs.push({
                table: row.table_name as string,
                columns: [],
                type: "btree",
                reason: `Sequential scan reading avg ${avgRows} rows/scan with no index usage`,
                estimatedImpact: avgRows > 1000 ? "high" : "medium",
              })
            }
          }
        } catch {
          // Index analysis is best-effort
        }
      }

      // Reset search path
      await client.query("SET search_path TO public;")
    } finally {
      // 6. Cleanup shadow schema
      if (this.options.autoCleanup) {
        try {
          await client.query(buildDropShadowSchemaSQL(shadowSchema))
        } catch {
          // Best effort cleanup
        }
      }
      client.release()
    }

    const status = breakingChanges.length > 0 ? "breaking" : regressions.length > 0 ? "warning" : "safe"

    const summary = this.generateSummary(status, migrationResult, queryResults, breakingChanges, regressions, indexRecs)

    return {
      status,
      shadowSchema,
      durationMs: Date.now() - startTime,
      migration: migrationResult,
      queryResults,
      breakingChanges,
      performanceRegressions: regressions,
      indexRecommendations: indexRecs,
      summary,
    }
  }

  /**
   * Generate a markdown summary suitable for PR comments.
   */
  generatePRComment(report: MigrationPreviewReport, description?: string): string {
    const emoji = report.status === "safe" ? "✅" : report.status === "warning" ? "⚠️" : "❌"
    const lines: string[] = [
      `## ${emoji} Migration Preview Report`,
      "",
      description ? `> ${description}` : "",
      "",
      `**Status:** ${report.status.toUpperCase()}`,
      `**Duration:** ${report.durationMs}ms`,
      "",
    ]

    if (!report.migration.applied) {
      lines.push(`### ❌ Migration Failed to Apply`, `\`\`\``, report.migration.error ?? "Unknown error", `\`\`\``, "")
    }

    if (report.breakingChanges.length > 0) {
      lines.push(`### Breaking Changes (${report.breakingChanges.length})`, "")
      for (const bc of report.breakingChanges) {
        lines.push(`- **${bc.type}**: ${bc.description}`)
      }
      lines.push("")
    }

    if (report.performanceRegressions.length > 0) {
      lines.push(`### Performance Regressions (${report.performanceRegressions.length})`, "")
      lines.push("| Query | Original | Shadow | Regression |", "|-------|----------|--------|------------|")
      for (const pr of report.performanceRegressions) {
        const name = pr.functionName ?? pr.sql.substring(0, 50)
        lines.push(`| ${name} | ${pr.originalMs}ms | ${pr.shadowMs}ms | +${pr.regressionPct}% |`)
      }
      lines.push("")
    }

    if (report.indexRecommendations.length > 0) {
      lines.push(`### Index Recommendations (${report.indexRecommendations.length})`, "")
      for (const ir of report.indexRecommendations) {
        lines.push(`- **${ir.table}**: ${ir.reason} (impact: ${ir.estimatedImpact})`)
      }
      lines.push("")
    }

    const succeeded = report.queryResults.filter((r) => r.status === "success").length
    const failed = report.queryResults.filter((r) => r.status === "error").length
    lines.push(`### Query Replay: ${succeeded} passed, ${failed} failed out of ${report.queryResults.length}`)

    return lines.join("\n")
  }

  // ─── Private ───────────────────────────────────────────────────────────

  private async replayQuery(
    client: PoolClientLike,
    query: RecentQuery,
    shadowSchema: string,
  ): Promise<QueryReplayResult> {
    const start = Date.now()
    try {
      await client.query(buildSetSearchPathSQL(shadowSchema))
      const timeoutMs = Number(this.options.queryTimeoutMs)
      if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
        throw new Error(`Invalid queryTimeoutMs: ${this.options.queryTimeoutMs}`)
      }
      await client.query(`SET statement_timeout TO $1`, [`${timeoutMs}ms`])
      await client.query(query.sql, query.params ?? [])

      return {
        sql: query.sql,
        functionName: query.functionName,
        status: "success",
        originalDurationMs: query.avgDurationMs,
        shadowDurationMs: Date.now() - start,
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const isTimeout = errMsg.includes("statement timeout")

      return {
        sql: query.sql,
        functionName: query.functionName,
        status: isTimeout ? "timeout" : "error",
        error: errMsg,
        originalDurationMs: query.avgDurationMs,
        shadowDurationMs: Date.now() - start,
      }
    } finally {
      await client.query("SET statement_timeout TO '0'").catch((err) => {
        console.error("Failed to reset statement_timeout:", err)
      })
    }
  }

  private generateSummary(
    status: string,
    migration: { applied: boolean; error?: string },
    queryResults: QueryReplayResult[],
    breakingChanges: BreakingChange[],
    regressions: PerformanceRegression[],
    indexRecs: IndexRecommendation[],
  ): string {
    const parts: string[] = [`Migration preview: ${status.toUpperCase()}`]

    if (!migration.applied) {
      parts.push(`Migration failed: ${migration.error}`)
    }

    const succeeded = queryResults.filter((r) => r.status === "success").length
    const failed = queryResults.filter((r) => r.status === "error").length
    parts.push(`Queries: ${succeeded} passed, ${failed} failed`)

    if (breakingChanges.length > 0) parts.push(`${breakingChanges.length} breaking changes`)
    if (regressions.length > 0) parts.push(`${regressions.length} performance regressions`)
    if (indexRecs.length > 0) parts.push(`${indexRecs.length} index recommendations`)

    return parts.join(". ")
  }
}

// ─── Minimal pool/client interfaces ─────────────────────────────────────────

export interface PoolLike {
  connect(): Promise<PoolClientLike>
}

export interface PoolClientLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>
  release(): void
}
