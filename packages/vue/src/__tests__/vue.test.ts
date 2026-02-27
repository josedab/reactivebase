/**
 * Vue SDK smoke tests — verifies composable exports, provider/inject pattern,
 * and error handling without a live server connection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mock @reactivebase/client to avoid WebSocket connections
vi.mock("@reactivebase/client", () => {
  return {
    ReactiveBaseClient: vi.fn().mockImplementation(() => ({
      subscribe: vi.fn(() => vi.fn()),
      mutate: vi.fn(async () => ({ result: "ok" })),
      runAction: vi.fn(async () => ({ result: "done" })),
      disconnect: vi.fn(),
    })),
  }
})

// ─── Module exports ─────────────────────────────────────────────────────────

describe("module exports", () => {
  it("exports all expected composables and functions", async () => {
    const mod = await import("../index.js")
    expect(typeof mod.provideReactiveBase).toBe("function")
    expect(typeof mod.useReactiveBaseClient).toBe("function")
    expect(typeof mod.useQuery).toBe("function")
    expect(typeof mod.useMutation).toBe("function")
    expect(typeof mod.useAction).toBe("function")
  })
})

// ─── Provider / inject pattern ──────────────────────────────────────────────

describe("provideReactiveBase", () => {
  it("creates and returns a ReactiveBaseClient", async () => {
    // Mock vue's provide/inject
    const providedValues = new Map<symbol, unknown>()
    vi.doMock("vue", async (importOriginal) => {
      const actual = (await importOriginal()) as Record<string, unknown>
      return {
        ...actual,
        provide: (key: symbol, value: unknown) => providedValues.set(key, value),
        inject: (key: symbol) => providedValues.get(key),
      }
    })

    const { provideReactiveBase } = await import("../index.js")
    const client = provideReactiveBase({ url: "ws://localhost:4000" })
    expect(client).toBeDefined()
  })
})

// ─── useReactiveBaseClient error ────────────────────────────────────────────

describe("useReactiveBaseClient", () => {
  it("throws when no provider is found", async () => {
    // Mock inject to return undefined
    vi.doMock("vue", async (importOriginal) => {
      const actual = (await importOriginal()) as Record<string, unknown>
      return {
        ...actual,
        inject: () => undefined,
      }
    })

    // Need fresh import after mock change
    vi.resetModules()
    vi.mock("@reactivebase/client", () => ({
      ReactiveBaseClient: vi.fn().mockImplementation(() => ({
        subscribe: vi.fn(() => vi.fn()),
        mutate: vi.fn(),
        runAction: vi.fn(),
        disconnect: vi.fn(),
      })),
    }))

    const { useReactiveBaseClient } = await import("../index.js")
    expect(() => useReactiveBaseClient()).toThrow("ReactiveBase client not found")
  })
})

// ─── useMutation ────────────────────────────────────────────────────────────

describe("useMutation", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.mock("@reactivebase/client", () => ({
      ReactiveBaseClient: vi.fn().mockImplementation(() => ({
        subscribe: vi.fn(() => vi.fn()),
        mutate: vi.fn(async () => "mutated"),
        runAction: vi.fn(),
        disconnect: vi.fn(),
      })),
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns mutate function and reactive state", async () => {
    // Provide mock client via Vue inject
    const mockClient = {
      subscribe: vi.fn(() => vi.fn()),
      mutate: vi.fn(async () => "mutated"),
      runAction: vi.fn(),
      disconnect: vi.fn(),
    }

    vi.doMock("vue", async (importOriginal) => {
      const actual = (await importOriginal()) as Record<string, unknown>
      return {
        ...actual,
        inject: () => mockClient,
      }
    })

    const { useMutation } = await import("../index.js")
    const { mutate, isLoading, error } = useMutation("createTask")

    expect(typeof mutate).toBe("function")
    expect(isLoading.value).toBe(false)
    expect(error.value).toBeNull()
  })
})

// ─── useAction ──────────────────────────────────────────────────────────────

describe("useAction", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.mock("@reactivebase/client", () => ({
      ReactiveBaseClient: vi.fn().mockImplementation(() => ({
        subscribe: vi.fn(() => vi.fn()),
        mutate: vi.fn(),
        runAction: vi.fn(async () => "ran"),
        disconnect: vi.fn(),
      })),
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns run function and reactive state", async () => {
    const mockClient = {
      subscribe: vi.fn(() => vi.fn()),
      mutate: vi.fn(),
      runAction: vi.fn(async () => "ran"),
      disconnect: vi.fn(),
    }

    vi.doMock("vue", async (importOriginal) => {
      const actual = (await importOriginal()) as Record<string, unknown>
      return {
        ...actual,
        inject: () => mockClient,
      }
    })

    const { useAction } = await import("../index.js")
    const { run, isLoading, error } = useAction("sendEmail")

    expect(typeof run).toBe("function")
    expect(isLoading.value).toBe(false)
    expect(error.value).toBeNull()
  })
})

// ─── FunctionReference pattern ──────────────────────────────────────────────

describe("FunctionReference pattern", () => {
  it("useQuery accepts string query name", async () => {
    const mockClient = {
      subscribe: vi.fn(() => vi.fn()),
      mutate: vi.fn(),
      runAction: vi.fn(),
      disconnect: vi.fn(),
    }

    vi.resetModules()
    vi.doMock("@reactivebase/client", () => ({
      ReactiveBaseClient: vi.fn().mockImplementation(() => mockClient),
    }))
    vi.doMock("vue", async (importOriginal) => {
      const actual = (await importOriginal()) as Record<string, unknown>
      return {
        ...actual,
        inject: () => mockClient,
        ref: (v: unknown) => ({ value: v }),
        shallowRef: (v: unknown) => ({ value: v }),
        onMounted: (fn: () => void) => fn(),
        onUnmounted: vi.fn(),
        watch: vi.fn(),
      }
    })

    const { useQuery } = await import("../index.js")
    const { data, error, isLoading } = useQuery("listTasks")

    expect(data).toBeDefined()
    expect(error).toBeDefined()
    expect(isLoading).toBeDefined()
  })

  it("useMutation accepts FunctionReference object", async () => {
    const mockClient = {
      subscribe: vi.fn(() => vi.fn()),
      mutate: vi.fn(async () => "ok"),
      runAction: vi.fn(),
      disconnect: vi.fn(),
    }

    vi.resetModules()
    vi.doMock("@reactivebase/client", () => ({
      ReactiveBaseClient: vi.fn().mockImplementation(() => mockClient),
    }))
    vi.doMock("vue", async (importOriginal) => {
      const actual = (await importOriginal()) as Record<string, unknown>
      return {
        ...actual,
        inject: () => mockClient,
      }
    })

    const { useMutation } = await import("../index.js")
    const { mutate } = useMutation({ _name: "tasks.create", _type: "mutation" })
    expect(typeof mutate).toBe("function")
  })
})
