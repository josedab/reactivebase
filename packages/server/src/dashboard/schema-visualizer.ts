/**
 * Schema-to-visual model converter.
 * Transforms a ReactiveBase Schema into a visual model suitable for
 * rendering in a schema designer UI, and generates schema code from
 * a visual model.
 */

import type { Schema } from "../schema/index.js"
import type { Validator } from "../schema/validators.js"

// --- Visual Model ---

export interface SchemaVisualModel {
  tables: VisualTable[]
  relations: VisualRelation[]
}

export interface VisualTable {
  name: string
  columns: VisualColumn[]
  indexes: VisualIndex[]
  position?: { x: number; y: number }
}

export interface VisualColumn {
  name: string
  type: string
  pgType: string
  isOptional: boolean
  hasDefault: boolean
  defaultValue?: string
  isId: boolean
  referencedTable?: string
  dimensions?: number
}

export interface VisualIndex {
  name: string
  columns: string[]
  unique: boolean
  type?: string
}

export interface VisualRelation {
  name: string
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
  type: "belongs_to" | "has_many"
}

// --- Schema → Visual Model ---

/**
 * Convert a ReactiveBase Schema to a visual model.
 */
export function schemaToVisualModel(schema: Schema): SchemaVisualModel {
  const tables: VisualTable[] = []
  const relations: VisualRelation[] = []

  for (const tableName of schema.tableNames) {
    const table = schema.tables[tableName]

    const columns: VisualColumn[] = [
      { name: "id", type: "string", pgType: "text", isOptional: false, hasDefault: true, defaultValue: "gen_random_uuid()", isId: true },
    ]

    for (const [colName, validator] of Object.entries(table.columns)) {
      columns.push(validatorToVisualColumn(colName, validator))
    }

    const indexes: VisualIndex[] = table.indexes.map((idx) => ({
      name: idx.name,
      columns: idx.columns,
      unique: idx.unique,
      type: idx.type,
    }))

    tables.push({ name: tableName, columns, indexes })

    // Extract relations
    for (const rel of table.relations) {
      const toParts = rel.to.split(".")
      if (toParts.length === 2) {
        relations.push({
          name: rel.name,
          fromTable: tableName,
          fromColumn: rel.from,
          toTable: toParts[0],
          toColumn: toParts[1],
          type: "has_many",
        })
      } else {
        relations.push({
          name: rel.name,
          fromTable: tableName,
          fromColumn: rel.from,
          toTable: rel.to,
          toColumn: "id",
          type: "belongs_to",
        })
      }
    }
  }

  // Auto-layout tables in a grid
  const cols = Math.ceil(Math.sqrt(tables.length))
  for (let i = 0; i < tables.length; i++) {
    tables[i].position = {
      x: (i % cols) * 300,
      y: Math.floor(i / cols) * 250,
    }
  }

  return { tables, relations }
}

function validatorToVisualColumn(name: string, validator: Validator): VisualColumn {
  const actual = validator.type === "optional" && validator.innerValidator
    ? validator.innerValidator
    : validator

  return {
    name,
    type: actual.type,
    pgType: actual.pgType,
    isOptional: validator.isOptional,
    hasDefault: validator.options.default !== undefined,
    defaultValue: validator.options.default !== undefined ? String(validator.options.default) : undefined,
    isId: false,
    referencedTable: actual.referencedTable,
    dimensions: actual.dimensions,
  }
}

// --- Visual Model → Schema Code ---

/**
 * Generate ReactiveBase schema code from a visual model.
 */
export function visualModelToCode(model: SchemaVisualModel): string {
  const lines: string[] = []

  lines.push('import { defineSchema, defineTable, v } from "@reactivebase/server"')
  lines.push("")
  lines.push("export default defineSchema({")

  for (let i = 0; i < model.tables.length; i++) {
    const table = model.tables[i]
    lines.push(`  ${table.name}: defineTable({`)

    for (const col of table.columns) {
      if (col.isId) continue
      lines.push(`    ${col.name}: ${visualColumnToValidator(col)},`)
    }

    let chain = "  })"

    for (const idx of table.indexes) {
      const cols = idx.columns.map((c) => `"${c}"`).join(", ")
      if (idx.type === "hnsw" || idx.type === "ivfflat") {
        chain += `\n    .vectorIndex("${idx.name}", ${cols})`
      } else {
        const opts = idx.unique ? `, { unique: true }` : ""
        chain += `\n    .index("${idx.name}", [${cols}]${opts})`
      }
    }

    // Add relations for this table
    const tableRels = model.relations.filter((r) => r.fromTable === table.name)
    for (const rel of tableRels) {
      if (rel.type === "has_many") {
        chain += `\n    .relation("${rel.name}", { from: "${rel.fromColumn}", to: "${rel.toTable}.${rel.toColumn}" })`
      } else {
        chain += `\n    .relation("${rel.name}", { from: "${rel.fromColumn}", to: "${rel.toTable}" })`
      }
    }

    chain += ","
    lines.push(chain)
    lines.push("")
  }

  lines.push("})")
  lines.push("")

  return lines.join("\n")
}

