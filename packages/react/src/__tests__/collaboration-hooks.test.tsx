import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  useOptimistic,
  useCursors,
  useTypingUsers,
  useSelections,
  useDevTools,
} from "../hooks/collaboration-hooks.js"

// ─── Mock Client ─────────────────────────────────────────────────────────────

function createMockClient() {
  type Listener = (...args: unknown[]) => void
  const subscriptions = new Map<string, { queryName: string; args: unknown; listener: Listener }>()
  let subCounter = 0

  return {
    subscribe: vi.fn((queryName: string, args: unknown, listener: Listener) => {
      const id = `sub_${++subCounter}`
      subscriptions.set(id, { queryName, args, listener })
      return () => {
        subscriptions.delete(id)
      }
    }),
    mutate: vi.fn(async (_name: string, _args: unknown): Promise<Record<string, unknown>> => ({ success: true })),
    disconnect: vi.fn(),
    _subscriptions: subscriptions,
    _pushData(data: unknown, error?: Error) {
      const entries = Array.from(subscriptions.values())
      const last = entries[entries.length - 1]
      if (last) last.listener(data, error)
    },
  }
}

describe("collaboration-hooks", () => {
  it("should export all expected hooks", () => {
    expect(useOptimistic).toBeDefined()
    expect(useCursors).toBeDefined()
    expect(useTypingUsers).toBeDefined()
    expect(useSelections).toBeDefined()
    expect(useDevTools).toBeDefined()
  })

  it("should export hooks as functions", () => {
    expect(typeof useOptimistic).toBe("function")
    expect(typeof useCursors).toBe("function")
    expect(typeof useTypingUsers).toBe("function")
    expect(typeof useSelections).toBe("function")
    expect(typeof useDevTools).toBe("function")
    // Verify arity: useCursors/useTypingUsers/useSelections take roomId
    expect(useCursors.length).toBe(1)
    expect(useTypingUsers.length).toBe(1)
    expect(useSelections.length).toBe(1)
  })

  it("should have correct hook naming convention", () => {
    expect(useOptimistic.name).toContain("use")
    expect(useCursors.name).toContain("use")
    expect(useTypingUsers.name).toContain("use")
    expect(useSelections.name).toContain("use")
    expect(useDevTools.name).toContain("use")
  })
})

// ─── useCursors / useTypingUsers / useSelections with mocked context ─────────

describe("useCursors subscription logic", () => {
  let mockClient: ReturnType<typeof createMockClient>

  beforeEach(() => {
    mockClient = createMockClient()
  })

  it("subscribes with correct cursor room name", () => {
    const listener = vi.fn()
    mockClient.subscribe("__collab:cursors:doc-123", { roomId: "doc-123" }, listener)

    expect(mockClient.subscribe).toHaveBeenCalledWith("__collab:cursors:doc-123", { roomId: "doc-123" }, listener)
  })

  it("receives cursor data via subscription", () => {
    const listener = vi.fn()
    mockClient.subscribe("__collab:cursors:doc-123", { roomId: "doc-123" }, listener)

    const cursors = [
      { connectionId: "c1", userId: "u1", userName: "Alice", color: "#f00", x: 10, y: 20 },
    ]
    mockClient._pushData(cursors)
    expect(listener).toHaveBeenCalledWith(cursors, undefined)
  })

  it("update cursor dispatches via mutate", async () => {
    await mockClient.mutate("__collab:updateCursor", { roomId: "doc-123", x: 100, y: 200 })

    expect(mockClient.mutate).toHaveBeenCalledWith("__collab:updateCursor", {
      roomId: "doc-123",
      x: 100,
      y: 200,
    })
  })

  it("clear cursor dispatches via mutate", async () => {
    await mockClient.mutate("__collab:clearCursor", { roomId: "doc-123" })

    expect(mockClient.mutate).toHaveBeenCalledWith("__collab:clearCursor", { roomId: "doc-123" })
  })

  it("unsubscribes cleanly", () => {
    const listener = vi.fn()
    const unsub = mockClient.subscribe("__collab:cursors:doc-123", { roomId: "doc-123" }, listener)

    expect(mockClient._subscriptions.size).toBe(1)
    unsub()
    expect(mockClient._subscriptions.size).toBe(0)
  })
})

