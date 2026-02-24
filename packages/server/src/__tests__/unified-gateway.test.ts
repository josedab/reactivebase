import { describe, it, expect } from "vitest"
import { OpenApiGenerator } from "../api-gen/openapi-generator.js"
import { GraphQLSchemaGenerator } from "../api-gen/graphql-schema-generator.js"
import { UnifiedGateway } from "../api-gen/unified-gateway.js"
import type { FunctionDescriptor } from "../api-gen/openapi-generator.js"
import type { GatewayRequest } from "../api-gen/unified-gateway.js"

function createTestFunctions(): FunctionDescriptor[] {
  return [
    {
      name: "getUsers",
      type: "query",
      args: {
        limit: { type: "integer", required: false, description: "Max results" },
        role: { type: "string", required: false, enum: ["admin", "member"] },
      },
      returns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", required: true },
            name: { type: "string", required: true },
            email: { type: "string", required: true },
          },
        },
      },
      description: "List users",
      module: "users",
    },
    {
      name: "getTask",
      type: "query",
      args: {
        id: { type: "string", required: true, description: "Task ID" },
      },
      returns: {
        type: "object",
        properties: {
          id: { type: "string", required: true },
          title: { type: "string", required: true },
          done: { type: "boolean", required: true },
        },
      },
      description: "Get a task by ID",
      module: "tasks",
    },
    {
      name: "createUser",
      type: "mutation",
      args: {
        name: { type: "string", required: true },
        email: { type: "string", required: true },
        role: { type: "string", required: false, enum: ["admin", "member"] },
      },
      returns: {
        type: "object",
        properties: { id: { type: "string", required: true }, name: { type: "string", required: true } },
      },
      description: "Create a new user",
      module: "users",
    },
    {
      name: "deleteUser",
      type: "action",
      args: {
        id: { type: "string", required: true },
      },
      returns: { type: "boolean" },
      description: "Delete a user",
      module: "users",
    },
  ]
}

function makeReq(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    method: "GET",
    path: "/",
    headers: {},
    ...overrides,
  }
}

// ─── OpenApiGenerator ────────────────────────────────────────────────────────

