/**
 * Drizzle schema parser and ReactiveBase schema code generator.
 * Converts Drizzle table definitions to ReactiveBase defineSchema() calls.
 *
 * Parses Drizzle's pgTable() calls to extract column definitions.
 */

export interface DrizzleColumn {
  name: string
  type: string
  isNotNull: boolean
  hasDefault: boolean
  defaultValue?: string
  isPrimaryKey: boolean
  references?: string
}

export interface DrizzleTable {
  name: string
  variableName: string
  columns: DrizzleColumn[]
}

/**
 * Parse Drizzle schema source code to extract table definitions.
 * Uses regex-based parsing for the common patterns.
 */
export function parseDrizzleSchema(source: string): DrizzleTable[] {
  const tables: DrizzleTable[] = []

  // Match pgTable("tableName", { ... }) calls
  const tableRegex = /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*pgTable\(\s*["'](\w+)["']\s*,\s*\{([^}]+)\}/gs
  let match: RegExpExecArray | null

  while ((match = tableRegex.exec(source)) !== null) {
    const [, varName, tableName, columnsStr] = match
    const columns = parseDrizzleColumns(columnsStr)
    tables.push({ name: tableName, variableName: varName, columns })
  }

  return tables
}

function parseDrizzleColumns(columnsStr: string): DrizzleColumn[] {
  const columns: DrizzleColumn[] = []

  // Parse line by line for reliable matching
  const lines = columnsStr.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"))

  for (const line of lines) {
    const colMatch = line.match(/^(\w+)\s*:\s*(text|integer|boolean|timestamp|real|doublePrecision|serial|bigint|varchar|jsonb?|uuid)\s*\(/)
    if (!colMatch) continue

    const [, name, type] = colMatch
    columns.push({
      name,
      type,
      isNotNull: line.includes(".notNull()"),
      hasDefault: line.includes(".default(") || line.includes(".defaultNow()"),
      defaultValue: line.includes(".defaultNow()") ? "now" : undefined,
      isPrimaryKey: line.includes(".primaryKey()"),
      references: undefined,
    })
  }

  return columns
}

/**
 * Map Drizzle column type to ReactiveBase validator.
 */
function mapDrizzleType(col: DrizzleColumn): string {
  let validator: string

  switch (col.type) {
    case "text":
    case "varchar":
      validator = "v.string()"
      break
    case "integer":
    case "serial":
    case "bigint":
      validator = "v.integer()"
      break
    case "real":
    case "doublePrecision":
      validator = "v.number()"
      break
    case "boolean":
      validator = col.hasDefault ? `v.boolean({ default: ${col.defaultValue ?? "false"} })` : "v.boolean()"
      break
    case "timestamp":
      validator = col.defaultValue === "now" ? 'v.timestamp({ default: "now" })' : "v.timestamp()"
      break
    case "json":
    case "jsonb":
      validator = "v.json()"
      break
    case "uuid":
      validator = "v.string()"
      break
    default:
      validator = `v.string() /* Drizzle type: ${col.type} */`
  }

  if (!col.isNotNull && !col.isPrimaryKey) {
    validator = `v.optional(${validator})`
  }

  return validator
}

/**
 * Generate ReactiveBase schema code from Drizzle tables.
 */
export function generateReactiveBaseFromDrizzle(tables: DrizzleTable[]): string {
  const lines: string[] = []

  lines.push('import { defineSchema, defineTable, v } from "@reactivebase/server"')
  lines.push("")
  lines.push("export default defineSchema({")

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i]

    lines.push(`  ${table.name}: defineTable({`)

    for (const col of table.columns) {
      if (col.isPrimaryKey) continue // ReactiveBase auto-adds id
      const validator = mapDrizzleType(col)
      lines.push(`    ${col.name}: ${validator},`)
    }

    const trailing = i < tables.length - 1 ? ")," : "),"
    lines.push(`  }${trailing}`)
    lines.push("")
  }

  lines.push("})")
  lines.push("")

  return lines.join("\n")
}

/**
 * Convert Drizzle schema source to ReactiveBase schema code.
 */
export function convertDrizzleToReactiveBase(drizzleSource: string): string {
  const tables = parseDrizzleSchema(drizzleSource)
  return generateReactiveBaseFromDrizzle(tables)
}
