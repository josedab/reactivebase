/**
 * Context-Aware Query Builder Assistant.
 * Provides autocomplete suggestions, query explanations, optimizations,
 * EXPLAIN plan analysis, and test case generation for ReactiveBase queries.
 *
 * Features:
 *   - Intelligent autocomplete for query code
 *   - Plain-language query explanations
 *   - Query optimization suggestions
 *   - SQL EXPLAIN output analysis
 *   - Automated test case generation
 *
 * Usage:
 *   const builder = new QueryBuilderAssistant({ aiProvider: openaiProvider })
 *   const completions = builder.suggestCompletion(code, 42, schema)
 *   const explanation = builder.explainQuery(queryCode, schema)
 */

import type { AiProviderAdapter, SchemaInfo } from "./ai-assistant.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CompletionItem {
  /** Display label */
  label: string
  /** Kind of completion */
  kind: "function" | "table" | "column" | "keyword"
  /** Additional detail text */
  detail: string
  /** Text to insert */
  insertText: string
  /** Sort order (lower = higher priority) */
  sortOrder: number
}

export interface ExplainPlanAnalysis {
  /** Human-readable summary */
  summary: string
  /** Estimated query cost (relative units) */
  estimatedCost: number
  /** Which indexes are used */
  indexUsage: IndexUsageInfo[]
  /** Optimization suggestions */
  suggestions: string[]
}

export interface IndexUsageInfo {
  table: string
  index: string | null
  scanType: "index-scan" | "full-scan" | "index-only"
}

export interface QueryOptimization {
  /** What to optimize */
  description: string
  /** Why it helps */
  reason: string
  /** Suggested replacement code */
  suggestedCode: string
  /** Estimated improvement */
  impact: "low" | "medium" | "high"
}

export interface TestCase {
  /** Test description */
  description: string
  /** Test code */
  code: string
  /** What category of test */
  category: "happy-path" | "edge-case" | "error-case" | "performance"
}

export interface QueryBuilderAssistantOptions {
  aiProvider?: AiProviderAdapter
}

// ─── Keywords & Helpers ──────────────────────────────────────────────────────

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
  { label: ".join", detail: "Join with related table", insertText: '.join("table")' },
  { label: ".select", detail: "Select specific columns", insertText: '.select("col1", "col2")' },
]

function getContextAtCursor(
  code: string,
  cursorPosition: number,
): { beforeCursor: string; currentWord: string; afterDot: boolean; tableName: string | null } {
  const beforeCursor = code.substring(0, cursorPosition)
  const afterDot = beforeCursor.trimEnd().endsWith(".")

  // Extract current word being typed
  const wordMatch = /(\w*)$/.exec(beforeCursor)
  const currentWord = wordMatch?.[1] ?? ""

  // Detect table context: ctx.db.TABLE
  const tableMatch = /ctx\.db\.(\w+)\s*\.?\s*$/.exec(beforeCursor)
  const tableName = tableMatch?.[1] ?? null

  return { beforeCursor, currentWord, afterDot, tableName }
}

// ─── Query Builder Assistant Engine ──────────────────────────────────────────

export class QueryBuilderAssistant {
  private aiProvider?: AiProviderAdapter

  constructor(options: QueryBuilderAssistantOptions = {}) {
    this.aiProvider = options.aiProvider
  }

