import { describe, it, expect } from "vitest"
import {
  SubscriptionAnalytics,
  createSubscriptionAnalytics,
} from "../subscription-analytics/index.js"

describe("subscription-analytics", () => {
  it("should export all expected symbols", () => {
    expect(SubscriptionAnalytics).toBeDefined()
    expect(createSubscriptionAnalytics).toBeDefined()
  })

  it("should create a SubscriptionAnalytics via factory", () => {
    const analytics = createSubscriptionAnalytics()
    expect(analytics).toBeInstanceOf(SubscriptionAnalytics)
  })

  it("should test analytics collection over time", () => {
    const analytics = createSubscriptionAnalytics()
    analytics.trackSubscription("sub-1", "getUsers", "conn-1", {}, ["users"], "u1")

    analytics.recordReExecution("sub-1", 50, 100, 2048, true, "users", "insert")
    analytics.recordReExecution("sub-1", 30, 80, 1024, false, "users", "update")
    analytics.recordReExecution("sub-1", 40, 90, 512, true, "users", "delete")

    const attribution = analytics.getCostAttribution()
    expect(attribution.totals.totalSubscriptions).toBe(1)
    expect(attribution.totals.totalReExecutions).toBe(3)
    expect(attribution.totals.totalCpuTimeMs).toBe(120)
    expect(attribution.totals.totalRowsScanned).toBe(270)
    expect(attribution.totals.totalBytesTransferred).toBe(3584)
    expect(attribution.totals.totalFalseInvalidations).toBe(1)

    const triggers = analytics.getInvalidationTriggers("sub-1")
    expect(triggers).toHaveLength(3)
    expect(triggers[0].table).toBe("users")
    expect(triggers[0].resultChanged).toBe(true)
    expect(triggers[1].resultChanged).toBe(false)

    analytics.stop()
  })

  it("should track subscription cost records", () => {
    const analytics = createSubscriptionAnalytics()
    expect(typeof analytics).toBe("object")
  })

  it("should test cost attribution and optimization suggestions", () => {
    const analytics = createSubscriptionAnalytics()
    analytics.trackSubscription("sub-broad", "getBroadQuery", "conn-1", {}, ["a", "b", "c", "d"], "u1")

    const attribution = analytics.getCostAttribution()
    expect(attribution.byQuery["getBroadQuery"]).toBeDefined()
    expect(attribution.byQuery["getBroadQuery"].activeSubscriptions).toBe(1)

    const suggestions = analytics.generateSuggestions()
    const broadSuggestion = suggestions.find((s) => s.type === "broad_dependency")
    expect(broadSuggestion).toBeDefined()
    expect(broadSuggestion!.subscriptionId).toBe("sub-broad")
    expect(broadSuggestion!.severity).toBe("medium")

    analytics.stop()
  })

  it("should test tenant and user cost summaries", () => {
    const analytics = createSubscriptionAnalytics()
    analytics.trackSubscription("sub-t1", "q1", "conn-1", {}, ["t1"], "user-a", "tenant-x")
    analytics.trackSubscription("sub-t2", "q2", "conn-2", {}, ["t2"], "user-b", "tenant-x")

    analytics.recordReExecution("sub-t1", 100, 50, 1024, true)
    analytics.recordReExecution("sub-t2", 200, 100, 2048, true)

    const attribution = analytics.getCostAttribution()

    expect(attribution.byUser["user-a"]).toBeDefined()
    expect(attribution.byUser["user-a"].activeSubscriptions).toBe(1)
    expect(attribution.byUser["user-a"].totalCpuTimeMs).toBe(100)

    expect(attribution.byUser["user-b"]).toBeDefined()
    expect(attribution.byUser["user-b"].totalCpuTimeMs).toBe(200)

    expect(attribution.byTenant["tenant-x"]).toBeDefined()
    expect(attribution.byTenant["tenant-x"].activeSubscriptions).toBe(2)
    expect(attribution.byTenant["tenant-x"].totalCpuTimeMs).toBe(300)
    expect(attribution.byTenant["tenant-x"].totalBytesTransferred).toBe(3072)

    analytics.stop()
  })
})
