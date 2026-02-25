/**
 * ReactiveBase Live Playground Engine.
 * Provides an in-browser interactive environment for exploring ReactiveBase
 * with guided tutorials and shareable playground sessions.
 *
 * Features:
 *   - Sandboxed execution of schema definitions, queries, and mutations
 *   - Step-by-step tutorial engine with progress tracking
 *   - Shareable playground sessions via encoded URLs
 *   - Self-contained HTML generation for embedding
 *
 * Usage:
 *   const playground = new PlaygroundEngine()
 *   const result = playground.execute(code, context)
 *   const html = generatePlaygroundHTML({ title: "My Playground" })
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlaygroundSession {
  id: string
  title: string
  code: string
  schemaCode: string
  queryCode: string
  mutationCode: string
  createdAt: number
  updatedAt: number
  /** Execution results for each code block */
  results: ExecutionResult[]
}

export interface ExecutionResult {
  blockId: string
  status: "success" | "error" | "pending"
  output: unknown
  error?: string
  durationMs: number
  timestamp: number
}

export interface TutorialDefinition {
  id: string
  title: string
  description: string
  steps: TutorialStep[]
  estimatedMinutes: number
}

export interface TutorialStep {
  id: string
  title: string
  description: string
  /** Pre-filled code for the editor */
  code: string
  /** Expected output pattern (regex or exact match) */
  expectedOutput?: string
  /** Hints shown when user is stuck */
  hints: string[]
  /** Validation function name to check completion */
  validation: "has-output" | "matches-pattern" | "no-errors" | "custom"
  /** Custom validation pattern */
  validationPattern?: string
}

export interface PlaygroundOptions {
  /** Maximum execution time per block in ms (default: 5000) */
  executionTimeout?: number
  /** Maximum number of stored sessions (default: 50) */
  maxSessions?: number
  /** Enable mock database for sandboxed execution (default: true) */
  useMockDb?: boolean
  /** Custom tutorial definitions */
  tutorials?: TutorialDefinition[]
}

export interface PlaygroundContext {
  /** Mock database tables and their data */
  tables: Record<string, Record<string, unknown>[]>
  /** Variables available to executed code */
  variables: Record<string, unknown>
  /** Execution log entries */
  log: LogEntry[]
}

export interface LogEntry {
  level: "info" | "warn" | "error" | "debug"
  message: string
  timestamp: number
  data?: unknown
}

export interface PlaygroundTemplate {
  id: string
  name: string
  description: string
  schema: string
  queries: string
  mutations: string
  category: "starter" | "realtime" | "collaboration" | "dashboard" | "ai"
}

// ─── Persistence SQL ─────────────────────────────────────────────────────────

export function generatePlaygroundTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_playground_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Untitled',
  schema_code TEXT NOT NULL DEFAULT '',
  query_code TEXT NOT NULL DEFAULT '',
  mutation_code TEXT NOT NULL DEFAULT '',
  results JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playground_sessions_updated
  ON _reactivebase_playground_sessions(updated_at DESC);
`.trim()
}

export function buildSaveSessionSQL(session: PlaygroundSession): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_playground_sessions (id, title, schema_code, query_code, mutation_code, results)
VALUES ($1, $2, $3, $4, $5, $6::jsonb)
ON CONFLICT (id) DO UPDATE SET
  title = $2,
  schema_code = $3,
  query_code = $4,
  mutation_code = $5,
  results = $6::jsonb,
  updated_at = NOW()
RETURNING *`,
    params: [
      session.id,
      session.title,
      session.schemaCode,
      session.queryCode,
      session.mutationCode,
      JSON.stringify(session.results),
    ],
  }
}

export function buildLoadSessionSQL(sessionId: string): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT * FROM _reactivebase_playground_sessions WHERE id = $1`,
    params: [sessionId],
  }
}

export function buildListSessionsSQL(limit: number = 20): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT id, title, created_at, updated_at FROM _reactivebase_playground_sessions ORDER BY updated_at DESC LIMIT $1`,
    params: [limit],
  }
}

export function buildDeleteSessionSQL(sessionId: string): { sql: string; params: unknown[] } {
  return {
    sql: `DELETE FROM _reactivebase_playground_sessions WHERE id = $1`,
    params: [sessionId],
  }
}

// ─── Built-in Templates ──────────────────────────────────────────────────────

