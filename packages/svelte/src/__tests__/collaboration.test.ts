/**
 * Tests for Svelte collaboration stores — verifies store contract,
 * subscription behavior, action methods, and client interaction.
 */

import { describe, it, expect, vi, afterEach } from "vitest"

// Mock @reactivebase/client
vi.mock("@reactivebase/client", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    ReactiveBaseClient: vi.fn().mockImplementation(() => ({
      subscribe: vi.fn((_queryName: string, _args: unknown, cb: (result: unknown, err?: Error) => void) => {
        cb([{ id: 1, name: "Task 1" }])
        return () => {}
      }),
      mutate: vi.fn(async () => ({ result: "ok" })),
      runAction: vi.fn(async () => ({ result: "done" })),
      disconnect: vi.fn(),
    })),
  }
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function setupClient() {
  const { initReactiveBase, getReactiveBaseClient } = await import("../index.js")
  initReactiveBase({ url: "ws://localhost:4000" })
  return getReactiveBaseClient()
}

// ─── collabTextStore ─────────────────────────────────────────────────────────

describe("collabTextStore", () => {
  afterEach(async () => {
    const { destroyReactiveBase } = await import("../index.js")
    destroyReactiveBase()
  })

  it("implements Svelte store contract", async () => {
    await setupClient()
    const { collabTextStore } = await import("../collaboration.js")
    const store = collabTextStore("doc-1")
    expect(typeof store.subscribe).toBe("function")
  })

  it("emits initial state on subscribe", async () => {
    await setupClient()
    const { collabTextStore } = await import("../collaboration.js")
    const store = collabTextStore("doc-1")
    const values: unknown[] = []

    const unsub = store.subscribe((val) => values.push(val))
    expect(values.length).toBeGreaterThanOrEqual(1)
    expect(values[0]).toMatchObject({ text: "", loading: expect.any(Boolean) })
    unsub()
  })

  it("subscribes to __collab_text_{docId}", async () => {
    const client = await setupClient()
    const { collabTextStore } = await import("../collaboration.js")
    const store = collabTextStore("doc-42")
    const unsub = store.subscribe(() => {})

    expect(client.subscribe).toHaveBeenCalledWith("__collab_text_doc-42", { docId: "doc-42" }, expect.any(Function))
    unsub()
  })

  it("setText updates state and calls mutate", async () => {
    const client = await setupClient()
    const { collabTextStore } = await import("../collaboration.js")
    const store = collabTextStore("doc-1")
    const values: Array<{ text: string }> = []

    const unsub = store.subscribe((val) => values.push(val))
    store.setText("Hello world")

    expect(client.mutate).toHaveBeenCalledWith("__collab_text_set", { docId: "doc-1", text: "Hello world" })
    expect(values[values.length - 1].text).toBe("Hello world")
    unsub()
  })

  it("insert updates state and calls mutate", async () => {
    const client = await setupClient()
    const { collabTextStore } = await import("../collaboration.js")
    const store = collabTextStore("doc-1")
    const values: Array<{ text: string; length: number }> = []

    const unsub = store.subscribe((val) => values.push(val))
    store.setText("Hello")
    store.insert(5, " world")

    expect(client.mutate).toHaveBeenCalledWith("__collab_text_insert", { docId: "doc-1", index: 5, text: " world" })
    expect(values[values.length - 1].text).toBe("Hello world")
    expect(values[values.length - 1].length).toBe(11)
    unsub()
  })

  it("deleteRange updates state and calls mutate", async () => {
    const client = await setupClient()
    const { collabTextStore } = await import("../collaboration.js")
    const store = collabTextStore("doc-1")

    const values: Array<{ text: string }> = []
    const unsub = store.subscribe((val) => values.push(val))
    store.setText("Hello world")
    store.deleteRange(5, 6)

    expect(client.mutate).toHaveBeenCalledWith("__collab_text_delete", { docId: "doc-1", index: 5, length: 6 })
    expect(values[values.length - 1].text).toBe("Hello")
    unsub()
  })

  it("unsubscribe removes subscriber", async () => {
    await setupClient()
    const { collabTextStore } = await import("../collaboration.js")
    const store = collabTextStore("doc-1")
    let callCount = 0

    const unsub = store.subscribe(() => {
      callCount++
    })
    const beforeCount = callCount
    unsub()

    store.setText("After unsubscribe")
    expect(callCount).toBe(beforeCount)
  })
})

// ─── collabListStore ─────────────────────────────────────────────────────────

