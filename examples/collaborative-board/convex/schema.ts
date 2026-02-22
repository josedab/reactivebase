import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    avatarUrl: v.optional(v.string()),
    color: v.string(),
  }).index("by_email", ["email"], { unique: true }),

  boards: defineTable({
    title: v.string(),
    ownerId: v.id("users"),
    createdAt: v.timestamp({ default: "now" }),
  }).relation("owner", { from: "ownerId", to: "users" }),

  columns: defineTable({
    boardId: v.id("boards"),
    title: v.string(),
    position: v.integer(),
  })
    .index("by_board", ["boardId"])
    .relation("board", { from: "boardId", to: "boards" })
    .relation("tasks", { from: "id", to: "tasks.columnId" }),

  tasks: defineTable({
    columnId: v.id("columns"),
    title: v.string(),
    description: v.optional(v.string()),
    assigneeId: v.optional(v.id("users")),
    priority: v.enum("low", "medium", "high", "critical"),
    position: v.integer(),
    labels: v.array(v.string()),
    embedding: v.optional(v.vector(384)),
    createdAt: v.timestamp({ default: "now" }),
  })
    .index("by_column", ["columnId"])
    .index("by_assignee", ["assigneeId"])
    .vectorIndex("embedding_idx", "embedding", { metric: "cosine" })
    .relation("column", { from: "columnId", to: "columns" })
    .relation("assignee", { from: "assigneeId", to: "users" }),
})
