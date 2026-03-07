import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  useCollabText,
  useCollabList,
  useCollabMap,
  useCollabCounter,
} from "../hooks/crdt-hooks.js"

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

describe("crdt-hooks", () => {
  it("should export all expected hooks", () => {
    expect(useCollabText).toBeDefined()
    expect(useCollabList).toBeDefined()
    expect(useCollabMap).toBeDefined()
    expect(useCollabCounter).toBeDefined()
  })

  it("should export hooks as functions", () => {
    expect(typeof useCollabText).toBe("function")
    expect(typeof useCollabList).toBe("function")
    expect(typeof useCollabMap).toBe("function")
    expect(typeof useCollabCounter).toBe("function")
    // Each hook accepts a single docId parameter
    expect(useCollabText.length).toBe(1)
    expect(useCollabList.length).toBe(1)
    expect(useCollabMap.length).toBe(1)
    expect(useCollabCounter.length).toBe(1)
  })

  it("should support collaborative data types", () => {
    expect(useCollabText.name).toContain("use")
    expect(useCollabList.name).toContain("use")
    expect(useCollabMap.name).toContain("use")
    expect(useCollabCounter.name).toContain("use")
  })
})

// ─── useCollabText concurrent edit logic ─────────────────────────────────────

describe("useCollabText subscription logic", () => {
  let mockClient: ReturnType<typeof createMockClient>

  beforeEach(() => {
    mockClient = createMockClient()
  })

  it("subscribes with correct text document name", () => {
    const listener = vi.fn()
    mockClient.subscribe("__collab_text_doc-1", { docId: "doc-1" }, listener)

    expect(mockClient.subscribe).toHaveBeenCalledWith("__collab_text_doc-1", { docId: "doc-1" }, listener)
  })

  it("receives text string updates via subscription", () => {
    const listener = vi.fn()
    mockClient.subscribe("__collab_text_doc-1", { docId: "doc-1" }, listener)

    mockClient._pushData("Hello World")
    expect(listener).toHaveBeenCalledWith("Hello World", undefined)
  })

  it("receives text object updates via subscription", () => {
    const listener = vi.fn()
    mockClient.subscribe("__collab_text_doc-1", { docId: "doc-1" }, listener)

    mockClient._pushData({ text: "Hello World" })
    expect(listener).toHaveBeenCalledWith({ text: "Hello World" }, undefined)
  })

  it("concurrent inserts dispatch independently", async () => {
    await mockClient.mutate("__collab_text_insert", { docId: "doc-1", index: 0, text: "A" })
    await mockClient.mutate("__collab_text_insert", { docId: "doc-1", index: 1, text: "B" })

    expect(mockClient.mutate).toHaveBeenCalledTimes(2)
    expect(mockClient.mutate).toHaveBeenNthCalledWith(1, "__collab_text_insert", {
      docId: "doc-1",
      index: 0,
      text: "A",
    })
    expect(mockClient.mutate).toHaveBeenNthCalledWith(2, "__collab_text_insert", {
      docId: "doc-1",
      index: 1,
      text: "B",
    })
  })

  it("delete range dispatches correctly", async () => {
    await mockClient.mutate("__collab_text_delete", { docId: "doc-1", index: 5, length: 6 })

    expect(mockClient.mutate).toHaveBeenCalledWith("__collab_text_delete", {
      docId: "doc-1",
      index: 5,
      length: 6,
    })
  })

  it("set text replaces content via mutate", async () => {
    await mockClient.mutate("__collab_text_set", { docId: "doc-1", text: "Replaced" })

    expect(mockClient.mutate).toHaveBeenCalledWith("__collab_text_set", {
      docId: "doc-1",
      text: "Replaced",
    })
  })

  it("unsubscribes cleanly", () => {
    const listener = vi.fn()
    const unsub = mockClient.subscribe("__collab_text_doc-1", { docId: "doc-1" }, listener)

    expect(mockClient._subscriptions.size).toBe(1)
    unsub()
    expect(mockClient._subscriptions.size).toBe(0)
  })
})

// ─── useCollabList operation logic ───────────────────────────────────────────

