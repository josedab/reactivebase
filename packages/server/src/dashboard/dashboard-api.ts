/**
 * Dashboard API request handler.
 * Provides a framework-agnostic handler for dashboard API endpoints
 * that can be mounted on any HTTP server.
 *
 * Endpoints:
 *   GET  /api/tables       - List all public tables
 *   GET  /api/tables/:name - Get table data (first 100 rows)
 *   GET  /api/metrics      - Get metrics snapshot
 *   GET  /api/schema       - Get schema column info
 *   POST /api/query        - Execute a read-only SQL query
 */

import type { DashboardV2Engine } from "./query-inspector.js"
import type { MetricsCollector } from "../metrics/metrics.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export type QueryExecutor = (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>

export interface DashboardApiOptions {
  db?: QueryExecutor
  metricsCollector?: MetricsCollector
  dashboardEngine?: DashboardV2Engine
}

export interface DashboardApiResponse {
  status: number
  body: unknown
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Validate that a SQL string is safe for read-only execution.
 * Returns an error message if the SQL is rejected, or null if safe.
 */
export function validateReadOnlySQL(sql: string): string | null {
  if (!sql || !sql.trim()) return "Empty SQL query"

  // Reject multiple statements (semicolons outside string literals)
  const withoutStrings = sql.replace(/'[^']*'/g, "''")
  if (withoutStrings.includes(";")) {
    return "Multiple statements not allowed"
  }

  const upper = sql.trim().toUpperCase()

  // Must start with SELECT, WITH (CTE), or EXPLAIN SELECT
  if (!upper.startsWith("SELECT") && !upper.startsWith("EXPLAIN") && !upper.startsWith("WITH")) {
    return "Only SELECT and EXPLAIN queries allowed"
  }

  // EXPLAIN is only safe with SELECT — block EXPLAIN DELETE/INSERT/UPDATE
  if (upper.startsWith("EXPLAIN")) {
    const afterExplain = upper.replace(/^EXPLAIN\s+(ANALYZE\s+)?(\(\s*[^)]*\)\s*)?/i, "").trim()
    if (!afterExplain.startsWith("SELECT") && !afterExplain.startsWith("WITH")) {
      return "EXPLAIN is only allowed with SELECT statements"
    }
  }

  // Block write keywords anywhere in the query (catches CTEs with writes)
  const writeKeywords =
    /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s|TRUNCATE\s|ALTER\s|CREATE\s|GRANT\s|REVOKE\s|COPY\s)/i
  if (writeKeywords.test(sql)) {
    return "Write operations not allowed in read-only queries"
  }

  // Block transaction control
  if (/\b(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i.test(upper)) {
    return "Transaction control not allowed"
  }

  // Block system-level operations
  if (/\b(SET\s+|RESET\s+|DISCARD\s+|LISTEN\s+|NOTIFY\s+|UNLISTEN\s+)/i.test(sql)) {
    return "System operations not allowed"
  }

  return null
}

export function createDashboardApiHandler(options: DashboardApiOptions) {
  return async function handleDashboardApi(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<DashboardApiResponse> {
    try {
      // GET /api/tables - List all tables
      if (path === "/api/tables" && method === "GET") {
        if (!options.db) return { status: 503, body: { error: "No database connection" } }
        const result = await options.db(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
          [],
        )
        return { status: 200, body: result.rows.map((r) => r.table_name) }
      }

      // GET /api/tables/:name - Get table data
      if (path.startsWith("/api/tables/") && method === "GET") {
        if (!options.db) return { status: 503, body: { error: "No database connection" } }
        const tableName = path.replace("/api/tables/", "").replace(/[^a-zA-Z0-9_]/g, "")
        if (!tableName) return { status: 400, body: { error: "Invalid table name" } }
        const result = await options.db(`SELECT * FROM "${tableName}" LIMIT 100`, [])
        return { status: 200, body: result.rows }
      }

      // GET /api/metrics - Get metrics snapshot
      if (path === "/api/metrics" && method === "GET") {
        if (options.dashboardEngine) {
          return { status: 200, body: options.dashboardEngine.getMetrics() }
        }
        if (options.metricsCollector) {
          return { status: 200, body: options.metricsCollector.getSnapshot() }
        }
        return { status: 200, body: {} }
      }

      // GET /api/schema - Get schema info
      if (path === "/api/schema" && method === "GET") {
        if (!options.db) return { status: 503, body: { error: "No database connection" } }
        const result = await options.db(
          `SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default FROM information_schema.columns c JOIN information_schema.tables t ON c.table_name = t.table_name WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' ORDER BY c.table_name, c.ordinal_position`,
          [],
        )
        return { status: 200, body: result.rows }
      }

      // POST /api/query - Execute a read-only query
      if (path === "/api/query" && method === "POST") {
        if (!options.db) return { status: 503, body: { error: "No database connection" } }
        const { sql } = (body ?? {}) as { sql?: string }
        if (!sql) return { status: 400, body: { error: "Missing sql parameter" } }

        const rejection = validateReadOnlySQL(sql)
        if (rejection) {
          return { status: 403, body: { error: rejection } }
        }

        const result = await options.db(sql, [])
        return { status: 200, body: result.rows }
      }

      return { status: 404, body: { error: "Not found" } }
    } catch (err) {
      return { status: 500, body: { error: err instanceof Error ? err.message : "Internal error" } }
    }
  }
}
