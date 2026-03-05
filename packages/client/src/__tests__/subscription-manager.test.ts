/**
 * Tests for ReactiveBaseClient (subscription-manager.ts).
 * Mocks ConnectionManager and QueryCache to test message routing,
 * subscription lifecycle, mutations, actions, reconnection, and cleanup.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── Mock ConnectionManager & QueryCache ─────────────────────────────────────

type MessageCallback = (msg: unknown) => void
type StatusCallback = (status: string) => void

let mockConnInstance: {
  messageHandlers: MessageCallback[]
  statusHandlers: StatusCallback[]
  sent: Array<Record<string, unknown>>
  simulateMessage: (msg: Record<string, unknown>) => void
  simulateStatus: (status: string) => void
}

vi.mock("../connection/index.js", () => ({
  ConnectionManager: vi.fn().mockImplementation(() => {
    mockConnInstance = {
      messageHandlers: [],
      statusHandlers: [],
      sent: [],
      simulateMessage(msg: Record<string, unknown>) {
        for (const h of this.messageHandlers) h(msg)
      },
      simulateStatus(status: string) {
        for (const h of this.statusHandlers) h(status)
      },
    }
    return {
      onMessage(handler: MessageCallback) {
        mockConnInstance.messageHandlers.push(handler)
      },
      onStatus(handler: StatusCallback) {
        mockConnInstance.statusHandlers.push(handler)
      },
      connect() {},
      disconnect() {},
      send(msg: Record<string, unknown>) {
        mockConnInstance.sent.push(msg)
      },
    }
  }),
}))

let mockCacheInstance: {
  entries: Map<string, unknown>
  staleAll: boolean
}

vi.mock("../cache/index.js", () => ({
  QueryCache: vi.fn().mockImplementation(() => {
    mockCacheInstance = {
      entries: new Map(),
      staleAll: false,
    }
    return {
      set(id: string, entry: unknown) {
        mockCacheInstance.entries.set(id, entry)
      },
      update(id: string, data: unknown, version: number) {
        mockCacheInstance.entries.set(id, { data, version })
      },
      remove(id: string) {
        mockCacheInstance.entries.delete(id)
      },
      markAllStale() {
        mockCacheInstance.staleAll = true
      },
      clear() {
        mockCacheInstance.entries.clear()
        mockCacheInstance.staleAll = false
      },
    }
  }),
}))

import { ReactiveBaseClient } from "../subscription/subscription-manager.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createClient() {
  const client = new ReactiveBaseClient({ url: "ws://localhost:4000/ws", token: "test-token" })
  return {
    client,
    get conn() {
      return mockConnInstance
    },
    get cache() {
      return mockCacheInstance
    },
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ReactiveBaseClient", () => {
  let client: ReactiveBaseClient
  let conn: typeof mockConnInstance
  let cache: typeof mockCacheInstance

  beforeEach(() => {
    vi.clearAllMocks()
    const created = createClient()
    client = created.client
    conn = created.conn
    cache = created.cache
  })

  // ── subscribe ────────────────────────────────────────────────────────────

  describe("subscribe", () => {
    it("sends subscribe message and returns unsubscribe fn", () => {
      const listener = vi.fn()
      const unsub = client.subscribe("tasks.list", { status: "active" }, listener)

      expect(conn.sent).toEqual([
        expect.objectContaining({
          type: "subscribe",
          queryName: "tasks.list",
          args: { status: "active" },
        }),
      ])
      expect(typeof unsub).toBe("function")
    })

    it("increments subscription IDs", () => {
      client.subscribe("q1", {}, vi.fn())
      client.subscribe("q2", {}, vi.fn())
      expect(conn.sent[0].subscriptionId).toBe("sub_1")
      expect(conn.sent[1].subscriptionId).toBe("sub_2")
    })

    it("notifies listener on subscription_data", () => {
      const listener = vi.fn()
      client.subscribe("tasks", {}, listener)
      const subId = conn.sent[0].subscriptionId as string

      conn.simulateMessage({
        type: "subscription_data",
        subscriptionId: subId,
        data: [{ id: 1 }],
        version: 1,
      })

      expect(listener).toHaveBeenCalledWith([{ id: 1 }], undefined)
    })

    it("unsubscribe sends unsubscribe message and cleans up", () => {
      const listener = vi.fn()
      const unsub = client.subscribe("tasks", {}, listener)
      const subId = conn.sent[0].subscriptionId as string

      unsub()

      expect(conn.sent[1]).toEqual(expect.objectContaining({ type: "unsubscribe", subscriptionId: subId }))
    })

    it("listener not called after unsubscribe", () => {
      const listener = vi.fn()
      const unsub = client.subscribe("tasks", {}, listener)
      const subId = conn.sent[0].subscriptionId as string

      unsub()

      conn.simulateMessage({
        type: "subscription_data",
        subscriptionId: subId,
        data: [{ id: 1 }],
        version: 1,
      })

      expect(listener).not.toHaveBeenCalled()
    })
  })

  // ── mutate ───────────────────────────────────────────────────────────────

  describe("mutate", () => {
    it("sends mutate message and resolves on mutation_result", async () => {
      const promise = client.mutate("tasks.create", { title: "Test" })
      const requestId = conn.sent[0].requestId as string

      expect(conn.sent[0]).toEqual(expect.objectContaining({ type: "mutate", mutationName: "tasks.create" }))

      conn.simulateMessage({ type: "mutation_result", requestId, data: { id: "t1" } })

      const result = await promise
      expect(result).toEqual({ id: "t1" })
    })

    it("rejects on mutation_error", async () => {
      const promise = client.mutate("tasks.create", { title: "fail" })
      const requestId = conn.sent[0].requestId as string

      conn.simulateMessage({
        type: "mutation_error",
        requestId,
        error: { code: "VALIDATION", message: "Title too short" },
      })

      await expect(promise).rejects.toThrow("Title too short")
    })
  })

  // ── runAction ────────────────────────────────────────────────────────────

  describe("runAction", () => {
    it("sends action message and resolves on action_result", async () => {
      const promise = client.runAction("email.send", { to: "test@test.com" })
      const requestId = conn.sent[0].requestId as string

      expect(conn.sent[0].type).toBe("action")

      conn.simulateMessage({ type: "action_result", requestId, data: { sent: true } })

      const result = await promise
      expect(result).toEqual({ sent: true })
    })

    it("rejects on action_error", async () => {
      const promise = client.runAction("email.send", {})
      const requestId = conn.sent[0].requestId as string

      conn.simulateMessage({
        type: "action_error",
        requestId,
        error: { code: "FAILED", message: "Send failed" },
      })

      await expect(promise).rejects.toThrow("Send failed")
    })
  })

  // ── fetchQuery ───────────────────────────────────────────────────────────

  describe("fetchQuery", () => {
    it("subscribes, gets data, then unsubscribes", async () => {
      const promise = client.fetchQuery("tasks.list", { status: "all" })
      const subId = conn.sent[0].subscriptionId as string

      conn.simulateMessage({
        type: "subscription_data",
        subscriptionId: subId,
        data: [{ id: 1 }, { id: 2 }],
        version: 1,
      })

      const result = await promise
      expect(result).toEqual([{ id: 1 }, { id: 2 }])

      // Should have sent unsubscribe
      expect(conn.sent.some((m) => m.type === "unsubscribe")).toBe(true)
    })

    it("rejects on subscription error", async () => {
      const promise = client.fetchQuery("tasks.bad", {})
      const subId = conn.sent[0].subscriptionId as string

      conn.simulateMessage({
        type: "subscription_error",
        subscriptionId: subId,
        error: { code: "NOT_FOUND", message: "Query not found" },
      })

      await expect(promise).rejects.toThrow("Query not found")
    })
  })

  // ── handleMessage routing ────────────────────────────────────────────────

  describe("handleMessage routing", () => {
    it("routes subscription_update to listener", () => {
      const listener = vi.fn()
      client.subscribe("tasks", {}, listener)
      const subId = conn.sent[0].subscriptionId as string

      // Initial data
      conn.simulateMessage({
        type: "subscription_data",
        subscriptionId: subId,
        data: [{ id: 1 }],
        version: 1,
      })

      // Update
      conn.simulateMessage({
        type: "subscription_update",
        subscriptionId: subId,
        data: [{ id: 1 }, { id: 2 }],
        version: 2,
      })

      expect(listener).toHaveBeenCalledTimes(2)
      expect(listener).toHaveBeenLastCalledWith([{ id: 1 }, { id: 2 }], undefined)
    })

    it("routes subscription_error to listener", () => {
      const listener = vi.fn()
      client.subscribe("tasks", {}, listener)
      const subId = conn.sent[0].subscriptionId as string

      conn.simulateMessage({
        type: "subscription_error",
        subscriptionId: subId,
        error: { code: "AUTH", message: "Unauthorized" },
      })

      expect(listener).toHaveBeenCalledWith(undefined, expect.any(Error))
    })

    it("ignores messages for unknown subscription IDs", () => {
      conn.simulateMessage({
        type: "subscription_data",
        subscriptionId: "unknown_sub",
        data: [],
        version: 1,
      })
      // No error thrown
    })

    it("ignores mutation results for unknown request IDs", () => {
      conn.simulateMessage({
        type: "mutation_result",
        requestId: "unknown_req",
        data: {},
      })
      // No error thrown
    })
  })

  // ── reconnection ─────────────────────────────────────────────────────────

  describe("reconnection", () => {
    it("marks cache stale on reconnecting", () => {
      conn.simulateStatus("reconnecting")
      expect(cache.staleAll).toBe(true)
    })

    it("re-subscribes all active subscriptions on connected", () => {
      client.subscribe("q1", { a: 1 }, vi.fn())
      client.subscribe("q2", { b: 2 }, vi.fn())
      const initialSentCount = conn.sent.length

      conn.simulateStatus("connected")

      // Should re-send subscribe messages for both
      const resubscribes = conn.sent.slice(initialSentCount)
      expect(resubscribes.length).toBe(2)
      expect(resubscribes.every((m) => m.type === "subscribe")).toBe(true)
    })

    it("does not re-subscribe removed subscriptions", () => {
      const unsub = client.subscribe("q1", {}, vi.fn())
      client.subscribe("q2", {}, vi.fn())
      unsub()

      const sentBefore = conn.sent.length
      conn.simulateStatus("connected")

      const resubscribes = conn.sent.slice(sentBefore)
      expect(resubscribes.length).toBe(1)
      expect(resubscribes[0].queryName).toBe("q2")
    })
  })

  // ── disconnect ───────────────────────────────────────────────────────────

  describe("disconnect", () => {
    it("clears all state", () => {
      client.subscribe("q1", {}, vi.fn())
      client.disconnect()

      // Cache should be cleared
      expect(cache.entries.size).toBe(0)
    })

    it("listeners not called after disconnect", () => {
      const listener = vi.fn()
      client.subscribe("q1", {}, listener)
      const subId = conn.sent[0].subscriptionId as string

      client.disconnect()

      conn.simulateMessage({
        type: "subscription_data",
        subscriptionId: subId,
        data: [{ id: 1 }],
        version: 1,
      })

      expect(listener).not.toHaveBeenCalled()
    })
  })

  // ── getCache ─────────────────────────────────────────────────────────────

  describe("getCache", () => {
    it("returns the cache instance", () => {
      const c = client.getCache()
      expect(c).toBeDefined()
    })
  })

  // ── Concurrent operations ────────────────────────────────────────────────

  describe("concurrent operations", () => {
    it("handles multiple concurrent mutations", async () => {
      const p1 = client.mutate("m1", { a: 1 })
      const p2 = client.mutate("m2", { b: 2 })

      const reqId1 = conn.sent[0].requestId as string
      const reqId2 = conn.sent[1].requestId as string

      conn.simulateMessage({ type: "mutation_result", requestId: reqId2, data: { r: 2 } })
      conn.simulateMessage({ type: "mutation_result", requestId: reqId1, data: { r: 1 } })

      expect(await p1).toEqual({ r: 1 })
      expect(await p2).toEqual({ r: 2 })
    })

    it("handles subscribe/unsubscribe rapidly", () => {
      const unsubs: Array<() => void> = []
      for (let i = 0; i < 5; i++) {
        unsubs.push(client.subscribe(`q${i}`, {}, vi.fn()))
      }
      for (const unsub of unsubs) {
        unsub()
      }
      // All subscribes and unsubscribes sent
      expect(conn.sent.filter((m) => m.type === "subscribe").length).toBe(5)
      expect(conn.sent.filter((m) => m.type === "unsubscribe").length).toBe(5)
    })
  })
})
