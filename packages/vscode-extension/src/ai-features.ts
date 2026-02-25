/**
 * VS Code Extension AI Features.
 * Provides inline completions, diagnostics, code actions, hover info,
 * and natural language schema generation using the AI assistant modules.
 *
 * Features:
 *   - Inline autocomplete for ReactiveBase queries
 *   - Real-time schema validation diagnostics
 *   - Quick-fix code actions for detected issues
 *   - Hover documentation for query elements
 *   - Natural language schema generation command
 *
 * Usage:
 *   const provider = new AiFeatureProvider(schema)
 *   const completions = provider.getCompletions(document, position)
 */

import type * as _vscode from "vscode"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SchemaInfo {
  tables: {
    name: string
    columns: { name: string; type: string; nullable: boolean }[]
    indexes: { name: string; columns: string[] }[]
  }[]
}

export interface CompletionItem {
  label: string
  kind: "function" | "table" | "column" | "keyword"
  detail: string
  insertText: string
  sortOrder: number
}

export interface DiagnosticItem {
  range: { startLine: number; startChar: number; endLine: number; endChar: number }
  message: string
  severity: "error" | "warning" | "info"
  code?: string
}

export interface CodeAction {
  title: string
  kind: "quickfix" | "refactor"
  edit: { range: { startLine: number; startChar: number; endLine: number; endChar: number }; newText: string }
  diagnosticCode?: string
}

export interface HoverInfo {
  contents: string
  range?: { startLine: number; startChar: number; endLine: number; endChar: number }
}

export interface GeneratedSchema {
  code: string
  tables: string[]
  warnings: string[]
}

// ─── Constants ───────────────────────────────────────────────────────────────

const QUERY_KEYWORDS = [
  { label: "query", detail: "Define a read-only query function", insertText: "query(async (ctx) => {\n  \n})" },
  { label: "mutation", detail: "Define a mutation function", insertText: "mutation(async (ctx, args) => {\n  \n})" },
  { label: "action", detail: "Define an action function", insertText: "action(async (ctx, args) => {\n  \n})" },
]

const CHAIN_METHODS = [
  { label: ".where", detail: "Filter by conditions", insertText: ".where({ })" },
  { label: ".orderBy", detail: "Sort results", insertText: '.orderBy("field", "asc")' },
  { label: ".limit", detail: "Limit result count", insertText: ".limit(10)" },
  { label: ".first", detail: "Get first result", insertText: ".first()" },
  { label: ".count", detail: "Count matching rows", insertText: ".count()" },
]

const _VALIDATOR_TYPES: Record<string, string> = {
  text: "v.string()",
  number: "v.number()",
  boolean: "v.boolean()",
}

const COMMON_TABLE_COLUMNS: Record<string, string[]> = {
  users: ["id", "name", "email", "createdAt"],
  posts: ["id", "title", "body", "authorId", "createdAt"],
  tasks: ["id", "title", "done", "assigneeId", "createdAt"],
  comments: ["id", "body", "authorId", "postId", "createdAt"],
}

// ─── AI Feature Provider ─────────────────────────────────────────────────────

export class AiFeatureProvider {
  private schema: SchemaInfo

  constructor(schema: SchemaInfo) {
    this.schema = schema
  }

