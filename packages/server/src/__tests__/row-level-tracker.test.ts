import { describe, it, expect, vi } from "vitest"
import {
  BloomFilter,
  AutoTunedBloomFilter,
  RowLevelTracker,
  AutoLevelTracker,
  QueryPrimaryKeyCapture,
  generateRowTrackingTableSQL,
  buildUpsertRowTrackingSQL,
  buildDeleteRowTrackingSQL,
  buildGetAffectedSubscriptionsSQL,
  buildGetTableStatsSQL,
} from "../reactivity/row-level-tracker.js"

// ─── BloomFilter ─────────────────────────────────────────────────────────────

describe("BloomFilter", () => {
  it("reports items that were added", () => {
    const bf = new BloomFilter(100)
    bf.add("alpha")
    bf.add("beta")
    bf.add("gamma")
    expect(bf.has("alpha")).toBe(true)
    expect(bf.has("beta")).toBe(true)
    expect(bf.has("gamma")).toBe(true)
  })

  it("returns false for items never added", () => {
    const bf = new BloomFilter(100)
    bf.add("present")
    expect(bf.has("absent")).toBe(false)
    expect(bf.has("")).toBe(false)
    expect(bf.has("presentx")).toBe(false)
  })

  it("tracks count of inserted items", () => {
    const bf = new BloomFilter(50)
    expect(bf.count).toBe(0)
    bf.add("a")
    bf.add("b")
    bf.add("c")
    expect(bf.count).toBe(3)
  })

  it("reports a positive memoryBytes value", () => {
    const bf = new BloomFilter(1000, 0.01)
    expect(bf.memoryBytes).toBeGreaterThan(0)
  })

  it("has low false positive rate within expected bounds", () => {
    const n = 1000
    const fpRate = 0.05
    const bf = new BloomFilter(n, fpRate)
    for (let i = 0; i < n; i++) bf.add(`item-${i}`)

    let falsePositives = 0
    const tests = 10_000
    for (let i = 0; i < tests; i++) {
      if (bf.has(`nonexistent-${i}`)) falsePositives++
    }
    // Allow generous margin (3x requested rate) since it's probabilistic
    expect(falsePositives / tests).toBeLessThan(fpRate * 3)
  })

  it("handles empty string and special characters", () => {
    const bf = new BloomFilter(100)
    bf.add("")
    bf.add("hello world")
    bf.add("日本語")
    bf.add("emoji-🎉")
    expect(bf.has("")).toBe(true)
    expect(bf.has("hello world")).toBe(true)
    expect(bf.has("日本語")).toBe(true)
    expect(bf.has("emoji-🎉")).toBe(true)
  })

  it("works with a very small expected item count", () => {
    const bf = new BloomFilter(1)
    bf.add("only-one")
    expect(bf.has("only-one")).toBe(true)
    expect(bf.count).toBe(1)
    expect(bf.memoryBytes).toBeGreaterThan(0)
  })

  it("reports non-inserted items as absent (mostly)", () => {
    const bloom = new BloomFilter(1000, 0.001)
    for (let i = 0; i < 100; i++) bloom.add(`item-${i}`)
    let falsePositives = 0
    for (let i = 100; i < 200; i++) {
      if (bloom.has(`item-${i}`)) falsePositives++
    }
    expect(falsePositives).toBeLessThan(5)
  })
})

// ─── AutoTunedBloomFilter ────────────────────────────────────────────────────

