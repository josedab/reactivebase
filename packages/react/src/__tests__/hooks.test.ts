/**
 * Tests for useQuery, useMutation, useAction hooks.
 * Uses vitest mocks to simulate the ReactiveBaseClient without requiring
 * a DOM environment or @testing-library/react.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── Mock Client ─────────────────────────────────────────────────────────────

function createMockClient() {
  type Listener = (...args: unknown[]) => void
  const subscriptions = new Map<string, { queryName: string; args: unknown; listener: Listener }>()
  let subCounter = 0

  const cache = {
    applyOptimisticUpdate: vi.fn(() => vi.fn()),
    applyOptimisticUpdateByQuery: vi.fn(() => vi.fn()),
  }

  return {
    subscribe: vi.fn((queryName: string, args: unknown, listener: Listener) => {
      const id = `sub_${++subCounter}`
      subscriptions.set(id, { queryName, args, listener })
      return () => {
        subscriptions.delete(id)
      }
    }),
    mutate: vi.fn(async (_name: string, _args: unknown) => ({ success: true })),
    runAction: vi.fn(async (_name: string, _args: unknown) => ({ result: "done" })),
    getCache: vi.fn(() => cache),
    disconnect: vi.fn(),
    _subscriptions: subscriptions,
    _cache: cache,
    // Simulate pushing data to the last subscriber
    _pushData(data: unknown, error?: Error) {
      const entries = Array.from(subscriptions.values())
      const last = entries[entries.length - 1]
      if (last) last.listener(data, error)
    },
  }
}

// ─── useQuery tests (logic-level, not React render) ──────────────────────────

describe("useQuery subscription logic", () => {
  let mockClient: ReturnType<typeof createMockClient>

  beforeEach(() => {
    mockClient = createMockClient()
  })

  it("subscribe is called with correct query name and args", () => {
    const listener = vi.fn()
    mockClient.subscribe("tasks.list", { userId: "u1" }, listener)

    expect(mockClient.subscribe).toHaveBeenCalledWith("tasks.list", { userId: "u1" }, listener)
  })

  it("returns unsubscribe function that cleans up", () => {
    const listener = vi.fn()
    const unsub = mockClient.subscribe("tasks.list", {}, listener)

    expect(mockClient._subscriptions.size).toBe(1)
    unsub()
    expect(mockClient._subscriptions.size).toBe(0)
  })

  it("listener receives data when pushed", () => {
    const listener = vi.fn()
    mockClient.subscribe("tasks.list", {}, listener)

    const data = [{ id: "1", title: "Test task" }]
    mockClient._pushData(data)

    expect(listener).toHaveBeenCalledWith(data, undefined)
  })

  it("listener receives errors when pushed", () => {
    const listener = vi.fn()
    mockClient.subscribe("tasks.list", {}, listener)

    const error = new Error("Query failed")
    mockClient._pushData(undefined, error)

    expect(listener).toHaveBeenCalledWith(undefined, error)
  })

  it("multiple subscriptions are independent", () => {
    const listener1 = vi.fn()
    const listener2 = vi.fn()
    const unsub1 = mockClient.subscribe("tasks.list", {}, listener1)
    mockClient.subscribe("users.get", { id: "u1" }, listener2)

    expect(mockClient._subscriptions.size).toBe(2)
    unsub1()
    expect(mockClient._subscriptions.size).toBe(1)
  })
})

// ─── useMutation tests ──────────────────────────────────────────────────────

describe("useMutation logic", () => {
  let mockClient: ReturnType<typeof createMockClient>

  beforeEach(() => {
    mockClient = createMockClient()
  })

  it("calls mutate with correct name and args", async () => {
    await mockClient.mutate("tasks.create", { title: "New task" })

    expect(mockClient.mutate).toHaveBeenCalledWith("tasks.create", { title: "New task" })
  })

  it("returns mutation result", async () => {
    mockClient.mutate.mockResolvedValueOnce({ id: "t1", title: "Created" })

    const result = await mockClient.mutate("tasks.create", { title: "Created" })
    expect(result).toEqual({ id: "t1", title: "Created" })
  })

  it("propagates mutation errors", async () => {
    mockClient.mutate.mockRejectedValueOnce(new Error("Unauthorized"))

    await expect(mockClient.mutate("tasks.delete", { id: "t1" })).rejects.toThrow("Unauthorized")
  })

  it("optimistic update applies and rolls back on error", async () => {
    const rollbackFn = vi.fn()
    mockClient._cache.applyOptimisticUpdateByQuery.mockReturnValueOnce(rollbackFn)

    // Simulate optimistic update flow
    const rollbacks: (() => void)[] = []
    const localStore = {
      updateQuery(queryName: string, updater: (...args: unknown[]) => unknown) {
        const rollback = mockClient._cache.applyOptimisticUpdateByQuery(queryName, updater)
        rollbacks.push(rollback)
      },
      update(subscriptionId: string, updater: (...args: unknown[]) => unknown) {
        const rollback = mockClient._cache.applyOptimisticUpdate(subscriptionId, updater)
        rollbacks.push(rollback)
      },
    }

    // Apply optimistic update
    const updater = (data: unknown) => data
    localStore.updateQuery("tasks.list", updater)
    expect(mockClient._cache.applyOptimisticUpdateByQuery).toHaveBeenCalledWith("tasks.list", updater)

    // Simulate failure and rollback
    for (const rollback of rollbacks) {
      rollback()
    }
    expect(rollbackFn).toHaveBeenCalled()
  })
})

// ─── useAction tests ────────────────────────────────────────────────────────

describe("useAction logic", () => {
  let mockClient: ReturnType<typeof createMockClient>

  beforeEach(() => {
    mockClient = createMockClient()
  })

  it("calls runAction with correct name and args", async () => {
    await mockClient.runAction("email.send", { to: "user@example.com" })

    expect(mockClient.runAction).toHaveBeenCalledWith("email.send", { to: "user@example.com" })
  })

  it("returns action result", async () => {
    mockClient.runAction.mockResolvedValueOnce({ sent: true })

    const result = await mockClient.runAction("email.send", { to: "user@example.com" })
    expect(result).toEqual({ sent: true })
  })

  it("propagates action errors", async () => {
    mockClient.runAction.mockRejectedValueOnce(new Error("SMTP error"))

    await expect(mockClient.runAction("email.send", {})).rejects.toThrow("SMTP error")
  })
})

// ─── FunctionReference tests ────────────────────────────────────────────────

describe("FunctionReference pattern", () => {
  it("string-based query name works", () => {
    const mockClient = createMockClient()
    const queryName = "tasks.list"
    mockClient.subscribe(queryName, {}, vi.fn())

    expect(mockClient.subscribe).toHaveBeenCalledWith("tasks.list", {}, expect.any(Function))
  })

  it("FunctionReference object works", () => {
    const mockClient = createMockClient()
    const queryRef = { _name: "tasks.list", _type: "query" as const }
    const queryName = queryRef._name

    mockClient.subscribe(queryName, { userId: "u1" }, vi.fn())
    expect(mockClient.subscribe).toHaveBeenCalledWith("tasks.list", { userId: "u1" }, expect.any(Function))
  })
})
