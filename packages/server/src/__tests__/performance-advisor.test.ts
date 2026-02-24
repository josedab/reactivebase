import { describe, it, expect, beforeEach } from "vitest"
import {
  PerformanceAdvisor,
  buildUnusedIndexesSQL,
  buildTableSeqScanSQL,
  buildIndexSuggestionsSQL,
  type QueryRecord,
  type InvalidationRecord,
} from "../metrics/performance-advisor.js"

describe("Performance Advisor SQL Helpers", () => {
  it("builds unused indexes query", () => {
    const { sql } = buildUnusedIndexesSQL()
    expect(sql).toContain("pg_stat_user_indexes")
    expect(sql).toContain("idx_scan = 0")
    expect(sql).toContain("NOT LIKE '%_pkey'")
  })

  it("builds table seq scan query", () => {
    const { sql } = buildTableSeqScanSQL()
    expect(sql).toContain("pg_stat_user_tables")
    expect(sql).toContain("seq_scan > idx_scan")
    expect(sql).toContain("n_live_tup > 100")
  })

  it("builds index suggestion query with parameterized table", () => {
    const { sql, params } = buildIndexSuggestionsSQL("users")
    expect(sql).toContain("pg_stats")
    expect(sql).toContain("tablename = $1")
    expect(params).toEqual(["users"])
  })
})

describe("PerformanceAdvisor", () => {
  let advisor: PerformanceAdvisor

  beforeEach(() => {
    advisor = new PerformanceAdvisor({
      analysisWindowMs: 60_000,
      slowQueryThresholdMs: 50,
      nPlusOneThreshold: 3,
      hotSubscriptionThreshold: 5,
    })
  })

  it("produces empty report with no data", () => {
    const report = advisor.analyze()
    expect(report.recommendations).toHaveLength(0)
    expect(report.stats.totalQueries).toBe(0)
    expect(report.stats.totalInvalidations).toBe(0)
  })

  it("detects slow queries", () => {
    const now = Date.now()
    for (let i = 0; i < 5; i++) {
      advisor.recordQuery({
        name: "tasks.heavyQuery",
        durationMs: 200,
        tables: ["tasks"],
        timestamp: now - i * 100,
      })
    }

    const report = advisor.analyze()
    const slowRecs = report.recommendations.filter((r) => r.type === "slow_query")
    expect(slowRecs.length).toBeGreaterThan(0)
    expect(slowRecs[0].queryName).toBe("tasks.heavyQuery")
    expect(slowRecs[0].evidence).toHaveProperty("avgMs")
  })

  it("detects N+1 query patterns", () => {
    const now = Date.now()
    // Simulate N+1: same query repeated many times within tight window
    for (let i = 0; i < 10; i++) {
      advisor.recordQuery({
        name: "users.getById",
        durationMs: 5,
        tables: ["users"],
        timestamp: now + i, // Within 100ms window
      })
    }

    const report = advisor.analyze()
    const nPlusOneRecs = report.recommendations.filter((r) => r.type === "n_plus_one")
    expect(nPlusOneRecs.length).toBeGreaterThan(0)
    expect(nPlusOneRecs[0].queryName).toBe("users.getById")
  })

  it("detects hot subscriptions", () => {
    const now = Date.now()
    // Simulate high invalidation rate
    for (let i = 0; i < 600; i++) {
      advisor.recordInvalidation({
        table: "messages",
        subscriptionCount: 50,
        timestamp: now - i * 100,
      })
    }

    const report = advisor.analyze()
    const hotRecs = report.recommendations.filter((r) => r.type === "hot_subscription")
    expect(hotRecs.length).toBeGreaterThan(0)
    expect(hotRecs[0].table).toBe("messages")
  })

  it("detects over-fetching", () => {
    const now = Date.now()
    for (let i = 0; i < 10; i++) {
      advisor.recordQuery({
        name: "users.getProfile",
        durationMs: 10,
        tables: ["users"],
        columnCount: 20,
        usedColumns: 3,
        timestamp: now - i * 100,
      })
    }

    const report = advisor.analyze()
    const overFetchRecs = report.recommendations.filter((r) => r.type === "over_fetching")
    expect(overFetchRecs.length).toBeGreaterThan(0)
    expect(overFetchRecs[0].queryName).toBe("users.getProfile")
  })

  it("detects unused indexes", () => {
    advisor.recordIndexUsage([
      { table: "users", indexName: "idx_users_legacy", scans: 0, lastUsed: null },
      { table: "users", indexName: "idx_users_email", scans: 1000, lastUsed: Date.now() },
    ])

    const report = advisor.analyze()
    const unusedRecs = report.recommendations.filter((r) => r.type === "unused_index")
    expect(unusedRecs.length).toBe(1)
    expect(unusedRecs[0].title).toContain("idx_users_legacy")
    expect(unusedRecs[0].suggestion).toContain("DROP INDEX")
  })

  it("detects missing indexes from repeated slow queries", () => {
    const now = Date.now()
    for (let i = 0; i < 10; i++) {
      advisor.recordQuery({
        name: `q${i % 3}`,
        durationMs: 100,
        tables: ["orders"],
        timestamp: now - i * 100,
      })
    }

    const report = advisor.analyze()
    const missingRecs = report.recommendations.filter((r) => r.type === "missing_index")
    expect(missingRecs.length).toBeGreaterThan(0)
    expect(missingRecs[0].table).toBe("orders")
  })

  it("sorts recommendations by severity", () => {
    const now = Date.now()
    // Create a mix: slow query (warning) + N+1 (could be critical)
    for (let i = 0; i < 5; i++) {
      advisor.recordQuery({
        name: "slow.query",
        durationMs: 200,
        tables: ["tasks"],
        timestamp: now - i * 100,
      })
    }
    advisor.recordIndexUsage([{ table: "tasks", indexName: "idx_unused", scans: 0, lastUsed: null }])

    const report = advisor.analyze()
    if (report.recommendations.length >= 2) {
      const severityOrder = { critical: 0, warning: 1, info: 2 }
      for (let i = 1; i < report.recommendations.length; i++) {
        expect(severityOrder[report.recommendations[i - 1].severity]).toBeLessThanOrEqual(
          severityOrder[report.recommendations[i].severity],
        )
      }
    }
  })

  it("formats a readable report", () => {
    advisor.recordQuery({
      name: "test",
      durationMs: 100,
      tables: ["tasks"],
      timestamp: Date.now(),
    })

    const report = advisor.analyze()
    const formatted = advisor.formatReport(report)
    expect(formatted).toContain("Performance Advisor Report")
    expect(formatted).toContain("Analyzed:")
  })

  it("resets all recorded data", () => {
    advisor.recordQuery({ name: "test", durationMs: 10, tables: ["tasks"] })
    advisor.recordInvalidation({ table: "tasks", subscriptionCount: 5 })
    advisor.reset()

    const report = advisor.analyze()
    expect(report.stats.totalQueries).toBe(0)
    expect(report.stats.totalInvalidations).toBe(0)
  })

  it("ignores data outside the analysis window", () => {
    const oldTime = Date.now() - 120_000 // 2 minutes ago, window is 1 minute
    advisor.recordQuery({
      name: "old.query",
      durationMs: 500,
      tables: ["tasks"],
      timestamp: oldTime,
    })

    const report = advisor.analyze()
    expect(report.stats.totalQueries).toBe(0)
  })
})
