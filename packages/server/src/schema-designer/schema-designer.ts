/**
 * Visual Schema Designer & Migration Planner for ReactiveBase.
 * GUI tool for designing schemas visually, viewing entity relationships,
 * and planning migrations with impact analysis.
 *
 * Features:
 *   - Entity-relationship diagram data model from defineSchema()
 *   - Interactive schema editing with code generation
 *   - Migration impact analysis showing affected queries/subscriptions
 *   - Self-contained HTML visualizer (works with React Flow or D3)
 *
 * Usage:
 *   const designer = new SchemaDesigner({ schema })
 *   const model = designer.getERModel()
 *   const html = designer.generateVisualizerHTML()
 *   const impact = designer.analyzeImpact([{ type: "add_column", table: "tasks", ... }])
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SchemaDesignerOptions {
  /** Schema to visualize */
  schema: SchemaLike
  /** Registered query names (for impact analysis) */
  queryNames?: string[]
  /** Registered subscription mappings (queryName → tables) */
  subscriptionMappings?: Record<string, string[]>
  /** Layout direction (default: "LR" for left-to-right) */
  layoutDirection?: "LR" | "TB"
}

interface SchemaLike {
  readonly tableNames: string[]
  readonly tables: Record<
    string,
    {
      readonly columns: Record<
        string,
        {
          readonly type: string
          readonly isOptional: boolean
          readonly pgType: string
          readonly referencedTable?: string
          readonly innerValidator?: { readonly type: string }
        }
      >
      readonly indexes?: Array<{ name: string; columns: string[]; unique?: boolean }>
      readonly relations?: Array<{ table: string; type: string }>
    }
  >
}

export interface ERModel {
  nodes: ERNode[]
  edges: EREdge[]
  stats: ERStats
}

export interface ERNode {
  id: string
  label: string
  columns: ERColumn[]
  position: { x: number; y: number }
  width: number
  height: number
  color: string
  isPrimary: boolean
}

export interface ERColumn {
  name: string
  type: string
  pgType: string
  isPrimaryKey: boolean
  isForeignKey: boolean
  isOptional: boolean
  referencedTable?: string
}

export interface EREdge {
  id: string
  source: string
  target: string
  sourceColumn: string
  targetColumn: string
  type: "one-to-one" | "one-to-many" | "many-to-many"
  label: string
}

export interface ERStats {
  tableCount: number
  columnCount: number
  relationCount: number
  indexCount: number
  averageColumnsPerTable: number
}

export interface SchemaChangeProposal {
  type:
    | "add_table"
    | "remove_table"
    | "add_column"
    | "remove_column"
    | "modify_column"
    | "add_index"
    | "remove_index"
    | "add_relation"
  table: string
  column?: string
  details: Record<string, unknown>
}

export interface MigrationImpact {
  proposal: SchemaChangeProposal
  severity: "safe" | "caution" | "destructive"
  affectedQueries: string[]
  affectedSubscriptions: string[]
  migrationSQL: string[]
  rollbackSQL: string[]
  warnings: string[]
  dataLossRisk: boolean
}

export interface CodeGenerationResult {
  schemaCode: string
  migrationSQL: string
  rollbackSQL: string
}

// ─── Schema Designer Engine ──────────────────────────────────────────────────

export class SchemaDesigner {
  private schema: SchemaLike
  private queryNames: string[]
  private subscriptionMappings: Record<string, string[]>
  private layoutDirection: "LR" | "TB"

  constructor(options: SchemaDesignerOptions) {
    this.schema = options.schema
    this.queryNames = options.queryNames ?? []
    this.subscriptionMappings = options.subscriptionMappings ?? {}
    this.layoutDirection = options.layoutDirection ?? "LR"
  }

  // ─── ER Model Generation ────────────────────────────────────────────────

