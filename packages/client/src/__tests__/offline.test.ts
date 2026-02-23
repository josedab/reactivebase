import { describe, it, expect, beforeEach } from "vitest"
import { PersistentCache, MutationQueue, SyncManager, MemoryOfflineStorage } from "../offline/offline.js"

describe("PersistentCache", () => {
  let cache: PersistentCache

  beforeEach(() => {
    cache = new PersistentCache(new MemoryOfflineStorage())
  })

  it("stores and retrieves cached queries", async () => {
    await cache.set("tasks.list", '{"userId":"u1"}', [{ id: "1" }], 1)

    const entry = await cache.get("tasks.list", '{"userId":"u1"}')
    expect(entry).toBeDefined()
    expect(entry!.data).toEqual([{ id: "1" }])
    expect(entry!.version).toBe(1)
  })

  it("returns undefined for missing cache entries", async () => {
    const entry = await cache.get("unknown", "{}")
    expect(entry).toBeUndefined()
  })

  it("invalidates by query name", async () => {
    await cache.set("tasks.list", '{"a":1}', [], 1)
    await cache.set("tasks.list", '{"a":2}', [], 1)
    await cache.set("users.get", '{"b":1}', [], 1)

    await cache.invalidate("tasks.list")

    expect(await cache.get("tasks.list", '{"a":1}')).toBeUndefined()
    expect(await cache.get("users.get", '{"b":1}')).toBeDefined()
  })

  it("clears all cache entries", async () => {
    await cache.set("a", "1", {}, 1)
    await cache.set("b", "2", {}, 1)
    await cache.clear()

    expect(await cache.get("a", "1")).toBeUndefined()
    expect(await cache.get("b", "2")).toBeUndefined()
  })
})

describe("MutationQueue", () => {
  let queue: MutationQueue

  beforeEach(() => {
    queue = new MutationQueue(new MemoryOfflineStorage(), 100)
  })

  it("enqueues and retrieves pending mutations", async () => {
    await queue.enqueue("tasks.create", { title: "Test" })
    await queue.enqueue("tasks.complete", { taskId: "1" })

    const pending = await queue.getPending()
    expect(pending).toHaveLength(2)
    expect(pending[0].mutationName).toBe("tasks.create")
  })

  it("returns mutations in timestamp order", async () => {
    await queue.enqueue("first", {})
    await queue.enqueue("second", {})

    const pending = await queue.getPending()
    expect(pending[0].timestamp).toBeLessThanOrEqual(pending[1].timestamp)
  })

  it("marks mutations as complete", async () => {
    const id = await queue.enqueue("tasks.create", {})
    await queue.markComplete(id)

    expect(await queue.size()).toBe(0)
  })

  it("increments retry count", async () => {
    const id = await queue.enqueue("flaky", {})
    await queue.markRetry(id)
    await queue.markRetry(id)

    const pending = await queue.getPending()
    expect(pending[0].retries).toBe(2)
  })

  it("enforces max queue size", async () => {
    const smallQueue = new MutationQueue(new MemoryOfflineStorage(), 2)
    await smallQueue.enqueue("a", {})
    await smallQueue.enqueue("b", {})

    await expect(smallQueue.enqueue("c", {})).rejects.toThrow("queue is full")
  })
})

describe("SyncManager", () => {
  it("replays queued mutations on sync", async () => {
    const storage = new MemoryOfflineStorage()
    const queue = new MutationQueue(storage)
    const executed: string[] = []

    await queue.enqueue("tasks.create", { title: "A" })
    await queue.enqueue("tasks.create", { title: "B" })

    const sync = new SyncManager(queue, async (name) => {
      executed.push(name)
    })

    const result = await sync.sync()
    expect(result.synced).toBe(2)
    expect(result.failed).toBe(0)
    expect(executed).toEqual(["tasks.create", "tasks.create"])
    expect(await queue.size()).toBe(0)
  })

  it("handles failures with last-write-wins", async () => {
    const storage = new MemoryOfflineStorage()
    const queue = new MutationQueue(storage)

    await queue.enqueue("fail", {})

    const sync = new SyncManager(
      queue,
      async () => {
        throw new Error("Conflict")
      },
      { conflictStrategy: "last-write-wins" },
    )

    const result = await sync.sync()
    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
    // Mutation stays in queue for retry
    expect(await queue.size()).toBe(1)
  })

  it("drops conflicting mutations with server-wins", async () => {
    const storage = new MemoryOfflineStorage()
    const queue = new MutationQueue(storage)

    await queue.enqueue("conflict", {})

    const sync = new SyncManager(
      queue,
      async () => {
        throw new Error("Conflict")
      },
      { conflictStrategy: "server-wins" },
    )

    const result = await sync.sync()
    expect(result.failed).toBe(1)
    // Mutation removed from queue
    expect(await queue.size()).toBe(0)
  })

  it("prevents concurrent syncs", async () => {
    const storage = new MemoryOfflineStorage()
    const queue = new MutationQueue(storage)

    await queue.enqueue("slow", {})

    const sync = new SyncManager(queue, async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    const [r1, r2] = await Promise.all([sync.sync(), sync.sync()])
    // One should be skipped
    expect(r1.synced + r2.synced).toBe(1)
  })
})

describe("MemoryOfflineStorage", () => {
  it("implements full storage interface", async () => {
    const storage = new MemoryOfflineStorage()

    await storage.set("key1", { value: 1 })
    expect(await storage.get("key1")).toEqual({ value: 1 })

    const keys = await storage.keys()
    expect(keys).toContain("key1")

    await storage.delete("key1")
    expect(await storage.get("key1")).toBeUndefined()

    await storage.set("a", 1)
    await storage.set("b", 2)
    await storage.clear()
    expect((await storage.keys()).length).toBe(0)
  })
})
