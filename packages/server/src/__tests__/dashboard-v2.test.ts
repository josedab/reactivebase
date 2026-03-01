import { describe, it, expect, beforeEach } from "vitest"
import {
  DashboardV2Engine,
  generateDashboardV2HTML,
  generateDashboardV2TableSQL,
  buildInsertMutationLogSQL,
  buildQueryMutationLogSQL,
  buildUpdateQueryStatsSQL,
  buildDataBrowserQuerySQL,
} from "../dashboard/query-inspector.js"
import type { MutationReplayEntry } from "../dashboard/query-inspector.js"

describe("DashboardV2Engine", () => {
  let engine: DashboardV2Engine

  beforeEach(() => {
    engine = new DashboardV2Engine()
  })

  describe("query inspector", () => {
    it("records query executions", () => {
      engine.recordQueryExecution("listTasks", 15, ["tasks"], 3)
      expect(engine.queryCount).toBe(1)
      const stats = engine.getQueryStats("listTasks")
      expect(stats).toBeDefined()
      expect(stats!.totalExecutions).toBe(1)
      expect(stats!.subscriberCount).toBe(3)
      expect(stats!.dependencies).toEqual(["tasks"])
    })

    it("computes percentile latencies", () => {
      for (let i = 1; i <= 100; i++) {
        engine.recordQueryExecution("q1", i, ["t"])
      }
      const stats = engine.getQueryStats("q1")!
      expect(stats.p50LatencyMs).toBeGreaterThanOrEqual(49)
      expect(stats.p50LatencyMs).toBeLessThanOrEqual(51)
      expect(stats.p95LatencyMs).toBeGreaterThanOrEqual(94)
      expect(stats.p95LatencyMs).toBeLessThanOrEqual(96)
      expect(stats.p99LatencyMs).toBeGreaterThanOrEqual(98)
      expect(stats.p99LatencyMs).toBeLessThanOrEqual(100)
    })

    it("tracks invalidations", () => {
      engine.recordQueryExecution("q1", 10, ["t"])
      engine.recordQueryInvalidation("q1")
      engine.recordQueryInvalidation("q1")
      expect(engine.getQueryStats("q1")!.totalInvalidations).toBe(2)
    })

    it("returns top queries by subscriber count", () => {
      engine.recordQueryExecution("a", 10, ["t"], 5)
      engine.recordQueryExecution("b", 10, ["t"], 20)
      engine.recordQueryExecution("c", 10, ["t"], 10)
      const top = engine.getTopQueries(2)
      expect(top).toHaveLength(2)
      expect(top[0].queryName).toBe("b")
    })

    it("tracks slow queries", () => {
      engine.recordQueryExecution("fast", 10, ["t"])
      engine.recordQueryExecution("slow", 150, ["t"])
      const slow = engine.getSlowQueries()
      expect(slow).toHaveLength(1)
      expect(slow[0].queryName).toBe("slow")
    })

    it("stores explain plan", () => {
      engine.recordQueryExecution("q1", 10, ["t"], 0, "Seq Scan on tasks")
      expect(engine.getQueryStats("q1")!.explainPlan).toBe("Seq Scan on tasks")
    })
  })

  describe("subscription heatmap", () => {
    it("records and retrieves heatmap data", () => {
      engine.updateHeatmap("tasks", "listTasks", 10, 30)
      engine.updateHeatmap("users", "getUsers", 5, 10)
      const heatmap = engine.getHeatmap()
      expect(heatmap).toHaveLength(2)
      // listTasks has higher heat (10*0.4 + 30*0.6 = 22 vs 5*0.4 + 10*0.6 = 8)
      expect(heatmap[0].queryName).toBe("listTasks")
    })
  })

  describe("mutation replay log", () => {
    const makeMutation = (name: string, id?: string): MutationReplayEntry => ({
      id: id ?? `m-${Date.now()}-${Math.random()}`,
      mutationName: name,
      args: { test: true },
      result: { success: true },
      durationMs: 10,
      executedAt: Date.now(),
      affectedTables: ["tasks"],
      affectedRowIds: ["row-1"],
    })

    it("records mutations", () => {
      engine.recordMutation(makeMutation("createTask"))
      expect(engine.mutationLogSize).toBe(1)
    })

    it("retrieves mutations by name", () => {
      engine.recordMutation(makeMutation("createTask"))
      engine.recordMutation(makeMutation("deleteTask"))
      const results = engine.getMutationLog({ mutationName: "createTask" })
      expect(results).toHaveLength(1)
      expect(results[0].mutationName).toBe("createTask")
    })

    it("retrieves mutations by table", () => {
      const m = makeMutation("createTask")
      m.affectedTables = ["users"]
      engine.recordMutation(m)
      engine.recordMutation(makeMutation("createTask"))
      const results = engine.getMutationLog({ table: "users" })
      expect(results).toHaveLength(1)
    })

    it("gets mutation by id", () => {
      const m = makeMutation("test", "unique-id")
      engine.recordMutation(m)
      const found = engine.getMutationById("unique-id")
      expect(found).toBeDefined()
      expect(found!.mutationName).toBe("test")
    })

    it("evicts old entries when max reached", () => {
      const eng = new DashboardV2Engine({ maxMutationLog: 3 })
      eng.recordMutation(makeMutation("a"))
      eng.recordMutation(makeMutation("b"))
      eng.recordMutation(makeMutation("c"))
      eng.recordMutation(makeMutation("d"))
      expect(eng.mutationLogSize).toBe(3)
    })
  })

  describe("connection pool", () => {
    it("updates and retrieves pool stats", () => {
      engine.updateConnectionPool({ active: 5, idle: 10, waiting: 2, total: 17, maxSize: 20 })
      const pool = engine.getConnectionPool()
      expect(pool.active).toBe(5)
      expect(pool.maxSize).toBe(20)
    })
  })

  describe("aggregate metrics", () => {
    it("returns full metrics object", () => {
      engine.recordQueryExecution("q1", 20, ["tasks"], 5)
      engine.recordMutation({
        id: "m1",
        mutationName: "createTask",
        args: {},
        result: {},
        durationMs: 15,
        executedAt: Date.now(),
        affectedTables: ["tasks"],
        affectedRowIds: ["r1"],
      })
      engine.updateHeatmap("tasks", "q1", 5, 10)

      const metrics = engine.getMetrics()
      expect(metrics.overview.activeSubscriptions).toBe(5)
      expect(metrics.topQueries).toHaveLength(1)
      expect(metrics.recentMutations).toHaveLength(1)
      expect(metrics.subscriptionHeatmap).toHaveLength(1)
    })
  })

  describe("reset", () => {
    it("clears all data", () => {
      engine.recordQueryExecution("q1", 10, ["t"])
      engine.recordMutation({
        id: "m1",
        mutationName: "test",
        args: {},
        result: {},
        durationMs: 10,
        executedAt: Date.now(),
        affectedTables: [],
        affectedRowIds: [],
      })
      engine.reset()
      expect(engine.queryCount).toBe(0)
      expect(engine.mutationLogSize).toBe(0)
    })
  })
})

