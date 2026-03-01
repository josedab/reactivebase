/**
 * Reactive Computed Tables for ReactiveBase.
 * Automatically maintained derived tables that update when source data changes.
 *
 * Features:
 *   - Declarative computed table definitions with SQL expressions
 *   - Automatic dependency tracking between tables
 *   - Trigger-based incremental updates
 *   - Full refresh and incremental refresh strategies
 *   - Topological ordering for cascading updates
 *   - Built-in aggregation helpers (count, sum, avg, min, max)
 *
 * Usage:
 *   const engine = new ComputedTableEngine()
 *   engine.define({
 *     name: "order_stats",
 *     sourceTables: ["orders", "order_items"],
 *     query: `SELECT customer_id, COUNT(*) as total_orders, SUM(amount) as total_spent
 *             FROM orders GROUP BY customer_id`,
 *     refreshStrategy: "incremental",
 *   })
 *   const sql = engine.generateSQL("order_stats")
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ComputedTableDefinition {
  /** Unique name for the computed table */
  name: string
  /** Source tables this computed table depends on */
  sourceTables: string[]
  /** SQL query that produces the computed result */
  query: string
  /** Primary key columns for the computed table */
  primaryKey?: string[]
  /** Refresh strategy */
  refreshStrategy: RefreshStrategy
  /** Indexes to create on the computed table */
  indexes?: ComputedIndexDef[]
  /** Column definitions (inferred from query if not specified) */
  columns?: ComputedColumnDef[]
  /** Description for documentation */
  description?: string
  /** Debounce time in ms for trigger-based updates (default: 100) */
  debounceMs?: number
  /** Enable history tracking for the computed table */
  trackHistory?: boolean
}

export type RefreshStrategy =
  | "full" // Drop and recreate on any source change
  | "incremental" // Use triggers for row-level updates
  | "periodic" // Refresh on a schedule (cron-like)
  | "on-demand" // Manual refresh only

export interface ComputedIndexDef {
  columns: string[]
  unique?: boolean
  name?: string
}

export interface ComputedColumnDef {
  name: string
  type: string
  nullable?: boolean
}

export interface ComputedTableState {
  name: string
  status: "pending" | "building" | "ready" | "stale" | "error"
  lastRefresh: number | null
  refreshCount: number
  rowCount: number
  errorMessage: string | null
  dependsOn: string[]
  dependedBy: string[]
}

export interface DependencyGraph {
  tables: Map<string, Set<string>>
  order: string[]
  cycles: string[][]
}

export interface RefreshResult {
  table: string
  strategy: RefreshStrategy
  rowsAffected: number
  durationMs: number
  triggeredBy: string | null
}

export interface ComputedTableStats {
  totalTables: number
  byStatus: Record<string, number>
  byStrategy: Record<string, number>
  totalRefreshes: number
  averageRefreshMs: number
}

// ─── SQL Generation ──────────────────────────────────────────────────────────

export function buildCreateComputedTableSQL(def: ComputedTableDefinition): string {
  const statements: string[] = []

  // Create the computed table
  statements.push(`-- Computed table: ${def.name}`)
  statements.push(`CREATE TABLE IF NOT EXISTS "${def.name}" AS ${def.query};`)

  // Add primary key if specified
  if (def.primaryKey?.length) {
    const pkCols = def.primaryKey.map((c) => `"${sanitize(c)}"`).join(", ")
    statements.push(`ALTER TABLE "${def.name}" ADD PRIMARY KEY (${pkCols});`)
  }

  // Create indexes
  if (def.indexes) {
    for (const idx of def.indexes) {
      const idxName = idx.name ?? `idx_${def.name}_${idx.columns.join("_")}`
      const cols = idx.columns.map((c) => `"${sanitize(c)}"`).join(", ")
      const unique = idx.unique ? "UNIQUE " : ""
      statements.push(`CREATE ${unique}INDEX IF NOT EXISTS "${sanitize(idxName)}" ON "${def.name}" (${cols});`)
    }
  }

  return statements.join("\n")
}