describe("collabListStore", () => {
  afterEach(async () => {
    const { destroyReactiveBase } = await import("../index.js")
    destroyReactiveBase()
  })

  it("implements Svelte store contract", async () => {
    await setupClient()
    const { collabListStore } = await import("../collaboration.js")
    const store = collabListStore("list-1")
    expect(typeof store.subscribe).toBe("function")
  })

  it("push adds item and calls mutate", async () => {
    const client = await setupClient()
    const { collabListStore } = await import("../collaboration.js")
    const store = collabListStore<string>("list-1")
    const values: Array<{ items: unknown[]; length: number }> = []

    const unsub = store.subscribe((val) => values.push(val))
    store.push("Milk")
    store.push("Bread")

    expect(client.mutate).toHaveBeenCalledWith("__collab_list_push", { docId: "list-1", item: "Milk" })
    expect(values[values.length - 1].items).toContain("Milk")
    expect(values[values.length - 1].items).toContain("Bread")
    unsub()
  })

  it("remove removes item and calls mutate", async () => {
    const client = await setupClient()
    const { collabListStore } = await import("../collaboration.js")
    const store = collabListStore<string>("list-1")
    const values: Array<{ items: unknown[] }> = []

    const unsub = store.subscribe((val) => values.push(val))
    store.push("Milk")
    store.push("Bread")
    store.remove("Milk")

    expect(client.mutate).toHaveBeenCalledWith("__collab_list_remove", { docId: "list-1", item: "Milk" })
    // The mock subscription injects data; verify Milk was removed and Bread remains
    const lastItems = values[values.length - 1].items
    expect(lastItems).toContain("Bread")
    expect(lastItems).not.toContain("Milk")
    unsub()
  })

  it("has checks membership", async () => {
    await setupClient()
    const { collabListStore } = await import("../collaboration.js")
    const store = collabListStore<string>("list-1")

    const unsub = store.subscribe(() => {})
    store.push("Milk")

    expect(store.has("Milk")).toBe(true)
    expect(store.has("Eggs")).toBe(false)
    unsub()
  })
})

// ─── collabMapStore ──────────────────────────────────────────────────────────

describe("collabMapStore", () => {
  afterEach(async () => {
    const { destroyReactiveBase } = await import("../index.js")
    destroyReactiveBase()
  })

  it("implements Svelte store contract", async () => {
    await setupClient()
    const { collabMapStore } = await import("../collaboration.js")
    const store = collabMapStore("map-1")
    expect(typeof store.subscribe).toBe("function")
  })

  it("set adds entry and calls mutate", async () => {
    const client = await setupClient()
    const { collabMapStore } = await import("../collaboration.js")
    const store = collabMapStore<string>("map-1")
    const values: Array<{ entries: Record<string, unknown>; keys: string[] }> = []

    const unsub = store.subscribe((val) => values.push(val))
    store.set("theme", "dark")

    expect(client.mutate).toHaveBeenCalledWith("__collab_map_set", { docId: "map-1", key: "theme", value: "dark" })
    expect(values[values.length - 1].entries).toHaveProperty("theme", "dark")
    expect(values[values.length - 1].keys).toContain("theme")
    unsub()
  })

  it("get returns value by key", async () => {
    await setupClient()
    const { collabMapStore } = await import("../collaboration.js")
    const store = collabMapStore<string>("map-1")

    const unsub = store.subscribe(() => {})
    store.set("theme", "dark")

    expect(store.get("theme")).toBe("dark")
    expect(store.get("nonexistent")).toBeUndefined()
    unsub()
  })

  it("deleteKey removes entry and calls mutate", async () => {
    const client = await setupClient()
    const { collabMapStore } = await import("../collaboration.js")
    const store = collabMapStore<string>("map-1")
    const values: Array<{ entries: Record<string, unknown> }> = []

    const unsub = store.subscribe((val) => values.push(val))
    store.set("theme", "dark")
    store.set("lang", "en")
    store.deleteKey("theme")

    expect(client.mutate).toHaveBeenCalledWith("__collab_map_delete", { docId: "map-1", key: "theme" })
    const lastEntries = values[values.length - 1].entries
    expect(lastEntries).toHaveProperty("lang", "en")
    expect(lastEntries).not.toHaveProperty("theme")
    unsub()
  })
})

// ─── collabCounterStore ──────────────────────────────────────────────────────

describe("collabCounterStore", () => {
  afterEach(async () => {
    const { destroyReactiveBase } = await import("../index.js")
    destroyReactiveBase()
  })

  it("implements Svelte store contract", async () => {
    await setupClient()
    const { collabCounterStore } = await import("../collaboration.js")
    const store = collabCounterStore("counter-1")
    expect(typeof store.subscribe).toBe("function")
  })

  it("increment updates value and calls mutate", async () => {
    const client = await setupClient()
    const { collabCounterStore } = await import("../collaboration.js")
    const store = collabCounterStore("counter-1")
    const values: Array<{ value: number }> = []

    const unsub = store.subscribe((val) => values.push(val))
    store.increment()
    store.increment(5)

    expect(client.mutate).toHaveBeenCalledWith("__collab_counter_increment", { docId: "counter-1", amount: 1 })
    expect(client.mutate).toHaveBeenCalledWith("__collab_counter_increment", { docId: "counter-1", amount: 5 })
    expect(values[values.length - 1].value).toBe(6)
    unsub()
  })

  it("decrement updates value and calls mutate", async () => {
    const client = await setupClient()
    const { collabCounterStore } = await import("../collaboration.js")
    const store = collabCounterStore("counter-1")
    const values: Array<{ value: number }> = []

    const unsub = store.subscribe((val) => values.push(val))
    store.increment(10)
    store.decrement(3)

    expect(client.mutate).toHaveBeenCalledWith("__collab_counter_decrement", { docId: "counter-1", amount: 3 })
    expect(values[values.length - 1].value).toBe(7)
    unsub()
  })
})

