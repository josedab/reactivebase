/**
 * Schema-Aware Context Engine & Local AI Provider.
 * Provides schema-aware context for AI copilot features including
 * embeddings, completions, mutation generation, and migration impact analysis.
 *
 * Features:
 *   - Build compact schema representations for LLM prompts
 *   - Generate and cache text embeddings for schema elements
 *   - Find relevant schema elements for natural language queries
 *   - Suggest completions for ctx.db.* chains
 *   - Generate mutation code from natural language
 *   - Predict migration impact on existing queries
 *   - Local-first AI via Ollama with OpenAI/Anthropic fallback
 *
 * Usage:
 *   const engine = new SchemaContextEngine({ provider: localProvider })
 *   const context = engine.buildContext(schema)
 *   const completions = engine.suggestCompletions("ctx.db.users.", 14)
 */

import type { AiProviderAdapter, SchemaInfo } from "./ai-assistant.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export type AIProviderType = "ollama" | "openai" | "anthropic"

export interface LocalAIOptions {
  /** AI provider type (default: "ollama") */
  providerType?: AIProviderType
  /** Model name (default: "codellama" for Ollama) */
  model?: string
  /** API base URL (default: "http://localhost:11434" for Ollama) */
  baseUrl?: string
  /** API key for OpenAI/Anthropic providers */
  apiKey?: string
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number
  /** Embedding model name (default: "nomic-embed-text" for Ollama) */
  embeddingModel?: string
}

export interface SchemaContext {
  /** Compact schema summary for LLM prompts */
  summary: string
  /** Table names available */
  tables: string[]
  /** Column map: tableName → column info */
  columns: Record<string, { name: string; type: string; nullable: boolean }[]>
  /** Relations between tables */
  relations: { from: string; to: string; column: string }[]
  /** Token estimate for the context */
  estimatedTokens: number
}

export interface SchemaEmbedding {
  /** Schema element identifier (e.g. "users", "users.email") */
  elementId: string
  /** Type of schema element */
  elementType: "table" | "column" | "relation" | "index"
  /** Text description used for embedding */
  text: string
  /** Embedding vector */
  vector: number[]
}

export interface CompletionContext {
  /** The partial code before the cursor */
  partialCode: string
  /** Cursor position in the code */
  cursorPosition: number
  /** Detected table name, if any */
  tableName: string | null
  /** Whether cursor is after a dot */
  afterDot: boolean
  /** Current partial word being typed */
  currentWord: string
}

export interface CompletionSuggestion {
  /** Display label */
  label: string
  /** Kind of suggestion */
  kind: "table" | "column" | "method" | "snippet"
  /** Detail text */
  detail: string
  /** Text to insert */
  insertText: string
  /** Documentation string */
  documentation?: string
  /** Sort priority (lower = higher priority) */
  sortOrder: number
}

export interface MutationGenerationResult {
  /** Generated mutation code */
  code: string
  /** Natural language explanation */
  explanation: string
  /** Tables involved */
  tables: string[]
  /** Whether validation was added */
  hasValidation: boolean
  /** Whether auth check was added */
  hasAuthCheck: boolean
  /** Confidence score (0-1) */
  confidence: number
  /** Generation method used */
  method: "ai" | "rule-based"
}

