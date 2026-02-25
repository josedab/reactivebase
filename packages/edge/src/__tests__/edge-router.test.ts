import { describe, it, expect } from "vitest"
import { EdgeQueryRouter } from "../edge-router.js"

// Mock fetch for testing
function createMockFetch(responses: Record<string, unknown> = {}) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const _url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const body = init?.body ? JSON.parse(init.body as string) : {}
    const key = body.queryName ?? "default"
    const data = responses[key] ?? { data: [] }

    return {
      ok: true,
      status: 200,
      json: async () => data,
      text: async () => JSON.stringify(data),
    } as Response
  }
}

describe("EdgeQueryRouter", () => {
  it("creates router with replicas", () => {
    const router = new EdgeQueryRouter({
      originUrl: "https://origin.example.com",
      replicas: [
        { url: "https://us.example.com", region: "us-east" },
        { url: "https://eu.example.com", region: "eu-west" },
      ],
      fetch: createMockFetch(),
    })

    expect(router.replicaCount).toBe(2)
    expect(router.cacheSize).toBe(0)
  })

  it("caches query results", async () => {
    const fetchMock = createMockFetch({
      "tasks.list": { data: [{ id: "t1" }] },
    })

    const router = new EdgeQueryRouter({
      originUrl: "https://origin.example.com",
      replicas: [{ url: "https://us.example.com", region: "us-east" }],
      fetch: fetchMock,
    })

    const first = await router.query("tasks.list", {})
    expect(first.data).toEqual([{ id: "t1" }])
    expect(first.source).toBe("replica")

    // Second call should hit cache
    const second = await router.query("tasks.list", {})
    expect(second.source).toBe("cache")
    expect(second.stale).toBe(false)
  })

  it("forces fresh read from origin", async () => {
    const router = new EdgeQueryRouter({
      originUrl: "https://origin.example.com",
      replicas: [{ url: "https://us.example.com", region: "us-east" }],
      fetch: createMockFetch({ "tasks.list": { data: [{ id: "t1" }] } }),
    })

    const result = await router.query("tasks.list", {}, { fresh: true })
    expect(result.source).toBe("origin")
  })

  it("tracks replica health", () => {
    const router = new EdgeQueryRouter({
      originUrl: "https://origin.example.com",
      replicas: [
        { url: "https://us.example.com", region: "us-east" },
        { url: "https://eu.example.com", region: "eu-west" },
      ],
      fetch: createMockFetch(),
    })

    const health = router.getReplicaHealth()
    expect(health).toHaveLength(2)
    expect(health[0].healthy).toBe(true)
  })

  it("invalidates cache", async () => {
    const router = new EdgeQueryRouter({
      originUrl: "https://origin.example.com",
      replicas: [{ url: "https://us.example.com", region: "us-east" }],
      fetch: createMockFetch({ "tasks.list": { data: [] } }),
    })

    await router.query("tasks.list", {})
    expect(router.cacheSize).toBe(1)

    const invalidated = router.invalidateCache()
    expect(invalidated).toBe(1)
    expect(router.cacheSize).toBe(0)
  })

  it("updates auth token for all clients", () => {
    const router = new EdgeQueryRouter({
      originUrl: "https://origin.example.com",
      replicas: [{ url: "https://us.example.com", region: "us-east" }],
      fetch: createMockFetch(),
    })

    // Should not throw
    router.setToken("new-token")
    router.setToken(undefined)
  })
})
