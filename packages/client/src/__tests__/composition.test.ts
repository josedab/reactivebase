import { describe, it, expect, vi, afterEach } from "vitest"
import { subscribeDerived, subscribeTransformed } from "../composition/composition.js"
import type { ReactiveBaseClient } from "../subscription/index.js"

// ─── Mock Client ─────────────────────────────────────────────────────────────

function createMockClient(): ReactiveBaseClient & {
  _callbacks: Map<string, (data: unknown, error?: Error) => void>
  _pushData(queryName: string, data: unknown): void
  _pushError(queryName: string, error: Error): void
} {
  const callbacks = new Map<string, (data: unknown, error?: Error) => void>()
  let subIndex = 0

  const client = {
    _callbacks: callbacks,
    subscribe: vi.fn((queryName: string, _args: unknown, callback: (data: unknown, error?: Error) => void) => {
      const key = `${queryName}:${subIndex++}`
      callbacks.set(key, callback)
      return () => callbacks.delete(key)
    }),
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
  } as unknown as ReactiveBaseClient & {
    _callbacks: Map<string, (data: unknown, error?: Error) => void>
    _pushData(queryName: string, data: unknown): void
    _pushError(queryName: string, error: Error): void
  }
  return client
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("composition", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("should export composition utilities", () => {
    expect(subscribeDerived).toBeDefined()
    expect(subscribeTransformed).toBeDefined()
  })

  it("should create derived subscriptions", () => {
    expect(typeof subscribeDerived).toBe("function")
    expect(typeof subscribeTransformed).toBe("function")
  })

  describe("subscribeDerived — combining multiple sources", () => {
    it("calls combiner when all sources emit", () => {
      const client = createMockClient()
      const listener = vi.fn()

      subscribeDerived(
        client,
        [
          { queryName: "count", args: {} },
          { queryName: "label", args: {} },
        ],
        (count, label) => `${label}: ${count}`,
        listener,
      )

      client._pushData("count", 5)
      client._pushData("label", "Total")

      expect(listener).toHaveBeenCalledWith("Total: 5")
    })

    it("does not call listener until all sources have emitted", () => {
      const client = createMockClient()
      const listener = vi.fn()

      subscribeDerived(
        client,
        [
          { queryName: "a", args: {} },
          { queryName: "b", args: {} },
        ],
        (a, b) => [a, b],
        listener,
      )

      client._pushData("a", 1)
      // Only one source has emitted, combiner should not fire
      expect(listener).not.toHaveBeenCalled()
    })

    it("re-emits on any source update", () => {
      const client = createMockClient()
      const listener = vi.fn()

      subscribeDerived(
        client,
        [
          { queryName: "a", args: {} },
          { queryName: "b", args: {} },
        ],
        (a, b) => (a as number) + (b as number),
        listener,
      )

      client._pushData("a", 1)
      client._pushData("b", 2)
      listener.mockClear()

      client._pushData("a", 10)
      expect(listener).toHaveBeenCalledWith(12)
    })

    it("returns handle with id and sourceIds", () => {
      const client = createMockClient()
      const handle = subscribeDerived(
        client,
        [
          { queryName: "x", args: {} },
          { queryName: "y", args: {} },
        ],
        () => null,
        vi.fn(),
      )

      expect(handle.id).toBeDefined()
      expect(handle.sourceIds).toHaveLength(2)
      handle.unsubscribe()
    })

    it("propagates source errors to listener", () => {
      const client = createMockClient()
      const listener = vi.fn()

      subscribeDerived(client, [{ queryName: "a", args: {} }], (a) => a, listener)

      const error = new Error("Source failed")
      client._pushError("a", error)

      expect(listener).toHaveBeenCalledWith(undefined, error)
    })

    it("catches combiner errors and reports as Error", () => {
      const client = createMockClient()
      const listener = vi.fn()

      subscribeDerived(
        client,
        [{ queryName: "a", args: {} }],
        () => {
          throw new Error("combiner fail")
        },
        listener,
      )

      client._pushData("a", 1)
      expect(listener).toHaveBeenCalledWith(undefined, expect.any(Error))
    })
  })

  describe("subscribeDerived — unsubscribe cleanup", () => {
    it("unsubscribe stops all source subscriptions", () => {
      const client = createMockClient()
      const listener = vi.fn()

      const handle = subscribeDerived(
        client,
        [
          { queryName: "a", args: {} },
          { queryName: "b", args: {} },
        ],
        (a, b) => [a, b],
        listener,
      )

      client._pushData("a", 1)
      client._pushData("b", 2)
      listener.mockClear()

      handle.unsubscribe()

      client._pushData("a", 99)
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe("subscribeTransformed — mapping function", () => {
    it("transforms source data through mapping function", () => {
      const client = createMockClient()
      const listener = vi.fn()

      subscribeTransformed<number, string>(client, "count", {}, (n) => `Count is ${n}`, listener)

      client._pushData("count", 42)
      expect(listener).toHaveBeenCalledWith("Count is 42")
    })

    it("returns handle with unsubscribe", () => {
      const client = createMockClient()
      const handle = subscribeTransformed(client, "q", {}, (x) => x, vi.fn())
      expect(typeof handle.unsubscribe).toBe("function")
      handle.unsubscribe()
    })

    it("unsubscribe stops receiving updates", () => {
      const client = createMockClient()
      const listener = vi.fn()

      const handle = subscribeTransformed<number, number>(client, "count", {}, (n) => n * 2, listener)

      client._pushData("count", 1)
      listener.mockClear()

      handle.unsubscribe()
      client._pushData("count", 2)
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe("edge cases", () => {
    it("handles empty sources array", () => {
      const client = createMockClient()
      const listener = vi.fn()
      const handle = subscribeDerived(client, [], () => "empty", listener)
      // With no sources, combiner never fires (all sources need to emit)
      expect(listener).not.toHaveBeenCalled()
      handle.unsubscribe()
    })

    it("handles rapid updates on same source", () => {
      const client = createMockClient()
      const listener = vi.fn()

      subscribeDerived(client, [{ queryName: "a", args: {} }], (a) => a, listener)

      for (let i = 0; i < 100; i++) {
        client._pushData("a", i)
      }

      // Should have received all 100 updates
      expect(listener).toHaveBeenCalledTimes(100)
      expect(listener).toHaveBeenLastCalledWith(99)
    })

    it("handles non-Error thrown in combiner", () => {
      const client = createMockClient()
      const listener = vi.fn()

      subscribeDerived(
        client,
        [{ queryName: "a", args: {} }],
        () => {
          throw "string error"
        },
        listener,
      )

      client._pushData("a", 1)
      expect(listener).toHaveBeenCalledWith(undefined, expect.any(Error))
    })
  })
})
