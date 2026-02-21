/**
 * SQL migration generator - diffs schema against database state.
 */

import type { Schema, SchemaDefinition } from "./schema.js"
import type { Validator } from "./validators.js"

export interface Migration {
  readonly version: string
  readonly name: string
  readonly up: string
  readonly down: string
  readonly timestamp: number
}

/**
 * Generate CREATE TABLE SQL from a schema definition.
 */
export function generateCreateTableSQL(
  tableName: string,
  columns: Record<string, Validator>,
): string {
  const lines: string[] = []

  // Always add id column
  lines.push("  id text PRIMARY KEY DEFAULT gen_random_uuid()")

  for (const [colName, validator] of Object.entries(columns)) {
    const pgCol = columnToSQL(colName, validator)
    lines.push(`  ${pgCol}`)
  }

  return `CREATE TABLE IF NOT EXISTS "${tableName}" (\n${lines.join(",\n")}\n);`
}

function columnToSQL(name: string, validator: Validator): string {
  const actualValidator = validator.type === "optional" && validator.innerValidator
    ? validator.innerValidator
    : validator
  const pgType = actualValidator.pgType
  const nullable = validator.isOptional ? "" : " NOT NULL"
  let defaultVal = ""

  if (validator.options.default === "now" || actualValidator.options.default === "now") {
    defaultVal = " DEFAULT now()"
  } else if (validator.options.default !== undefined) {
    defaultVal = ` DEFAULT ${formatDefault(validator.options.default)}`
  } else if (actualValidator.options.default !== undefined) {
    defaultVal = ` DEFAULT ${formatDefault(actualValidator.options.default)}`
  }

  // Enum check constraint
  let check = ""
  const enumValues = validator.enumValues ?? actualValidator.enumValues
  if (enumValues && enumValues.length > 0) {
    const vals = enumValues.map((v) => `'${v}'`).join(", ")
    check = ` CHECK ("${name}" IN (${vals}))`
  }

  return `"${name}" ${pgType}${nullable}${defaultVal}${check}`
}

function formatDefault(value: unknown): string {
  if (typeof value === "string") return `'${value}'`
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") return String(value)
  return String(value)
}

/**
 * Generate index SQL for a table.
 */
export function generateIndexSQL(
  tableName: string,
  indexName: string,
  columns: string[],
  unique: boolean,
): string {
  const uniqueStr = unique ? "UNIQUE " : ""
  const cols = columns.map((c) => `"${c}"`).join(", ")
  return `CREATE ${uniqueStr}INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" (${cols});`
}

/**
 * Generate full migration SQL for a schema.
 */
export function generateMigrationSQL(schema: Schema): Migration {
  const upStatements: string[] = []
  const downStatements: string[] = []

  for (const tableName of schema.tableNames) {
    const table = schema.tables[tableName]

    upStatements.push(generateCreateTableSQL(tableName, table.columns))

    for (const index of table.indexes) {
      upStatements.push(
        generateIndexSQL(tableName, `${tableName}_${index.name}`, index.columns, index.unique),
      )
    }

    downStatements.unshift(`DROP TABLE IF EXISTS "${tableName}" CASCADE;`)
  }

  // Add migrations tracking table
  upStatements.unshift(
    `CREATE TABLE IF NOT EXISTS "_reactivebase_migrations" (
  version text PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);`,
  )

  const timestamp = Date.now()
  const version = String(timestamp)

  return {
    version,
    name: "initial_schema",
    up: upStatements.join("\n\n"),
    down: downStatements.join("\n\n"),
    timestamp,
  }
}