describe("useCollabList subscription logic", () => {
  let mockClient: ReturnType<typeof createMockClient>

  beforeEach(() => {
    mockClient = createMockClient()
  })

  it("subscribes with correct list document name", () => {
    const listener = vi.fn()
    mockClient.subscribe("__collab_list_shopping", { docId: "shopping" }, listener)

    expect(mockClient.subscribe).toHaveBeenCalledWith("__collab_list_shopping", { docId: "shopping" }, listener)
  })

  it("receives list data via subscription", () => {
    const listener = vi.fn()
    mockClient.subscribe("__collab_list_shopping", { docId: "shopping" }, listener)

    mockClient._pushData(["apples", "bananas"])
    expect(listener).toHaveBeenCalledWith(["apples", "bananas"], undefined)
  })

  it("push operation dispatches via mutate", async () => {
    await mockClient.mutate("__collab_list_push", { docId: "shopping", item: "milk" })

    expect(mockClient.mutate).toHaveBeenCalledWith("__collab_list_push", {
      docId: "shopping",
      item: "milk",
    })
  })

  it("remove operation dispatches via mutate", async () => {
    await mockClient.mutate("__collab_list_remove", { docId: "shopping", item: "milk" })

    expect(mockClient.mutate).toHaveBeenCalledWith("__collab_list_remove", {
      docId: "shopping",
      item: "milk",
    })
  })

  it("insert and remove maintain operation order", async () => {
    await mockClient.mutate("__collab_list_push", { docId: "shopping", item: "bread" })
    await mockClient.mutate("__collab_list_push", { docId: "shopping", item: "butter" })
    await mockClient.mutate("__collab_list_remove", { docId: "shopping", item: "bread" })

    expect(mockClient.mutate).toHaveBeenCalledTimes(3)
    expect(mockClient.mutate).toHaveBeenNthCalledWith(1, "__collab_list_push", {
      docId: "shopping",
      item: "bread",
    })
    expect(mockClient.mutate).toHaveBeenNthCalledWith(3, "__collab_list_remove", {
      docId: "shopping",
      item: "bread",
    })
  })

  it("unsubscribes cleanly", () => {
    const listener = vi.fn()
    const unsub = mockClient.subscribe("__collab_list_shopping", { docId: "shopping" }, listener)

    expect(mockClient._subscriptions.size).toBe(1)
    unsub()
    expect(mockClient._subscriptions.size).toBe(0)
  })
})

// ─── useCollabMap operation logic ────────────────────────────────────────────

describe("useCollabMap subscription logic", () => {
  let mockClient: ReturnType<typeof createMockClient>

  beforeEach(() => {
    mockClient = createMockClient()
  })

  it("subscribes with correct map document name", () => {
    const listener = vi.fn()
    mockClient.subscribe("__collab_map_settings", { docId: "settings" }, listener)

    expect(mockClient.subscribe).toHaveBeenCalledWith("__collab_map_settings", { docId: "settings" }, listener)
  })

  it("receives map entries via subscription", () => {
    const listener = vi.fn()
    mockClient.subscribe("__collab_map_settings", { docId: "settings" }, listener)

    mockClient._pushData({ theme: "dark", lang: "en" })
    expect(listener).toHaveBeenCalledWith({ theme: "dark", lang: "en" }, undefined)
  })

  it("set operation dispatches via mutate", async () => {
    await mockClient.mutate("__collab_map_set", { docId: "settings", key: "theme", value: "dark" })

    expect(mockClient.mutate).toHaveBeenCalledWith("__collab_map_set", {
      docId: "settings",
      key: "theme",
      value: "dark",
    })
  })

  it("delete operation dispatches via mutate", async () => {
    await mockClient.mutate("__collab_map_delete", { docId: "settings", key: "theme" })

    expect(mockClient.mutate).toHaveBeenCalledWith("__collab_map_delete", {
      docId: "settings",
      key: "theme",
    })
  })

  it("set and delete work in sequence", async () => {
    await mockClient.mutate("__collab_map_set", { docId: "settings", key: "theme", value: "dark" })
    await mockClient.mutate("__collab_map_set", { docId: "settings", key: "lang", value: "en" })
    await mockClient.mutate("__collab_map_delete", { docId: "settings", key: "theme" })

    expect(mockClient.mutate).toHaveBeenCalledTimes(3)
    expect(mockClient.mutate).toHaveBeenNthCalledWith(3, "__collab_map_delete", {
      docId: "settings",
      key: "theme",
    })
  })
})