describe("generateDashboardV2HTML", () => {
  it("generates valid HTML with all panels", () => {
    const html = generateDashboardV2HTML()
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("Dashboard v2")
    expect(html).toContain("Query Inspector")
    expect(html).toContain("Heatmap")
    expect(html).toContain("Mutation Log")
    expect(html).toContain("Data Browser")
    expect(html).toContain("Connection Pool")
  })
})

describe("SQL builders", () => {
  it("generateDashboardV2TableSQL creates tables", () => {
    const sql = generateDashboardV2TableSQL()
    expect(sql).toContain("_reactivebase_mutation_log")
    expect(sql).toContain("_reactivebase_query_stats")
  })

  it("buildInsertMutationLogSQL generates insert", () => {
    const { sql, params } = buildInsertMutationLogSQL({
      id: "m1",
      mutationName: "test",
      args: { x: 1 },
      result: { ok: true },
      durationMs: 10,
      executedAt: Date.now(),
      affectedTables: ["t1"],
      affectedRowIds: ["r1"],
    })
    expect(sql).toContain("INSERT INTO")
    expect(params).toHaveLength(10)
  })

  it("buildQueryMutationLogSQL generates filtered query", () => {
    const { sql, params } = buildQueryMutationLogSQL({ mutationName: "test", table: "tasks" })
    expect(sql).toContain("WHERE")
    expect(params).toHaveLength(2)
  })

  it("buildUpdateQueryStatsSQL generates upsert", () => {
    const { sql, params } = buildUpdateQueryStatsSQL("q1", 15, ["tasks"])
    expect(sql).toContain("ON CONFLICT")
    expect(params).toEqual(["q1", 15, ["tasks"]])
  })

  it("buildDataBrowserQuerySQL generates select with filters", () => {
    const { sql, params } = buildDataBrowserQuerySQL({
      table: "tasks",
      filters: [
        { column: "done", operator: "=", value: false },
        { column: "title", operator: "like", value: "%bug%" },
      ],
      page: 2,
      pageSize: 20,
      sortBy: "createdAt",
      sortDirection: "desc",
    })
    expect(sql).toContain('"tasks"')
    expect(sql).toContain("ILIKE")
    expect(sql).toContain("LIMIT $3")
    expect(sql).toContain("OFFSET $4")
    expect(params).toHaveLength(4)
    expect(params[2]).toBe(20)
    expect(params[3]).toBe(20)
  })

  it("buildDataBrowserQuerySQL handles is_null operator", () => {
    const { sql, params } = buildDataBrowserQuerySQL({
      table: "tasks",
      filters: [{ column: "assignee", operator: "is_null" }],
    })
    expect(sql).toContain("IS NULL")
    expect(params).toHaveLength(2)
  })
})
