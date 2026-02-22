/**
 * Admin Studio — Full-featured schema designer, data browser, and subscription
 * inspector for ReactiveBase. Builds on the admin panel with interactive
 * schema editing, live subscription monitoring, and migration preview.
 *
 * Features:
 *   - Schema designer with add/edit/remove table and column operations
 *   - Migration preview: see SQL diff before applying schema changes
 *   - Data browser API helpers: paginated queries with filters and sorting
 *   - Subscription inspector: live subscription stats and dependency graph
 *   - Metrics summary endpoint helpers
 *
 * Usage:
 *   const studio = new AdminStudio({ schema: myModel })
 *   studio.addTable("projects", [{ name: "name", type: "text" }])
 *   const diff = studio.previewMigration()
 */

import type { SchemaVisualModel, VisualTable, VisualColumn, VisualRelation } from "./schema-visualizer.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AdminStudioOptions {
  /** Enable schema editing (default: true) */
  enableEditing?: boolean
  /** Max rows per page in data browser (default: 50) */
  pageSize?: number
  /** Enable migration preview (default: true) */
  enableMigrationPreview?: boolean
}

export interface SchemaChange {
  type: "add-table" | "remove-table" | "add-column" | "remove-column" | "modify-column" | "add-index" | "remove-index"
  table: string
  column?: string
  details?: Record<string, unknown>
  timestamp: number
}

export interface MigrationPreview {
  upSQL: string[]
  downSQL: string[]
  warnings: string[]
  isDestructive: boolean
  affectedTables: string[]
}

export interface DataBrowserQuery {
  table: string
  page: number
  pageSize: number
  sortColumn?: string
  sortDirection?: "asc" | "desc"
  filters: DataBrowserFilterEntry[]
}

export interface DataBrowserFilterEntry {
  column: string
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "in" | "is_null" | "is_not_null"
  value?: string | number | boolean | null
}

export interface DataBrowserResponse {
  rows: Record<string, unknown>[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
}

export interface SubscriptionInspectorEntry {
  subscriptionId: string
  queryName: string
  args: unknown
  connectionId: string
  tables: string[]
  lastUpdated: number
  version: number
  resultSizeBytes: number
}

export interface StudioMetricsSummary {
  tables: number
  totalColumns: number
  totalRelations: number
  totalIndexes: number
  activeSubscriptions: number
  pendingChanges: number
  schemaChanges: SchemaChange[]
}

// ─── SQL Builders ────────────────────────────────────────────────────────────

export function buildDataBrowserSQL(query: DataBrowserQuery): { sql: string; params: unknown[] } {
  const params: unknown[] = []
  let paramIdx = 1
  const conditions: string[] = []

  for (const filter of query.filters) {
    const col = sanitizeIdentifier(filter.column)
    switch (filter.operator) {
      case "eq":
        conditions.push(`"${col}" = $${paramIdx++}`)
        params.push(filter.value)
        break
      case "neq":
        conditions.push(`"${col}" != $${paramIdx++}`)
        params.push(filter.value)
        break
      case "gt":
        conditions.push(`"${col}" > $${paramIdx++}`)
        params.push(filter.value)
        break
      case "gte":
        conditions.push(`"${col}" >= $${paramIdx++}`)
        params.push(filter.value)
        break
      case "lt":
        conditions.push(`"${col}" < $${paramIdx++}`)
        params.push(filter.value)
        break
      case "lte":
        conditions.push(`"${col}" <= $${paramIdx++}`)
        params.push(filter.value)
        break
      case "like":
        conditions.push(`"${col}" ILIKE $${paramIdx++}`)
        params.push(`%${filter.value}%`)
        break
      case "in":
        conditions.push(`"${col}" = ANY($${paramIdx++})`)
        params.push(Array.isArray(filter.value) ? filter.value : [filter.value])
        break
      case "is_null":
        conditions.push(`"${col}" IS NULL`)
        break
      case "is_not_null":
        conditions.push(`"${col}" IS NOT NULL`)
        break
    }
  }

  const tableName = sanitizeIdentifier(query.table)
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const sortCol = query.sortColumn ? sanitizeIdentifier(query.sortColumn) : "id"
  const sortDir = query.sortDirection === "desc" ? "DESC" : "ASC"
  const offset = (query.page - 1) * query.pageSize

  const sql = `SELECT * FROM "${tableName}" ${whereClause} ORDER BY "${sortCol}" ${sortDir} LIMIT ${query.pageSize} OFFSET ${offset}`
  return { sql, params }
}

export function buildCountSQL(table: string, filters: DataBrowserFilterEntry[]): { sql: string; params: unknown[] } {
  const params: unknown[] = []
  let paramIdx = 1
  const conditions: string[] = []

  for (const filter of filters) {
    const col = sanitizeIdentifier(filter.column)
    if (filter.operator === "is_null") {
      conditions.push(`"${col}" IS NULL`)
    } else if (filter.operator === "is_not_null") {
      conditions.push(`"${col}" IS NOT NULL`)
    } else {
      conditions.push(`"${col}" = $${paramIdx++}`)
      params.push(filter.value)
    }
  }

  const tableName = sanitizeIdentifier(table)
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  return { sql: `SELECT COUNT(*) as count FROM "${tableName}" ${whereClause}`, params }
}

function sanitizeIdentifier(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "")
}

