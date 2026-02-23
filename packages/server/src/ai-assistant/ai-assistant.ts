/**
 * AI Query Assistant & Schema Copilot.
 * Natural language to ReactiveBase query conversion, schema optimization
 * suggestions, and conversational debugging.
 *
 * Features:
 *   - Natural language → typed query code generation
 *   - Schema optimization suggestions based on access patterns
 *   - Query explanation and debugging assistance
 *   - Works with any AI provider (OpenAI, Ollama, etc.)
 *
 * Usage:
 *   const assistant = new QueryAssistant({ schema, provider: openaiProvider })
 *   const result = assistant.generateQuery("find overdue tasks for team alpha")
 *   const suggestions = assistant.suggestOptimizations(queryStats)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QueryAssistantOptions {
  /** AI provider for text generation (optional — works without for rule-based features) */
  aiProvider?: AiProviderAdapter
}

export interface AiProviderAdapter {
  name: string
  generate(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<string>
}

export interface SchemaInfo {
  tables: {
    name: string
    columns: { name: string; type: string; nullable: boolean }[]
    indexes: { name: string; columns: string[] }[]
  }[]
}

export interface QueryGenerationResult {
  /** Generated ReactiveBase query code */
  code: string
  /** Natural language explanation of what the query does */
  explanation: string
  /** Tables accessed */
  tables: string[]
  /** Confidence score (0-1) */
  confidence: number
  /** Whether AI was used or rule-based generation */
  method: "ai" | "rule-based"
}

export interface SchemaOptimization {
  type: "missing-index" | "unused-index" | "denormalization" | "type-optimization" | "relation-suggestion"
  table: string
  field?: string
  severity: "info" | "warning" | "critical"
  description: string
  suggestion: string
  /** Generated SQL or code to apply the suggestion */
  fix?: string
}

export interface QueryExplanation {
  /** What the query does in plain English */
  summary: string
  /** Detailed breakdown of each operation */
  steps: { operation: string; description: string }[]
  /** Performance considerations */
  performanceNotes: string[]
  /** Suggested indexes for better performance */
  suggestedIndexes: string[]
}

export interface AccessPattern {
  queryName: string
  tables: string[]
  filters: { column: string; operator: string }[]
  frequency: number
}

// ─── Query Pattern Matching ──────────────────────────────────────────────────

interface QueryPattern {
  pattern: RegExp
  template: (match: RegExpExecArray, schema: SchemaInfo) => string
  tables: (match: RegExpExecArray) => string[]
}

const QUERY_PATTERNS: QueryPattern[] = [
  {
    // "find X where Y = Z" or "get X by Y" — MUST come before general "find X"
    pattern: /(?:find|get)\s+(\w+)\s+(?:where|by|with)\s+(\w+)\s*(?:=|is|equals?)\s*["']?(\w+)["']?/i,
    template: (match) => {
      const table = match[1].toLowerCase()
      const field = match[2]
      return `export const get${capitalize(table)}By${capitalize(field)} = query(async (ctx, { ${field} }: { ${field}: string }) => {\n  return ctx.db.${table}.where({ ${field} })\n})`
    },
    tables: (match) => [match[1].toLowerCase()],
  },
  {
    // "find|get|list all X" or "show X"
    pattern: /(?:find|get|list|show)\s+(?:all\s+)?(\w+)/i,
    template: (match) => {
      const table = match[1].toLowerCase()
      return `export const list${capitalize(table)} = query(async (ctx) => {\n  return ctx.db.${table}.where({})\n})`
    },
    tables: (match) => [match[1].toLowerCase()],
  },
  {
    // "count X" or "how many X"
    pattern: /(?:count|how many)\s+(\w+)/i,
    template: (match) => {
      const table = match[1].toLowerCase()
      return `export const count${capitalize(table)} = query(async (ctx) => {\n  return ctx.db.${table}.count()\n})`
    },
    tables: (match) => [match[1].toLowerCase()],
  },
  {
    // "create|add|insert X"
    pattern: /(?:create|add|insert)\s+(?:a\s+)?(?:new\s+)?(\w+)/i,
    template: (match) => {
      const table = match[1].toLowerCase()
      const singular = table.replace(/s$/, "")
      return `export const create${capitalize(singular)} = mutation(async (ctx, args: Record<string, unknown>) => {\n  return ctx.db.${table}.insert(args)\n})`
    },
    tables: (match) => [match[1].toLowerCase()],
  },
  {
    // "update X" or "modify X"
    pattern: /(?:update|modify|change)\s+(?:a\s+)?(\w+)/i,
    template: (match) => {
      const table = match[1].toLowerCase()
      const singular = table.replace(/s$/, "")
      return `export const update${capitalize(singular)} = mutation(async (ctx, { id, ...data }: { id: string; [key: string]: unknown }) => {\n  return ctx.db.${table}.update(id, data)\n})`
    },
    tables: (match) => [match[1].toLowerCase()],
  },
  {
    // "delete|remove X"
    pattern: /(?:delete|remove)\s+(?:a\s+)?(\w+)/i,
    template: (match) => {
      const table = match[1].toLowerCase()
      const singular = table.replace(/s$/, "")
      return `export const delete${capitalize(singular)} = mutation(async (ctx, { id }: { id: string }) => {\n  await ctx.db.${table}.delete(id)\n})`
    },
    tables: (match) => [match[1].toLowerCase()],
  },
  {
    // "X ordered|sorted by Y"
    pattern: /(\w+)\s+(?:ordered|sorted)\s+by\s+(\w+)\s*(?:desc|descending)?/i,
    template: (match) => {
      const table = match[1].toLowerCase()
      const field = match[2]
      const desc = match[0].toLowerCase().includes("desc")
      return `export const list${capitalize(table)}By${capitalize(field)} = query(async (ctx) => {\n  return ctx.db.${table}.where({}).orderBy("${field}", "${desc ? "desc" : "asc"}")\n})`
    },
    tables: (match) => [match[1].toLowerCase()],
  },
]

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ─── Query Assistant Engine ──────────────────────────────────────────────────

export class QueryAssistant {
  private aiProvider?: AiProviderAdapter
  private schema?: SchemaInfo

  constructor(options: QueryAssistantOptions = {}) {
    this.aiProvider = options.aiProvider
  }

  /**
   * Set the current schema for context-aware generation.
   */
  setSchema(schema: SchemaInfo): void {
    this.schema = schema
  }

  /**
   * Generate a ReactiveBase query from natural language.
   */
  async generateQuery(naturalLanguage: string): Promise<QueryGenerationResult> {
    // Try rule-based matching first
    const ruleResult = this.tryRuleBased(naturalLanguage)
    if (ruleResult) return ruleResult

    // Fall back to AI if available
    if (this.aiProvider) {
      return this.generateWithAi(naturalLanguage)
    }

    return {
      code: `// Could not generate query for: "${naturalLanguage}"\n// Try being more specific, e.g., "find tasks where done = false"`,
      explanation:
        "Could not match query pattern. Try using keywords like 'find', 'create', 'update', 'delete', 'count'.",
      tables: [],
      confidence: 0,
      method: "rule-based",
    }
  }

  /**
   * Explain what a query does in plain English.
   */
  explainQuery(queryCode: string): QueryExplanation {
    const steps: { operation: string; description: string }[] = []
    const performanceNotes: string[] = []
    const suggestedIndexes: string[] = []

    // Parse common patterns
    if (queryCode.includes(".where(")) {
      const whereMatch = /\.where\(\{([^}]+)\}\)/.exec(queryCode)
      if (whereMatch) {
        const fields = whereMatch[1].split(",").map((f) => f.trim().split(":")[0].trim())
        steps.push({ operation: "Filter", description: `Filters by: ${fields.join(", ")}` })
        for (const field of fields) {
          suggestedIndexes.push(`Consider an index on "${field}" if this query runs frequently`)
        }
      }
    }
    if (queryCode.includes(".orderBy(")) {
      const orderMatch = /\.orderBy\("(\w+)"/.exec(queryCode)
      if (orderMatch) {
        steps.push({ operation: "Sort", description: `Orders by: ${orderMatch[1]}` })
      }
    }
    if (queryCode.includes(".limit(")) {
      const limitMatch = /\.limit\((\d+)\)/.exec(queryCode)
      if (limitMatch) {
        steps.push({ operation: "Limit", description: `Returns at most ${limitMatch[1]} rows` })
      }
    }
    if (queryCode.includes(".join(")) {
      steps.push({ operation: "Join", description: "Joins related tables" })
      performanceNotes.push("Joins can be expensive — ensure foreign key columns are indexed")
    }
    if (queryCode.includes(".count()")) {
      steps.push({ operation: "Count", description: "Counts matching rows" })
    }
    if (queryCode.includes("ctx.db.raw")) {
      steps.push({ operation: "Raw SQL", description: "Executes raw SQL — ensure parameters are sanitized" })
      performanceNotes.push("Raw SQL bypasses query builder optimizations — use EXPLAIN to check performance")
    }

    // Extract table from ctx.db.TABLE
    const tableMatch = /ctx\.db\.(\w+)/.exec(queryCode)
    const tableName = tableMatch?.[1] ?? "unknown"

    const summary =
      steps.length > 0
        ? `Reads from the "${tableName}" table: ${steps.map((s) => s.description.toLowerCase()).join(", ")}.`
        : `Accesses the "${tableName}" table.`

    return { summary, steps, performanceNotes, suggestedIndexes }
  }

  /**
   * Suggest schema optimizations based on access patterns.
   */
  suggestOptimizations(accessPatterns: AccessPattern[], schema?: SchemaInfo): SchemaOptimization[] {
    const s = schema ?? this.schema
    if (!s) return []

    const suggestions: SchemaOptimization[] = []

    // Analyze which columns are frequently filtered but not indexed
    const filterCounts = new Map<string, number>()
    for (const pattern of accessPatterns) {
      for (const filter of pattern.filters) {
        const key = `${pattern.tables[0]}.${filter.column}`
        filterCounts.set(key, (filterCounts.get(key) ?? 0) + pattern.frequency)
      }
    }

    for (const [tableField, count] of filterCounts) {
      const [tableName, columnName] = tableField.split(".")
      const table = s.tables.find((t) => t.name === tableName)
      if (!table) continue

      const hasIndex = table.indexes.some((idx) => idx.columns.includes(columnName))

      if (!hasIndex && count >= 10) {
        suggestions.push({
          type: "missing-index",
          table: tableName,
          field: columnName,
          severity: count >= 100 ? "critical" : "warning",
          description: `Column "${columnName}" is filtered ${count} times but has no index`,
          suggestion: `Add an index: .index("by_${columnName}", ["${columnName}"])`,
          fix: `CREATE INDEX idx_${tableName}_${columnName} ON "${tableName}" ("${columnName}");`,
        })
      }
    }

    // Check for tables accessed together that might benefit from denormalization
    const coAccessCounts = new Map<string, number>()
    for (const pattern of accessPatterns) {
      if (pattern.tables.length > 1) {
        const key = pattern.tables.sort().join("+")
        coAccessCounts.set(key, (coAccessCounts.get(key) ?? 0) + pattern.frequency)
      }
    }

    for (const [tables, count] of coAccessCounts) {
      if (count >= 50) {
        suggestions.push({
          type: "denormalization",
          table: tables,
          severity: "info",
          description: `Tables ${tables.replace("+", " and ")} are frequently queried together (${count} times)`,
          suggestion: "Consider denormalizing or using a materialized view for this access pattern",
        })
      }
    }

    return suggestions.sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 }
      return severityOrder[a.severity] - severityOrder[b.severity]
    })
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private tryRuleBased(input: string): QueryGenerationResult | null {
    for (const pattern of QUERY_PATTERNS) {
      const match = pattern.pattern.exec(input)
      if (match) {
        const code = pattern.template(match, this.schema ?? { tables: [] })
        const tables = pattern.tables(match)
        return {
          code,
          explanation: `Generated ${code.includes("mutation") ? "mutation" : "query"} for: "${input}"`,
          tables,
          confidence: 0.8,
          method: "rule-based",
        }
      }
    }
    return null
  }

  private async generateWithAi(input: string): Promise<QueryGenerationResult> {
    if (!this.aiProvider) {
      return { code: "// No AI provider", explanation: "", tables: [], confidence: 0, method: "ai" }
    }

    const schemaContext = this.schema
      ? `Available tables: ${this.schema.tables.map((t) => `${t.name}(${t.columns.map((c) => c.name).join(", ")})`).join("; ")}`
      : "No schema available"

    const prompt = `Convert this natural language to a ReactiveBase query/mutation.\n\n${schemaContext}\n\nRequest: "${input}"\n\nGenerate TypeScript code using ctx.db.TABLE.where/insert/update/delete patterns. Return only the code.`

    try {
      const code = await this.aiProvider.generate(prompt, { maxTokens: 500, temperature: 0.1 })
      const tables = Array.from(new Set(Array.from(code.matchAll(/ctx\.db\.(\w+)/g)).map((m) => m[1])))

      return {
        code,
        explanation: `AI-generated query for: "${input}"`,
        tables,
        confidence: 0.6,
        method: "ai",
      }
    } catch {
      return {
        code: `// AI generation failed for: "${input}"`,
        explanation: "AI provider error",
        tables: [],
        confidence: 0,
        method: "ai",
      }
    }
  }
}
