/**
 * In-memory mock database for testing ReactiveBase server functions
 * without a real Postgres connection.
 */

import type { Schema } from "@reactivebase/server"

export interface MockRow {
  id: string
  [key: string]: unknown
}

/**
 * In-memory table storage with basic CRUD operations.
 */
class MockTable {
  private rows = new Map<string, MockRow>()
  private idCounter = 0

  insert(data: Record<string, unknown>): MockRow {
    const id = (data.id as string) ?? `mock_${++this.idCounter}_${Date.now().toString(36)}`
    const row: MockRow = { ...data, id }
    this.rows.set(id, row)
    return { ...row }
  }

  get(id: string): MockRow | null {
    const row = this.rows.get(id)
    return row ? { ...row } : null
  }

  update(id: string, data: Record<string, unknown>): MockRow {
    const existing = this.rows.get(id)
    if (!existing) throw new Error(`Row not found: ${id}`)
    const updated = { ...existing, ...data, id }
    this.rows.set(id, updated)
    return { ...updated }
  }

  delete(id: string): boolean {
    return this.rows.delete(id)
  }

  where(filters: Record<string, unknown>): MockRow[] {
    return Array.from(this.rows.values()).filter((row) => {
      for (const [key, value] of Object.entries(filters)) {
        if (row[key] !== value) return false
      }
      return true
    })
  }

  all(): MockRow[] {
    return Array.from(this.rows.values()).map((r) => ({ ...r }))
  }

  count(filters?: Record<string, unknown>): number {
    if (!filters) return this.rows.size
    return this.where(filters).length
  }

  clear(): void {
    this.rows.clear()
    this.idCounter = 0
  }
}

/**
 * Mock database context matching the TrackedDatabaseContext interface.
 * Tracks reads and writes for test assertions.
 */
export class MockDatabase {
  private tables = new Map<string, MockTable>()
  private readLog: Array<{ table: string; operation: string; filters?: Record<string, unknown> }> = []
  private writeLog: Array<{ table: string; operation: string; id?: string; data?: Record<string, unknown> }> = []

  constructor(private schema?: Schema) {
    if (schema) {
      for (const tableName of schema.tableNames) {
        this.tables.set(tableName, new MockTable())
      }
    }
  }

  /**
   * Get or create a table.
   */
  table(name: string): MockTable {
    if (!this.tables.has(name)) {
      this.tables.set(name, new MockTable())
    }
    return this.tables.get(name)!
  }

  /**
   * Seed data into a table.
   */
  seed(tableName: string, rows: Record<string, unknown>[]): MockRow[] {
    const table = this.table(tableName)
    return rows.map((row) => table.insert(row))
  }