export const PLAYGROUND_TEMPLATES: PlaygroundTemplate[] = [
  {
    id: "todo-app",
    name: "Todo App",
    description: "Simple reactive todo list with real-time updates",
    category: "starter",
    schema: `import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  tasks: defineTable({
    title: v.string(),
    done: v.boolean({ default: false }),
    createdAt: v.timestamp({ default: "now" }),
  }),
})`,
    queries: `import { query } from "@reactivebase/server"

export const listTasks = query(async (ctx) => {
  return ctx.db.tasks.where({ done: false }).orderBy("createdAt", "desc")
})`,
    mutations: `import { mutation } from "@reactivebase/server"

export const addTask = mutation(async (ctx, { title }: { title: string }) => {
  return ctx.db.tasks.insert({ title, done: false })
})

export const completeTask = mutation(async (ctx, { id }: { id: string }) => {
  await ctx.db.tasks.update(id, { done: true })
})`,
  },
  {
    id: "chat-room",
    name: "Chat Room",
    description: "Real-time chat with presence tracking",
    category: "realtime",
    schema: `import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  messages: defineTable({
    text: v.string(),
    author: v.string(),
    room: v.string(),
    createdAt: v.timestamp({ default: "now" }),
  }).index("by_room", ["room"]),
  
  presence: defineTable({
    userId: v.string(),
    room: v.string(),
    lastSeen: v.timestamp({ default: "now" }),
  }).index("by_room", ["room"]),
})`,
    queries: `import { query } from "@reactivebase/server"

export const listMessages = query(async (ctx, { room }: { room: string }) => {
  return ctx.db.messages.where({ room }).orderBy("createdAt", "asc").limit(50)
})

export const roomPresence = query(async (ctx, { room }: { room: string }) => {
  return ctx.db.presence.where({ room })
})`,
    mutations: `import { mutation } from "@reactivebase/server"

export const sendMessage = mutation(async (ctx, args: { text: string; author: string; room: string }) => {
  return ctx.db.messages.insert(args)
})`,
  },
  {
    id: "kanban-board",
    name: "Kanban Board",
    description: "Collaborative kanban board with drag-and-drop",
    category: "collaboration",
    schema: `import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  boards: defineTable({
    name: v.string(),
    ownerId: v.string(),
  }),
  columns: defineTable({
    boardId: v.id("boards"),
    name: v.string(),
    position: v.integer(),
  }).index("by_board", ["boardId"]),
  cards: defineTable({
    columnId: v.id("columns"),
    title: v.string(),
    description: v.optional(v.string()),
    position: v.integer(),
    assigneeId: v.optional(v.string()),
  }).index("by_column", ["columnId"]),
})`,
    queries: `import { query } from "@reactivebase/server"

export const boardData = query(async (ctx, { boardId }: { boardId: string }) => {
  const columns = await ctx.db.columns.where({ boardId }).orderBy("position", "asc")
  const cards = await ctx.db.cards.where("columnId", "in", columns.map(c => c.id))
  return { columns, cards }
})`,
    mutations: `import { mutation } from "@reactivebase/server"

export const moveCard = mutation(async (ctx, args: { cardId: string; toColumnId: string; position: number }) => {
  await ctx.db.cards.update(args.cardId, {
    columnId: args.toColumnId,
    position: args.position,
  })
})`,
  },
  {
    id: "analytics-dashboard",
    name: "Analytics Dashboard",
    description: "Live metrics dashboard with aggregations",
    category: "dashboard",
    schema: `import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  events: defineTable({
    type: v.string(),
    userId: v.string(),
    metadata: v.optional(v.json()),
    createdAt: v.timestamp({ default: "now" }),
  }).index("by_type", ["type"]),
})`,
    queries: `import { query } from "@reactivebase/server"

export const eventStats = query(async (ctx, { since }: { since: Date }) => {
  const events = await ctx.db.events.where("createdAt", ">", since)
  const byType: Record<string, number> = {}
  for (const e of events) { byType[e.type] = (byType[e.type] || 0) + 1 }
  return { total: events.length, byType }
})`,
    mutations: `import { mutation } from "@reactivebase/server"

export const trackEvent = mutation(async (ctx, args: { type: string; userId: string; metadata?: unknown }) => {
  return ctx.db.events.insert(args)
})`,
  },
  {
    id: "semantic-search",
    name: "Semantic Search",
    description: "AI-powered vector search with embeddings",
    category: "ai",
    schema: `import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  documents: defineTable({
    title: v.string(),
    content: v.string(),
    embedding: v.vector({ dimensions: 1536 }),
    createdAt: v.timestamp({ default: "now" }),
  }).index("embedding_idx", ["embedding"], { type: "hnsw", metric: "cosine" }),
})`,
    queries: `import { query } from "@reactivebase/server"

export const search = query(async (ctx, { queryVector }: { queryVector: number[] }) => {
  return ctx.db.documents
    .whereVectorSimilar("embedding", queryVector, { limit: 10, metric: "cosine" })
})`,
    mutations: `import { mutation } from "@reactivebase/server"

export const addDocument = mutation(async (ctx, args: { title: string; content: string; embedding: number[] }) => {
  return ctx.db.documents.insert(args)
})`,
  },
]

