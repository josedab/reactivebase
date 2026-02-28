import { describe, it, expect, beforeEach } from "vitest"
import {
  ComputedTableEngine,
  ComputedTableError,
  buildCreateComputedTableSQL,
  buildRefreshComputedTableSQL,
  buildDropComputedTableSQL,
  buildCreateTriggerSQL,
  buildCreateMetadataTableSQL,
  defineComputedAggregation,
  defineComputedJoin,
} from "../computed-tables/computed-tables.js"

describe("ComputedTableEngine", () => {
  let engine: ComputedTableEngine

  beforeEach(() => {
    engine = new ComputedTableEngine()
  })

  it("defines a computed table", () => {
    engine.define({
      name: "order_stats",
      sourceTables: ["orders"],
      query: "SELECT customer_id, COUNT(*) as total FROM orders GROUP BY customer_id",
      refreshStrategy: "incremental",
      primaryKey: ["customer_id"],
    })
    expect(engine.getDefinition("order_stats")).toBeDefined()
    expect(engine.getState("order_stats")?.status).toBe("pending")
  })

  it("rejects empty name", () => {
    expect(() =>
      engine.define({ name: "", sourceTables: ["a"], query: "SELECT 1", refreshStrategy: "full" }),
    ).toThrow("name is required")
  })

  it("rejects empty source tables", () => {
    expect(() =>
      engine.define({ name: "test", sourceTables: [], query: "SELECT 1", refreshStrategy: "full" }),
    ).toThrow("at least one source table")
  })

  it("rejects empty query", () => {
    expect(() =>
      engine.define({ name: "test", sourceTables: ["a"], query: "", refreshStrategy: "full" }),
    ).toThrow("requires a query")
  })

  it("generates SQL for a computed table", () => {
    engine.define({
      name: "stats",
      sourceTables: ["orders"],
      query: "SELECT customer_id, SUM(amount) FROM orders GROUP BY customer_id",
      refreshStrategy: "incremental",
      primaryKey: ["customer_id"],
      indexes: [{ columns: ["customer_id"] }],
    })
    const sql = engine.generateSQL("stats")
    expect(sql).toContain("CREATE TABLE")
    expect(sql).toContain("stats")
    expect(sql).toContain("CREATE TRIGGER")
  })

  it("builds dependency graph", () => {
    engine.define({
      name: "base_stats",
      sourceTables: ["orders"],
      query: "SELECT 1",
      refreshStrategy: "full",
    })
    engine.define({
      name: "derived_stats",
      sourceTables: ["base_stats"],
      query: "SELECT 1",
      refreshStrategy: "full",
    })
    const graph = engine.buildDependencyGraph()
    expect(graph.order.length).toBe(2)
    expect(graph.cycles).toHaveLength(0)
  })

  it("detects affected tables on source change", () => {
    engine.define({
      name: "order_count",
      sourceTables: ["orders"],
      query: "SELECT COUNT(*) FROM orders",
      refreshStrategy: "full",
    })
    engine.define({
      name: "derived",
      sourceTables: ["order_count"],
      query: "SELECT * FROM order_count",
      refreshStrategy: "full",
    })
    const affected = engine.getAffectedTables("orders")
    expect(affected).toContain("order_count")
    expect(affected).toContain("derived")
  })

  it("records refresh results", () => {
    engine.define({
      name: "test",
      sourceTables: ["src"],
      query: "SELECT 1",
      refreshStrategy: "full",
    })
    const result = engine.recordRefresh("test", 100, 50, "src")
    expect(result.rowsAffected).toBe(100)
    expect(engine.getState("test")?.status).toBe("ready")
    expect(engine.getState("test")?.refreshCount).toBe(1)
  })

  it("records errors", () => {
    engine.define({
      name: "test",
      sourceTables: ["src"],
      query: "SELECT 1",
      refreshStrategy: "full",
    })
    engine.recordError("test", "refresh failed")
    expect(engine.getState("test")?.status).toBe("error")
    expect(engine.getState("test")?.errorMessage).toBe("refresh failed")
  })

  it("generates all SQL in dependency order", () => {
    engine.define({ name: "a", sourceTables: ["raw"], query: "SELECT 1", refreshStrategy: "full" })
    engine.define({ name: "b", sourceTables: ["a"], query: "SELECT 1", refreshStrategy: "full" })
    const sql = engine.generateAllSQL()
    expect(sql).toContain("_reactivebase_computed_tables")
    const aIdx = sql.indexOf("Computed Table: a")
    const bIdx = sql.indexOf("Computed Table: b")
    expect(aIdx).toBeLessThan(bIdx)
  })

  it("provides stats", () => {
    engine.define({ name: "t1", sourceTables: ["s"], query: "SELECT 1", refreshStrategy: "full" })
    engine.define({ name: "t2", sourceTables: ["s"], query: "SELECT 1", refreshStrategy: "incremental" })
    const stats = engine.getStats()
    expect(stats.totalTables).toBe(2)
    expect(stats.byStrategy.full).toBe(1)
    expect(stats.byStrategy.incremental).toBe(1)
  })

  it("undefines a computed table", () => {
    engine.define({ name: "t1", sourceTables: ["s"], query: "SELECT 1", refreshStrategy: "full" })
    engine.undefine("t1")
    expect(engine.getDefinition("t1")).toBeUndefined()
  })
})

