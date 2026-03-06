/**
 * Svelte component stores tests — verifies reactiveTableStore, reactiveFormStore,
 * and presenceAvatarsStore behavior.
 */

import { describe, it, expect, vi, afterEach } from "vitest"

// Mock @reactivebase/client
vi.mock("@reactivebase/client", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    ReactiveBaseClient: vi.fn().mockImplementation(() => ({
      subscribe: vi.fn((_name: string, _args: unknown, cb: (result: unknown, err?: Error) => void) => {
        cb([
          { id: "1", title: "Task 1", status: "todo" },
          { id: "2", title: "Task 2", status: "done" },
          { id: "3", title: "Task 3", status: "todo" },
        ])
        return () => {}
      }),
      mutate: vi.fn(async () => ({ result: "ok" })),
      runAction: vi.fn(),
      disconnect: vi.fn(),
    })),
  }
})

// ─── reactiveTableStore ─────────────────────────────────────────────────────

describe("reactiveTableStore", () => {
  afterEach(async () => {
    const { destroyReactiveBase } = await import("../index.js")
    destroyReactiveBase()
  })

  it("exports reactiveTableStore function", async () => {
    const { reactiveTableStore } = await import("../components.js")
    expect(typeof reactiveTableStore).toBe("function")
  })

  it("implements Svelte store contract", async () => {
    const { initReactiveBase } = await import("../index.js")
    const { reactiveTableStore } = await import("../components.js")
    initReactiveBase({ url: "ws://localhost:4000" })

    const store = reactiveTableStore({
      query: "tasks.list",
      columns: [
        { key: "title", header: "Title", sortable: true },
        { key: "status", header: "Status" },
      ],
    })

    expect(typeof store.subscribe).toBe("function")
  })

  it("emits table state with rows, page, and sort info", async () => {
    const { initReactiveBase } = await import("../index.js")
    const { reactiveTableStore } = await import("../components.js")
    initReactiveBase({ url: "ws://localhost:4000" })

    const store = reactiveTableStore({
      query: "tasks.list",
      columns: [{ key: "title", header: "Title", sortable: true }],
      pageSize: 10,
    })

    const states: Array<{ rows: unknown[]; page: number; totalPages: number; sortKey: string | null }> = []
    const unsub = store.subscribe((state) => {
      states.push({ rows: state.rows, page: state.page, totalPages: state.totalPages, sortKey: state.sortKey })
    })

    expect(states.length).toBeGreaterThanOrEqual(1)
    const lastState = states[states.length - 1]
    expect(lastState.page).toBe(0)
    expect(lastState.sortKey).toBeNull()

    unsub()
  })

  it("sort action updates state", async () => {
    const { initReactiveBase } = await import("../index.js")
    const { reactiveTableStore } = await import("../components.js")
    initReactiveBase({ url: "ws://localhost:4000" })

    const store = reactiveTableStore({
      query: "tasks.list",
      columns: [{ key: "title", header: "Title", sortable: true }],
    })

    const states: Array<{ sortKey: string | null; sortDir: string }> = []
    const unsub = store.subscribe((state) => {
      states.push({ sortKey: state.sortKey, sortDir: state.sortDir })
    })

    store.sort("title")
    const afterSort = states[states.length - 1]
    expect(afterSort.sortKey).toBe("title")
    expect(afterSort.sortDir).toBe("asc")

    store.sort("title")
    const afterToggle = states[states.length - 1]
    expect(afterToggle.sortDir).toBe("desc")

    unsub()
  })

  it("pagination actions work correctly", async () => {
    const { initReactiveBase } = await import("../index.js")
    const { reactiveTableStore } = await import("../components.js")
    initReactiveBase({ url: "ws://localhost:4000" })

    const store = reactiveTableStore({
      query: "tasks.list",
      columns: [{ key: "title", header: "Title" }],
      pageSize: 2,
    })

    const pages: number[] = []
    const unsub = store.subscribe((state) => {
      pages.push(state.page)
    })

    store.nextPage()
    expect(pages[pages.length - 1]).toBe(1)

    store.prevPage()
    expect(pages[pages.length - 1]).toBe(0)

    // prevPage at 0 should stay at 0
    store.prevPage()
    expect(pages[pages.length - 1]).toBe(0)

    unsub()
  })

  it("goToPage navigates directly", async () => {
    const { initReactiveBase } = await import("../index.js")
    const { reactiveTableStore } = await import("../components.js")
    initReactiveBase({ url: "ws://localhost:4000" })

    const store = reactiveTableStore({
      query: "tasks.list",
      columns: [{ key: "title", header: "Title" }],
      pageSize: 1,
    })

    const pages: number[] = []
    const unsub = store.subscribe((state) => {
      pages.push(state.page)
    })

    store.goToPage(2)
    expect(pages[pages.length - 1]).toBe(2)

    // Out of range should not change
    store.goToPage(999)
    expect(pages[pages.length - 1]).toBe(2)

    unsub()
  })
})

