import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  tenants: defineTable({
    name: v.string(),
    plan: v.enum("free", "pro", "enterprise"),
    apiKey: v.string(),
    createdAt: v.timestamp({ default: "now" }),
  }).index("by_api_key", ["apiKey"], { unique: true }),

  events: defineTable({
    tenantId: v.id("tenants"),
    type: v.enum("pageview", "click", "conversion", "signup", "custom"),
    name: v.string(),
    properties: v.optional(v.json()),
    sessionId: v.optional(v.string()),
    userId: v.optional(v.string()),
    createdAt: v.timestamp({ default: "now" }),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_type", ["tenantId", "type"])
    .index("by_time", ["createdAt"]),

  metrics: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    period: v.string(),
    value: v.number(),
    dimensions: v.optional(v.json()),
    computedAt: v.timestamp({ default: "now" }),
  })
    .index("by_tenant_name", ["tenantId", "name"])
    .index("by_period", ["tenantId", "period"]),

  alerts: defineTable({
    tenantId: v.id("tenants"),
    metricName: v.string(),
    threshold: v.number(),
    direction: v.enum("above", "below"),
    status: v.enum("active", "triggered", "acknowledged", "disabled"),
    lastTriggeredAt: v.optional(v.timestamp()),
    createdAt: v.timestamp({ default: "now" }),
  }).index("by_tenant", ["tenantId"]),
})
