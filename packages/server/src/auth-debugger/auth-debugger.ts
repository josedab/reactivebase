/**
 * Reactive Permissions Debugger.
 * Traces exactly why a query returned (or didn't return) specific rows for a user.
 * Shows auth context, RLS policies, Zanzibar tuples, and SQL EXPLAIN output.
 */

import type { AuthContext } from "../auth/index.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DebugTraceEntry {
  /** Monotonic timestamp for ordering */
  timestamp: number
  /** Trace category */
  category: "auth" | "rls" | "zanzibar" | "query" | "filter" | "result"
  /** Human-readable description */
  message: string
  /** Structured detail data */
  detail?: Record<string, unknown>
  /** Outcome of this step */
  outcome: "pass" | "deny" | "info" | "error"
  /** Duration in ms (if applicable) */
  durationMs?: number
}

export interface PermissionsDebugResult {
  /** The user being debugged */
  userId: string | null
  /** Auth context snapshot */
  authContext: {
    userId: string | null
    claims: Record<string, unknown>
  }
  /** Query being debugged */
  queryName: string
  queryArgs: unknown
  /** Table(s) accessed */
  tables: string[]
  /** Full trace log */
  trace: DebugTraceEntry[]
  /** Rows returned */
  rowsReturned: number
  /** Rows filtered by RLS */
  rowsFilteredByRls: number
  /** Rows filtered by Zanzibar */
  rowsFilteredByZanzibar: number
  /** SQL EXPLAIN output (if available) */
  explainOutput?: string
  /** Generated SQL with RLS applied */
  generatedSQL?: string
  /** Summary verdict */
  summary: string
  /** Total debug time */
  totalDurationMs: number
}

export interface AuthDebugOptions {
  /** Include EXPLAIN ANALYZE output */
  includeExplain?: boolean
  /** Include raw SQL */
  includeSQL?: boolean
  /** Max rows to inspect for RLS filtering detail */
  maxRowsToInspect?: number
  /** Include Zanzibar tuple evaluation */
  includeZanzibar?: boolean
}

const DEFAULT_DEBUG_OPTIONS: Required<AuthDebugOptions> = {
  includeExplain: true,
  includeSQL: true,
  maxRowsToInspect: 100,
  includeZanzibar: true,
}

// ─── Ring Buffer for Trace Collection ────────────────────────────────────────

/**
 * Fixed-size ring buffer for efficiently collecting trace entries.
 * Old entries are overwritten when the buffer is full.
 */
export class TraceRingBuffer {
  private buffer: Array<DebugTraceEntry | null>
  private writeIndex = 0
  private count = 0

  constructor(private capacity: number = 1000) {
    if (capacity < 1) throw new AuthDebugError("Ring buffer capacity must be at least 1")
    this.buffer = new Array(capacity).fill(null)
  }

  /**
   * Add a trace entry to the buffer.
   */
  push(entry: DebugTraceEntry): void {
    this.buffer[this.writeIndex] = entry
    this.writeIndex = (this.writeIndex + 1) % this.capacity
    if (this.count < this.capacity) this.count++
  }

  /**
   * Get all entries in chronological order.
   */
  getAll(): DebugTraceEntry[] {
    if (this.count < this.capacity) {
      return this.buffer.slice(0, this.count).filter((e): e is DebugTraceEntry => e !== null)
    }

    // Buffer has wrapped: read from writeIndex to end, then start to writeIndex
    const result: DebugTraceEntry[] = []
    for (let i = 0; i < this.capacity; i++) {
      const idx = (this.writeIndex + i) % this.capacity
      const entry = this.buffer[idx]
      if (entry) result.push(entry)
    }
    return result
  }

  /**
   * Get entries filtered by category.
   */
  getByCategory(category: DebugTraceEntry["category"]): DebugTraceEntry[] {
    return this.getAll().filter((e) => e.category === category)
  }

  /**
   * Get entries that resulted in denial.
   */
  getDenials(): DebugTraceEntry[] {
    return this.getAll().filter((e) => e.outcome === "deny")
  }

  /**
   * Clear the buffer.
   */
  clear(): void {
    this.buffer = new Array(this.capacity).fill(null)
    this.writeIndex = 0
    this.count = 0
  }