// ─── Migration SQL Generation ────────────────────────────────────────────────

function generateAddTableSQL(table: VisualTable): string {
  const columns = table.columns.map((c) => {
    let def = `"${sanitizeIdentifier(c.name)}" ${mapColumnType(c.type)}`
    if (c.isId) def += " PRIMARY KEY"
    if (!c.isOptional && !c.isId) def += " NOT NULL"
    if (c.defaultValue !== undefined) def += ` DEFAULT ${c.defaultValue}`
    return def
  })
  return `CREATE TABLE "${sanitizeIdentifier(table.name)}" (\n  ${columns.join(",\n  ")}\n);`
}

function generateDropTableSQL(tableName: string): string {
  return `DROP TABLE IF EXISTS "${sanitizeIdentifier(tableName)}" CASCADE;`
}

function generateAddColumnSQL(table: string, column: VisualColumn): string {
  const col = sanitizeIdentifier(column.name)
  const tbl = sanitizeIdentifier(table)
  let def = `ALTER TABLE "${tbl}" ADD COLUMN "${col}" ${mapColumnType(column.type)}`
  if (!column.isOptional) def += " NOT NULL"
  if (column.defaultValue !== undefined) def += ` DEFAULT ${column.defaultValue}`
  return def + ";"
}

function generateDropColumnSQL(table: string, column: string): string {
  return `ALTER TABLE "${sanitizeIdentifier(table)}" DROP COLUMN IF EXISTS "${sanitizeIdentifier(column)}";`
}

function mapColumnType(type: string): string {
  const mapping: Record<string, string> = {
    string: "text",
    number: "double precision",
    integer: "integer",
    boolean: "boolean",
    timestamp: "timestamptz",
    json: "jsonb",
    id: "text",
    vector: "vector",
  }
  return mapping[type] ?? "text"
}

// ─── Admin Studio ────────────────────────────────────────────────────────────

const DEFAULT_STUDIO_OPTIONS: Required<AdminStudioOptions> = {
  enableEditing: true,
  pageSize: 50,
  enableMigrationPreview: true,
}

export class AdminStudio {
  private options: Required<AdminStudioOptions>
  private model: SchemaVisualModel
  private changes: SchemaChange[] = []

  constructor(model: SchemaVisualModel, options: AdminStudioOptions = {}) {
    this.options = { ...DEFAULT_STUDIO_OPTIONS, ...options }
    this.model = structuredClone(model)
  }

  get schema(): SchemaVisualModel {
    return this.model
  }

  get pendingChanges(): SchemaChange[] {
    return [...this.changes]
  }

  // ─── Schema Designer Operations ──────────────────────────────────────────

  addTable(name: string, columns: Omit<VisualColumn, "isId">[]): VisualTable {
    if (!this.options.enableEditing) throw new Error("Schema editing is disabled")
    if (this.model.tables.find((t) => t.name === name)) {
      throw new Error(`Table "${name}" already exists`)
    }

    const idColumn: VisualColumn = {
      name: "id",
      type: "id",
      pgType: "text",
      isId: true,
      isOptional: false,
      hasDefault: false,
    }

    const table: VisualTable = {
      name,
      columns: [idColumn, ...columns.map((c) => ({ ...c, isId: false, pgType: mapColumnType(c.type), hasDefault: false }))],
      indexes: [],
    }

    this.model.tables.push(table)
    this.changes.push({ type: "add-table", table: name, timestamp: Date.now() })

    return table
  }

  removeTable(name: string): void {
    if (!this.options.enableEditing) throw new Error("Schema editing is disabled")
    const idx = this.model.tables.findIndex((t) => t.name === name)
    if (idx === -1) throw new Error(`Table "${name}" not found`)

    this.model.tables.splice(idx, 1)
    // Remove related relations
    if (this.model.relations) {
      this.model.relations = this.model.relations.filter(
        (r) => r.fromTable !== name && r.toTable !== name,
      )
    }

    this.changes.push({ type: "remove-table", table: name, timestamp: Date.now() })
  }

  addColumn(tableName: string, column: Omit<VisualColumn, "isId">): void {
    if (!this.options.enableEditing) throw new Error("Schema editing is disabled")
    const table = this.model.tables.find((t) => t.name === tableName)
    if (!table) throw new Error(`Table "${tableName}" not found`)
    if (table.columns.find((c) => c.name === column.name)) {
      throw new Error(`Column "${column.name}" already exists in table "${tableName}"`)
    }

    table.columns.push({ ...column, isId: false, pgType: mapColumnType(column.type), hasDefault: false })
    this.changes.push({
      type: "add-column",
      table: tableName,
      column: column.name,
      details: { type: column.type, isOptional: column.isOptional },
      timestamp: Date.now(),
    })
  }