export interface MigrationImpactPrediction {
  /** Overall risk level */
  riskLevel: "low" | "medium" | "high" | "critical"
  /** Queries that may be affected */
  affectedQueries: string[]
  /** Specific breaking changes detected */
  breakingChanges: { description: string; severity: "warning" | "critical" }[]
  /** Suggested remediation steps */
  remediations: string[]
  /** Whether the migration is backwards-compatible */
  backwardsCompatible: boolean
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CHAIN_METHODS = [
  {
    label: ".where",
    detail: "Filter by conditions",
    insertText: ".where({ })",
    doc: "Filter rows by field-value pairs",
  },
  {
    label: ".orderBy",
    detail: "Sort results",
    insertText: '.orderBy("field", "asc")',
    doc: "Sort by column, asc or desc",
  },
  { label: ".limit", detail: "Limit result count", insertText: ".limit(10)", doc: "Limit number of returned rows" },
  { label: ".first", detail: "Get first result", insertText: ".first()", doc: "Return only the first matching row" },
  { label: ".count", detail: "Count matching rows", insertText: ".count()", doc: "Count rows without fetching data" },
  {
    label: ".join",
    detail: "Join related table",
    insertText: '.join("table")',
    doc: "Join with a related table by foreign key",
  },
  {
    label: ".select",
    detail: "Select columns",
    insertText: '.select("col1", "col2")',
    doc: "Select specific columns to reduce transfer",
  },
  { label: ".insert", detail: "Insert a row", insertText: ".insert({ })", doc: "Insert a new row into the table" },
  { label: ".update", detail: "Update a row", insertText: ".update(id, { })", doc: "Update an existing row by id" },
  { label: ".delete", detail: "Delete a row", insertText: ".delete(id)", doc: "Delete a row by id" },
]

const MUTATION_PATTERNS: Array<{
  pattern: RegExp
  template: (match: RegExpExecArray, schema: SchemaInfo) => MutationGenerationResult
}> = [
  {
    pattern: /(?:create|add|insert)\s+(?:a\s+)?(?:new\s+)?(\w+)\s+with\s+(.+)/i,
    template: (match, _schema) => {
      const table = match[1].toLowerCase().replace(/s$/, "") + "s"
      const fields = match[2].split(/,\s*|\s+and\s+/).map((f) => f.trim())
      const fieldAssignments = fields.map((f) => `    ${f}: args.${f},`).join("\n")
      const singular = table.replace(/s$/, "")
      const code = `export const create${capitalize(singular)} = mutation(async (ctx, args: { ${fields.map((f) => `${f}: string`).join("; ")} }) => {\n  const identity = await ctx.auth.getUserIdentity()\n  if (!identity) throw new Error("Unauthenticated")\n\n  return ctx.db.${table}.insert({\n${fieldAssignments}\n  })\n})`
      return {
        code,
        explanation: `Creates a new ${singular} with fields: ${fields.join(", ")}`,
        tables: [table],
        hasValidation: false,
        hasAuthCheck: true,
        confidence: 0.8,
        method: "rule-based",
      }
    },
  },
  {
    pattern: /(?:update|modify|change)\s+(?:the\s+)?(\w+)\s+(\w+)\s+(?:to|=|with)\s+(.+)/i,
    template: (match) => {
      const table = match[1].toLowerCase().replace(/s$/, "") + "s"
      const field = match[2]
      const singular = table.replace(/s$/, "")
      const code = `export const update${capitalize(singular)}${capitalize(field)} = mutation(async (ctx, args: { id: string; ${field}: string }) => {\n  const identity = await ctx.auth.getUserIdentity()\n  if (!identity) throw new Error("Unauthenticated")\n\n  return ctx.db.${table}.update(args.id, { ${field}: args.${field} })\n})`
      return {
        code,
        explanation: `Updates the ${field} field on a ${singular}`,
        tables: [table],
        hasValidation: false,
        hasAuthCheck: true,
        confidence: 0.75,
        method: "rule-based",
      }
    },
  },
  {
    pattern: /(?:delete|remove)\s+(?:a\s+)?(\w+)/i,
    template: (match) => {
      const table = match[1].toLowerCase().replace(/s$/, "") + "s"
      const singular = table.replace(/s$/, "")
      const code = `export const delete${capitalize(singular)} = mutation(async (ctx, args: { id: string }) => {\n  const identity = await ctx.auth.getUserIdentity()\n  if (!identity) throw new Error("Unauthenticated")\n\n  await ctx.db.${table}.delete(args.id)\n})`
      return {
        code,
        explanation: `Deletes a ${singular} by id`,
        tables: [table],
        hasValidation: false,
        hasAuthCheck: true,
        confidence: 0.8,
        method: "rule-based",
      }
    },
  },
]

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ─── Local AI Provider ───────────────────────────────────────────────────────

const PROVIDER_DEFAULTS: Record<AIProviderType, { baseUrl: string; model: string; embeddingModel: string }> = {
  ollama: { baseUrl: "http://localhost:11434", model: "codellama", embeddingModel: "nomic-embed-text" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", embeddingModel: "text-embedding-3-small" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-3-haiku-20240307", embeddingModel: "" },
}

/**
 * Local-first AI provider supporting Ollama, OpenAI, and Anthropic.
 * Prioritizes local inference via Ollama, falling back to cloud providers.
 */
export class LocalAIProvider implements AiProviderAdapter {
  readonly name: string
  private providerType: AIProviderType
  private model: string
  private baseUrl: string
  private apiKey?: string
  private timeoutMs: number
  private embeddingModel: string

