import { describe, it, expect } from "vitest"
import { generateFullDashboardHTML } from "../dashboard/full-dashboard.js"
import { schemaToVisualModel } from "../dashboard/schema-visualizer.js"
import { defineSchema, defineTable, v } from "../schema/index.js"

const schema = defineSchema({
  users: defineTable({ name: v.string(), email: v.string() }),
  tasks: defineTable({ title: v.string(), done: v.boolean() }).relation("comments", {
    from: "id",
    to: "comments.taskId",
  }),
  comments: defineTable({ taskId: v.id("tasks"), body: v.string() }),
})

describe("Full Dashboard", () => {
  it("generates HTML with metrics panel", () => {
    const model = schemaToVisualModel(schema)
    const html = generateFullDashboardHTML(model)

    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("ReactiveBase")
    expect(html).toContain("Metrics")
    expect(html).toContain("Schema")
    expect(html).toContain("Subscriptions")
    expect(html).toContain("/metrics")
    expect(html).toContain("refreshMetrics")
    expect(html).toContain("metric-card")
  })

  it("includes all schema tables", () => {
    const model = schemaToVisualModel(schema)
    const html = generateFullDashboardHTML(model)

    expect(html).toContain("users")
    expect(html).toContain("tasks")
    expect(html).toContain("comments")
  })

  it("includes tab navigation", () => {
    const model = schemaToVisualModel(schema)
    const html = generateFullDashboardHTML(model)

    expect(html).toContain("showTab('metrics')")
    expect(html).toContain("showTab('schema')")
    expect(html).toContain("showTab('subscriptions')")
  })

  it("includes auto-refresh script", () => {
    const model = schemaToVisualModel(schema)
    const html = generateFullDashboardHTML(model)

    expect(html).toContain("setInterval(refreshMetrics")
    expect(html).toContain("5000")
  })
})
