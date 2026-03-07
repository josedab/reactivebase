import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  SubscriptionBridge,
  SubscriptionBridgeError,
  type SubscriptionBridgeOptions,
  type ChangeEvent,
} from "../subscription-bridge.js"
import type { ReactivityMapping } from "../schema-compiler.js"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReactivityMap(): Record<string, ReactivityMapping> {
  return {
    onTaskChanged: {
      subscriptionField: "onTaskChanged",
      tableName: "tasks",
      watchedColumns: "*",
      granularity: "row",
    },
    onTaskList: {
      subscriptionField: "onTaskList",
      tableName: "tasks",
      watchedColumns: "*",
      granularity: "collection",
    },
    onTaskFieldChanged: {
      subscriptionField: "onTaskFieldChanged",
      tableName: "tasks",
      watchedColumns: ["title", "done"],
      granularity: "field",
    },
    onUserChanged: {
      subscriptionField: "onUserChanged",
      tableName: "users",
      watchedColumns: "*",
      granularity: "row",
    },
  }
}

function makeBridge(opts: Partial<SubscriptionBridgeOptions> = {}): SubscriptionBridge {
  return new SubscriptionBridge({
    reactivityMap: makeReactivityMap(),
    debounceMs: 0, // immediate delivery for tests
    heartbeatIntervalMs: 60_000,
    ...opts,
  })
}

function makeChange(overrides: Partial<ChangeEvent> = {}): ChangeEvent {
  return {
    table: "tasks",
    type: "update",
    rowId: "t1",
    data: { id: "t1", title: "Updated", done: false },
    changedColumns: ["title"],
    timestamp: Date.now(),
    ...overrides,
  }
}

// ── Connection Management ───────────────────────────────────────────────────