describe("OpenApiGenerator", () => {
  it("generates a valid OpenAPI 3.1 spec", () => {
    const gen = new OpenApiGenerator()
    const spec = gen.generateSpec(createTestFunctions())

    expect(spec.openapi).toBe("3.1.0")
    expect(spec.info.title).toBe("ReactiveBase API")
    expect(spec.servers).toHaveLength(1)
  })

  it("creates GET endpoints for query functions", () => {
    const gen = new OpenApiGenerator()
    const spec = gen.generateSpec(createTestFunctions())

    expect(spec.paths["/api/v1/getUsers"]?.get).toBeDefined()
    expect(spec.paths["/api/v1/getUsers"]?.get?.operationId).toBe("getUsers")
    expect(spec.paths["/api/v1/getTask"]?.get).toBeDefined()
  })

  it("creates POST endpoints for mutation functions", () => {
    const gen = new OpenApiGenerator()
    const spec = gen.generateSpec(createTestFunctions())

    expect(spec.paths["/api/v1/createUser"]?.post).toBeDefined()
    expect(spec.paths["/api/v1/createUser"]?.post?.operationId).toBe("createUser")
    expect(spec.paths["/api/v1/deleteUser"]?.post).toBeDefined()
  })

  it("generates query parameters for GET endpoints", () => {
    const gen = new OpenApiGenerator()
    const spec = gen.generateSpec(createTestFunctions())

    const params = spec.paths["/api/v1/getUsers"]?.get?.parameters
    expect(params).toBeDefined()
    expect(params!.length).toBe(2)
    expect(params![0].name).toBe("limit")
    expect(params![0].in).toBe("query")
  })

  it("generates request body for POST endpoints", () => {
    const gen = new OpenApiGenerator()
    const spec = gen.generateSpec(createTestFunctions())

    const op = spec.paths["/api/v1/createUser"]?.post
    expect(op?.requestBody).toBeDefined()
    expect(op?.requestBody?.required).toBe(true)
  })

  it("generates component schemas", () => {
    const gen = new OpenApiGenerator()
    const spec = gen.generateSpec(createTestFunctions())

    expect(spec.components.schemas["GetUsersResponse"]).toBeDefined()
    expect(spec.components.schemas["CreateUserInput"]).toBeDefined()
    expect(spec.components.schemas["CreateUserResponse"]).toBeDefined()
  })

  it("includes security schemes", () => {
    const gen = new OpenApiGenerator()
    const spec = gen.generateSpec(createTestFunctions())

    expect(spec.components.securitySchemes.bearerAuth).toBeDefined()
    expect(spec.components.securitySchemes.apiKey).toBeDefined()
    expect(spec.security.length).toBeGreaterThan(0)
  })

  it("supports tags for grouping", () => {
    const gen = new OpenApiGenerator()
    const spec = gen.generateSpec(createTestFunctions())

    expect(spec.tags).toBeDefined()
    const tagNames = spec.tags!.map((t) => t.name)
    expect(tagNames).toContain("users")
    expect(tagNames).toContain("tasks")
  })

  it("respects custom options", () => {
    const gen = new OpenApiGenerator({ title: "Custom API", version: "2.0.0", serverUrl: "https://api.test.com" })
    const spec = gen.generateSpec(createTestFunctions())

    expect(spec.info.title).toBe("Custom API")
    expect(spec.info.version).toBe("2.0.0")
    expect(spec.servers[0].url).toBe("https://api.test.com")
  })

  it("generates Swagger UI HTML", () => {
    const gen = new OpenApiGenerator()
    const spec = gen.generateSpec(createTestFunctions())
    const html = gen.generateSwaggerUIHTML(spec)

    expect(html).toContain("swagger-ui")
    expect(html).toContain("SwaggerUIBundle")
    expect(html).toContain("ReactiveBase API")
  })

  it("generates Redoc HTML", () => {
    const gen = new OpenApiGenerator()
    const spec = gen.generateSpec(createTestFunctions())
    const html = gen.generateRedocHTML(spec)

    expect(html).toContain("redoc")
    expect(html).toContain("Redoc.init")
    expect(html).toContain("ReactiveBase API")
  })
})

// ─── GraphQLSchemaGenerator ──────────────────────────────────────────────────

describe("GraphQLSchemaGenerator", () => {
  it("generates GraphQL SDL with query fields", () => {
    const gen = new GraphQLSchemaGenerator()
    const result = gen.generateSchema(createTestFunctions())

    expect(result.sdl).toContain("type Query {")
    expect(result.queryFields).toContain("getUsers")
    expect(result.queryFields).toContain("getTask")
  })

  it("generates mutation fields", () => {
    const gen = new GraphQLSchemaGenerator()
    const result = gen.generateSchema(createTestFunctions())

    expect(result.sdl).toContain("type Mutation {")
    expect(result.mutationFields).toContain("createUser")
    expect(result.mutationFields).toContain("deleteUser")
  })

  it("generates subscription fields from query functions", () => {
    const gen = new GraphQLSchemaGenerator()
    const result = gen.generateSchema(createTestFunctions())

    expect(result.sdl).toContain("type Subscription {")
    expect(result.subscriptionFields).toContain("onGetUsersChanged")
    expect(result.subscriptionFields).toContain("onGetTaskChanged")
  })

  it("disables subscriptions when configured", () => {
    const gen = new GraphQLSchemaGenerator({ subscriptions: false })
    const result = gen.generateSchema(createTestFunctions())

    expect(result.sdl).not.toContain("type Subscription {")
    expect(result.subscriptionFields).toHaveLength(0)
  })

  it("generates input types for mutations", () => {
    const gen = new GraphQLSchemaGenerator()
    const result = gen.generateSchema(createTestFunctions())

    expect(result.sdl).toContain("input CreateUserInput {")
    expect(result.inputTypes).toContain("CreateUserInput")
  })

  it("generates output types for complex returns", () => {
    const gen = new GraphQLSchemaGenerator()
    const result = gen.generateSchema(createTestFunctions())

    expect(result.types).toContain("GetUsersOutput")
    expect(result.types).toContain("GetTaskOutput")
  })

  it("maps types correctly", () => {
    const gen = new GraphQLSchemaGenerator()
    const result = gen.generateSchema(createTestFunctions())

    expect(result.sdl).toContain("String")
    expect(result.sdl).toContain("Boolean")
  })

  it("generates GraphQL playground HTML", () => {
    const gen = new GraphQLSchemaGenerator()
    const html = gen.generateGraphQLPlaygroundHTML("/graphql")

    expect(html).toContain("graphiql")
    expect(html).toContain("/graphql")
    expect(html).toContain("GraphiQL")
  })

  it("generates introspection response", () => {
    const gen = new GraphQLSchemaGenerator()
    const response = gen.generateIntrospectionResponse(createTestFunctions())

    expect(response.data.__schema.queryType.name).toBe("Query")
    expect(response.data.__schema.mutationType?.name).toBe("Mutation")
    expect(response.data.__schema.subscriptionType?.name).toBe("Subscription")
    expect(response.data.__schema.types.length).toBeGreaterThan(0)
  })
})

