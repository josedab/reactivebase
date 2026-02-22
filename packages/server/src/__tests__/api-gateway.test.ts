import { describe, it, expect } from "vitest"
import { ApiGateway, generateApiKeyTableSQL } from "../api-gen/api-gateway.js"
import type { Schema } from "../schema/index.js"

function createMockSchema(): Schema {
  return {
    tableNames: ["users", "tasks"],
    tables: {
      users: {
        columns: {
          name: { type: "string", isOptional: false },
          email: { type: "string", isOptional: false },
          role: { type: "enum", isOptional: false, values: ["admin", "member"] },
        },
      },
      tasks: {
        columns: {
          title: { type: "string", isOptional: false },
          done: { type: "boolean", isOptional: false },
          assigneeId: { type: "id", isOptional: false },
          priority: { type: "integer", isOptional: true },
        },
      },
    },
  } as unknown as Schema
}

describe("ApiGateway", () => {
  describe("OpenAPI spec generation", () => {
    it("generates a valid OpenAPI 3.1 spec", () => {
      const gw = new ApiGateway(createMockSchema())
      const spec = gw.generateOpenApiSpec()

      expect(spec.openapi).toBe("3.1.0")
      expect(spec.info.title).toBe("ReactiveBase API")
      expect(spec.servers).toHaveLength(1)
    })

    it("generates paths for all tables", () => {
      const gw = new ApiGateway(createMockSchema())
      const spec = gw.generateOpenApiSpec()
      const paths = Object.keys(spec.paths)

      expect(paths).toContain("/api/v1/users")
      expect(paths).toContain("/api/v1/users/{id}")
      expect(paths).toContain("/api/v1/tasks")
      expect(paths).toContain("/api/v1/tasks/{id}")
      expect(paths).toContain("/api/v1/health")
    })

    it("generates CRUD operations for each table", () => {
      const gw = new ApiGateway(createMockSchema())
      const spec = gw.generateOpenApiSpec()

      const usersList = spec.paths["/api/v1/users"]
      expect(usersList.get).toBeDefined()
      expect(usersList.post).toBeDefined()

      const usersItem = spec.paths["/api/v1/users/{id}"]
      expect(usersItem.get).toBeDefined()
      expect(usersItem.patch).toBeDefined()
      expect(usersItem.delete).toBeDefined()
    })

    it("generates component schemas", () => {
      const gw = new ApiGateway(createMockSchema())
      const spec = gw.generateOpenApiSpec()

      expect(spec.components.schemas.Users).toBeDefined()
      expect(spec.components.schemas.UsersInput).toBeDefined()
      expect(spec.components.schemas.Tasks).toBeDefined()
    })

    it("includes security schemes when API keys enabled", () => {
      const gw = new ApiGateway(createMockSchema(), { enableApiKeys: true })
      const spec = gw.generateOpenApiSpec()

      expect(spec.components.securitySchemes.apiKey).toBeDefined()
      expect(spec.components.securitySchemes.bearerAuth).toBeDefined()
      expect(spec.security.length).toBeGreaterThan(0)
    })

    it("respects custom options", () => {
      const gw = new ApiGateway(createMockSchema(), {
        title: "My API",
        version: "2.0.0",
        serverUrl: "https://api.example.com",
      })
      const spec = gw.generateOpenApiSpec()

      expect(spec.info.title).toBe("My API")
      expect(spec.info.version).toBe("2.0.0")
      expect(spec.servers[0].url).toBe("https://api.example.com")
    })
  })

  describe("GraphQL with subscriptions", () => {
    it("generates GraphQL schema with types, queries, mutations, and subscriptions", () => {
      const gw = new ApiGateway(createMockSchema())
      const schema = gw.generateGraphQLWithSubscriptions()

      expect(schema).toContain("type Users {")
      expect(schema).toContain("type Tasks {")
      expect(schema).toContain("type Query {")
      expect(schema).toContain("type Mutation {")
      expect(schema).toContain("type Subscription {")
    })

    it("generates subscription fields for each table", () => {
      const gw = new ApiGateway(createMockSchema())
      const schema = gw.generateGraphQLWithSubscriptions()

      expect(schema).toContain("onUsersChanged")
      expect(schema).toContain("onTasksChanged")
      expect(schema).toContain("onUsersList")
      expect(schema).toContain("onTasksList")
    })

    it("generates filter input types", () => {
      const gw = new ApiGateway(createMockSchema())
      const schema = gw.generateGraphQLWithSubscriptions()

      expect(schema).toContain("input UsersFilter {")
      expect(schema).toContain("input TasksFilter {")
    })

    it("generates change types", () => {
      const gw = new ApiGateway(createMockSchema())
      const schema = gw.generateGraphQLWithSubscriptions()

      expect(schema).toContain("type UsersChange {")
      expect(schema).toContain("enum ChangeType {")
    })

    it("lists subscription fields programmatically", () => {
      const gw = new ApiGateway(createMockSchema())
      const fields = gw.getSubscriptionFields()

      expect(fields.length).toBe(4) // 2 tables × 2 sub types
      expect(fields[0].name).toBe("onUsersChanged")
    })
  })

  describe("API key management", () => {
    it("creates an API key", () => {
      const gw = new ApiGateway(createMockSchema())
      const { key, record } = gw.createApiKey("test-client", ["read"])

      expect(key).toMatch(/^rb_/)
      expect(record.name).toBe("test-client")
      expect(record.permissions).toEqual(["read"])
      expect(record.isRevoked).toBe(false)
    })

    it("validates a valid API key", () => {
      const gw = new ApiGateway(createMockSchema())
      const { key } = gw.createApiKey("test", ["read", "write"])

      const result = gw.validateApiKey(key)
      expect(result.valid).toBe(true)
      expect(result.permissions).toEqual(["read", "write"])
    })

    it("rejects an invalid API key", () => {
      const gw = new ApiGateway(createMockSchema())
      const result = gw.validateApiKey("rb_invalid_key")
      expect(result.valid).toBe(false)
      expect(result.error).toBe("Invalid API key")
    })

    it("revokes an API key", () => {
      const gw = new ApiGateway(createMockSchema())
      const { key, record } = gw.createApiKey("test", ["read"])

      expect(gw.revokeApiKey(record.id)).toBe(true)
      const result = gw.validateApiKey(key)
      expect(result.valid).toBe(false)
      expect(result.error).toContain("revoked")
    })

    it("rejects expired API keys", () => {
      const gw = new ApiGateway(createMockSchema())
      const { key, record } = gw.createApiKey("test", ["read"], 1)

      // Manually expire
      record.expiresAt = Date.now() - 1000
      const result = gw.validateApiKey(key)
      expect(result.valid).toBe(false)
      expect(result.error).toContain("expired")
    })

    it("tracks request count", () => {
      const gw = new ApiGateway(createMockSchema())
      const { key } = gw.createApiKey("test", ["read"])

      gw.validateApiKey(key)
      gw.validateApiKey(key)
      gw.validateApiKey(key)

      const keys = gw.listApiKeys()
      expect(keys[0].requestCount).toBe(3)
    })

    it("lists all API keys", () => {
      const gw = new ApiGateway(createMockSchema())
      gw.createApiKey("client-1", ["read"])
      gw.createApiKey("client-2", ["read", "write"])

      const keys = gw.listApiKeys()
      expect(keys).toHaveLength(2)
    })
  })

  describe("versioned routes", () => {
    it("generates routes for all versions", () => {
      const gw = new ApiGateway(createMockSchema(), { versions: ["v1", "v2"] })
      const routes = gw.generateVersionedRoutes()

      const v1Routes = routes.filter((r) => r.version === "v1")
      const v2Routes = routes.filter((r) => r.version === "v2")

      expect(v1Routes.length).toBeGreaterThan(0)
      expect(v2Routes.length).toBeGreaterThan(0)
      expect(v1Routes.length).toBe(v2Routes.length)
    })

    it("includes system routes (openapi, graphql, health)", () => {
      const gw = new ApiGateway(createMockSchema())
      const routes = gw.generateVersionedRoutes()

      const systemRoutes = routes.filter((r) => ["openapi", "graphql", "health"].includes(r.action))
      expect(systemRoutes).toHaveLength(3)
    })

    it("generates 5 CRUD routes per table", () => {
      const gw = new ApiGateway(createMockSchema())
      const routes = gw.generateVersionedRoutes()

      const userRoutes = routes.filter((r) => r.table === "users")
      expect(userRoutes).toHaveLength(5)
    })
  })

  describe("stats", () => {
    it("tracks gateway statistics", () => {
      const gw = new ApiGateway(createMockSchema())
      gw.createApiKey("c1", ["read"])
      gw.createApiKey("c2", ["write"])
      const { record } = gw.createApiKey("c3", ["read"])
      gw.revokeApiKey(record.id)

      const stats = gw.getStats()
      expect(stats.totalKeys).toBe(3)
      expect(stats.activeKeys).toBe(2)
      expect(stats.revokedKeys).toBe(1)
    })
  })
})

describe("generateApiKeyTableSQL", () => {
  it("generates CREATE TABLE SQL", () => {
    const sql = generateApiKeyTableSQL()
    expect(sql).toContain("_reactivebase_api_keys")
    expect(sql).toContain("key_hash")
    expect(sql).toContain("permissions")
    expect(sql).toContain("CREATE INDEX")
  })
})