function visualColumnToValidator(col: VisualColumn): string {
  let validator: string

  switch (col.type) {
    case "string":
      validator = col.referencedTable ? `v.id("${col.referencedTable}")` : "v.string()"
      break
    case "number":
      validator = "v.number()"
      break
    case "integer":
      validator = "v.integer()"
      break
    case "boolean":
      validator = col.hasDefault ? `v.boolean({ default: ${col.defaultValue} })` : "v.boolean()"
      break
    case "timestamp":
      validator = col.defaultValue === "now" ? 'v.timestamp({ default: "now" })' : "v.timestamp()"
      break
    case "json":
      validator = "v.json()"
      break
    case "vector":
      validator = `v.vector(${col.dimensions ?? 1536})`
      break
    case "id":
      validator = col.referencedTable ? `v.id("${col.referencedTable}")` : "v.string()"
      break
    case "enum":
      validator = "v.string()"
      break
    default:
      validator = "v.string()"
  }

  if (col.isOptional) {
    validator = `v.optional(${validator})`
  }

  return validator
}

// --- Dashboard HTML ---

/**
 * Generate a self-contained HTML page for the schema visualizer.
 */
export function generateDashboardHTML(model: SchemaVisualModel): string {
  const modelJson = JSON.stringify(model, null, 2)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ReactiveBase Schema</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; }
  .header { padding: 16px 24px; border-bottom: 1px solid #30363d; display: flex; align-items: center; gap: 12px; }
  .header h1 { font-size: 18px; font-weight: 600; }
  .header .badge { background: #238636; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; }
  .canvas { padding: 24px; display: flex; flex-wrap: wrap; gap: 24px; }
  .table-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; min-width: 260px; }
  .table-header { padding: 12px 16px; border-bottom: 1px solid #30363d; font-weight: 600; font-size: 14px; color: #58a6ff; }
  .column { padding: 6px 16px; font-size: 13px; display: flex; justify-content: space-between; border-bottom: 1px solid #21262d; }
  .column:last-child { border-bottom: none; }
  .column .name { color: #c9d1d9; }
  .column .type { color: #8b949e; font-family: monospace; font-size: 12px; }
  .column .pk { color: #f0883e; font-size: 10px; margin-right: 4px; }
  .column .fk { color: #a371f7; font-size: 10px; margin-right: 4px; }
  .column .opt { color: #8b949e; margin-left: 2px; }
  .indexes { padding: 8px 16px; border-top: 1px solid #30363d; }
  .indexes .idx { font-size: 11px; color: #8b949e; padding: 2px 0; }
  .relations { padding: 16px 24px; }
  .relation { font-size: 13px; color: #8b949e; padding: 4px 0; }
  .relation .arrow { color: #58a6ff; }
</style>
</head>
<body>
<div class="header">
  <h1>ReactiveBase</h1>
  <span class="badge">${model.tables.length} tables</span>
  <span class="badge">${model.relations.length} relations</span>
</div>
<div class="canvas">
${model.tables.map((t) => `
  <div class="table-card">
    <div class="table-header">${t.name}</div>
    ${t.columns.map((c) => `
    <div class="column">
      <span class="name">${c.isId ? '<span class="pk">PK</span>' : ""}${c.referencedTable ? '<span class="fk">FK</span>' : ""}${c.name}${c.isOptional ? '<span class="opt">?</span>' : ""}</span>
      <span class="type">${c.pgType}</span>
    </div>`).join("")}
    ${t.indexes.length > 0 ? `<div class="indexes">${t.indexes.map((idx) => `<div class="idx">${idx.unique ? "UNIQUE " : ""}INDEX ${idx.name} (${idx.columns.join(", ")})${idx.type ? " USING " + idx.type : ""}</div>`).join("")}</div>` : ""}
  </div>`).join("")}
</div>
${model.relations.length > 0 ? `
<div class="relations">
  <h3 style="margin-bottom: 8px; font-size: 14px;">Relations</h3>
  ${model.relations.map((r) => `
  <div class="relation">
    <span class="arrow">${r.type === "has_many" ? "⇉" : "→"}</span>
    ${r.fromTable}.${r.fromColumn} → ${r.toTable}.${r.toColumn}
    <em>(${r.name})</em>
  </div>`).join("")}
</div>` : ""}
<script>const schema = ${modelJson};</script>
</body>
</html>`
}