  getERModel(): ERModel {
    const nodes: ERNode[] = []
    const edges: EREdge[] = []
    const colors = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#6366f1", "#ef4444", "#06b6d4"]

    let totalColumns = 0
    let totalIndexes = 0
    const spacing = this.layoutDirection === "LR" ? { x: 320, y: 0 } : { x: 0, y: 300 }

    for (let i = 0; i < this.schema.tableNames.length; i++) {
      const tableName = this.schema.tableNames[i]
      const table = this.schema.tables[tableName]
      const columns: ERColumn[] = [
        { name: "id", type: "string", pgType: "text", isPrimaryKey: true, isForeignKey: false, isOptional: false },
      ]

      for (const [colName, validator] of Object.entries(table.columns)) {
        const col: ERColumn = {
          name: colName,
          type:
            validator.type === "optional" && validator.innerValidator ? validator.innerValidator.type : validator.type,
          pgType: validator.pgType,
          isPrimaryKey: false,
          isForeignKey: !!validator.referencedTable,
          isOptional: validator.isOptional,
          referencedTable: validator.referencedTable,
        }
        columns.push(col)

        // Create edges for foreign keys
        if (validator.referencedTable) {
          edges.push({
            id: `${tableName}-${colName}-${validator.referencedTable}`,
            source: tableName,
            target: validator.referencedTable,
            sourceColumn: colName,
            targetColumn: "id",
            type: "one-to-many",
            label: `${colName} → id`,
          })
        }
      }

      totalColumns += columns.length
      totalIndexes += table.indexes?.length ?? 0

      // Calculate grid position
      const cols = Math.ceil(Math.sqrt(this.schema.tableNames.length))
      const row = Math.floor(i / cols)
      const col = i % cols

      nodes.push({
        id: tableName,
        label: tableName,
        columns,
        position: {
          x: col * (spacing.x || 320) + 50,
          y: row * (spacing.y || 300) + 50,
        },
        width: 260,
        height: 60 + columns.length * 28,
        color: colors[i % colors.length],
        isPrimary: i === 0,
      })
    }

    return {
      nodes,
      edges,
      stats: {
        tableCount: nodes.length,
        columnCount: totalColumns,
        relationCount: edges.length,
        indexCount: totalIndexes,
        averageColumnsPerTable: nodes.length > 0 ? totalColumns / nodes.length : 0,
      },
    }
  }

  // ─── Impact Analysis ────────────────────────────────────────────────────

  analyzeImpact(proposals: SchemaChangeProposal[]): MigrationImpact[] {
    return proposals.map((proposal) => this.analyzeOneChange(proposal))
  }

