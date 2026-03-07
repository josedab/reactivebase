/**
 * Server query client and request deduplication tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

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

    const [r1, r2] = await Promise.all([
      deduplicatedPreloadQuery("http://localhost:4000", "listTasks", { userId: "u1" }),
      deduplicatedPreloadQuery("http://localhost:4000", "listTasks", { userId: "u1" }),
    ])

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

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

// ─── Cache Revalidation Helper ──────────────────────────────────────────────

describe("revalidateReactiveBase", () => {
  it("does not throw when next/cache is unavailable", async () => {
    const { revalidateReactiveBase, revalidateReactiveBaseTags } = await import("../index.js")

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
