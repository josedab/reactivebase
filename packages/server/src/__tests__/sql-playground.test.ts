import { describe, it, expect, beforeEach } from "vitest"
import { SqlPlayground } from "../sql-playground/sql-playground.js"
import type { SchemaInfo, QueryPlan } from "../sql-playground/sql-playground.js"

const sampleSchema: SchemaInfo = {
  tables: [
    {
      name: "tasks",
      columns: [
        { name: "id", type: "text", nullable: false },
        { name: "title", type: "text", nullable: false },
        { name: "done", type: "boolean", nullable: false },
        { name: "priority", type: "text", nullable: false },
        { name: "assignee_id", type: "text", nullable: true },
      ],
    },
    {
      name: "users",
      columns: [
        { name: "id", type: "text", nullable: false },
        { name: "name", type: "text", nullable: false },
        { name: "email", type: "text", nullable: false },
      ],
    },
  ],
  indexes: [
    { name: "tasks_pkey", table: "tasks", columns: ["id"], isUnique: true, isPrimary: true },
    { name: "users_pkey", table: "users", columns: ["id"], isUnique: true, isPrimary: true },
  ],
}

describe("SqlPlayground", () => {
  let playground: SqlPlayground

  beforeEach(() => {
    playground = new SqlPlayground()
  })

  describe("analyzeQuery", () => {
    it("identifies read-only SELECT queries", () => {
      const analysis = playground.analyzeQuery("SELECT * FROM tasks WHERE done = false")
      expect(analysis.isReadOnly).toBe(true)
      expect(analysis.tables).toContain("tasks")
    })

    it("identifies write queries", () => {
      expect(playground.analyzeQuery("INSERT INTO tasks (title) VALUES ('test')").isReadOnly).toBe(false)
      expect(playground.analyzeQuery("UPDATE tasks SET done = true").isReadOnly).toBe(false)
      expect(playground.analyzeQuery("DELETE FROM tasks WHERE id = '1'").isReadOnly).toBe(false)
    })

    it("detects JOINs", () => {
      const analysis = playground.analyzeQuery("SELECT t.*, u.name FROM tasks t JOIN users u ON t.assignee_id = u.id")
      expect(analysis.hasJoin).toBe(true)
      expect(analysis.tables).toContain("tasks")
      expect(analysis.tables).toContain("users")
    })

    it("detects subqueries", () => {
      const analysis = playground.analyzeQuery(
        "SELECT * FROM tasks WHERE assignee_id IN (SELECT id FROM users WHERE name = 'Alice')",
      )
      expect(analysis.hasSubquery).toBe(true)
    })

    it("detects aggregations", () => {
      const analysis = playground.analyzeQuery("SELECT priority, COUNT(*) FROM tasks GROUP BY priority")
      expect(analysis.hasAggregation).toBe(true)
    })

    it("detects window functions", () => {
      const analysis = playground.analyzeQuery(
        "SELECT *, ROW_NUMBER() OVER (PARTITION BY priority ORDER BY id) FROM tasks",
      )
      expect(analysis.hasWindow).toBe(true)
    })

    it("classifies complexity", () => {
      expect(playground.analyzeQuery("SELECT * FROM tasks").complexity).toBe("simple")
      expect(playground.analyzeQuery("SELECT * FROM tasks JOIN users ON true").complexity).toBe("moderate")
      expect(
        playground.analyzeQuery("SELECT * FROM tasks WHERE id IN (SELECT id FROM users) JOIN x ON true GROUP BY y")
          .complexity,
      ).toBe("complex")
    })

    it("generates warnings for SELECT *", () => {
      const analysis = playground.analyzeQuery("SELECT * FROM tasks")
      expect(analysis.warnings.some((w) => w.includes("SELECT *"))).toBe(true)
    })

    it("warns about missing LIMIT", () => {
      const analysis = playground.analyzeQuery("SELECT * FROM tasks")
      expect(analysis.warnings.some((w) => w.includes("LIMIT"))).toBe(true)
    })

    it("warns about writes in read-only mode", () => {
      const analysis = playground.analyzeQuery("UPDATE tasks SET done = true")
      expect(analysis.warnings.some((w) => w.includes("Write operations are disabled"))).toBe(true)
    })
  })

  describe("formatSql", () => {
    it("adds line breaks for keywords", () => {
      const formatted = playground.formatSql("SELECT * FROM tasks WHERE done = false ORDER BY id LIMIT 10")
      expect(formatted).toContain("\n")
      expect(formatted).toContain("SELECT")
      expect(formatted).toContain("FROM")
    })
  })

  describe("parsePlan", () => {
    it("parses EXPLAIN output", () => {
      const raw = `Seq Scan on tasks  (cost=0.00..35.50 rows=550 width=128)
  Filter: (done = false)
Planning Time: 0.089 ms
Execution Time: 0.523 ms`

      const plan = playground.parsePlan(raw)
      expect(plan.nodes).toHaveLength(1)
      expect(plan.nodes[0].type).toContain("Seq Scan")
      expect(plan.nodes[0].planRows).toBe(550)
      expect(plan.planningTimeMs).toBeCloseTo(0.089)
      expect(plan.actualTimeMs).toBeCloseTo(0.523)
    })

    it("handles nested plan nodes", () => {
      const raw = `Hash Join  (cost=1.05..38.15 rows=10 width=256)
  ->  Seq Scan on tasks  (cost=0.00..35.50 rows=550 width=128)
  ->  Hash  (cost=1.04..1.04 rows=1 width=128)
        ->  Seq Scan on users  (cost=0.00..1.04 rows=1 width=128)`

      const plan = playground.parsePlan(raw)
      expect(plan.nodes.length).toBeGreaterThan(0)
      expect(plan.totalCost).toBeGreaterThan(0)
    })

    it("parses JSON-format EXPLAIN output", () => {
      const jsonPlan = JSON.stringify([
        {
          Plan: {
            "Node Type": "Index Scan",
            "Relation Name": "tasks",
            "Alias": "tasks",
            "Startup Cost": 0.29,
            "Total Cost": 8.3,
            "Plan Rows": 1,
            "Plan Width": 128,
            "Index Name": "idx_tasks_done",
            "Filter": "(done = false)",
          },
          "Planning Time": 0.052,
          "Execution Time": 0.112,
        },
      ])

      const plan = playground.parsePlan(jsonPlan)
      expect(plan.nodes).toHaveLength(1)
      expect(plan.nodes[0].type).toBe("Index Scan")
      expect(plan.nodes[0].relation).toBe("tasks")
      expect(plan.nodes[0].indexName).toBe("idx_tasks_done")
      expect(plan.nodes[0].filter).toBe("(done = false)")
      expect(plan.nodes[0].totalCost).toBeCloseTo(8.3)
      expect(plan.planningTimeMs).toBeCloseTo(0.052)
      expect(plan.actualTimeMs).toBeCloseTo(0.112)
    })

    it("parses nested JSON plan with children", () => {
      const jsonPlan = JSON.stringify([
        {
          Plan: {
            "Node Type": "Hash Join",
            "Startup Cost": 1.05,
            "Total Cost": 38.15,
            "Plan Rows": 10,
            "Plan Width": 256,
            "Join Filter": "(tasks.user_id = users.id)",
            Plans: [
              {
                "Node Type": "Seq Scan",
                "Relation Name": "tasks",
                "Startup Cost": 0,
                "Total Cost": 35.5,
                "Plan Rows": 550,
                "Plan Width": 128,
              },
              {
                "Node Type": "Hash",
                "Startup Cost": 1.04,
                "Total Cost": 1.04,
                "Plan Rows": 1,
                "Plan Width": 128,
                Plans: [
                  {
                    "Node Type": "Seq Scan",
                    "Relation Name": "users",
                    "Startup Cost": 0,
                    "Total Cost": 1.04,
                    "Plan Rows": 1,
                    "Plan Width": 128,
                  },
                ],
              },
            ],
          },
        },
      ])

      const plan = playground.parsePlan(jsonPlan)
      expect(plan.nodes).toHaveLength(1)
      expect(plan.nodes[0].type).toBe("Hash Join")
      expect(plan.nodes[0].children).toHaveLength(2)
      expect(plan.nodes[0].children[0].type).toBe("Seq Scan")
      expect(plan.nodes[0].children[0].relation).toBe("tasks")
      expect(plan.nodes[0].children[1].type).toBe("Hash")
      expect(plan.nodes[0].children[1].children).toHaveLength(1)
      expect(plan.nodes[0].children[1].children[0].relation).toBe("users")
    })

    it("falls back to text parsing for invalid JSON", () => {
      const raw = `Seq Scan on tasks  (cost=0.00..35.50 rows=550 width=128)
Planning Time: 0.089 ms`

      const plan = playground.parsePlan(raw)
      expect(plan.nodes).toHaveLength(1)
      expect(plan.nodes[0].planRows).toBe(550)
    })
  })

  describe("suggestIndexes", () => {
    it("suggests index for sequential scans with filter", () => {
      const analysis = playground.analyzeQuery("SELECT * FROM tasks WHERE done = false")
      const plan: QueryPlan = {
        raw: "",
        nodes: [
          {
            type: "Seq Scan on tasks",
            relation: "tasks",
            startupCost: 0,
            totalCost: 100,
            planRows: 5000,
            planWidth: 128,
            children: [],
            filter: "done = false",
          },
        ],
        totalCost: 100,
      }

      const suggestions = playground.suggestIndexes(analysis, plan)
      expect(suggestions.some((s) => s.table === "tasks" && s.columns.includes("done"))).toBe(true)
    })

    it("suggests LIMIT for queries without one", () => {
      const analysis = playground.analyzeQuery("SELECT * FROM tasks")
      const suggestions = playground.suggestIndexes(analysis)
      expect(suggestions.some((s) => s.reason.includes("LIMIT"))).toBe(true)
    })
  })

  describe("naturalLanguageToSql", () => {
    it("generates fallback SQL without AI provider", async () => {
      const result = await playground.naturalLanguageToSql("show me all tasks", sampleSchema)
      expect(result.sql).toContain("tasks")
      expect(result.confidence).toBeLessThan(1)
      expect(result.warnings.length).toBeGreaterThan(0)
    })

    it("handles count queries in fallback", async () => {
      const result = await playground.naturalLanguageToSql("count all users", sampleSchema)
      expect(result.sql).toContain("COUNT")
    })
  })

  describe("query history", () => {
    it("adds and retrieves history", () => {
      playground.addToHistory({
        sql: "SELECT 1",
        executedAt: Date.now(),
        executionTimeMs: 5,
        rowCount: 1,
        success: true,
      })
      expect(playground.getHistory()).toHaveLength(1)
    })

    it("limits history size", () => {
      for (let i = 0; i < 150; i++) {
        playground.addToHistory({
          sql: `SELECT ${i}`,
          executedAt: Date.now(),
          executionTimeMs: 1,
          rowCount: 1,
          success: true,
        })
      }
      expect(playground.getHistory().length).toBeLessThanOrEqual(100)
    })

    it("clears history", () => {
      playground.addToHistory({
        sql: "SELECT 1",
        executedAt: Date.now(),
        executionTimeMs: 1,
        rowCount: 1,
        success: true,
      })
      playground.clearHistory()
      expect(playground.getHistory()).toHaveLength(0)
    })
  })

  describe("saved queries", () => {
    it("saves and retrieves queries", () => {
      playground.saveQuery("My Query", "SELECT * FROM tasks")
      const saved = playground.getSavedQueries()
      expect(saved).toHaveLength(1)
      expect(saved[0].name).toBe("My Query")
    })

    it("deletes saved queries", () => {
      const id = playground.saveQuery("temp", "SELECT 1")
      expect(playground.deleteSavedQuery(id)).toBe(true)
      expect(playground.getSavedQueries()).toHaveLength(0)
    })
  })

  describe("generatePlaygroundHTML", () => {
    it("generates valid HTML with editor and controls", () => {
      const html = playground.generatePlaygroundHTML()
      expect(html).toContain("sql-playground")
      expect(html).toContain("sql-editor")
      expect(html).toContain("run-btn")
      expect(html).toContain("ai-btn")
    })
  })
})
