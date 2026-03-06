/**
 * Reactive Computed Tables for ReactiveBase.
 * Extends the ComputedTableEngine with real-time reactive capabilities,
 * integrating with the IVM pipeline for incremental maintenance and
 * providing subscription-based change notifications.
 *
 * Features:
 *   - Declarative defineComputedTable() API for reactive table definitions
 *   - Reactive engine with CDC change handling and incremental updates
 *   - Subscription system for real-time computed table change events
 *   - Client integration helpers for query building and subscriptions
 *   - Topological ordering for cascading refresh across dependent tables
 *
 * Usage:
 *   const def = defineComputedTable({
 *     name: "order_stats",
 *     query: (ctx) => ctx.db.orders.groupBy("customerId").select({
 *       totalOrders: count(),
 *       totalSpent: sum("amount"),
 *     }),
 *     sources: ["orders", "order_items"],
 *     refreshStrategy: "incremental",
 *     indexes: [{ columns: ["customerId"], unique: true }],
 *   })
 *
 *   const engine = new ReactiveComputedTableEngine()
 *   engine.register(def)
 *   engine.subscribe("order_stats", (event) => console.log(event))
 *   engine.handleChange({ table: "orders", type: "insert", newRow: { ... } })
 */

import { ComputedTableEngine, ComputedTableError } from "./computed-tables.js"

import type {
  ComputedTableDefinition,
  RefreshStrategy,
  ComputedIndexDef,
  ComputedTableState,
} from "./computed-tables.js"

import { IvmPipeline } from "../ivm/index.js"

import type { DataChange, ViewDelta, Row, PipelineResult } from "../ivm/index.js"

// ─── Types ───────────────────────────────────────────────────────────────────

/** Context passed to the query builder function in defineComputedTable. */
export interface ComputedTableQueryContext {
  /** Placeholder for table references used in query builder DSL */
  db: Record<string, unknown>
  /** Raw SQL escape hatch */
  sql: (raw: string) => string
}

/** Declarative definition for a reactive computed table. */
export interface ReactiveComputedTableDefinition {
  /** Unique name for the computed table */
  name: string
  /** Query builder function or raw SQL string */
  query: string | ((ctx: ComputedTableQueryContext) => string)
  /** Source tables that trigger reactive updates */
  sources: string[]
  /** Refresh strategy (defaults to "incremental") */
  refreshStrategy?: RefreshStrategy
  /** Primary key columns for incremental upserts */
  primaryKey?: string[]
  /** Indexes to create on the computed table */
  indexes?: ComputedIndexDef[]
  /** Description for documentation */
  description?: string
  /** Debounce time in ms for batching rapid changes (default: 100) */
  debounceMs?: number
  /** Enable history tracking for audit trail */
  trackHistory?: boolean
}

/** Event emitted when a computed table changes. */
export interface ComputedTableChangeEvent {
  /** Name of the computed table that changed */
  tableName: string
  /** Type of change that occurred */
  type: "refresh" | "incremental" | "error"
  /** Rows inserted during incremental update */
  inserts: Row[]
  /** Rows deleted during incremental update */
  deletes: Row[]
  /** Rows updated during incremental update */
  updates: Array<{ old: Row; new: Row }>
  /** Whether a full refresh was required */
  requiresFullRefresh: boolean
  /** Timestamp of the event */
  timestamp: number
  /** What source change triggered this event */
  triggeredBy: DataChange | null
}

/** Subscription handle for computed table changes. */
export interface ComputedTableSubscription {
  /** Unique subscription identifier */
  id: string
  /** Name of the computed table being subscribed to */
  tableName: string
  /** Optional filter applied to change events */
  filter?: SubscriptionFilter
  /** Unsubscribe from change events */
  unsubscribe: () => void
}

/** Filter for narrowing subscription events. */
export interface SubscriptionFilter {
  /** Only receive events for rows matching these column conditions */
  where?: Record<string, unknown>
  /** Columns to include in the change event payload */
  columns?: string[]
}

