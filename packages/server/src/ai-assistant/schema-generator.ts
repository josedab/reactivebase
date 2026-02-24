/**
 * Natural Language Schema Generation.
 * Generates ReactiveBase schemas from natural language descriptions,
 * suggests relations/indexes, generates migrations, and validates schemas.
 *
 * Features:
 *   - Natural language → schema definition code generation
 *   - Automatic relation and index suggestions
 *   - Safe migration strategy generation
 *   - Schema anti-pattern detection
 *
 * Usage:
 *   const generator = new SchemaGenerator({ aiProvider: openaiProvider })
 *   const result = await generator.generateFromDescription("a blog with posts, comments, and tags")
 *   const antiPatterns = generator.validateSchema(schema)
 */

import type { AiProviderAdapter, SchemaInfo } from "./ai-assistant.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SchemaGenerationResult {
  /** Generated tables with columns */
  tables: GeneratedTable[]
  /** Suggested foreign key relationships */
  relations: GeneratedRelation[]
  /** Recommended indexes */
  indexes: GeneratedIndex[]
  /** Warnings about potential issues */
  warnings: string[]
  /** Generated ReactiveBase schema code */
  generatedCode: string
}

export interface GeneratedTable {
  name: string
  columns: { name: string; type: string; nullable: boolean }[]
}

export interface GeneratedRelation {
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
  type: "one-to-one" | "one-to-many" | "many-to-many"
}

export interface GeneratedIndex {
  table: string
  columns: string[]
  name: string
}

export interface SchemaAntiPattern {
  /** Name of the anti-pattern */
  pattern: string
  /** Description of the issue */
  description: string
  /** Suggested fix */
  suggestion: string
  /** Severity of the issue */
  severity: "info" | "warning" | "critical"
}

export interface MigrationStep {
  type: "create-table" | "add-column" | "drop-column" | "rename-column" | "add-index" | "drop-index" | "drop-table"
  table: string
  sql: string
  destructive: boolean
}

export interface MigrationStrategy {
  steps: MigrationStep[]
  warnings: string[]
  rollbackSteps: MigrationStep[]
}

export interface SchemaGeneratorOptions {
  aiProvider?: AiProviderAdapter
}

// ─── Pattern Matching ────────────────────────────────────────────────────────

interface EntityPattern {
  pattern: RegExp
  extract: (match: RegExpExecArray) => string[]
}

