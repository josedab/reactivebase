/**
 * Built-in playground templates and tutorials.
 */

import type { PlaygroundTemplate, TutorialDefinition } from "./playground-types.js"

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
console.info("Created:", task)

const tasks = await listTasks()
console.info("Active tasks:", tasks)`,
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
