/**
 * Next.js SDK integration tests — verifies SSR preloading, utility functions,
 * and module exports. Client-side hooks are tested at the unit level with mocks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ─── SSR preloading ─────────────────────────────────────────────────────────

describe("preloadQuery", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("makes a POST request to /query endpoint", async () => {
    const { preloadQuery } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 1 }] }),
    })

    const result = await preloadQuery("http://localhost:4000", "listTasks", { userId: "u1" })

    expect(mockFetch).toHaveBeenCalledWith("http://localhost:4000/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queryName: "listTasks", args: { userId: "u1" } }),
    })
    expect(result._tag).toBe("preloaded")
    expect(result.queryName).toBe("listTasks")
    expect(result.data).toEqual([{ id: 1 }])
    expect(result.serverTimestamp).toBeGreaterThan(0)
  })

  it("includes authorization header when token provided", async () => {
    const { preloadQuery } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    })

    await preloadQuery("http://localhost:4000", "getUser", {}, { token: "my-jwt" })

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:4000/query",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer my-jwt",
        }),
      }),
    )
  })

  it("throws on non-OK response", async () => {
    const { preloadQuery } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    })

    await expect(preloadQuery("http://localhost:4000", "failQuery")).rejects.toThrow("Preload query failed: 500")
  })

  it("strips trailing slash from server URL", async () => {
    const { preloadQuery } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: null }),
    })

    await preloadQuery("http://localhost:4000/", "testQuery")
    expect(mockFetch).toHaveBeenCalledWith("http://localhost:4000/query", expect.anything())
  })
})

// ─── preloadQueries (parallel) ──────────────────────────────────────────────

describe("preloadQueries", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("preloads multiple queries in parallel", async () => {
    const { preloadQueries } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [1, 2, 3] }),
    })

    const map = await preloadQueries("http://localhost:4000", [
      { queryName: "q1" },
      { queryName: "q2", args: { x: 1 } },
    ])

    expect(map.size).toBe(2)
    expect(map.get("q1")).toBeDefined()
    expect(map.get("q2")).toBeDefined()
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("handles partial failures gracefully", async () => {
    const { preloadQueries } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    let callCount = 0
    mockFetch.mockImplementation(async () => {
      callCount++
      if (callCount === 1) return { ok: true, json: async () => ({ data: "ok" }) }
      return { ok: false, status: 404, statusText: "Not Found" }
    })

    const map = await preloadQueries("http://localhost:4000", [{ queryName: "good" }, { queryName: "bad" }])

    // Only the successful query should be in the map
    expect(map.size).toBe(1)
    expect(map.has("good")).toBe(true)
  })
})

// ─── Utility functions ──────────────────────────────────────────────────────

describe("isPreloadedQuery", () => {
  it("returns true for a valid preloaded result", async () => {
    const { isPreloadedQuery } = await import("../index.js")
    expect(
      isPreloadedQuery({
        _tag: "preloaded",
        queryName: "test",
        args: {},
        data: [],
        serverTimestamp: Date.now(),
      }),
    ).toBe(true)
  })

  it("returns false for non-preloaded values", async () => {
    const { isPreloadedQuery } = await import("../index.js")
    expect(isPreloadedQuery(null)).toBe(false)
    expect(isPreloadedQuery({})).toBe(false)
    expect(isPreloadedQuery({ _tag: "other" })).toBe(false)
    expect(isPreloadedQuery("string")).toBe(false)
  })
})

// ─── Suspense resource ──────────────────────────────────────────────────────

describe("createQueryResource", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("throws promise while pending (Suspense contract)", async () => {
    const { createQueryResource } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>

    // Never-resolving fetch to keep it pending
    let resolvePromise!: () => void
    mockFetch.mockReturnValue(
      new Promise<void>((resolve) => {
        resolvePromise = resolve
      }),
    )

    const resource = createQueryResource("http://localhost:4000", "slowQuery")

    // read() should throw a promise when pending
    expect(() => resource.read()).toThrow()
    resolvePromise()
  })

  it("returns data after fetch resolves", async () => {
    const { createQueryResource } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { result: 42 } }),
    })

    const resource = createQueryResource<{ result: number }>("http://localhost:4000", "fastQuery")

    // Wait for the internal promise to resolve
    await new Promise((r) => setTimeout(r, 10))

    expect(resource.read()).toEqual({ result: 42 })
  })
})

// ─── Module exports ─────────────────────────────────────────────────────────

describe("module exports", () => {
  it("exports all expected functions and types", async () => {
    const mod = await import("../index.js")
    expect(typeof mod.preloadQuery).toBe("function")
    expect(typeof mod.preloadQueries).toBe("function")
    expect(typeof mod.usePreloadedQuery).toBe("function")
    expect(typeof mod.useStreamingQuery).toBe("function")
    expect(typeof mod.ReactiveBaseNextjsProvider).toBe("function")
    expect(typeof mod.isPreloadedQuery).toBe("function")
    expect(typeof mod.createQueryResource).toBe("function")
    expect(typeof mod.configurePagesRouter).toBe("function")
    expect(typeof mod.withServerSideQueries).toBe("function")
    expect(typeof mod.withStaticQueries).toBe("function")
  })
})

// ─── Pages Router helpers ───────────────────────────────────────────────────

describe("Pages Router helpers", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
    // Reset module-level _pagesConfig by reconfiguring to a known state
    delete process.env.REACTIVEBASE_URL
    delete process.env.REACTIVEBASE_TOKEN
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("configurePagesRouter sets default URL used by withServerSideQueries", async () => {
    const { configurePagesRouter, withServerSideQueries } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: 1 } }),
    })

    configurePagesRouter({ serverUrl: "http://configured:4000" })

    const handler = withServerSideQueries({
      item: { query: "getItem", args: { id: 1 } },
    })

    const result = await handler()
    expect(result.props.item._tag).toBe("preloaded")
    expect(mockFetch).toHaveBeenCalledWith("http://configured:4000/query", expect.anything())
  })

  it("withServerSideQueries returns preloaded props", async () => {
    const { withServerSideQueries } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 1 }] }),
    })

    const handler = withServerSideQueries(
      { tasks: { query: "listTasks", args: { status: "active" } } },
      { serverUrl: "http://test:4000" },
    )

    const result = await handler()
    expect(result.props.tasks._tag).toBe("preloaded")
    expect(result.props.tasks.queryName).toBe("listTasks")
    expect(result.props.tasks.data).toEqual([{ id: 1 }])
  })

  it("withServerSideQueries preloads multiple queries", async () => {
    const { withServerSideQueries } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: "ok" }),
    })

    const handler = withServerSideQueries(
      {
        tasks: { query: "listTasks" },
        user: { query: "getCurrentUser" },
      },
      { serverUrl: "http://test:4000" },
    )

    const result = await handler()
    expect(result.props.tasks._tag).toBe("preloaded")
    expect(result.props.user._tag).toBe("preloaded")
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("withStaticQueries includes revalidate", async () => {
    const { withStaticQueries } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { title: "Hello" } }),
    })

    const handler = withStaticQueries({ post: { query: "getPost" } }, { serverUrl: "http://test:4000", revalidate: 60 })

    const result = await handler()
    expect(result.revalidate).toBe(60)
    expect(result.props.post._tag).toBe("preloaded")
    expect(result.props.post.queryName).toBe("getPost")
  })

  it("withStaticQueries omits revalidate when not specified", async () => {
    const { withStaticQueries } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: null }),
    })

    const handler = withStaticQueries({ post: { query: "getPost" } }, { serverUrl: "http://test:4000" })

    const result = await handler()
    expect(result).not.toHaveProperty("revalidate")
  })

  it("throws when no server URL configured", async () => {
    const { withServerSideQueries, configurePagesRouter } = await import("../index.js")
    // Reset config by setting it to a known empty state
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configurePagesRouter({ serverUrl: "" } as any)
    // Force _pagesConfig to null by re-importing would be complex,
    // so we test the env var path: no env var set + no explicit URL
    // We pass an explicit empty serverUrl to trigger the error
    const handler = withServerSideQueries({ q: { query: "test" } }, { serverUrl: "" })

    await expect(handler()).rejects.toThrow("No server URL")
  })

  it("withServerSideQueries throws when a query fails", async () => {
    const { withServerSideQueries } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    })

    const handler = withServerSideQueries({ tasks: { query: "failQuery" } }, { serverUrl: "http://test:4000" })

    await expect(handler()).rejects.toThrow('Failed to preload query "failQuery"')
  })
})

// ─── Server Query Client ────────────────────────────────────────────────────

describe("createServerQueryClient", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("executes a single query", async () => {
    const { createServerQueryClient } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "1", title: "Task" }] }),
    })

    const client = createServerQueryClient("http://localhost:4000", { token: "tk" })
    const result = await client.query("listTasks")

    expect(mockFetch).toHaveBeenCalledWith("http://localhost:4000/query", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer tk" },
      body: JSON.stringify({ queryName: "listTasks", args: {} }),
    })
    expect(result).toEqual([{ id: "1", title: "Task" }])
  })

  it("executes batch queries", async () => {
    const { createServerQueryClient } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: "result" }),
    })

    const client = createServerQueryClient("http://localhost:4000")
    const results = await client.batchQuery([{ queryName: "q1", args: { a: 1 } }, { queryName: "q2" }])

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(results.size).toBe(2)
    expect(results.has("q1")).toBe(true)
    expect(results.has("q2")).toBe(true)
  })

  it("throws after close", async () => {
    const { createServerQueryClient } = await import("../index.js")
    const client = createServerQueryClient("http://localhost:4000")
    client.close()

    await expect(client.query("test")).rejects.toThrow("closed")
  })

  it("handles query failures", async () => {
    const { createServerQueryClient } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" })

    const client = createServerQueryClient("http://localhost:4000")
    await expect(client.query("missingQuery")).rejects.toThrow("404")
  })
})

// ─── Request Deduplication ──────────────────────────────────────────────────

describe("deduplicatedPreloadQuery", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("coalesces concurrent identical requests", async () => {
    const { deduplicatedPreloadQuery } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 1 }] }),
    })

    // Fire two identical requests concurrently
    const [r1, r2] = await Promise.all([
      deduplicatedPreloadQuery("http://localhost:4000", "listTasks", { userId: "u1" }),
      deduplicatedPreloadQuery("http://localhost:4000", "listTasks", { userId: "u1" }),
    ])

    // Only one network request should have been made
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(r1.data).toEqual([{ id: 1 }])
    expect(r2.data).toEqual([{ id: 1 }])
  })

  it("makes separate requests for different queries", async () => {
    const { deduplicatedPreloadQuery } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    })

    await Promise.all([
      deduplicatedPreloadQuery("http://localhost:4000", "listTasks"),
      deduplicatedPreloadQuery("http://localhost:4000", "listUsers"),
    ])

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("makes fresh request after previous one completes", async () => {
    const { deduplicatedPreloadQuery } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    })

    await deduplicatedPreloadQuery("http://localhost:4000", "listTasks")
    await deduplicatedPreloadQuery("http://localhost:4000", "listTasks")

    // Sequential calls should make 2 requests (dedup only affects concurrent)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

// ─── Cache Revalidation Helper ──────────────────────────────────────────────

describe("revalidateReactiveBase", () => {
  it("does not throw when next/cache is unavailable", async () => {
    const { revalidateReactiveBase, revalidateReactiveBaseTags } = await import("../index.js")

    // Should not throw even outside Next.js context
    expect(() => revalidateReactiveBase("tasks")).not.toThrow()
    expect(() => revalidateReactiveBaseTags(["tasks", "users"])).not.toThrow()
  })
})

// ─── Subscription Seeding ───────────────────────────────────────────────────

describe("createSubscriptionSeed", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("creates a seed map from preloaded queries", async () => {
    const { createSubscriptionSeed } = await import("../index.js")
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "1" }] }),
    })

    const seed = await createSubscriptionSeed("http://localhost:4000", [
      { queryName: "listTasks", args: { status: "active" } },
      { queryName: "listUsers" },
    ])

    expect(seed).toBeDefined()
    expect(seed.seeds).toHaveLength(2)
    expect(seed.seeds[0].queryName).toBe("listTasks")
    expect(seed.seeds[1].queryName).toBe("listUsers")
    expect(seed._tag).toBe("subscription-seed")
  })
})

// ─── Module Exports ─────────────────────────────────────────────────────────

describe("module exports", () => {
  it("exports new components and utilities", async () => {
    const mod = await import("../index.js")

    // New additions
    expect(mod.QueryErrorBoundary).toBeDefined()
    expect(mod.deduplicatedPreloadQuery).toBeDefined()
    expect(mod.revalidateReactiveBase).toBeDefined()
    expect(mod.revalidateReactiveBaseTags).toBeDefined()

    // Existing exports still present
    expect(mod.preloadQuery).toBeDefined()
    expect(mod.preloadQueries).toBeDefined()
    expect(mod.loadQuery).toBeDefined()
    expect(mod.createServerQueryClient).toBeDefined()
    expect(mod.createSubscriptionSeed).toBeDefined()
    expect(mod.ReactiveBaseNextjsProvider).toBeDefined()
    expect(mod.ReactiveIsland).toBeDefined()
    expect(mod.StreamingQueryBoundary).toBeDefined()
    expect(mod.StreamingPartialQuery).toBeDefined()
    expect(mod.ReactiveBaseSeededProvider).toBeDefined()
    expect(mod.usePreloadedQuery).toBeDefined()
    expect(mod.useStreamingQuery).toBeDefined()
    expect(mod.useServerQuery).toBeDefined()
    expect(mod.useSubscriptionSeed).toBeDefined()
    expect(mod.useSeededQuery).toBeDefined()
  })
})