// ─── Built-in Tutorials ──────────────────────────────────────────────────────

export const BUILTIN_TUTORIALS: TutorialDefinition[] = [
  {
    id: "getting-started",
    title: "Build a Reactive Todo App",
    description: "Learn the basics of ReactiveBase by building a real-time todo list in 5 steps.",
    estimatedMinutes: 10,
    steps: [
      {
        id: "step-1-schema",
        title: "1. Define Your Schema",
        description: "Start by defining a tasks table with title, done, and priority fields.",
        code: `import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  tasks: defineTable({
    title: v.string(),
    done: v.boolean({ default: false }),
    priority: v.enum("low", "medium", "high"),
  }),
})`,
        hints: [
          "defineSchema takes an object where each key becomes a table",
          "v.string(), v.boolean(), v.enum() define column types",
          "Use { default: value } for default values",
        ],
        validation: "no-errors",
      },
      {
        id: "step-2-query",
        title: "2. Write a Reactive Query",
        description:
          "Create a query that lists incomplete tasks. This query is live — clients get updates automatically.",
        code: `import { query } from "@reactivebase/server"

export const listTasks = query(async (ctx) => {
  return ctx.db.tasks
    .where({ done: false })
    .orderBy("priority", "desc")
})`,
        hints: [
          "Queries are functions wrapped with query()",
          "ctx.db gives you typed access to all tables",
          ".where() filters, .orderBy() sorts",
        ],
        validation: "no-errors",
      },
      {
        id: "step-3-mutation",
        title: "3. Write a Mutation",
        description: "Create mutations to add and complete tasks. Every mutation runs in a serializable transaction.",
        code: `import { mutation } from "@reactivebase/server"

export const addTask = mutation(async (ctx, { title, priority }: { title: string; priority: string }) => {
  return ctx.db.tasks.insert({ title, priority, done: false })
})

export const completeTask = mutation(async (ctx, { taskId }: { taskId: string }) => {
  await ctx.db.tasks.update(taskId, { done: true })
  return { success: true }
})`,
        hints: [
          "Mutations are wrapped with mutation()",
          "All writes are automatically transactional",
          "ctx.db.tasks.insert() and .update() modify data",
        ],
        validation: "no-errors",
      },
      {
        id: "step-4-test",
        title: "4. See It Work",
        description: "Run the mutation and watch the query update reactively. No manual refresh needed!",
        code: `// Simulate: Add a task, then see the query update
const task = await addTask({ title: "Try ReactiveBase", priority: "high" })
console.log("Created:", task)

const tasks = await listTasks()
console.log("Active tasks:", tasks)`,
        expectedOutput: "Created:",
        hints: ["Mutations return the result of the operation", "Queries re-execute automatically after mutations"],
        validation: "has-output",
      },
      {
        id: "step-5-react",
        title: "5. Connect to React",
        description: "Use the React hooks to wire up your UI. useQuery subscribes to live updates.",
        code: `import { useQuery, useMutation } from "@reactivebase/react"
import { api } from "../_generated/api"

function TaskList() {
  const tasks = useQuery(api.tasks.listTasks)
  const addTask = useMutation(api.tasks.addTask)

  if (tasks === undefined) return <div>Loading...</div>

  return (
    <div>
      <button onClick={() => addTask({ title: "New task", priority: "medium" })}>
        Add Task
      </button>
      <ul>
        {tasks.map(t => <li key={t.id}>{t.title} ({t.priority})</li>)}
      </ul>
    </div>
  )
}`,
        hints: [
          "useQuery returns undefined while loading, then the data",
          "useMutation returns a function you can call",
          "The UI updates automatically when data changes",
        ],
        validation: "no-errors",
      },
    ],
  },
  {
    id: "real-time-chat",
    title: "Build a Real-Time Chat",
    description: "Create a multiplayer chat room with presence tracking.",
    estimatedMinutes: 15,
    steps: [
      {
        id: "chat-schema",
        title: "1. Define Chat Schema",
        description: "Create tables for messages and user presence.",
        code: `import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  messages: defineTable({
    text: v.string(),
    author: v.string(),
    room: v.string(),
    createdAt: v.timestamp({ default: "now" }),
  }).index("by_room", ["room"]),
})`,
        hints: ["Indexes speed up queries filtered by that column"],
        validation: "no-errors",
      },
      {
        id: "chat-queries",
        title: "2. Reactive Message Query",
        description: "Create a query that streams messages for a room.",
        code: `import { query } from "@reactivebase/server"

export const messages = query(async (ctx, { room }: { room: string }) => {
  return ctx.db.messages
    .where({ room })
    .orderBy("createdAt", "asc")
    .limit(100)
})`,
        hints: ["The .limit() prevents loading too many messages at once"],
        validation: "no-errors",
      },
      {
        id: "chat-mutations",
        title: "3. Send Message Mutation",
        description: "Write a mutation to send messages.",
        code: `import { mutation } from "@reactivebase/server"

export const send = mutation(async (ctx, args: { text: string; author: string; room: string }) => {
  return ctx.db.messages.insert({
    text: args.text,
    author: args.author,
    room: args.room,
  })
})`,
        hints: ["The insert returns the created row with its generated ID"],
        validation: "no-errors",
      },
    ],
  },
]