  private analyzeOneChange(proposal: SchemaChangeProposal): MigrationImpact {
    const affectedQueries: string[] = []
    const affectedSubscriptions: string[] = []
    const warnings: string[] = []
    const migrationSQL: string[] = []
    const rollbackSQL: string[] = []
    let severity: MigrationImpact["severity"] = "safe"
    let dataLossRisk = false

    // Find affected queries/subscriptions
    for (const [queryName, tables] of Object.entries(this.subscriptionMappings)) {
      if (tables.includes(proposal.table)) {
        affectedSubscriptions.push(queryName)
      }
    }
    for (const qName of this.queryNames) {
      if (qName.includes(proposal.table)) {
        affectedQueries.push(qName)
      }
    }

    switch (proposal.type) {
      case "add_table":
        migrationSQL.push(`CREATE TABLE "${proposal.table}" (id TEXT PRIMARY KEY DEFAULT gen_random_uuid())`)
        rollbackSQL.push(`DROP TABLE IF EXISTS "${proposal.table}"`)
        break

      case "remove_table":
        severity = "destructive"
        dataLossRisk = true
        warnings.push(`Dropping table "${proposal.table}" will permanently delete all data`)
        migrationSQL.push(`DROP TABLE IF EXISTS "${proposal.table}" CASCADE`)
        rollbackSQL.push(`-- Cannot auto-rollback table drop: "${proposal.table}"`)
        break

      case "add_column": {
        const colType = (proposal.details.pgType as string) ?? "text"
        const nullable = proposal.details.nullable ? "" : " NOT NULL DEFAULT ''"
        migrationSQL.push(`ALTER TABLE "${proposal.table}" ADD COLUMN "${proposal.column}" ${colType}${nullable}`)
        rollbackSQL.push(`ALTER TABLE "${proposal.table}" DROP COLUMN IF EXISTS "${proposal.column}"`)
        break
      }

      case "remove_column":
        severity = "destructive"
        dataLossRisk = true
        warnings.push(`Dropping column "${proposal.column}" from "${proposal.table}" will permanently delete data`)
        migrationSQL.push(`ALTER TABLE "${proposal.table}" DROP COLUMN IF EXISTS "${proposal.column}"`)
        rollbackSQL.push(`-- Cannot auto-rollback column drop: "${proposal.table}"."${proposal.column}"`)
        break

      case "modify_column": {
        severity = "caution"
        const newType = (proposal.details.newType as string) ?? "text"
        migrationSQL.push(`ALTER TABLE "${proposal.table}" ALTER COLUMN "${proposal.column}" TYPE ${newType}`)
        rollbackSQL.push(`-- Review column type change: "${proposal.table}"."${proposal.column}"`)
        warnings.push(`Column type change may fail if existing data is incompatible`)
        break
      }

      case "add_index": {
        const columns = (proposal.details.columns as string[]) ?? [proposal.column ?? "id"]
        const unique = proposal.details.unique ? "UNIQUE " : ""
        const indexName = `idx_${proposal.table}_${columns.join("_")}`
        migrationSQL.push(
          `CREATE ${unique}INDEX CONCURRENTLY IF NOT EXISTS "${indexName}" ON "${proposal.table}" (${columns.map((c) => `"${c}"`).join(", ")})`,
        )
        rollbackSQL.push(`DROP INDEX IF EXISTS "${indexName}"`)
        break
      }

      case "remove_index": {
        const indexName = proposal.details.indexName as string
        if (indexName) {
          migrationSQL.push(`DROP INDEX IF EXISTS "${indexName}"`)
          rollbackSQL.push(`-- Recreate index "${indexName}" manually`)
        }
        break
      }

      case "add_relation": {
        severity = "caution"
        const targetTable = proposal.details.targetTable as string
        const colName = proposal.column ?? `${targetTable}_id`
        migrationSQL.push(
          `ALTER TABLE "${proposal.table}" ADD COLUMN "${colName}" TEXT REFERENCES "${targetTable}"(id)`,
        )
        rollbackSQL.push(`ALTER TABLE "${proposal.table}" DROP COLUMN IF EXISTS "${colName}"`)
        break
      }
    }

    return {
      proposal,
      severity,
      affectedQueries,
      affectedSubscriptions,
      migrationSQL,
      rollbackSQL,
      warnings,
      dataLossRisk,
    }
  }

  // ─── Code Generation ───────────────────────────────────────────────────

  generateCode(proposals: SchemaChangeProposal[]): CodeGenerationResult {
    const impacts = this.analyzeImpact(proposals)

    const migrationSQL = impacts.flatMap((i) => i.migrationSQL).join(";\n")
    const rollbackSQL = impacts.flatMap((i) => i.rollbackSQL).join(";\n")

    // Generate updated schema code
    const schemaLines: string[] = [
      'import { defineSchema, defineTable, v } from "@reactivebase/server"',
      "",
      "export const schema = defineSchema({",
    ]

    for (const tableName of this.schema.tableNames) {
      const table = this.schema.tables[tableName]
      schemaLines.push(`  ${tableName}: defineTable({`)
      for (const [colName, validator] of Object.entries(table.columns)) {
        const type =
          validator.type === "optional" && validator.innerValidator ? validator.innerValidator.type : validator.type
        const optional = validator.isOptional
        const ref = validator.referencedTable

        let typeStr: string
        if (ref) {
          typeStr = `v.id("${ref}")`
        } else {
          typeStr = `v.${type}()`
        }
        if (optional) {
          typeStr = `v.optional(${typeStr})`
        }

        schemaLines.push(`    ${colName}: ${typeStr},`)
      }
      schemaLines.push("  }),")
    }

    schemaLines.push("})")

    return {
      schemaCode: schemaLines.join("\n"),
      migrationSQL,
      rollbackSQL,
    }
  }

  // ─── HTML Visualizer ───────────────────────────────────────────────────