describe("AutoTunedBloomFilter", () => {
  it("delegates add/has to inner filter", () => {
    const abf = new AutoTunedBloomFilter(100)
    abf.add("x")
    abf.add("y")
    expect(abf.has("x")).toBe(true)
    expect(abf.has("y")).toBe(true)
    expect(abf.has("z")).toBe(false)
  })

  it("exposes count and memoryBytes", () => {
    const abf = new AutoTunedBloomFilter(100)
    abf.add("a")
    abf.add("b")
    expect(abf.count).toBe(2)
    expect(abf.memoryBytes).toBeGreaterThan(0)
  })

  it("keeps recommendedFpRate unchanged when checkCount < 100", () => {
    const initialRate = 0.02
    const abf = new AutoTunedBloomFilter(100, initialRate)
    for (let i = 0; i < 50; i++) abf.recordFalsePositive()
    expect(abf.recommendedFpRate).toBe(initialRate)
  })

  it("recommends lower FP rate when observed FP rate is high", () => {
    const initialRate = 0.05
    const abf = new AutoTunedBloomFilter(100, initialRate, 0.001, 0.1)
    // Simulate high false positive ratio (> 1.5x the current rate)
    for (let i = 0; i < 100; i++) abf.recordFalsePositive()
    // observedFpRate = 100/100 = 1.0, which is >> 0.05 * 1.5
    expect(abf.recommendedFpRate).toBeLessThan(initialRate)
  })

  it("recommends higher FP rate when observed FP rate is very low", () => {
    const initialRate = 0.01
    const abf = new AutoTunedBloomFilter(100, initialRate, 0.001, 0.1)
    // 100 checks, 0 false positives → observedRate = 0 < 0.01 * 0.1
    for (let i = 0; i < 100; i++) abf.recordCheck()
    expect(abf.recommendedFpRate).toBeGreaterThan(initialRate)
  })

  it("clamps recommendedFpRate to min/max bounds", () => {
    const minRate = 0.005
    const maxRate = 0.05
    const abf = new AutoTunedBloomFilter(100, 0.01, minRate, maxRate)
    // Drive observed rate to zero for several cycles to try to exceed max
    for (let i = 0; i < 200; i++) abf.recordCheck()
    expect(abf.recommendedFpRate).toBeLessThanOrEqual(maxRate)
    expect(abf.recommendedFpRate).toBeGreaterThanOrEqual(minRate)
  })

  it("exposes stats correctly", () => {
    const abf = new AutoTunedBloomFilter(100)
    abf.recordCheck()
    abf.recordCheck()
    abf.recordFalsePositive() // also increments checkCount
    const stats = abf.stats
    expect(stats.checkCount).toBe(3)
    expect(stats.falsePositiveCount).toBe(1)
    expect(stats.observedFpRate).toBeCloseTo(1 / 3)
  })

  it("returns observedFpRate 0 when no checks made", () => {
    const abf = new AutoTunedBloomFilter(100)
    expect(abf.stats.observedFpRate).toBe(0)
  })
})

// ─── RowLevelTracker — exact mode ────────────────────────────────────────────

describe("RowLevelTracker — exact mode", () => {
  it("tracks a small result set in exact mode", () => {
    const tracker = new RowLevelTracker()
    const state = tracker.trackResult("sub-1", "users", ["row-1", "row-2", "row-3"])
    expect(state.mode).toBe("exact")
    expect(state.rowCount).toBe(3)
    expect(state.subscriptionId).toBe("sub-1")
    expect(state.table).toBe("users")
    expect(state.trackedRows).toBeInstanceOf(Set)
  })

  it("invalidates when a tracked row is updated", () => {
    const tracker = new RowLevelTracker()
    tracker.trackResult("sub-1", "users", ["row-1", "row-2"])
    const result = tracker.checkInvalidation("sub-1", "users", ["row-2"], "update")
    expect(result.shouldInvalidate).toBe(true)
    expect(result.reason).toBe("row-match")
    expect(result.matchedRows).toContain("row-2")
  })

  it("does not invalidate when changed rows are not tracked", () => {
    const tracker = new RowLevelTracker()
    tracker.trackResult("sub-1", "users", ["row-1", "row-2"])
    const result = tracker.checkInvalidation("sub-1", "users", ["row-99"], "update")
    expect(result.shouldInvalidate).toBe(false)
  })

  it("uses deleted-row reason for delete operations on exact matches", () => {
    const tracker = new RowLevelTracker()
    tracker.trackResult("sub-1", "users", ["row-1", "row-2"])
    const result = tracker.checkInvalidation("sub-1", "users", ["row-1"], "delete")
    expect(result.shouldInvalidate).toBe(true)
    expect(result.reason).toBe("deleted-row")
    expect(result.matchedRows).toContain("row-1")
  })

  it("always invalidates on insert regardless of tracked rows", () => {
    const tracker = new RowLevelTracker()
    tracker.trackResult("sub-1", "users", ["row-1"])
    const result = tracker.checkInvalidation("sub-1", "users", ["row-new"], "insert")
    expect(result.shouldInvalidate).toBe(true)
    expect(result.reason).toBe("new-row")
  })

  it("returns fallback when subscription has no tracking for the table", () => {
    const tracker = new RowLevelTracker()
    tracker.trackResult("sub-1", "users", ["row-1"])
    const result = tracker.checkInvalidation("sub-1", "orders", ["row-1"], "update")
    expect(result.shouldInvalidate).toBe(true)
    expect(result.reason).toBe("fallback")
  })

  it("returns fallback when subscription is unknown", () => {
    const tracker = new RowLevelTracker()
    const result = tracker.checkInvalidation("unknown-sub", "users", ["row-1"], "update")
    expect(result.shouldInvalidate).toBe(true)
    expect(result.reason).toBe("fallback")
  })

  it("tracks multiple tables for the same subscription", () => {
    const tracker = new RowLevelTracker()
    tracker.trackResult("sub-1", "users", ["u1", "u2"])
    tracker.trackResult("sub-1", "orders", ["o1", "o2"])

    const userResult = tracker.checkInvalidation("sub-1", "users", ["u1"], "update")
    expect(userResult.shouldInvalidate).toBe(true)

    const orderResult = tracker.checkInvalidation("sub-1", "orders", ["o99"], "update")
    expect(orderResult.shouldInvalidate).toBe(false)
  })

  it("replaces tracking when trackResult is called again for the same table", () => {
    const tracker = new RowLevelTracker()
    tracker.trackResult("sub-1", "users", ["row-1", "row-2"])
    tracker.trackResult("sub-1", "users", ["row-3", "row-4"])

    const old = tracker.checkInvalidation("sub-1", "users", ["row-1"], "update")
    expect(old.shouldInvalidate).toBe(false)

    const current = tracker.checkInvalidation("sub-1", "users", ["row-3"], "update")
    expect(current.shouldInvalidate).toBe(true)
  })
})

