import { describe, it, expect } from "vitest"
import {
  OfflineSyncEngine,
  createVectorClock,
  incrementClock,
  mergeClock,
  happensBefore,
  areConcurrent,
  clocksEqual,
} from "../offline/sync-engine.js"
import { MemoryOfflineStorage } from "../offline/offline.js"

function createEngine(opts: Partial<{ clientId: string; conflictStrategy: string }> = {}) {
  return new OfflineSyncEngine({
    storage: new MemoryOfflineStorage(),
    clientId: opts.clientId ?? "client-1",
    conflictStrategy: (opts.conflictStrategy as any) ?? "last-write-wins",
  })
}

describe("Vector Clock Operations", () => {
  it("creates a new vector clock", () => {
    const clock = createVectorClock("c1")
    expect(clock).toEqual({ c1: 0 })
  })

  it("increments a clock", () => {
    let clock = createVectorClock("c1")
    clock = incrementClock(clock, "c1")
    expect(clock.c1).toBe(1)
    clock = incrementClock(clock, "c1")
    expect(clock.c1).toBe(2)
  })

  it("merges two clocks", () => {
    const a = { c1: 3, c2: 1 }
    const b = { c1: 1, c2: 4, c3: 2 }
    const merged = mergeClock(a, b)
    expect(merged).toEqual({ c1: 3, c2: 4, c3: 2 })
  })

  it("detects happens-before", () => {
    expect(happensBefore({ c1: 1 }, { c1: 2 })).toBe(true)
    expect(happensBefore({ c1: 2 }, { c1: 1 })).toBe(false)
    expect(happensBefore({ c1: 1, c2: 1 }, { c1: 2, c2: 2 })).toBe(true)
  })

  it("detects concurrent clocks", () => {
    expect(areConcurrent({ c1: 2, c2: 1 }, { c1: 1, c2: 2 })).toBe(true)
    expect(areConcurrent({ c1: 1 }, { c1: 2 })).toBe(false)
  })

  it("detects equal clocks", () => {
    expect(clocksEqual({ c1: 1 }, { c1: 1 })).toBe(true)
    expect(clocksEqual({ c1: 1 }, { c1: 2 })).toBe(false)
    expect(clocksEqual({}, {})).toBe(true)
  })
})