export function buildRefreshComputedTableSQL(def: ComputedTableDefinition): string {
  if (def.refreshStrategy === "full") {
    return [`TRUNCATE TABLE "${def.name}";`, `INSERT INTO "${def.name}" ${def.query};`].join("\n")
  }

  // For incremental, use a MERGE/upsert pattern
  if (def.primaryKey?.length) {
    const pkMatch = def.primaryKey.map((col) => `target."${sanitize(col)}" = source."${sanitize(col)}"`).join(" AND ")

    return [
      `-- Incremental refresh for ${def.name}`,
      `WITH source AS (${def.query})`,
      `MERGE INTO "${def.name}" AS target`,
      `USING source ON ${pkMatch}`,
      `WHEN MATCHED THEN UPDATE SET`,
      `  ${def.primaryKey.map((c) => `"${sanitize(c)}" = source."${sanitize(c)}"`).join(", ")}`,
      `WHEN NOT MATCHED THEN INSERT`,
      `  SELECT * FROM source;`,
    ].join("\n")
  }

  // Fallback to full refresh for tables without PK
  return buildRefreshComputedTableSQL({ ...def, refreshStrategy: "full" })
}

export function buildDropComputedTableSQL(name: string): string {
  return `DROP TABLE IF EXISTS "${sanitize(name)}" CASCADE;`
}

export function buildCreateTriggerSQL(computedTable: string, sourceTable: string): string {
  const funcName = `_rb_refresh_${sanitize(computedTable)}_on_${sanitize(sourceTable)}`
  return [
    `CREATE OR REPLACE FUNCTION ${funcName}() RETURNS trigger AS $$`,
    `BEGIN`,
    `  PERFORM pg_notify('_reactivebase_computed', '${sanitize(computedTable)}');`,
    `  RETURN NULL;`,
    `END;`,
    `$$ LANGUAGE plpgsql;`,
    ``,
    `DROP TRIGGER IF EXISTS "${funcName}_trg" ON "${sanitize(sourceTable)}";`,
    `CREATE TRIGGER "${funcName}_trg"`,
    `  AFTER INSERT OR UPDATE OR DELETE ON "${sanitize(sourceTable)}"`,
    `  FOR EACH STATEMENT`,
    `  EXECUTE FUNCTION ${funcName}();`,
  ].join("\n")
}

export function buildCreateMetadataTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_computed_tables (
  name TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  source_tables TEXT[] NOT NULL DEFAULT '{}',
  primary_key TEXT[] NOT NULL DEFAULT '{}',
  refresh_strategy TEXT NOT NULL DEFAULT 'full',
  status TEXT NOT NULL DEFAULT 'pending',
  last_refresh TIMESTAMPTZ,
  refresh_count INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  debounce_ms INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`.trim()
}

export function buildUpsertMetadataSQL(def: ComputedTableDefinition): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_computed_tables (name, query, source_tables, primary_key, refresh_strategy, debounce_ms)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (name) DO UPDATE SET
        query = $2, source_tables = $3, primary_key = $4, refresh_strategy = $5, debounce_ms = $6, updated_at = NOW()`,
    params: [def.name, def.query, def.sourceTables, def.primaryKey ?? [], def.refreshStrategy, def.debounceMs ?? 100],
  }
}

// ─── Computed Table Engine ───────────────────────────────────────────────────

export class ComputedTableEngine {
  private definitions = new Map<string, ComputedTableDefinition>()
  private states = new Map<string, ComputedTableState>()
  private refreshHistory: RefreshResult[] = []

  /**
   * Define a new computed table.
   */
  define(definition: ComputedTableDefinition): void {
    if (!definition.name || definition.name.trim() === "") {
      throw new ComputedTableError("Computed table name is required")
    }
    if (!definition.sourceTables || definition.sourceTables.length === 0) {
      throw new ComputedTableError(`Computed table "${definition.name}" requires at least one source table`)
    }
    if (!definition.query || definition.query.trim() === "") {
      throw new ComputedTableError(`Computed table "${definition.name}" requires a query`)
    }

    this.definitions.set(definition.name, definition)
    this.states.set(definition.name, {
      name: definition.name,
      status: "pending",
      lastRefresh: null,
      refreshCount: 0,
      rowCount: 0,
      errorMessage: null,
      dependsOn: definition.sourceTables,
      dependedBy: [],
    })

    // Update reverse dependencies
    this.updateReverseDependencies()
  }