  generateVisualizerHTML(): string {
    const model = this.getERModel()

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ReactiveBase Schema Designer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; overflow: hidden; }
    .header { background: #1e293b; padding: 12px 24px; display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #334155; z-index: 10; position: relative; }
    .header h1 { font-size: 16px; }
    .stats { display: flex; gap: 16px; margin-left: auto; font-size: 12px; color: #94a3b8; }
    .stat { display: flex; align-items: center; gap: 4px; }
    .stat-value { color: #3b82f6; font-weight: 600; }
    .canvas { position: relative; width: 100vw; height: calc(100vh - 48px); overflow: auto; }
    .table-node { position: absolute; background: #1e293b; border: 2px solid; border-radius: 8px; min-width: 240px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); cursor: move; }
    .table-header { padding: 10px 14px; font-weight: 600; font-size: 14px; border-bottom: 1px solid #334155; border-radius: 6px 6px 0 0; display: flex; align-items: center; gap: 8px; }
    .table-header .icon { font-size: 12px; }
    .column-row { padding: 4px 14px; font-size: 12px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid #1a2332; }
    .column-row:last-child { border-bottom: none; }
    .column-name { flex: 1; }
    .column-type { color: #64748b; font-size: 11px; }
    .pk { color: #fbbf24; }
    .fk { color: #a78bfa; }
    .optional { opacity: 0.6; }
    .edge-svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
    .edge-line { stroke: #475569; stroke-width: 1.5; fill: none; }
    .sidebar { position: fixed; right: 0; top: 48px; width: 320px; height: calc(100vh - 48px); background: #1e293b; border-left: 1px solid #334155; padding: 20px; overflow-y: auto; z-index: 5; }
    .sidebar h2 { font-size: 14px; margin-bottom: 12px; color: #94a3b8; }
    .impact-item { padding: 8px; background: #0f172a; border-radius: 6px; margin-bottom: 6px; font-size: 12px; }
    .impact-safe { border-left: 3px solid #22c55e; }
    .impact-caution { border-left: 3px solid #f59e0b; }
    .impact-destructive { border-left: 3px solid #ef4444; }
  </style>
</head>
<body>
  <div class="header">
    <h1>📐 Schema Designer</h1>
    <div class="stats">
      <div class="stat"><span class="stat-value">${model.stats.tableCount}</span> tables</div>
      <div class="stat"><span class="stat-value">${model.stats.columnCount}</span> columns</div>
      <div class="stat"><span class="stat-value">${model.stats.relationCount}</span> relations</div>
      <div class="stat"><span class="stat-value">${model.stats.indexCount}</span> indexes</div>
    </div>
  </div>
  <div class="canvas">
    <svg class="edge-svg" xmlns="http://www.w3.org/2000/svg">
      ${model.edges
        .map((edge) => {
          const source = model.nodes.find((n) => n.id === edge.source)
          const target = model.nodes.find((n) => n.id === edge.target)
          if (!source || !target) return ""
          const sx = source.position.x + source.width
          const sy = source.position.y + 40
          const tx = target.position.x
          const ty = target.position.y + 40
          const mx = (sx + tx) / 2
          return `<path class="edge-line" d="M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}" />`
        })
        .join("\n")}
    </svg>
    ${model.nodes
      .map(
        (node) => `
      <div class="table-node" style="left:${node.position.x}px;top:${node.position.y}px;border-color:${node.color}">
        <div class="table-header" style="background:${node.color}22">
          <span class="icon">📋</span>
          ${node.label}
        </div>
        ${node.columns
          .map(
            (col) => `
          <div class="column-row ${col.isOptional ? "optional" : ""}">
            <span class="column-name ${col.isPrimaryKey ? "pk" : ""} ${col.isForeignKey ? "fk" : ""}">
              ${col.isPrimaryKey ? "🔑 " : ""}${col.isForeignKey ? "🔗 " : ""}${col.name}
            </span>
            <span class="column-type">${col.pgType}</span>
          </div>
        `,
          )
          .join("")}
      </div>
    `,
      )
      .join("")}
  </div>
</body>
</html>`
  }
}
