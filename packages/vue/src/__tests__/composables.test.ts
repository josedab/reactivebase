/**
 * Vue composable behavior tests — verifies useQuery subscription flow,
 * useMutation execution and error handling, useAction invocation,
 * and collaboration composable exports.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Shared mock client factory
function createMockClient(overrides: Record<string, unknown> = {}) {
  return {
    subscribe: vi.fn((queryName: string, _args: unknown, onData: (data: unknown) => void) => {
      // Simulate immediate data delivery
      onData([{ id: "1", title: "Test" }])
      return vi.fn() // unsubscribe function
    }),
    mutate: vi.fn(async () => ({ id: "new", title: "Created" })),
    runAction: vi.fn(async () => "action-result"),
    disconnect: vi.fn(),
    ...overrides,
  }
}

function mockVueWithClient(mockClient: ReturnType<typeof createMockClient>) {
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
}

// ─── useQuery behavior ──────────────────────────────────────────────────────

describe("useQuery behavior", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("subscribes with correct query name and args", async () => {
    const mockClient = createMockClient()
    mockVueWithClient(mockClient)

    const { useQuery } = await import("../index.js")
    useQuery("listTasks", { userId: "u1" })

    expect(mockClient.subscribe).toHaveBeenCalledWith(
      "listTasks",
      { userId: "u1" },
      expect.any(Function),
    )
  })

  it("returns data, error, and isLoading refs", async () => {
    const mockClient = createMockClient()
    mockVueWithClient(mockClient)

    const { useQuery } = await import("../index.js")
    const result = useQuery("listTasks")

    expect(result.data).toBeDefined()
    expect(result.error).toBeDefined()
    expect(result.isLoading).toBeDefined()
  })

  it("accepts FunctionReference object with _name", async () => {
    const mockClient = createMockClient()
    mockVueWithClient(mockClient)

    const { useQuery } = await import("../index.js")
    useQuery({ _name: "tasks.list", _type: "query" })

    expect(mockClient.subscribe).toHaveBeenCalledWith(
      "tasks.list",
      undefined,
      expect.any(Function),
    )
  })

  it("passes undefined args when none provided", async () => {
    const mockClient = createMockClient()
    mockVueWithClient(mockClient)

    const { useQuery } = await import("../index.js")
    useQuery("getUser")

    expect(mockClient.subscribe).toHaveBeenCalledWith(
      "getUser",
      undefined,
      expect.any(Function),
    )
  })
})

// ─── useMutation behavior ───────────────────────────────────────────────────

describe("useMutation behavior", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("calls client.mutate with correct name and args", async () => {
    const mockClient = createMockClient()
    vi.doMock("@reactivebase/client", () => ({
      ReactiveBaseClient: vi.fn().mockImplementation(() => mockClient),
    }))
    vi.doMock("vue", async (importOriginal) => {
      const actual = (await importOriginal()) as Record<string, unknown>
      return { ...actual, inject: () => mockClient }
    })

    const { useMutation } = await import("../index.js")
    const { mutate } = useMutation("createTask")

    await mutate({ title: "New Task" })

    expect(mockClient.mutate).toHaveBeenCalledWith("createTask", { title: "New Task" })
  })

  it("returns mutation result", async () => {
    const mockClient = createMockClient({
      mutate: vi.fn(async () => ({ id: "42", done: false })),
    })
    vi.doMock("@reactivebase/client", () => ({
      ReactiveBaseClient: vi.fn().mockImplementation(() => mockClient),
    }))
    vi.doMock("vue", async (importOriginal) => {
      const actual = (await importOriginal()) as Record<string, unknown>
      return { ...actual, inject: () => mockClient }
    })

    const { useMutation } = await import("../index.js")
    const { mutate } = useMutation("toggleTask")

    const result = await mutate({ id: "42" })
    expect(result).toEqual({ id: "42", done: false })
  })

  it("handles mutation errors", async () => {
    const mockClient = createMockClient({
      mutate: vi.fn(async () => {
        throw new Error("Constraint violation")
      }),
    })
    vi.doMock("@reactivebase/client", () => ({
      ReactiveBaseClient: vi.fn().mockImplementation(() => mockClient),
    }))
    vi.doMock("vue", async (importOriginal) => {
      const actual = (await importOriginal()) as Record<string, unknown>
      return { ...actual, inject: () => mockClient }
    })

    const { useMutation } = await import("../index.js")
    const { mutate } = useMutation("failingMutation")

    await expect(mutate({})).rejects.toThrow("Constraint violation")
  })

  it("accepts FunctionReference with _name", async () => {
    const mockClient = createMockClient()
    vi.doMock("@reactivebase/client", () => ({
      ReactiveBaseClient: vi.fn().mockImplementation(() => mockClient),
    }))
    vi.doMock("vue", async (importOriginal) => {
      const actual = (await importOriginal()) as Record<string, unknown>
      return { ...actual, inject: () => mockClient }
    })

    const { useMutation } = await import("../index.js")
    const { mutate } = useMutation({ _name: "tasks.create", _type: "mutation" })

    await mutate({ title: "Test" })
    expect(mockClient.mutate).toHaveBeenCalledWith("tasks.create", { title: "Test" })
  })
})

// ─── useAction behavior ─────────────────────────────────────────────────────

describe("useAction behavior", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("calls client.runAction with correct name and args", async () => {
    const mockClient = createMockClient()
    vi.doMock("@reactivebase/client", () => ({
      ReactiveBaseClient: vi.fn().mockImplementation(() => mockClient),
    }))
    vi.doMock("vue", async (importOriginal) => {
      const actual = (await importOriginal()) as Record<string, unknown>
      return { ...actual, inject: () => mockClient }
    })

    const { useAction } = await import("../index.js")
    const { run } = useAction("sendEmail")

    await run({ to: "user@example.com", subject: "Hello" })
    expect(mockClient.runAction).toHaveBeenCalledWith("sendEmail", {
      to: "user@example.com",
      subject: "Hello",
    })
  })

  it("returns action result", async () => {
    const mockClient = createMockClient({
      runAction: vi.fn(async () => ({ sent: true })),
    })
    vi.doMock("@reactivebase/client", () => ({
      ReactiveBaseClient: vi.fn().mockImplementation(() => mockClient),
    }))
    vi.doMock("vue", async (importOriginal) => {
      const actual = (await importOriginal()) as Record<string, unknown>
      return { ...actual, inject: () => mockClient }
    })

    const { useAction } = await import("../index.js")
    const { run } = useAction("sendEmail")

    const result = await run({ to: "test@test.com" })
    expect(result).toEqual({ sent: true })
  })

  it("handles action errors", async () => {
    const mockClient = createMockClient({
      runAction: vi.fn(async () => {
        throw new Error("Timeout")
      }),
    })
    vi.doMock("@reactivebase/client", () => ({
      ReactiveBaseClient: vi.fn().mockImplementation(() => mockClient),
    }))
    vi.doMock("vue", async (importOriginal) => {
      const actual = (await importOriginal()) as Record<string, unknown>
      return { ...actual, inject: () => mockClient }
    })

    const { useAction } = await import("../index.js")
    const { run } = useAction("failingAction")

    await expect(run({})).rejects.toThrow("Timeout")
  })
})

// ─── Collaboration composable exports ───────────────────────────────────────

describe("collaboration composable exports", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("exports all collaboration composables", async () => {
    const mod = await import("../index.js")

    expect(typeof mod.useCollabText).toBe("function")
    expect(typeof mod.useCollabList).toBe("function")
    expect(typeof mod.useCollabMap).toBe("function")
    expect(typeof mod.useCollabCounter).toBe("function")
    expect(typeof mod.useCursors).toBe("function")
    expect(typeof mod.useTypingUsers).toBe("function")
  })

  it("exports local-first composables", async () => {
    const mod = await import("../index.js")

    expect(typeof mod.useLocalQuery).toBe("function")
    expect(typeof mod.useLocalMutation).toBe("function")
  })

  it("exports UI composables", async () => {
    const mod = await import("../index.js")

    expect(typeof mod.useReactiveTable).toBe("function")
    expect(typeof mod.useReactiveForm).toBe("function")
    expect(typeof mod.usePresenceAvatars).toBe("function")
  })
})