// ─── cursorsStore ────────────────────────────────────────────────────────────

describe("cursorsStore", () => {
  afterEach(async () => {
    const { destroyReactiveBase } = await import("../index.js")
    destroyReactiveBase()
  })

  it("implements Svelte store contract", async () => {
    await setupClient()
    const { cursorsStore } = await import("../collaboration.js")
    const store = cursorsStore("room-1")
    expect(typeof store.subscribe).toBe("function")
  })

  it("subscribes to __collab:cursors:{roomId}", async () => {
    const client = await setupClient()
    const { cursorsStore } = await import("../collaboration.js")
    const store = cursorsStore("room-42")
    const unsub = store.subscribe(() => {})

    expect(client.subscribe).toHaveBeenCalledWith(
      "__collab:cursors:room-42",
      { roomId: "room-42" },
      expect.any(Function),
    )
    unsub()
  })

  it("emits initial empty cursors", async () => {
    await setupClient()
    const { cursorsStore } = await import("../collaboration.js")
    const store = cursorsStore("room-1")
    const values: Array<{ cursors: unknown[] }> = []

    const unsub = store.subscribe((val) => values.push(val))
    expect(values[0].cursors).toEqual([])
    unsub()
  })

  it("updateCursor calls mutate with position", async () => {
    const client = await setupClient()
    const { cursorsStore } = await import("../collaboration.js")
    const store = cursorsStore("room-1")
    const unsub = store.subscribe(() => {})

    store.updateCursor({ x: 100, y: 200, target: "editor" })

    expect(client.mutate).toHaveBeenCalledWith("__collab:updateCursor", {
      roomId: "room-1",
      x: 100,
      y: 200,
      target: "editor",
    })
    unsub()
  })

  it("clearCursor calls mutate", async () => {
    const client = await setupClient()
    const { cursorsStore } = await import("../collaboration.js")
    const store = cursorsStore("room-1")
    const unsub = store.subscribe(() => {})

    store.clearCursor()

    expect(client.mutate).toHaveBeenCalledWith("__collab:clearCursor", { roomId: "room-1" })
    unsub()
  })
})

// ─── typingUsersStore ────────────────────────────────────────────────────────

describe("typingUsersStore", () => {
  afterEach(async () => {
    const { destroyReactiveBase } = await import("../index.js")
    destroyReactiveBase()
  })

  it("implements Svelte store contract", async () => {
    await setupClient()
    const { typingUsersStore } = await import("../collaboration.js")
    const store = typingUsersStore("room-1")
    expect(typeof store.subscribe).toBe("function")
  })

  it("subscribes to __collab:typing:{roomId}", async () => {
    const client = await setupClient()
    const { typingUsersStore } = await import("../collaboration.js")
    const store = typingUsersStore("room-42")
    const unsub = store.subscribe(() => {})

    expect(client.subscribe).toHaveBeenCalledWith(
      "__collab:typing:room-42",
      { roomId: "room-42" },
      expect.any(Function),
    )
    unsub()
  })

  it("emits initial empty typingUsers", async () => {
    await setupClient()
    const { typingUsersStore } = await import("../collaboration.js")
    const store = typingUsersStore("room-1")
    const values: Array<{ typingUsers: unknown[] }> = []

    const unsub = store.subscribe((val) => values.push(val))
    expect(values[0].typingUsers).toEqual([])
    unsub()
  })

  it("setTyping calls mutate", async () => {
    const client = await setupClient()
    const { typingUsersStore } = await import("../collaboration.js")
    const store = typingUsersStore("room-1")
    const unsub = store.subscribe(() => {})

    store.setTyping(true)

    expect(client.mutate).toHaveBeenCalledWith("__collab:setTyping", {
      roomId: "room-1",
      isTyping: true,
    })
    unsub()
  })
})

// ─── Module exports ──────────────────────────────────────────────────────────

describe("collaboration module exports from index", () => {
  it("exports all collaboration store functions", async () => {
    const mod = await import("../index.js")
    expect(typeof mod.collabTextStore).toBe("function")
    expect(typeof mod.collabListStore).toBe("function")
    expect(typeof mod.collabMapStore).toBe("function")
    expect(typeof mod.collabCounterStore).toBe("function")
    expect(typeof mod.cursorsStore).toBe("function")
    expect(typeof mod.typingUsersStore).toBe("function")
  })
})