/** Result of an incremental update operation. */
export interface IncrementalUpdateResult {
  /** Name of the computed table that was updated */
  tableName: string
  /** Whether IVM delta was used (vs full refresh) */
  usedDelta: boolean
  /** Number of rows affected */
  rowsAffected: number
  /** Duration of the update in milliseconds */
  durationMs: number
  /** Pipeline results from IVM processing */
  pipelineResults: PipelineResult[]
  /** Tables that were cascaded to */
  cascadedTo: string[]
}

// ─── Define Computed Table API ───────────────────────────────────────────────

/**
 * Declarative API to define a reactive computed table.
 * Resolves the query builder and returns a full definition ready for registration.
 *
 * @param config - Reactive computed table configuration
 * @returns A resolved ReactiveComputedTableDefinition with the query materialized as SQL
 */
export function defineComputedTable(config: ReactiveComputedTableDefinition): ReactiveComputedTableDefinition {
  if (!config.name || config.name.trim() === "") {
    throw new ComputedTableError("Computed table name is required")
  }
  if (!config.sources || config.sources.length === 0) {
    throw new ComputedTableError(`Computed table "${config.name}" requires at least one source`)
  }
  if (!config.query) {
    throw new ComputedTableError(`Computed table "${config.name}" requires a query`)
  }

  // Resolve query builder function to SQL string
  let resolvedQuery: string
  if (typeof config.query === "function") {
    const ctx: ComputedTableQueryContext = {
      db: new Proxy(
        {},
        {
          get: (_target, tableName: string) => tableName,
        },
      ),
      sql: (raw: string) => raw,
    }
    const result = config.query(ctx)
    resolvedQuery = typeof result === "string" ? result : String(result)
  } else {
    resolvedQuery = config.query
  }

  return {
    ...config,
    query: resolvedQuery,
    refreshStrategy: config.refreshStrategy ?? "incremental",
    debounceMs: config.debounceMs ?? 100,
  }
}

// ─── Reactive Computed Table Engine ──────────────────────────────────────────

type ChangeCallback = (event: ComputedTableChangeEvent) => void

/**
 * Extends ComputedTableEngine with reactive capabilities.
 * Integrates with the IVM pipeline for incremental maintenance and
 * provides a subscription system for real-time change notifications.
 */
export class ReactiveComputedTableEngine {
  private engine = new ComputedTableEngine()
  private pipeline = new IvmPipeline()
  private subscribers = new Map<string, Map<string, ChangeCallback>>()
  private definitions = new Map<string, ReactiveComputedTableDefinition>()
  private tableData = new Map<string, Row[]>()
  private subscriptionCounter = 0

  // ─── Registration ───────────────────────────────────────────────────

  /**
   * Register a reactive computed table definition.
   * Sets up the underlying engine definition and IVM view for incremental maintenance.
   *
   * @param definition - The reactive computed table definition to register
   */
  register(definition: ReactiveComputedTableDefinition): void {
    const resolved = typeof definition.query === "function" ? defineComputedTable(definition) : definition

    const resolvedQuery = typeof resolved.query === "string" ? resolved.query : String(resolved.query)

    // Register in the base engine
    const engineDef: ComputedTableDefinition = {
      name: resolved.name,
      sourceTables: resolved.sources,
      query: resolvedQuery,
      primaryKey: resolved.primaryKey,
      refreshStrategy: resolved.refreshStrategy ?? "incremental",
      indexes: resolved.indexes,
      description: resolved.description,
      debounceMs: resolved.debounceMs,
      trackHistory: resolved.trackHistory,
    }
    this.engine.define(engineDef)

    // Store the reactive definition
    this.definitions.set(resolved.name, resolved)

    // Initialize empty state
    this.tableData.set(resolved.name, [])

    // Register IVM view for incremental strategy
    if ((resolved.refreshStrategy ?? "incremental") === "incremental") {
      this.pipeline.registerView({
        viewId: resolved.name,
        queryAst: { type: "scan", table: resolved.sources[0] },
        currentResult: [],
      })
    }
  }