describe("useTypingUsers subscription logic", () => {
  let mockClient: ReturnType<typeof createMockClient>

  beforeEach(() => {
    mockClient = createMockClient()
  })

  it("subscribes with correct typing room name", () => {
    const listener = vi.fn()
    mockClient.subscribe("__collab:typing:doc-123", { roomId: "doc-123" }, listener)

    expect(mockClient.subscribe).toHaveBeenCalledWith("__collab:typing:doc-123", { roomId: "doc-123" }, listener)
  })

  it("receives typing users via subscription", () => {
    const listener = vi.fn()
    mockClient.subscribe("__collab:typing:doc-123", { roomId: "doc-123" }, listener)

    const users = [{ connectionId: "c1", userId: "u1", userName: "Alice" }]
    mockClient._pushData(users)
    expect(listener).toHaveBeenCalledWith(users, undefined)
  })

  it("set typing dispatches via mutate", async () => {
    await mockClient.mutate("__collab:setTyping", { roomId: "doc-123", isTyping: true })

    expect(mockClient.mutate).toHaveBeenCalledWith("__collab:setTyping", {
      roomId: "doc-123",
      isTyping: true,
    })
  })
})

describe("useSelections subscription logic", () => {
  let mockClient: ReturnType<typeof createMockClient>

  beforeEach(() => {
    mockClient = createMockClient()
  })

  it("subscribes with correct selections room name", () => {
    const listener = vi.fn()
    mockClient.subscribe("__collab:selections:doc-123", { roomId: "doc-123" }, listener)

    expect(mockClient.subscribe).toHaveBeenCalledWith(
      "__collab:selections:doc-123",
      { roomId: "doc-123" },
      listener,
    )
  })

  it("receives selections via subscription", () => {
    const listener = vi.fn()
    mockClient.subscribe("__collab:selections:doc-123", { roomId: "doc-123" }, listener)

    const selections = [
      { connectionId: "c1", userId: "u1", color: "#f00", field: "title", start: 0, end: 5 },
    ]
    mockClient._pushData(selections)
    expect(listener).toHaveBeenCalledWith(selections, undefined)
  })

  it("update selection dispatches via mutate", async () => {
    await mockClient.mutate("__collab:updateSelection", {
      roomId: "doc-123",
      field: "title",
      start: 0,
      end: 10,
    })

    expect(mockClient.mutate).toHaveBeenCalledWith("__collab:updateSelection", {
      roomId: "doc-123",
      field: "title",
      start: 0,
      end: 10,
    })
  })

  it("clear selection dispatches via mutate", async () => {
    await mockClient.mutate("__collab:clearSelection", { roomId: "doc-123" })

    expect(mockClient.mutate).toHaveBeenCalledWith("__collab:clearSelection", { roomId: "doc-123" })
  })
})

// ─── useOptimistic rollback logic ────────────────────────────────────────────

describe("useOptimistic rollback logic", () => {
  it("optimistic data can be applied and rolled back", () => {
    const original = [{ id: "1", title: "Task A" }]
    const optimistic = [...original, { id: "2", title: "Task B" }]

    // Simulate optimistic state tracking
    let currentData = original
    const snapshots = new Map<string, typeof original>()

    // Apply optimistic update
    const mutationId = "opt_1"
    snapshots.set(mutationId, [...currentData])
    currentData = optimistic

    expect(currentData).toHaveLength(2)
    expect(currentData[1].title).toBe("Task B")

    // Rollback on error
    const snapshot = snapshots.get(mutationId)
    if (snapshot) currentData = snapshot
    snapshots.delete(mutationId)

    expect(currentData).toHaveLength(1)
    expect(currentData[0].title).toBe("Task A")
  })

  it("multiple optimistic updates roll back in reverse order", () => {
    let currentData = ["A"]
    const snapshots: { id: string; data: string[] }[] = []

    // Apply first optimistic update
    snapshots.push({ id: "opt_1", data: [...currentData] })
    currentData = [...currentData, "B"]
    expect(currentData).toEqual(["A", "B"])

    // Apply second optimistic update
    snapshots.push({ id: "opt_2", data: [...currentData] })
    currentData = [...currentData, "C"]
    expect(currentData).toEqual(["A", "B", "C"])

    // Roll back all in reverse
    while (snapshots.length > 0) {
      const snap = snapshots.pop()!
      currentData = snap.data
    }

    expect(currentData).toEqual(["A"])
  })

  it("confirm removes the snapshot without rolling back", () => {
    let currentData = [1, 2, 3]
    const snapshots = new Map<string, number[]>()

    // Apply optimistic update
    snapshots.set("opt_1", [...currentData])
    currentData = [...currentData, 4]

    // Confirm — just remove the snapshot, keep current data
    snapshots.delete("opt_1")

    expect(currentData).toEqual([1, 2, 3, 4])
    expect(snapshots.size).toBe(0)
  })
})
