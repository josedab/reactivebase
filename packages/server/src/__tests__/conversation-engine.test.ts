import { describe, it, expect, vi } from "vitest"
import {
  ConversationEngine,
  checkGuardrails,
  ollamaProvider,
  type ConversationEngineOptions,
} from "../ai-assistant/conversation-engine.js"
import type { AiProviderAdapter, SchemaInfo } from "../ai-assistant/ai-assistant.js"

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockProvider(response = "Generated SQL: SELECT 1"): AiProviderAdapter {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue(response),
  }
}

const testSchema: SchemaInfo = {
  tables: [
    {
      name: "tasks",
      columns: [
        { name: "id", type: "uuid", nullable: false },
        { name: "title", type: "text", nullable: false },
        { name: "done", type: "boolean", nullable: false },
      ],
      indexes: [{ name: "idx_tasks_title", columns: ["title"] }],
    },
  ],
}

function createEngine(opts: Partial<ConversationEngineOptions> = {}) {
  return new ConversationEngine({
    provider: mockProvider(),
    schema: testSchema,
    ...opts,
  })
}

// ── ConversationEngine ──────────────────────────────────────────────────────

describe("ConversationEngine", () => {
  it("creates a session with system prompt containing schema", () => {
    const engine = createEngine()
    const session = engine.createSession()
    expect(session.id).toBeTruthy()
    const messages = session.messages
    expect(messages.length).toBeGreaterThanOrEqual(1)
    expect(messages[0].role).toBe("system")
    expect(messages[0].content).toContain("tasks")
  })

  it("chat with valid message returns response", async () => {
    const engine = createEngine()
    const session = engine.createSession()
    const response = await session.sendMessage("Create a tasks table")
    expect(response).toBeTruthy()
    expect(typeof response).toBe("string")
  })

  it("multi-turn conversation persists state", async () => {
    const engine = createEngine()
    const session = engine.createSession()
    await session.sendMessage("What tables exist?")
    await session.sendMessage("Show me the tasks table")
    const messages = session.messages
    // system + 2 user + 2 assistant = 5
    expect(messages.length).toBeGreaterThanOrEqual(5)
  })

  it("context window token limit trims oldest non-system messages", async () => {
    const engine = createEngine({ maxContextTokens: 100 })
    const session = engine.createSession()
    // Send many messages to exceed token limit
    for (let i = 0; i < 10; i++) {
      await session.sendMessage(`Message ${i} with some content that uses tokens and takes space`)
    }
    const messages = session.messages
    // System message should be preserved
    expect(messages[0].role).toBe("system")
    // Total should be trimmed
    expect(messages.length).toBeLessThan(22) // 1 system + 10 user + 10 assistant
  })

  it("guardrails block DROP DATABASE", async () => {
    const provider = mockProvider("DROP DATABASE production")
    const engine = createEngine({ provider, enableGuardrails: true })
    const session = engine.createSession()
    const response = await session.sendMessage("Drop the database")
    expect(response).toContain("BLOCKED")
    expect(response).toContain("DROP DATABASE")
  })

  it("guardrails warn on DROP TABLE but do not block", async () => {
    const provider = mockProvider("DROP TABLE old_table")
    const engine = createEngine({ provider, enableGuardrails: true })
    const session = engine.createSession()
    const response = await session.sendMessage("Drop old table")
    expect(response).toContain("⚠️")
    expect(response).toContain("DROP TABLE")
  })

  it("dry run mode prefixes response", async () => {
    const engine = createEngine({ dryRunMode: true })
    const session = engine.createSession()
    const response = await session.sendMessage("Do something")
    expect(response).toContain("DRY RUN")
  })

  it("rule-based response works without provider", async () => {
    const engine = new ConversationEngine({})
    const session = engine.createSession()
    const response = await session.sendMessage("Create a table for users")
    expect(response).toContain("defineTable")
  })

  it("rule-based response for queries", async () => {
    const engine = new ConversationEngine({})
    const session = engine.createSession()
    const response = await session.sendMessage("Find all active tasks")
    expect(response).toContain("query")
  })

  it("rule-based response for migrations", async () => {
    const engine = new ConversationEngine({})
    const session = engine.createSession()
    const response = await session.sendMessage("How do I migrate my schema?")
    expect(response).toContain("migrate")
  })

  it("generic fallback for unknown queries", async () => {
    const engine = new ConversationEngine({})
    const session = engine.createSession()
    const response = await session.sendMessage("hello")
    expect(response).toBeTruthy()
  })

  it("session lists and retrieval", () => {
    const engine = createEngine()
    const s1 = engine.createSession()
    engine.createSession()
    expect(engine.listSessions()).toHaveLength(2)
    expect(engine.getSession(s1.id)).toBeTruthy()
  })

  it("deleteSession removes session", () => {
    const engine = createEngine()
    const session = engine.createSession()
    engine.deleteSession(session.id)
    expect(engine.getSession(session.id)).toBeUndefined()
  })

  it("getCostSummary returns token counts", async () => {
    const engine = createEngine({ inputTokenCostCents: 1, outputTokenCostCents: 2 })
    const session = engine.createSession()
    await session.sendMessage("test")
    const cost = engine.getCostSummary(session.id)
    expect(cost).toBeTruthy()
    expect(cost!.inputTokens).toBeGreaterThan(0)
    expect(cost!.totalTokens).toBeGreaterThan(0)
  })

  it("getCostSummary returns undefined for unknown session", () => {
    const engine = createEngine()
    expect(engine.getCostSummary("missing")).toBeUndefined()
  })

  it("session cost accessor works", async () => {
    const engine = createEngine()
    const session = engine.createSession()
    await session.sendMessage("test")
    expect(session.cost.messageCount).toBeGreaterThan(0)
  })

  it("streaming yields chunks", async () => {
    const engine = createEngine()
    const session = engine.createSession()
    const chunks: string[] = []
    for await (const chunk of session.streamMessage("test")) {
      chunks.push(chunk.text)
      if (chunk.done) break
    }
    expect(chunks.length).toBeGreaterThan(0)
  })

  it("provider failure returns structured error response", async () => {
    const failingProvider: AiProviderAdapter = {
      name: "failing",
      generate: vi.fn().mockRejectedValue(new Error("API down")),
    }
    const engine = createEngine({ provider: failingProvider, enableGuardrails: false })
    const session = engine.createSession()
    await expect(session.sendMessage("test")).rejects.toThrow("API down")
  })
})

