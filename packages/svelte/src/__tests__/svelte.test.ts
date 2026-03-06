/**
 * Svelte SDK smoke tests — verifies store exports, client management,
 * and error handling without a live server connection.
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

// ─── Module exports ─────────────────────────────────────────────────────────

describe("module exports", () => {
  it("exports all expected functions", async () => {
    const mod = await import("../index.js")
    expect(typeof mod.initReactiveBase).toBe("function")
    expect(typeof mod.getReactiveBaseClient).toBe("function")
    expect(typeof mod.destroyReactiveBase).toBe("function")
    expect(typeof mod.queryStore).toBe("function")
    expect(typeof mod.createMutation).toBe("function")
    expect(typeof mod.createAction).toBe("function")
  })
})

// ─── Client lifecycle ───────────────────────────────────────────────────────

describe("client lifecycle", () => {
  afterEach(async () => {
    const { destroyReactiveBase } = await import("../index.js")
    destroyReactiveBase()
  })

  it("initReactiveBase creates a client", async () => {
    const { initReactiveBase } = await import("../index.js")
    const client = initReactiveBase({ url: "ws://localhost:4000" })
    expect(client).toBeDefined()
  })

  it("getReactiveBaseClient throws before init", async () => {
    const { getReactiveBaseClient, destroyReactiveBase } = await import("../index.js")
    destroyReactiveBase() // ensure clean state
    expect(() => getReactiveBaseClient()).toThrow("ReactiveBase not initialized")
  })

  it("getReactiveBaseClient returns client after init", async () => {
    const { initReactiveBase, getReactiveBaseClient } = await import("../index.js")
    initReactiveBase({ url: "ws://localhost:4000" })
    const client = getReactiveBaseClient()
    expect(client).toBeDefined()
  })

  it("destroyReactiveBase cleans up client", async () => {
    const { initReactiveBase, getReactiveBaseClient, destroyReactiveBase } = await import("../index.js")
    const client = initReactiveBase({ url: "ws://localhost:4000" })
    expect(client.disconnect).not.toHaveBeenCalled()

    destroyReactiveBase()
    expect(client.disconnect).toHaveBeenCalled()
    expect(() => getReactiveBaseClient()).toThrow("ReactiveBase not initialized")
  })
})

// ─── queryStore ─────────────────────────────────────────────────────────────

describe("queryStore", () => {
  afterEach(async () => {
    const { destroyReactiveBase } = await import("../index.js")
    destroyReactiveBase()
  })

  it("implements Svelte store contract (subscribe method)", async () => {
    const { initReactiveBase, queryStore } = await import("../index.js")
    initReactiveBase({ url: "ws://localhost:4000" })

    const store = queryStore("listTasks")
    expect(typeof store.subscribe).toBe("function")
  })

  it("emits loading state then data", async () => {
    const { initReactiveBase, queryStore } = await import("../index.js")
    initReactiveBase({ url: "ws://localhost:4000" })

    const store = queryStore("listTasks", { userId: "u1" })
    const values: Array<{ isLoading: boolean; data: unknown; error: unknown }> = []

    const unsubscribe = store.subscribe((value) => {
      values.push({ ...value })
    })

    // First value should be loading, second should have data
    expect(values.length).toBeGreaterThanOrEqual(1)
    expect(values[0].isLoading).toBe(true)
    if (values.length > 1) {
      expect(values[1].isLoading).toBe(false)
      expect(values[1].data).toBeDefined()
    }

    unsubscribe()
  })

  it("accepts FunctionReference objects", async () => {
    const { initReactiveBase, queryStore } = await import("../index.js")
    initReactiveBase({ url: "ws://localhost:4000" })

    const store = queryStore({ _name: "tasks.list", _type: "query" })
    expect(typeof store.subscribe).toBe("function")
  })
})

// ─── createMutation ─────────────────────────────────────────────────────────

describe("createMutation", () => {
  afterEach(async () => {
    const { destroyReactiveBase } = await import("../index.js")
    destroyReactiveBase()
  })

  it("returns a mutate function", async () => {
    const { initReactiveBase, createMutation } = await import("../index.js")
    initReactiveBase({ url: "ws://localhost:4000" })

    const { mutate } = createMutation("createTask")
    expect(typeof mutate).toBe("function")
  })

  it("calls client.mutate with correct args", async () => {
    const { initReactiveBase, createMutation, getReactiveBaseClient } = await import("../index.js")
    initReactiveBase({ url: "ws://localhost:4000" })

    const { mutate } = createMutation("createTask")
    await mutate({ title: "Test" })

    const client = getReactiveBaseClient()
    expect(client.mutate).toHaveBeenCalledWith("createTask", { title: "Test" })
  })
})

// ─── createAction ───────────────────────────────────────────────────────────

describe("createAction", () => {
  afterEach(async () => {
    const { destroyReactiveBase } = await import("../index.js")
    destroyReactiveBase()
  })

  it("returns a run function", async () => {
    const { initReactiveBase, createAction } = await import("../index.js")
    initReactiveBase({ url: "ws://localhost:4000" })

    const { run } = createAction("sendEmail")
    expect(typeof run).toBe("function")
  })

  it("calls client.runAction with correct args", async () => {
    const { initReactiveBase, createAction, getReactiveBaseClient } = await import("../index.js")
    initReactiveBase({ url: "ws://localhost:4000" })

    const { run } = createAction("sendEmail")
    await run({ to: "user@example.com" })

    const client = getReactiveBaseClient()
    expect(client.runAction).toHaveBeenCalledWith("sendEmail", { to: "user@example.com" })
  })
})