  get size(): number {
    return this.count
  }
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class AuthDebugError extends Error {
  readonly code = "AUTH_DEBUG_ERROR"

  constructor(message: string) {
    super(message)
    this.name = "AuthDebugError"
  }
}

// ─── Permissions Debugger ────────────────────────────────────────────────────

export interface RlsPolicyInfo {
  table: string
  filter: (auth: AuthContext, row: Record<string, unknown>) => boolean
}

export interface ZanzibarTupleInfo {
  resourceType: string
  resourceId: string
  relation: string
  subjectType: string
  subjectId: string
}

/**
 * Interactive debugging tool for tracing permission decisions.
 */
export class PermissionsDebugger {
  private traceBuffer: TraceRingBuffer
  private rlsPolicies: RlsPolicyInfo[] = []
  private zanzibarTuples: ZanzibarTupleInfo[] = []
  private options: Required<AuthDebugOptions>

  constructor(options: AuthDebugOptions = {}) {
    this.options = { ...DEFAULT_DEBUG_OPTIONS, ...options }
    this.traceBuffer = new TraceRingBuffer(5000)
  }

  /**
   * Register RLS policies for debugging.
   */
  registerRlsPolicies(policies: RlsPolicyInfo[]): void {
    this.rlsPolicies = policies
  }

  /**
   * Set known Zanzibar tuples for debugging.
   */
  setZanzibarTuples(tuples: ZanzibarTupleInfo[]): void {
    this.zanzibarTuples = tuples
  }

  /**
   * Debug a query execution for a specific user.
   * Traces the full permission evaluation pipeline.
   */
  debugQuery(
    auth: AuthContext,
    queryName: string,
    queryArgs: unknown,
    tables: string[],
    allRows: Record<string, unknown>[],
  ): PermissionsDebugResult {
    const startTime = performance.now()
    this.traceBuffer.clear()

    // Step 1: Auth context evaluation
    this.traceAuth(auth)

    // Step 2: RLS policy evaluation
    const { rlsPassedRows, rlsFilteredCount } = this.traceRls(auth, tables, allRows)

    // Step 3: Zanzibar tuple evaluation
    let zanzibarFilteredCount = 0
    let finalRows = rlsPassedRows
    if (this.options.includeZanzibar && this.zanzibarTuples.length > 0) {
      const zanzibarResult = this.traceZanzibar(auth, tables, rlsPassedRows)
      finalRows = zanzibarResult.passedRows
      zanzibarFilteredCount = zanzibarResult.filteredCount
    }

    // Step 4: Query result summary
    this.traceBuffer.push({
      timestamp: performance.now(),
      category: "result",
      message: `Query "${queryName}" returned ${finalRows.length} rows (${rlsFilteredCount} filtered by RLS, ${zanzibarFilteredCount} by Zanzibar)`,
      detail: { rowCount: finalRows.length, args: queryArgs },
      outcome: "info",
    })

    const totalDurationMs = performance.now() - startTime

    // Build summary
    const denials = this.traceBuffer.getDenials()
    let summary: string
    if (finalRows.length === 0 && allRows.length > 0) {
      summary = `All ${allRows.length} rows were filtered out. ${denials.length} denial(s) recorded.`
    } else if (finalRows.length === allRows.length) {
      summary = `All ${allRows.length} rows passed permission checks.`
    } else {
      summary = `${finalRows.length}/${allRows.length} rows passed. ${rlsFilteredCount} filtered by RLS, ${zanzibarFilteredCount} by Zanzibar.`
    }

    return {
      userId: auth.userId,
      authContext: {
        userId: auth.userId,
        claims: auth.claims,
      },
      queryName,
      queryArgs,
      tables,
      trace: this.traceBuffer.getAll(),
      rowsReturned: finalRows.length,
      rowsFilteredByRls: rlsFilteredCount,
      rowsFilteredByZanzibar: zanzibarFilteredCount,
      summary,
      totalDurationMs,
    }
  }