// ─── RowLevelTracker — bloom mode ────────────────────────────────────────────

describe("RowLevelTracker — bloom mode", () => {
  const maxRows = 100
  const bloomThreshold = maxRows / 2 // 50

  function createBloomTracker() {
    return new RowLevelTracker({ maxRowsPerSubscription: maxRows, useBloomFilters: true })
  }

  function generateRowIds(count: number): string[] {
    return Array.from({ length: count }, (_, i) => `row-${i}`)
  }

  it("uses bloom filter for row sets larger than half the max", () => {
    const tracker = createBloomTracker()
    const rows = generateRowIds(bloomThreshold + 1)
    const state = tracker.trackResult("sub-1", "users", rows)
    expect(state.mode).toBe("bloom")
    expect(state.trackedRows).toBeInstanceOf(BloomFilter)
  })

  it("uses exact mode for row sets at or below the bloom threshold", () => {
    const tracker = createBloomTracker()
    const rows = generateRowIds(bloomThreshold)
    const state = tracker.trackResult("sub-1", "users", rows)
    expect(state.mode).toBe("exact")
  })

  it("invalidates via bloom when a tracked row is changed", () => {
    const tracker = createBloomTracker()
    const rows = generateRowIds(bloomThreshold + 10)
    tracker.trackResult("sub-1", "users", rows)
    // row-5 was definitely added
    const result = tracker.checkInvalidation("sub-1", "users", ["row-5"], "update")
    expect(result.shouldInvalidate).toBe(true)
    expect(result.reason).toBe("bloom-possible-match")
  })

  it("reports bloom-possible-match reason even when not invalidating", () => {
    const tracker = createBloomTracker()
    const rows = generateRowIds(bloomThreshold + 10)
    tracker.trackResult("sub-1", "users", rows)
    // Use a string very unlikely to be a false positive
    const result = tracker.checkInvalidation("sub-1", "users", ["zzz-never-added-unique-12345"], "update")
    // The result reason should be bloom-possible-match whether or not it matches
    expect(result.reason).toBe("bloom-possible-match")
  })

  it("always invalidates on insert in bloom mode", () => {
    const tracker = createBloomTracker()
    tracker.trackResult("sub-1", "users", generateRowIds(bloomThreshold + 10))
    const result = tracker.checkInvalidation("sub-1", "users", ["brand-new-row"], "insert")
    expect(result.shouldInvalidate).toBe(true)
    expect(result.reason).toBe("new-row")
  })
})

// ─── RowLevelTracker — fallback mode ─────────────────────────────────────────

describe("RowLevelTracker — fallback mode", () => {
  it("falls back when row count exceeds max and bloom disabled", () => {
    const onFallback = vi.fn()
    const tracker = new RowLevelTracker({
      maxRowsPerSubscription: 10,
      useBloomFilters: false,
      onFallback,
    })
    const rows = Array.from({ length: 11 }, (_, i) => `row-${i}`)
    const state = tracker.trackResult("sub-1", "users", rows)
    expect(state.mode).toBe("fallback")
    expect(onFallback).toHaveBeenCalledWith("sub-1", 11)
  })

  it("falls back when row count exceeds max even with bloom enabled", () => {
    const onFallback = vi.fn()
    const tracker = new RowLevelTracker({
      maxRowsPerSubscription: 10,
      useBloomFilters: true,
      onFallback,
    })
    const rows = Array.from({ length: 11 }, (_, i) => `row-${i}`)
    const state = tracker.trackResult("sub-1", "users", rows)
    expect(state.mode).toBe("fallback")
    expect(onFallback).toHaveBeenCalledWith("sub-1", 11)
  })

  it("always invalidates in fallback mode", () => {
    const tracker = new RowLevelTracker({ maxRowsPerSubscription: 5, useBloomFilters: false })
    tracker.trackResult("sub-1", "users", ["1", "2", "3", "4", "5", "6"])
    const result = tracker.checkInvalidation("sub-1", "users", ["99"], "update")
    expect(result.shouldInvalidate).toBe(true)
    expect(result.reason).toBe("fallback")
  })

  it("uses exact mode when bloom disabled and rows within limit", () => {
    const tracker = new RowLevelTracker({
      maxRowsPerSubscription: 100,
      useBloomFilters: false,
    })
    // 60 rows is > 50 (half of max) but bloom is disabled, so should still be exact
    const rows = Array.from({ length: 60 }, (_, i) => `row-${i}`)
    const state = tracker.trackResult("sub-1", "users", rows)
    expect(state.mode).toBe("exact")
  })
})

