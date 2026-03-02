/**
 * ReactiveBase TypeScript Language Server Plugin.
 * Provides IntelliSense for ctx.db.<table>.<method>() calls:
 *   - Autocomplete table names from schema
 *   - Autocomplete column names in where() / orderBy() / select()
 *   - Type inference for query return types
 *   - Go-to-definition for schema references
 *
 * This module provides the completion data — the actual TS plugin
 * integration uses the TypeScript Language Service Plugin API.
 *
 * Usage:
 *   const provider = new SchemaCompletionProvider(parsedSchema)
 *   const completions = provider.getCompletions("ctx.db.tasks.where({ ")
 *   const hover = provider.getHoverInfo("ctx.db.tasks")
 */

import type { ParsedSchema, SchemaTable } from "../codegen/typed-codegen.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CompletionItem {
  label: string
  kind: "table" | "column" | "method" | "type" | "value"
  detail: string
  documentation?: string
  insertText: string
  sortOrder: number
}

export interface HoverInfo {
  label: string
  documentation: string
  type: string
}

export interface DiagnosticInfo {
  message: string
  severity: "error" | "warning" | "info"
  line: number
  column: number
}

export interface DefinitionLocation {
  file: string
  line: number
  column: number
}

// ─── Database Method Definitions ─────────────────────────────────────────────

const TABLE_METHODS: CompletionItem[] = [
  {
    label: "where",
    kind: "method",
    detail: "(filter: Partial<T>) => QueryChain<T>",
    documentation: "Filter rows by field values",
    insertText: "where({ $1 })",
    sortOrder: 1,
  },
  {
    label: "get",
    kind: "method",
    detail: "(id: string) => Promise<T | null>",
    documentation: "Get a single row by ID",
    insertText: "get($1)",
    sortOrder: 2,
  },
  {
    label: "getOrThrow",
    kind: "method",
    detail: "(id: string) => Promise<T>",
    documentation: "Get a row by ID or throw if not found",
    insertText: "getOrThrow($1)",
    sortOrder: 3,
  },
  {
    label: "insert",
    kind: "method",
    detail: "(data: Omit<T, 'id'>) => Promise<T>",
    documentation: "Insert a new row",
    insertText: "insert({ $1 })",
    sortOrder: 4,
  },
  {
    label: "update",
    kind: "method",
    detail: "(id: string, data: Partial<T>) => Promise<T>",
    documentation: "Update a row by ID",
    insertText: "update($1, { $2 })",
    sortOrder: 5,
  },
  {
    label: "delete",
    kind: "method",
    detail: "(id: string) => Promise<void>",
    documentation: "Delete a row by ID",
    insertText: "delete($1)",
    sortOrder: 6,
  },
  {
    label: "count",
    kind: "method",
    detail: "() => Promise<number>",
    documentation: "Count matching rows",
    insertText: "count()",
    sortOrder: 7,
  },
]

const QUERY_CHAIN_METHODS: CompletionItem[] = [
  {
    label: "orderBy",
    kind: "method",
    detail: '(column: keyof T, dir?: "asc" | "desc") => QueryChain<T>',
    documentation: "Sort results",
    insertText: 'orderBy("$1", "$2")',
    sortOrder: 1,
  },
  {
    label: "limit",
    kind: "method",
    detail: "(n: number) => QueryChain<T>",
    documentation: "Limit result count",
    insertText: "limit($1)",
    sortOrder: 2,
  },
  {
    label: "offset",
    kind: "method",
    detail: "(n: number) => QueryChain<T>",
    documentation: "Skip rows",
    insertText: "offset($1)",
    sortOrder: 3,
  },
  {
    label: "first",
    kind: "method",
    detail: "() => Promise<T | null>",
    documentation: "Get first matching row",
    insertText: "first()",
    sortOrder: 4,
  },
  {
    label: "count",
    kind: "method",
    detail: "() => Promise<number>",
    documentation: "Count matching rows",
    insertText: "count()",
    sortOrder: 5,
  },
  {
    label: "select",
    kind: "method",
    detail: "(...columns: (keyof T)[]) => QueryChain<Partial<T>>",
    documentation: "Select specific columns",
    insertText: 'select("$1")',
    sortOrder: 6,
  },
]

// ─── Schema Completion Provider ──────────────────────────────────────────────

export class SchemaCompletionProvider {
  private schema: ParsedSchema
  private schemaFile: string

  /**
   * @param schema - Parsed schema providing table and column definitions
   * @param schemaFile - Path to the schema source file for definition lookups
   */
  constructor(schema: ParsedSchema, schemaFile: string = "convex/schema.ts") {
    this.schema = schema
    this.schemaFile = schemaFile
  }

