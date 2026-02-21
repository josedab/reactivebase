import { describe, it, expect } from "vitest"
import { QueryCache } from "../cache/query-cache.js"

describe("query cache", () => {
  it("stores and retrieves cache entries", () => {
    const cache = new QueryCache()

    cache.set("sub1", {
      queryName: "listTasks",
      args: { userId: "u1" },
      data: [{ id: "1", title: "Task 1" }],
      version: 1,
    })

    const entry = cache.get("sub1")
    expect(entry).toBeDefined()
    expect(entry!.queryName).toBe("listTasks")
    expect(entry!.data).toEqual([{ id: "1", title: "Task 1" }])
    expect(entry!.isStale).toBe(false)
  })

  it("updates cache entries", () => {
    const cache = new QueryCache()

    cache.set("sub1", {
      queryName: "listTasks",
      args: {},
      data: [{ id: "1" }],
      version: 1,
    })

    cache.update("sub1", [{ id: "1" }, { id: "2" }], 2)

    const entry = cache.get("sub1")
    expect(entry!.version).toBe(2)
    expect((entry!.data as unknown[]).length).toBe(2)
  })

  it("marks entries as stale", () => {
    const cache = new QueryCache()

    cache.set("sub1", {
      queryName: "q1",
      args: {},
      data: [],
      version: 1,
    })

    cache.markStale("sub1")
    expect(cache.get("sub1")!.isStale).toBe(true)
  })

  it("marks all entries as stale", () => {
    const cache = new QueryCache()

    cache.set("sub1", { queryName: "q1", args: {}, data: [], version: 1 })
    cache.set("sub2", { queryName: "q2", args: {}, data: [], version: 1 })

    cache.markAllStale()

    expect(cache.get("sub1")!.isStale).toBe(true)
    expect(cache.get("sub2")!.isStale).toBe(true)
  })

  it("removes cache entries", () => {
    const cache = new QueryCache()

    cache.set("sub1", { queryName: "q1", args: {}, data: [], version: 1 })
    cache.remove("sub1")

    expect(cache.get("sub1")).toBeUndefined()
  })

  it("notifies listeners on update", () => {
    const cache = new QueryCache()
    const received: unknown[] = []

    cache.set("sub1", { queryName: "q1", args: {}, data: [], version: 1 })
    cache.listen("sub1", (entry) => received.push(entry.data))
    cache.update("sub1", [{ id: "new" }], 2)

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual([{ id: "new" }])
  })

  it("applies and rolls back optimistic updates", () => {
    const cache = new QueryCache()

    cache.set("sub1", {
      queryName: "q1",
      args: {},
      data: [{ id: "1", done: false }],
      version: 1,
    })

    const rollback = cache.applyOptimisticUpdate("sub1", (data) => {
      const items = data as Array<{ id: string; done: boolean }>
      items[0].done = true
      return items
    })

    expect((cache.get("sub1")!.data as Array<{ done: boolean }>)[0].done).toBe(true)
    expect(cache.pendingOptimisticUpdates).toBe(1)

    rollback()
    expect((cache.get("sub1")!.data as Array<{ done: boolean }>)[0].done).toBe(false)
    expect(cache.pendingOptimisticUpdates).toBe(0)
  })

  it("applies optimistic updates by query name", () => {
    const cache = new QueryCache()

    cache.set("sub1", {
      queryName: "listTasks",
      args: { userId: "u1" },
      data: [{ id: "1", title: "Old" }],
      version: 1,
    })
    cache.set("sub2", {
      queryName: "listTasks",
      args: { userId: "u2" },
      data: [{ id: "2", title: "Old" }],
      version: 1,
    })
    cache.set("sub3", {
      queryName: "getUser",
      args: {},
      data: { name: "test" },
      version: 1,
    })

    const rollback = cache.applyOptimisticUpdateByQuery("listTasks", (data) => {
      return (data as Array<{ id: string; title: string }>).map((t) => ({
        ...t,
        title: "Updated",
      }))
    })

    expect((cache.get("sub1")!.data as Array<{ title: string }>)[0].title).toBe("Updated")
    expect((cache.get("sub2")!.data as Array<{ title: string }>)[0].title).toBe("Updated")
    expect((cache.get("sub3")!.data as { name: string }).name).toBe("test")

    rollback()
    expect((cache.get("sub1")!.data as Array<{ title: string }>)[0].title).toBe("Old")
    expect((cache.get("sub2")!.data as Array<{ title: string }>)[0].title).toBe("Old")
  })
})
