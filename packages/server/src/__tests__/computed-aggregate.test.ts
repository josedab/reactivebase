import { describe, it, expect } from "vitest"
import { v } from "../schema/validators.js"
import { generateCreateTableSQL } from "../schema/migrations.js"
import { defineSchema } from "../schema/schema.js"
import { AggregateQueryBuilder } from "../query-builder/query-builder.js"

describe("v.computed()", () => {
  it("creates a computed validator with SQL expression", () => {
    const col = v.computed({
      sql: '"first_name" || \' \' || "last_name"',
      returning: v.string(),
    })
    expect(col.type).toBe("computed")
    expect(col.computeSql).toBe('"first_name" || \' \' || "last_name"')
    expect(col.pgType).toBe("text")
  })

  it("accepts an optional derivation function", () => {
    const fn = (row: Record<string, unknown>) => `${row.first} ${row.last}`
    const col = v.computed({
      sql: '"first_name" || \' \' || "last_name"',
      returning: v.string(),
      fn,
    })
    expect(col.computeFn).toBe(fn)
  })

  it("tracks cross-table dependencies", () => {
    const col = v.computed({
      sql: "(SELECT COUNT(*) FROM orders WHERE orders.user_id = users.id)",
      returning: v.integer(),
      dependsOn: ["orders"],
    })
    expect(col.dependsOnTables).toEqual(["orders"])
  })

  it("rejects empty SQL expression", () => {
    expect(() => v.computed({ sql: "", returning: v.string() })).toThrow("non-empty SQL expression")
  })

  it("rejects dangerous DDL/DML in SQL expression", () => {
    expect(() => v.computed({ sql: "DROP TABLE users", returning: v.string() })).toThrow("must not contain DDL/DML")

    expect(() => v.computed({ sql: "DELETE FROM users", returning: v.string() })).toThrow("must not contain DDL/DML")
  })
})

describe("v.virtual()", () => {
  it("creates a virtual validator with derivation function", () => {
    const fn = (row: Record<string, unknown>) => `${row.first} ${row.last}`
    const col = v.virtual({ fn, returning: v.string() })
    expect(col.type).toBe("virtual")
    expect(col.computeFn).toBe(fn)
    expect(col.pgType).toBe("text")
  })

  it("tracks cross-table dependencies", () => {
    const col = v.virtual({
      fn: (row) => row.count as number,
      returning: v.integer(),
      dependsOn: ["orders", "products"],
    })
    expect(col.dependsOnTables).toEqual(["orders", "products"])
  })

  it("rejects missing derivation function", () => {
    expect(() =>
      v.virtual({ fn: undefined as unknown as (row: Record<string, unknown>) => string, returning: v.string() }),
    ).toThrow("derivation function")
  })
})

describe("computed columns in migrations", () => {
  it("generates GENERATED ALWAYS AS for computed columns", () => {
    const sql = generateCreateTableSQL("users", {
      firstName: v.string(),
      lastName: v.string(),
      fullName: v.computed({
        sql: '"firstName" || \' \' || "lastName"',
        returning: v.string(),
      }),
    })
    expect(sql).toContain("GENERATED ALWAYS AS")
    expect(sql).toContain('"firstName" || \' \' || "lastName"')
    expect(sql).toContain("STORED")
  })

  it("excludes virtual columns from CREATE TABLE", () => {
    const sql = generateCreateTableSQL("users", {
      firstName: v.string(),
      displayName: v.virtual({
        fn: (row) => (row.firstName as string).toUpperCase(),
        returning: v.string(),
      }),
    })
    expect(sql).toContain("firstName")
    expect(sql).not.toContain("displayName")
  })
})

describe("schema validation with computed/virtual", () => {
  it("accepts computed and virtual columns in schema", () => {
    const schema = defineSchema({
      users: {
        name: "users",
        columns: {
          firstName: v.string(),
          lastName: v.string(),
          fullName: v.computed({
            sql: '"firstName" || \' \' || "lastName"',
            returning: v.string(),
          }),
          displayName: v.virtual({
            fn: (row) => `${row.firstName}`,
            returning: v.string(),
          }),
        },
        indexes: [],
        relations: [],
        index: (() => {}) as never,
        vectorIndex: (() => {}) as never,
        relation: (() => {}) as never,
      },
    })
    expect(schema.tableNames).toContain("users")
  })
})

describe("AggregateQueryBuilder", () => {
  it("builds a simple count query", () => {
    const agg = new AggregateQueryBuilder("tasks")
    const result = agg.count().build()
    expect(result.sql).toContain("COUNT(*)")
    expect(result.params).toEqual([])
  })

  it("builds a grouped aggregate query", () => {
    const agg = new AggregateQueryBuilder("tasks")
    const result = agg.count("*", "task_count").groupBy("status").build()
    expect(result.sql).toContain('"status"')
    expect(result.sql).toContain('COUNT(*) AS "task_count"')
    expect(result.sql).toContain("GROUP BY")
  })

  it("supports sum, avg, min, max", () => {
    const agg = new AggregateQueryBuilder("orders")
    const result = agg
      .sum("total", "revenue")
      .avg("total", "avg_order")
      .min("total", "min_order")
      .max("total", "max_order")
      .build()
    expect(result.sql).toContain('SUM("total") AS "revenue"')
    expect(result.sql).toContain('AVG("total") AS "avg_order"')
    expect(result.sql).toContain('MIN("total") AS "min_order"')
    expect(result.sql).toContain('MAX("total") AS "max_order"')
  })

  it("supports countDistinct", () => {
    const agg = new AggregateQueryBuilder("orders")
    const result = agg.countDistinct("userId", "unique_users").build()
    expect(result.sql).toContain('COUNT(DISTINCT "userId") AS "unique_users"')
  })

  it("supports WHERE clause before aggregation", () => {
    const agg = new AggregateQueryBuilder("tasks")
    const result = agg.count().where({ status: "active" }).build()
    expect(result.sql).toContain('WHERE "status" = $1')
    expect(result.params).toEqual(["active"])
  })

  it("supports HAVING clause", () => {
    const agg = new AggregateQueryBuilder("tasks")
    const result = agg.count("*", "cnt").groupBy("assignee").having("count", "*", ">", 5).build()
    expect(result.sql).toContain("HAVING COUNT(*) > $1")
    expect(result.params).toEqual([5])
  })

  it("supports JOIN", () => {
    const agg = new AggregateQueryBuilder("tasks")
    const result = agg.count().join("users", "assigneeId", "id", "LEFT").build()
    expect(result.sql).toContain('LEFT JOIN "users"')
  })

  it("throws if no aggregation is defined", () => {
    const agg = new AggregateQueryBuilder("tasks")
    expect(() => agg.build()).toThrow("At least one aggregation")
  })

  it("tracks dependencies for reactivity", () => {
    const agg = new AggregateQueryBuilder("tasks")
    agg.count().join("users", "assigneeId")
    const deps = agg.getDependencies()
    expect(deps).toHaveLength(2)
    expect(deps[0].table).toBe("tasks")
    expect(deps[1].table).toBe("users")
  })
})
