import { describe, it, expect, vi, beforeEach } from "vitest"
import { DevToolsInstrumentation } from "../devtools/devtools.js"
import type { DevToolsEvent } from "../devtools/devtools.js"

describe("DevToolsInstrumentation", () => {
  let devtools: DevToolsInstrumentation

  beforeEach(() => {
    devtools = new DevToolsInstrumentation({ maxEvents: 50, maxMutations: 20 })
  })

  describe("subscription tracking", () => {
    it("tracks new subscriptions", () => {
      devtools.trackSubscription("sub_1", { queryName: "tasks.list", args: {} })
      const subs = devtools.getSubscriptions()
      expect(subs).toHaveLength(1)
      expect(subs[0].queryName).toBe("tasks.list")
      expect(subs[0].status).toBe("pending")
    })

    it("updates subscription data", () => {
      devtools.trackSubscription("sub_1", { queryName: "tasks.list", args: {} })
      devtools.updateSubscription("sub_1", [{ id: "t1" }], 15)

      const subs = devtools.getSubscriptions()
      expect(subs[0].status).toBe("active")
      expect(subs[0].updateCount).toBe(1)
      expect(subs[0].latencyMs).toBe(15)
    })

    it("removes subscriptions", () => {
      devtools.trackSubscription("sub_1", { queryName: "tasks.list", args: {} })
      devtools.removeSubscription("sub_1")
      expect(devtools.getSubscriptions()).toHaveLength(0)
    })
  })

  describe("mutation tracking", () => {
    it("tracks mutations", () => {
      devtools.trackMutation("m_1", { name: "tasks.complete", args: { id: "1" } })
      const mutations = devtools.getMutations()
      expect(mutations).toHaveLength(1)
      expect(mutations[0].status).toBe("pending")
    })

    it("completes mutations with duration", () => {
      devtools.trackMutation("m_1", { name: "tasks.complete", args: {} })
      devtools.completeMutation("m_1")

      const mutations = devtools.getMutations()
      expect(mutations[0].status).toBe("completed")
      expect(mutations[0].durationMs).toBeDefined()
    })

    it("tracks failed mutations", () => {
      devtools.trackMutation("m_1", { name: "tasks.complete", args: {} })
      devtools.failMutation("m_1", "Network error")

      const mutations = devtools.getMutations()
      expect(mutations[0].status).toBe("failed")
      expect(mutations[0].error).toBe("Network error")
    })

    it("generates mutation timeline", () => {
      devtools.trackMutation("m_1", { name: "a", args: {} })
      devtools.trackMutation("m_2", { name: "b", args: {} })
      devtools.completeMutation("m_1")

      const timeline = devtools.getMutationTimeline()
      expect(timeline).toHaveLength(2)
    })

    it("limits mutation history", () => {
      for (let i = 0; i < 30; i++) {
        devtools.trackMutation(`m_${i}`, { name: `mutation_${i}`, args: {} })
      }
      expect(devtools.getMutations().length).toBeLessThanOrEqual(20)
    })
  })

  describe("cache tracking", () => {
    it("tracks cache hits and misses", () => {
      devtools.trackCacheHit("tasks.list")
      devtools.trackCacheHit("tasks.list")
      devtools.trackCacheMiss("tasks.get")

      const stats = devtools.getCacheStats()
      expect(stats.hitCount).toBe(2)
      expect(stats.missCount).toBe(1)
      expect(stats.hitRate).toBeCloseTo(2 / 3, 2)
    })

    it("updates cache size stats", () => {
      devtools.updateCacheStats(42, 1024)
      const stats = devtools.getCacheStats()
      expect(stats.entries).toBe(42)
      expect(stats.totalSizeEstimate).toBe(1024)
    })
  })

  describe("WebSocket tracking", () => {
    it("tracks messages sent and received", () => {
      devtools.trackWsMessageSent(256)
      devtools.trackWsMessageReceived(512)

      const stats = devtools.getWsStats()
      expect(stats.messagesSent).toBe(1)
      expect(stats.messagesReceived).toBe(1)
      expect(stats.bytesSent).toBe(256)
      expect(stats.bytesReceived).toBe(512)
    })

    it("tracks connection status", () => {
      devtools.trackWsConnected()
      expect(devtools.getWsStats().status).toBe("connected")

      devtools.trackWsDisconnected()
      expect(devtools.getWsStats().status).toBe("disconnected")
      expect(devtools.getWsStats().reconnectCount).toBe(1)
    })

    it("tracks connection uptime", async () => {
      devtools.trackWsConnected()
      await new Promise((r) => setTimeout(r, 50))
      const stats = devtools.getWsStats()
      expect(stats.connectionUptime).toBeGreaterThan(0)
    })
  })

  describe("optimistic tracking", () => {
    it("emits optimistic events", () => {
      const events: DevToolsEvent[] = []
      devtools.onEvent((e) => events.push(e))

      devtools.trackOptimisticApplied("m_1", "sub_1")
      devtools.trackOptimisticConfirmed("m_1")

      expect(events.some((e) => e.type === "optimistic:applied")).toBe(true)
      expect(events.some((e) => e.type === "optimistic:confirmed")).toBe(true)
    })

    it("tracks rollback", () => {
      const events: DevToolsEvent[] = []
      devtools.onEvent((e) => events.push(e))

      devtools.trackOptimisticRolledback("m_1")
      expect(events.some((e) => e.type === "optimistic:rolledback")).toBe(true)
    })
  })

  describe("event system", () => {
    it("emits events to listeners", () => {
      const received: DevToolsEvent[] = []
      devtools.onEvent((e) => received.push(e))

      devtools.trackSubscription("sub_1", { queryName: "test", args: {} })
      expect(received).toHaveLength(1)
      expect(received[0].type).toBe("subscription:created")
    })

    it("unsubscribes from events", () => {
      const received: DevToolsEvent[] = []
      const unsub = devtools.onEvent((e) => received.push(e))

      devtools.trackSubscription("sub_1", { queryName: "test", args: {} })
      unsub()
      devtools.trackSubscription("sub_2", { queryName: "test2", args: {} })

      expect(received).toHaveLength(1)
    })

    it("limits event history", () => {
      for (let i = 0; i < 100; i++) {
        devtools.trackCacheHit(`query_${i}`)
      }
      expect(devtools.getEvents().length).toBeLessThanOrEqual(50)
    })
  })

  describe("performance snapshots", () => {
    it("takes manual snapshot", () => {
      devtools.trackSubscription("sub_1", { queryName: "test", args: {} })
      const snapshot = devtools.takeSnapshot()

      expect(snapshot.subscriptions).toHaveLength(1)
      expect(snapshot.cache).toBeDefined()
      expect(snapshot.websocket).toBeDefined()
    })

    it("stores snapshot history", () => {
      devtools.takeSnapshot()
      devtools.takeSnapshot()
      expect(devtools.getSnapshots()).toHaveLength(2)
    })
  })

  describe("summary", () => {
    it("provides summary stats", () => {
      devtools.trackSubscription("sub_1", { queryName: "test", args: {} })
      devtools.trackMutation("m_1", { name: "test", args: {} })
      devtools.completeMutation("m_1")
      devtools.trackCacheHit("test")

      const summary = devtools.getSummary()
      expect(summary.activeSubscriptions).toBe(1)
      expect(summary.completedMutations).toBe(1)
      expect(summary.pendingMutations).toBe(0)
    })
  })

  describe("reset & destroy", () => {
    it("resets all data", () => {
      devtools.trackSubscription("sub_1", { queryName: "test", args: {} })
      devtools.trackMutation("m_1", { name: "test", args: {} })
      devtools.reset()

      expect(devtools.getSubscriptions()).toHaveLength(0)
      expect(devtools.getMutations()).toHaveLength(0)
      expect(devtools.getEvents()).toHaveLength(0)
    })

    it("destroys and stops monitoring", () => {
      devtools.startPerformanceMonitoring()
      devtools.destroy()
      expect(devtools.getSubscriptions()).toHaveLength(0)
    })
  })
})
