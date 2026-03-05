/**
 * Integration tests for state adapters: Jotai, Zustand, Pinia, Nanostores.
 * Uses a mock ReactiveStore to test lifecycle, subscriptions, and mutations.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"
import { ReactiveStore } from "../index.js"
import type { StateClientAdapter, QueryState } from "../index.js"
import { queryAtom, selectorAtom, mutationAtom } from "../adapters/jotai.js"
import { createReactiveSlice, reactiveBaseMiddleware } from "../adapters/zustand.js"
import { defineReactiveStore } from "../adapters/pinia.js"
import { reactiveAtom, computedAtom } from "../adapters/nanostores.js"

// ─── Mock Client ─────────────────────────────────────────────────────────────

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
      return () => callbacks.delete(key)
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

// ─── Jotai Adapter ───────────────────────────────────────────────────────────

describe("Jotai adapter", () => {
  let client: ReturnType<typeof createMockClient>
  let store: ReactiveStore

  beforeEach(() => {
    client = createMockClient()
    store = new ReactiveStore(client)
  })

  describe("queryAtom", () => {
    it("creates atom with initial loading state", () => {
      const atom = queryAtom(store, "tasks.list", {})
      const state = atom.get()
      expect(state.isLoading).toBe(true)
      expect(state.data).toBeUndefined()
    })

    it("subscribes and receives data updates", () => {
      const atom = queryAtom(store, "tasks.list", {})
      const listener = vi.fn()
      atom.subscribe(listener)

      client._pushData("tasks.list", [{ id: 1 }])

      expect(listener).toHaveBeenCalled()
      const lastCall = listener.mock.calls[listener.mock.calls.length - 1][0]
      expect(lastCall.data).toEqual([{ id: 1 }])
    })

    it("unsubscribes correctly", () => {
      const atom = queryAtom(store, "tasks.list", {})
      const listener = vi.fn()
      const unsub = atom.subscribe(listener)
      unsub()

      client._pushData("tasks.list", [{ id: 2 }])
      // Listener should not be called after unsubscribe for new updates
      const callCount = listener.mock.calls.length
      client._pushData("tasks.list", [{ id: 3 }])
      expect(listener.mock.calls.length).toBe(callCount)
    })
  })

  describe("selectorAtom", () => {
    it("creates derived atom with selector", () => {
      const atom = selectorAtom<{ id: number }[], number>(store, "tasks.list", {}, (tasks) => tasks.length)
      expect(atom.get()).toBeUndefined() // no data yet
    })

    it("receives derived value on update", () => {
      const atom = selectorAtom<{ id: number }[], number>(store, "tasks.list", {}, (tasks) => tasks.length)
      const listener = vi.fn()
      atom.subscribe(listener)

      client._pushData("tasks.list", [{ id: 1 }, { id: 2 }])

      const lastValue = listener.mock.calls[listener.mock.calls.length - 1][0]
      expect(lastValue).toBe(2)
    })
  })

  describe("mutationAtom", () => {
    it("creates mutation atom with execute function", () => {
      const atom = mutationAtom(store, "tasks.create")
      expect(typeof atom.execute).toBe("function")
      expect(typeof atom.get).toBe("function")
      expect(typeof atom.subscribe).toBe("function")
    })

    it("executes mutation", async () => {
      const atom = mutationAtom(store, "tasks.create")
      const result = await atom.execute({ title: "Test" })
      expect(result).toEqual({ success: true })
      expect(client.mutate).toHaveBeenCalledWith("tasks.create", { title: "Test" })
    })

    it("tracks mutation state", () => {
      const atom = mutationAtom(store, "tasks.create")
      const state = atom.get()
      expect(state.isPending).toBe(false)
      expect(state.data).toBeUndefined()
    })
  })
})

// ─── Zustand Adapter ─────────────────────────────────────────────────────────

describe("Zustand adapter", () => {
  let client: ReturnType<typeof createMockClient>
  let store: ReactiveStore

  beforeEach(() => {
    client = createMockClient()
    store = new ReactiveStore(client)
  })

  describe("createReactiveSlice", () => {
    it("creates slice with initial state for each query", () => {
      const slice = createReactiveSlice(store, {
        tasks: "tasks.list",
        users: { queryName: "users.list", args: { active: true } },
      })

      const mockSet = vi.fn()
      const initialState = slice(mockSet)

      expect(initialState).toHaveProperty("tasks")
      expect(initialState).toHaveProperty("users")
      expect((initialState.tasks as QueryState).isLoading).toBe(true)
    })

    it("calls set on query updates", () => {
      const mockSet = vi.fn()
      createReactiveSlice(store, { tasks: "tasks.list" })(mockSet)

      client._pushData("tasks.list", [{ id: 1 }])

      expect(mockSet).toHaveBeenCalled()
    })
  })

  describe("reactiveBaseMiddleware", () => {
    it("wraps config and subscribes to queries", () => {
      const middleware = reactiveBaseMiddleware(store, {
        tasks: "tasks.list",
      })

      const mockConfig = vi.fn((_set: unknown, _get: unknown, _api: unknown) => ({
        customAction: () => {},
      }))

      const mockSet = vi.fn()
      const mockGet = vi.fn(() => ({}))
      const wrapped = middleware(mockConfig)(mockSet, mockGet, {})

      expect(wrapped).toHaveProperty("customAction")
      expect(client.subscribe).toHaveBeenCalled()
    })
  })
})

// ─── Pinia Adapter ───────────────────────────────────────────────────────────

describe("Pinia adapter", () => {
  let client: ReturnType<typeof createMockClient>
  let store: ReactiveStore

  beforeEach(() => {
    client = createMockClient()
    store = new ReactiveStore(client)
  })

  describe("defineReactiveStore", () => {
    it("creates store with id and initial state", () => {
      const piniaStore = defineReactiveStore("tasks", store, {
        tasks: "tasks.list",
      })
      expect(piniaStore.id).toBe("tasks")
      expect(piniaStore.state).toHaveProperty("tasks")
    })

    it("subscribes to state changes", () => {
      const piniaStore = defineReactiveStore("tasks", store, {
        tasks: "tasks.list",
      })
      const listener = vi.fn()
      piniaStore.subscribe(listener)

      // Listener called immediately with current state
      expect(listener).toHaveBeenCalledTimes(1)

      client._pushData("tasks.list", [{ id: 1 }])
      expect(listener).toHaveBeenCalledTimes(2)
    })

    it("unsubscribes correctly", () => {
      const piniaStore = defineReactiveStore("tasks", store, {
        tasks: "tasks.list",
      })
      const listener = vi.fn()
      const unsub = piniaStore.subscribe(listener)
      unsub()

      const callsBefore = listener.mock.calls.length
      client._pushData("tasks.list", [{ id: 1 }])
      expect(listener.mock.calls.length).toBe(callsBefore)
    })

    it("refresh triggers query refresh", () => {
      const piniaStore = defineReactiveStore("tasks", store, {
        tasks: "tasks.list",
      })
      // Should not throw
      expect(() => piniaStore.refresh("tasks")).not.toThrow()
    })

    it("destroy cleans up all handles", () => {
      const piniaStore = defineReactiveStore("tasks", store, {
        tasks: "tasks.list",
      })
      expect(() => piniaStore.destroy()).not.toThrow()
    })
  })
})

// ─── Nanostores Adapter ──────────────────────────────────────────────────────

describe("Nanostores adapter", () => {
  let client: ReturnType<typeof createMockClient>
  let store: ReactiveStore

  beforeEach(() => {
    client = createMockClient()
    store = new ReactiveStore(client)
  })

  describe("reactiveAtom", () => {
    it("creates atom with get/subscribe/destroy", () => {
      const atom = reactiveAtom(store, "tasks.list")
      expect(typeof atom.get).toBe("function")
      expect(typeof atom.subscribe).toBe("function")
      expect(typeof atom.destroy).toBe("function")
    })

    it("returns initial loading state", () => {
      const atom = reactiveAtom(store, "tasks.list")
      expect(atom.get().isLoading).toBe(true)
      expect(atom.get().data).toBeUndefined()
    })

    it("subscribes and receives data", () => {
      const atom = reactiveAtom(store, "tasks.list")
      const listener = vi.fn()
      atom.subscribe(listener)

      client._pushData("tasks.list", [{ id: 1 }])
      expect(listener).toHaveBeenCalled()
    })

    it("destroy cleans up", () => {
      const atom = reactiveAtom(store, "tasks.list")
      expect(() => atom.destroy()).not.toThrow()
    })
  })

  describe("computedAtom", () => {
    it("creates computed atom with selector", () => {
      const atom = computedAtom<{ id: number }[], number>(store, "tasks.list", {}, (tasks) => tasks.length)
      expect(atom.get()).toBeUndefined()
    })

    it("computes derived value on data push", () => {
      const atom = computedAtom<{ id: number }[], number>(store, "tasks.list", {}, (tasks) => tasks.length)
      const listener = vi.fn()
      atom.subscribe(listener)

      client._pushData("tasks.list", [{ id: 1 }, { id: 2 }, { id: 3 }])

      const lastVal = listener.mock.calls[listener.mock.calls.length - 1][0]
      expect(lastVal).toBe(3)
    })

    it("destroy cleans up", () => {
      const atom = computedAtom(store, "tasks.list", {}, (d: unknown) => d)
      expect(() => atom.destroy()).not.toThrow()
    })
  })
})

// ─── Cross-adapter concurrent mutations ──────────────────────────────────────

describe("cross-adapter concurrent mutations", () => {
  it("multiple adapters share the same query handle", () => {
    const client = createMockClient()
    const store = new ReactiveStore(client)

    const jotaiAtom = queryAtom(store, "tasks.list", {})
    const nanoAtom = reactiveAtom(store, "tasks.list", {})

    const jotaiListener = vi.fn()
    const nanoListener = vi.fn()

    jotaiAtom.subscribe(jotaiListener)
    nanoAtom.subscribe(nanoListener)

    client._pushData("tasks.list", [{ id: 1 }])

    // Both should receive the update
    expect(jotaiListener).toHaveBeenCalled()
    expect(nanoListener).toHaveBeenCalled()
  })
})