  /**
   * Get completions based on the cursor context.
   *
   * @param prefix - The text before the cursor position
   * @returns Array of completion items matching the context
   */
  getCompletions(prefix: string): CompletionItem[] {
    // ctx.db. → suggest table names
    if (prefix.endsWith("ctx.db.") || prefix.endsWith("db.")) {
      return this.getTableCompletions()
    }

    // ctx.db.tableName. → suggest methods
    const tableMethodMatch = prefix.match(/ctx\.db\.(\w+)\.$/)
    if (tableMethodMatch) {
      const tableName = tableMethodMatch[1]
      if (this.getTable(tableName)) {
        return TABLE_METHODS
      }
    }

    // ctx.db.tableName.where({ → suggest columns
    const whereMatch = prefix.match(/ctx\.db\.(\w+)\.where\(\s*\{\s*$/)
    if (whereMatch) {
      return this.getColumnCompletions(whereMatch[1])
    }

    // ctx.db.tableName.where({ col: val }).orderBy(" → suggest columns
    const orderByMatch = prefix.match(/ctx\.db\.(\w+)[\s\S]*\.orderBy\(\s*["']?$/)
    if (orderByMatch) {
      return this.getColumnCompletions(orderByMatch[1])
    }

    // After .where() → suggest chain methods
    const chainMatch = prefix.match(/ctx\.db\.\w+\.where\([^)]*\)\s*\.$/)
    if (chainMatch) {
      return QUERY_CHAIN_METHODS
    }

    return []
  }

  /**
   * Get hover information for a symbol.
   *
   * @param symbol - The symbol text to get hover info for
   * @returns Hover information with label, documentation, and type, or null if not found
   */
  getHoverInfo(symbol: string): HoverInfo | null {
    // ctx.db.tableName
    const tableMatch = symbol.match(/ctx\.db\.(\w+)$/)
    if (tableMatch) {
      const table = this.getTable(tableMatch[1])
      if (table) {
        const fields = table.fields.map((f) => `  ${f.name}: ${f.tsType}${f.optional ? " | undefined" : ""}`).join("\n")
        return {
          label: tableMatch[1],
          documentation: `Table with ${table.fields.length} columns and ${table.indexes.length} indexes`,
          type: `{\n${fields}\n}`,
        }
      }
    }

    return null
  }

  /**
   * Validate database access patterns in source code.
   *
   * @param source - TypeScript source code to validate
   * @returns Array of diagnostic info for invalid database access patterns
   */
  validateSource(source: string): DiagnosticInfo[] {
    const diagnostics: DiagnosticInfo[] = []
    const lines = source.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Check for invalid table names
      const tableAccess = /ctx\.db\.(\w+)\./g
      let match: RegExpExecArray | null
      while ((match = tableAccess.exec(line)) !== null) {
        const tableName = match[1]
        if (tableName !== "raw" && tableName !== "fn" && !this.getTable(tableName)) {
          diagnostics.push({
            message: `Table "${tableName}" does not exist in schema. Available: ${this.schema.tables.map((t) => t.name).join(", ")}`,
            severity: "error",
            line: i + 1,
            column: match.index + 7, // after "ctx.db."
          })
        }
      }
    }

    return diagnostics
  }

  /**
   * Get definition location for a schema reference.
   *
   * @param symbol - The symbol text to find the definition for
   * @returns Definition location with file, line, and column, or null if not found
   */
  getDefinitionLocation(symbol: string): DefinitionLocation | null {
    const tableMatch = symbol.match(/ctx\.db\.(\w+)/)
    if (tableMatch) {
      // In the actual plugin, this would parse the schema file to find the line
      return { file: this.schemaFile, line: 1, column: 0 }
    }
    return null
  }

  /**
   * Get TS plugin configuration for tsconfig.json.
   *
   * @returns Configuration object for the ReactiveBase TypeScript plugin
   */
  static getPluginConfig(): Record<string, unknown> {
    return {
      compilerOptions: {
        plugins: [{ name: "@reactivebase/ts-plugin" }],
      },
    }
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private getTable(name: string): SchemaTable | undefined {
    return this.schema.tables.find((t) => t.name === name)
  }

  private getTableCompletions(): CompletionItem[] {
    return this.schema.tables.map((t, i) => ({
      label: t.name,
      kind: "table" as const,
      detail: `Table (${t.fields.length} columns)`,
      documentation: `Columns: ${t.fields.map((f) => f.name).join(", ")}`,
      insertText: t.name,
      sortOrder: i,
    }))
  }

  private getColumnCompletions(tableName: string): CompletionItem[] {
    const table = this.getTable(tableName)
    if (!table) return []

    return table.fields.map((f, i) => ({
      label: f.name,
      kind: "column" as const,
      detail: f.tsType + (f.optional ? " | undefined" : ""),
      documentation: f.isId ? "Primary key" : f.referencedTable ? `Foreign key → ${f.referencedTable}` : undefined,
      insertText: `${f.name}: `,
      sortOrder: i,
    }))
  }
}
