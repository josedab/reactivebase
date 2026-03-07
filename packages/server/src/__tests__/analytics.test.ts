import { describe, it, expect, vi } from "vitest"
import {
  AggregationEngine,
  AnalyticsEngine,
  AnalyticsError,
  buildCreateAnalyticsTablesSQL,
  buildUpsertPipelineSQL,
  buildUpsertResultSQL,
  buildGetResultSQL,
  buildUpsertDashboardSQL,
  buildGetDashboardSQL,
  compilePipelineToSQL,
  generateEmbedToken,
  generateEmbedSnippet,
  type AggregationPipeline,
  type DashboardDefinition,
  type AggregationStage,
} from "../analytics/analytics.js"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePipeline(overrides: Partial<AggregationPipeline> = {}): AggregationPipeline {
  return {
    id: "p1",
    name: "Test Pipeline",
    source: "orders",
    stages: [],
    refreshMode: "manual",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function makeDashboard(overrides: Partial<DashboardDefinition> = {}): DashboardDefinition {
  return {
    id: "d1",
    name: "Test Dashboard",
    description: "A test dashboard",
    widgets: [],
    layout: { columns: 12, rowHeight: 60, gap: 8 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

const sampleRows = [
  { category: "A", amount: 10, name: "alpha" },
  { category: "B", amount: 20, name: "beta" },
  { category: "A", amount: 30, name: "gamma" },
  { category: "B", amount: 40, name: "delta" },
  { category: "A", amount: 50, name: "epsilon" },
]

// ── AggregationEngine ─────────────────────────────────────────────────────────

describe("AggregationEngine", () => {
  const engine = new AggregationEngine()

  describe("match stage", () => {
    it("filters rows matching conditions", () => {
      const stages: AggregationStage[] = [{ type: "match", conditions: { category: "A" } }]
      const result = engine.execute(stages, sampleRows)
      expect(result).toHaveLength(3)
      expect(result.every((r) => r.category === "A")).toBe(true)
    })

    it("returns empty array when no rows match", () => {
      const stages: AggregationStage[] = [{ type: "match", conditions: { category: "Z" } }]
      const result = engine.execute(stages, sampleRows)
      expect(result).toHaveLength(0)
    })
  })

  describe("group stage", () => {
    it("groups by field and computes count", () => {
      const stages: AggregationStage[] = [
        {
          type: "group",
          by: ["category"],
          aggregations: [{ name: "total", op: "count" }],
        },
      ]
      const result = engine.execute(stages, sampleRows)
      expect(result).toHaveLength(2)
      const groupA = result.find((r) => r.category === "A")
      const groupB = result.find((r) => r.category === "B")
      expect(groupA?.total).toBe(3)
      expect(groupB?.total).toBe(2)
    })

    it("computes sum aggregation", () => {
      const stages: AggregationStage[] = [
        {
          type: "group",
          by: ["category"],
          aggregations: [{ name: "totalAmount", op: "sum", field: "amount" }],
        },
      ]
      const result = engine.execute(stages, sampleRows)
      const groupA = result.find((r) => r.category === "A")
      expect(groupA?.totalAmount).toBe(90) // 10+30+50
    })

    it("computes avg aggregation", () => {
      const stages: AggregationStage[] = [
        {
          type: "group",
          by: ["category"],
          aggregations: [{ name: "avgAmount", op: "avg", field: "amount" }],
        },
      ]
      const result = engine.execute(stages, sampleRows)
      const groupA = result.find((r) => r.category === "A")
      expect(groupA?.avgAmount).toBe(30) // (10+30+50)/3
    })

    it("computes min and max aggregations", () => {
      const stages: AggregationStage[] = [
        {
          type: "group",
          by: ["category"],
          aggregations: [
            { name: "minAmt", op: "min", field: "amount" },
            { name: "maxAmt", op: "max", field: "amount" },
          ],
        },
      ]
      const result = engine.execute(stages, sampleRows)
      const groupA = result.find((r) => r.category === "A")
      expect(groupA?.minAmt).toBe(10)
      expect(groupA?.maxAmt).toBe(50)
    })

    it("computes distinct_count aggregation", () => {
      const stages: AggregationStage[] = [
        {
          type: "group",
          by: ["category"],
          aggregations: [{ name: "uniqueAmounts", op: "distinct_count", field: "amount" }],
        },
      ]
      const result = engine.execute(stages, sampleRows)
      const groupA = result.find((r) => r.category === "A")
      expect(groupA?.uniqueAmounts).toBe(3)
    })
  })

  describe("sort stage", () => {
    it("sorts rows ascending", () => {
      const stages: AggregationStage[] = [{ type: "sort", fields: [{ field: "amount", direction: "asc" }] }]
      const result = engine.execute(stages, sampleRows)
      expect(result[0].amount).toBe(10)
      expect(result[result.length - 1].amount).toBe(50)
    })

    it("sorts rows descending", () => {
      const stages: AggregationStage[] = [{ type: "sort", fields: [{ field: "amount", direction: "desc" }] }]
      const result = engine.execute(stages, sampleRows)
      expect(result[0].amount).toBe(50)
      expect(result[result.length - 1].amount).toBe(10)
    })
  })

  describe("limit stage", () => {
    it("limits number of rows", () => {
      const stages: AggregationStage[] = [{ type: "limit", count: 2 }]
      const result = engine.execute(stages, sampleRows)
      expect(result).toHaveLength(2)
    })
  })

  describe("project stage", () => {
    it("projects specific fields", () => {
      const stages: AggregationStage[] = [{ type: "project", fields: { category: true, amount: true } }]
      const result = engine.execute(stages, sampleRows)
      expect(Object.keys(result[0])).toEqual(["category", "amount"])
    })

    it("renames fields via string mapping", () => {
      const stages: AggregationStage[] = [{ type: "project", fields: { cat: "category", val: "amount" } }]
      const result = engine.execute(stages, sampleRows)
      expect(result[0]).toHaveProperty("cat", "A")
      expect(result[0]).toHaveProperty("val", 10)
    })

    it("excludes fields set to false", () => {
      const stages: AggregationStage[] = [{ type: "project", fields: { category: true, amount: false } }]
      const result = engine.execute(stages, sampleRows)
      expect(result[0]).toHaveProperty("category")
      expect(result[0]).not.toHaveProperty("amount")
    })
  })

  describe("window stage", () => {
    it("computes row_number", () => {
      const stages: AggregationStage[] = [
        {
          type: "window",
          partitionBy: ["category"],
          orderBy: "amount",
          functions: [{ name: "rn", op: "row_number" }],
        },
      ]
      const result = engine.execute(stages, sampleRows)
      const categoryA = result.filter((r) => r.category === "A")
      expect(categoryA.map((r) => r.rn)).toEqual([1, 2, 3])
    })

    it("computes running_sum", () => {
      const stages: AggregationStage[] = [
        {
          type: "window",
          partitionBy: ["category"],
          orderBy: "amount",
          functions: [{ name: "cumSum", op: "running_sum", field: "amount" }],
        },
      ]
      const result = engine.execute(stages, sampleRows)
      const categoryA = result.filter((r) => r.category === "A")
      expect(categoryA.map((r) => r.cumSum)).toEqual([10, 40, 90])
    })

    it("computes moving_avg with default window size", () => {
      const stages: AggregationStage[] = [
        {
          type: "window",
          partitionBy: ["category"],
          orderBy: "amount",
          functions: [{ name: "ma", op: "moving_avg", field: "amount" }],
        },
      ]
      const result = engine.execute(stages, sampleRows)
      const categoryA = result.filter((r) => r.category === "A")
      expect(categoryA[0].ma).toBe(10)
      expect(categoryA[1].ma).toBe(20) // (10+30)/2
      expect(categoryA[2].ma).toBe(30) // (10+30+50)/3
    })

    it("computes lag and lead", () => {
      const stages: AggregationStage[] = [
        {
          type: "window",
          partitionBy: ["category"],
          orderBy: "amount",
          functions: [
            { name: "prevAmt", op: "lag", field: "amount" },
            { name: "nextAmt", op: "lead", field: "amount" },
          ],
        },
      ]
      const result = engine.execute(stages, sampleRows)
      const categoryA = result.filter((r) => r.category === "A")
      expect(categoryA[0].prevAmt).toBeNull()
      expect(categoryA[0].nextAmt).toBe(30)
      expect(categoryA[2].nextAmt).toBeNull()
      expect(categoryA[2].prevAmt).toBe(30)
    })
  })

  describe("pipeline composition", () => {
    it("chains match + group + sort", () => {
      const stages: AggregationStage[] = [
        { type: "match", conditions: { category: "A" } },
        {
          type: "group",
          by: ["category"],
          aggregations: [{ name: "total", op: "sum", field: "amount" }],
        },
        { type: "sort", fields: [{ field: "total", direction: "desc" }] },
      ]
      const result = engine.execute(stages, sampleRows)
      expect(result).toHaveLength(1)
      expect(result[0].total).toBe(90)
    })
  })

  describe("edge cases", () => {
    it("returns empty array for empty input", () => {
      const stages: AggregationStage[] = [{ type: "match", conditions: { x: 1 } }]
      expect(engine.execute(stages, [])).toEqual([])
    })

    it("returns input unchanged for unknown stage type", () => {
      const stages = [{ type: "unknown" }] as unknown as AggregationStage[]
      expect(engine.execute(stages, sampleRows)).toEqual(sampleRows)
    })

    it("handles avg on empty group", () => {
      const stages: AggregationStage[] = [
        { type: "match", conditions: { category: "NONE" } },
        {
          type: "group",
          by: ["category"],
          aggregations: [{ name: "avg", op: "avg", field: "amount" }],
        },
      ]
      const result = engine.execute(stages, sampleRows)
      expect(result).toHaveLength(0)
    })
  })
})

// ── AnalyticsEngine ───────────────────────────────────────────────────────────

describe("AnalyticsEngine", () => {
  it("registers and retrieves a pipeline", () => {
    const engine = new AnalyticsEngine()
    const pipeline = makePipeline()
    engine.registerPipeline(pipeline)
    expect(engine.getPipeline("p1")).toMatchObject({ id: "p1" })
    expect(engine.listPipelines()).toHaveLength(1)
  })

  it("throws when max pipelines reached", () => {
    const engine = new AnalyticsEngine({ maxPipelines: 1 })
    engine.registerPipeline(makePipeline({ id: "p1" }))
    expect(() => engine.registerPipeline(makePipeline({ id: "p2" }))).toThrow(AnalyticsError)
  })

  it("allows updating existing pipeline even at max", () => {
    const engine = new AnalyticsEngine({ maxPipelines: 1 })
    engine.registerPipeline(makePipeline({ id: "p1" }))
    expect(() => engine.registerPipeline(makePipeline({ id: "p1", name: "Updated" }))).not.toThrow()
  })

  it("computes pipeline with source data", () => {
    const engine = new AnalyticsEngine()
    engine.registerPipeline(
      makePipeline({
        stages: [{ type: "match", conditions: { category: "A" } }],
      }),
    )
    const result = engine.computePipeline("p1", sampleRows)
    expect(result.rows).toHaveLength(3)
    expect(result.stale).toBe(false)
    expect(result.pipelineId).toBe("p1")
  })

  it("throws when computing non-existent pipeline", () => {
    const engine = new AnalyticsEngine()
    expect(() => engine.computePipeline("missing", [])).toThrow(AnalyticsError)
  })

  it("caches and retrieves results", () => {
    const engine = new AnalyticsEngine()
    engine.registerPipeline(makePipeline())
    engine.computePipeline("p1", sampleRows)
    const cached = engine.getResult("p1")
    expect(cached).not.toBeNull()
    expect(cached!.rowCount).toBe(5)
  })

  it("returns null for non-existent result", () => {
    const engine = new AnalyticsEngine()
    expect(engine.getResult("missing")).toBeNull()
  })

  it("invalidates pipeline marking result as stale", () => {
    const engine = new AnalyticsEngine()
    engine.registerPipeline(makePipeline())
    engine.computePipeline("p1", sampleRows)
    engine.invalidatePipeline("p1")
    expect(engine.getResult("p1")!.stale).toBe(true)
  })

  it("notifies subscribers on compute", () => {
    const engine = new AnalyticsEngine()
    engine.registerPipeline(makePipeline())
    const callback = vi.fn()
    engine.onPipelineUpdate("p1", callback)
    engine.computePipeline("p1", sampleRows)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0].pipelineId).toBe("p1")
  })

  it("unsubscribes properly", () => {
    const engine = new AnalyticsEngine()
    engine.registerPipeline(makePipeline())
    const callback = vi.fn()
    const unsub = engine.onPipelineUpdate("p1", callback)
    unsub()
    engine.computePipeline("p1", sampleRows)
    expect(callback).not.toHaveBeenCalled()
  })

  it("swallows subscriber errors", () => {
    const engine = new AnalyticsEngine()
    engine.registerPipeline(makePipeline())
    engine.onPipelineUpdate("p1", () => {
      throw new Error("boom")
    })
    expect(() => engine.computePipeline("p1", sampleRows)).not.toThrow()
  })

  describe("dashboard CRUD", () => {
    it("saves and retrieves a dashboard", () => {
      const engine = new AnalyticsEngine()
      const dash = makeDashboard()
      engine.saveDashboard(dash)
      expect(engine.getDashboard("d1")).toMatchObject({ id: "d1" })
    })

    it("lists dashboards", () => {
      const engine = new AnalyticsEngine()
      engine.saveDashboard(makeDashboard({ id: "d1" }))
      engine.saveDashboard(makeDashboard({ id: "d2" }))
      expect(engine.listDashboards()).toHaveLength(2)
    })

    it("deletes a dashboard", () => {
      const engine = new AnalyticsEngine()
      engine.saveDashboard(makeDashboard())
      expect(engine.deleteDashboard("d1")).toBe(true)
      expect(engine.getDashboard("d1")).toBeNull()
    })

    it("returns false when deleting non-existent dashboard", () => {
      const engine = new AnalyticsEngine()
      expect(engine.deleteDashboard("missing")).toBe(false)
    })

    it("throws when too many widgets", () => {
      const engine = new AnalyticsEngine({ maxWidgetsPerDashboard: 1 })
      const dash = makeDashboard({
        widgets: [
          {
            id: "w1",
            type: "bar-chart",
            title: "W1",
            pipelineId: "p1",
            config: {},
            position: { x: 0, y: 0, width: 6, height: 4 },
          },
          {
            id: "w2",
            type: "bar-chart",
            title: "W2",
            pipelineId: "p1",
            config: {},
            position: { x: 0, y: 0, width: 6, height: 4 },
          },
        ],
      })
      expect(() => engine.saveDashboard(dash)).toThrow(AnalyticsError)
    })
  })

  it("tracks stats correctly", () => {
    const engine = new AnalyticsEngine()
    engine.registerPipeline(makePipeline())
    engine.saveDashboard(makeDashboard())
    engine.computePipeline("p1", sampleRows)
    const stats = engine.getStats()
    expect(stats.pipelineCount).toBe(1)
    expect(stats.dashboardCount).toBe(1)
    expect(stats.totalComputations).toBe(1)
  })
})

// ── SQL Builders ──────────────────────────────────────────────────────────────

describe("SQL builders", () => {
  it("buildCreateAnalyticsTablesSQL contains expected tables", () => {
    const sql = buildCreateAnalyticsTablesSQL()
    expect(sql).toContain("_rb_analytics_pipelines")
    expect(sql).toContain("_rb_analytics_results")
    expect(sql).toContain("_rb_analytics_dashboards")
  })

  it("buildUpsertPipelineSQL returns valid SQL", () => {
    expect(buildUpsertPipelineSQL()).toContain("INSERT INTO")
    expect(buildUpsertPipelineSQL()).toContain("ON CONFLICT")
  })

  it("buildUpsertResultSQL returns valid SQL", () => {
    expect(buildUpsertResultSQL()).toContain("INSERT INTO")
  })

  it("buildGetResultSQL returns SELECT", () => {
    expect(buildGetResultSQL()).toContain("SELECT")
  })

  it("buildUpsertDashboardSQL returns valid SQL", () => {
    expect(buildUpsertDashboardSQL()).toContain("INSERT INTO")
  })

  it("buildGetDashboardSQL returns SELECT", () => {
    expect(buildGetDashboardSQL()).toContain("SELECT")
  })
})

// ── compilePipelineToSQL ──────────────────────────────────────────────────────

describe("compilePipelineToSQL", () => {
  it("compiles a simple pipeline with match stage", () => {
    const pipeline = makePipeline({
      stages: [{ type: "match", conditions: { status: "active" } }],
    })
    const sql = compilePipelineToSQL(pipeline)
    expect(sql).toContain("WHERE")
    expect(sql).toContain("'active'")
  })

  it("compiles group stage with aggregations", () => {
    const pipeline = makePipeline({
      stages: [
        {
          type: "group",
          by: ["category"],
          aggregations: [
            { name: "cnt", op: "count" },
            { name: "total", op: "sum", field: "amount" },
          ],
        },
      ],
    })
    const sql = compilePipelineToSQL(pipeline)
    expect(sql).toContain("GROUP BY")
    expect(sql).toContain("COUNT")
    expect(sql).toContain("SUM")
  })

  it("compiles sort stage", () => {
    const pipeline = makePipeline({
      stages: [{ type: "sort", fields: [{ field: "name", direction: "desc" }] }],
    })
    const sql = compilePipelineToSQL(pipeline)
    expect(sql).toContain("ORDER BY")
    expect(sql).toContain("DESC")
  })

  it("compiles limit stage", () => {
    const pipeline = makePipeline({ stages: [{ type: "limit", count: 10 }] })
    const sql = compilePipelineToSQL(pipeline)
    expect(sql).toContain("LIMIT 10")
  })

  it("compiles project stage", () => {
    const pipeline = makePipeline({
      stages: [{ type: "project", fields: { name: true, val: "amount" } }],
    })
    const sql = compilePipelineToSQL(pipeline)
    expect(sql).toContain('"name"')
    expect(sql).toContain('"amount"')
  })
})

// ── Embed Token ───────────────────────────────────────────────────────────────

describe("generateEmbedToken", () => {
  it("generates a non-empty base64url token", () => {
    const token = generateEmbedToken("dash-1", "my-secret")
    expect(token.length).toBeGreaterThan(0)
    // base64url characters only
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it("generates different tokens for different dashboard IDs", () => {
    const t1 = generateEmbedToken("dash-1", "secret")
    const t2 = generateEmbedToken("dash-2", "secret")
    expect(t1).not.toBe(t2)
  })

  it("token contains dashboard id when decoded", () => {
    const token = generateEmbedToken("dash-1", "secret")
    const decoded = Buffer.from(token, "base64url").toString()
    expect(decoded).toContain("dash-1")
  })
})

describe("generateEmbedSnippet", () => {
  it("returns an iframe with correct attributes", () => {
    const html = generateEmbedSnippet({
      dashboardId: "dash-1",
      theme: "dark",
      allowInteraction: true,
    })
    expect(html).toContain("<iframe")
    expect(html).toContain("dash-1")
    expect(html).toContain("dark")
    expect(html).toContain("interactive=true")
  })

  it("includes token when provided", () => {
    const html = generateEmbedSnippet({
      dashboardId: "d1",
      theme: "light",
      allowInteraction: false,
      token: "abc123",
    })
    expect(html).toContain("token=abc123")
  })

  it("uses default dimensions when not specified", () => {
    const html = generateEmbedSnippet({
      dashboardId: "d1",
      theme: "auto",
      allowInteraction: false,
    })
    expect(html).toContain('width="100%"')
    expect(html).toContain('height="600px"')
  })
})

// ── AnalyticsError ────────────────────────────────────────────────────────────

describe("AnalyticsError", () => {
  it("has correct name and code", () => {
    const err = new AnalyticsError("test", "TEST_CODE")
    expect(err.name).toBe("AnalyticsError")
    expect(err.code).toBe("TEST_CODE")
    expect(err.message).toBe("test")
    expect(err).toBeInstanceOf(Error)
  })
})
