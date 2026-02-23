import { describe, it, expect, beforeEach } from "vitest"
import { QueryAssistant } from "../ai-assistant/ai-assistant.js"
import type { SchemaInfo, AccessPattern } from "../ai-assistant/ai-assistant.js"

const testSchema: SchemaInfo = {
  tables: [
    {
      name: "tasks",
      columns: [
        { name: "id", type: "text", nullable: false },
        { name: "title", type: "text", nullable: false },
        { name: "done", type: "boolean", nullable: false },
        { name: "priority", type: "text", nullable: false },
        { name: "assigneeId", type: "text", nullable: false },
      ],
      indexes: [{ name: "by_assignee", columns: ["assigneeId"] }],
    },
    {
      name: "users",
      columns: [
        { name: "id", type: "text", nullable: false },
        { name: "name", type: "text", nullable: false },
        { name: "email", type: "text", nullable: false },
      ],
      indexes: [{ name: "by_email", columns: ["email"] }],
    },
  ],
}

describe("QueryAssistant", () => {
  let assistant: QueryAssistant

  beforeEach(() => {
    assistant = new QueryAssistant()
    assistant.setSchema(testSchema)
  })

  describe("generateQuery", () => {
    it("generates query for 'list tasks'", async () => {
      const result = await assistant.generateQuery("list tasks")
      expect(result.code).toContain("ctx.db.tasks")
      expect(result.code).toContain("query")
      expect(result.tables).toContain("tasks")
      expect(result.confidence).toBeGreaterThan(0)
      expect(result.method).toBe("rule-based")
    })

    it("generates query for 'find users where email = value'", async () => {
      const result = await assistant.generateQuery("get users where email is john")
      expect(result.code).toContain("ctx.db.users")
      expect(result.code).toContain("email")
    })

    it("generates mutation for 'create task'", async () => {
      const result = await assistant.generateQuery("create task")
      expect(result.code).toContain("mutation")
      expect(result.code).toContain("insert")
    })

    it("generates mutation for 'update tasks'", async () => {
      const result = await assistant.generateQuery("update task")
      expect(result.code).toContain("mutation")
      expect(result.code).toContain("update")
    })

    it("generates mutation for 'delete tasks'", async () => {
      const result = await assistant.generateQuery("delete task")
      expect(result.code).toContain("mutation")
      expect(result.code).toContain("delete")
    })

    it("generates count query", async () => {
      const result = await assistant.generateQuery("count tasks")
      expect(result.code).toContain("count()")
    })

    it("generates ordered query", async () => {
      const result = await assistant.generateQuery("tasks ordered by priority desc")
      expect(result.code).toContain("orderBy")
      expect(result.code).toContain("desc")
    })

    it("returns fallback for unrecognized patterns", async () => {
      const result = await assistant.generateQuery("xyzzy foobar baz")
      expect(result.confidence).toBe(0)
      expect(result.code).toContain("Could not generate")
    })
  })

  describe("explainQuery", () => {
    it("explains a query with filter", () => {
      const explanation = assistant.explainQuery(
        `export const f = query(async (ctx) => { return ctx.db.tasks.where({ done: false }).orderBy("priority", "desc").limit(20) })`,
      )
      expect(explanation.summary).toContain("tasks")
      expect(explanation.steps.length).toBeGreaterThan(0)
      expect(explanation.steps.some((s) => s.operation === "Filter")).toBe(true)
      expect(explanation.steps.some((s) => s.operation === "Sort")).toBe(true)
      expect(explanation.steps.some((s) => s.operation === "Limit")).toBe(true)
    })

    it("explains raw SQL queries", () => {
      const explanation = assistant.explainQuery(`ctx.db.raw("SELECT * FROM tasks")`)
      expect(explanation.steps.some((s) => s.operation === "Raw SQL")).toBe(true)
      expect(explanation.performanceNotes.length).toBeGreaterThan(0)
    })

    it("suggests indexes for filtered columns", () => {
      const explanation = assistant.explainQuery(`ctx.db.tasks.where({ priority: "high" })`)
      expect(explanation.suggestedIndexes.length).toBeGreaterThan(0)
    })
  })

  describe("suggestOptimizations", () => {
    it("suggests missing indexes", () => {
      const patterns: AccessPattern[] = [
        {
          queryName: "listByPriority",
          tables: ["tasks"],
          filters: [{ column: "priority", operator: "=" }],
          frequency: 100,
        },
      ]

      const suggestions = assistant.suggestOptimizations(patterns, testSchema)
      const indexSuggestion = suggestions.find((s) => s.type === "missing-index" && s.field === "priority")
      expect(indexSuggestion).toBeDefined()
      expect(indexSuggestion!.fix).toContain("CREATE INDEX")
    })

    it("does not suggest for already-indexed columns", () => {
      const patterns: AccessPattern[] = [
        {
          queryName: "listByAssignee",
          tables: ["tasks"],
          filters: [{ column: "assigneeId", operator: "=" }],
          frequency: 100,
        },
      ]

      const suggestions = assistant.suggestOptimizations(patterns, testSchema)
      const indexSuggestion = suggestions.find((s) => s.type === "missing-index" && s.field === "assigneeId")
      expect(indexSuggestion).toBeUndefined()
    })

    it("suggests denormalization for co-accessed tables", () => {
      const patterns: AccessPattern[] = Array.from({ length: 60 }, (_, i) => ({
        queryName: `joint-${i}`,
        tables: ["tasks", "users"],
        filters: [],
        frequency: 1,
      }))

      const suggestions = assistant.suggestOptimizations(patterns, testSchema)
      const denormSuggestion = suggestions.find((s) => s.type === "denormalization")
      expect(denormSuggestion).toBeDefined()
    })

    it("returns empty when no schema", () => {
      const noSchema = new QueryAssistant()
      expect(noSchema.suggestOptimizations([])).toEqual([])
    })
  })
})
