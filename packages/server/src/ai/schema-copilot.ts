/**
 * AI Schema & Query Copilot for ReactiveBase.
 * Multi-turn schema generation from natural language, query optimization,
 * migration generation, and EXPLAIN ANALYZE interpretation.
 *
 * Features:
 *   - Multi-turn conversational schema design
 *   - Natural language → defineSchema() code generation
 *   - Index suggestions based on query patterns
 *   - Schema migration SQL generation
 *   - EXPLAIN ANALYZE output interpretation
 *   - Natural language → SQL query generation
 *   - Query structure analysis and optimization
 *
 * Usage:
 *   const copilot = new SchemaCopilot({ aiProvider: openaiProvider() })
 *   const result = await copilot.generateSchema("a blog with posts and comments")
 *   const conv = copilot.startConversation()
 *   const reply = await copilot.continueConversation("add a tags table")
 */

import type { AiProvider, GenerateOptions } from "./ai.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SchemaCopilotOptions {
  /** AI provider for text generation */
  aiProvider: AiProvider
  /** Default generation options */
  defaultGenerateOptions?: GenerateOptions
}

export interface ConversationMessage {
  /** Role of the message author */
  role: "user" | "assistant" | "system"
  /** Message content */
  content: string
  /** Timestamp of the message */
  timestamp: number
}

export interface ConversationHistory {
  /** Unique conversation identifier */
  id: string
  /** All messages in order */
  messages: ConversationMessage[]
  /** When the conversation started */
  startedAt: number
  /** When the conversation was last updated */
  updatedAt: number
}

export interface SchemaGenerationResult {
  /** Generated defineSchema() code */
  code: string
  /** Natural language explanation of the schema */
  explanation: string
  /** Tables included in the schema */
  tables: string[]
  /** Warnings or suggestions */
  warnings: string[]
}

export interface IndexSuggestion {
  /** Table the index belongs to */
  table: string
  /** Columns included in the index */
  columns: string[]
  /** Suggested index name */
  name: string
  /** Why this index is recommended */
  reason: string
  /** Expected impact */
  impact: "low" | "medium" | "high"
}

export interface MigrationResult {
  /** Generated migration SQL statements */
  upSql: string
  /** Rollback SQL statements */
  downSql: string
  /** Whether the migration contains destructive operations */
  destructive: boolean
  /** Warnings about the migration */
  warnings: string[]
}

export interface QueryExplanation {
  /** Plain English summary of the query plan */
  summary: string
  /** Detailed breakdown of each step */
  steps: { operation: string; description: string }[]
  /** Performance bottlenecks identified */
  bottlenecks: string[]
  /** Suggested improvements */
  suggestions: string[]
}

export interface OptimizationSuggestion {
  /** What to optimize */
  description: string
  /** Why the optimization helps */
  reason: string
  /** Suggested rewrite or index */
  suggestedFix: string
  /** Expected impact */
  impact: "low" | "medium" | "high"
}

// ─── SQL Builders ────────────────────────────────────────────────────────────

