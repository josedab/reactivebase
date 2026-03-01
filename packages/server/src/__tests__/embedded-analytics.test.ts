import { describe, it, expect } from "vitest"
import {
  EmbeddedAnalyticsQueryEngine,
  AnalyticsQueryError as _AnalyticsQueryError,
} from "../analytics/embedded-analytics-query.js"

describe("EmbeddedAnalyticsQueryEngine", () => {
  const engine = new EmbeddedAnalyticsQueryEngine()

  describe("timeSeries", () => {
    it("generates basic time series query", () => {
      const result = engine.timeSeries({
        table: "events",
        timeColumn: "created_at",
        bucket: "day",
        metric: { fn: "count" },
      })
      expect(result.sql).toContain("date_trunc('day'")
      expect(result.sql).toContain("COUNT(*)")
      expect(result.sql).toContain("ORDER BY")
      expect(result.description).toContain("Time series")
    })

    it("supports sum metric with column", () => {
      const result = engine.timeSeries({
        table: "orders",
        timeColumn: "ordered_at",
        bucket: "month",
        metric: { fn: "sum", column: "amount", alias: "total" },
      })
      expect(result.sql).toContain('SUM("amount")')
      expect(result.sql).toContain('"total"')
    })

    it("supports filters", () => {
      const result = engine.timeSeries({
        table: "events",
        timeColumn: "created_at",
        bucket: "hour",
        metric: { fn: "count" },
        filters: [{ column: "type", operator: "=", value: "click" }],
      })
      expect(result.sql).toContain("WHERE")
      expect(result.params).toContain("click")
    })

    it("supports time range with last", () => {
      const result = engine.timeSeries({
        table: "events",
        timeColumn: "created_at",
        bucket: "day",
        metric: { fn: "count" },
        timeRange: { last: "7d" },
      })
      expect(result.sql).toContain("7 days")
    })

    it("supports groupBy", () => {
      const result = engine.timeSeries({
        table: "events",
        timeColumn: "created_at",
        bucket: "day",
        metric: { fn: "count" },
        groupBy: ["category"],
      })
      expect(result.sql).toContain('"category"')
    })

    it("supports all bucket types", () => {
      for (const bucket of ["minute", "hour", "day", "week", "month", "quarter", "year"] as const) {
        const result = engine.timeSeries({
          table: "events",
          timeColumn: "ts",
          bucket,
          metric: { fn: "count" },
        })
        expect(result.sql).toContain(`date_trunc('${bucket}'`)
      }
    })

    it("supports all metric functions", () => {
      for (const fn of ["count", "sum", "avg", "min", "max", "count_distinct"] as const) {
        const result = engine.timeSeries({
          table: "t",
          timeColumn: "ts",
          bucket: "day",
          metric: { fn, column: "val" },
        })
        expect(result.sql.length).toBeGreaterThan(0)
      }
    })

    it("validates table name", () => {
      expect(() => engine.timeSeries({ table: "", timeColumn: "ts", bucket: "day", metric: { fn: "count" } })).toThrow(
        "Table name is required",
      )
    })
  })

  describe("funnel", () => {
    it("generates funnel query", () => {
      const result = engine.funnel({
        table: "events",
        eventColumn: "type",
        userColumn: "user_id",
        timeColumn: "created_at",
        steps: [
          { name: "Visit", filter: { column: "type", operator: "=", value: "page_view" } },
          { name: "Signup", filter: { column: "type", operator: "=", value: "signup" } },
          { name: "Purchase", filter: { column: "type", operator: "=", value: "purchase" } },
        ],
      })
      expect(result.sql).toContain("step_0")
      expect(result.sql).toContain("step_1")
      expect(result.sql).toContain("step_2")
      expect(result.sql).toContain("INNER JOIN")
      expect(result.description).toContain("Visit → Signup → Purchase")
    })

    it("rejects fewer than 2 steps", () => {
      expect(() =>
        engine.funnel({
          table: "events",
          eventColumn: "type",
          userColumn: "user_id",
          timeColumn: "created_at",
          steps: [{ name: "Only", filter: { column: "type", operator: "=", value: "x" } }],
        }),
      ).toThrow("at least 2 steps")
    })
  })

  describe("retention", () => {
    it("generates retention query", () => {
      const result = engine.retention({
        table: "events",
        userColumn: "user_id",
        timeColumn: "created_at",
        cohortBucket: "week",
        retentionPeriods: 4,
      })
      expect(result.sql).toContain("cohorts")
      expect(result.sql).toContain("period_1")
      expect(result.sql).toContain("period_4")
      expect(result.description).toContain("4 week periods")
    })
  })

  describe("topN", () => {
    it("generates top-N query", () => {
      const result = engine.topN({
        table: "products",
        rankColumn: "category",
        metric: { fn: "sum", column: "revenue" },
        n: 10,
      })
      expect(result.sql).toContain("RANK()")
      expect(result.sql).toContain("LIMIT")
      expect(result.params).toContain(10)
      expect(result.description).toContain("Top 10")
    })

    it("supports filters", () => {
      const result = engine.topN({
        table: "products",
        rankColumn: "name",
        metric: { fn: "count" },
        n: 5,
        filters: [{ column: "active", operator: "=", value: true }],
      })
      expect(result.sql).toContain("WHERE")
    })
  })

  describe("comparison", () => {
    it("generates period-over-period comparison", () => {
      const result = engine.comparison({
        table: "orders",
        timeColumn: "created_at",
        metric: { fn: "sum", column: "amount" },
        currentRange: { last: "7d" },
        previousRange: { last: "14d" },
      })
      expect(result.sql).toContain("current_period")
      expect(result.sql).toContain("previous_period")
      expect(result.sql).toContain("change_pct")
    })
  })

  describe("filter operators", () => {
    it("handles all operators", () => {
      for (const op of ["=", "!=", ">", "<", ">=", "<=", "like"] as const) {
        const result = engine.timeSeries({
          table: "t",
          timeColumn: "ts",
          bucket: "day",
          metric: { fn: "count" },
          filters: [{ column: "col", operator: op, value: "x" }],
        })
        expect(result.params.length).toBeGreaterThan(0)
      }
    })

    it("handles null checks", () => {
      const result = engine.timeSeries({
        table: "t",
        timeColumn: "ts",
        bucket: "day",
        metric: { fn: "count" },
        filters: [{ column: "col", operator: "is_null" }],
      })
      expect(result.sql).toContain("IS NULL")
    })
  })
})
