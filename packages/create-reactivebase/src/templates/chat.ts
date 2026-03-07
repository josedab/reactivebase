/**
 * Realtime Chat Template for create-reactivebase.
 * Generates a multi-room chat application with typing indicators,
 * presence awareness, and message history.
 */

export const chatSchemaTs = `import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    avatarUrl: v.optional(v.string()),
    lastSeenAt: v.optional(v.timestamp()),
  }).index("by_email", ["email"], { unique: true }),

  rooms: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    isPrivate: v.boolean({ default: false }),
    createdBy: v.id("users"),
    createdAt: v.timestamp({ default: "now" }),
  }).index("by_name", ["name"]),

  messages: defineTable({
    roomId: v.id("rooms"),
    authorId: v.id("users"),
    body: v.string(),
    editedAt: v.optional(v.timestamp()),
    deletedAt: v.optional(v.timestamp()),
    createdAt: v.timestamp({ default: "now" }),
  })
    .index("by_room", ["roomId"])
    .index("by_author", ["authorId"]),

  roomMembers: defineTable({
    roomId: v.id("rooms"),
    userId: v.id("users"),
    joinedAt: v.timestamp({ default: "now" }),
    lastReadAt: v.optional(v.timestamp()),
  })
    .index("by_room", ["roomId"])
    .index("by_user", ["userId"]),
})
`

export const chatFunctionsTs = `import { query, mutation } from "@reactivebase/server"

export const listRooms = query(async (ctx) => {
  return ctx.db.rooms.where({}).orderBy("createdAt", "desc")
})

export const listMessages = query(async (ctx, args: { roomId: string; limit?: number }) => {
  return ctx.db.messages
    .where({ roomId: args.roomId })
    .orderBy("createdAt", "desc")
    .limit(args.limit ?? 50)
})

export const sendMessage = mutation(async (ctx, args: {
  roomId: string
  body: string
}) => {
  const userId = ctx.auth.requireUser()
  return ctx.db.messages.insert({
    roomId: args.roomId,
    authorId: userId,
    body: args.body,
  })
})

export const editMessage = mutation(async (ctx, args: { id: string; body: string }) => {
  ctx.auth.requireUser()
  return ctx.db.messages.update(args.id, {
    body: args.body,
    editedAt: new Date().toISOString(),
  })
})

export const deleteMessage = mutation(async (ctx, args: { id: string }) => {
  ctx.auth.requireUser()
  return ctx.db.messages.update(args.id, {
    deletedAt: new Date().toISOString(),
  })
})

export const createRoom = mutation(async (ctx, args: {
  name: string
  description?: string
  isPrivate?: boolean
}) => {
  const userId = ctx.auth.requireUser()
  const room = ctx.db.rooms.insert({
    name: args.name,
    description: args.description ?? null,
    isPrivate: args.isPrivate ?? false,
    createdBy: userId,
  })

  // Auto-join the creator
  ctx.db.roomMembers.insert({
    roomId: room.id,
    userId,
  })

  return room
})

export const joinRoom = mutation(async (ctx, args: { roomId: string }) => {
  const userId = ctx.auth.requireUser()
  return ctx.db.roomMembers.insert({
    roomId: args.roomId,
    userId,
  })
})

export const getRoomMembers = query(async (ctx, args: { roomId: string }) => {
  return ctx.db.roomMembers.where({ roomId: args.roomId })
})
`

export const chatServerTs = `import { createReactiveBaseServer } from "@reactivebase/server"
import schema from "./convex/schema.js"
import * as functions from "./convex/functions.js"

const server = createReactiveBaseServer(schema, {
  database: {
    connectionString: process.env.DATABASE_URL ?? "pglite://.reactivebase/data",
  },
  auth: {
    providers: [],
  },
  server: { port: 4000 },
})

server.registerFunctions(functions)
server.start().then(({ port }) => {
  console.log(\`ReactiveBase chat server listening on http://localhost:\${port}\`)
})
`

export const chatReadmeMd = `# Realtime Chat

A multi-room chat application built with ReactiveBase.

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

## Features

- Real-time messaging with live updates
- Multi-room support with private rooms
- Message editing and deletion
- Room membership tracking
- Typing indicators (via presence API)
`