describe("SubscriptionBridge", () => {
  let bridge: SubscriptionBridge

  beforeEach(() => {
    bridge = makeBridge()
  })

  afterEach(() => {
    bridge.destroy()
  })

  describe("connection management", () => {
    it("adds a connection", () => {
      const conn = bridge.addConnection("conn-1")
      expect(conn.id).toBe("conn-1")
      expect(conn.authenticated).toBe(false)
      expect(conn.subscriptionIds.size).toBe(0)
    })

    it("authenticates a connection", () => {
      bridge.addConnection("conn-1")
      const result = bridge.authenticateConnection("conn-1", { userId: "u1" })
      expect(result).toBe(true)
    })

    it("returns false for authenticating unknown connection", () => {
      expect(bridge.authenticateConnection("unknown")).toBe(false)
    })

    it("removes connection and cleans up subscriptions", () => {
      bridge.addConnection("conn-1")
      bridge.subscribe("sub-1", "conn-1", "onTaskChanged")
      bridge.removeConnection("conn-1")
      const stats = bridge.getStats()
      expect(stats.totalConnections).toBe(0)
      expect(stats.totalSubscriptions).toBe(0)
    })
  })

  // ── Subscription Lifecycle ──────────────────────────────────────────────────

  describe("subscribe", () => {
    it("creates a subscription with correct metadata", () => {
      bridge.addConnection("conn-1")
      const entry = bridge.subscribe("sub-1", "conn-1", "onTaskChanged", { where: { done: false } })
      expect(entry.id).toBe("sub-1")
      expect(entry.field).toBe("onTaskChanged")
      expect(entry.active).toBe(true)
      expect(entry.eventCount).toBe(0)
    })

    it("throws for unknown connection", () => {
      expect(() => bridge.subscribe("sub-1", "unknown", "onTaskChanged")).toThrow(SubscriptionBridgeError)
    })

    it("throws for unknown subscription field", () => {
      bridge.addConnection("conn-1")
      expect(() => bridge.subscribe("sub-1", "conn-1", "nonexistent")).toThrow(SubscriptionBridgeError)
    })

    it("throws when max subscriptions exceeded", () => {
      const limitedBridge = makeBridge({ maxSubscriptionsPerConnection: 1 })
      limitedBridge.addConnection("conn-1")
      limitedBridge.subscribe("sub-1", "conn-1", "onTaskChanged")
      expect(() => limitedBridge.subscribe("sub-2", "conn-1", "onTaskList")).toThrow(SubscriptionBridgeError)
      limitedBridge.destroy()
    })

    it("initial data delivery via callback", () => {
      bridge.addConnection("conn-1")
      bridge.subscribe("sub-1", "conn-1", "onTaskChanged")
      const callback = vi.fn()
      bridge.onEvent("sub-1", callback)

      bridge.pushChangeImmediate(makeChange())
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback.mock.calls[0][0].subscriptionId).toBe("sub-1")
    })
  })

  // ── Data Change Propagation ─────────────────────────────────────────────────

  describe("change propagation", () => {
    it("delivers changes to subscribers", () => {
      bridge.addConnection("conn-1")
      bridge.subscribe("sub-1", "conn-1", "onTaskChanged")
      const callback = vi.fn()
      bridge.onEvent("sub-1", callback)

      bridge.pushChangeImmediate(makeChange())
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback.mock.calls[0][0].field).toBe("onTaskChanged")
      expect(callback.mock.calls[0][0].data).toHaveProperty("title", "Updated")
    })

    it("does not deliver changes to unrelated subscriptions", () => {
      bridge.addConnection("conn-1")
      bridge.subscribe("sub-1", "conn-1", "onUserChanged")
      const callback = vi.fn()
      bridge.onEvent("sub-1", callback)

      bridge.pushChangeImmediate(makeChange({ table: "tasks" }))
      expect(callback).not.toHaveBeenCalled()
    })

    it("per-field filtering only delivers relevant column changes", () => {
      bridge.addConnection("conn-1")
      bridge.subscribe("sub-1", "conn-1", "onTaskFieldChanged", { fields: ["title"] })
      const callback = vi.fn()
      bridge.onEvent("sub-1", callback)

      // Change to "done" column - should not trigger since we only watch "title"
      bridge.pushChangeImmediate(makeChange({ changedColumns: ["done"] }))
      expect(callback).not.toHaveBeenCalled()

      // Change to "title" column - should trigger
      bridge.pushChangeImmediate(makeChange({ changedColumns: ["title"] }))
      expect(callback).toHaveBeenCalledTimes(1)
    })

    it("where clause filtering works", () => {
      bridge.addConnection("conn-1")
      bridge.subscribe("sub-1", "conn-1", "onTaskChanged", { where: { done: true } })
      const callback = vi.fn()
      bridge.onEvent("sub-1", callback)

      // Change with done: false - should not match
      bridge.pushChangeImmediate(makeChange({ data: { id: "t1", done: false } }))
      expect(callback).not.toHaveBeenCalled()

      // Change with done: true - should match
      bridge.pushChangeImmediate(makeChange({ data: { id: "t1", done: true } }))
      expect(callback).toHaveBeenCalledTimes(1)
    })
  })

  // ── Unsubscribe ─────────────────────────────────────────────────────────────

  describe("unsubscribe", () => {
    it("stops delivering events after unsubscribe", () => {
      bridge.addConnection("conn-1")
      bridge.subscribe("sub-1", "conn-1", "onTaskChanged")
      const callback = vi.fn()
      bridge.onEvent("sub-1", callback)

      bridge.pushChangeImmediate(makeChange())
      expect(callback).toHaveBeenCalledTimes(1)

      bridge.unsubscribe("sub-1")
      bridge.pushChangeImmediate(makeChange())
      expect(callback).toHaveBeenCalledTimes(1) // no additional call
    })

    it("unsubscribing non-existent subscription is a no-op", () => {
      expect(() => bridge.unsubscribe("nonexistent")).not.toThrow()
    })

    it("cleans up from connection and table index", () => {
      bridge.addConnection("conn-1")
      bridge.subscribe("sub-1", "conn-1", "onTaskChanged")
      bridge.unsubscribe("sub-1")
      expect(bridge.getTableSubscriptions("tasks")).toHaveLength(0)
    })
  })

  // ── Multiple Concurrent Subscriptions ─────────────────────────────────────

  describe("concurrent subscriptions", () => {
    it("independent subscriptions receive their own events", () => {
      bridge.addConnection("conn-1")
      bridge.addConnection("conn-2")
      bridge.subscribe("sub-1", "conn-1", "onTaskChanged")
      bridge.subscribe("sub-2", "conn-2", "onTaskChanged")

      const cb1 = vi.fn()
      const cb2 = vi.fn()
      bridge.onEvent("sub-1", cb1)
      bridge.onEvent("sub-2", cb2)

      bridge.pushChangeImmediate(makeChange())
      expect(cb1).toHaveBeenCalledTimes(1)
      expect(cb2).toHaveBeenCalledTimes(1)
    })

    it("unsubscribing one does not affect others", () => {
      bridge.addConnection("conn-1")
      bridge.subscribe("sub-1", "conn-1", "onTaskChanged")
      bridge.subscribe("sub-2", "conn-1", "onTaskList")

      const cb1 = vi.fn()
      const cb2 = vi.fn()
      bridge.onEvent("sub-1", cb1)
      bridge.onEvent("sub-2", cb2)

      bridge.unsubscribe("sub-1")
      bridge.pushChangeImmediate(makeChange())
      expect(cb1).not.toHaveBeenCalled()
      expect(cb2).toHaveBeenCalledTimes(1)
    })
  })

  // ── Batched Updates ───────────────────────────────────────────────────────

  describe("batched updates", () => {
    it("pushChange batches and delivers after debounce", async () => {
      const batchBridge = makeBridge({ debounceMs: 20 })
      batchBridge.addConnection("conn-1")
      batchBridge.subscribe("sub-1", "conn-1", "onTaskChanged")
      const callback = vi.fn()
      batchBridge.onEvent("sub-1", callback)

      batchBridge.pushChange(makeChange())
      batchBridge.pushChange(makeChange({ rowId: "t2" }))

      // Not delivered yet
      expect(callback).not.toHaveBeenCalled()

      // Wait for debounce
      await new Promise((r) => setTimeout(r, 50))
      expect(callback).toHaveBeenCalledTimes(2)

      batchBridge.destroy()
    })
  })

  // ── Backpressure ──────────────────────────────────────────────────────────

  describe("backpressure handling", () => {
    it("listener errors do not break event delivery", () => {
      bridge.addConnection("conn-1")
      bridge.subscribe("sub-1", "conn-1", "onTaskChanged")

      const badCb = vi.fn().mockImplementation(() => {
        throw new Error("slow consumer")
      })
      const goodCb = vi.fn()
      bridge.onEvent("sub-1", badCb)
      bridge.onEvent("sub-1", goodCb)

      bridge.pushChangeImmediate(makeChange())
      expect(badCb).toHaveBeenCalledTimes(1)
      expect(goodCb).toHaveBeenCalledTimes(1)
    })
  })

  // ── Disconnect Cleanup ────────────────────────────────────────────────────

  describe("disconnect cleanup", () => {
    it("removeConnection tears down all subscriptions", () => {
      bridge.addConnection("conn-1")
      bridge.subscribe("sub-1", "conn-1", "onTaskChanged")
      bridge.subscribe("sub-2", "conn-1", "onTaskList")
      const callback = vi.fn()
      bridge.onEvent("sub-1", callback)

      bridge.removeConnection("conn-1")
      bridge.pushChangeImmediate(makeChange())
      expect(callback).not.toHaveBeenCalled()
      expect(bridge.getStats().totalSubscriptions).toBe(0)
    })

    it("destroy cleans everything", () => {
      bridge.addConnection("conn-1")
      bridge.subscribe("sub-1", "conn-1", "onTaskChanged")
      bridge.destroy()
      expect(bridge.getStats().totalConnections).toBe(0)
      expect(bridge.getStats().totalSubscriptions).toBe(0)
    })
  })

  // ── Event Listener Unsubscribe ────────────────────────────────────────────

  describe("event listener unsubscribe", () => {
    it("onEvent returns unsubscribe function", () => {
      bridge.addConnection("conn-1")
      bridge.subscribe("sub-1", "conn-1", "onTaskChanged")
      const callback = vi.fn()
      const unsub = bridge.onEvent("sub-1", callback)

      bridge.pushChangeImmediate(makeChange())
      expect(callback).toHaveBeenCalledTimes(1)

      unsub()
      bridge.pushChangeImmediate(makeChange())
      expect(callback).toHaveBeenCalledTimes(1) // not called again
    })
  })

  // ── Stats ─────────────────────────────────────────────────────────────────

  describe("getStats", () => {
    it("tracks connection and subscription counts", () => {
      bridge.addConnection("conn-1")
      bridge.subscribe("sub-1", "conn-1", "onTaskChanged")
      const stats = bridge.getStats()
      expect(stats.totalConnections).toBe(1)
      expect(stats.totalSubscriptions).toBe(1)
      expect(stats.activeSubscriptions).toBe(1)
    })

    it("tracks events delivered", () => {
      bridge.addConnection("conn-1")
      bridge.subscribe("sub-1", "conn-1", "onTaskChanged")
      bridge.onEvent("sub-1", () => {})
      bridge.pushChangeImmediate(makeChange())
      expect(bridge.getStats().totalEventsDelivered).toBe(1)
    })

    it("tracks entry event count", () => {
      bridge.addConnection("conn-1")
      bridge.subscribe("sub-1", "conn-1", "onTaskChanged")
      bridge.onEvent("sub-1", () => {})
      bridge.pushChangeImmediate(makeChange())
      // Re-read from getTableSubscriptions to get updated entry
      const subs = bridge.getTableSubscriptions("tasks")
      expect(subs[0].eventCount).toBe(1)
      expect(subs[0].lastEventAt).not.toBeNull()
    })
  })

  // ── Table Subscriptions ───────────────────────────────────────────────────

  describe("getTableSubscriptions", () => {
    it("returns subscriptions for a specific table", () => {
      bridge.addConnection("conn-1")
      bridge.subscribe("sub-1", "conn-1", "onTaskChanged")
      bridge.subscribe("sub-2", "conn-1", "onUserChanged")
      expect(bridge.getTableSubscriptions("tasks")).toHaveLength(1)
      expect(bridge.getTableSubscriptions("users")).toHaveLength(1)
    })

    it("returns empty array for table with no subscriptions", () => {
      expect(bridge.getTableSubscriptions("nonexistent")).toEqual([])
    })
  })
})

// ── SubscriptionBridgeError ─────────────────────────────────────────────────

describe("SubscriptionBridgeError", () => {
  it("has correct name", () => {
    const err = new SubscriptionBridgeError("test")
    expect(err.name).toBe("SubscriptionBridgeError")
    expect(err).toBeInstanceOf(Error)
  })
})
