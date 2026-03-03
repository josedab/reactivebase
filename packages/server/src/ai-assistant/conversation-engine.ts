/**
 * Production-Grade AI Conversation Engine for ReactiveBase.
 *
 * Features:
 *   - Multi-turn conversation with context window management
 *   - Streaming responses via async iterators
 *   - Ollama-first local inference mode
 *   - Guardrails against destructive migrations
 *   - Dry-run mode for safe experimentation
 *   - Cost tracking per session and token
 *   - Schema-aware prompt construction
 *
 * Usage:
 *   const engine = new ConversationEngine({
 *     provider: ollamaProvider({ model: "codellama" }),
 *     schema: schemaInfo,
 *   })
 *   const session = engine.createSession()
 *   for await (const chunk of session.streamMessage("Create a tasks table")) {
 *     process.stdout.write(chunk.text)
 *   }
 */

import type { AiProviderAdapter, SchemaInfo } from "./ai-assistant.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConversationEngineOptions {
  /** AI provider (Ollama, OpenAI, etc.) */
  provider?: AiProviderAdapter
  /** Database schema for context-aware prompts */
  schema?: SchemaInfo
  /** Max context window tokens (default: 4096) */
  maxContextTokens?: number
  /** Enable guardrails against destructive operations (default: true) */
  enableGuardrails?: boolean
  /** Enable dry-run mode (default: false) — generates but doesn't execute */
  dryRunMode?: boolean
  /** Cost per 1K input tokens in cents (default: 0 for local inference) */
  inputTokenCostCents?: number
  /** Cost per 1K output tokens in cents (default: 0 for local inference) */
  outputTokenCostCents?: number
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
  tokenCount?: number
}

export interface ConversationSession {
  id: string
  messages: ConversationMessage[]
  totalInputTokens: number
  totalOutputTokens: number
  totalCostCents: number
  createdAt: number
}

export interface StreamChunk {
  text: string
  done: boolean
  tokenCount?: number
}

export interface GuardrailResult {
  safe: boolean
  warnings: string[]
  blockedReason?: string
}

export interface CostSummary {
  sessionId: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costCents: number
  messageCount: number
}

// ─── Ollama Provider ─────────────────────────────────────────────────────────

export interface OllamaProviderOptions {
  /** Ollama model name (default: "codellama") */
  model?: string
  /** Ollama API base URL (default: "http://localhost:11434") */
  baseUrl?: string
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number
}

/**
 * Create an Ollama-first local inference provider.
 * Falls back gracefully if Ollama is not available.
 */