  /**
   * Remove a computed table definition.
   */
  undefine(name: string): void {
    this.definitions.delete(name)
    this.states.delete(name)
    this.updateReverseDependencies()
  }

  /**
   * Get a computed table definition.
   */
  getDefinition(name: string): ComputedTableDefinition | undefined {
    return this.definitions.get(name)
  }

  /**
   * Get all definitions.
   */
  listDefinitions(): ComputedTableDefinition[] {
    return [...this.definitions.values()]
  }

  /**
   * Get the state of a computed table.
   */
  getState(name: string): ComputedTableState | undefined {
    return this.states.get(name)
  }

  /**
   * Build the dependency graph and return topological order.
   */
  buildDependencyGraph(): DependencyGraph {
    const tables = new Map<string, Set<string>>()
    const cycles: string[][] = []

    for (const [name, def] of this.definitions) {
      const deps = new Set<string>()
      for (const src of def.sourceTables) {
        if (this.definitions.has(src)) {
          deps.add(src)
        }
      }
      tables.set(name, deps)
    }

    // Topological sort using Kahn's algorithm
    const inDegree = new Map<string, number>()
    for (const name of tables.keys()) {
      inDegree.set(name, 0)
    }
    for (const deps of tables.values()) {
      for (const dep of deps) {
        inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1)
      }
    }

