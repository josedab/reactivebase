import { describe, it, expect, vi, beforeEach } from "vitest"
import { OptimisticUpdateManager } from "../optimistic/optimistic.js"
import type { OptimisticCacheAdapter } from "../optimistic/optimistic.js"

function createMockCache(): OptimisticCacheAdapter & { store: Map<string, { data: unknown; version: number }> } {
  const store = new Map<string, { data: unknown; version: number }>()
  return {
    store,
    get(subscriptionId: string) {
      return store.get(subscriptionId)
    },
    update(subscriptionId: string, data: unknown, version: number) {
      store.set(subscriptionId, { data, version })
    },
  }
}

describe("OptimisticUpdateManager", () => {
  let cache: ReturnType<typeof createMockCache>
  let manager: OptimisticUpdateManager

  beforeEach(() => {
    cache = createMockCache()
    manager = new OptimisticUpdateManager(cache)
  })

  it("applies optimistic update to cache", () => {
    cache.update("sub_tasks", ["task1"], 1)

    manager.apply({
      mutationId: "m1",
      subscriptionId: "sub_tasks",
      optimisticData: ["task1", "task2"],
    })

    expect(cache.store.get("sub_tasks")!.data).toEqual(["task1", "task2"])
  })

  it("creates snapshot with original data", () => {
    cache.update("sub_tasks", ["task1"], 1)

    manager.apply({
      mutationId: "m1",
      subscriptionId: "sub_tasks",
      optimisticData: ["task1", "task2"],
    })

    const snapshot = manager.getSnapshot("m1")
    expect(snapshot).toBeDefined()
    expect(snapshot!.originalData).toEqual(["task1"])
    expect(snapshot!.originalVersion).toBe(1)
    expect(snapshot!.status).toBe("pending")
  })

  it("rolls back to original data", () => {
    cache.update("sub_tasks", ["original"], 1)

    manager.apply({
      mutationId: "m1",
      subscriptionId: "sub_tasks",
      optimisticData: ["optimistic"],
    })

    const result = manager.rollback("m1")
    expect(result).toBeDefined()
    expect(result!.status).toBe("rolled-back")
    expect(cache.store.get("sub_tasks")!.data).toEqual(["original"])
  })

  it("confirms mutation with server data", () => {
    cache.update("sub_tasks", ["original"], 1)

    manager.apply({
      mutationId: "m1",
      subscriptionId: "sub_tasks",
      optimisticData: ["optimistic"],
    })

    manager.confirm("m1", ["server-data"])
    expect(cache.store.get("sub_tasks")!.data).toEqual(["server-data"])
    expect(manager.getSnapshot("m1")!.status).toBe("confirmed")
  })

  it("confirms without server data keeps optimistic data", () => {
    cache.update("sub_tasks", ["original"], 1)

    manager.apply({
      mutationId: "m1",
      subscriptionId: "sub_tasks",
      optimisticData: ["optimistic"],
    })

    manager.confirm("m1")
    expect(cache.store.get("sub_tasks")!.data).toEqual(["optimistic"])
  })

  it("tracks pending mutations", () => {
    manager.apply({ mutationId: "m1", subscriptionId: "sub1", optimisticData: "a" })
    manager.apply({ mutationId: "m2", subscriptionId: "sub1", optimisticData: "b" })
    manager.apply({ mutationId: "m3", subscriptionId: "sub2", optimisticData: "c" })

    expect(manager.getPendingCount()).toBe(3)
    expect(manager.getPendingCount("sub1")).toBe(2)
    expect(manager.hasPending("sub1")).toBe(true)

    manager.confirm("m1")
    expect(manager.getPendingCount()).toBe(2)
  })

  it("calls onRollback callback", () => {
    const onRollback = vi.fn()
    manager = new OptimisticUpdateManager(cache, { onRollback })

    manager.apply({ mutationId: "m1", subscriptionId: "sub1", optimisticData: "a" })
    manager.rollback("m1")

    expect(onRollback).toHaveBeenCalledOnce()
    expect(onRollback.mock.calls[0][0].mutationId).toBe("m1")
  })

  it("calls onConfirm callback", () => {
    const onConfirm = vi.fn()
    manager = new OptimisticUpdateManager(cache, { onConfirm })

    manager.apply({ mutationId: "m1", subscriptionId: "sub1", optimisticData: "a" })
    manager.confirm("m1")

    expect(onConfirm).toHaveBeenCalledWith("m1")
  })

  it("auto-rollback on timeout", async () => {
    const onTimeout = vi.fn()
    manager = new OptimisticUpdateManager(cache, { timeoutMs: 50, onTimeout })

    cache.update("sub1", "original", 1)
    manager.apply({ mutationId: "m1", subscriptionId: "sub1", optimisticData: "optimistic" })

    await new Promise((r) => setTimeout(r, 100))

    expect(onTimeout).toHaveBeenCalledWith("m1")
    expect(cache.store.get("sub1")!.data).toBe("original")
  })

  it("rollbackAll rolls back all pending mutations", () => {
    cache.update("sub1", "orig1", 1)
    cache.update("sub2", "orig2", 1)

    manager.apply({ mutationId: "m1", subscriptionId: "sub1", optimisticData: "opt1" })
    manager.apply({ mutationId: "m2", subscriptionId: "sub2", optimisticData: "opt2" })
    manager.confirm("m1") // m1 is confirmed, should not be rolled back

    const rolledBack = manager.rollbackAll()
    expect(rolledBack).toHaveLength(1)
    expect(rolledBack[0].mutationId).toBe("m2")
  })

  it("resolves conflict with default (server wins)", async () => {
    manager.apply({ mutationId: "m1", subscriptionId: "sub1", optimisticData: "local" })

    const resolved = await manager.resolveConflict("m1", "server")
    expect(resolved).toBe("server")
    expect(cache.store.get("sub1")!.data).toBe("server")
  })

  it("resolves conflict with custom resolver", async () => {
    manager.setConflictResolver((conflict) => {
      return { merged: true, local: conflict.localData, server: conflict.serverData }
    })

    manager.apply({ mutationId: "m1", subscriptionId: "sub1", optimisticData: "local" })

    const resolved = await manager.resolveConflict("m1", "server")
    expect(resolved).toEqual({ merged: true, local: "local", server: "server" })
  })

  it("clears all snapshots and timeouts", () => {
    manager.apply({ mutationId: "m1", subscriptionId: "sub1", optimisticData: "a" })
    manager.apply({ mutationId: "m2", subscriptionId: "sub2", optimisticData: "b" })

    manager.clear()
    expect(manager.getPendingCount()).toBe(0)
    expect(manager.getSnapshot("m1")).toBeUndefined()
  })

  it("does not rollback already confirmed mutation", () => {
    cache.update("sub1", "original", 1)
    manager.apply({ mutationId: "m1", subscriptionId: "sub1", optimisticData: "opt" })
    manager.confirm("m1", "confirmed")

    const result = manager.rollback("m1")
    expect(result).toBeUndefined()
    expect(cache.store.get("sub1")!.data).toBe("confirmed")
  })

  it("handles snapshot for missing cache entry", () => {
    const snapshot = manager.apply({
      mutationId: "m1",
      subscriptionId: "nonexistent",
      optimisticData: "new",
    })
    expect(snapshot.originalData).toBeNull()
    expect(snapshot.originalVersion).toBe(0)
  })
})
