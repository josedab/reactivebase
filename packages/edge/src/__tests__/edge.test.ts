import { describe, it, expect, vi } from "vitest"
import { EdgeClient, createCacheKey, EdgeQueryError } from "../index.js"

function createMockFetch(responseData: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => responseData,
    text: async () => JSON.stringify(responseData),
  })
}

describe("EdgeClient", () => {
  it("prefetches a query via HTTP", async () => {
    const mockFetch = createMockFetch({ data: [{ id: "1", title: "Task" }] })
    const client = new EdgeClient({
      serverUrl: "https://api.example.com",
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.prefetchQuery("tasks.list", { userId: "u1" })

    expect(result.data).toEqual([{ id: "1", title: "Task" }])
    expect(result.queryName).toBe("tasks.list")
    expect(result.cacheKey).toBeDefined()

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/query",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ queryName: "tasks.list", args: { userId: "u1" } }),
      }),
    )
  })

  it("sends auth token as Bearer header", async () => {
    const mockFetch = createMockFetch({ data: [] })
    const client = new EdgeClient({
      serverUrl: "https://api.example.com",
      token: "my-token",
      fetch: mockFetch as unknown as typeof fetch,
    })

    await client.prefetchQuery("tasks.list")

    const call = mockFetch.mock.calls[0]
    expect(call[1].headers.Authorization).toBe("Bearer my-token")
  })

  it("throws EdgeQueryError on non-200 response", async () => {
    const mockFetch = createMockFetch({ error: "Not found" }, 404)
    const client = new EdgeClient({
      serverUrl: "https://api.example.com",
      fetch: mockFetch as unknown as typeof fetch,
    })

    await expect(client.prefetchQuery("unknown")).rejects.toThrow(EdgeQueryError)
  })

  it("prefetches multiple queries in parallel", async () => {
    const mockFetch = createMockFetch({ data: [] })
    const client = new EdgeClient({
      serverUrl: "https://api.example.com",
      fetch: mockFetch as unknown as typeof fetch,
    })

    const results = await client.prefetchQueries([
      { queryName: "tasks.list", args: { userId: "u1" } },
      { queryName: "users.get", args: { id: "u1" } },
    ])

    expect(results.size).toBe(2)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("allows token update", async () => {
    const mockFetch = createMockFetch({ data: [] })
    const client = new EdgeClient({
      serverUrl: "https://api.example.com",
      fetch: mockFetch as unknown as typeof fetch,
    })

    client.setToken("new-token")
    await client.prefetchQuery("test")

    const call = mockFetch.mock.calls[0]
    expect(call[1].headers.Authorization).toBe("Bearer new-token")
  })
})

describe("createCacheKey", () => {
  it("creates deterministic keys", () => {
    const key1 = createCacheKey("tasks.list", { userId: "u1", done: false })
    const key2 = createCacheKey("tasks.list", { done: false, userId: "u1" })
    expect(key1).toBe(key2)
  })

  it("differentiates different queries", () => {
    const key1 = createCacheKey("tasks.list", { userId: "u1" })
    const key2 = createCacheKey("tasks.list", { userId: "u2" })
    expect(key1).not.toBe(key2)
  })
})

// ─── Network Resilience ─────────────────────────────────────────────────────

describe("EdgeClient network resilience", () => {
  it("handles fetch network errors", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"))
    const client = new EdgeClient({
      serverUrl: "https://api.example.com",
      fetch: mockFetch as unknown as typeof fetch,
    })

    await expect(client.prefetchQuery("tasks.list")).rejects.toThrow("fetch failed")
  })

  it("handles timeout via AbortController", async () => {
    const mockFetch = vi.fn().mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new DOMException("aborted", "AbortError")), 50)),
    )
    const client = new EdgeClient({
      serverUrl: "https://api.example.com",
      fetch: mockFetch as unknown as typeof fetch,
      timeout: 10,
    })

    await expect(client.prefetchQuery("slow.query")).rejects.toThrow()
  })

  it("handles malformed JSON response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token")
      },
    })
    const client = new EdgeClient({
      serverUrl: "https://api.example.com",
      fetch: mockFetch as unknown as typeof fetch,
    })

    await expect(client.prefetchQuery("tasks.list")).rejects.toThrow("Unexpected token")
  })

  it("includes status code and body in EdgeQueryError", async () => {
    const mockFetch = createMockFetch({ error: "rate limited" }, 429)
    const client = new EdgeClient({
      serverUrl: "https://api.example.com",
      fetch: mockFetch as unknown as typeof fetch,
    })

    try {
      await client.prefetchQuery("tasks.list")
      expect.unreachable("should have thrown")
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(EdgeQueryError)
      const e = err as InstanceType<typeof EdgeQueryError>
      expect(e.statusCode).toBe(429)
      expect(e.body).toContain("rate limited")
    }
  })

  it("handles server 500 errors with descriptive message", async () => {
    const mockFetch = createMockFetch({ error: "internal" }, 500)
    const client = new EdgeClient({
      serverUrl: "https://api.example.com",
      fetch: mockFetch as unknown as typeof fetch,
    })

    await expect(client.prefetchQuery("failing")).rejects.toThrow("500")
  })

  it("prefetchQueries continues on partial failure", async () => {
    let callCount = 0
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 2) {
        return { ok: false, status: 500, text: async () => "error", json: async () => ({}) }
      }
      return { ok: true, status: 200, json: async () => ({ data: "ok" }), text: async () => "" }
    })

    const client = new EdgeClient({
      serverUrl: "https://api.example.com",
      fetch: mockFetch as unknown as typeof fetch,
    })

    const results = await client.prefetchQueries([
      { queryName: "q1" },
      { queryName: "q2" },
      { queryName: "q3" },
    ])

    // Only 2 of 3 should succeed (q2 fails with 500)
    expect(results.size).toBe(2)
  })

  it("handles empty args gracefully", async () => {
    const mockFetch = createMockFetch({ data: [] })
    const client = new EdgeClient({
      serverUrl: "https://api.example.com",
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.prefetchQuery("tasks.list")
    expect(result.data).toEqual([])
    expect(result.args).toEqual({})
  })
})