// ─── RowLevelTracker — removeSubscription ────────────────────────────────────

describe("RowLevelTracker — removeSubscription", () => {
  it("removes all tracking for a subscription", () => {
    const tracker = new RowLevelTracker()
    tracker.trackResult("sub-1", "users", ["row-1"])
    tracker.trackResult("sub-1", "orders", ["o-1"])
    expect(tracker.subscriptionCount).toBe(1)
    expect(tracker.getTrackingState("sub-1")).toBeDefined()

    tracker.removeSubscription("sub-1")
    expect(tracker.subscriptionCount).toBe(0)
    expect(tracker.getTrackingState("sub-1")).toBeUndefined()
  })

  it("is a no-op for unknown subscription ids", () => {
    const tracker = new RowLevelTracker()
    tracker.trackResult("sub-1", "users", ["row-1"])
    tracker.removeSubscription("sub-unknown")
    expect(tracker.subscriptionCount).toBe(1)
  })

  it("does not affect other subscriptions", () => {
    const tracker = new RowLevelTracker()
    tracker.trackResult("sub-1", "users", ["row-1"])
    tracker.trackResult("sub-2", "users", ["row-2"])
    tracker.removeSubscription("sub-1")

    expect(tracker.subscriptionCount).toBe(1)
    expect(tracker.getTrackingState("sub-1")).toBeUndefined()
    expect(tracker.getTrackingState("sub-2")).toBeDefined()
  })
})

// ─── RowLevelTracker — getStats ──────────────────────────────────────────────

describe("RowLevelTracker — getStats", () => {
  it("returns zeroed stats when empty", () => {
    const tracker = new RowLevelTracker()
    const stats = tracker.getStats()
    expect(stats.totalSubscriptions).toBe(0)
    expect(stats.exactTrackingCount).toBe(0)
    expect(stats.bloomFilterCount).toBe(0)
    expect(stats.fallbackCount).toBe(0)
    expect(stats.totalTrackedRows).toBe(0)
    expect(stats.avgRowsPerSubscription).toBe(0)
    expect(stats.memoryEstimateBytes).toBe(0)
  })

  it("counts exact subscriptions correctly", () => {
    const tracker = new RowLevelTracker()
    tracker.trackResult("sub-1", "users", ["r1", "r2"])
    tracker.trackResult("sub-2", "orders", ["o1"])
    const stats = tracker.getStats()
    expect(stats.totalSubscriptions).toBe(2)
    expect(stats.exactTrackingCount).toBe(2)
    expect(stats.totalTrackedRows).toBe(3)
    expect(stats.avgRowsPerSubscription).toBeCloseTo(1.5)
    expect(stats.memoryEstimateBytes).toBeGreaterThan(0)
  })

  it("counts bloom and fallback subscriptions", () => {
    const tracker = new RowLevelTracker({ maxRowsPerSubscription: 20, useBloomFilters: true })
    // Exact: 5 rows (< 10 = half of 20)
    tracker.trackResult(
      "sub-exact",
      "t1",
      Array.from({ length: 5 }, (_, i) => `e-${i}`),
    )
    // Bloom: 15 rows (> 10, <= 20)
    tracker.trackResult(
      "sub-bloom",
      "t2",
      Array.from({ length: 15 }, (_, i) => `b-${i}`),
    )
    // Fallback: 25 rows (> 20)
    tracker.trackResult(
      "sub-fallback",
      "t3",
      Array.from({ length: 25 }, (_, i) => `f-${i}`),
    )

    const stats = tracker.getStats()
    expect(stats.exactTrackingCount).toBe(1)
    expect(stats.bloomFilterCount).toBe(1)
    expect(stats.fallbackCount).toBe(1)
    expect(stats.totalSubscriptions).toBe(3)
    expect(stats.totalTrackedRows).toBe(5 + 15 + 25)
  })

  it("counts multiple tables under one subscription as separate entries", () => {
    const tracker = new RowLevelTracker()
    tracker.trackResult("sub-1", "users", ["u1"])
    tracker.trackResult("sub-1", "orders", ["o1", "o2"])
    const stats = tracker.getStats()
    // 1 subscription, but 2 table-level tracking entries
    expect(stats.totalSubscriptions).toBe(1)
    expect(stats.exactTrackingCount).toBe(2)
    expect(stats.totalTrackedRows).toBe(3)
  })
})