const ENTITY_PATTERNS: EntityPattern[] = [
  {
    // "with posts, comments, and tags"
    pattern: /with\s+([\w\s,]+(?:\s+and\s+\w+)?)/i,
    extract: (match) =>
      match[1]
        .split(/,|\s+and\s+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
  },
  {
    // "tables: posts, comments, tags" or "tables for posts, comments"
    pattern: /tables?(?:\s+for)?\s*:?\s*([\w\s,]+(?:\s+and\s+\w+)?)/i,
    extract: (match) =>
      match[1]
        .split(/,|\s+and\s+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
  },
  {
    // "a blog with users and posts" — extract nouns after "a/an NOUN"
    pattern: /(?:a|an)\s+(\w+)/i,
    extract: (match) => [match[1].toLowerCase()],
  },
]

const COMMON_COLUMNS: Record<string, { name: string; type: string; nullable: boolean }[]> = {
  users: [
    { name: "name", type: "text", nullable: false },
    { name: "email", type: "text", nullable: false },
    { name: "avatarUrl", type: "text", nullable: true },
    { name: "createdAt", type: "number", nullable: false },
  ],
  posts: [
    { name: "title", type: "text", nullable: false },
    { name: "body", type: "text", nullable: false },
    { name: "authorId", type: "text", nullable: false },
    { name: "publishedAt", type: "number", nullable: true },
    { name: "createdAt", type: "number", nullable: false },
  ],
  comments: [
    { name: "body", type: "text", nullable: false },
    { name: "authorId", type: "text", nullable: false },
    { name: "postId", type: "text", nullable: false },
    { name: "createdAt", type: "number", nullable: false },
  ],
  tags: [
    { name: "name", type: "text", nullable: false },
    { name: "slug", type: "text", nullable: false },
  ],
  tasks: [
    { name: "title", type: "text", nullable: false },
    { name: "description", type: "text", nullable: true },
    { name: "done", type: "boolean", nullable: false },
    { name: "assigneeId", type: "text", nullable: true },
    { name: "createdAt", type: "number", nullable: false },
  ],
  products: [
    { name: "name", type: "text", nullable: false },
    { name: "price", type: "number", nullable: false },
    { name: "description", type: "text", nullable: true },
    { name: "categoryId", type: "text", nullable: true },
    { name: "createdAt", type: "number", nullable: false },
  ],
  orders: [
    { name: "userId", type: "text", nullable: false },
    { name: "status", type: "text", nullable: false },
    { name: "total", type: "number", nullable: false },
    { name: "createdAt", type: "number", nullable: false },
  ],
  categories: [
    { name: "name", type: "text", nullable: false },
    { name: "parentId", type: "text", nullable: true },
  ],
}

const DEFAULT_COLUMNS: { name: string; type: string; nullable: boolean }[] = [
  { name: "name", type: "text", nullable: false },
  { name: "createdAt", type: "number", nullable: false },
]

// ─── Schema Generator Engine ─────────────────────────────────────────────────

export class SchemaGenerator {
  private aiProvider?: AiProviderAdapter

  constructor(options: SchemaGeneratorOptions = {}) {
    this.aiProvider = options.aiProvider
  }

  /**
   * Generate a ReactiveBase schema from a natural language description.
   */
  async generateFromDescription(
    naturalLanguage: string,
    provider?: AiProviderAdapter,
  ): Promise<SchemaGenerationResult> {
    const activeProvider = provider ?? this.aiProvider

    // Try AI generation first if available
    if (activeProvider) {
      try {
        return await this.generateWithAi(naturalLanguage, activeProvider)
      } catch {
        // Fall through to rule-based
      }
    }

    return this.generateRuleBased(naturalLanguage)
  }

  /**
   * Analyze tables and suggest foreign key relationships.
   */
  suggestRelations(tables: GeneratedTable[]): GeneratedRelation[] {
    const relations: GeneratedRelation[] = []
    const tableNames = new Set(tables.map((t) => t.name))

    for (const table of tables) {
      for (const column of table.columns) {
        // Detect foreign key columns (e.g., authorId → users, postId → posts)
        if (column.name.endsWith("Id")) {
          const refName = column.name.slice(0, -2).toLowerCase()
          // Try plural forms
          const candidates = [`${refName}s`, refName, `${refName}es`]
          const targetTable = candidates.find((c) => tableNames.has(c))

          if (targetTable && targetTable !== table.name) {
            relations.push({
              fromTable: table.name,
              fromColumn: column.name,
              toTable: targetTable,
              toColumn: "id",
              type: "one-to-many",
            })
          }
        }
      }
    }

    return relations
  }

  /**
   * Recommend indexes based on query patterns.
   */
  suggestIndexes(schema: SchemaInfo, queryPatterns: string[]): GeneratedIndex[] {
    const indexes: GeneratedIndex[] = []
    const existingIndexColumns = new Set<string>()

    for (const table of schema.tables) {
      for (const idx of table.indexes) {
        existingIndexColumns.add(`${table.name}.${idx.columns.join(",")}`)
      }
    }

    for (const table of schema.tables) {
      // Index foreign key columns
      for (const col of table.columns) {
        if (col.name.endsWith("Id")) {
          const key = `${table.name}.${col.name}`
          if (!existingIndexColumns.has(key)) {
            indexes.push({
              table: table.name,
              columns: [col.name],
              name: `idx_${table.name}_${col.name}`,
            })
            existingIndexColumns.add(key)
          }
        }
      }

      // Analyze query patterns for frequently filtered columns
      for (const pattern of queryPatterns) {
        const whereMatch = new RegExp(`${table.name}\\.where\\(\\{\\s*(\\w+)`).exec(pattern)
        if (whereMatch) {
          const col = whereMatch[1]
          const key = `${table.name}.${col}`
          if (!existingIndexColumns.has(key)) {
            indexes.push({
              table: table.name,
              columns: [col],
              name: `idx_${table.name}_${col}`,
            })
            existingIndexColumns.add(key)
          }
        }

        const orderMatch = new RegExp(`${table.name}.*\\.orderBy\\("(\\w+)"`).exec(pattern)
        if (orderMatch) {
          const col = orderMatch[1]
          const key = `${table.name}.${col}`
          if (!existingIndexColumns.has(key)) {
            indexes.push({
              table: table.name,
              columns: [col],
              name: `idx_${table.name}_${col}`,
            })
            existingIndexColumns.add(key)
          }
        }
      }
    }

    return indexes
  }

  /**
   * Generate a safe migration strategy from current to target schema.
   */
  generateMigration(currentSchema: SchemaInfo, targetSchema: SchemaInfo): MigrationStrategy {
    const steps: MigrationStep[] = []
    const rollbackSteps: MigrationStep[] = []
    const warnings: string[] = []

    const currentTables = new Map(currentSchema.tables.map((t) => [t.name, t]))
    const targetTables = new Map(targetSchema.tables.map((t) => [t.name, t]))

    // New tables
    for (const [name, table] of targetTables) {
      if (!currentTables.has(name)) {
        const cols = table.columns.map((c) => `"${c.name}" ${c.type}${c.nullable ? "" : " NOT NULL"}`).join(", ")
        steps.push({
          type: "create-table",
          table: name,
          sql: `CREATE TABLE "${name}" (${cols});`,
          destructive: false,
        })
        rollbackSteps.push({
          type: "drop-table",
          table: name,
          sql: `DROP TABLE "${name}";`,
          destructive: true,
        })
      }
    }

    // Dropped tables
    for (const [name, table] of currentTables) {
      if (!targetTables.has(name)) {
        steps.push({
          type: "drop-table",
          table: name,
          sql: `DROP TABLE "${name}";`,
          destructive: true,
        })
        warnings.push(`Dropping table "${name}" will permanently delete all its data`)
        const cols = table.columns.map((c) => `"${c.name}" ${c.type}${c.nullable ? "" : " NOT NULL"}`).join(", ")
        rollbackSteps.push({
          type: "create-table",
          table: name,
          sql: `CREATE TABLE "${name}" (${cols});`,
          destructive: false,
        })
      }
    }

    // Modified tables — column diffs
    for (const [name, targetTable] of targetTables) {
      const currentTable = currentTables.get(name)
      if (!currentTable) continue

      const currentCols = new Map(currentTable.columns.map((c) => [c.name, c]))
      const targetCols = new Map(targetTable.columns.map((c) => [c.name, c]))

      // New columns
      for (const [colName, col] of targetCols) {
        if (!currentCols.has(colName)) {
          steps.push({
            type: "add-column",
            table: name,
            sql: `ALTER TABLE "${name}" ADD COLUMN "${colName}" ${col.type}${col.nullable ? "" : " NOT NULL DEFAULT ''"};`,
            destructive: false,
          })
          rollbackSteps.push({
            type: "drop-column",
            table: name,
            sql: `ALTER TABLE "${name}" DROP COLUMN "${colName}";`,
            destructive: true,
          })
        }
      }

      // Dropped columns
      for (const [colName] of currentCols) {
        if (!targetCols.has(colName)) {
          steps.push({
            type: "drop-column",
            table: name,
            sql: `ALTER TABLE "${name}" DROP COLUMN "${colName}";`,
            destructive: true,
          })
          warnings.push(`Dropping column "${name}.${colName}" will permanently delete its data`)
          const col = currentCols.get(colName)!
          rollbackSteps.push({
            type: "add-column",
            table: name,
            sql: `ALTER TABLE "${name}" ADD COLUMN "${colName}" ${col.type};`,
            destructive: false,
          })
        }
      }
    }

    // Index diffs
    for (const [name, targetTable] of targetTables) {
      const currentTable = currentTables.get(name)
      if (!currentTable) continue

      const currentIndexes = new Set(currentTable.indexes.map((i) => i.columns.join(",")))
      const targetIndexes = new Set(targetTable.indexes.map((i) => i.columns.join(",")))

      for (const idx of targetTable.indexes) {
        if (!currentIndexes.has(idx.columns.join(","))) {
          steps.push({
            type: "add-index",
            table: name,
            sql: `CREATE INDEX "${idx.name}" ON "${name}" (${idx.columns.map((c) => `"${c}"`).join(", ")});`,
            destructive: false,
          })
          rollbackSteps.push({
            type: "drop-index",
            table: name,
            sql: `DROP INDEX "${idx.name}";`,
            destructive: false,
          })
        }
      }

      for (const idx of currentTable.indexes) {
        if (!targetIndexes.has(idx.columns.join(","))) {
          steps.push({
            type: "drop-index",
            table: name,
            sql: `DROP INDEX "${idx.name}";`,
            destructive: false,
          })
          rollbackSteps.push({
            type: "add-index",
            table: name,
            sql: `CREATE INDEX "${idx.name}" ON "${name}" (${idx.columns.map((c) => `"${c}"`).join(", ")});`,
            destructive: false,
          })
        }
      }
    }

    return { steps, warnings, rollbackSteps }
  }

  /**
   * Validate a schema for common anti-patterns.
   */
  validateSchema(schema: SchemaInfo): SchemaAntiPattern[] {
    const antiPatterns: SchemaAntiPattern[] = []

    for (const table of schema.tables) {
      // No indexes at all
      if (table.indexes.length === 0 && table.columns.length > 2) {
        antiPatterns.push({
          pattern: "no-indexes",
          description: `Table "${table.name}" has no indexes defined`,
          suggestion: `Add indexes for columns that are frequently queried, especially foreign key columns`,
          severity: "warning",
        })
      }

      // Unindexed foreign key columns
      const indexedColumns = new Set(table.indexes.flatMap((i) => i.columns))
      for (const col of table.columns) {
        if (col.name.endsWith("Id") && !indexedColumns.has(col.name)) {
          antiPatterns.push({
            pattern: "unindexed-foreign-key",
            description: `Foreign key column "${table.name}.${col.name}" is not indexed`,
            suggestion: `Add an index: .index("by_${col.name}", ["${col.name}"])`,
            severity: "warning",
          })
        }
      }

      // Too many columns (wide table)
      if (table.columns.length > 20) {
        antiPatterns.push({
          pattern: "wide-table",
          description: `Table "${table.name}" has ${table.columns.length} columns — consider splitting into related tables`,
          suggestion: "Group related columns into separate tables connected by foreign keys",
          severity: "info",
        })
      }

      // All columns nullable
      const allNullable = table.columns.every((c) => c.nullable)
      if (allNullable && table.columns.length > 1) {
        antiPatterns.push({
          pattern: "all-nullable",
          description: `All columns in "${table.name}" are nullable — this may indicate missing constraints`,
          suggestion: "Mark required columns as non-nullable for better data integrity",
          severity: "warning",
        })
      }

      // Generic column names
      const genericNames = ["data", "value", "info", "stuff", "misc"]
      for (const col of table.columns) {
        if (genericNames.includes(col.name.toLowerCase())) {
          antiPatterns.push({
            pattern: "generic-column-name",
            description: `Column "${table.name}.${col.name}" has a generic name`,
            suggestion: "Use descriptive column names that indicate the data they contain",
            severity: "info",
          })
        }
      }
    }

    return antiPatterns
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private generateRuleBased(input: string): SchemaGenerationResult {
    const tables: GeneratedTable[] = []
    const entityNames: string[] = []

    // Extract entity names from input
    for (const ep of ENTITY_PATTERNS) {
      const match = ep.pattern.exec(input)
      if (match) {
        entityNames.push(...ep.extract(match))
      }
    }

    // Deduplicate
    const uniqueEntities = [...new Set(entityNames)]

    if (uniqueEntities.length === 0) {
      // Try splitting by common separators
      const words = input
        .toLowerCase()
        .replace(/[^a-z\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !["the", "and", "for", "with", "has", "have"].includes(w))

      if (words.length > 0) {
        uniqueEntities.push(words[words.length - 1])
      }
    }

    for (const entity of uniqueEntities) {
      const pluralName = entity.endsWith("s") ? entity : `${entity}s`
      const columns = COMMON_COLUMNS[pluralName] ?? DEFAULT_COLUMNS
      tables.push({ name: pluralName, columns: [{ name: "id", type: "text", nullable: false }, ...columns] })
    }

    const relations = this.suggestRelations(tables)
    const schemaInfo: SchemaInfo = {
      tables: tables.map((t) => ({ name: t.name, columns: t.columns, indexes: [] })),
    }
    const indexes = this.suggestIndexes(schemaInfo, [])
    const warnings: string[] = []

    if (uniqueEntities.length === 0) {
      warnings.push("Could not extract entity names from description. Try listing table names explicitly.")
    }

    const generatedCode = this.generateCode(tables, relations, indexes)

    return { tables, relations, indexes, warnings, generatedCode }
  }

  private async generateWithAi(input: string, provider: AiProviderAdapter): Promise<SchemaGenerationResult> {
    const prompt = `Generate a ReactiveBase schema definition from this description.\n\nDescription: "${input}"\n\nReturn a JSON object with:\n- tables: array of { name, columns: [{ name, type, nullable }] }\n- relations: array of { fromTable, fromColumn, toTable, toColumn, type }\n\nUse types: text, number, boolean. Include id, createdAt columns. Return only valid JSON.`

    const response = await provider.generate(prompt, { maxTokens: 1000, temperature: 0.2 })

    try {
      const parsed = JSON.parse(response)
      const tables: GeneratedTable[] = parsed.tables ?? []
      const relations: GeneratedRelation[] = parsed.relations ?? []
      const schemaInfo: SchemaInfo = {
        tables: tables.map((t: GeneratedTable) => ({ name: t.name, columns: t.columns, indexes: [] })),
      }
      const indexes = this.suggestIndexes(schemaInfo, [])
      const generatedCode = this.generateCode(tables, relations, indexes)

      return { tables, relations, indexes, warnings: [], generatedCode }
    } catch {
      // Fall back to rule-based on parse failure
      return this.generateRuleBased(input)
    }
  }

  private generateCode(tables: GeneratedTable[], relations: GeneratedRelation[], indexes: GeneratedIndex[]): string {
    const lines: string[] = [
      'import { defineSchema, defineTable } from "reactivebase/server"',
      'import { v } from "reactivebase/values"',
      "",
      "export default defineSchema({",
    ]

    const indexesByTable = new Map<string, GeneratedIndex[]>()
    for (const idx of indexes) {
      if (!indexesByTable.has(idx.table)) indexesByTable.set(idx.table, [])
      indexesByTable.get(idx.table)!.push(idx)
    }

    for (const table of tables) {
      const cols = table.columns.filter((c) => c.name !== "id")
      lines.push(`  ${table.name}: defineTable({`)
      for (const col of cols) {
        const validator = col.nullable ? `v.optional(v.${col.type}())` : `v.${col.type}()`
        lines.push(`    ${col.name}: ${validator},`)
      }
      lines.push("  })")

      // Add indexes
      const tableIndexes = indexesByTable.get(table.name) ?? []
      for (const idx of tableIndexes) {
        lines.push(`    .index("${idx.name}", [${idx.columns.map((c) => `"${c}"`).join(", ")}])`)
      }

      lines[lines.length - 1] += ","
    }

    lines.push("})")

    // Add relation comments
    if (relations.length > 0) {
      lines.push("")
      lines.push("// Relations:")
      for (const rel of relations) {
        lines.push(`// ${rel.fromTable}.${rel.fromColumn} → ${rel.toTable}.${rel.toColumn} (${rel.type})`)
      }
    }

    return lines.join("\n")
  }
}
