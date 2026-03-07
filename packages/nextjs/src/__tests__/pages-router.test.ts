/**
 * Pages Router integration tests — configurePagesRouter, withServerSideQueries,
 * withStaticQueries, and related helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

describe("Pages Router helpers", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configurePagesRouter({ serverUrl: "" } as any)
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
