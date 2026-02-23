import { describe, it, expect, beforeEach } from "vitest"
import {
  MaterializedViewEngine,
  defineMaterializedView,
  generateMaterializedViewSQL,
  generateRefreshSQL,
  generateDropViewSQL,
  generateViewIndexSQL,
  generateUniqueIndexSQL,
  generateTimeBucketSQL,
} from "../materialized-views/materialized-views.js"

describe("defineMaterializedView", () => {
  it("creates a valid view definition", () => {
    const view = defineMaterializedView({
      name: "task_stats",
      source: "tasks",
      groupBy: ["team_id"],
      aggregations: {
        total: { fn: "count", field: "*" },
        completed: { fn: "count", field: "*", filter: { done: true } },
      },
      refreshStrategy: "on-mutation",
    })
    expect(view.name).toBe("task_stats")
    expect(view.source).toBe("tasks")
  })

  it("throws on missing name", () => {
    expect(() => defineMaterializedView({ name: "", source: "t", refreshStrategy: "manual" })).toThrow()
  })

  it("throws on missing source and sql", () => {
    expect(() => defineMaterializedView({ name: "v", source: "", refreshStrategy: "manual" })).toThrow()
  })
})

describe("SQL generation", () => {
  it("generates materialized view SQL with aggregations", () => {
    const sql = generateMaterializedViewSQL({
      name: "task_stats",
      source: "tasks",
      groupBy: ["team_id"],
      aggregations: {
        total: { fn: "count", field: "*" },
        avg_priority: { fn: "avg", field: "priority_num" },
      },
      refreshStrategy: "on-mutation",
    })

    expect(sql).toContain('CREATE MATERIALIZED VIEW IF NOT EXISTS "task_stats"')
    expect(sql).toContain('"team_id"')
    expect(sql).toContain('COUNT(*) AS "total"')
    expect(sql).toContain('AVG("priority_num") AS "avg_priority"')
    expect(sql).toContain("GROUP BY")
  })

  it("generates view SQL with raw SQL", () => {
    const sql = generateMaterializedViewSQL({
      name: "custom_view",
      source: "tasks",
      sql: "SELECT team_id, count(*) FROM tasks GROUP BY team_id",
      refreshStrategy: "manual",
    })

    expect(sql).toContain("custom_view")
    expect(sql).toContain("SELECT team_id, count(*)")
  })

  it("generates conditional count with filter", () => {
    const sql = generateMaterializedViewSQL({
      name: "filtered",
      source: "tasks",
      aggregations: {
        done_count: { fn: "count", field: "*", filter: { done: true } },
      },
      refreshStrategy: "on-mutation",
    })

    expect(sql).toContain("FILTER (WHERE")
    expect(sql).toContain('"done" = true')
  })

  it("generates refresh SQL", () => {
    expect(generateRefreshSQL("task_stats")).toContain('REFRESH MATERIALIZED VIEW "task_stats"')
    expect(generateRefreshSQL("task_stats", true)).toContain("CONCURRENTLY")
  })

  it("generates drop SQL", () => {
    expect(generateDropViewSQL("task_stats")).toContain('DROP MATERIALIZED VIEW IF EXISTS "task_stats"')
  })

  it("generates index SQL", () => {
    const sql = generateViewIndexSQL("task_stats", ["team_id"])
    expect(sql).toContain("CREATE INDEX")
    expect(sql).toContain('"team_id"')
  })

  it("generates unique index SQL", () => {
    const sql = generateUniqueIndexSQL("task_stats", ["team_id"])
    expect(sql).toContain("CREATE UNIQUE INDEX")
  })

  it("generates time-bucketed rollup SQL", () => {
    const sql = generateTimeBucketSQL(
      "hourly_tasks",
      "tasks",
      { interval: "hour", field: "created_at" },
      { count: { fn: "count", field: "*" } },
    )

    expect(sql).toContain("date_trunc('hour'")
    expect(sql).toContain("time_bucket")
    expect(sql).toContain("GROUP BY")
  })
})

describe("MaterializedViewEngine", () => {
  let engine: MaterializedViewEngine

  beforeEach(() => {
    engine = new MaterializedViewEngine()
  })

  it("registers views", () => {
    engine.register(
      defineMaterializedView({
        name: "stats",
        source: "tasks",
        aggregations: { total: { fn: "count", field: "*" } },
        refreshStrategy: "on-mutation",
      }),
    )

    expect(engine.viewCount).toBe(1)
    expect(engine.getDefinition("stats")).toBeDefined()
  })

  it("lists all views", () => {
    engine.register(defineMaterializedView({ name: "v1", source: "tasks", refreshStrategy: "manual" }))
    engine.register(defineMaterializedView({ name: "v2", source: "users", refreshStrategy: "manual" }))

    expect(engine.listViews()).toHaveLength(2)
  })

  it("triggers refresh on mutation notification", () => {
    let refreshed = false
    engine.register(
      defineMaterializedView({
        name: "stats",
        source: "tasks",
        refreshStrategy: "on-mutation",
        refreshDebounceMs: 0,
      }),
    )

    engine.subscribe("stats", () => {
      refreshed = true
    })
    engine.notifyMutation("tasks")

    // Debounced, wait for next tick
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(refreshed).toBe(true)
        resolve()
      }, 50)
    })
  })

  it("does not trigger for unrelated mutations", () => {
    let refreshed = false
    engine.register(
      defineMaterializedView({
        name: "stats",
        source: "tasks",
        refreshStrategy: "on-mutation",
      }),
    )

    engine.subscribe("stats", () => {
      refreshed = true
    })
    engine.notifyMutation("users") // Different table

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(refreshed).toBe(false)
        resolve()
      }, 200)
    })
  })

  it("updates view data", () => {
    engine.register(defineMaterializedView({ name: "v1", source: "tasks", refreshStrategy: "manual" }))

    const updates: unknown[] = []
    engine.subscribe("v1", (data) => updates.push(data))

    engine.updateData("v1", [{ team_id: "t1", count: 5 }])

    expect(updates).toHaveLength(1)
    expect(engine.getState("v1")?.data).toHaveLength(1)
  })

  it("generates SQL for all views", () => {
    engine.register(
      defineMaterializedView({
        name: "v1",
        source: "tasks",
        refreshStrategy: "manual",
        aggregations: { total: { fn: "count", field: "*" } },
      }),
    )
    engine.register(
      defineMaterializedView({
        name: "v2",
        source: "users",
        refreshStrategy: "manual",
        aggregations: { total: { fn: "count", field: "*" } },
      }),
    )

    const sql = engine.generateAllSQL()
    expect(sql).toContain('"v1"')
    expect(sql).toContain('"v2"')
  })

  it("cleans up on stop", () => {
    engine.register(defineMaterializedView({ name: "v1", source: "tasks", refreshStrategy: "on-mutation" }))
    engine.stop()
    // Should not throw
    expect(engine.viewCount).toBe(1)
  })
})