  /**
   * Provide autocomplete suggestions at the given cursor position.
   */
  suggestCompletion(partialCode: string, cursorPosition: number, schema: SchemaInfo): CompletionItem[] {
    const context = getContextAtCursor(partialCode, cursorPosition)
    const items: CompletionItem[] = []

    // After "ctx.db." → suggest table names
    if (context.beforeCursor.trimEnd().endsWith("ctx.db.") || context.beforeCursor.trimEnd().match(/ctx\.db\.\w*$/)) {
      for (const table of schema.tables) {
        if (!context.currentWord || table.name.startsWith(context.currentWord)) {
          items.push({
            label: table.name,
            kind: "table",
            detail: `Table (${table.columns.length} columns)`,
            insertText: table.name,
            sortOrder: 0,
          })
        }
      }
    }

    // After "ctx.db.TABLE." → suggest chain methods
    if (context.tableName && context.afterDot) {
      const table = schema.tables.find((t) => t.name === context.tableName)

      for (const method of CHAIN_METHODS) {
        items.push({
          label: method.label,
          kind: "function",
          detail: method.detail,
          insertText: method.insertText,
          sortOrder: 1,
        })
      }

      // Suggest column names inside .where({})
      if (context.beforeCursor.includes(".where({")) {
        if (table) {
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
      }
    }

    // At top level → suggest keywords
    if (!context.afterDot && !context.tableName) {
      for (const kw of QUERY_KEYWORDS) {
        if (!context.currentWord || kw.label.startsWith(context.currentWord)) {
          items.push({
            label: kw.label,
            kind: "keyword",
            detail: kw.detail,
            insertText: kw.insertText,
            sortOrder: 2,
          })
        }
      }
    }

    return items.sort((a, b) => a.sortOrder - b.sortOrder)
  }

  /**
   * Explain what a query does in plain language.
   */
  explainQuery(queryCode: string, schema: SchemaInfo): string {
    const parts: string[] = []

    // Extract table
    const tableMatch = /ctx\.db\.(\w+)/.exec(queryCode)
    const tableName = tableMatch?.[1] ?? "unknown"
    const table = schema.tables.find((t) => t.name === tableName)

    // Detect operation type
    if (queryCode.includes("insert(")) {
      parts.push(`Inserts a new row into the "${tableName}" table.`)
    } else if (queryCode.includes("update(")) {
      parts.push(`Updates an existing row in the "${tableName}" table.`)
    } else if (queryCode.includes("delete(")) {
      parts.push(`Deletes a row from the "${tableName}" table.`)
    } else {
      parts.push(`Reads from the "${tableName}" table.`)
    }

    // Describe filters
    const whereMatch = /\.where\(\{([^}]+)\}\)/.exec(queryCode)
    if (whereMatch) {
      const fields = whereMatch[1].split(",").map((f) => f.trim().split(":")[0].trim())
      parts.push(`Filters by: ${fields.join(", ")}.`)
    }

    // Describe ordering
    const orderMatch = /\.orderBy\("(\w+)",\s*"(\w+)"\)/.exec(queryCode)
    if (orderMatch) {
      parts.push(`Sorted by "${orderMatch[1]}" in ${orderMatch[2] === "desc" ? "descending" : "ascending"} order.`)
    }

    // Describe limit
    const limitMatch = /\.limit\((\d+)\)/.exec(queryCode)
    if (limitMatch) {
      parts.push(`Returns at most ${limitMatch[1]} results.`)
    }

    // Describe joins
    const joinMatch = /\.join\("(\w+)"\)/.exec(queryCode)
    if (joinMatch) {
      parts.push(`Joins with the "${joinMatch[1]}" table.`)
    }

    // Add column info
    if (table && !queryCode.includes("insert(") && !queryCode.includes("delete(")) {
      parts.push(`Available columns: ${table.columns.map((c) => c.name).join(", ")}.`)
    }

    return parts.join(" ")
  }