  constructor(options: LocalAIOptions = {}) {
    this.providerType = options.providerType ?? "ollama"
    const defaults = PROVIDER_DEFAULTS[this.providerType]
    this.model = options.model ?? defaults.model
    this.baseUrl = options.baseUrl ?? defaults.baseUrl
    this.apiKey = options.apiKey
    this.timeoutMs = options.timeoutMs ?? 30000
    this.embeddingModel = options.embeddingModel ?? defaults.embeddingModel
    this.name = `${this.providerType}:${this.model}`
  }

  /**
   * Generate a completion using the configured provider.
   */
  async generate(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<string> {
    switch (this.providerType) {
      case "ollama":
        return this.generateOllama(prompt, options)
      case "openai":
        return this.generateOpenAI(prompt, options)
      case "anthropic":
        return this.generateAnthropic(prompt, options)
    }
  }

  /**
   * Generate embeddings for the given text.
   */
  async embed(text: string): Promise<number[]> {
    switch (this.providerType) {
      case "ollama":
        return this.embedOllama(text)
      case "openai":
        return this.embedOpenAI(text)
      case "anthropic":
        // Anthropic doesn't have a native embedding API; return zero vector
        return new Array(384).fill(0)
    }
  }

  /**
   * Check if the AI service is available and responsive.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      let url: string
      let headers: Record<string, string> = {}

      switch (this.providerType) {
        case "ollama":
          url = `${this.baseUrl}/api/tags`
          break
        case "openai":
          url = `${this.baseUrl}/models`
          headers = { Authorization: `Bearer ${this.apiKey}` }
          break
        case "anthropic":
          // Anthropic has no lightweight health-check endpoint
          url = `${this.baseUrl}/messages`
          headers = { "x-api-key": this.apiKey ?? "", "anthropic-version": "2023-06-01" }
          clearTimeout(timeout)
          return !!this.apiKey
      }

      const response = await fetch(url, { signal: controller.signal, headers })
      clearTimeout(timeout)
      return response.ok
    } catch {
      return false
    }
  }

  // ─── Internal: Ollama ───────────────────────────────────────────────────

  private async generateOllama(
    prompt: string,
    options?: { maxTokens?: number; temperature?: number },
  ): Promise<string> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          options: {
            num_predict: options?.maxTokens ?? 500,
            temperature: options?.temperature ?? 0.1,
          },
        }),
        signal: controller.signal,
      })

      clearTimeout(timeout)
      if (!response.ok) throw new Error(`Ollama API error: ${response.status}`)
      const data = (await response.json()) as { response: string }
      return data.response
    } catch (error: unknown) {
      clearTimeout(timeout)
      const msg = error instanceof Error ? error.message : "Unknown error"
      throw new Error(`Ollama inference failed (${this.model}): ${msg}`)
    }
  }

  private async embedOllama(text: string): Promise<number[]> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.embeddingModel, prompt: text }),
        signal: controller.signal,
      })

      clearTimeout(timeout)
      if (!response.ok) throw new Error(`Ollama embedding error: ${response.status}`)
      const data = (await response.json()) as { embedding: number[] }
      return data.embedding
    } catch (error: unknown) {
      clearTimeout(timeout)
      const msg = error instanceof Error ? error.message : "Unknown error"
      throw new Error(`Ollama embedding failed: ${msg}`)
    }
  }

  // ─── Internal: OpenAI ───────────────────────────────────────────────────

  private async generateOpenAI(
    prompt: string,
    options?: { maxTokens?: number; temperature?: number },
  ): Promise<string> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: options?.maxTokens ?? 500,
          temperature: options?.temperature ?? 0.1,
        }),
        signal: controller.signal,
      })

      clearTimeout(timeout)
      if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`)
      const data = (await response.json()) as { choices: [{ message: { content: string } }] }
      return data.choices[0].message.content
    } catch (error: unknown) {
      clearTimeout(timeout)
      const msg = error instanceof Error ? error.message : "Unknown error"
      throw new Error(`OpenAI inference failed (${this.model}): ${msg}`)
    }
  }

  private async embedOpenAI(text: string): Promise<number[]> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.embeddingModel, input: text }),
        signal: controller.signal,
      })

      clearTimeout(timeout)
      if (!response.ok) throw new Error(`OpenAI embedding error: ${response.status}`)
      const data = (await response.json()) as { data: [{ embedding: number[] }] }
      return data.data[0].embedding
    } catch (error: unknown) {
      clearTimeout(timeout)
      const msg = error instanceof Error ? error.message : "Unknown error"
      throw new Error(`OpenAI embedding failed: ${msg}`)
    }
  }

  // ─── Internal: Anthropic ────────────────────────────────────────────────

  private async generateAnthropic(
    prompt: string,
    options?: { maxTokens?: number; temperature?: number },
  ): Promise<string> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: options?.maxTokens ?? 500,
          temperature: options?.temperature ?? 0.1,
        }),
        signal: controller.signal,
      })

      clearTimeout(timeout)
      if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`)
      const data = (await response.json()) as { content: [{ text: string }] }
      return data.content[0].text
    } catch (error: unknown) {
      clearTimeout(timeout)
      const msg = error instanceof Error ? error.message : "Unknown error"
      throw new Error(`Anthropic inference failed (${this.model}): ${msg}`)
    }
  }
}

// ─── Schema Context Engine ───────────────────────────────────────────────────

/**
 * Schema-aware context engine for AI copilot features.
 * Builds compact schema representations, generates embeddings,
 * and provides intelligent completions and code generation.
 */
export class SchemaContextEngine {
  private provider?: AiProviderAdapter
  private embeddingCache = new Map<string, SchemaEmbedding[]>()
  private schemaCacheKey: string | null = null

  constructor(options: { provider?: AiProviderAdapter } = {}) {
    this.provider = options.provider
  }

  /**
   * Build a compact schema representation for LLM prompts.
   */
  buildContext(schema: SchemaInfo): SchemaContext {
    const tables = schema.tables.map((t) => t.name)
    const columns: Record<string, { name: string; type: string; nullable: boolean }[]> = {}
    const relations: { from: string; to: string; column: string }[] = []

    for (const table of schema.tables) {
      columns[table.name] = table.columns.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable,
      }))

      // Detect relations from foreign key columns (columns ending in Id)
      for (const col of table.columns) {
        if (col.name.endsWith("Id") && col.name.length > 2) {
          const referencedTable = col.name.slice(0, -2) + "s"
          if (schema.tables.some((t) => t.name === referencedTable)) {
            relations.push({ from: table.name, to: referencedTable, column: col.name })
          }
        }
      }
    }