// ─── UnifiedGateway ──────────────────────────────────────────────────────────

describe("UnifiedGateway", () => {
  function createGateway() {
    return new UnifiedGateway({ functions: createTestFunctions() })
  }

  describe("request routing", () => {
    it("routes health check", () => {
      const gw = createGateway()
      const res = gw.handleRequest(makeReq({ method: "GET", path: "/api/v1/health" }))

      expect(res.status).toBe(200)
      expect((res.body as Record<string, unknown>).status).toBe("healthy")
    })

    it("routes Swagger UI", () => {
      const gw = createGateway()
      const res = gw.handleRequest(makeReq({ method: "GET", path: "/api/docs" }))

      expect(res.status).toBe(200)
      expect(res.headers["content-type"]).toContain("text/html")
      expect(res.body as string).toContain("swagger-ui")
    })

    it("routes Redoc", () => {
      const gw = createGateway()
      const res = gw.handleRequest(makeReq({ method: "GET", path: "/api/docs/redoc" }))

      expect(res.status).toBe(200)
      expect(res.headers["content-type"]).toContain("text/html")
      expect(res.body as string).toContain("redoc")
    })

    it("routes OpenAPI spec", () => {
      const gw = createGateway()
      const res = gw.handleRequest(makeReq({ method: "GET", path: "/api/v1/openapi.json" }))

      expect(res.status).toBe(200)
      const body = res.body as { openapi: string }
      expect(body.openapi).toBe("3.1.0")
    })

    it("routes GraphQL playground", () => {
      const gw = createGateway()
      const res = gw.handleRequest(makeReq({ method: "GET", path: "/graphql/playground" }))

      expect(res.status).toBe(200)
      expect(res.headers["content-type"]).toContain("text/html")
      expect(res.body as string).toContain("graphiql")
    })

    it("routes GraphQL POST requests", () => {
      const gw = createGateway()
      const res = gw.handleRequest(
        makeReq({
          method: "POST",
          path: "/graphql",
          headers: { "content-type": "application/json" },
          body: { query: "{ getUsers { id name } }" },
        }),
      )

      expect(res.status).toBe(200)
    })

    it("returns 400 for GraphQL without query", () => {
      const gw = createGateway()
      const res = gw.handleRequest(
        makeReq({
          method: "POST",
          path: "/graphql",
          headers: { "content-type": "application/json" },
          body: {},
        }),
      )

      expect(res.status).toBe(400)
    })

    it("returns 400 for unknown GraphQL field", () => {
      const gw = createGateway()
      const res = gw.handleRequest(
        makeReq({
          method: "POST",
          path: "/graphql",
          headers: { "content-type": "application/json" },
          body: { query: "{ unknownField { id } }" },
        }),
      )

      expect(res.status).toBe(400)
      expect((res.body as { errors: Array<{ message: string }> }).errors[0].message).toContain("unknownField")
    })

    it("routes REST GET to query functions", () => {
      const gw = createGateway()
      const res = gw.handleRequest(makeReq({ method: "GET", path: "/api/v1/getUsers", query: { limit: "10" } }))

      expect(res.status).toBe(200)
      expect((res.body as Record<string, unknown>).function).toBe("getUsers")
    })

    it("routes REST POST to mutation functions", () => {
      const gw = createGateway()
      const res = gw.handleRequest(
        makeReq({
          method: "POST",
          path: "/api/v1/createUser",
          headers: { "content-type": "application/json" },
          body: { name: "Alice", email: "alice@test.com" },
        }),
      )

      expect(res.status).toBe(200)
      expect((res.body as Record<string, unknown>).function).toBe("createUser")
    })

    it("returns 405 for wrong HTTP method on REST", () => {
      const gw = createGateway()
      const res = gw.handleRequest(makeReq({ method: "POST", path: "/api/v1/getUsers" }))

      expect(res.status).toBe(405)
    })

    it("returns 404 for unknown REST function", () => {
      const gw = createGateway()
      const res = gw.handleRequest(makeReq({ method: "GET", path: "/api/v1/unknownFn" }))

      expect(res.status).toBe(404)
    })

    it("returns 404 for unknown path", () => {
      const gw = createGateway()
      const res = gw.handleRequest(makeReq({ method: "GET", path: "/unknown" }))

      expect(res.status).toBe(404)
    })

    it("requires websocket upgrade header for /ws", () => {
      const gw = createGateway()
      const res = gw.handleRequest(makeReq({ method: "GET", path: "/ws", headers: {} }))

      expect(res.status).toBe(426)
    })

    it("handles websocket upgrade", () => {
      const gw = createGateway()
      const res = gw.handleRequest(makeReq({ method: "GET", path: "/ws", headers: { upgrade: "websocket" } }))

      expect(res.status).toBe(101)
    })
  })

  describe("getRoutes", () => {
    it("returns all registered routes", () => {
      const gw = createGateway()
      const routes = gw.getRoutes()

      expect(routes.length).toBeGreaterThan(0)

      const transports = new Set(routes.map((r) => r.transport))
      expect(transports).toContain("rest")
      expect(transports).toContain("graphql")
      expect(transports).toContain("websocket")
      expect(transports).toContain("docs")
      expect(transports).toContain("system")
    })

    it("includes REST routes for each function", () => {
      const gw = createGateway()
      const routes = gw.getRoutes()
      const restRoutes = routes.filter((r) => r.transport === "rest")

      expect(restRoutes).toHaveLength(4) // 4 functions
      expect(restRoutes.find((r) => r.path.includes("getUsers"))).toBeDefined()
      expect(restRoutes.find((r) => r.path.includes("createUser"))).toBeDefined()
    })
  })

  describe("getStats", () => {
    it("tracks request counts by transport", () => {
      const gw = createGateway()

      gw.handleRequest(makeReq({ method: "GET", path: "/api/v1/health" }))
      gw.handleRequest(makeReq({ method: "GET", path: "/api/v1/health" }))
      gw.handleRequest(makeReq({ method: "GET", path: "/api/v1/getUsers" }))
      gw.handleRequest(makeReq({ method: "POST", path: "/graphql", body: { query: "{ getUsers { id } }" } }))
      gw.handleRequest(makeReq({ method: "GET", path: "/api/docs" }))

      const stats = gw.getStats()
      expect(stats.total).toBe(5)
      expect(stats.system).toBe(2)
      expect(stats.rest).toBe(1)
      expect(stats.graphql).toBe(1)
      expect(stats.docs).toBe(1)
    })

    it("starts with zero counts", () => {
      const gw = createGateway()
      const stats = gw.getStats()

      expect(stats.total).toBe(0)
      expect(stats.rest).toBe(0)
      expect(stats.graphql).toBe(0)
    })
  })
})
