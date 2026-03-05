/**
 * Comprehensive unit tests for ReactiveStore, QueryHandle, SelectorHandle,
 * MutationHandle, and CombinedSelector.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"
import { ReactiveStore } from "../index.js"
import type { StateClientAdapter, MutationState } from "../index.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockClient(): StateClientAdapter & {
  _callbacks: Map<string, (data: unknown, error?: Error) => void>
  _pushData(queryName: string, data: unknown): void
  _pushError(queryName: string, error: Error): void
  mutate: Mock<(name: string, args: unknown) => Promise<unknown>>
} {
  const callbacks = new Map<string, (data: unknown, error?: Error) => void>()
  return {
    _callbacks: callbacks,
    subscribe: vi.fn((queryName: string, _args: unknown, callback: (data: unknown, error?: Error) => void) => {
      const key = `${queryName}:${JSON.stringify(_args)}`
      callbacks.set(key, callback)
      return () => {
        callbacks.delete(key)
      }
    }),
    mutate: vi.fn(async (_name: string, _args: unknown) => ({ success: true })),
    _pushData(queryName: string, data: unknown) {
      for (const [key, cb] of callbacks) {
        if (key.startsWith(queryName + ":")) cb(data)
      }
    },
    _pushError(queryName: string, error: Error) {
      for (const [key, cb] of callbacks) {
        if (key.startsWith(queryName + ":")) cb(undefined, error)
      }
    },
  }
}

// ─── ReactiveStore ───────────────────────────────────────────────────────────

describe("ReactiveStore", () => {
  let client: ReturnType<typeof createMockClient>
  let store: ReactiveStore

  beforeEach(() => {
    client = createMockClient()
    store = new ReactiveStore(client)
  })

  describe("constructor", () => {
    it("creates store with default options", () => {
      expect(store).toBeInstanceOf(ReactiveStore)
    })

    it("accepts custom options", () => {
      const s = new ReactiveStore(client, { autoSubscribe: false, dedupeMs: 200 })
      expect(s).toBeInstanceOf(ReactiveStore)
    })
  })

  describe("query", () => {
    it("creates a query handle that subscribes to the client", () => {
      store.query("tasks.list", { status: "active" })
      expect(client.subscribe).toHaveBeenCalledWith("tasks.list", { status: "active" }, expect.any(Function))
    })

    it("returns initial loading state", () => {
      const handle = store.query("tasks.list")
      const state = handle.get()
      expect(state.isLoading).toBe(true)
      expect(state.data).toBeUndefined()
      expect(state.error).toBeNull()
      expect(state.isLive).toBe(false)
      expect(state.lastUpdatedAt).toBeNull()
      expect(state.updateCount).toBe(0)
    })

    it("deduplicates identical queries", () => {
      const h1 = store.query("tasks.list", { status: "active" })
      const h2 = store.query("tasks.list", { status: "active" })
      expect(h1).toBe(h2)
      expect(client.subscribe).toHaveBeenCalledTimes(1)
    })

    it("creates separate handles for different args", () => {
      const h1 = store.query("tasks.list", { status: "active" })
      const h2 = store.query("tasks.list", { status: "done" })
      expect(h1).not.toBe(h2)
      expect(client.subscribe).toHaveBeenCalledTimes(2)
    })

    it("updates state when data arrives", () => {
      const handle = store.query("tasks.list")
      client._pushData("tasks.list", [{ id: "1" }])

      const state = handle.get()
      expect(state.data).toEqual([{ id: "1" }])
      expect(state.isLoading).toBe(false)
      expect(state.isLive).toBe(true)
      expect(state.error).toBeNull()
      expect(state.updateCount).toBe(1)
      expect(state.lastUpdatedAt).toBeGreaterThan(0)
    })

    it("updates state when error arrives", () => {
      const handle = store.query("tasks.list")
      client._pushError("tasks.list", new Error("Network error"))

      const state = handle.get()
      expect(state.error).toBeInstanceOf(Error)
      expect(state.error!.message).toBe("Network error")
      expect(state.isLoading).toBe(false)
    })

    it("increments updateCount on each data push", () => {
      const handle = store.query("tasks.list")
      client._pushData("tasks.list", [1])
      client._pushData("tasks.list", [2])
      client._pushData("tasks.list", [3])
      expect(handle.get().updateCount).toBe(3)
    })
  })

  describe("query subscribe", () => {
    it("emits current state immediately to new subscribers", () => {
      const handle = store.query("tasks.list")
      const listener = vi.fn()
      handle.subscribe(listener)
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ isLoading: true }))
    })

    it("notifies subscribers on data updates", () => {
      const handle = store.query("tasks.list")
      const listener = vi.fn()
      handle.subscribe(listener)
      listener.mockClear()

      client._pushData("tasks.list", [{ id: "1" }])
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ data: [{ id: "1" }] }))
    })

    it("returns unsubscribe function that stops notifications", () => {
      const handle = store.query("tasks.list")
      const listener = vi.fn()
      const unsub = handle.subscribe(listener)
      listener.mockClear()

      unsub()
      client._pushData("tasks.list", [{ id: "1" }])
      expect(listener).not.toHaveBeenCalled()
    })

    it("supports multiple independent subscribers", () => {
      const handle = store.query("tasks.list")
      const listener1 = vi.fn()
      const listener2 = vi.fn()
      handle.subscribe(listener1)
      handle.subscribe(listener2)
      listener1.mockClear()
      listener2.mockClear()

      client._pushData("tasks.list", "data")
      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)
    })
  })

  describe("query refresh", () => {
    it("sets isLoading and re-subscribes", () => {
      const handle = store.query("tasks.list")
      client._pushData("tasks.list", [1])
      expect(handle.get().isLoading).toBe(false)

      handle.refresh()
      expect(handle.get().isLoading).toBe(true)
      // Should have unsubscribed and resubscribed
      expect(client.subscribe).toHaveBeenCalledTimes(2)
    })
  })

  describe("query destroy", () => {
    it("clears listeners and unsubscribes from client", () => {
      const handle = store.query("tasks.list")
      const listener = vi.fn()
      handle.subscribe(listener)
      listener.mockClear()

      handle.destroy()
      client._pushData("tasks.list", "new-data")
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe("query with autoSubscribe=false", () => {
    it("does not subscribe to client on creation", () => {
      const s = new ReactiveStore(client, { autoSubscribe: false })
      s.query("tasks.list")
      expect(client.subscribe).not.toHaveBeenCalled()
    })
  })

  describe("select", () => {
    it("derives a value from a query", () => {
      const handle = store.query<number[]>("tasks.list")
      const selector = store.select(handle, (data) => data.length)

      client._pushData("tasks.list", [1, 2, 3])
      expect(selector.get()).toBe(3)
    })

    it("returns undefined when query has no data", () => {
      const handle = store.query<number[]>("tasks.list")
      const selector = store.select(handle, (data) => data.length)
      expect(selector.get()).toBeUndefined()
    })

    it("notifies subscribers when derived value changes", () => {
      const handle = store.query<number[]>("tasks.list")
      const selector = store.select(handle, (data) => data.length)
      const listener = vi.fn()
      selector.subscribe(listener)
      listener.mockClear()

      client._pushData("tasks.list", [1, 2])
      expect(listener).toHaveBeenCalledWith(2)
    })

    it("does not notify when derived value is unchanged", () => {
      const handle = store.query<number[]>("tasks.list")
      const selector = store.select(handle, (data) => data.length)
      const listener = vi.fn()

      client._pushData("tasks.list", [1, 2])
      selector.subscribe(listener)
      listener.mockClear()

      // Push different array but same length
      client._pushData("tasks.list", [3, 4])
      expect(listener).not.toHaveBeenCalled()
    })

    it("destroy stops notifications", () => {
      const handle = store.query<number[]>("tasks.list")
      const selector = store.select(handle, (data) => data.length)
      const listener = vi.fn()
      selector.subscribe(listener)
      listener.mockClear()

      selector.destroy()
      client._pushData("tasks.list", [1])
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe("combine", () => {
    it("combines multiple queries", () => {
      const q1 = store.query<number>("count")
      const q2 = store.query<string>("label")

      const combined = store.combine([q1, q2], (count, label) => `${label}: ${count}`)

      client._pushData("count", 5)
      client._pushData("label", "Total")

      expect(combined.get()).toBe("Total: 5")
    })

    it("recalculates when any source changes", () => {
      const q1 = store.query<number>("a")
      const q2 = store.query<number>("b")

      const sum = store.combine([q1, q2], (a, b) => ((a ?? 0) as number) + ((b ?? 0) as number))
      const listener = vi.fn()
      sum.subscribe(listener)

      client._pushData("a", 10)
      client._pushData("b", 20)

      expect(sum.get()).toBe(30)
    })

    it("destroy cleans up all source subscriptions", () => {
      const q1 = store.query<number>("a")
      const q2 = store.query<number>("b")

      const combined = store.combine([q1, q2], (a, b) => [a, b])
      const listener = vi.fn()
      combined.subscribe(listener)
      listener.mockClear()

      combined.destroy()
      client._pushData("a", 99)
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe("mutate", () => {
    it("calls client.mutate with correct args", async () => {
      await store.mutate("tasks.create", { title: "New" })
      expect(client.mutate).toHaveBeenCalledWith("tasks.create", { title: "New" })
    })

    it("returns the mutation result", async () => {
      client.mutate.mockResolvedValueOnce({ id: "t1" })
      const result = await store.mutate("tasks.create", { title: "New" })
      expect(result).toEqual({ id: "t1" })
    })

    it("applies optimistic updates", async () => {
      const handle = store.query<string[]>("tasks.list")
      client._pushData("tasks.list", ["a", "b"])

      const listener = vi.fn()
      handle.subscribe(listener)
      listener.mockClear()

      client.mutate.mockResolvedValueOnce(undefined)
      await store.mutate(
        "tasks.add",
        {},
        {
          optimistic: (current: string[]) => [...current, "c"],
        },
      )

      // Should have notified with optimistic data
      expect(listener).toHaveBeenCalled()
    })

    it("rolls back optimistic updates on error", async () => {
      const handle = store.query<string[]>("tasks.list")
      client._pushData("tasks.list", ["a", "b"])

      client.mutate.mockRejectedValueOnce(new Error("Server error"))

      try {
        await store.mutate(
          "tasks.add",
          {},
          {
            optimistic: (current: string[]) => [...current, "c"],
          },
        )
      } catch {
        // expected
      }

      // After rollback, data should be restored
      expect(handle.get().data).toEqual(["a", "b"])
    })

    it("does not rollback when rollbackOnError is false", async () => {
      const handle = store.query<string[]>("tasks.list")
      client._pushData("tasks.list", ["a", "b"])

      client.mutate.mockRejectedValueOnce(new Error("Server error"))

      try {
        await store.mutate(
          "tasks.add",
          {},
          {
            optimistic: (current: string[]) => [...current, "c"],
            rollbackOnError: false,
          },
        )
      } catch {
        // expected
      }

      // Data should NOT be rolled back
      expect(handle.get().data).toEqual(["a", "b", "c"])
    })

    it("skips optimistic updates when enableOptimistic is false", async () => {
      const s = new ReactiveStore(client, { enableOptimistic: false })
      const handle = s.query<string[]>("tasks.list")
      client._pushData("tasks.list", ["a"])

      const listener = vi.fn()
      handle.subscribe(listener)
      listener.mockClear()

      client.mutate.mockResolvedValueOnce(undefined)
      await s.mutate(
        "tasks.add",
        {},
        {
          optimistic: (current: string[]) => [...current, "b"],
        },
      )

      // Listener should not have been called for optimistic update
      expect(listener).not.toHaveBeenCalled()
    })

    it("propagates errors", async () => {
      client.mutate.mockRejectedValueOnce(new Error("fail"))
      await expect(store.mutate("tasks.create", {})).rejects.toThrow("fail")
    })
  })

  describe("mutation handle", () => {
    it("creates a reusable mutation handle", () => {
      const handle = store.mutation("tasks.create")
      expect(handle).toBeDefined()
      expect(handle.get).toBeDefined()
      expect(handle.execute).toBeDefined()
      expect(handle.subscribe).toBeDefined()
    })

    it("starts in idle state", () => {
      const handle = store.mutation("tasks.create")
      const state = handle.get()
      expect(state.isPending).toBe(false)
      expect(state.isSuccess).toBe(false)
      expect(state.isError).toBe(false)
      expect(state.data).toBeUndefined()
      expect(state.error).toBeNull()
    })

    it("execute calls client and transitions through states", async () => {
      client.mutate.mockResolvedValueOnce({ id: "t1" })
      const handle = store.mutation<{ title: string }, { id: string }>("tasks.create")
      const states: MutationState<{ id: string }>[] = []
      handle.subscribe((s) => states.push(s))

      await handle.execute({ title: "Test" })

      expect(client.mutate).toHaveBeenCalledWith("tasks.create", { title: "Test" })
      // States: initial idle, pending, success
      expect(states.length).toBeGreaterThanOrEqual(3)
      expect(states[1].isPending).toBe(true)
      expect(states[states.length - 1].isSuccess).toBe(true)
      expect(states[states.length - 1].data).toEqual({ id: "t1" })
    })

    it("sets error state on failure", async () => {
      client.mutate.mockRejectedValueOnce(new Error("fail"))
      const handle = store.mutation("tasks.create")
      const states: MutationState[] = []
      handle.subscribe((s) => states.push(s))

      await expect(handle.execute({})).rejects.toThrow("fail")

      const lastState = states[states.length - 1]
      expect(lastState.isError).toBe(true)
      expect(lastState.error?.message).toBe("fail")
      expect(lastState.isPending).toBe(false)
    })

    it("wraps non-Error throws in Error", async () => {
      client.mutate.mockRejectedValueOnce("string error")
      const handle = store.mutation("tasks.create")
      const states: MutationState[] = []
      handle.subscribe((s) => states.push(s))

      await expect(handle.execute({})).rejects.toBe("string error")
      const lastState = states[states.length - 1]
      expect(lastState.error).toBeInstanceOf(Error)
    })

    it("subscribe returns unsubscribe function", () => {
      const handle = store.mutation("tasks.create")
      const listener = vi.fn()
      const unsub = handle.subscribe(listener)
      listener.mockClear()

      unsub()
      // No further notifications after unsubscribe
    })
  })

  describe("destroy", () => {
    it("destroys all queries and clears state", () => {
      store.query("a")
      store.query("b")
      store.destroy()

      // After destroy, new queries should create fresh handles
      const h = store.query("a")
      expect(h.get().isLoading).toBe(true)
    })
  })
})
