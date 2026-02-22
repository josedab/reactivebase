import { describe, it, expect, beforeEach } from "vitest"
import {
  RowLevelTracker,
  BloomFilter,
  generateRowTrackingTableSQL,
  buildUpsertRowTrackingSQL,
  buildDeleteRowTrackingSQL,
  buildGetAffectedSubscriptionsSQL,
} from "../reactivity/row-level-tracker.js"

describe("BloomFilter", () => {
  it("reports inserted items as present", () => {
    const bloom = new BloomFilter(100)
    bloom.add("item-1")
    bloom.add("item-2")
    expect(bloom.has("item-1")).toBe(true)
    expect(bloom.has("item-2")).toBe(true)
  })

  it("reports non-inserted items as absent (mostly)", () => {
    const bloom = new BloomFilter(1000, 0.001)
    for (let i = 0; i < 100; i++) bloom.add(`item-${i}`)
    // Test 100 non-inserted items — expect very few false positives
    let falsePositives = 0
    for (let i = 100; i < 200; i++) {
      if (bloom.has(`item-${i}`)) falsePositives++
    }
    expect(falsePositives).toBeLessThan(5)
  })

  it("tracks insert count", () => {
    const bloom = new BloomFilter(100)
    bloom.add("a")
    bloom.add("b")
    expect(bloom.count).toBe(2)
  })

  it("reports memory usage", () => {
    const bloom = new BloomFilter(1000)
    expect(bloom.memoryBytes).toBeGreaterThan(0)
  })
})