  /**
   * Unregister a reactive computed table.
   *
   * @param name - Name of the computed table to remove
   */
  unregister(name: string): void {
    this.engine.undefine(name)
    this.definitions.delete(name)
    this.tableData.delete(name)
    this.subscribers.delete(name)

    try {
      this.pipeline.unregisterView(name)
    } catch {
      // View may not have been registered (non-incremental strategy)
    }
  }

  // ─── Change Handling ────────────────────────────────────────────────

  /**
   * Process a CDC data change and incrementally update affected computed tables.
   * Cascades updates through the dependency graph in topological order.
   *
   * @param change - The data change event from CDC
   * @returns Results of incremental updates for all affected tables
   */
  handleChange(change: DataChange): IncrementalUpdateResult[] {
    const start = performance.now()
    const affected = this.engine.getAffectedTables(change.table)
    const results: IncrementalUpdateResult[] = []

    // Build dependency graph for ordering
    const graph = this.engine.buildDependencyGraph()
    const ordered = graph.order.filter((t) => affected.includes(t))

    for (const tableName of ordered) {
      const def = this.definitions.get(tableName)
      if (!def) continue

      const strategy = def.refreshStrategy ?? "incremental"
      let pipelineResults: PipelineResult[] = []
      let usedDelta = false
      let rowsAffected = 0

      if (strategy === "incremental") {
        // Use IVM pipeline for delta computation
        pipelineResults = this.pipeline.processChange(change)
        const tableResult = pipelineResults.find((r) => r.viewId === tableName)

        if (tableResult && !tableResult.delta.requiresFullRefresh) {
          usedDelta = true
          rowsAffected = this.applyDelta(tableName, tableResult.delta)
        } else {
          // Fall back to full refresh
          rowsAffected = this.performFullRefresh(tableName)
        }
      } else {
        // Full refresh for non-incremental strategies
        rowsAffected = this.performFullRefresh(tableName)
      }

      const durationMs = Math.round((performance.now() - start) * 100) / 100

      // Record in the base engine
      this.engine.recordRefresh(tableName, rowsAffected, durationMs, change.table)

      // Find cascaded dependents
      const cascadedTo = this.engine.getAffectedTables(tableName).filter((t) => t !== tableName)

      const result: IncrementalUpdateResult = {
        tableName,
        usedDelta,
        rowsAffected,
        durationMs,
        pipelineResults,
        cascadedTo,
      }
      results.push(result)

      // Notify subscribers
      this.notifySubscribers(tableName, change, pipelineResults)
    }

    return results
  }

  // ─── Subscriptions ──────────────────────────────────────────────────

  /**
   * Subscribe to changes on a computed table.
   *
   * @param tableName - Name of the computed table to subscribe to
   * @param callback - Function called when the table changes
   * @returns A subscription handle with an unsubscribe method
   */
  subscribe(tableName: string, callback: ChangeCallback): ComputedTableSubscription {
    if (!this.definitions.has(tableName)) {
      throw new ComputedTableError(`Computed table "${tableName}" is not registered`)
    }

    const id = `sub_${++this.subscriptionCounter}`

    if (!this.subscribers.has(tableName)) {
      this.subscribers.set(tableName, new Map())
    }
    this.subscribers.get(tableName)!.set(id, callback)

    return {
      id,
      tableName,
      unsubscribe: () => {
        this.subscribers.get(tableName)?.delete(id)
      },
    }
  }

  // ─── State Access ───────────────────────────────────────────────────

  /**
   * Get the current state of a computed table.
   *
   * @param tableName - Name of the computed table
   * @returns The current table state or undefined if not registered
   */
  getState(tableName: string): ComputedTableState | undefined {
    return this.engine.getState(tableName)
  }

  /**
   * Get the current cached data for a computed table.
   *
   * @param tableName - Name of the computed table
   * @returns Current row data or undefined if not registered
   */
  getData(tableName: string): Row[] | undefined {
    return this.tableData.get(tableName)
  }