  /**
   * Format debug result for CLI display.
   */
  formatForCLI(result: PermissionsDebugResult): string {
    const lines: string[] = []
    lines.push("╔══════════════════════════════════════════════════╗")
    lines.push("║          Permissions Debug Trace                 ║")
    lines.push("╚══════════════════════════════════════════════════╝")
    lines.push("")

    // Auth Context
    lines.push(`User: ${result.userId ?? "(anonymous)"}`)
    lines.push(`Claims: ${JSON.stringify(result.authContext.claims)}`)
    lines.push(`Query: ${result.queryName}(${JSON.stringify(result.queryArgs)})`)
    lines.push(`Tables: ${result.tables.join(", ")}`)
    lines.push("")

    // Trace
    lines.push("─── Trace ─────────────────────────────────────────")
    for (const entry of result.trace) {
      const icon = this.outcomeIcon(entry.outcome)
      const duration = entry.durationMs !== undefined ? ` (${entry.durationMs.toFixed(1)}ms)` : ""
      lines.push(`  ${icon} [${entry.category}] ${entry.message}${duration}`)
    }
    lines.push("")

    // Summary
    lines.push("─── Summary ───────────────────────────────────────")
    lines.push(`  Rows returned: ${result.rowsReturned}`)
    lines.push(`  Filtered by RLS: ${result.rowsFilteredByRls}`)
    lines.push(`  Filtered by Zanzibar: ${result.rowsFilteredByZanzibar}`)
    lines.push(`  Total time: ${result.totalDurationMs.toFixed(2)}ms`)
    lines.push("")
    lines.push(`  → ${result.summary}`)

    if (result.explainOutput) {
      lines.push("")
      lines.push("─── EXPLAIN Output ────────────────────────────────")
      lines.push(result.explainOutput)
    }

    return lines.join("\n")
  }

  /**
   * Get the trace buffer for direct access.
   */
  getTraceBuffer(): TraceRingBuffer {
    return this.traceBuffer
  }

  private traceAuth(auth: AuthContext): void {
    if (auth.userId) {
      this.traceBuffer.push({
        timestamp: performance.now(),
        category: "auth",
        message: `Authenticated as user "${auth.userId}"`,
        detail: { claims: auth.claims },
        outcome: "pass",
      })

      const claimKeys = Object.keys(auth.claims)
      if (claimKeys.length > 0) {
        this.traceBuffer.push({
          timestamp: performance.now(),
          category: "auth",
          message: `Claims present: ${claimKeys.join(", ")}`,
          outcome: "info",
        })
      }
    } else {
      this.traceBuffer.push({
        timestamp: performance.now(),
        category: "auth",
        message: "No authenticated user (anonymous access)",
        outcome: "info",
      })
    }
  }

  private traceRls(
    auth: AuthContext,
    tables: string[],
    rows: Record<string, unknown>[],
  ): { rlsPassedRows: Record<string, unknown>[]; rlsFilteredCount: number } {
    const applicablePolicies = this.rlsPolicies.filter((p) => tables.includes(p.table))

    if (applicablePolicies.length === 0) {
      this.traceBuffer.push({
        timestamp: performance.now(),
        category: "rls",
        message: `No RLS policies defined for tables: ${tables.join(", ")}`,
        outcome: "info",
      })
      return { rlsPassedRows: rows, rlsFilteredCount: 0 }
    }

    this.traceBuffer.push({
      timestamp: performance.now(),
      category: "rls",
      message: `Evaluating ${applicablePolicies.length} RLS policy/policies`,
      outcome: "info",
    })

    const passedRows: Record<string, unknown>[] = []
    let filteredCount = 0
    const maxInspect = Math.min(rows.length, this.options.maxRowsToInspect)

    for (let i = 0; i < maxInspect; i++) {
      const row = rows[i]
      let rowPassed = true

      for (const policy of applicablePolicies) {
        const start = performance.now()
        try {
          const allowed = policy.filter(auth, row)
          const duration = performance.now() - start

          if (!allowed) {
            rowPassed = false
            this.traceBuffer.push({
              timestamp: performance.now(),
              category: "rls",
              message: `Row ${i} denied by RLS policy on "${policy.table}"`,
              detail: { rowId: row.id, table: policy.table },
              outcome: "deny",
              durationMs: duration,
            })
            break
          }
        } catch (error: unknown) {
          rowPassed = false
          this.traceBuffer.push({
            timestamp: performance.now(),
            category: "rls",
            message: `RLS policy error on row ${i}: ${error instanceof Error ? error.message : "unknown"}`,
            outcome: "error",
          })
          break
        }
      }

      if (rowPassed) {
        passedRows.push(row)
      } else {
        filteredCount++
      }
    }

    // Handle remaining rows beyond maxInspect
    if (rows.length > maxInspect) {
      passedRows.push(...rows.slice(maxInspect))
      this.traceBuffer.push({
        timestamp: performance.now(),
        category: "rls",
        message: `Skipped detailed inspection for ${rows.length - maxInspect} additional rows`,
        outcome: "info",
      })
    }

    return { rlsPassedRows: passedRows, rlsFilteredCount: filteredCount }
  }