describe("SQL builders", () => {
  it("builds create SQL with indexes", () => {
    const sql = buildCreateComputedTableSQL({
      name: "test",
      sourceTables: ["src"],
      query: "SELECT id, name FROM src",
      refreshStrategy: "full",
      primaryKey: ["id"],
      indexes: [{ columns: ["name"], unique: true }],
    })
    expect(sql).toContain("CREATE TABLE")
    expect(sql).toContain("PRIMARY KEY")
    expect(sql).toContain("UNIQUE INDEX")
  })

  it("builds full refresh SQL", () => {
    const sql = buildRefreshComputedTableSQL({
      name: "test",
      sourceTables: ["src"],
      query: "SELECT 1",
      refreshStrategy: "full",
    })
    expect(sql).toContain("TRUNCATE")
    expect(sql).toContain("INSERT")
  })

  it("builds incremental refresh SQL with PK", () => {
    const sql = buildRefreshComputedTableSQL({
      name: "test",
      sourceTables: ["src"],
      query: "SELECT id, val FROM src",
      refreshStrategy: "incremental",
      primaryKey: ["id"],
    })
    expect(sql).toContain("MERGE")
  })

  it("builds drop SQL", () => {
    expect(buildDropComputedTableSQL("test")).toContain("DROP TABLE")
  })

  it("builds trigger SQL", () => {
    const sql = buildCreateTriggerSQL("computed", "source")
    expect(sql).toContain("CREATE TRIGGER")
    expect(sql).toContain("pg_notify")
  })

  it("builds metadata table SQL", () => {
    expect(buildCreateMetadataTableSQL()).toContain("_reactivebase_computed_tables")
  })
})

describe("Helper functions", () => {
  it("defineComputedAggregation", () => {
    const def = defineComputedAggregation({
      name: "user_order_stats",
      sourceTable: "orders",
      groupBy: ["user_id"],
      aggregations: { total: "COUNT(*)", total_amount: "SUM(amount)" },
    })
    expect(def.name).toBe("user_order_stats")
    expect(def.query).toContain("COUNT(*)");
    expect(def.query).toContain("SUM(amount)")
    expect(def.refreshStrategy).toBe("incremental")
  })

  it("defineComputedJoin", () => {
    const def = defineComputedJoin({
      name: "order_details",
      sourceTables: ["orders", "users"],
      joinSQL: 'orders JOIN users ON orders.user_id = users.id',
      selectColumns: ["orders.id", "users.name"],
    })
    expect(def.name).toBe("order_details")
    expect(def.sourceTables).toEqual(["orders", "users"])
  })
})
