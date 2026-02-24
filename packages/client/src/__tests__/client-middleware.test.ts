import { describe, it, expect, beforeEach } from "vitest"
import {
  ClientMiddlewarePipeline,
  loggingMiddleware,
  retryMiddleware,
  analyticsMiddleware,
  type ClientSubscriptionMiddleware,
  type SubscriptionEvent,
  type SubscriptionUpdateEvent,
  type SubscriptionErrorEvent,
  type SubscriptionReconnectEvent,
  type AnalyticsMetric,
} from "../subscription/client-middleware.js"

describe("ClientMiddlewarePipeline", () => {
  let pipeline: ClientMiddlewarePipeline

  beforeEach(() => {
    pipeline = new ClientMiddlewarePipeline()
  })

  it("starts with zero middleware", () => {
    expect(pipeline.count).toBe(0)
  })

  it("adds and removes middleware", () => {
    const mw: ClientSubscriptionMiddleware = { name: "test" }
    pipeline.use(mw)
    expect(pipeline.count).toBe(1)
    expect(pipeline.remove("test")).toBe(true)
    expect(pipeline.count).toBe(0)
  })

  it("returns false when removing non-existent middleware", () => {
    expect(pipeline.remove("nonexistent")).toBe(false)
  })

  it("runs onSubscribe hooks", async () => {
    const calls: string[] = []
    pipeline.use({
      name: "test",
      onSubscribe: (e) => {
        calls.push(`sub:${e.queryName}`)
      },
    })

    const event: SubscriptionEvent = {
      subscriptionId: "s1",
      queryName: "tasks.list",
      args: {},
      timestamp: Date.now(),
    }
    await pipeline.runOnSubscribe(event)
    expect(calls).toEqual(["sub:tasks.list"])
  })

  it("runs onUpdate hooks and allows data transformation", async () => {
    pipeline.use({
      name: "transform",
      onUpdate: (event) => {
        const data = event.data as number[]
        return data.map((x) => x * 2)
      },
    })

    const event: SubscriptionUpdateEvent = {
      subscriptionId: "s1",
      queryName: "tasks.list",
      args: {},
      timestamp: Date.now(),
      data: [1, 2, 3],
      version: 1,
      sincePreviousMs: null,
    }
    const result = await pipeline.runOnUpdate(event)
    expect(result).toEqual([2, 4, 6])
  })

  it("chains multiple onUpdate middleware", async () => {
    pipeline.use({
      name: "add1",
      onUpdate: (event) => (event.data as number) + 1,
    })
    pipeline.use({
      name: "multiply2",
      onUpdate: (event) => (event.data as number) * 2,
    })

    const event: SubscriptionUpdateEvent = {
      subscriptionId: "s1",
      queryName: "test",
      args: {},
      timestamp: Date.now(),
      data: 5,
      version: 1,
      sincePreviousMs: null,
    }
    const result = await pipeline.runOnUpdate(event)
    expect(result).toBe(12) // (5 + 1) * 2
  })

  it("runs onError hooks and tracks error counts", async () => {
    const counts: number[] = []
    pipeline.use({
      name: "test",
      onError: (event) => {
        counts.push(event.errorCount)
      },
    })

    const baseEvent: SubscriptionErrorEvent = {
      subscriptionId: "s1",
      queryName: "test",
      args: {},
      timestamp: Date.now(),
      error: new Error("fail"),
      errorCount: 0,
    }

    await pipeline.runOnError(baseEvent)
    await pipeline.runOnError(baseEvent)
    await pipeline.runOnError(baseEvent)
    expect(counts).toEqual([1, 2, 3])
  })

  it("runs onReconnect hooks", async () => {
    const attempts: number[] = []
    pipeline.use({
      name: "test",
      onReconnect: (event) => {
        attempts.push(event.attempt)
      },
    })

    const event: SubscriptionReconnectEvent = {
      attempt: 3,
      maxAttempts: 5,
      backoffMs: 1000,
      timestamp: Date.now(),
    }
    await pipeline.runOnReconnect(event)
    expect(attempts).toEqual([3])
  })

  it("runs onUnsubscribe hooks and cleans up tracking", async () => {
    const calls: string[] = []
    pipeline.use({
      name: "test",
      onUnsubscribe: (event) => {
        calls.push(event.subscriptionId)
      },
    })

    const event: SubscriptionEvent = {
      subscriptionId: "s1",
      queryName: "test",
      args: {},
      timestamp: Date.now(),
    }
    await pipeline.runOnSubscribe(event)
    await pipeline.runOnUnsubscribe(event)
    expect(calls).toEqual(["s1"])
    expect(pipeline.getStaleness("s1")).toBeNull()
  })

  it("handles middleware errors without breaking pipeline", async () => {
    pipeline.use({
      name: "failing",
      onSubscribe: () => {
        throw new Error("boom")
      },
    })
    pipeline.use({
      name: "succeeding",
      onSubscribe: () => {
        /* ok */
      },
    })

    const event: SubscriptionEvent = {
      subscriptionId: "s1",
      queryName: "test",
      args: {},
      timestamp: Date.now(),
    }
    // Should not throw
    await pipeline.runOnSubscribe(event)
  })

  it("tracks staleness of subscriptions", async () => {
    const event: SubscriptionUpdateEvent = {
      subscriptionId: "s1",
      queryName: "test",
      args: {},
      timestamp: Date.now(),
      data: {},
      version: 1,
      sincePreviousMs: null,
    }
    await pipeline.runOnUpdate(event)
    const staleness = pipeline.getStaleness("s1")
    expect(staleness).not.toBeNull()
    expect(staleness!).toBeGreaterThanOrEqual(0)
    expect(staleness!).toBeLessThan(100) // should be near 0
  })
})

