import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  projects: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    ownerId: v.string(),
    createdAt: v.timestamp({ default: "now" }),
  }).index("by_owner", ["ownerId"]),

  boards: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    columns: v.json(), // ["todo", "in-progress", "review", "done"]
    createdAt: v.timestamp({ default: "now" }),
  }).index("by_project", ["projectId"]),

  tasks: defineTable({
    boardId: v.id("boards"),
    projectId: v.id("projects"),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.enum("todo", "in_progress", "review", "done"),
    priority: v.enum("low", "medium", "high", "urgent"),
    assigneeId: v.optional(v.string()),
    labels: v.optional(v.json()),
    position: v.integer(),
    createdAt: v.timestamp({ default: "now" }),
    updatedAt: v.timestamp({ default: "now" }),
  })
    .index("by_board_status", ["boardId", "status"])
    .index("by_assignee", ["assigneeId"])
    .index("by_project", ["projectId"]),

  comments: defineTable({
    taskId: v.id("tasks"),
    authorId: v.string(),
    body: v.string(),
    parentId: v.optional(v.id("comments")),
    createdAt: v.timestamp({ default: "now" }),
  }).index("by_task", ["taskId"]),
})