  /**
   * Get the underlying ComputedTableEngine for advanced use.
   */
  getEngine(): ComputedTableEngine {
    return this.engine
  }

  /**
   * Get the underlying IvmPipeline for advanced use.
   */
  getPipeline(): IvmPipeline {
    return this.pipeline
  }

  // ─── Refresh ────────────────────────────────────────────────────────

  /**
   * Force-refresh all computed tables in topological order.
   * Ensures dependent tables are refreshed after their sources.
   *
   * @returns Array of incremental update results for each table
   */
  refreshAll(): IncrementalUpdateResult[] {
    const graph = this.engine.buildDependencyGraph()
    const results: IncrementalUpdateResult[] = []

    if (graph.cycles.length > 0) {
      throw new ComputedTableError(
        `Cannot refresh: circular dependency detected: ${graph.cycles.map((c) => c.join(" → ")).join("; ")}`,
      )
    }

    // Process in dependency order (reversed so dependencies come first)
    const ordered = [...graph.order].reverse()

    for (const tableName of ordered) {
      const start = performance.now()
      const rowsAffected = this.performFullRefresh(tableName)
      const durationMs = Math.round((performance.now() - start) * 100) / 100

      this.engine.recordRefresh(tableName, rowsAffected, durationMs, "refreshAll")

      const cascadedTo = this.engine.getAffectedTables(tableName).filter((t) => t !== tableName)

      results.push({
        tableName,
        usedDelta: false,
        rowsAffected,
        durationMs,
        pipelineResults: [],
        cascadedTo,
      })

      // Notify subscribers of refresh
      this.notifySubscribers(tableName, null, [])
    }

    return results
  }

  // ─── Internal ──────────────────────────────────────────────────────

  private applyDelta(tableName: string, delta: ViewDelta): number {
    const data = this.tableData.get(tableName) ?? []

    // Apply deletes
    const deleteKeys = new Set(delta.deletes.map((r) => JSON.stringify(r)))
    const filtered = data.filter((r) => !deleteKeys.has(JSON.stringify(r)))

    // Apply updates
    for (const update of delta.updates) {
      const idx = filtered.findIndex((r) => JSON.stringify(r) === JSON.stringify(update.old))
      if (idx !== -1) {
        filtered[idx] = update.new
      }
    }

    // Apply inserts
    filtered.push(...delta.inserts)

    this.tableData.set(tableName, filtered)
    return delta.inserts.length + delta.deletes.length + delta.updates.length
  }

  private performFullRefresh(tableName: string): number {
    const data = this.tableData.get(tableName) ?? []
    // In a real implementation, this would execute the SQL query
    // and replace the cached data. Here we return current row count.
    return data.length
  }

  private notifySubscribers(
    tableName: string,
    triggeredBy: DataChange | null,
    pipelineResults: PipelineResult[],
  ): void {
    const subs = this.subscribers.get(tableName)
    if (!subs || subs.size === 0) return

    const tableResult = pipelineResults.find((r) => r.viewId === tableName)

    const event: ComputedTableChangeEvent = {
      tableName,
      type: tableResult ? (tableResult.usedDelta ? "incremental" : "refresh") : "refresh",
      inserts: tableResult?.delta.inserts ?? [],
      deletes: tableResult?.delta.deletes ?? [],
      updates: tableResult?.delta.updates ?? [],
      requiresFullRefresh: tableResult?.delta.requiresFullRefresh ?? true,
      timestamp: Date.now(),
      triggeredBy,
    }

    for (const callback of subs.values()) {
      try {
        callback(event)
      } catch {
        // Subscriber errors should not break the engine
      }
    }
  }
}

// ─── SQL Builders ────────────────────────────────────────────────────────────

/**
 * Build a parameterized SQL query for reading from a computed table.
 *
 * @param tableName - Name of the computed table
 * @param where - Optional WHERE conditions as column-value pairs
 * @param orderBy - Optional ORDER BY columns with direction
 * @returns Object with sql string and params array
 */