// ─── reactiveFormStore ──────────────────────────────────────────────────────

describe("reactiveFormStore", () => {
  afterEach(async () => {
    const { destroyReactiveBase } = await import("../index.js")
    destroyReactiveBase()
  })

  it("exports reactiveFormStore function", async () => {
    const { reactiveFormStore } = await import("../components.js")
    expect(typeof reactiveFormStore).toBe("function")
  })

  it("implements Svelte store contract with initial state", async () => {
    const { initReactiveBase } = await import("../index.js")
    const { reactiveFormStore } = await import("../components.js")
    initReactiveBase({ url: "ws://localhost:4000" })

    const store = reactiveFormStore({
      mutation: "tasks.create",
      fields: [{ name: "title", label: "Title", type: "text" }],
      initialValues: { title: "Hello" },
    })

    const states: Array<{ values: Record<string, unknown>; isSubmitting: boolean }> = []
    const unsub = store.subscribe((state) => {
      states.push({ values: state.values, isSubmitting: state.isSubmitting })
    })

    expect(states[0].values.title).toBe("Hello")
    expect(states[0].isSubmitting).toBe(false)

    unsub()
  })

  it("setValue updates form values", async () => {
    const { initReactiveBase } = await import("../index.js")
    const { reactiveFormStore } = await import("../components.js")
    initReactiveBase({ url: "ws://localhost:4000" })

    const store = reactiveFormStore({
      mutation: "tasks.create",
      fields: [{ name: "title", label: "Title", type: "text" }],
    })

    const states: Array<{ values: Record<string, unknown> }> = []
    const unsub = store.subscribe((state) => {
      states.push({ values: state.values })
    })

    store.setValue("title", "Updated")
    const lastState = states[states.length - 1]
    expect(lastState.values.title).toBe("Updated")

    unsub()
  })

  it("validates required fields on submit", async () => {
    const { initReactiveBase } = await import("../index.js")
    const { reactiveFormStore } = await import("../components.js")
    initReactiveBase({ url: "ws://localhost:4000" })

    const store = reactiveFormStore({
      mutation: "tasks.create",
      fields: [{ name: "title", label: "Title", type: "text", required: true }],
    })

    const states: Array<{ errors: Record<string, string> }> = []
    const unsub = store.subscribe((state) => {
      states.push({ errors: state.errors })
    })

    await store.submit()
    const lastState = states[states.length - 1]
    expect(lastState.errors.title).toBe("Title is required")

    unsub()
  })

  it("reset restores initial values", async () => {
    const { initReactiveBase } = await import("../index.js")
    const { reactiveFormStore } = await import("../components.js")
    initReactiveBase({ url: "ws://localhost:4000" })

    const store = reactiveFormStore({
      mutation: "tasks.create",
      fields: [{ name: "title", label: "Title", type: "text" }],
      initialValues: { title: "Original" },
    })

    const states: Array<{ values: Record<string, unknown> }> = []
    const unsub = store.subscribe((state) => {
      states.push({ values: state.values })
    })

    store.setValue("title", "Changed")
    store.reset()
    const lastState = states[states.length - 1]
    expect(lastState.values.title).toBe("Original")

    unsub()
  })
})

// ─── presenceAvatarsStore ───────────────────────────────────────────────────

describe("presenceAvatarsStore", () => {
  afterEach(async () => {
    const { destroyReactiveBase } = await import("../index.js")
    destroyReactiveBase()
  })

  it("exports presenceAvatarsStore function", async () => {
    const { presenceAvatarsStore } = await import("../components.js")
    expect(typeof presenceAvatarsStore).toBe("function")
  })

  it("implements Svelte store contract", async () => {
    const { initReactiveBase } = await import("../index.js")
    const { presenceAvatarsStore } = await import("../components.js")
    initReactiveBase({ url: "ws://localhost:4000" })

    const store = presenceAvatarsStore({
      query: "presence.list",
      maxVisible: 2,
    })

    expect(typeof store.subscribe).toBe("function")
  })

  it("emits users with visibility constraints", async () => {
    const { initReactiveBase } = await import("../index.js")
    const { presenceAvatarsStore } = await import("../components.js")
    initReactiveBase({ url: "ws://localhost:4000" })

    const store = presenceAvatarsStore({
      query: "presence.list",
      maxVisible: 2,
    })

    const states: Array<{ visible: unknown[]; overflow: number }> = []
    const unsub = store.subscribe((state) => {
      states.push({ visible: state.visible, overflow: state.overflow })
    })

    expect(states.length).toBeGreaterThanOrEqual(1)

    unsub()
  })
})
