/**
 * Database context - provides typed access to tables through the query builder.
 * Tracks all table accesses for reactivity dependency tracking.
 */

import type { PoolClient } from "pg"
import { QueryBuilder, AggregateQueryBuilder, type QueryDependency, type BuiltQuery } from "../query-builder/index.js"
import type { Schema, SchemaDefinition } from "../schema/index.js"
import type { Validator, ComputedFieldFn } from "../schema/index.js"

export interface TableAccessor<TRow = Record<string, unknown>> {
  where(columnOrObject: string | Partial<TRow>, operatorOrValue?: unknown, value?: unknown): QueryBuilder<TRow>
  get(id: string): Promise<TRow | null>
  getOrThrow(id: string): Promise<TRow>
  insert(data: Partial<TRow>): Promise<TRow>
  update(id: string, data: Partial<TRow>): Promise<TRow>
  delete(id: string): Promise<void>
  count(): Promise<number>
  /** Create an aggregate query builder for this table. */
  aggregate(): AggregateQueryBuilder<TRow>
}

export interface DatabaseContext {
  raw<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>
  fn: {
    count(expr: string): { as(alias: string): string }
    sum(expr: string): { as(alias: string): string }
    avg(expr: string): { as(alias: string): string }
  }
  /** Access a table by name */
  [tableName: string]: TableAccessor | unknown
}

export interface TrackedDatabaseContext {
  raw<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>
  fn: {
    count(expr: string): { as(alias: string): string }
    sum(expr: string): { as(alias: string): string }
    avg(expr: string): { as(alias: string): string }
  }
  getDependencies(): QueryDependency[]
  getModifiedTables(): string[]
  [tableName: string]: unknown
}

/**
 * Create a database context bound to a Postgres client.
 * Tracks reads for dependency tracking and writes for invalidation.
 */
export function createDatabaseContext(
  client: PoolClient,
  schema: Schema,
  mode: "read" | "readwrite" = "readwrite",
): TrackedDatabaseContext {
  const dependencies: QueryDependency[] = []
  const modifiedTables: string[] = []

  const context: Record<string, unknown> = {
    getDependencies: () => [...dependencies],
    getModifiedTables: () => [...modifiedTables],
    raw: async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
      // Raw queries get table-level dependency tracking for all schema tables
      for (const tableName of schema.tableNames) {
        dependencies.push({ table: tableName, filters: {} })
      }
      const result = await client.query(sql, params)
      return result.rows as T[]
    },
    fn: {
      count: (expr: string) => ({
        as: (alias: string) => `COUNT(${expr}) as "${alias}"`,
      }),
      sum: (expr: string) => ({
        as: (alias: string) => `SUM(${expr}) as "${alias}"`,
      }),
      avg: (expr: string) => ({
        as: (alias: string) => `AVG(${expr}) as "${alias}"`,
      }),
    },
  }

  // Create typed table accessors for each table in the schema
  for (const tableName of schema.tableNames) {
    const accessor = createTableAccessor(client, tableName, dependencies, modifiedTables, mode, schema)
    context[tableName] = accessor
  }

  return context as TrackedDatabaseContext
}

function createTableAccessor(
  client: PoolClient,
  tableName: string,
  dependencies: QueryDependency[],
  modifiedTables: string[],
  mode: "read" | "readwrite",
  schema?: Schema,
): TableAccessor {
  // Collect virtual field definitions for this table
  const virtualFields = new Map<string, ComputedFieldFn>()
  if (schema) {
    const tableDef = schema.tables[tableName]
    if (tableDef) {
      for (const [colName, validator] of Object.entries(tableDef.columns)) {
        if (validator.type === "virtual" && validator.computeFn) {
          virtualFields.set(colName, validator.computeFn)
          // Track cross-table dependencies for reactivity
          if (validator.dependsOnTables) {
            for (const dep of validator.dependsOnTables) {
              dependencies.push({ table: dep, filters: {} })
            }
          }
        }
      }
    }
  }

  const applyVirtualFields = (rows: unknown[]): unknown[] => {
    if (virtualFields.size === 0) return rows
    return rows.map((row) => {
      const r = row as Record<string, unknown>
      const enriched = { ...r }
      for (const [field, fn] of virtualFields) {
        try {
          enriched[field] = fn(r)
        } catch {
          enriched[field] = undefined
        }
      }
      return enriched
    })
  }

  const executeQuery = async (builder: QueryBuilder): Promise<unknown[]> => {
    const built = builder.build()
    const queryDeps = builder.getDependencies()
    dependencies.push(...queryDeps)
    const result = await client.query(built.sql, built.params)
    return applyVirtualFields(result.rows)
  }

  const guardWrite = () => {
    if (mode === "read") {
      throw new Error(`Cannot perform write operations in a read-only query. Use a mutation instead.`)
    }
  }

  return {
    where(columnOrObject, operatorOrValue?, value?) {
      const builder = new QueryBuilder(tableName)
      return builder.where(columnOrObject as string, operatorOrValue, value)
    },

    async get(id: string) {
      const builder = new QueryBuilder(tableName).where({ id })
      const rows = await executeQuery(builder)
      return (rows[0] as Record<string, unknown>) ?? null
    },

    async getOrThrow(id: string) {
      const row = await this.get(id)
      if (!row) {
        throw new Error(`Record not found in "${tableName}" with id "${id}"`)
      }
      return row
    },

    async insert(data: Record<string, unknown>) {
      guardWrite()
      modifiedTables.push(tableName)

      const columns = Object.keys(data)
      const values = Object.values(data)
      const placeholders = values.map((_, i) => `$${i + 1}`)

      const sql = `INSERT INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(", ")})
VALUES (${placeholders.join(", ")})
RETURNING *`

      const result = await client.query(sql, values)
      return result.rows[0]
    },

    async update(id: string, data: Record<string, unknown>) {
      guardWrite()
      modifiedTables.push(tableName)

      const entries = Object.entries(data)
      const setClauses = entries.map(([col], i) => `"${col}" = $${i + 1}`)
      const values = entries.map(([, val]) => val)
      values.push(id)

      const sql = `UPDATE "${tableName}"
SET ${setClauses.join(", ")}
WHERE "id" = $${values.length}
RETURNING *`

      const result = await client.query(sql, values)
      if (result.rows.length === 0) {
        throw new Error(`Record not found in "${tableName}" with id "${id}"`)
      }
      return result.rows[0]
    },

    async delete(id: string) {
      guardWrite()
      modifiedTables.push(tableName)

      const result = await client.query(`DELETE FROM "${tableName}" WHERE "id" = $1`, [id])
      if (result.rowCount === 0) {
        throw new Error(`Record not found in "${tableName}" with id "${id}"`)
      }
    },

    async count() {
      dependencies.push({ table: tableName, filters: {} })
      const result = await client.query(`SELECT COUNT(*) as "count" FROM "${tableName}"`)
      return parseInt(result.rows[0].count, 10)
    },

    aggregate() {
      return new AggregateQueryBuilder(tableName)
    },
  } as TableAccessor
}
