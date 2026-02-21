/**
 * Schema diffing engine for ReactiveBase migrations.
 * Compares a schema definition against the actual database state
 * (via information_schema) and generates incremental ALTER TABLE SQL.
 */

import type { Schema } from "../schema/index.js"
import type { Validator } from "../schema/validators.js"

export interface DatabaseColumn {
  table: string
  column: string
  dataType: string
  isNullable: boolean
  defaultValue: string | null
}

export interface DatabaseIndex {
  table: string
  name: string
  columns: string[]
  unique: boolean
}

export interface DatabaseState {
  tables: string[]
  columns: DatabaseColumn[]
  indexes: DatabaseIndex[]
}

export interface SchemaDiff {
  addTables: string[]
  dropTables: string[]
  addColumns: Array<{ table: string; column: string; sql: string }>
  dropColumns: Array<{ table: string; column: string }>
  addIndexes: Array<{ table: string; name: string; sql: string }>
  dropIndexes: Array<{ table: string; name: string }>
  isDestructive: boolean
}

/**
 * Diff a schema definition against the current database state.
 */
export function diffSchema(schema: Schema, dbState: DatabaseState): SchemaDiff {
  const schemaTableNames = new Set(schema.tableNames)
  const dbTableNames = new Set(dbState.tables)

  const addTables: string[] = []
  const dropTables: string[] = []
  const addColumns: Array<{ table: string; column: string; sql: string }> = []
  const dropColumns: Array<{ table: string; column: string }> = []
  const addIndexes: Array<{ table: string; name: string; sql: string }> = []
  const dropIndexes: Array<{ table: string; name: string }> = []

  // New tables
  for (const tableName of schemaTableNames) {
    if (!dbTableNames.has(tableName)) {
      addTables.push(tableName)
    }
  }

  // Dropped tables
  for (const tableName of dbTableNames) {
    if (!schemaTableNames.has(tableName) && !tableName.startsWith("_")) {
      dropTables.push(tableName)
    }
  }

  // Column diffs for existing tables
  for (const tableName of schemaTableNames) {
    if (!dbTableNames.has(tableName)) continue // New table, handled above

    const table = schema.tables[tableName]
    const existingCols = new Set(
      dbState.columns
        .filter((c) => c.table === tableName)
        .map((c) => c.column),
    )
    const schemaCols = new Set(Object.keys(table.columns))

    // Add "id" to schema cols since it's auto-added
    schemaCols.add("id")

    // New columns
    for (const colName of Object.keys(table.columns)) {
      if (!existingCols.has(colName)) {
        const validator = table.columns[colName]
        const colSql = columnToAlterSQL(tableName, colName, validator)
        addColumns.push({ table: tableName, column: colName, sql: colSql })
      }
    }

    // Dropped columns
    for (const colName of existingCols) {
      if (colName === "id") continue
      if (!schemaCols.has(colName)) {
        dropColumns.push({ table: tableName, column: colName })
      }
    }

    // Index diffs
    const existingIndexes = new Set(
      dbState.indexes
        .filter((i) => i.table === tableName)
        .map((i) => i.name),
    )
    const schemaIndexNames = new Set(
      table.indexes.map((i) => `${tableName}_${i.name}`),
    )

    for (const index of table.indexes) {
      const indexName = `${tableName}_${index.name}`
      if (!existingIndexes.has(indexName)) {
        const indexSql = indexToSQL(tableName, index)
        addIndexes.push({ table: tableName, name: indexName, sql: indexSql })
      }
    }

    for (const indexName of existingIndexes) {
      if (!schemaIndexNames.has(indexName) && !indexName.endsWith("_pkey")) {
        dropIndexes.push({ table: tableName, name: indexName })
      }
    }
  }

  return {
    addTables,
    dropTables,
    addColumns,
    dropColumns,
    addIndexes,
    dropIndexes,
    isDestructive: dropTables.length > 0 || dropColumns.length > 0,
  }
}

/**
 * Generate migration SQL from a schema diff.
 */