  /**
   * Suggest query optimizations.
   */
  optimizeQuery(queryCode: string, schema: SchemaInfo): QueryOptimization[] {
    const optimizations: QueryOptimization[] = []
    const tableMatch = /ctx\.db\.(\w+)/.exec(queryCode)
    const tableName = tableMatch?.[1]
    const table = tableName ? schema.tables.find((t) => t.name === tableName) : null

    // Check for missing .limit() on queries
    if (
      queryCode.includes(".where(") &&
      !queryCode.includes(".limit(") &&
      !queryCode.includes(".first(") &&
      !queryCode.includes(".count()")
    ) {
      optimizations.push({
        description: "Add .limit() to prevent unbounded result sets",
        reason: "Queries without a limit may return very large result sets, causing memory and performance issues",
        suggestedCode: queryCode.replace(/\)(\s*\})/, ").limit(100)$1"),
        impact: "medium",
      })
    }

    // Check for unindexed filter columns
    if (table) {
      const whereMatch = /\.where\(\{([^}]+)\}\)/.exec(queryCode)
      if (whereMatch) {
        const fields = whereMatch[1].split(",").map((f) => f.trim().split(":")[0].trim())
        const indexedColumns = new Set(table.indexes.flatMap((i) => i.columns))
        for (const field of fields) {
          if (!indexedColumns.has(field)) {
            optimizations.push({
              description: `Add index for "${field}" on "${tableName}"`,
              reason: `Filtering by "${field}" without an index causes a full table scan`,
              suggestedCode: `.index("by_${field}", ["${field}"])`,
              impact: "high",
            })
          }
        }
      }
    }

    // Check for select * pattern (no .select())
    if (queryCode.includes(".where(") && !queryCode.includes(".select(") && table && table.columns.length > 5) {
      optimizations.push({
        description: "Use .select() to fetch only needed columns",
        reason: `Table "${tableName}" has ${table.columns.length} columns — selecting only needed columns reduces data transfer`,
        suggestedCode: queryCode.replace(/\.where\(/, `.select("id", "name").where(`),
        impact: "low",
      })
    }

    // Check for .count() after .where() — could use count index
    if (queryCode.includes(".count()") && queryCode.includes(".where(")) {
      optimizations.push({
        description: "Consider a covering index for count queries",
        reason: "A covering index allows counting without reading full rows",
        suggestedCode: queryCode,
        impact: "low",
      })
    }

    return optimizations
  }

  /**
   * Generate SQL EXPLAIN output analysis.
   */
  generateExplainPlan(queryCode: string): ExplainPlanAnalysis {
    const indexUsage: IndexUsageInfo[] = []
    const suggestions: string[] = []
    let estimatedCost = 1.0

    const tableMatch = /ctx\.db\.(\w+)/.exec(queryCode)
    const tableName = tableMatch?.[1] ?? "unknown"

    // Analyze query patterns for estimated cost
    const hasWhere = queryCode.includes(".where(")
    const hasOrderBy = queryCode.includes(".orderBy(")
    const hasLimit = queryCode.includes(".limit(")
    const hasJoin = queryCode.includes(".join(")

    if (!hasWhere) {
      // Full table scan
      indexUsage.push({ table: tableName, index: null, scanType: "full-scan" })
      estimatedCost = 100.0
      suggestions.push("Add .where() filter to avoid full table scan")
    } else {
      // Assume index usage for filtered queries
      indexUsage.push({ table: tableName, index: `idx_${tableName}_filter`, scanType: "index-scan" })
      estimatedCost = 10.0
    }

    if (hasJoin) {
      const joinMatch = /\.join\("(\w+)"\)/.exec(queryCode)
      const joinTable = joinMatch?.[1] ?? "joined"
      indexUsage.push({ table: joinTable, index: null, scanType: "full-scan" })
      estimatedCost *= 5.0
      suggestions.push(`Ensure join columns on "${joinTable}" are indexed`)
    }

    if (hasOrderBy && !hasLimit) {
      estimatedCost *= 2.0
      suggestions.push("Add .limit() when using .orderBy() to avoid sorting the full result set")
    }

    if (hasLimit) {
      estimatedCost *= 0.1
    }

    const summary =
      estimatedCost <= 10
        ? `Efficient query on "${tableName}" using index scan.`
        : estimatedCost <= 50
          ? `Moderate cost query on "${tableName}". Consider adding indexes.`
          : `Expensive query on "${tableName}". Full table scan detected.`

    return { summary, estimatedCost, indexUsage, suggestions }
  }

  /**
   * Suggest test cases for a query.
   */
  suggestTestCases(queryCode: string, schema: SchemaInfo): TestCase[] {
    const testCases: TestCase[] = []
    const tableMatch = /ctx\.db\.(\w+)/.exec(queryCode)
    const tableName = tableMatch?.[1] ?? "items"
    const table = schema.tables.find((t) => t.name === tableName)

    const isQuery = queryCode.includes("query(")
    const isMutation = queryCode.includes("mutation(")
    const hasWhere = queryCode.includes(".where(")
    const hasLimit = queryCode.includes(".limit(")

    // Happy path test
    testCases.push({
      description: `should ${isMutation ? "mutate" : "query"} ${tableName} successfully`,
      code: `it("should ${isMutation ? "mutate" : "query"} ${tableName} successfully", async () => {\n  const result = await fn(ctx${isMutation ? ", args" : ""})\n  expect(result).toBeDefined()\n})`,
      category: "happy-path",
    })

    // Empty result test for queries
    if (isQuery) {
      testCases.push({
        description: `should return empty array when no ${tableName} match`,
        code: `it("should return empty array when no ${tableName} match", async () => {\n  const result = await fn(ctx)\n  expect(result).toEqual([])\n})`,
        category: "edge-case",
      })
    }

    // Filter-specific tests
    if (hasWhere) {
      const whereMatch = /\.where\(\{([^}]+)\}\)/.exec(queryCode)
      if (whereMatch) {
        const fields = whereMatch[1].split(",").map((f) => f.trim().split(":")[0].trim())
        for (const field of fields) {
          testCases.push({
            description: `should filter by ${field} correctly`,
            code: `it("should filter by ${field} correctly", async () => {\n  // Insert test data with known ${field} values\n  const result = await fn(ctx, { ${field}: testValue })\n  expect(result.every((r: any) => r.${field} === testValue)).toBe(true)\n})`,
            category: "happy-path",
          })

          // Null/undefined test for nullable columns
          if (table) {
            const col = table.columns.find((c) => c.name === field)
            if (col?.nullable) {
              testCases.push({
                description: `should handle null ${field}`,
                code: `it("should handle null ${field}", async () => {\n  const result = await fn(ctx, { ${field}: null })\n  expect(result).toBeDefined()\n})`,
                category: "edge-case",
              })
            }
          }
        }
      }
    }

    // Limit boundary test
    if (hasLimit) {
      const limitMatch = /\.limit\((\d+)\)/.exec(queryCode)
      const limit = limitMatch?.[1] ?? "10"
      testCases.push({
        description: `should return at most ${limit} results`,
        code: `it("should return at most ${limit} results", async () => {\n  // Insert more than ${limit} rows\n  const result = await fn(ctx)\n  expect(result.length).toBeLessThanOrEqual(${limit})\n})`,
        category: "edge-case",
      })
    }

    // Error case for mutations
    if (isMutation) {
      testCases.push({
        description: "should handle invalid input gracefully",
        code: `it("should handle invalid input gracefully", async () => {\n  await expect(fn(ctx, {})).rejects.toThrow()\n})`,
        category: "error-case",
      })
    }

    // Performance test suggestion
    testCases.push({
      description: `should complete within acceptable time for ${tableName}`,
      code: `it("should complete within acceptable time", async () => {\n  const start = Date.now()\n  await fn(ctx${isMutation ? ", args" : ""})\n  expect(Date.now() - start).toBeLessThan(1000)\n})`,
      category: "performance",
    })

    return testCases
  }
}
