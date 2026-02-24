import { describe, it, expect } from "vitest"
import { createReactiveBaseMiddleware, type EmbeddableConfig, type IncomingRequest } from "../transport/embeddable.js"

// Minimal mock pool/schema/functions
function createTestConfig(overrides: Partial<EmbeddableConfig> = {}): EmbeddableConfig {
  return {
    pool: {} as never,
    schema: { tables: {}, tableNames: [] } as never,
    functions: {},
    ...overrides,
  }
}

describe("createReactiveBaseMiddleware", () => {
  it("returns httpHandler, wsHandler, engine, and shutdown", () => {
    const result = createReactiveBaseMiddleware(createTestConfig())
    expect(result.httpHandler).toBeTypeOf("function")
    expect(result.wsHandler).toBeTypeOf("function")
    expect(result.engine).toBeDefined()
    expect(result.middlewareManager).toBeDefined()
    expect(result.shutdown).toBeTypeOf("function")
  })

  describe("HTTP Handler", () => {
    it("responds 404 for unknown routes", async () => {
      const { httpHandler } = createReactiveBaseMiddleware(createTestConfig())
      const req: IncomingRequest = { method: "GET", url: "/api/reactivebase/unknown", headers: {} }
      const res = await httpHandler(req)
      expect(res.status).toBe(404)
    })

    it("serves /health endpoint", async () => {
      const { httpHandler } = createReactiveBaseMiddleware(createTestConfig())
      const req: IncomingRequest = { method: "GET", url: "/api/reactivebase/health", headers: {} }
      const res = await httpHandler(req)
      expect(res.status).toBe(200)
      const body = res.body as Record<string, unknown>
      expect(body.status).toBe("ok")
      expect(body.timestamp).toBeDefined()
    })

    it("serves /functions endpoint", async () => {
      const { httpHandler } = createReactiveBaseMiddleware(
        createTestConfig({
          functions: {
            "tasks.list": { name: "tasks.list", type: "query", handler: async () => [], options: {} },
            "tasks.create": { name: "tasks.create", type: "mutation", handler: async () => ({}), options: {} },
          },
        }),
      )
      const req: IncomingRequest = { method: "GET", url: "/api/reactivebase/functions", headers: {} }
      const res = await httpHandler(req)
      expect(res.status).toBe(200)
      const body = res.body as { functions: Array<{ name: string; type: string }> }
      expect(body.functions).toHaveLength(2)
    })

    it("responds 404 for unknown query", async () => {
      const { httpHandler } = createReactiveBaseMiddleware(createTestConfig())
      const req: IncomingRequest = {
        method: "POST",
        url: "/api/reactivebase/query/nonexistent",
        headers: {},
        body: {},
      }
      const res = await httpHandler(req)
      expect(res.status).toBe(404)
    })

    it("responds 404 for unknown mutation", async () => {
      const { httpHandler } = createReactiveBaseMiddleware(createTestConfig())
      const req: IncomingRequest = {
        method: "POST",
        url: "/api/reactivebase/mutation/nonexistent",
        headers: {},
        body: {},
      }
      const res = await httpHandler(req)
      expect(res.status).toBe(404)
    })

    it("responds 404 for unknown action", async () => {
      const { httpHandler } = createReactiveBaseMiddleware(createTestConfig())
      const req: IncomingRequest = {
        method: "POST",
        url: "/api/reactivebase/action/nonexistent",
        headers: {},
        body: {},
      }
      const res = await httpHandler(req)
      expect(res.status).toBe(404)
    })

    it("rejects POST without body", async () => {
      const { httpHandler } = createReactiveBaseMiddleware(createTestConfig())
      const req: IncomingRequest = {
        method: "POST",
        url: "/api/reactivebase/query/test",
        headers: {},
        body: undefined,
      }
      const res = await httpHandler(req)
      expect(res.status).toBe(400)
    })

    it("uses custom routePrefix", async () => {
      const { httpHandler } = createReactiveBaseMiddleware(createTestConfig({ routePrefix: "/custom" }))
      const req: IncomingRequest = { method: "GET", url: "/custom/health", headers: {} }
      const res = await httpHandler(req)
      expect(res.status).toBe(200)
    })

    it("uses custom resolveAuth", async () => {
      const { httpHandler } = createReactiveBaseMiddleware(
        createTestConfig({
          resolveAuth: async () => ({
            userId: "custom-user",
            claims: {},
            requireUser: () => "custom-user",
            requireRole: () => {},
            hasClaim: () => false,
          }),
        }),
      )
      const req: IncomingRequest = { method: "GET", url: "/api/reactivebase/health", headers: {} }
      const res = await httpHandler(req)
      expect(res.status).toBe(200)
    })
  })
})