// ─── RowLevelTracker — evaluateChanges ───────────────────────────────────────

describe("RowLevelTracker — evaluateChanges", () => {
  it("evaluates all subscriptions tracking a given table", () => {
    const tracker = new RowLevelTracker()
    tracker.trackResult("sub-1", "users", ["row-1", "row-2"])
    tracker.trackResult("sub-2", "users", ["row-3", "row-4"])
    tracker.trackResult("sub-3", "orders", ["o1"])

    const results = tracker.evaluateChanges("users", ["row-1"], "update")
    expect(results).toHaveLength(2)
    const sub1 = results.find((r) => r.subscriptionId === "sub-1")
    const sub2 = results.find((r) => r.subscriptionId === "sub-2")
    expect(sub1?.shouldInvalidate).toBe(true)
    expect(sub2?.shouldInvalidate).toBe(false)
  })

  it("returns empty for a table with no subscriptions", () => {
    const tracker = new RowLevelTracker()
    tracker.trackResult("sub-1", "users", ["row-1"])
    const results = tracker.evaluateChanges("orders", ["o1"], "update")
    expect(results).toHaveLength(0)
  })
})

// ─── RowLevelTracker — reset ─────────────────────────────────────────────────

describe("RowLevelTracker — reset", () => {
  it("clears all tracking state", () => {
    const tracker = new RowLevelTracker()
    tracker.trackResult("sub-1", "users", ["r1"])
    tracker.trackResult("sub-2", "orders", ["o1"])
    expect(tracker.subscriptionCount).toBe(2)

    tracker.reset()
    expect(tracker.subscriptionCount).toBe(0)
    expect(tracker.getTrackingState("sub-1")).toBeUndefined()
  })
})

// ─── AutoLevelTracker — level determination ──────────────────────────────────

describe("AutoLevelTracker — level determination", () => {
  it("returns level 1 for small tables", () => {
    const alt = new AutoLevelTracker({ tableSizeThresholdL2: 1000 })
    const decision = alt.determineLevel("users", 500, 5)
    expect(decision.level).toBe(1)
    expect(decision.reason).toContain("< L2 threshold")
  })

  it("returns level 2 for medium tables", () => {
    const alt = new AutoLevelTracker({
      tableSizeThresholdL2: 1000,
      tableSizeThresholdL3: 100_000,
      subscriptionThresholdL3: 10,
    })
    const decision = alt.determineLevel("orders", 5000, 5)
    expect(decision.level).toBe(2)
  })

  it("returns level 3 for large tables with many subscriptions", () => {
    const alt = new AutoLevelTracker({
      tableSizeThresholdL2: 1000,
      tableSizeThresholdL3: 100_000,
      subscriptionThresholdL3: 10,
    })
    const decision = alt.determineLevel("events", 200_000, 20)
    expect(decision.level).toBe(3)
  })

  it("returns level 2 when table is large but subscriptions are few", () => {
    const alt = new AutoLevelTracker({
      tableSizeThresholdL3: 100_000,
      subscriptionThresholdL3: 10,
    })
    const decision = alt.determineLevel("events", 200_000, 3)
    expect(decision.level).toBe(2)
  })
})

// ─── AutoLevelTracker — adaptive overrides ───────────────────────────────────

describe("AutoLevelTracker — adaptive overrides", () => {
  it("promotes level when false invalidation rate is high", () => {
    const alt = new AutoLevelTracker({
      tableSizeThresholdL2: 100,
      tableSizeThresholdL3: 100_000,
    })
    // Table with 500 rows → naturally level 2
    const baseDecision = alt.determineLevel("orders", 500, 5)
    expect(baseDecision.level).toBe(2)

    // Record 50+ invalidations with >30% false rate
    for (let i = 0; i < 60; i++) {
      alt.recordInvalidation("orders", 1, i < 25 ? true : false, 500, 5)
    }
    // 25/60 ≈ 0.416 > 0.3 → should promote from 2 to 3
    const promoted = alt.determineLevel("orders", 500, 5)
    expect(promoted.level).toBe(3)
    expect(promoted.reason).toContain("adaptive override")
  })

  it("demotes level when false invalidation rate is very low", () => {
    const alt = new AutoLevelTracker({
      tableSizeThresholdL2: 100,
      tableSizeThresholdL3: 10_000,
      subscriptionThresholdL3: 5,
    })
    // Table is large with many subs → naturally level 3
    expect(alt.determineLevel("events", 50_000, 20).level).toBe(3)

    // Record exactly 50 invalidations with <5% false rate to trigger one demotion
    for (let i = 0; i < 50; i++) {
      alt.recordInvalidation("events", 1, i < 2 ? true : false, 50_000, 20)
    }
    // 2/50 = 0.04 < 0.05 → should demote from 3 to 2
    const demoted = alt.determineLevel("events", 50_000, 20)
    expect(demoted.level).toBe(2)
    expect(demoted.reason).toContain("adaptive override")
  })

  it("clearOverrides restores heuristic-based levels", () => {
    const alt = new AutoLevelTracker({ tableSizeThresholdL2: 100 })
    // Build up an override
    for (let i = 0; i < 60; i++) {
      alt.recordInvalidation("orders", 1, true, 500, 5)
    }
    expect(alt.determineLevel("orders", 500, 5).reason).toContain("adaptive override")

    alt.clearOverrides()
    const decision = alt.determineLevel("orders", 500, 5)
    expect(decision.reason).not.toContain("adaptive override")
  })
})