    const queue: string[] = []
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name)
    }

    const order: string[] = []
    while (queue.length > 0) {
      const node = queue.shift()!
      order.push(node)
      const deps = tables.get(node) ?? new Set()
      for (const dep of deps) {
        const newDegree = (inDegree.get(dep) ?? 1) - 1
        inDegree.set(dep, newDegree)
        if (newDegree === 0) queue.push(dep)
      }
    }

    // Detect cycles
    if (order.length < tables.size) {
      const remaining = [...tables.keys()].filter((n) => !order.includes(n))
      cycles.push(remaining)
    }

    return { tables, order, cycles }
  }

  /**
   * Generate all SQL needed to set up a computed table (create, triggers, metadata).
   */
  generateSQL(name: string): string {
    const def = this.definitions.get(name)
    if (!def) throw new ComputedTableError(`Computed table "${name}" not defined`)

    const parts: string[] = [
      `-- ═══ Computed Table: ${name} ═══`,
      `-- Strategy: ${def.refreshStrategy}`,
      `-- Sources: ${def.sourceTables.join(", ")}`,
      "",
      buildCreateComputedTableSQL(def),
    ]

    // Generate triggers for incremental strategy
    if (def.refreshStrategy === "incremental" || def.refreshStrategy === "full") {
      parts.push("")
      parts.push("-- Refresh triggers")
      for (const source of def.sourceTables) {
        if (!this.definitions.has(source)) {
          parts.push(buildCreateTriggerSQL(name, source))
        }
      }
    }

    return parts.join("\n")
  }

  /**
   * Generate SQL for all computed tables in dependency order.
   */
  generateAllSQL(): string {
    const graph = this.buildDependencyGraph()

    if (graph.cycles.length > 0) {
      throw new ComputedTableError(`Circular dependency detected: ${graph.cycles.map((c) => c.join(" → ")).join("; ")}`)
    }

    const parts: string[] = [
      "-- ReactiveBase Computed Tables",
      "-- Generated automatically - do not edit",
      "",
      buildCreateMetadataTableSQL(),
      "",
    ]

    // Process in dependency order (reversed so dependencies come first)
    const ordered = [...graph.order].reverse()
    for (const name of ordered) {
      parts.push(this.generateSQL(name))
      parts.push("")
    }

    return parts.join("\n")
  }

  /**
   * Simulate a refresh and record the result.
   */
  recordRefresh(name: string, rowsAffected: number, durationMs: number, triggeredBy?: string): RefreshResult {
    const def = this.definitions.get(name)
    if (!def) throw new ComputedTableError(`Computed table "${name}" not defined`)

    const state = this.states.get(name)!
    state.status = "ready"
    state.lastRefresh = Date.now()
    state.refreshCount++
    state.rowCount = rowsAffected
    state.errorMessage = null

    const result: RefreshResult = {
      table: name,
      strategy: def.refreshStrategy,
      rowsAffected,
      durationMs,
      triggeredBy: triggeredBy ?? null,
    }

    this.refreshHistory.push(result)
    if (this.refreshHistory.length > 1000) this.refreshHistory.shift()

    return result
  }

  /**
   * Mark a computed table as having an error.
   */
  recordError(name: string, error: string): void {
    const state = this.states.get(name)
    if (state) {
      state.status = "error"
      state.errorMessage = error
    }
  }

  /**
   * Determine which computed tables need refresh based on a source table change.
   */
  getAffectedTables(sourceTable: string): string[] {
    const affected: string[] = []
    const visited = new Set<string>()

    const visit = (table: string): void => {
      if (visited.has(table)) return
      visited.add(table)

      for (const [name, def] of this.definitions) {
        if (def.sourceTables.includes(table) && !visited.has(name)) {
          affected.push(name)
          visit(name)
        }
      }
    }

    visit(sourceTable)
    return affected
  }

  /**
   * Get engine statistics.
   */
  getStats(): ComputedTableStats {
    const states = [...this.states.values()]
    const byStatus: Record<string, number> = {}
    const byStrategy: Record<string, number> = {}

    for (const def of this.definitions.values()) {
      byStrategy[def.refreshStrategy] = (byStrategy[def.refreshStrategy] ?? 0) + 1
    }
    for (const state of states) {
      byStatus[state.status] = (byStatus[state.status] ?? 0) + 1
    }

    const totalMs = this.refreshHistory.reduce((s, r) => s + r.durationMs, 0)

    return {
      totalTables: this.definitions.size,
      byStatus,
      byStrategy,
      totalRefreshes: this.refreshHistory.length,
      averageRefreshMs: this.refreshHistory.length > 0 ? totalMs / this.refreshHistory.length : 0,
    }
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private updateReverseDependencies(): void {
    // Clear all reverse deps
    for (const state of this.states.values()) {
      state.dependedBy = []
    }

    // Rebuild
    for (const [name, def] of this.definitions) {
      for (const src of def.sourceTables) {
        const srcState = this.states.get(src)
        if (srcState) {
          srcState.dependedBy.push(name)
        }
      }
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Helper to define a computed aggregation table.
 */
export function defineComputedAggregation(config: {
  name: string
  sourceTable: string
  groupBy: string[]
  aggregations: Record<string, string>
  primaryKey?: string[]
}): ComputedTableDefinition {
  const groupByClause = config.groupBy.map((c) => `"${sanitize(c)}"`).join(", ")
  const selectCols = [
    ...config.groupBy.map((c) => `"${sanitize(c)}"`),
    ...Object.entries(config.aggregations).map(([alias, expr]) => `${expr} AS "${sanitize(alias)}"`),
  ]

  return {
    name: config.name,
    sourceTables: [config.sourceTable],
    query: `SELECT ${selectCols.join(", ")} FROM "${sanitize(config.sourceTable)}" GROUP BY ${groupByClause}`,
    primaryKey: config.primaryKey ?? config.groupBy,
    refreshStrategy: "incremental",
  }
}

/**
 * Helper to define a computed join table.
 */
export function defineComputedJoin(config: {
  name: string
  sourceTables: string[]
  joinSQL: string
  selectColumns: string[]
  primaryKey?: string[]
}): ComputedTableDefinition {
  return {
    name: config.name,
    sourceTables: config.sourceTables,
    query: `SELECT ${config.selectColumns.join(", ")} FROM ${config.joinSQL}`,
    primaryKey: config.primaryKey,
    refreshStrategy: "incremental",
  }
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "")
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class ComputedTableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ComputedTableError"
  }
}