  /**
   * Provide inline completions at the given position.
   */
  getCompletions(
    document: { getText: () => string; lineAt: (line: number) => { text: string } },
    position: { line: number; character: number },
  ): CompletionItem[] {
    const _text = document.getText()
    const lineText = document.lineAt(position.line).text
    const beforeCursor = lineText.substring(0, position.character)
    const items: CompletionItem[] = []

    // After "ctx.db." → suggest table names
    if (beforeCursor.trimEnd().endsWith("ctx.db.") || /ctx\.db\.\w*$/.test(beforeCursor)) {
      const partial = /ctx\.db\.(\w*)$/.exec(beforeCursor)?.[1] ?? ""
      for (const table of this.schema.tables) {
        if (!partial || table.name.startsWith(partial)) {
          items.push({
            label: table.name,
            kind: "table",
            detail: `Table (${table.columns.length} columns)`,
            insertText: table.name,
            sortOrder: 0,
          })
        }
      }
      return items
    }

    // After table reference with dot → suggest chain methods
    const tableRef = /ctx\.db\.(\w+)\.\w*$/.exec(beforeCursor)
    if (tableRef) {
      const tableName = tableRef[1]
      const table = this.schema.tables.find((t) => t.name === tableName)

      for (const method of CHAIN_METHODS) {
        items.push({
          label: method.label,
          kind: "function",
          detail: method.detail,
          insertText: method.insertText,
          sortOrder: 1,
        })
      }

      // Inside .where({}) → suggest column names
      if (beforeCursor.includes(".where({") && table) {
        for (const col of table.columns) {
          items.push({
            label: col.name,
            kind: "column",
            detail: `${col.type}${col.nullable ? " (nullable)" : ""}`,
            insertText: `${col.name}: `,
            sortOrder: 0,
          })
        }
      }

      return items
    }

    // Top-level → suggest keywords
    const wordMatch = /(\w*)$/.exec(beforeCursor)
    const partial = wordMatch?.[1] ?? ""
    for (const kw of QUERY_KEYWORDS) {
      if (!partial || kw.label.startsWith(partial)) {
        items.push({
          label: kw.label,
          kind: "keyword",
          detail: kw.detail,
          insertText: kw.insertText,
          sortOrder: 2,
        })
      }
    }

    return items.sort((a, b) => a.sortOrder - b.sortOrder)
  }

  /**
   * Provide real-time schema validation diagnostics.
   */
  getDiagnostics(document: { getText: () => string }): DiagnosticItem[] {
    const text = document.getText()
    const lines = text.split("\n")
    const diagnostics: DiagnosticItem[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Check for references to non-existent tables
      const tableRefs = line.matchAll(/ctx\.db\.(\w+)/g)
      for (const match of tableRefs) {
        const tableName = match[1]
        if (tableName !== "raw" && !this.schema.tables.some((t) => t.name === tableName)) {
          const startChar = match.index! + 7 // after "ctx.db."
          diagnostics.push({
            range: { startLine: i, startChar, endLine: i, endChar: startChar + tableName.length },
            message: `Table "${tableName}" does not exist in schema`,
            severity: "error",
            code: "unknown-table",
          })
        }
      }

      // Check for references to non-existent columns in .where({})
      const whereMatch = /ctx\.db\.(\w+).*\.where\(\{([^}]+)\}\)/.exec(line)
      if (whereMatch) {
        const tableName = whereMatch[1]
        const table = this.schema.tables.find((t) => t.name === tableName)
        if (table) {
          const fieldStr = whereMatch[2]
          const fields = fieldStr.split(",").map((f) => f.trim().split(":")[0].trim())
          for (const field of fields) {
            if (field && !table.columns.some((c) => c.name === field)) {
              const fieldIdx = line.indexOf(field, whereMatch.index!)
              if (fieldIdx >= 0) {
                diagnostics.push({
                  range: { startLine: i, startChar: fieldIdx, endLine: i, endChar: fieldIdx + field.length },
                  message: `Column "${field}" does not exist on table "${tableName}"`,
                  severity: "error",
                  code: "unknown-column",
                })
              }
            }
          }
        }
      }

      // Check for .where() without filter (empty object)
      if (/\.where\(\{\s*\}\)/.test(line) && !line.includes("// all")) {
        const idx = line.indexOf(".where({})")
        if (idx >= 0) {
          diagnostics.push({
            range: { startLine: i, startChar: idx, endLine: i, endChar: idx + 10 },
            message: "Empty .where({}) fetches all rows — use specific filters or add a .limit()",
            severity: "warning",
            code: "empty-where",
          })
        }
      }

      // Check for mutation without auth check
      if (line.includes("mutation(") && !text.includes("ctx.auth")) {
        diagnostics.push({
          range: {
            startLine: i,
            startChar: line.indexOf("mutation("),
            endLine: i,
            endChar: line.indexOf("mutation(") + 9,
          },
          message: "Mutation does not check ctx.auth — consider adding authentication",
          severity: "info",
          code: "no-auth-check",
        })
      }
    }