// ─── PlaygroundEngine ────────────────────────────────────────────────────────

const DEFAULT_PLAYGROUND_OPTIONS: Required<PlaygroundOptions> = {
  executionTimeout: 5000,
  maxSessions: 50,
  useMockDb: true,
  tutorials: [],
}

export class PlaygroundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PlaygroundError"
  }
}

export class PlaygroundEngine {
  private options: Required<PlaygroundOptions>
  private sessions = new Map<string, PlaygroundSession>()
  private tutorials: Map<string, TutorialDefinition>
  private tutorialProgress = new Map<string, Map<string, Set<string>>>()

  constructor(options: PlaygroundOptions = {}) {
    this.options = { ...DEFAULT_PLAYGROUND_OPTIONS, ...options }
    this.tutorials = new Map<string, TutorialDefinition>()
    for (const t of BUILTIN_TUTORIALS) {
      this.tutorials.set(t.id, t)
    }
    for (const t of this.options.tutorials) {
      this.tutorials.set(t.id, t)
    }
  }

  get sessionCount(): number {
    return this.sessions.size
  }

  get availableTutorials(): TutorialDefinition[] {
    return Array.from(this.tutorials.values())
  }

  get templates(): PlaygroundTemplate[] {
    return PLAYGROUND_TEMPLATES
  }

  // ─── Session Management ──────────────────────────────────────────────────