// ─── AutoLevelTracker — recordInvalidation & metrics ─────────────────────────

describe("AutoLevelTracker — recordInvalidation & metrics", () => {
  it("records and retrieves table metrics", () => {
    const alt = new AutoLevelTracker()
    alt.recordInvalidation("users", 3, false, 5000, 10)
    alt.recordInvalidation("users", 2, true, 5000, 10)

    const metrics = alt.getTableMetrics("users")
    expect(metrics).toBeDefined()
    expect(metrics!.totalInvalidations).toBe(2)
    expect(metrics!.falseInvalidations).toBe(1)
    expect(metrics!.lastRowCount).toBe(5000)
    expect(metrics!.lastSubscriptionCount).toBe(10)
  })

  it("computes running average of subscriptions invalidated", () => {
    const alt = new AutoLevelTracker()
    alt.recordInvalidation("users", 10, false, 1000, 20)
    alt.recordInvalidation("users", 20, false, 1000, 20)
    const metrics = alt.getTableMetrics("users")!
    expect(metrics.avgSubscriptionsInvalidated).toBeCloseTo(15)
  })

  it("returns undefined for unknown tables", () => {
    const alt = new AutoLevelTracker()
    expect(alt.getTableMetrics("nope")).toBeUndefined()
  })

  it("returns all metrics via getAllMetrics", () => {
    const alt = new AutoLevelTracker()
    alt.recordInvalidation("t1", 1, false, 100, 1)
    alt.recordInvalidation("t2", 1, false, 200, 2)
    const all = alt.getAllMetrics()
    expect(all).toHaveLength(2)
    expect(all.map((m) => m.table).sort()).toEqual(["t1", "t2"])
  })

  it("does not trigger adaptive override before 50 invalidations", () => {
    const alt = new AutoLevelTracker({ tableSizeThresholdL2: 100 })
    // 49 invalidations, all false — should NOT trigger override yet
    for (let i = 0; i < 49; i++) {
      alt.recordInvalidation("orders", 1, true, 500, 5)
    }
    const decision = alt.determineLevel("orders", 500, 5)
    expect(decision.reason).not.toContain("adaptive override")
  })
})

// ─── AutoLevelTracker — evaluateChangesAutoLevel ─────────────────────────────

describe("AutoLevelTracker — evaluateChangesAutoLevel", () => {
  it("uses row-level evaluation at level 3", () => {
    const alt = new AutoLevelTracker({
      tableSizeThresholdL2: 10,
      tableSizeThresholdL3: 100,
      subscriptionThresholdL3: 2,
    })
    // Track rows in the underlying tracker
    alt.tracker.trackResult("sub-1", "events", ["e1", "e2"])
    alt.tracker.trackResult("sub-2", "events", ["e3", "e4"])

    const { level, results } = alt.evaluateChangesAutoLevel("events", ["e1"], "update", 200, 5)
    expect(level).toBe(3)
    // sub-1 should be invalidated (tracks e1), sub-2 should not
    const sub1 = results.find((r) => r.subscriptionId === "sub-1")
    const sub2 = results.find((r) => r.subscriptionId === "sub-2")
    expect(sub1?.shouldInvalidate).toBe(true)
    expect(sub2?.shouldInvalidate).toBe(false)
  })

  it("forces invalidation for all subscriptions at level 1 or 2", () => {
    const alt = new AutoLevelTracker({
      tableSizeThresholdL2: 1000,
      tableSizeThresholdL3: 100_000,
    })
    alt.tracker.trackResult("sub-1", "users", ["u1", "u2"])
    alt.tracker.trackResult("sub-2", "users", ["u3", "u4"])

    // 500 rows → level 1 (< L2 threshold of 1000)
    const { level, results } = alt.evaluateChangesAutoLevel("users", ["u1"], "update", 500, 2)
    expect(level).toBe(1)
    expect(results.every((r) => r.shouldInvalidate)).toBe(true)
    expect(results.every((r) => r.reason === "fallback")).toBe(true)
  })

  it("returns empty results when no subscriptions track the table", () => {
    const alt = new AutoLevelTracker()
    const { results } = alt.evaluateChangesAutoLevel("unknown", ["x"], "update", 5000, 10)
    expect(results).toHaveLength(0)
  })

  it("works at level 2 with subscriptions", () => {
    const alt = new AutoLevelTracker({
      tableSizeThresholdL2: 100,
      tableSizeThresholdL3: 100_000,
      subscriptionThresholdL3: 50,
    })
    alt.tracker.trackResult("sub-1", "orders", ["o1"])
    alt.tracker.trackResult("sub-2", "orders", ["o2"])

    // 5000 rows, 2 subs → level 2 (>= L2 but not enough subs for L3)
    const { level, results } = alt.evaluateChangesAutoLevel("orders", ["o1"], "update", 5000, 2)
    expect(level).toBe(2)
    // At L2, all subscriptions should be force-invalidated
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.shouldInvalidate)).toBe(true)
  })
})

