import { describe, it, expect, beforeEach } from "vitest"
import { MutationQueue, OfflineQueryCache, SyncEngine, InMemoryOfflineStorage } from "../index.js"

describe("MutationQueue", () => {
  let queue: MutationQueue
  let storage: InMemoryOfflineStorage

  beforeEach(async () => {
    storage = new InMemoryOfflineStorage()
    queue = new MutationQueue({ maxRetries: 3 })
    await queue.init(storage)
  })

  it("enqueues mutations", async () => {
    await queue.enqueue("tasks.create", { title: "test" })
    expect(queue.size).toBe(1)
    expect(queue.pending).toHaveLength(1)
  })

  it("dequeues mutations in order", async () => {
    await queue.enqueue("a", { v: 1 })
    await queue.enqueue("b", { v: 2 })

    const first = await queue.dequeue()
    expect(first?.mutationName).toBe("a")
    expect(first?.status).toBe("in-flight")
  })

  it("marks mutations as completed", async () => {
    const mut = await queue.enqueue("test", {})
    await queue.markCompleted(mut.id)
    expect(queue.size).toBe(0)
  })

  it("marks mutations as failed with retry", async () => {
    const mut = await queue.enqueue("test", {})
    await queue.dequeue()
    await queue.markFailed(mut.id, "Network error")

    expect(queue.all[0].retryCount).toBe(1)
    expect(queue.all[0].status).toBe("pending")
  })

  it("marks mutations as permanently failed after max retries", async () => {
    const mut = await queue.enqueue("test", {})
    for (let i = 0; i < 3; i++) {
      await queue.dequeue()
      await queue.markFailed(mut.id, "fail")
    }
    expect(queue.all[0].status).toBe("failed")
  })

  it("persists to storage", async () => {
    await queue.enqueue("test", { v: 1 })
    const raw = await storage.get("_rb_mutation_queue")
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)).toHaveLength(1)
  })

  it("clears all mutations", async () => {
    await queue.enqueue("a", {})
    await queue.enqueue("b", {})
    await queue.clear()
    expect(queue.size).toBe(0)
  })
})

describe("OfflineQueryCache", () => {
  let cache: OfflineQueryCache
  let storage: InMemoryOfflineStorage

  beforeEach(async () => {
    storage = new InMemoryOfflineStorage()
    cache = new OfflineQueryCache({ defaultTtl: 60_000, maxEntries: 100 })
    await cache.init(storage)
  })

  it("puts and gets cached queries", async () => {
    await cache.put("tasks.list", { userId: "u1" }, [{ id: "t1" }])
    const data = cache.get("tasks.list", { userId: "u1" })
    expect(data).toEqual([{ id: "t1" }])
  })

  it("returns undefined for missing entries", () => {
    expect(cache.get("missing", {})).toBeUndefined()
  })

  it("checks existence", async () => {
    await cache.put("test", {}, "data")
    expect(cache.has("test", {})).toBe(true)
    expect(cache.has("missing", {})).toBe(false)
  })

  it("invalidates specific entries", async () => {
    await cache.put("test", { a: 1 }, "data")
    await cache.invalidate("test", { a: 1 })
    expect(cache.has("test", { a: 1 })).toBe(false)
  })

  it("invalidates all entries for a query", async () => {
    await cache.put("test", { a: 1 }, "data1")
    await cache.put("test", { a: 2 }, "data2")
    await cache.invalidate("test")
    expect(cache.size).toBe(0)
  })

  it("evicts oldest entries when over limit", async () => {
    const smallCache = new OfflineQueryCache({ maxEntries: 3 })
    await smallCache.init(storage)

    await smallCache.put("q1", {}, "d1")
    await smallCache.put("q2", {}, "d2")
    await smallCache.put("q3", {}, "d3")
    await smallCache.put("q4", {}, "d4")

    expect(smallCache.size).toBe(3)
  })
})

describe("SyncEngine", () => {
  let syncEngine: SyncEngine
  let queue: MutationQueue
  let cache: OfflineQueryCache

  beforeEach(async () => {
    const storage = new InMemoryOfflineStorage()
    queue = new MutationQueue()
    cache = new OfflineQueryCache()
    await queue.init(storage)
    await cache.init(storage)
    syncEngine = new SyncEngine(queue, cache)
  })

  it("starts offline", () => {
    expect(syncEngine.networkStatus).toBe("offline")
    expect(syncEngine.isOnline).toBe(false)
  })

  it("transitions to online", () => {
    syncEngine.setOnline()
    expect(syncEngine.isOnline).toBe(true)
  })

  it("tracks pending mutations", async () => {
    await queue.enqueue("test", {})
    expect(syncEngine.pendingMutations).toBe(1)
  })

  it("replays mutations on reconnect", async () => {
    await queue.enqueue("a", { v: 1 })
    await queue.enqueue("b", { v: 2 })

    const executed: string[] = []
    const synced = await syncEngine.replayMutations(async (name) => {
      executed.push(name)
    })

    expect(synced).toBe(2)
    expect(executed).toEqual(["a", "b"])
    expect(queue.size).toBe(0)
  })

  it("handles failed replays", async () => {
    await queue.enqueue("fail", {})

    const errors: Error[] = []
    const eng = new SyncEngine(
      queue,
      cache,
      {},
      {
        onConflict: (_mut, err) => errors.push(err),
      },
    )

    await eng.replayMutations(async () => {
      throw new Error("Server error")
    })

    expect(errors).toHaveLength(1)
    expect(queue.all[0].retryCount).toBe(1)
  })

  it("cleans up on destroy", () => {
    syncEngine.destroy()
    expect(syncEngine.networkStatus).toBe("offline")
  })
})

describe("InMemoryOfflineStorage", () => {
  it("implements full storage interface", async () => {
    const storage = new InMemoryOfflineStorage()

    await storage.set("key1", "value1")
    await storage.set("key2", "value2")

    expect(await storage.get("key1")).toBe("value1")
    expect(await storage.get("missing")).toBeNull()

    const keys = await storage.getAllKeys()
    expect(keys).toHaveLength(2)

    await storage.delete("key1")
    expect(await storage.get("key1")).toBeNull()
    expect(storage.size).toBe(1)

    await storage.clear()
    expect(storage.size).toBe(0)
  })
})