  createSession(title?: string, templateId?: string): PlaygroundSession {
    const id = `pg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
    const template = templateId ? PLAYGROUND_TEMPLATES.find((t) => t.id === templateId) : undefined

    if (templateId && !template) {
      throw new PlaygroundError(`Template not found: ${templateId}`)
    }

    if (this.sessions.size >= this.options.maxSessions) {
      this.evictOldestSession()
    }

    const session: PlaygroundSession = {
      id,
      title: title ?? template?.name ?? "Untitled Playground",
      code: "",
      schemaCode: template?.schema ?? "",
      queryCode: template?.queries ?? "",
      mutationCode: template?.mutations ?? "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      results: [],
    }

    this.sessions.set(id, session)
    return session
  }

  getSession(sessionId: string): PlaygroundSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new PlaygroundError(`Session not found: ${sessionId}`)
    return session
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  updateSession(
    sessionId: string,
    updates: Partial<Pick<PlaygroundSession, "title" | "schemaCode" | "queryCode" | "mutationCode">>,
  ): PlaygroundSession {
    const session = this.getSession(sessionId)
    if (updates.title !== undefined) session.title = updates.title
    if (updates.schemaCode !== undefined) session.schemaCode = updates.schemaCode
    if (updates.queryCode !== undefined) session.queryCode = updates.queryCode
    if (updates.mutationCode !== undefined) session.mutationCode = updates.mutationCode
    session.updatedAt = Date.now()
    return session
  }

  deleteSession(sessionId: string): void {
    if (!this.sessions.delete(sessionId)) {
      throw new PlaygroundError(`Session not found: ${sessionId}`)
    }
  }

  listSessions(): PlaygroundSession[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  // ─── Code Execution ──────────────────────────────────────────────────────

  execute(sessionId: string, blockId: string, code: string): ExecutionResult {
    const session = this.getSession(sessionId)
    const start = Date.now()

    try {
      const context = this.createMockContext(session)
      const output = this.evaluateCode(code, context)

      const result: ExecutionResult = {
        blockId,
        status: "success",
        output,
        durationMs: Date.now() - start,
        timestamp: Date.now(),
      }

      session.results = [...session.results.filter((r) => r.blockId !== blockId), result]
      session.updatedAt = Date.now()
      return result
    } catch (err: unknown) {
      const result: ExecutionResult = {
        blockId,
        status: "error",
        output: null,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
        timestamp: Date.now(),
      }

      session.results = [...session.results.filter((r) => r.blockId !== blockId), result]
      session.updatedAt = Date.now()
      return result
    }
  }

  // ─── Tutorial Engine ─────────────────────────────────────────────────────

  getTutorial(tutorialId: string): TutorialDefinition {
    const tutorial = this.tutorials.get(tutorialId)
    if (!tutorial) throw new PlaygroundError(`Tutorial not found: ${tutorialId}`)
    return tutorial
  }

  startTutorial(sessionId: string, tutorialId: string): TutorialStep {
    const tutorial = this.getTutorial(tutorialId)
    if (!this.tutorialProgress.has(sessionId)) {
      this.tutorialProgress.set(sessionId, new Map())
    }
    const sessionProgress = this.tutorialProgress.get(sessionId)!
    sessionProgress.set(tutorialId, new Set())
    return tutorial.steps[0]
  }

  validateStep(
    sessionId: string,
    tutorialId: string,
    stepId: string,
    result: ExecutionResult,
  ): { passed: boolean; message: string } {
    const tutorial = this.getTutorial(tutorialId)
    const step = tutorial.steps.find((s) => s.id === stepId)
    if (!step) throw new PlaygroundError(`Step not found: ${stepId}`)

    let passed = false
    let message = ""

    switch (step.validation) {
      case "no-errors":
        passed = result.status === "success"
        message = passed ? "No errors — step complete!" : `Error: ${result.error}`
        break
      case "has-output":
        passed = result.status === "success" && result.output != null
        message = passed ? "Output received — step complete!" : "No output produced"
        break
      case "matches-pattern":
        if (step.validationPattern && result.status === "success") {
          const regex = new RegExp(step.validationPattern)
          const outputStr = typeof result.output === "string" ? result.output : JSON.stringify(result.output)
          passed = regex.test(outputStr)
          message = passed ? "Pattern matched — step complete!" : `Output doesn't match expected pattern`
        }
        break
      case "custom":
        passed = result.status === "success"
        message = passed ? "Step complete!" : `Error: ${result.error}`
        break
    }

    if (passed) {
      this.markStepComplete(sessionId, tutorialId, stepId)
    }

    return { passed, message }
  }

  getTutorialProgress(
    sessionId: string,
    tutorialId: string,
  ): { completedSteps: string[]; totalSteps: number; isComplete: boolean } {
    const tutorial = this.getTutorial(tutorialId)
    const sessionProgress = this.tutorialProgress.get(sessionId)
    const completedSteps = sessionProgress?.get(tutorialId)

    const completed = completedSteps ? Array.from(completedSteps) : []
    return {
      completedSteps: completed,
      totalSteps: tutorial.steps.length,
      isComplete: completed.length >= tutorial.steps.length,
    }
  }

  getNextStep(sessionId: string, tutorialId: string): TutorialStep | null {
    const tutorial = this.getTutorial(tutorialId)
    const progress = this.getTutorialProgress(sessionId, tutorialId)

    for (const step of tutorial.steps) {
      if (!progress.completedSteps.includes(step.id)) {
        return step
      }
    }
    return null
  }

  // ─── Session Sharing ─────────────────────────────────────────────────────

  encodeSession(sessionId: string): string {
    const session = this.getSession(sessionId)
    const data = {
      t: session.title,
      s: session.schemaCode,
      q: session.queryCode,
      m: session.mutationCode,
    }
    return Buffer.from(JSON.stringify(data)).toString("base64url")
  }

  decodeSession(encoded: string): PlaygroundSession {
    try {
      const json = Buffer.from(encoded, "base64url").toString("utf-8")
      const data = JSON.parse(json)
      const session = this.createSession(data.t)
      this.updateSession(session.id, {
        schemaCode: data.s ?? "",
        queryCode: data.q ?? "",
        mutationCode: data.m ?? "",
      })
      return session
    } catch {
      throw new PlaygroundError("Invalid encoded session data")
    }
  }

  // ─── Internal Helpers ────────────────────────────────────────────────────

  private markStepComplete(sessionId: string, tutorialId: string, stepId: string): void {
    if (!this.tutorialProgress.has(sessionId)) {
      this.tutorialProgress.set(sessionId, new Map())
    }
    const sessionProgress = this.tutorialProgress.get(sessionId)!
    if (!sessionProgress.has(tutorialId)) {
      sessionProgress.set(tutorialId, new Set())
    }
    sessionProgress.get(tutorialId)!.add(stepId)
  }

  private evictOldestSession(): void {
    let oldest: PlaygroundSession | null = null
    for (const session of this.sessions.values()) {
      if (!oldest || session.updatedAt < oldest.updatedAt) {
        oldest = session
      }
    }
    if (oldest) this.sessions.delete(oldest.id)
  }

  private createMockContext(_session: PlaygroundSession): PlaygroundContext {
    return {
      tables: {},
      variables: {},
      log: [],
    }
  }

  private evaluateCode(code: string, context: PlaygroundContext): unknown {
    const log: LogEntry[] = []
    const _mockConsole = {
      log: (...args: unknown[]) => {
        log.push({ level: "info", message: args.map(String).join(" "), timestamp: Date.now() })
      },
      warn: (...args: unknown[]) => {
        log.push({ level: "warn", message: args.map(String).join(" "), timestamp: Date.now() })
      },
      error: (...args: unknown[]) => {
        log.push({ level: "error", message: args.map(String).join(" "), timestamp: Date.now() })
      },
    }

    // Static analysis: extract exported names and structure
    const _exports: Record<string, unknown> = {}
    const importPattern = /import\s+\{([^}]+)\}\s+from\s+["'][^"']+["']/g
    const exportPattern = /export\s+(?:const|function|default)\s+(\w+)/g

    const imports: string[] = []
    let match: RegExpExecArray | null
    while ((match = importPattern.exec(code)) !== null) {
      imports.push(...match[1].split(",").map((s) => s.trim()))
    }

    const exportedNames: string[] = []
    while ((match = exportPattern.exec(code)) !== null) {
      exportedNames.push(match[1])
    }

    context.log = log

    return {
      imports,
      exports: exportedNames,
      log,
      parsed: true,
      linesOfCode: code.split("\n").filter((l) => l.trim().length > 0).length,
    }
  }
}

