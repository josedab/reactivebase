import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  documents: defineTable({
    title: v.string(),
    ownerId: v.string(),
    isPublic: v.boolean({ default: false }),
    lastEditedBy: v.optional(v.string()),
    createdAt: v.timestamp({ default: "now" }),
    updatedAt: v.timestamp({ default: "now" }),
  })
    .index("by_owner", ["ownerId"])
    .index("by_public", ["isPublic"]),

  document_versions: defineTable({
    documentId: v.id("documents"),
    version: v.integer(),
    label: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.timestamp({ default: "now" }),
  }).index("by_document", ["documentId"]),
})