    const summary = this.buildSummaryText(schema)
    const estimatedTokens = Math.ceil(summary.length / 4)

    return { summary, tables, columns, relations, estimatedTokens }
  }

  /**
   * Generate text embeddings for all schema elements.
   * Results are cached and invalidated on schema changes.
   */
  async generateEmbeddings(schema: SchemaInfo): Promise<SchemaEmbedding[]> {
    const cacheKey = this.computeSchemaCacheKey(schema)

    if (this.schemaCacheKey === cacheKey && this.embeddingCache.has(cacheKey)) {
      return this.embeddingCache.get(cacheKey)!
    }

    const embeddings: SchemaEmbedding[] = []

    for (const table of schema.tables) {
      // Table-level embedding
      const tableText = `Table ${table.name} with columns: ${table.columns.map((c) => `${c.name} (${c.type})`).join(", ")}`
      const tableVector = await this.getEmbedding(tableText)
      embeddings.push({
        elementId: table.name,
        elementType: "table",
        text: tableText,
        vector: tableVector,
      })

      // Column-level embeddings
      for (const col of table.columns) {
        const colText = `Column ${col.name} of type ${col.type} in table ${table.name}${col.nullable ? " (nullable)" : ""}`
        const colVector = await this.getEmbedding(colText)
        embeddings.push({
          elementId: `${table.name}.${col.name}`,
          elementType: "column",
          text: colText,
          vector: colVector,
        })
      }

      // Index-level embeddings
      for (const idx of table.indexes) {
        const idxText = `Index ${idx.name} on table ${table.name} covering columns: ${idx.columns.join(", ")}`
        const idxVector = await this.getEmbedding(idxText)
        embeddings.push({
          elementId: `${table.name}.idx.${idx.name}`,
          elementType: "index",
          text: idxText,
          vector: idxVector,
        })
      }
    }

    this.schemaCacheKey = cacheKey
    this.embeddingCache.set(cacheKey, embeddings)

    return embeddings
  }