describe("OfflineSyncEngine", () => {
  describe("mutation queueing", () => {
    it("queues mutations and tracks count", async () => {
      const engine = createEngine()
      await engine.queueMutation("tasks.create", { title: "Test" })
      await engine.queueMutation("tasks.update", { id: "t1", done: true })

      expect(await engine.getPendingCount()).toBe(2)
      expect(engine.syncStatus.pendingMutations).toBe(2)
    })

    it("increments vector clock on queue", async () => {
      const engine = createEngine({ clientId: "c1" })
      expect(engine.vectorClock.c1).toBe(0)

      await engine.queueMutation("tasks.create", { title: "Test" })
      expect(engine.vectorClock.c1).toBe(1)

      await engine.queueMutation("tasks.create", { title: "Test 2" })
      expect(engine.vectorClock.c1).toBe(2)
    })
  })

  describe("sync execution", () => {
    it("syncs all pending mutations", async () => {
      const engine = createEngine()
      await engine.queueMutation("tasks.create", { title: "A" })
      await engine.queueMutation("tasks.create", { title: "B" })

      const executed: string[] = []
      const result = await engine.sync(async (name, args) => {
        executed.push((args as any).title)
      })

      expect(result.synced).toBe(2)
      expect(result.failed).toBe(0)
      expect(executed).toEqual(["A", "B"])
      expect(engine.syncStatus.state).toBe("idle")
    })

    it("handles sync failures with retry", async () => {
      const engine = createEngine()
      await engine.queueMutation("tasks.create", { title: "Fail" })

      let attempts = 0
      const result = await engine.sync(async () => {
        attempts++
        throw new Error("Network error")
      })

      expect(result.failed).toBe(1)
      expect(engine.syncStatus.state).toBe("error")
    })

    it("drops mutations after max retries", async () => {
      const engine = new OfflineSyncEngine({
        storage: new MemoryOfflineStorage(),
        clientId: "c1",
        maxRetries: 2,
      })

      await engine.queueMutation("tasks.create", { title: "Fail" })

      // Sync multiple times to exhaust retries
      await engine.sync(async () => { throw new Error("fail") })
      await engine.sync(async () => { throw new Error("fail") })
      const result = await engine.sync(async () => { throw new Error("fail") })

      // After maxRetries, mutation should be dropped
      expect(result.conflicts.some((c) => c.resolution === "dropped")).toBe(true)
    })

    it("prevents concurrent sync calls", async () => {
      const engine = createEngine()
      await engine.queueMutation("test", {})

      // Start a long sync
      const syncPromise = engine.sync(async () => {
        await new Promise((r) => setTimeout(r, 50))
      })

      // Try concurrent sync — should return immediately
      const concurrent = await engine.sync(async () => {})
      expect(concurrent.synced).toBe(0)

      await syncPromise
    })

    it("emits sync status updates", async () => {
      const statuses: string[] = []
      const engine = new OfflineSyncEngine({
        storage: new MemoryOfflineStorage(),
        clientId: "c1",
        onSyncStatus: (s) => statuses.push(s.state),
      })

      await engine.queueMutation("test", {})
      await engine.sync(async () => {})

      expect(statuses).toContain("syncing")
      expect(statuses[statuses.length - 1]).toBe("idle")
    })
  })

  describe("conflict resolution", () => {
    it("resolves with last-write-wins (default)", () => {
      const engine = createEngine()
      const client = { value: "client", clock: { c1: 2, c2: 1 }, clientId: "c1", timestamp: 200 }
      const server = { value: "server", clock: { c1: 1, c2: 2 }, clientId: "c2", timestamp: 100 }

      const result = engine.resolveVersionConflict(client, server)
      expect(result.winner).toBe("client") // Higher timestamp
      expect(result.value).toBe("client")
    })

    it("resolves with server-wins strategy", () => {
      const engine = new OfflineSyncEngine({
        storage: new MemoryOfflineStorage(),
        clientId: "c1",
        conflictStrategy: "server-wins",
      })

      const client = { value: "client", clock: { c1: 2, c2: 1 }, clientId: "c1", timestamp: 200 }
      const server = { value: "server", clock: { c1: 1, c2: 2 }, clientId: "c2", timestamp: 100 }

      const result = engine.resolveVersionConflict(client, server)
      expect(result.winner).toBe("server")
    })

    it("resolves with custom merge function", () => {
      const engine = new OfflineSyncEngine({
        storage: new MemoryOfflineStorage(),
        clientId: "c1",
        conflictStrategy: "custom",
        customMerge: (client, server) => ({
          ...(server as Record<string, unknown>),
          ...(client as Record<string, unknown>),
          merged: true,
        }),
      })

      const client = { value: { title: "client" }, clock: { c1: 2, c2: 1 }, clientId: "c1", timestamp: 200 }
      const server = { value: { title: "server" }, clock: { c1: 1, c2: 2 }, clientId: "c2", timestamp: 100 }

      const result = engine.resolveVersionConflict(client, server)
      expect(result.winner).toBe("merged")
      expect((result.value as any).merged).toBe(true)
    })

    it("uses causal ordering when not concurrent", () => {
      const engine = createEngine()
      const client = { value: "client", clock: { c1: 3 }, clientId: "c1", timestamp: 100 }
      const server = { value: "server", clock: { c1: 1 }, clientId: "c2", timestamp: 200 }

      // Client happens-after server (c1: 3 > c1: 1), so client wins regardless of timestamp
      const result = engine.resolveVersionConflict(client, server)
      expect(result.winner).toBe("client")
    })

    it("notifies on conflicts during sync", async () => {
      const conflicts: unknown[] = []
      const engine = new OfflineSyncEngine({
        storage: new MemoryOfflineStorage(),
        clientId: "c1",
        conflictStrategy: "server-wins",
        onConflict: (c) => conflicts.push(c),
      })

      await engine.queueMutation("tasks.update", { id: "t1" })
      await engine.sync(async () => { throw new Error("conflict") })

      expect(conflicts).toHaveLength(1)
    })
  })

  describe("cache operations", () => {
    it("caches and retrieves queries", async () => {
      const engine = createEngine()
      await engine.cacheQuery("tasks.list", "all", [{ id: "t1" }], 1)
      const cached = await engine.getCachedQuery("tasks.list", "all")
      expect(cached?.data).toEqual([{ id: "t1" }])
    })

    it("invalidates cached queries", async () => {
      const engine = createEngine()
      await engine.cacheQuery("tasks.list", "all", [], 1)
      await engine.invalidateCache("tasks.list")
      const cached = await engine.getCachedQuery("tasks.list", "all")
      expect(cached).toBeUndefined()
    })
  })

  describe("delta tracking", () => {
    it("tracks field-level changes", () => {
      const engine = createEngine()
      engine.trackDelta("tasks", "t1", { title: "Updated" })
      engine.trackDelta("tasks", "t2", { done: true })

      const deltas = engine.getPendingDeltas()
      expect(deltas).toHaveLength(2)
      expect(deltas[0].fields).toEqual({ title: "Updated" })
    })

    it("merges deltas for the same row", () => {
      const engine = createEngine()
      engine.trackDelta("tasks", "t1", { title: "A" })
      engine.trackDelta("tasks", "t1", { done: true })

      const deltas = engine.getPendingDeltas()
      expect(deltas).toHaveLength(1)
      expect(deltas[0].fields).toEqual({ title: "A", done: true })
    })

    it("clears deltas", () => {
      const engine = createEngine()
      engine.trackDelta("tasks", "t1", { title: "A" })
      engine.clearDeltas()
      expect(engine.getPendingDeltas()).toHaveLength(0)
    })
  })

  describe("vector clock management", () => {
    it("receives and merges remote clocks", () => {
      const engine = createEngine({ clientId: "c1" })
      engine.receiveClock({ c2: 5, c3: 3 })

      const clock = engine.vectorClock
      expect(clock.c2).toBe(5)
      expect(clock.c3).toBe(3)
      expect(clock.c1).toBe(1) // Incremented after merge
    })
  })

  describe("backoff", () => {
    it("calculates exponential backoff", () => {
      const engine = createEngine()
      expect(engine.getBackoffDelay()).toBe(1000) // Initial
    })
  })
})