/** SQL to create the conversation history table */
export const CREATE_CONVERSATION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_copilot_conversations (
  id TEXT PRIMARY KEY,
  messages TEXT NOT NULL DEFAULT '[]',
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

/** Insert or update a conversation record */
export function buildUpsertConversationSql(history: ConversationHistory): {
  sql: string
  params: unknown[]
} {
  return {
    sql: `INSERT INTO schema_copilot_conversations (id, messages, started_at, updated_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET messages = $2, updated_at = $4`,
    params: [history.id, JSON.stringify(history.messages), history.startedAt, history.updatedAt],
  }
}

/** Load a conversation by id */
export function buildLoadConversationSql(id: string): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT id, messages, started_at, updated_at FROM schema_copilot_conversations WHERE id = $1`,
    params: [id],
  }
}

// ─── Schema Copilot ──────────────────────────────────────────────────────────

export class SchemaCopilot {
  private aiProvider: AiProvider
  private defaultOptions: GenerateOptions
  private conversation: ConversationHistory | null = null

  constructor(options: SchemaCopilotOptions) {
    this.aiProvider = options.aiProvider
    this.defaultOptions = options.defaultGenerateOptions ?? {}
  }

  /**
   * Generate a defineSchema() code block from a natural language description.
   */
  async generateSchema(description: string): Promise<SchemaGenerationResult> {
    const systemPrompt = [
      "You are a ReactiveBase schema design expert.",
      "Generate a complete defineSchema() code block from the user's description.",
      "Use ReactiveBase conventions: defineSchema, defineTable, v.text(), v.number(), v.boolean(), v.optional().",
      "Include appropriate indexes for foreign key columns.",
      "Return JSON with keys: code (string), explanation (string), tables (string[]), warnings (string[]).",
    ].join("\n")

    const result = await this.generate(`Generate a ReactiveBase schema for: "${description}"`, systemPrompt)

    try {
      const parsed = JSON.parse(result.text)
      return {
        code: parsed.code ?? "",
        explanation: parsed.explanation ?? "",
        tables: parsed.tables ?? [],
        warnings: parsed.warnings ?? [],
      }
    } catch {
      // If the AI returned raw code instead of JSON, wrap it
      return {
        code: result.text,
        explanation: "Generated schema from description",
        tables: [],
        warnings: ["Response was not structured JSON — raw code returned"],
      }
    }
  }

  /**
   * Analyze query patterns and suggest indexes for a schema.
   */
  async suggestIndexes(schemaCode: string, queryPatterns: string[]): Promise<IndexSuggestion[]> {
    const systemPrompt = [
      "You are a database indexing expert for ReactiveBase.",
      "Analyze the schema and query patterns to suggest optimal indexes.",
      "Return a JSON array of objects with keys: table, columns (string[]), name, reason, impact (low|medium|high).",
    ].join("\n")

    const prompt = [
      "Schema:",
      schemaCode,
      "",
      "Query patterns:",
      ...queryPatterns.map((p, i) => `${i + 1}. ${p}`),
      "",
      "Suggest indexes to optimize these query patterns.",
    ].join("\n")

    const result = await this.generate(prompt, systemPrompt)

    try {
      const parsed = JSON.parse(result.text)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  /**
   * Generate migration SQL from one schema version to another.
   */
  async generateMigration(fromSchema: string, toSchema: string): Promise<MigrationResult> {
    const systemPrompt = [
      "You are a database migration expert for ReactiveBase.",
      "Generate safe migration SQL to transform one schema into another.",
      "Return JSON with keys: upSql (string), downSql (string), destructive (boolean), warnings (string[]).",
    ].join("\n")

    const prompt = [
      "Current schema:",
      fromSchema,
      "",
      "Target schema:",
      toSchema,
      "",
      "Generate migration SQL including rollback.",
    ].join("\n")

    const result = await this.generate(prompt, systemPrompt)

    try {
      const parsed = JSON.parse(result.text)
      return {
        upSql: parsed.upSql ?? "",
        downSql: parsed.downSql ?? "",
        destructive: parsed.destructive ?? false,
        warnings: parsed.warnings ?? [],
      }
    } catch {
      return {
        upSql: result.text,
        downSql: "",
        destructive: true,
        warnings: ["Could not parse structured migration — review carefully"],
      }
    }
  }

  /**
   * Explain EXPLAIN ANALYZE output in plain English.
   */
  async explainQueryPlan(query: string, schema: string): Promise<QueryExplanation> {
    const systemPrompt = [
      "You are a query performance expert for ReactiveBase.",
      "Explain the query and its execution plan in plain English.",
      "Return JSON with keys: summary (string), steps (array of {operation, description}),",
      "bottlenecks (string[]), suggestions (string[]).",
    ].join("\n")

    const prompt = [
      "Query:",
      query,
      "",
      "Schema:",
      schema,
      "",
      "Explain the query plan and suggest improvements.",
    ].join("\n")

    const result = await this.generate(prompt, systemPrompt)

    try {
      const parsed = JSON.parse(result.text)
      return {
        summary: parsed.summary ?? "",
        steps: parsed.steps ?? [],
        bottlenecks: parsed.bottlenecks ?? [],
        suggestions: parsed.suggestions ?? [],
      }
    } catch {
      return {
        summary: result.text,
        steps: [],
        bottlenecks: [],
        suggestions: [],
      }
    }
  }

  /**
   * Start a new multi-turn conversation.
   */
  startConversation(): ConversationHistory {
    const now = Date.now()
    this.conversation = {
      id: `conv_${now}_${crypto.randomUUID()}`,
      messages: [
        {
          role: "system",
          content:
            "You are a ReactiveBase schema design copilot. Help the user iteratively design " +
            "and refine their database schema. Use defineSchema(), defineTable(), and v.* validators. " +
            "Remember previous messages in this conversation.",
          timestamp: now,
        },
      ],
      startedAt: now,
      updatedAt: now,
    }
    return this.conversation
  }

  /**
   * Continue an existing multi-turn conversation.
   */
  async continueConversation(message: string): Promise<ConversationMessage> {
    if (!this.conversation) {
      this.startConversation()
    }

    const now = Date.now()
    const userMessage: ConversationMessage = { role: "user", content: message, timestamp: now }
    this.conversation!.messages.push(userMessage)

    // Build the full prompt from conversation history
    const historyPrompt = this.conversation!.messages.map((m) => `${m.role}: ${m.content}`).join("\n\n")

    const result = await this.generate(historyPrompt, undefined)

    const assistantMessage: ConversationMessage = {
      role: "assistant",
      content: result.text,
      timestamp: Date.now(),
    }
    this.conversation!.messages.push(assistantMessage)
    this.conversation!.updatedAt = Date.now()

    return assistantMessage
  }

  /**
   * Get the current conversation history.
   */
  getHistory(): ConversationHistory | null {
    return this.conversation
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private async generate(prompt: string, systemPrompt: string | undefined) {
    if (!this.aiProvider.generate) {
      throw new Error(`Provider "${this.aiProvider.name}" does not support generation`)
    }
    return this.aiProvider.generate(prompt, {
      ...this.defaultOptions,
      systemPrompt: systemPrompt ?? this.defaultOptions.systemPrompt,
    })
  }
}

// ─── Query Builder Assistant ─────────────────────────────────────────────────

export class QueryBuilderAssistant {
  private aiProvider: AiProvider
  private defaultOptions: GenerateOptions

  constructor(options: SchemaCopilotOptions) {
    this.aiProvider = options.aiProvider
    this.defaultOptions = options.defaultGenerateOptions ?? {}
  }

  /**
   * Parse and explain a SQL query's structure.
   */
  async analyzeQuery(sql: string): Promise<QueryExplanation> {
    const systemPrompt = [
      "You are a SQL query analysis expert.",
      "Break down the query into its component operations and explain each.",
      "Return JSON with keys: summary (string), steps (array of {operation, description}),",
      "bottlenecks (string[]), suggestions (string[]).",
    ].join("\n")

    const result = await this.generate(`Analyze this SQL query:\n\n${sql}`, systemPrompt)

    try {
      const parsed = JSON.parse(result.text)
      return {
        summary: parsed.summary ?? "",
        steps: parsed.steps ?? [],
        bottlenecks: parsed.bottlenecks ?? [],
        suggestions: parsed.suggestions ?? [],
      }
    } catch {
      return {
        summary: result.text,
        steps: [],
        bottlenecks: [],
        suggestions: [],
      }
    }
  }

  /**
   * Suggest optimizations for a query given its EXPLAIN output.
   */
  async suggestOptimizations(sql: string, explainOutput: string): Promise<OptimizationSuggestion[]> {
    const systemPrompt = [
      "You are a database performance optimization expert.",
      "Analyze the query and its EXPLAIN output to suggest improvements.",
      "Return a JSON array of objects with keys: description, reason, suggestedFix, impact (low|medium|high).",
    ].join("\n")

    const prompt = ["Query:", sql, "", "EXPLAIN output:", explainOutput, "", "Suggest optimizations."].join("\n")

    const result = await this.generate(prompt, systemPrompt)

    try {
      const parsed = JSON.parse(result.text)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  /**
   * Generate a SQL query from a natural language description.
   */
  async generateQuery(naturalLanguage: string, schema: string): Promise<string> {
    const systemPrompt = [
      "You are a SQL query generation expert for ReactiveBase.",
      "Generate a valid SQL query from the natural language description using the provided schema.",
      "Return only the SQL query, no explanations.",
    ].join("\n")

    const prompt = ["Schema:", schema, "", `Request: ${naturalLanguage}`].join("\n")

    const result = await this.generate(prompt, systemPrompt)
    return result.text.trim()
  }

  /**
   * Generate an EXPLAIN ANALYZE SQL wrapper for a query.
   */
  explainAnalyze(sql: string): string {
    const trimmed = sql.trim().replace(/;$/, "")
    return `EXPLAIN ANALYZE ${trimmed};`
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private async generate(prompt: string, systemPrompt: string | undefined) {
    if (!this.aiProvider.generate) {
      throw new Error(`Provider "${this.aiProvider.name}" does not support generation`)
    }
    return this.aiProvider.generate(prompt, {
      ...this.defaultOptions,
      systemPrompt: systemPrompt ?? this.defaultOptions.systemPrompt,
    })
  }
}