describe("Built-in Middleware", () => {
  describe("loggingMiddleware", () => {
    it("creates middleware with correct name", () => {
      const mw = loggingMiddleware()
      expect(mw.name).toBe("logging")
      expect(mw.onSubscribe).toBeDefined()
      expect(mw.onUpdate).toBeDefined()
      expect(mw.onError).toBeDefined()
      expect(mw.onStale).toBeDefined()
      expect(mw.onReconnect).toBeDefined()
    })
  })

  describe("retryMiddleware", () => {
    it("creates middleware with correct name", () => {
      const mw = retryMiddleware({ maxRetries: 5 })
      expect(mw.name).toBe("retry")
      expect(mw.onError).toBeDefined()
    })

    it("calls onMaxRetriesReached when limit exceeded", async () => {
      let reachedQuery: string | null = null
      const mw = retryMiddleware({
        maxRetries: 2,
        onMaxRetriesReached: (q) => {
          reachedQuery = q
        },
      })
      const event: SubscriptionErrorEvent = {
        subscriptionId: "s1",
        queryName: "tasks.list",
        args: {},
        timestamp: Date.now(),
        error: new Error("fail"),
        errorCount: 3,
      }
      await mw.onError!(event)
      expect(reachedQuery).toBe("tasks.list")
    })
  })

  describe("analyticsMiddleware", () => {
    it("tracks subscription lifecycle metrics", async () => {
      const metrics: AnalyticsMetric[] = []
      const mw = analyticsMiddleware({ onMetric: (m) => metrics.push(m) })

      const subEvent: SubscriptionEvent = {
        subscriptionId: "s1",
        queryName: "tasks",
        args: {},
        timestamp: Date.now(),
      }
      await mw.onSubscribe!(subEvent)
      expect(metrics).toHaveLength(1)
      expect(metrics[0].type).toBe("subscribe")

      const updateEvent: SubscriptionUpdateEvent = {
        ...subEvent,
        data: [],
        version: 1,
        sincePreviousMs: null,
      }
      await mw.onUpdate!(updateEvent)
      expect(metrics).toHaveLength(2)
      expect(metrics[1].type).toBe("update")

      await mw.onUnsubscribe!(subEvent)
      expect(metrics).toHaveLength(3)
      expect(metrics[2].type).toBe("unsubscribe")
      expect(metrics[2].totalUpdates).toBe(1)
    })
  })
})