export function generateDiffSQL(diff: SchemaDiff, schema: Schema): { up: string; down: string } {
  const upStatements: string[] = []
  const downStatements: string[] = []

  // Add tables (use full CREATE TABLE from schema)
  for (const tableName of diff.addTables) {
    const table = schema.tables[tableName]
    const lines = ['  id text PRIMARY KEY DEFAULT gen_random_uuid()']
    for (const [colName, validator] of Object.entries(table.columns)) {
      lines.push(`  ${columnDefSQL(colName, validator)}`)
    }
    upStatements.push(`CREATE TABLE IF NOT EXISTS "${tableName}" (\n${lines.join(",\n")}\n);`)
    downStatements.unshift(`DROP TABLE IF EXISTS "${tableName}" CASCADE;`)
  }

  // Add columns
  for (const col of diff.addColumns) {
    upStatements.push(col.sql)
    downStatements.unshift(`ALTER TABLE "${col.table}" DROP COLUMN IF EXISTS "${col.column}";`)
  }

  // Drop columns (destructive)
  for (const col of diff.dropColumns) {
    upStatements.push(`ALTER TABLE "${col.table}" DROP COLUMN IF EXISTS "${col.column}";`)
    // Can't reverse a column drop without knowing the original type
    downStatements.unshift(`-- Cannot reverse: DROP COLUMN "${col.column}" on "${col.table}"`)
  }

  // Add indexes
  for (const idx of diff.addIndexes) {
    upStatements.push(idx.sql)
    downStatements.unshift(`DROP INDEX IF EXISTS "${idx.name}";`)
  }

  // Drop indexes
  for (const idx of diff.dropIndexes) {
    upStatements.push(`DROP INDEX IF EXISTS "${idx.name}";`)
    downStatements.unshift(`-- Cannot reverse: DROP INDEX "${idx.name}" on "${idx.table}"`)
  }

  // Drop tables (destructive)
  for (const tableName of diff.dropTables) {
    upStatements.push(`DROP TABLE IF EXISTS "${tableName}" CASCADE;`)
    downStatements.unshift(`-- Cannot reverse: DROP TABLE "${tableName}"`)
  }

  return {
    up: upStatements.join("\n\n"),
    down: downStatements.join("\n\n"),
  }
}

/**
 * Query information_schema to get current database state.
 * Returns the SQL to execute — caller provides the query function.
 */
export function introspectionQueries(): {
  tablesSQL: string
  columnsSQL: string
  indexesSQL: string
} {
  return {
    tablesSQL: `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name NOT LIKE '\\_%'
      ORDER BY table_name
    `,
    columnsSQL: `
      SELECT table_name as "table", column_name as "column",
             data_type as "dataType",
             is_nullable = 'YES' as "isNullable",
             column_default as "defaultValue"
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `,
    indexesSQL: `
      SELECT t.relname as "table",
             i.relname as "name",
             array_agg(a.attname ORDER BY x.n) as "columns",
             ix.indisunique as "unique"
      FROM pg_index ix
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, n)
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
      WHERE n.nspname = 'public'
      GROUP BY t.relname, i.relname, ix.indisunique
      ORDER BY t.relname, i.relname
    `,
  }
}

function columnToAlterSQL(tableName: string, colName: string, validator: Validator): string {
  const actual = validator.type === "optional" && validator.innerValidator
    ? validator.innerValidator : validator
  const nullable = validator.isOptional ? "" : " NOT NULL"
  let def = ""
  if (validator.options.default === "now" || actual.options.default === "now") {
    def = " DEFAULT now()"
  } else if (validator.options.default !== undefined) {
    def = ` DEFAULT ${formatDefault(validator.options.default)}`
  }
  return `ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "${colName}" ${actual.pgType}${nullable}${def};`
}

function columnDefSQL(colName: string, validator: Validator): string {
  const actual = validator.type === "optional" && validator.innerValidator
    ? validator.innerValidator : validator
  const nullable = validator.isOptional ? "" : " NOT NULL"
  let def = ""
  if (validator.options.default === "now" || actual.options.default === "now") {
    def = " DEFAULT now()"
  } else if (validator.options.default !== undefined) {
    def = ` DEFAULT ${formatDefault(validator.options.default)}`
  }
  return `"${colName}" ${actual.pgType}${nullable}${def}`
}

function indexToSQL(tableName: string, index: { name: string; columns: string[]; unique: boolean; type?: string; opclass?: string }): string {
  const indexName = `${tableName}_${index.name}`
  if (index.type === "hnsw" || index.type === "ivfflat") {
    return `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" USING ${index.type} ("${index.columns[0]}" ${index.opclass ?? "vector_cosine_ops"});`
  }
  const uniqueStr = index.unique ? "UNIQUE " : ""
  const cols = index.columns.map((c) => `"${c}"`).join(", ")
  return `CREATE ${uniqueStr}INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" (${cols});`
}

function formatDefault(value: unknown): string {
  if (typeof value === "string") return `'${value}'`
  if (typeof value === "boolean") return value ? "true" : "false"
  return String(value)
}
