import { describe, it, expect, vi } from "vitest"
import { ReactiveStore } from "../index.js"
import type { StateClientAdapter, MutationState } from "../index.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockClient(): StateClientAdapter & {
  _callbacks: Map<string, (data: unknown, error?: Error) => void>
  _pushData(queryName: string, data: unknown): void
  mutate: ReturnType<typeof vi.fn>
} {
  const callbacks = new Map<string, (data: unknown, error?: Error) => void>()
  return {
    _callbacks: callbacks,
    subscribe: vi.fn((queryName: string, _args: unknown, callback: (data: unknown, error?: Error) => void) => {
      callbacks.set(`${queryName}:${JSON.stringify(_args)}`, callback)
      return () => callbacks.delete(`${queryName}:${JSON.stringify(_args)}`)
    }),
    mutate: vi.fn(async () => ({ success: true })),
    _pushData(queryName: string, data: unknown) {
      for (const [key, cb] of callbacks) {
        if (key.startsWith(queryName + ":")) cb(data)
      }
    },
  }
}

// ─── Mutation Behavioral Tests ───────────────────────────────────────────────

describe("state/mutations", () => {
  it("should export ReactiveStore class", () => {
    expect(ReactiveStore).toBeDefined()
  })

  it("should handle mutation state lifecycle", () => {
    expect(typeof ReactiveStore).toBe("function")
  })

  describe("mutation.execute() state transitions (pending → success/error)", () => {
    it("transitions idle → pending → success on successful execute", async () => {
      const client = createMockClient()
      client.mutate.mockResolvedValueOnce({ id: "1" })
      const store = new ReactiveStore(client)
      const handle = store.mutation<{ title: string }, { id: string }>("tasks.create")

      const states: MutationState<{ id: string }>[] = []
      handle.subscribe((s) => states.push(s))

      // Initial state: idle
      expect(states[0].isPending).toBe(false)
      expect(states[0].isSuccess).toBe(false)
      expect(states[0].isError).toBe(false)

      await handle.execute({ title: "Test" })

      // Transitions: idle → pending → success
      expect(states[1].isPending).toBe(true)
      expect(states[1].isSuccess).toBe(false)
      expect(states[1].data).toBeUndefined()

      const final = states[states.length - 1]
      expect(final.isPending).toBe(false)
      expect(final.isSuccess).toBe(true)
      expect(final.data).toEqual({ id: "1" })
    })

    it("transitions idle → pending → error on failed execute", async () => {
      const client = createMockClient()
      client.mutate.mockRejectedValueOnce(new Error("Server error"))
      const store = new ReactiveStore(client)
      const handle = store.mutation("tasks.create")

      const states: MutationState[] = []
      handle.subscribe((s) => states.push(s))

      await expect(handle.execute({ title: "Test" })).rejects.toThrow("Server error")

      const final = states[states.length - 1]
      expect(final.isPending).toBe(false)
      expect(final.isError).toBe(true)
      expect(final.error?.message).toBe("Server error")
      expect(final.data).toBeUndefined()
    })

    it("resets state between multiple executions", async () => {
      const client = createMockClient()
      client.mutate.mockResolvedValueOnce({ id: "1" })
      client.mutate.mockResolvedValueOnce({ id: "2" })
      const store = new ReactiveStore(client)
      const handle = store.mutation<unknown, { id: string }>("tasks.create")

      await handle.execute({})
      expect(handle.get().data).toEqual({ id: "1" })

      await handle.execute({})
      expect(handle.get().data).toEqual({ id: "2" })
      expect(handle.get().isSuccess).toBe(true)
    })
  })

  describe("optimistic updates with rollback on error", () => {
    it("applies optimistic update before server response", async () => {
      const client = createMockClient()
      let resolvePromise: (value: unknown) => void
      client.mutate.mockReturnValueOnce(
        new Promise((r) => {
          resolvePromise = r
        }),
      )
      const store = new ReactiveStore(client)
      const handle = store.query<string[]>("tasks.list")
      client._pushData("tasks.list", ["a", "b"])

      const listener = vi.fn()
      handle.subscribe(listener)
      listener.mockClear()

      const mutatePromise = store.mutate(
        "tasks.add",
        {},
        {
          optimistic: (current: string[]) => [...current, "c"],
        },
      )

      // Optimistic update should have been applied immediately
      expect(listener).toHaveBeenCalled()
      expect(handle.get().data).toEqual(["a", "b", "c"])

      resolvePromise!(undefined)
      await mutatePromise
    })

    it("rolls back optimistic update when mutation fails", async () => {
      const client = createMockClient()
      client.mutate.mockRejectedValueOnce(new Error("fail"))
      const store = new ReactiveStore(client)
      const handle = store.query<string[]>("tasks.list")
      client._pushData("tasks.list", ["a", "b"])

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

      expect(handle.get().data).toEqual(["a", "b"])
    })

    it("does not rollback when rollbackOnError is false", async () => {
      const client = createMockClient()
      client.mutate.mockRejectedValueOnce(new Error("fail"))
      const store = new ReactiveStore(client)
      const handle = store.query<string[]>("tasks.list")
      client._pushData("tasks.list", ["a", "b"])

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

      expect(handle.get().data).toEqual(["a", "b", "c"])
    })
  })

  describe("mutation result caching", () => {
    it("caches last successful result in mutation handle state", async () => {
      const client = createMockClient()
      client.mutate.mockResolvedValueOnce({ id: "t1", title: "Task 1" })
      const store = new ReactiveStore(client)
      const handle = store.mutation("tasks.create")

      await handle.execute({ title: "Task 1" })
      const state = handle.get()
      expect(state.data).toEqual({ id: "t1", title: "Task 1" })
      expect(state.isSuccess).toBe(true)
    })

    it("clears cached data on new execution", async () => {
      const client = createMockClient()
      client.mutate.mockResolvedValueOnce({ id: "t1" })
      const store = new ReactiveStore(client)
      const handle = store.mutation("tasks.create")

      await handle.execute({})
      expect(handle.get().data).toEqual({ id: "t1" })

      // Start another execution — data should clear during pending
      client.mutate.mockResolvedValueOnce({ id: "t2" })
      const states: MutationState[] = []
      handle.subscribe((s) => states.push(s))
      await handle.execute({})

      // Pending state should have cleared data
      const pendingState = states.find((s) => s.isPending)
      expect(pendingState?.data).toBeUndefined()
    })
  })

  describe("MutationHandle properties", () => {
    it("has execute, get, and subscribe methods", () => {
      const client = createMockClient()
      const store = new ReactiveStore(client)
      const handle = store.mutation("tasks.create")
      expect(typeof handle.execute).toBe("function")
      expect(typeof handle.get).toBe("function")
      expect(typeof handle.subscribe).toBe("function")
    })

    it("subscribe returns unsubscribe function", () => {
      const client = createMockClient()
      const store = new ReactiveStore(client)
      const handle = store.mutation("tasks.create")
      const listener = vi.fn()
      const unsub = handle.subscribe(listener)
      expect(typeof unsub).toBe("function")
      listener.mockClear()
      unsub()
    })

    it("emits current state immediately on subscribe", () => {
      const client = createMockClient()
      const store = new ReactiveStore(client)
      const handle = store.mutation("tasks.create")
      const listener = vi.fn()
      handle.subscribe(listener)
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ isPending: false, isSuccess: false, isError: false }),
      )
    })
  })

  describe("edge cases", () => {
    it("handles concurrent mutations to different names", async () => {
      const client = createMockClient()
      client.mutate.mockResolvedValueOnce({ id: "1" })
      client.mutate.mockResolvedValueOnce({ id: "2" })
      const store = new ReactiveStore(client)
      const h1 = store.mutation("tasks.create")
      const h2 = store.mutation("tasks.update")

      await Promise.all([h1.execute({}), h2.execute({})])
      expect(h1.get().isSuccess).toBe(true)
      expect(h2.get().isSuccess).toBe(true)
    })

    it("handles mutation while another is pending", async () => {
      const client = createMockClient()
      client.mutate.mockResolvedValueOnce({ id: "1" })
      client.mutate.mockResolvedValueOnce({ id: "2" })
      const store = new ReactiveStore(client)
      const handle = store.mutation("tasks.create")

      const p1 = handle.execute({})
      const p2 = handle.execute({})
      await Promise.all([p1, p2])

      // Last one wins
      expect(handle.get().isSuccess).toBe(true)
    })

    it("wraps non-Error rejection in Error", async () => {
      const client = createMockClient()
      client.mutate.mockRejectedValueOnce("string error")
      const store = new ReactiveStore(client)
      const handle = store.mutation("tasks.create")

      await expect(handle.execute({})).rejects.toBe("string error")
      expect(handle.get().error).toBeInstanceOf(Error)
      expect(handle.get().error?.message).toBe("string error")
    })
  })
})