describe("RowLevelTracker", () => {
  let tracker: RowLevelTracker

  beforeEach(() => {
    tracker = new RowLevelTracker({ maxRowsPerSubscription: 100 })
  })

  describe("tracking", () => {
    it("tracks row IDs for a subscription", () => {
      const state = tracker.trackResult("sub-1", "tasks", ["r1", "r2", "r3"])
      expect(state.mode).toBe("exact")
      expect(state.rowCount).toBe(3)
      expect(tracker.subscriptionCount).toBe(1)
    })

    it("uses bloom filter for large row sets", () => {
      const rows = Array.from({ length: 60 }, (_, i) => `row-${i}`)
      const state = tracker.trackResult("sub-1", "tasks", rows)
      expect(state.mode).toBe("bloom")
    })

    it("falls back for very large row sets", () => {
      const fallbacks: string[] = []
      const t = new RowLevelTracker({
        maxRowsPerSubscription: 100,
        onFallback: (id) => fallbacks.push(id),
      })
      const rows = Array.from({ length: 150 }, (_, i) => `row-${i}`)
      const state = t.trackResult("sub-1", "tasks", rows)
      expect(state.mode).toBe("fallback")
      expect(fallbacks).toContain("sub-1")
    })

    it("tracks multiple tables per subscription", () => {
      tracker.trackResult("sub-1", "tasks", ["r1"])
      tracker.trackResult("sub-1", "users", ["u1"])
      const state = tracker.getTrackingState("sub-1")
      expect(state?.size).toBe(2)
    })
  })

  describe("invalidation checks", () => {
    it("invalidates when tracked row changes (exact)", () => {
      tracker.trackResult("sub-1", "tasks", ["r1", "r2", "r3"])
      const result = tracker.checkInvalidation("sub-1", "tasks", ["r2"], "update")
      expect(result.shouldInvalidate).toBe(true)
      expect(result.reason).toBe("row-match")
      expect(result.matchedRows).toContain("r2")
    })

    it("does not invalidate when untracked row changes", () => {
      tracker.trackResult("sub-1", "tasks", ["r1", "r2"])
      const result = tracker.checkInvalidation("sub-1", "tasks", ["r99"], "update")
      expect(result.shouldInvalidate).toBe(false)
    })

    it("always invalidates for inserts", () => {
      tracker.trackResult("sub-1", "tasks", ["r1"])
      const result = tracker.checkInvalidation("sub-1", "tasks", ["r-new"], "insert")
      expect(result.shouldInvalidate).toBe(true)
      expect(result.reason).toBe("new-row")
    })

    it("invalidates with delete reason for deletes", () => {
      tracker.trackResult("sub-1", "tasks", ["r1", "r2"])
      const result = tracker.checkInvalidation("sub-1", "tasks", ["r1"], "delete")
      expect(result.shouldInvalidate).toBe(true)
      expect(result.reason).toBe("deleted-row")
    })

    it("always invalidates in fallback mode", () => {
      const t = new RowLevelTracker({ maxRowsPerSubscription: 5 })
      const rows = Array.from({ length: 10 }, (_, i) => `r-${i}`)
      t.trackResult("sub-1", "tasks", rows)
      const result = t.checkInvalidation("sub-1", "tasks", ["r-99"], "update")
      expect(result.shouldInvalidate).toBe(true)
      expect(result.reason).toBe("fallback")
    })

    it("invalidates when unknown subscription is checked", () => {
      const result = tracker.checkInvalidation("unknown", "tasks", ["r1"], "update")
      expect(result.shouldInvalidate).toBe(true)
      expect(result.reason).toBe("fallback")
    })
  })

  describe("evaluateChanges", () => {
    it("evaluates all subscriptions for a table", () => {
      tracker.trackResult("sub-1", "tasks", ["r1", "r2"])
      tracker.trackResult("sub-2", "tasks", ["r3", "r4"])
      tracker.trackResult("sub-3", "users", ["u1"])

      const results = tracker.evaluateChanges("tasks", ["r2"], "update")
      expect(results).toHaveLength(2)

      const invalidated = results.filter((r) => r.shouldInvalidate)
      expect(invalidated).toHaveLength(1)
      expect(invalidated[0].subscriptionId).toBe("sub-1")
    })
  })

  describe("subscription removal", () => {
    it("removes subscription tracking", () => {
      tracker.trackResult("sub-1", "tasks", ["r1"])
      tracker.removeSubscription("sub-1")
      expect(tracker.subscriptionCount).toBe(0)
    })
  })

  describe("stats", () => {
    it("reports tracking statistics", () => {
      tracker.trackResult("sub-1", "tasks", ["r1", "r2", "r3"])

      const rows60 = Array.from({ length: 60 }, (_, i) => `r-${i}`)
      tracker.trackResult("sub-2", "tasks", rows60)

      const stats = tracker.getStats()
      expect(stats.totalSubscriptions).toBe(2)
      expect(stats.exactTrackingCount).toBe(1)
      expect(stats.bloomFilterCount).toBe(1)
      expect(stats.totalTrackedRows).toBe(63)
      expect(stats.memoryEstimateBytes).toBeGreaterThan(0)
    })
  })

  describe("reset", () => {
    it("clears all state", () => {
      tracker.trackResult("sub-1", "tasks", ["r1"])
      tracker.reset()
      expect(tracker.subscriptionCount).toBe(0)
    })
  })
})

describe("SQL builders", () => {
  it("generateRowTrackingTableSQL creates tables", () => {
    const sql = generateRowTrackingTableSQL()
    expect(sql).toContain("_reactivebase_row_tracking")
    expect(sql).toContain("CREATE TABLE")
  })

  it("buildUpsertRowTrackingSQL generates upsert", () => {
    const { sql, params } = buildUpsertRowTrackingSQL("sub-1", "tasks", ["r1", "r2"], "exact")
    expect(sql).toContain("INSERT INTO")
    expect(sql).toContain("ON CONFLICT")
    expect(params).toHaveLength(5)
  })

  it("buildDeleteRowTrackingSQL generates delete", () => {
    const { sql, params } = buildDeleteRowTrackingSQL("sub-1")
    expect(sql).toContain("DELETE")
    expect(params).toEqual(["sub-1"])
  })

  it("buildGetAffectedSubscriptionsSQL generates select", () => {
    const { sql, params } = buildGetAffectedSubscriptionsSQL("tasks", ["r1", "r2"])
    expect(sql).toContain("SELECT")
    expect(params).toHaveLength(2)
  })
})