// ─── AutoLevelTracker — reset ────────────────────────────────────────────────

describe("AutoLevelTracker — reset", () => {
  it("clears tracker, metrics, and overrides", () => {
    const alt = new AutoLevelTracker()
    alt.tracker.trackResult("sub-1", "users", ["r1"])
    alt.recordInvalidation("users", 1, false, 100, 1)
    // Force an override by recording many false invalidations
    for (let i = 0; i < 60; i++) {
      alt.recordInvalidation("users", 1, true, 5000, 5)
    }

    alt.reset()
    expect(alt.tracker.subscriptionCount).toBe(0)
    expect(alt.getTableMetrics("users")).toBeUndefined()
    // After reset, override should be gone
    const decision = alt.determineLevel("users", 5000, 5)
    expect(decision.reason).not.toContain("adaptive override")
  })
})

// ─── AutoLevelTracker — tracker accessor ─────────────────────────────────────

describe("AutoLevelTracker — tracker accessor", () => {
  it("exposes the underlying RowLevelTracker", () => {
    const alt = new AutoLevelTracker()
    expect(alt.tracker).toBeInstanceOf(RowLevelTracker)
  })

  it("forwards custom rowLevelTrackerOptions", () => {
    const onFallback = vi.fn()
    const alt = new AutoLevelTracker({
      rowLevelTrackerOptions: { maxRowsPerSubscription: 5, onFallback },
    })
    alt.tracker.trackResult(
      "sub-1",
      "t",
      Array.from({ length: 6 }, (_, i) => `r-${i}`),
    )
    expect(onFallback).toHaveBeenCalled()
  })
})

// ─── QueryPrimaryKeyCapture ──────────────────────────────────────────────────

describe("QueryPrimaryKeyCapture", () => {
  it("extracts primary keys from result rows", () => {
    const capture = new QueryPrimaryKeyCapture()
    const rows = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
      { id: 3, name: "Carol" },
    ]
    const keys = capture.capturePrimaryKeys("getUsers", rows, "id")
    expect(keys).toEqual(new Set(["1", "2", "3"]))
  })

  it("retrieves tracked keys by query name", () => {
    const capture = new QueryPrimaryKeyCapture()
    capture.capturePrimaryKeys("q1", [{ pk: "a" }, { pk: "b" }], "pk")
    const keys = capture.getTrackedKeys("q1")
    expect(keys.has("a")).toBe(true)
    expect(keys.has("b")).toBe(true)
  })

  it("returns empty set for unknown query names", () => {
    const capture = new QueryPrimaryKeyCapture()
    expect(capture.getTrackedKeys("nonexistent")).toEqual(new Set())
  })

  it("skips null and undefined primary key values", () => {
    const capture = new QueryPrimaryKeyCapture()
    const rows = [{ id: 1 }, { id: null }, { id: undefined }, { id: 2 }]
    const keys = capture.capturePrimaryKeys("q1", rows as Record<string, unknown>[], "id")
    expect(keys).toEqual(new Set(["1", "2"]))
  })

  it("uses a non-id column as primary key", () => {
    const capture = new QueryPrimaryKeyCapture()
    const rows = [{ uuid: "abc-123" }, { uuid: "def-456" }]
    const keys = capture.capturePrimaryKeys("q1", rows, "uuid")
    expect(keys).toEqual(new Set(["abc-123", "def-456"]))
  })

  it("clears tracked keys for a specific query", () => {
    const capture = new QueryPrimaryKeyCapture()
    capture.capturePrimaryKeys("q1", [{ id: 1 }], "id")
    capture.clearTrackedKeys("q1")
    expect(capture.getTrackedKeys("q1")).toEqual(new Set())
  })

  it("resets all captured keys", () => {
    const capture = new QueryPrimaryKeyCapture()
    capture.capturePrimaryKeys("q1", [{ id: 1 }], "id")
    capture.capturePrimaryKeys("q2", [{ id: 2 }], "id")
    capture.reset()
    expect(capture.getTrackedKeys("q1")).toEqual(new Set())
    expect(capture.getTrackedKeys("q2")).toEqual(new Set())
  })

  it("returns empty set when pk column does not exist in rows", () => {
    const capture = new QueryPrimaryKeyCapture()
    const rows = [{ name: "Alice" }, { name: "Bob" }]
    const keys = capture.capturePrimaryKeys("q1", rows, "id")
    expect(keys).toEqual(new Set())
  })
})