    return diagnostics
  }

  /**
   * Provide quick-fix code actions for diagnostics.
   */
  getCodeActions(
    document: { getText: () => string; lineAt: (line: number) => { text: string } },
    range: { startLine: number; startChar: number; endLine: number; endChar: number },
    diagnostics: DiagnosticItem[],
  ): CodeAction[] {
    const actions: CodeAction[] = []

    for (const diag of diagnostics) {
      if (diag.code === "unknown-table") {
        // Suggest similar table names
        const tableName = document.lineAt(diag.range.startLine).text.substring(diag.range.startChar, diag.range.endChar)
        for (const table of this.schema.tables) {
          if (this.isSimilar(tableName, table.name)) {
            actions.push({
              title: `Change to "${table.name}"`,
              kind: "quickfix",
              edit: { range: diag.range, newText: table.name },
              diagnosticCode: "unknown-table",
            })
          }
        }
      }

      if (diag.code === "unknown-column") {
        const lineText = document.lineAt(diag.range.startLine).text
        const tableMatch = /ctx\.db\.(\w+)/.exec(lineText)
        if (tableMatch) {
          const table = this.schema.tables.find((t) => t.name === tableMatch[1])
          const colName = lineText.substring(diag.range.startChar, diag.range.endChar)
          if (table) {
            for (const col of table.columns) {
              if (this.isSimilar(colName, col.name)) {
                actions.push({
                  title: `Change to "${col.name}"`,
                  kind: "quickfix",
                  edit: { range: diag.range, newText: col.name },
                  diagnosticCode: "unknown-column",
                })
              }
            }
          }
        }
      }

      if (diag.code === "empty-where") {
        actions.push({
          title: "Add .limit(100) to restrict results",
          kind: "quickfix",
          edit: { range: diag.range, newText: ".where({}).limit(100)" },
          diagnosticCode: "empty-where",
        })
      }

      if (diag.code === "no-auth-check") {
        const lineText = document.lineAt(diag.range.startLine).text
        const insertPos = lineText.indexOf("{") + 1
        actions.push({
          title: "Add authentication check",
          kind: "quickfix",
          edit: {
            range: {
              startLine: diag.range.startLine,
              startChar: insertPos >= 1 ? insertPos : diag.range.endChar,
              endLine: diag.range.startLine,
              endChar: insertPos >= 1 ? insertPos : diag.range.endChar,
            },
            newText:
              '\n  const identity = await ctx.auth.getUserIdentity()\n  if (!identity) throw new Error("Unauthenticated")\n',
          },
          diagnosticCode: "no-auth-check",
        })
      }
    }

    return actions
  }

  /**
   * Provide hover documentation at the given position.
   */
  getHoverInfo(
    document: { getText: () => string; lineAt: (line: number) => { text: string } },
    position: { line: number; character: number },
  ): HoverInfo | null {
    const lineText = document.lineAt(position.line).text

    // Hover over table name after ctx.db.
    const tableMatch = /ctx\.db\.(\w+)/.exec(lineText)
    if (tableMatch) {
      const tableStart = lineText.indexOf(tableMatch[1], tableMatch.index + 7)
      const tableEnd = tableStart + tableMatch[1].length
      if (position.character >= tableStart && position.character <= tableEnd) {
        const table = this.schema.tables.find((t) => t.name === tableMatch[1])
        if (table) {
          const cols = table.columns
            .map((c) => `  - \`${c.name}\`: ${c.type}${c.nullable ? " (nullable)" : ""}`)
            .join("\n")
          const idxs =
            table.indexes.length > 0
              ? "\n\n**Indexes:**\n" +
                table.indexes.map((i) => `  - \`${i.name}\` on (${i.columns.join(", ")})`).join("\n")
              : ""
          return {
            contents: `**Table: ${table.name}**\n\n**Columns:**\n${cols}${idxs}`,
            range: { startLine: position.line, startChar: tableStart, endLine: position.line, endChar: tableEnd },
          }
        }
      }
    }

    // Hover over chain methods
    const methodPatterns: Array<{ pattern: RegExp; doc: string }> = [
      {
        pattern: /\.where\(/,
        doc: "**`.where(filter)`** — Filter rows by field values. Pass an object with field-value pairs.",
      },
      {
        pattern: /\.orderBy\(/,
        doc: '**`.orderBy(field, direction)`** — Sort results by a column. Direction: "asc" or "desc".',
      },
      { pattern: /\.limit\(/, doc: "**`.limit(n)`** — Limit the number of returned rows." },
      { pattern: /\.first\(/, doc: "**`.first()`** — Return only the first matching row, or null." },
      { pattern: /\.count\(/, doc: "**`.count()`** — Count matching rows without fetching data." },
      { pattern: /\.join\(/, doc: "**`.join(table)`** — Join with a related table by foreign key." },
      { pattern: /\.select\(/, doc: "**`.select(...columns)`** — Select specific columns to reduce data transfer." },
    ]

    for (const mp of methodPatterns) {
      const match = mp.pattern.exec(lineText)
      if (match) {
        const start = match.index
        const label = match[0]
        if (position.character >= start && position.character <= start + label.length) {
          return {
            contents: mp.doc,
            range: {
              startLine: position.line,
              startChar: start,
              endLine: position.line,
              endChar: start + label.length,
            },
          }
        }
      }
    }

    // Hover over query/mutation/action keywords
    const kwPatterns: Array<{ pattern: RegExp; doc: string }> = [
      {
        pattern: /\bquery\s*\(/,
        doc: "**`query`** — Define a read-only server function. Receives `ctx` with database access. Automatically cached and reactive.",
      },
      {
        pattern: /\bmutation\s*\(/,
        doc: "**`mutation`** — Define a write server function. Receives `ctx` and `args`. Mutations invalidate related query caches.",
      },
      {
        pattern: /\baction\s*\(/,
        doc: "**`action`** — Define a server action. Can call external APIs and perform side effects. Not automatically reactive.",
      },
    ]

    for (const kp of kwPatterns) {
      const match = kp.pattern.exec(lineText)
      if (match) {
        const start = match.index
        const end = start + match[0].indexOf("(")
        if (position.character >= start && position.character <= end) {
          return {
            contents: kp.doc,
            range: { startLine: position.line, startChar: start, endLine: position.line, endChar: end },
          }
        }
      }
    }

    return null
  }

  /**
   * Generate a ReactiveBase schema from a natural language description.
   */
  generateSchema(description: string): GeneratedSchema {
    const tables: string[] = []
    const warnings: string[] = []
    const lines: string[] = [
      'import { defineSchema, defineTable } from "reactivebase/server"',
      'import { v } from "reactivebase/values"',
      "",
      "export default defineSchema({",
    ]

    // Extract entity names
    const entityMatch = /with\s+([\w\s,]+(?:\s+and\s+\w+)?)/i.exec(description)
    const entities = entityMatch
      ? entityMatch[1]
          .split(/,|\s+and\s+/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : description
          .toLowerCase()
          .replace(/[^a-z\s]/g, "")
          .split(/\s+/)
          .filter((w) => w.length > 2 && !["the", "and", "for", "with", "has", "that"].includes(w))

    for (const entity of entities) {
      const tableName = entity.endsWith("s") ? entity : `${entity}s`
      tables.push(tableName)

      const columns = COMMON_TABLE_COLUMNS[tableName]
      if (columns) {
        lines.push(`  ${tableName}: defineTable({`)
        for (const col of columns) {
          if (col === "id") continue
          const type = col.endsWith("At")
            ? "v.number()"
            : col.endsWith("Id")
              ? "v.id('${col.slice(0, -2)}s')"
              : "v.string()"
          lines.push(`    ${col}: ${type},`)
        }
        lines.push("  }),")
      } else {
        lines.push(`  ${tableName}: defineTable({`)
        lines.push("    name: v.string(),")
        lines.push("    createdAt: v.number(),")
        lines.push("  }),")
        warnings.push(`Using default columns for "${tableName}" — customize as needed`)
      }
    }

    lines.push("})")

    if (entities.length === 0) {
      warnings.push("Could not extract entity names from description")
    }

    return { code: lines.join("\n"), tables, warnings }
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private isSimilar(a: string, b: string): boolean {
    if (a === b) return false
    const lower_a = a.toLowerCase()
    const lower_b = b.toLowerCase()
    // Simple similarity: prefix match, contains, or edit distance <= 2
    if (lower_b.startsWith(lower_a) || lower_a.startsWith(lower_b)) return true
    if (lower_b.includes(lower_a) || lower_a.includes(lower_b)) return true
    if (Math.abs(a.length - b.length) <= 2 && this.editDistance(lower_a, lower_b) <= 2) return true
    return false
  }

  private editDistance(a: string, b: string): number {
    const m = a.length
    const n = b.length
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
    for (let i = 0; i <= m; i++) dp[i][0] = i
    for (let j = 0; j <= n; j++) dp[0][j] = j
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
    return dp[m][n]
  }
}