export function buildComputedTableQuerySQL(
  tableName: string,
  where?: Record<string, unknown>,
  orderBy?: Array<{ column: string; direction: "asc" | "desc" }>,
): { sql: string; params: unknown[] } {
  const safeName = sanitize(tableName)
  const parts: string[] = [`SELECT * FROM "${safeName}"`]
  const params: unknown[] = []

  if (where && Object.keys(where).length > 0) {
    const conditions: string[] = []
    let paramIdx = 1
    for (const [col, val] of Object.entries(where)) {
      conditions.push(`"${sanitize(col)}" = $${paramIdx}`)
      params.push(val)
      paramIdx++
    }
    parts.push(`WHERE ${conditions.join(" AND ")}`)
  }

  if (orderBy && orderBy.length > 0) {
    const orderClauses = orderBy.map((o) => `"${sanitize(o.column)}" ${o.direction === "desc" ? "DESC" : "ASC"}`)
    parts.push(`ORDER BY ${orderClauses.join(", ")}`)
  }

  return { sql: parts.join(" "), params }
}

/**
 * Build SQL to generate a refresh notification trigger for a reactive computed table.
 *
 * @param tableName - Name of the computed table
 * @param sources - Source tables that trigger reactive updates
 * @returns SQL string with trigger definitions for all sources
 */
export function buildReactiveRefreshTriggerSQL(tableName: string, sources: string[]): string {
  const safeName = sanitize(tableName)
  const statements: string[] = [`-- Reactive triggers for computed table: ${safeName}`]

  for (const source of sources) {
    const safeSource = sanitize(source)
    const funcName = `_rb_reactive_${safeName}_on_${safeSource}`

    statements.push(
      `CREATE OR REPLACE FUNCTION ${funcName}() RETURNS trigger AS $$`,
      `BEGIN`,
      `  PERFORM pg_notify('_reactivebase_computed_change', json_build_object(`,
      `    'table', '${safeName}',`,
      `    'source', '${safeSource}',`,
      `    'op', TG_OP`,
      `  )::text);`,
      `  RETURN NULL;`,
      `END;`,
      `$$ LANGUAGE plpgsql;`,
      ``,
      `DROP TRIGGER IF EXISTS "${funcName}_trg" ON "${safeSource}";`,
      `CREATE TRIGGER "${funcName}_trg"`,
      `  AFTER INSERT OR UPDATE OR DELETE ON "${safeSource}"`,
      `  FOR EACH STATEMENT`,
      `  EXECUTE FUNCTION ${funcName}();`,
      ``,
    )
  }

  return statements.join("\n")
}

// ─── Client Integration Helpers ──────────────────────────────────────────────

/**
 * Build a parameterized query for client-side consumption of a computed table.
 * Alias for buildComputedTableQuerySQL for client integration use.
 *
 * @param tableName - Name of the computed table to query
 * @param where - Optional WHERE conditions as column-value pairs
 * @param orderBy - Optional ORDER BY columns with direction
 * @returns Object with sql string and params array
 */
export function buildComputedTableQuery(
  tableName: string,
  where?: Record<string, unknown>,
  orderBy?: Array<{ column: string; direction: "asc" | "desc" }>,
): { sql: string; params: unknown[] } {
  return buildComputedTableQuerySQL(tableName, where, orderBy)
}

/**
 * Create a subscription object for real-time updates on a computed table.
 * Returns a subscription descriptor that can be used with the reactive engine.
 *
 * @param tableName - Name of the computed table to subscribe to
 * @param filter - Optional filter to narrow events
 * @returns A computed table subscription descriptor
 */
export function createComputedTableSubscription(
  tableName: string,
  filter?: SubscriptionFilter,
): { tableName: string; filter?: SubscriptionFilter; channel: string } {
  if (!tableName || tableName.trim() === "") {
    throw new ComputedTableError("Table name is required for subscription")
  }

  return {
    tableName,
    filter,
    channel: `_reactivebase_computed_change:${sanitize(tableName)}`,
  }
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "")
}