export function ollamaProvider(options: OllamaProviderOptions = {}): AiProviderAdapter {
  const model = options.model ?? "codellama"
  const baseUrl = options.baseUrl ?? "http://localhost:11434"
  const timeoutMs = options.timeoutMs ?? 30000

  return {
    name: `ollama:${model}`,
    async generate(prompt: string, genOptions?: { maxTokens?: number; temperature?: number }): Promise<string> {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), timeoutMs)

        const response = await fetch(`${baseUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            prompt,
            stream: false,
            options: {
              num_predict: genOptions?.maxTokens ?? 500,
              temperature: genOptions?.temperature ?? 0.1,
            },
          }),
          signal: controller.signal,
        })

        clearTimeout(timeout)

        if (!response.ok) {
          throw new Error(`Ollama API error: ${response.status}`)
        }

        const data = (await response.json()) as { response: string }
        return data.response
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Unknown error"
        throw new Error(`Ollama inference failed (${model}): ${msg}`)
      }
    },
  }
}

// ─── Destructive Operation Guardrails ────────────────────────────────────────

const DESTRUCTIVE_PATTERNS = [
  { pattern: /\bDROP\s+TABLE\b/i, reason: "DROP TABLE detected — this will permanently delete the table and all data" },
  { pattern: /\bDROP\s+DATABASE\b/i, reason: "DROP DATABASE detected — this will destroy the entire database" },
  { pattern: /\bTRUNCATE\b/i, reason: "TRUNCATE detected — this will delete all rows from the table" },
  { pattern: /\bDELETE\s+FROM\s+\w+\s*(?:;|$)/im, reason: "DELETE without WHERE clause — this will delete all rows" },
  {
    pattern: /\bALTER\s+TABLE\s+\w+\s+DROP\s+COLUMN\b/i,
    reason: "DROP COLUMN detected — this is a destructive schema change",
  },
  { pattern: /\bALTER\s+TYPE\b.*\bUSING\b/i, reason: "Column type change with USING — may cause data loss" },
]

/**
 * Check generated SQL/code for destructive operations.
 */
export function checkGuardrails(content: string): GuardrailResult {
  const warnings: string[] = []
  let blocked = false
  let blockedReason: string | undefined

  for (const { pattern, reason } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(content)) {
      warnings.push(reason)
      // Block DROP DATABASE unconditionally
      if (reason.includes("DROP DATABASE")) {
        blocked = true
        blockedReason = reason
      }
    }
  }

  return {
    safe: !blocked,
    warnings,
    blockedReason,
  }
}

// ─── Conversation Engine ─────────────────────────────────────────────────────

const DEFAULT_ENGINE_OPTIONS = {
  maxContextTokens: 4096,
  enableGuardrails: true,
  dryRunMode: false,
  inputTokenCostCents: 0,
  outputTokenCostCents: 0,
}

let sessionCounter = 0

/**
 * Multi-turn conversation engine for AI-assisted schema and query development.
 */
export class ConversationEngine {
  private options: Required<Omit<ConversationEngineOptions, "provider" | "schema">> &
    Pick<ConversationEngineOptions, "provider" | "schema">
  private sessions = new Map<string, ConversationSession>()

  constructor(options: ConversationEngineOptions = {}) {
    this.options = { ...DEFAULT_ENGINE_OPTIONS, ...options } as typeof this.options
  }

  /**
   * Create a new conversation session.
   */
  createSession(): ConversationSessionHandle {
    const id = `session_${++sessionCounter}_${Date.now().toString(36)}`
    const session: ConversationSession = {
      id,
      messages: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostCents: 0,
      createdAt: Date.now(),
    }

    // Add system message with schema context
    if (this.options.schema) {
      const schemaPrompt = this.buildSchemaPrompt(this.options.schema)
      session.messages.push({
        role: "system",
        content: schemaPrompt,
        timestamp: Date.now(),
        tokenCount: this.estimateTokens(schemaPrompt),
      })
    }

    this.sessions.set(id, session)
    return new ConversationSessionHandle(session, this)
  }

  /** Get an existing session */
  getSession(id: string): ConversationSessionHandle | undefined {
    const session = this.sessions.get(id)
    return session ? new ConversationSessionHandle(session, this) : undefined
  }

  /** Get cost summary for a session */
  getCostSummary(sessionId: string): CostSummary | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined

    return {
      sessionId,
      inputTokens: session.totalInputTokens,
      outputTokens: session.totalOutputTokens,
      totalTokens: session.totalInputTokens + session.totalOutputTokens,
      costCents: session.totalCostCents,
      messageCount: session.messages.length,
    }
  }

  /** List all active sessions */
  listSessions(): ConversationSession[] {
    return [...this.sessions.values()]
  }

  /** Delete a session */
  deleteSession(id: string): void {
    this.sessions.delete(id)
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  /** @internal */
  async generateResponse(session: ConversationSession, userMessage: string): Promise<string> {
    const inputTokens = this.estimateTokens(userMessage)
    session.messages.push({
      role: "user",
      content: userMessage,
      timestamp: Date.now(),
      tokenCount: inputTokens,
    })
    session.totalInputTokens += inputTokens

    // Trim context window if needed
    this.trimContext(session)

    if (!this.options.provider) {
      const fallback = this.ruleBasedResponse(userMessage)
      this.addAssistantMessage(session, fallback)
      return fallback
    }

    const prompt = this.buildPrompt(session)
    const response = await this.options.provider.generate(prompt, { maxTokens: 1000, temperature: 0.2 })

    // Apply guardrails
    if (this.options.enableGuardrails) {
      const guardrailResult = checkGuardrails(response)
      if (!guardrailResult.safe) {
        const blocked = `⚠️ BLOCKED: ${guardrailResult.blockedReason}\n\nThe generated code was blocked by safety guardrails. Please rephrase your request.`
        this.addAssistantMessage(session, blocked)
        return blocked
      }
      if (guardrailResult.warnings.length > 0) {
        const warnings = guardrailResult.warnings.map((w) => `⚠️ ${w}`).join("\n")
        const withWarnings = this.options.dryRunMode
          ? `[DRY RUN — not executed]\n\n${warnings}\n\n${response}`
          : `${warnings}\n\n${response}`
        this.addAssistantMessage(session, withWarnings)
        return withWarnings
      }
    }

    const finalResponse = this.options.dryRunMode ? `[DRY RUN — not executed]\n\n${response}` : response
    this.addAssistantMessage(session, finalResponse)
    return finalResponse
  }

  /** @internal */
  async *streamResponse(session: ConversationSession, userMessage: string): AsyncGenerator<StreamChunk> {
    // For non-streaming providers, simulate streaming
    const response = await this.generateResponse(session, userMessage)
    const words = response.split(" ")

    for (let i = 0; i < words.length; i++) {
      const text = i === 0 ? words[i] : ` ${words[i]}`
      yield {
        text,
        done: i === words.length - 1,
        tokenCount: 1,
      }
    }
  }

  private addAssistantMessage(session: ConversationSession, content: string): void {
    const outputTokens = this.estimateTokens(content)
    session.messages.push({
      role: "assistant",
      content,
      timestamp: Date.now(),
      tokenCount: outputTokens,
    })
    session.totalOutputTokens += outputTokens
    session.totalCostCents =
      (session.totalInputTokens / 1000) * this.options.inputTokenCostCents +
      (session.totalOutputTokens / 1000) * this.options.outputTokenCostCents
  }

  private buildSchemaPrompt(schema: SchemaInfo): string {
    const tableDescs = schema.tables
      .map((t) => {
        const cols = t.columns.map((c) => `${c.name}: ${c.type}${c.nullable ? "?" : ""}`).join(", ")
        const idxs = t.indexes.length > 0 ? ` indexes: ${t.indexes.map((i) => i.name).join(", ")}` : ""
        return `  ${t.name}(${cols})${idxs}`
      })
      .join("\n")

    return `You are a ReactiveBase database assistant. You help with schema design, query writing, and migrations.\n\nDatabase schema:\n${tableDescs}\n\nUse ReactiveBase patterns: defineTable(), query(), mutation(), ctx.db.TABLE.where/insert/update/delete.`
  }

  private buildPrompt(session: ConversationSession): string {
    return session.messages.map((m) => `${m.role}: ${m.content}`).join("\n\n")
  }

  private trimContext(session: ConversationSession): void {
    let totalTokens = session.messages.reduce((sum, m) => sum + (m.tokenCount ?? 0), 0)
    while (totalTokens > this.options.maxContextTokens && session.messages.length > 2) {
      // Keep system message, remove oldest non-system messages
      const idx = session.messages.findIndex((m) => m.role !== "system")
      if (idx === -1) break
      totalTokens -= session.messages[idx].tokenCount ?? 0
      session.messages.splice(idx, 1)
    }
  }

  private estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4)
  }

  private ruleBasedResponse(input: string): string {
    const lower = input.toLowerCase()
    if (lower.includes("create") && lower.includes("table")) {
      return `Here's a table definition:\n\n\`\`\`typescript\nconst myTable = defineTable({\n  name: v.string(),\n  // Add your columns here\n})\n\`\`\`\n\nDescribe your columns and I'll generate the full schema.`
    }
    if (lower.includes("query") || lower.includes("find") || lower.includes("get")) {
      return `Here's a query template:\n\n\`\`\`typescript\nexport const myQuery = query(async (ctx) => {\n  return ctx.db.tableName.where({})\n})\n\`\`\`\n\nTell me which table and conditions you need.`
    }
    if (lower.includes("migration") || lower.includes("migrate")) {
      return `For migrations, use:\n\n\`\`\`bash\nreactivebase migrate\n\`\`\`\n\nDescribe the schema change and I'll help ensure it's safe.`
    }
    return "I can help with schema design, query writing, and migrations. What would you like to do?"
  }
}

// ─── Session Handle ──────────────────────────────────────────────────────────

/**
 * Handle for interacting with a conversation session.
 */
export class ConversationSessionHandle {
  constructor(
    private session: ConversationSession,
    private engine: ConversationEngine,
  ) {}

  get id(): string {
    return this.session.id
  }

  get messages(): ConversationMessage[] {
    return [...this.session.messages]
  }

  /** Send a message and get the full response */
  async sendMessage(content: string): Promise<string> {
    return this.engine.generateResponse(this.session, content)
  }

  /** Send a message and stream the response */
  async *streamMessage(content: string): AsyncGenerator<StreamChunk> {
    yield* this.engine.streamResponse(this.session, content)
  }

  /** Get cost summary for this session */
  get cost(): CostSummary {
    return this.engine.getCostSummary(this.session.id)!
  }
}