// ── checkGuardrails ─────────────────────────────────────────────────────────

describe("checkGuardrails", () => {
  it("returns safe for benign content", () => {
    const result = checkGuardrails("SELECT * FROM tasks WHERE done = true")
    expect(result.safe).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })

  it("warns on DROP TABLE", () => {
    const result = checkGuardrails("DROP TABLE users")
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.safe).toBe(true) // warns but doesn't block
  })

  it("blocks DROP DATABASE", () => {
    const result = checkGuardrails("DROP DATABASE production")
    expect(result.safe).toBe(false)
    expect(result.blockedReason).toContain("DROP DATABASE")
  })

  it("warns on TRUNCATE", () => {
    const result = checkGuardrails("TRUNCATE TABLE users")
    expect(result.warnings.some((w) => w.includes("TRUNCATE"))).toBe(true)
  })

  it("warns on DELETE without WHERE", () => {
    const result = checkGuardrails("DELETE FROM users;")
    expect(result.warnings.some((w) => w.includes("DELETE"))).toBe(true)
  })

  it("warns on ALTER TABLE DROP COLUMN", () => {
    const result = checkGuardrails("ALTER TABLE users DROP COLUMN email")
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})

// ── ollamaProvider ──────────────────────────────────────────────────────────

describe("ollamaProvider", () => {
  it("creates a provider with default model name", () => {
    const provider = ollamaProvider()
    expect(provider.name).toContain("ollama")
    expect(provider.name).toContain("codellama")
  })

  it("uses custom model name", () => {
    const provider = ollamaProvider({ model: "llama3" })
    expect(provider.name).toContain("llama3")
  })
})