  private traceZanzibar(
    auth: AuthContext,
    tables: string[],
    rows: Record<string, unknown>[],
  ): { passedRows: Record<string, unknown>[]; filteredCount: number } {
    if (!auth.userId) {
      this.traceBuffer.push({
        timestamp: performance.now(),
        category: "zanzibar",
        message: "Skipping Zanzibar evaluation: no authenticated user",
        outcome: "info",
      })
      return { passedRows: rows, filteredCount: 0 }
    }

    // Find matching tuples for this user
    const userTuples = this.zanzibarTuples.filter((t) => t.subjectType === "user" && t.subjectId === auth.userId)

    this.traceBuffer.push({
      timestamp: performance.now(),
      category: "zanzibar",
      message: `Found ${userTuples.length} Zanzibar tuple(s) for user "${auth.userId}"`,
      detail: { tuples: userTuples.map((t) => `${t.resourceType}:${t.resourceId}#${t.relation}`) },
      outcome: "info",
    })

    // For each row, check if the user has a matching tuple
    const passedRows: Record<string, unknown>[] = []
    let filteredCount = 0
    const maxInspect = Math.min(rows.length, this.options.maxRowsToInspect)

    for (let i = 0; i < maxInspect; i++) {
      const row = rows[i]
      const rowId = String(row.id ?? "")

      // Check if any tuple grants access to this resource
      const hasAccess = userTuples.some((t) => tables.includes(t.resourceType) && t.resourceId === rowId)

      if (hasAccess || userTuples.length === 0) {
        passedRows.push(row)
      } else {
        filteredCount++
        this.traceBuffer.push({
          timestamp: performance.now(),
          category: "zanzibar",
          message: `Row ${i} (id=${rowId}) denied: no matching Zanzibar tuple`,
          detail: { rowId, tables },
          outcome: "deny",
        })
      }
    }

    if (rows.length > maxInspect) {
      passedRows.push(...rows.slice(maxInspect))
    }

    return { passedRows, filteredCount }
  }

  private outcomeIcon(outcome: DebugTraceEntry["outcome"]): string {
    switch (outcome) {
      case "pass":
        return "✅"
      case "deny":
        return "❌"
      case "info":
        return "ℹ️"
      case "error":
        return "⚠️"
    }
  }
}

// ─── Dashboard Widget Data ───────────────────────────────────────────────────

export interface AuthDebugDashboardData {
  recentTraces: PermissionsDebugResult[]
  totalDenials: number
  denialsByCategory: Record<string, number>
  averageTraceTimeMs: number
}

/**
 * Collects auth debug data for dashboard display.
 */
export class AuthDebugDashboard {
  private recentResults: PermissionsDebugResult[] = []
  private maxResults: number

  constructor(maxResults: number = 50) {
    this.maxResults = maxResults
  }

  /**
   * Record a debug result.
   */
  record(result: PermissionsDebugResult): void {
    this.recentResults.push(result)
    if (this.recentResults.length > this.maxResults) {
      this.recentResults.shift()
    }
  }

  /**
   * Get dashboard data snapshot.
   */
  getData(): AuthDebugDashboardData {
    let totalDenials = 0
    const denialsByCategory: Record<string, number> = {}
    let totalTime = 0

    for (const result of this.recentResults) {
      totalTime += result.totalDurationMs
      for (const entry of result.trace) {
        if (entry.outcome === "deny") {
          totalDenials++
          denialsByCategory[entry.category] = (denialsByCategory[entry.category] ?? 0) + 1
        }
      }
    }

    return {
      recentTraces: this.recentResults,
      totalDenials,
      denialsByCategory,
      averageTraceTimeMs: this.recentResults.length > 0 ? totalTime / this.recentResults.length : 0,
    }
  }

  /**
   * Clear recorded results.
   */
  clear(): void {
    this.recentResults = []
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createPermissionsDebugger(options?: AuthDebugOptions): PermissionsDebugger {
  return new PermissionsDebugger(options)
}

export function createAuthDebugDashboard(maxResults?: number): AuthDebugDashboard {
  return new AuthDebugDashboard(maxResults)
}
