/**
 * Schema definition for the basic todo example.
 * This single file is the source of truth for the data model,
 * producing both Postgres tables and TypeScript types.
 */

import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
  }).index("by_email", ["email"], { unique: true }),

  tasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    done: v.boolean({ default: false }),
    priority: v.enum("low", "medium", "high", "critical"),
    assigneeId: v.id("users"),
    createdAt: v.timestamp({ default: "now" }),
  })
    .index("by_assignee", ["assigneeId"])
    .index("by_priority", ["priority"])
    .relation("assignee", { from: "assigneeId", to: "users" })
    .relation("comments", { from: "id", to: "comments.taskId" }),

  comments: defineTable({
    taskId: v.id("tasks"),
    authorId: v.id("users"),
    body: v.string(),
    createdAt: v.timestamp({ default: "now" }),
  })
    .index("by_task", ["taskId"])
    .relation("author", { from: "authorId", to: "users" }),
})