  /**
   * Find the most relevant schema elements for a natural language query.
   */
  async findRelevantSchema(query: string, topK: number = 5): Promise<Array<SchemaEmbedding & { score: number }>> {
    const cacheKey = this.schemaCacheKey
    if (!cacheKey || !this.embeddingCache.has(cacheKey)) {
      return []
    }

    const embeddings = this.embeddingCache.get(cacheKey)!
    const queryVector = await this.getEmbedding(query)

    // Compute cosine similarity and rank
    const scored = embeddings.map((emb) => ({
      ...emb,
      score: this.cosineSimilarity(queryVector, emb.vector),
    }))

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK)
  }

  /**
   * Generate completion suggestions for ctx.db.* chains.
   */
  suggestCompletions(partialCode: string, cursorPosition: number, schema?: SchemaInfo): CompletionSuggestion[] {
    const ctx = this.parseCompletionContext(partialCode, cursorPosition)
    const suggestions: CompletionSuggestion[] = []

    if (!schema) return suggestions

    // After "ctx.db." → suggest table names
    if (
      ctx.partialCode.substring(0, ctx.cursorPosition).trimEnd().endsWith("ctx.db.") ||
      /ctx\.db\.\w*$/.test(ctx.partialCode.substring(0, ctx.cursorPosition))
    ) {
      for (const table of schema.tables) {
        if (!ctx.currentWord || table.name.startsWith(ctx.currentWord)) {
          suggestions.push({
            label: table.name,
            kind: "table",
            detail: `Table (${table.columns.length} columns)`,
            insertText: table.name,
            documentation: `Columns: ${table.columns.map((c) => `${c.name}: ${c.type}`).join(", ")}`,
            sortOrder: 0,
          })
        }
      }
      return suggestions
    }

    // After "ctx.db.TABLE." → suggest chain methods and columns
    if (ctx.tableName && ctx.afterDot) {
      const table = schema.tables.find((t) => t.name === ctx.tableName)

      for (const method of CHAIN_METHODS) {
        suggestions.push({
          label: method.label,
          kind: "method",
          detail: method.detail,
          insertText: method.insertText,
          documentation: method.doc,
          sortOrder: 1,
        })
      }

      // Inside .where({}) → suggest column names
      if (ctx.partialCode.substring(0, ctx.cursorPosition).includes(".where({") && table) {
        for (const col of table.columns) {
          suggestions.push({
            label: col.name,
            kind: "column",
            detail: `${col.type}${col.nullable ? " (nullable)" : ""}`,
            insertText: `${col.name}: `,
            documentation: `Column "${col.name}" on table "${ctx.tableName}"`,
            sortOrder: 0,
          })
        }
      }

      return suggestions
    }

    return suggestions
  }

  /**
   * Generate mutation code from a natural language description.
   */
  async generateMutation(naturalLanguage: string, schema: SchemaInfo): Promise<MutationGenerationResult> {
    // Try rule-based matching first
    for (const { pattern, template } of MUTATION_PATTERNS) {
      const match = pattern.exec(naturalLanguage)
      if (match) {
        return template(match, schema)
      }
    }

    // Fall back to AI provider if available
    if (this.provider) {
      return this.generateMutationWithAI(naturalLanguage, schema)
    }

    return {
      code: `// Could not generate mutation for: "${naturalLanguage}"\n// Try: "create a user with name and email" or "delete a post"`,
      explanation: "Could not match mutation pattern. Try using create/update/delete keywords.",
      tables: [],
      hasValidation: false,
      hasAuthCheck: false,
      confidence: 0,
      method: "rule-based",
    }
  }

  /**
   * Predict the impact of a migration on existing queries.
   */
  predictMigrationImpact(migration: string, schema: SchemaInfo): MigrationImpactPrediction {
    const affectedQueries: string[] = []
    const breakingChanges: { description: string; severity: "warning" | "critical" }[] = []
    const remediations: string[] = []

    // Detect dropped tables
    const droppedTables = Array.from(migration.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi))
    for (const match of droppedTables) {
      const tableName = match[1]
      breakingChanges.push({
        description: `Table "${tableName}" will be dropped — all queries referencing it will break`,
        severity: "critical",
      })
      affectedQueries.push(`ctx.db.${tableName}.*`)
      remediations.push(`Update all code referencing ctx.db.${tableName} before running this migration`)
    }

    // Detect dropped columns
    const droppedCols = Array.from(migration.matchAll(/DROP\s+COLUMN\s+"?(\w+)"?/gi))
    const tableForDrop = /ALTER\s+TABLE\s+"?(\w+)"?/i.exec(migration)
    for (const match of droppedCols) {
      const colName = match[1]
      const tableName = tableForDrop?.[1] ?? "unknown"
      breakingChanges.push({
        description: `Column "${colName}" will be dropped from "${tableName}" — queries using this column will fail`,
        severity: "critical",
      })
      affectedQueries.push(`ctx.db.${tableName}.where({ ${colName}: ... })`)
      remediations.push(`Remove references to "${colName}" in queries before dropping the column`)
    }

    // Detect renamed columns
    const renamedCols = Array.from(migration.matchAll(/RENAME\s+(?:COLUMN\s+)?"?(\w+)"?\s+TO\s+"?(\w+)"?/gi))
    for (const match of renamedCols) {
      const oldName = match[1]
      const newName = match[2]
      const tableName = tableForDrop?.[1] ?? "unknown"
      breakingChanges.push({
        description: `Column "${oldName}" renamed to "${newName}" on "${tableName}" — existing references will break`,
        severity: "critical",
      })
      affectedQueries.push(`ctx.db.${tableName}.where({ ${oldName}: ... })`)
      remediations.push(`Update all references from "${oldName}" to "${newName}"`)
    }

    // Detect type changes
    const typeChanges = Array.from(migration.matchAll(/ALTER\s+COLUMN\s+"?(\w+)"?\s+(?:SET\s+DATA\s+)?TYPE\s+(\w+)/gi))
    for (const match of typeChanges) {
      const colName = match[1]
      const newType = match[2]
      const tableName = tableForDrop?.[1] ?? "unknown"
      breakingChanges.push({
        description: `Column "${colName}" type changed to ${newType} on "${tableName}" — may cause data conversion issues`,
        severity: "warning",
      })
      remediations.push(`Verify that existing data in "${colName}" is compatible with type ${newType}`)
    }

    // Detect NOT NULL additions
    if (/SET\s+NOT\s+NULL/i.test(migration)) {
      const colMatch = /ALTER\s+COLUMN\s+"?(\w+)"?\s+SET\s+NOT\s+NULL/i.exec(migration)
      if (colMatch) {
        const tableName = tableForDrop?.[1] ?? "unknown"
        breakingChanges.push({
          description: `Column "${colMatch[1]}" set to NOT NULL on "${tableName}" — inserts without this field will fail`,
          severity: "warning",
        })
        remediations.push(`Ensure all insert operations include a value for "${colMatch[1]}"`)
      }
    }

    // Check if any indexed columns are affected
    for (const table of schema.tables) {
      for (const idx of table.indexes) {
        for (const col of idx.columns) {
          if (droppedCols.some((m) => m[1] === col)) {
            breakingChanges.push({
              description: `Index "${idx.name}" on "${table.name}" uses dropped column "${col}"`,
              severity: "warning",
            })
            remediations.push(`Index "${idx.name}" will need to be recreated or removed`)
          }
        }
      }
    }

    // Determine overall risk level
    const hasCritical = breakingChanges.some((c) => c.severity === "critical")
    const warningCount = breakingChanges.filter((c) => c.severity === "warning").length
    let riskLevel: MigrationImpactPrediction["riskLevel"] = "low"
    if (hasCritical) riskLevel = droppedTables.length > 0 ? "critical" : "high"
    else if (warningCount >= 3) riskLevel = "high"
    else if (warningCount >= 1) riskLevel = "medium"

    const backwardsCompatible = breakingChanges.length === 0

    return {
      riskLevel,
      affectedQueries,
      breakingChanges,
      remediations,
      backwardsCompatible,
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private buildSummaryText(schema: SchemaInfo): string {
    const tableDescs = schema.tables
      .map((t) => {
        const cols = t.columns.map((c) => `${c.name}: ${c.type}${c.nullable ? "?" : ""}`).join(", ")
        const idxs = t.indexes.length > 0 ? ` [indexes: ${t.indexes.map((i) => i.name).join(", ")}]` : ""
        return `  ${t.name}(${cols})${idxs}`
      })
      .join("\n")

    return `Database schema:\n${tableDescs}`
  }

  private async getEmbedding(text: string): Promise<number[]> {
    if (this.provider && "embed" in this.provider) {
      return (this.provider as LocalAIProvider).embed(text)
    }
    // Fallback: simple hash-based pseudo-embedding for offline use
    return this.pseudoEmbed(text)
  }

  private pseudoEmbed(text: string): number[] {
    const dim = 384
    const vector = new Array(dim).fill(0)
    const words = text.toLowerCase().split(/\s+/)
    for (let i = 0; i < words.length; i++) {
      const word = words[i]
      for (let j = 0; j < word.length; j++) {
        const idx = (word.charCodeAt(j) * 31 + i * 7 + j) % dim
        vector[idx] += 1.0 / words.length
      }
    }
    // Normalize
    const magnitude = Math.sqrt(vector.reduce((sum: number, v: number) => sum + v * v, 0))
    if (magnitude > 0) {
      for (let i = 0; i < dim; i++) vector[i] /= magnitude
    }
    return vector
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0
    let dot = 0
    let magA = 0
    let magB = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      magA += a[i] * a[i]
      magB += b[i] * b[i]
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB)
    return denom === 0 ? 0 : dot / denom
  }

  private computeSchemaCacheKey(schema: SchemaInfo): string {
    const parts = schema.tables
      .map((t) => `${t.name}:${t.columns.map((c) => `${c.name}/${c.type}`).join(",")}`)
      .sort()
      .join("|")
    // Simple hash
    let hash = 0
    for (let i = 0; i < parts.length; i++) {
      hash = ((hash << 5) - hash + parts.charCodeAt(i)) | 0
    }
    return `schema_${hash}`
  }

  private parseCompletionContext(partialCode: string, cursorPosition: number): CompletionContext {
    const beforeCursor = partialCode.substring(0, cursorPosition)
    const afterDot = beforeCursor.trimEnd().endsWith(".")

    const wordMatch = /(\w*)$/.exec(beforeCursor)
    const currentWord = wordMatch?.[1] ?? ""

    const tableMatch = /ctx\.db\.(\w+)\s*\.?\s*$/.exec(beforeCursor)
    const tableName = tableMatch?.[1] ?? null

    return { partialCode, cursorPosition, tableName, afterDot, currentWord }
  }

  private async generateMutationWithAI(naturalLanguage: string, schema: SchemaInfo): Promise<MutationGenerationResult> {
    if (!this.provider) {
      return {
        code: "// No AI provider available",
        explanation: "",
        tables: [],
        hasValidation: false,
        hasAuthCheck: false,
        confidence: 0,
        method: "ai",
      }
    }

    const context = this.buildContext(schema)
    const prompt = `Generate a ReactiveBase mutation from this description.\n\n${context.summary}\n\nDescription: "${naturalLanguage}"\n\nGenerate a TypeScript mutation using ctx.db.TABLE.insert/update/delete patterns. Include ctx.auth check. Return only the code.`

    try {
      const code = await this.provider.generate(prompt, { maxTokens: 500, temperature: 0.1 })
      const tables = Array.from(new Set(Array.from(code.matchAll(/ctx\.db\.(\w+)/g)).map((m) => m[1])))
      const hasAuthCheck = code.includes("ctx.auth")

      return {
        code,
        explanation: `AI-generated mutation for: "${naturalLanguage}"`,
        tables,
        hasValidation: false,
        hasAuthCheck,
        confidence: 0.6,
        method: "ai",
      }
    } catch {
      return {
        code: `// AI generation failed for: "${naturalLanguage}"`,
        explanation: "AI provider error",
        tables: [],
        hasValidation: false,
        hasAuthCheck: false,
        confidence: 0,
        method: "ai",
      }
    }
  }
}