  removeColumn(tableName: string, columnName: string): void {
    if (!this.options.enableEditing) throw new Error("Schema editing is disabled")
    const table = this.model.tables.find((t) => t.name === tableName)
    if (!table) throw new Error(`Table "${tableName}" not found`)

    const col = table.columns.find((c) => c.name === columnName)
    if (!col) throw new Error(`Column "${columnName}" not found in table "${tableName}"`)
    if (col.isId) throw new Error("Cannot remove primary key column")

    table.columns = table.columns.filter((c) => c.name !== columnName)
    this.changes.push({
      type: "remove-column",
      table: tableName,
      column: columnName,
      timestamp: Date.now(),
    })
  }

  addRelation(fromTable: string, fromColumn: string, toTable: string): void {
    if (!this.model.relations) this.model.relations = []

    const relation: VisualRelation = {
      name: `${fromTable}_${fromColumn}_${toTable}`,
      fromTable,
      fromColumn,
      toTable,
      toColumn: "id",
      type: "belongs_to",
    }

    this.model.relations.push(relation)
  }

  // ─── Migration Preview ───────────────────────────────────────────────────

  previewMigration(): MigrationPreview {
    const upSQL: string[] = []
    const downSQL: string[] = []
    const warnings: string[] = []
    const affectedTables = new Set<string>()
    let isDestructive = false

    for (const change of this.changes) {
      affectedTables.add(change.table)

      switch (change.type) {
        case "add-table": {
          const table = this.model.tables.find((t) => t.name === change.table)
          if (table) {
            upSQL.push(generateAddTableSQL(table))
            downSQL.push(generateDropTableSQL(change.table))
          }
          break
        }
        case "remove-table": {
          isDestructive = true
          warnings.push(`Dropping table "${change.table}" will permanently delete all data`)
          upSQL.push(generateDropTableSQL(change.table))
          break
        }
        case "add-column": {
          const table = this.model.tables.find((t) => t.name === change.table)
          const col = table?.columns.find((c) => c.name === change.column)
          if (col) {
            upSQL.push(generateAddColumnSQL(change.table, col))
            downSQL.push(generateDropColumnSQL(change.table, change.column!))
          }
          break
        }
        case "remove-column": {
          isDestructive = true
          warnings.push(`Dropping column "${change.column}" from "${change.table}" will delete column data`)
          upSQL.push(generateDropColumnSQL(change.table, change.column!))
          break
        }
      }
    }

    return {
      upSQL,
      downSQL,
      warnings,
      isDestructive,
      affectedTables: Array.from(affectedTables),
    }
  }

  clearChanges(): void {
    this.changes = []
  }

  // ─── Data Browser Query Builder ──────────────────────────────────────────

  buildBrowseQuery(query: Omit<DataBrowserQuery, "pageSize"> & { pageSize?: number }): { sql: string; params: unknown[] } {
    return buildDataBrowserSQL({
      ...query,
      pageSize: query.pageSize ?? this.options.pageSize,
    })
  }

  buildCountQuery(table: string, filters: DataBrowserFilterEntry[] = []): { sql: string; params: unknown[] } {
    return buildCountSQL(table, filters)
  }

  // ─── Subscription Inspector ──────────────────────────────────────────────

  inspectSubscriptions(subscriptions: Array<{
    id: string
    queryName: string
    args: unknown
    connectionId: string
    dependencies: Array<{ table: string }>
    lastResult: unknown
    version: number
  }>): SubscriptionInspectorEntry[] {
    return subscriptions.map((sub) => ({
      subscriptionId: sub.id,
      queryName: sub.queryName,
      args: sub.args,
      connectionId: sub.connectionId,
      tables: sub.dependencies.map((d) => d.table),
      lastUpdated: Date.now(),
      version: sub.version,
      resultSizeBytes: JSON.stringify(sub.lastResult ?? null).length,
    }))
  }

  // ─── Metrics Summary ────────────────────────────────────────────────────

  getMetrics(activeSubscriptions: number = 0): StudioMetricsSummary {
    const totalColumns = this.model.tables.reduce((sum, t) => sum + t.columns.length, 0)
    const totalRelations = this.model.relations?.length ?? 0
    const totalIndexes = this.model.tables.reduce(
      (sum, t) => sum + (t.indexes?.length ?? 0),
      0,
    )

    return {
      tables: this.model.tables.length,
      totalColumns,
      totalRelations,
      totalIndexes,
      activeSubscriptions,
      pendingChanges: this.changes.length,
      schemaChanges: [...this.changes],
    }
  }
}