  /**
   * Create a database context suitable for passing to server functions.
   */
  createContext(mode: "read" | "readwrite" = "readwrite"): MockDatabaseContext {
    const self = this
    const dependencies: Array<{ table: string; filters: Record<string, unknown> }> = []
    const modifiedTables: string[] = []

    const createTableAccessor = (tableName: string) => ({
      where(filtersOrCol: string | Record<string, unknown>, _op?: unknown, _val?: unknown) {
        const filters = typeof filtersOrCol === "object" ? filtersOrCol : {}
        self.readLog.push({ table: tableName, operation: "where", filters })
        dependencies.push({ table: tableName, filters })
        const rows = self.table(tableName).where(filters)
        // Return a mock query builder that resolves to rows
        return createMockQueryResult(rows)
      },
      async get(id: string) {
        self.readLog.push({ table: tableName, operation: "get" })
        dependencies.push({ table: tableName, filters: { id } })
        return self.table(tableName).get(id)
      },
      async getOrThrow(id: string) {
        const row = self.table(tableName).get(id)
        if (!row) throw new Error(`Not found: ${tableName}/${id}`)
        self.readLog.push({ table: tableName, operation: "getOrThrow" })
        dependencies.push({ table: tableName, filters: { id } })
        return row
      },
      async insert(data: Record<string, unknown>) {
        if (mode === "read") throw new Error("Cannot write in read-only mode")
        modifiedTables.push(tableName)
        self.writeLog.push({ table: tableName, operation: "insert", data })
        return self.table(tableName).insert(data)
      },
      async update(id: string, data: Record<string, unknown>) {
        if (mode === "read") throw new Error("Cannot write in read-only mode")
        modifiedTables.push(tableName)
        self.writeLog.push({ table: tableName, operation: "update", id, data })
        return self.table(tableName).update(id, data)
      },
      async delete(id: string) {
        if (mode === "read") throw new Error("Cannot write in read-only mode")
        modifiedTables.push(tableName)
        self.writeLog.push({ table: tableName, operation: "delete", id })
        if (!self.table(tableName).delete(id)) {
          throw new Error(`Not found: ${tableName}/${id}`)
        }
      },
      async count() {
        self.readLog.push({ table: tableName, operation: "count" })
        dependencies.push({ table: tableName, filters: {} })
        return self.table(tableName).count()
      },
    })

    const context: Record<string, unknown> = {
      getDependencies: () => [...dependencies],
      getModifiedTables: () => [...new Set(modifiedTables)],
      raw: async <T>(_sql: string, _params: unknown[] = []): Promise<T[]> => {
        return [] as T[]
      },
      fn: {
        count: (expr: string) => ({ as: (alias: string) => `COUNT(${expr}) as "${alias}"` }),
        sum: (expr: string) => ({ as: (alias: string) => `SUM(${expr}) as "${alias}"` }),
        avg: (expr: string) => ({ as: (alias: string) => `AVG(${expr}) as "${alias}"` }),
      },
    }

    // Create accessors for all known tables
    const tableNames = this.schema?.tableNames ?? Array.from(this.tables.keys())
    for (const tableName of tableNames) {
      context[tableName] = createTableAccessor(tableName)
    }

    // Use Proxy to auto-create accessors for unknown tables
    return new Proxy(context, {
      get: (target, prop: string) => {
        if (prop in target) return target[prop]
        if (typeof prop === "string" && !prop.startsWith("_")) {
          target[prop] = createTableAccessor(prop)
          return target[prop]
        }
        return undefined
      },
    }) as MockDatabaseContext
  }

  /** Get read log for assertions */
  getReadLog() {
    return [...this.readLog]
  }

  /** Get write log for assertions */
  getWriteLog() {
    return [...this.writeLog]
  }

  /** Clear all data and logs */
  reset(): void {
    for (const table of this.tables.values()) table.clear()
    this.readLog = []
    this.writeLog = []
  }
}

export interface MockDatabaseContext {
  getDependencies(): Array<{ table: string; filters: Record<string, unknown> }>
  getModifiedTables(): string[]
  raw<T>(sql: string, params?: unknown[]): Promise<T[]>
  fn: {
    count(expr: string): { as(alias: string): string }
    sum(expr: string): { as(alias: string): string }
    avg(expr: string): { as(alias: string): string }
  }
  [tableName: string]: unknown
}

function createMockQueryResult(rows: MockRow[]) {
  const result = rows as unknown
  // Add chainable methods that return the same rows
  const builder = {
    orderBy: () => builder,
    limit: (_n: number) => builder,
    offset: (_n: number) => builder,
    select: (..._cols: string[]) => builder,
    join: () => builder,
    groupBy: () => builder,
    include: () => builder,
    build: () => ({ sql: "", params: [], plan: {} }),
    getDependencies: () => [],
    // Make it thenable so `await` resolves to rows
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      return Promise.resolve(rows).then(resolve, reject)
    },
    // Spread as array
    [Symbol.iterator]: () => rows[Symbol.iterator](),
    length: rows.length,
    map: rows.map.bind(rows),
    filter: rows.filter.bind(rows),
  }
  return builder
}