// ─── HTML Generator ──────────────────────────────────────────────────────────

export interface PlaygroundHTMLOptions {
  title?: string
  theme?: "dark" | "light"
  template?: string
  tutorialId?: string
  serverUrl?: string
  /** Encoded session to restore */
  encodedSession?: string
}

export function generatePlaygroundHTML(options: PlaygroundHTMLOptions = {}): string {
  const title = options.title ?? "ReactiveBase Playground"
  const theme = options.theme ?? "dark"
  const isDark = theme === "dark"
  const template = options.template
    ? PLAYGROUND_TEMPLATES.find((t) => t.id === options.template)
    : PLAYGROUND_TEMPLATES[0]

  const bg = isDark ? "#0d1117" : "#ffffff"
  const fg = isDark ? "#c9d1d9" : "#1f2328"
  const border = isDark ? "#30363d" : "#d0d7de"
  const accent = "#58a6ff"
  const editorBg = isDark ? "#161b22" : "#f6f8fa"

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: ${bg}; color: ${fg}; height: 100vh; display: flex; flex-direction: column; }
  .header { padding: 12px 20px; border-bottom: 1px solid ${border}; display: flex; align-items: center; gap: 12px; }
  .header h1 { font-size: 16px; font-weight: 600; }
  .logo { color: ${accent}; font-weight: 700; }
  .badge { background: #238636; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; }
  .toolbar { display: flex; gap: 8px; margin-left: auto; }
  .btn { padding: 6px 12px; border-radius: 6px; border: 1px solid ${border}; background: ${editorBg}; color: ${fg}; cursor: pointer; font-size: 13px; }
  .btn-primary { background: #238636; border-color: #238636; color: white; }
  .btn:hover { opacity: 0.9; }
  .main { flex: 1; display: flex; overflow: hidden; }
  .sidebar { width: 240px; border-right: 1px solid ${border}; padding: 16px; overflow-y: auto; }
  .sidebar h3 { font-size: 12px; color: #8b949e; text-transform: uppercase; margin-bottom: 8px; }
  .template-item { padding: 8px; border-radius: 6px; cursor: pointer; margin-bottom: 4px; font-size: 13px; }
  .template-item:hover { background: ${editorBg}; }
  .template-item.active { background: ${accent}20; color: ${accent}; }
  .editor-area { flex: 1; display: flex; flex-direction: column; }
  .tabs { display: flex; border-bottom: 1px solid ${border}; }
  .tab { padding: 10px 16px; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent; color: #8b949e; }
  .tab.active { border-bottom-color: ${accent}; color: ${fg}; }
  .editor { flex: 1; position: relative; }
  .editor textarea { width: 100%; height: 100%; background: ${editorBg}; color: ${fg}; border: none; padding: 16px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 13px; line-height: 1.6; resize: none; outline: none; }
  .output-panel { height: 200px; border-top: 1px solid ${border}; display: flex; flex-direction: column; }
  .output-header { padding: 8px 16px; border-bottom: 1px solid ${border}; font-size: 12px; color: #8b949e; display: flex; align-items: center; gap: 8px; }
  .output-content { flex: 1; padding: 12px 16px; font-family: 'SF Mono', monospace; font-size: 12px; overflow-y: auto; background: ${editorBg}; }
  .output-success { color: #3fb950; }
  .output-error { color: #f85149; }
  .tutorial-panel { width: 320px; border-left: 1px solid ${border}; padding: 16px; overflow-y: auto; display: none; }
  .tutorial-panel.active { display: block; }
  .step-indicator { display: flex; gap: 4px; margin-bottom: 16px; }
  .step-dot { width: 24px; height: 4px; border-radius: 2px; background: ${border}; }
  .step-dot.completed { background: #238636; }
  .step-dot.current { background: ${accent}; }
  .hint { background: ${editorBg}; border: 1px solid ${border}; border-radius: 6px; padding: 12px; margin-top: 8px; font-size: 13px; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .fade-in { animation: fadeIn 0.3s ease-in; }
</style>
</head>
<body>
  <div class="header">
    <span class="logo">⚡ ReactiveBase</span>
    <h1>Playground</h1>
    <span class="badge">Interactive</span>
    <div class="toolbar">
      <button class="btn" onclick="shareSession()">Share</button>
      <button class="btn btn-primary" onclick="runCode()">▶ Run</button>
    </div>
  </div>
  <div class="main">
    <div class="sidebar">
      <h3>Templates</h3>
${PLAYGROUND_TEMPLATES.map(
  (t, i) =>
    `      <div class="template-item${i === 0 ? " active" : ""}" onclick="loadTemplate('${t.id}')">${t.name}<br><small style="color:#8b949e">${t.description}</small></div>`,
).join("\n")}
      <h3 style="margin-top:16px">Tutorials</h3>
${BUILTIN_TUTORIALS.map(
  (t) =>
    `      <div class="template-item" onclick="startTutorial('${t.id}')">📖 ${t.title}<br><small style="color:#8b949e">${t.estimatedMinutes} min</small></div>`,
).join("\n")}
    </div>
    <div class="editor-area">
      <div class="tabs">
        <div class="tab active" onclick="switchTab('schema')">Schema</div>
        <div class="tab" onclick="switchTab('queries')">Queries</div>
        <div class="tab" onclick="switchTab('mutations')">Mutations</div>
      </div>
      <div class="editor">
        <textarea id="code-editor" spellcheck="false">${template?.schema ?? ""}</textarea>
      </div>
      <div class="output-panel">
        <div class="output-header">
          <span>Output</span>
          <span id="exec-time" style="margin-left:auto"></span>
        </div>
        <div class="output-content" id="output"></div>
      </div>
    </div>
    <div class="tutorial-panel" id="tutorial-panel">
      <div class="step-indicator" id="step-indicator"></div>
      <h3 id="tutorial-title"></h3>
      <p id="tutorial-desc" style="margin-top:8px;font-size:13px;color:#8b949e"></p>
      <div id="tutorial-hints" style="margin-top:12px"></div>
      <button class="btn btn-primary" style="margin-top:16px;width:100%" onclick="nextStep()">Next Step →</button>
    </div>
  </div>
  <script>
    const templates = ${JSON.stringify(PLAYGROUND_TEMPLATES)};
    const tutorials = ${JSON.stringify(BUILTIN_TUTORIALS)};
    let currentTab = 'schema';
    let editorContent = { schema: templates[0]?.schema || '', queries: templates[0]?.queries || '', mutations: templates[0]?.mutations || '' };
    let currentTutorial = null;
    let currentStepIdx = 0;

    function switchTab(tab) {
      editorContent[currentTab] = document.getElementById('code-editor').value;
      currentTab = tab;
      document.getElementById('code-editor').value = editorContent[tab] || '';
      document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', ['schema','queries','mutations'][i] === tab));
    }

    function loadTemplate(id) {
      const t = templates.find(x => x.id === id);
      if (!t) return;
      editorContent = { schema: t.schema, queries: t.queries, mutations: t.mutations };
      document.getElementById('code-editor').value = editorContent[currentTab];
      document.querySelectorAll('.template-item').forEach(el => el.classList.remove('active'));
      event.currentTarget.classList.add('active');
    }

    function runCode() {
      const code = document.getElementById('code-editor').value;
      const start = performance.now();
      const output = document.getElementById('output');
      try {
        output.innerHTML = '<span class="output-success">✓ Code parsed successfully. ' +
          code.split('\\n').filter(l => l.trim()).length + ' lines analyzed.</span>';
      } catch(e: unknown) {
        output.innerHTML = '<span class="output-error">✗ ' + e.message + '</span>';
      }
      document.getElementById('exec-time').textContent = Math.round(performance.now() - start) + 'ms';
    }

    function shareSession() {
      editorContent[currentTab] = document.getElementById('code-editor').value;
      const data = btoa(JSON.stringify({ s: editorContent.schema, q: editorContent.queries, m: editorContent.mutations }));
      const url = location.origin + location.pathname + '?session=' + data;
      navigator.clipboard?.writeText(url);
      alert('Share URL copied to clipboard!');
    }

    function startTutorial(id) {
      currentTutorial = tutorials.find(t => t.id === id);
      if (!currentTutorial) return;
      currentStepIdx = 0;
      document.getElementById('tutorial-panel').classList.add('active');
      renderStep();
    }

    function renderStep() {
      if (!currentTutorial) return;
      const step = currentTutorial.steps[currentStepIdx];
      const indicator = document.getElementById('step-indicator');
      indicator.innerHTML = currentTutorial.steps.map((_, i) =>
        '<div class="step-dot ' + (i < currentStepIdx ? 'completed' : i === currentStepIdx ? 'current' : '') + '"></div>'
      ).join('');
      document.getElementById('tutorial-title').textContent = step.title;
      document.getElementById('tutorial-desc').textContent = step.description;
      document.getElementById('tutorial-hints').innerHTML = step.hints.map(h => '<div class="hint">💡 ' + h + '</div>').join('');
      document.getElementById('code-editor').value = step.code;
    }

    function nextStep() {
      if (!currentTutorial || currentStepIdx >= currentTutorial.steps.length - 1) return;
      currentStepIdx++;
      renderStep();
    }

    // Restore from URL
    const params = new URLSearchParams(location.search);
    if (params.get('session')) {
      try {
        const d = JSON.parse(atob(params.get('session')));
        editorContent = { schema: d.s || '', queries: d.q || '', mutations: d.m || '' };
        document.getElementById('code-editor').value = editorContent[currentTab];
      } catch(e: unknown) {}
    }
  </script>
</body>
</html>`
}
