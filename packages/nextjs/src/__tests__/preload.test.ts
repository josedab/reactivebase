/**
 * SSR preloading tests — preloadQuery, preloadQueries, isPreloadedQuery, createQueryResource.
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

    let resolvePromise!: () => void
    mockFetch.mockReturnValue(
      new Promise<void>((resolve) => {
        resolvePromise = resolve
      }),
    )

    const resource = createQueryResource("http://localhost:4000", "slowQuery")

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

    await new Promise((r) => setTimeout(r, 10))

    expect(resource.read()).toEqual({ result: 42 })
  })
})
