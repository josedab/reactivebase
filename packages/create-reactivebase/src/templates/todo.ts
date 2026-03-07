/**
 * Todo App Template for create-reactivebase.
 * Generates a reactive todo application with user assignment,
 * priority levels, and real-time updates.
 */

export const todoSchemaTs = `import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    avatarUrl: v.optional(v.string()),
  }).index("by_email", ["email"], { unique: true }),

  tasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    done: v.boolean({ default: false }),
    priority: v.enum("low", "medium", "high", "critical"),
    assigneeId: v.optional(v.id("users")),
    dueDate: v.optional(v.timestamp()),
    createdAt: v.timestamp({ default: "now" }),
  })
    .index("by_assignee", ["assigneeId"])
    .index("by_priority", ["priority"])
    .index("by_done", ["done"]),
})
`

export const todoFunctionsTs = `import { query, mutation } from "@reactivebase/server"

export const listTasks = query(async (ctx, args: { done?: boolean }) => {
  if (args.done !== undefined) {
    return ctx.db.tasks.where({ done: args.done }).orderBy("priority", "desc")
  }
  return ctx.db.tasks.where({}).orderBy("createdAt", "desc")
})

export const getTask = query(async (ctx, args: { id: string }) => {
  return ctx.db.tasks.getOrThrow(args.id)
})

export const createTask = mutation(async (ctx, args: {
  title: string
  description?: string
  priority?: "low" | "medium" | "high" | "critical"
  assigneeId?: string
}) => {
  return ctx.db.tasks.insert({
    title: args.title,
    description: args.description ?? null,
    done: false,
    priority: args.priority ?? "medium",
    assigneeId: args.assigneeId ?? null,
  })
})

export const toggleTask = mutation(async (ctx, args: { id: string }) => {
  const task = ctx.db.tasks.getOrThrow(args.id)
  return ctx.db.tasks.update(args.id, { done: !task.done })
})

export const deleteTask = mutation(async (ctx, args: { id: string }) => {
  ctx.db.tasks.delete(args.id)
})

export const listUsers = query(async (ctx) => {
  return ctx.db.users.where({})
})
`

export const todoServerTs = `import { createReactiveBaseServer } from "@reactivebase/server"
import schema from "./convex/schema.js"
import * as functions from "./convex/functions.js"

const server = createReactiveBaseServer(schema, {
  database: {
    connectionString: process.env.DATABASE_URL ?? "pglite://.reactivebase/data",
  },
  server: { port: 4000 },
})

server.registerFunctions(functions)
server.start().then(({ port }) => {
  console.log(\`ReactiveBase todo server listening on http://localhost:\${port}\`)
})
`

export const todoReadmeMd = `# Todo App

A reactive todo application built with ReactiveBase.

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

## Features

- Real-time task updates across all connected clients
- Priority levels (low, medium, high, critical)
- User assignment
- Filter by completion status
`