// ─── QueryPrimaryKeyCapture — captureAndTrack ────────────────────────────────

describe("QueryPrimaryKeyCapture — captureAndTrack", () => {
  it("captures keys and tracks them in the RowLevelTracker", () => {
    const tracker = new RowLevelTracker()
    const capture = new QueryPrimaryKeyCapture(tracker)
    const rows = [{ id: "pk-1" }, { id: "pk-2" }]
    const state = capture.captureAndTrack("sub-1", "users", rows, "id")

    expect(state).not.toBeNull()
    expect(state!.mode).toBe("exact")
    expect(state!.rowCount).toBe(2)

    // Verify the tracker now tracks those rows
    const result = tracker.checkInvalidation("sub-1", "users", ["pk-1"], "update")
    expect(result.shouldInvalidate).toBe(true)
  })

  it("returns null when no RowLevelTracker is provided", () => {
    const capture = new QueryPrimaryKeyCapture()
    const result = capture.captureAndTrack("sub-1", "users", [{ id: 1 }], "id")
    expect(result).toBeNull()
  })

  it("still captures keys even without a tracker", () => {
    const capture = new QueryPrimaryKeyCapture()
    capture.captureAndTrack("sub-1", "users", [{ id: "a" }, { id: "b" }], "id")
    // captureAndTrack uses subscriptionId as queryName
    const keys = capture.getTrackedKeys("sub-1")
    expect(keys.has("a")).toBe(true)
    expect(keys.has("b")).toBe(true)
  })
})

// ─── SQL builders ────────────────────────────────────────────────────────────

describe("SQL builders", () => {
  describe("generateRowTrackingTableSQL", () => {
    it("returns CREATE TABLE and CREATE INDEX statements", () => {
      const sql = generateRowTrackingTableSQL()
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS _reactivebase_row_tracking")
      expect(sql).toContain("subscription_id TEXT NOT NULL")
      expect(sql).toContain("table_name TEXT NOT NULL")
      expect(sql).toContain("row_ids TEXT[]")
      expect(sql).toContain("PRIMARY KEY (subscription_id, table_name)")
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_row_tracking_table")
    })
  })

  describe("buildUpsertRowTrackingSQL", () => {
    it("produces parameterized upsert SQL", () => {
      const { sql, params } = buildUpsertRowTrackingSQL("sub-1", "users", ["r1", "r2"], "exact")
      expect(sql).toContain("INSERT INTO _reactivebase_row_tracking")
      expect(sql).toContain("ON CONFLICT (subscription_id, table_name) DO UPDATE")
      expect(params).toEqual(["sub-1", "users", ["r1", "r2"], "exact", 2])
    })

    it("sets row_count param to length of rowIds", () => {
      const { params } = buildUpsertRowTrackingSQL("s", "t", ["a", "b", "c"], "bloom")
      expect(params[4]).toBe(3)
    })

    it("handles empty rowIds array", () => {
      const { params } = buildUpsertRowTrackingSQL("s", "t", [], "fallback")
      expect(params[2]).toEqual([])
      expect(params[4]).toBe(0)
    })
  })

  describe("buildDeleteRowTrackingSQL", () => {
    it("produces parameterized delete SQL", () => {
      const { sql, params } = buildDeleteRowTrackingSQL("sub-42")
      expect(sql).toContain("DELETE FROM _reactivebase_row_tracking")
      expect(sql).toContain("$1")
      expect(params).toEqual(["sub-42"])
    })
  })

  describe("buildGetAffectedSubscriptionsSQL", () => {
    it("produces parameterized query for affected subscriptions", () => {
      const { sql, params } = buildGetAffectedSubscriptionsSQL("users", ["r1", "r2"])
      expect(sql).toContain("SELECT subscription_id FROM _reactivebase_row_tracking")
      expect(sql).toContain("table_name = $1")
      expect(sql).toContain("mode = 'fallback' OR row_ids && $2")
      expect(params).toEqual(["users", ["r1", "r2"]])
    })
  })

  describe("buildGetTableStatsSQL", () => {
    it("produces parameterized query for table stats", () => {
      const { sql, params } = buildGetTableStatsSQL("users")
      expect(sql).toContain("pg_class")
      expect(sql).toContain("relname = $1")
      expect(params).toEqual(["users"])
    })
  })
})
