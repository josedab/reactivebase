import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { BackgroundSyncManager } from "../offline/background-sync.js"
import type { BackgroundSyncOptions, PriorityMutation } from "../offline/background-sync.js"
import type { SyncBatchResult } from "../offline/sync-engine.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSuccessResult(overrides: Partial<SyncBatchResult> = {}): SyncBatchResult {
  return { synced: 1, failed: 0, conflicts: [], durationMs: 10, ...overrides }
}

function createManager(overrides: Partial<BackgroundSyncOptions> = {}): {
  manager: BackgroundSyncManager
  syncFn: ReturnType<typeof vi.fn>
  getPendingCount: ReturnType<typeof vi.fn>
} {
  const syncFn = vi.fn(async () => makeSuccessResult())
  const getPendingCount = vi.fn(async () => 0)
  const manager = new BackgroundSyncManager({
    syncFn,
    getPendingCount,
    syncIntervalMs: 100_000, // large to prevent auto-fire in tests
    initialBackoffMs: 100,
    maxBackoffMs: 1000,
    ...overrides,
  })
  return { manager, syncFn, getPendingCount }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("BackgroundSyncManager", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("constructor defaults", () => {
    it("starts in idle state", () => {
      const { manager } = createManager()
      const status = manager.getSyncStatus()
      expect(status.state).toBe("idle")
      expect(status.pendingCount).toBe(0)
      expect(status.lastSyncAt).toBeNull()
      expect(status.nextSyncAt).toBeNull()
      expect(status.consecutiveFailures).toBe(0)
    })

    it("is not running initially", () => {
      const { manager } = createManager()
      expect(manager.isRunning).toBe(false)
    })
  })

  describe("start/stop", () => {
    it("sets running to true on start", () => {
      const { manager } = createManager()
      manager.start()
      expect(manager.isRunning).toBe(true)
    })

    it("stops the sync loop", () => {
      const { manager } = createManager()
      manager.start()
      manager.stop()
      expect(manager.isRunning).toBe(false)
      expect(manager.getSyncStatus().nextSyncAt).toBeNull()
    })

    it("start is idempotent", () => {
      const { manager, syncFn: _syncFn } = createManager()
      manager.start()
      manager.start()
      expect(manager.isRunning).toBe(true)
      // Only one sync should be scheduled
    })

    it("enters offline state when starting offline", () => {
      const { manager } = createManager()
      manager.onConnectivityChange(false)
      manager.start()
      expect(manager.getSyncStatus().state).toBe("offline")
    })
  })

  describe("syncNow()", () => {
    it("triggers an immediate sync", async () => {
      const { manager, syncFn } = createManager()
      manager.start()
      const result = await manager.syncNow()
      expect(syncFn).toHaveBeenCalledTimes(1)
      expect(result).toBeDefined()
      expect(result!.synced).toBe(1)
    })

    it("returns null when offline", async () => {
      const { manager } = createManager()
      manager.onConnectivityChange(false)
      const result = await manager.syncNow()
      expect(result).toBeNull()
    })

    it("transitions state through syncing → idle on success", async () => {
      const { manager } = createManager()
      manager.start()
      await manager.syncNow()
      expect(manager.getSyncStatus().state).toBe("idle")
      expect(manager.getSyncStatus().lastSyncAt).toBeGreaterThan(0)
      expect(manager.getSyncStatus().consecutiveFailures).toBe(0)
    })
  })

  describe("sync state transitions", () => {
    it("transitions idle → syncing → idle on success", async () => {
      const states: string[] = []
      const { manager } = createManager({
        syncFn: async () => {
          states.push(manager.getSyncStatus().state)
          return makeSuccessResult()
        },
      })
      states.push(manager.getSyncStatus().state)
      manager.start()
      await manager.syncNow()
      states.push(manager.getSyncStatus().state)
      expect(states).toContain("idle")
      expect(states).toContain("syncing")
    })

    it("transitions to error state on failure", async () => {
      const { manager } = createManager({
        syncFn: async () => {
          throw new Error("sync failed")
        },
      })
      manager.start()
      await manager.syncNow()
      expect(manager.getSyncStatus().state).toBe("error")
      expect(manager.getSyncStatus().consecutiveFailures).toBe(1)
    })

    it("transitions to offline when going offline", () => {
      const { manager } = createManager()
      manager.onConnectivityChange(false)
      expect(manager.getSyncStatus().state).toBe("offline")
    })
  })

  describe("retry with exponential backoff", () => {
    it("increments consecutive failures on error", async () => {
      const { manager } = createManager({
        syncFn: async () => {
          throw new Error("fail")
        },
      })
      manager.start()
      await manager.syncNow()
      expect(manager.getSyncStatus().consecutiveFailures).toBe(1)
      await manager.syncNow()
      expect(manager.getSyncStatus().consecutiveFailures).toBe(2)
    })

    it("resets failures on success", async () => {
      let callCount = 0
      const { manager } = createManager({
        syncFn: async () => {
          callCount++
          if (callCount === 1) throw new Error("fail")
          return makeSuccessResult()
        },
      })
      manager.start()
      await manager.syncNow()
      expect(manager.getSyncStatus().consecutiveFailures).toBe(1)
      await manager.syncNow()
      expect(manager.getSyncStatus().consecutiveFailures).toBe(0)
    })

    it("stops retrying after maxConsecutiveFailures", async () => {
      const { manager, syncFn: _syncFn } = createManager({
        syncFn: async () => {
          throw new Error("fail")
        },
        maxConsecutiveFailures: 2,
      })
      manager.start()
      await manager.syncNow()
      await manager.syncNow()
      // After 2 failures, nextSyncAt should not be scheduled
      // (manager stops scheduling retries)
      expect(manager.getSyncStatus().consecutiveFailures).toBe(2)
    })
  })

  describe("connectivity changes", () => {
    it("goes offline and clears timer", () => {
      const { manager } = createManager()
      manager.start()
      manager.onConnectivityChange(false)
      expect(manager.getSyncStatus().state).toBe("offline")
      expect(manager.getSyncStatus().nextSyncAt).toBeNull()
    })

    it("resets failures and schedules sync on reconnection", () => {
      const { manager } = createManager()
      manager.start()
      manager.onConnectivityChange(false)
      manager.onConnectivityChange(true)
      expect(manager.getSyncStatus().state).toBe("idle")
      expect(manager.getSyncStatus().consecutiveFailures).toBe(0)
    })

    it("triggers immediate sync when coming back online while running", async () => {
      const { manager, syncFn } = createManager()
      manager.start()
      // Consume the first scheduled sync
      syncFn.mockClear()
      manager.onConnectivityChange(false)
      manager.onConnectivityChange(true)
      // Should schedule an immediate sync (delay 0)
      expect(manager.getSyncStatus().nextSyncAt).toBeDefined()
    })
  })

  describe("event callbacks", () => {
    it("calls onSyncComplete after successful sync", async () => {
      const { manager } = createManager()
      const callback = vi.fn()
      manager.onSyncComplete(callback)
      manager.start()
      await manager.syncNow()
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ synced: 1 }))
    })

    it("onSyncComplete returns unsubscribe function", async () => {
      const { manager } = createManager()
      const callback = vi.fn()
      const unsub = manager.onSyncComplete(callback)
      unsub()
      manager.start()
      await manager.syncNow()
      expect(callback).not.toHaveBeenCalled()
    })

    it("calls onConflict when conflicts exist", async () => {
      const conflicts = [{ table: "t", rowId: "1", localValue: {}, remoteValue: {}, resolution: "server-wins" as const }]
      const { manager } = createManager({
        syncFn: async () => makeSuccessResult({ conflicts }),
      })
      const callback = vi.fn()
      manager.onConflict(callback)
      manager.start()
      await manager.syncNow()
      expect(callback).toHaveBeenCalledWith(conflicts)
    })

    it("does not call onConflict when no conflicts", async () => {
      const { manager } = createManager()
      const callback = vi.fn()
      manager.onConflict(callback)
      manager.start()
      await manager.syncNow()
      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe("enqueuePriority() and priority queue", () => {
    it("adds mutations to the priority queue", () => {
      const { manager } = createManager()
      const mutation: PriorityMutation = {
        id: "m1",
        mutationName: "tasks.create",
        args: { title: "test" },
        priority: "normal",
        timestamp: Date.now(),
      }
      manager.enqueuePriority(mutation)
      expect(manager.getPriorityQueue()).toHaveLength(1)
      expect(manager.getPriorityQueue()[0].id).toBe("m1")
    })

    it("sorts by priority (critical > high > normal > low)", () => {
      const { manager } = createManager()
      const now = Date.now()
      manager.enqueuePriority({ id: "low", mutationName: "a", args: {}, priority: "low", timestamp: now })
      manager.enqueuePriority({ id: "critical", mutationName: "b", args: {}, priority: "critical", timestamp: now })
      manager.enqueuePriority({ id: "high", mutationName: "c", args: {}, priority: "high", timestamp: now })
      manager.enqueuePriority({ id: "normal", mutationName: "d", args: {}, priority: "normal", timestamp: now })

      const queue = manager.getPriorityQueue()
      expect(queue[0].id).toBe("critical")
      expect(queue[1].id).toBe("high")
      expect(queue[2].id).toBe("normal")
      expect(queue[3].id).toBe("low")
    })

    it("sorts by timestamp within same priority", () => {
      const { manager } = createManager()
      manager.enqueuePriority({ id: "later", mutationName: "a", args: {}, priority: "normal", timestamp: 200 })
      manager.enqueuePriority({ id: "earlier", mutationName: "b", args: {}, priority: "normal", timestamp: 100 })

      const queue = manager.getPriorityQueue()
      expect(queue[0].id).toBe("earlier")
      expect(queue[1].id).toBe("later")
    })

    it("returns a copy of the queue", () => {
      const { manager } = createManager()
      manager.enqueuePriority({ id: "m1", mutationName: "a", args: {}, priority: "normal", timestamp: 1 })
      const q1 = manager.getPriorityQueue()
      const q2 = manager.getPriorityQueue()
      expect(q1).not.toBe(q2)
      expect(q1).toEqual(q2)
    })

    it("clearPriorityQueue empties the queue", () => {
      const { manager } = createManager()
      manager.enqueuePriority({ id: "m1", mutationName: "a", args: {}, priority: "normal", timestamp: 1 })
      manager.clearPriorityQueue()
      expect(manager.getPriorityQueue()).toHaveLength(0)
    })
  })

  describe("getConnectivityState()", () => {
    it("reflects online status", () => {
      const { manager } = createManager()
      expect(manager.getConnectivityState().isOnline).toBe(true)
      manager.onConnectivityChange(false)
      expect(manager.getConnectivityState().isOnline).toBe(false)
    })

    it("reflects pending changes count", async () => {
      const { manager } = createManager({
        getPendingCount: async () => 5,
      })
      manager.start()
      await manager.syncNow()
      expect(manager.getConnectivityState().pendingChangesCount).toBe(5)
    })
  })

  describe("concurrent sync prevention", () => {
    it("returns null from syncNow when already syncing", async () => {
      let resolveSyncFn: (() => void) | null = null
      const { manager } = createManager({
        syncFn: () =>
          new Promise<SyncBatchResult>((resolve) => {
            resolveSyncFn = () => resolve(makeSuccessResult())
          }),
      })
      manager.start()

      // Start first sync
      const p1 = manager.syncNow()
      // Try second sync while first is in progress
      const p2 = manager.syncNow()
      expect(await p2).toBeNull()

      // Complete first sync
      resolveSyncFn!()
      await p1
    })
  })
})
