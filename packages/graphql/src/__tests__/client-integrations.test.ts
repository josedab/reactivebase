import { describe, it, expect, beforeEach } from "vitest"
import { ClientIntegrations } from "../client-integrations.js"
import type { CompiledSchema } from "../schema-compiler.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockSchema(): CompiledSchema {
  return {
    sdl: "type Query { users: [User] }",
    typeMap: {
      User: {
        name: "User",
        tableName: "users",
        sourceSchema: "default",
        fields: [
          { name: "id", graphqlType: "ID!", tsType: "string", isReactive: true, isRelation: false },
          { name: "name", graphqlType: "String!", tsType: "string", isReactive: true, isRelation: false },
          { name: "email", graphqlType: "String!", tsType: "string", isReactive: false, isRelation: false },
          { name: "posts", graphqlType: "[Post]", tsType: "Post[]", isReactive: false, isRelation: true, relatedType: "Post" },
        ],
        hasRelayCursor: true,
      },
      Post: {
        name: "Post",
        tableName: "posts",
        sourceSchema: "default",
        fields: [
          { name: "id", graphqlType: "ID!", tsType: "string", isReactive: true, isRelation: false },
          { name: "title", graphqlType: "String!", tsType: "string", isReactive: true, isRelation: false },
        ],
        hasRelayCursor: false,
      },
    },
    reactivityMap: {},
    sourceSchemas: ["default"],
    metadata: { totalTypes: 2, totalFields: 6, totalSubscriptions: 2, stitchedSchemas: 1, compiledAt: Date.now() },
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ClientIntegrations", () => {
  describe("constructor", () => {
    it("creates without options", () => {
      const integrations = new ClientIntegrations()
      expect(integrations).toBeInstanceOf(ClientIntegrations)
    })

    it("accepts compiled schema", () => {
      const integrations = new ClientIntegrations({ compiledSchema: createMockSchema() })
      expect(integrations).toBeInstanceOf(ClientIntegrations)
    })
  })

  describe("apollo()", () => {
    let integrations: ClientIntegrations

    beforeEach(() => {
      integrations = new ClientIntegrations({ compiledSchema: createMockSchema() })
    })

    it("generates Apollo Client config with correct URI", () => {
      const config = integrations.apollo({ wsUrl: "ws://localhost:4000/graphql" })
      expect(config.code).toContain("http://localhost:4000/graphql")
      expect(config.code).toContain("ws://localhost:4000/graphql")
    })

    it("uses custom httpUrl when provided", () => {
      const config = integrations.apollo({
        wsUrl: "ws://localhost:4000/graphql",
        httpUrl: "https://api.example.com/graphql",
      })
      expect(config.code).toContain("https://api.example.com/graphql")
    })

    it("includes InMemoryCache with type policies", () => {
      const config = integrations.apollo({ wsUrl: "ws://localhost:4000/graphql" })
      expect(config.code).toContain("InMemoryCache")
      expect(config.code).toContain("typePolicies")
    })

    it("includes Relay-style pagination for types with cursor", () => {
      const config = integrations.apollo({ wsUrl: "ws://localhost:4000/graphql" })
      expect(config.code).toContain("users")
      expect(config.code).toContain("merge: true")
    })

    it("returns correct client name and dependencies", () => {
      const config = integrations.apollo({ wsUrl: "ws://localhost:4000/graphql" })
      expect(config.clientName).toBe("Apollo Client")
      expect(config.dependencies).toContain("@apollo/client")
      expect(config.dependencies).toContain("graphql-ws")
      expect(config.dependencies).toContain("graphql")
    })

    it("uses custom auth header name", () => {
      const config = integrations.apollo({
        wsUrl: "ws://localhost:4000/graphql",
        authHeaderName: "X-Custom-Auth",
      })
      expect(config.code).toContain("X-Custom-Auth")
    })

    it("uses default Authorization header", () => {
      const config = integrations.apollo({ wsUrl: "ws://localhost:4000/graphql" })
      expect(config.code).toContain("Authorization")
    })

    it("includes subscription split link", () => {
      const config = integrations.apollo({ wsUrl: "ws://localhost:4000/graphql" })
      expect(config.code).toContain("split")
      expect(config.code).toContain("GraphQLWsLink")
      expect(config.code).toContain("HttpLink")
    })
  })

  describe("urql()", () => {
    let integrations: ClientIntegrations

    beforeEach(() => {
      integrations = new ClientIntegrations()
    })

    it("generates urql config with correct URL", () => {
      const config = integrations.urql({ wsUrl: "ws://localhost:4000/graphql" })
      expect(config.code).toContain("http://localhost:4000/graphql")
    })

    it("includes subscription exchange", () => {
      const config = integrations.urql({ wsUrl: "ws://localhost:4000/graphql" })
      expect(config.code).toContain("subscriptionExchange")
      expect(config.code).toContain("forwardSubscription")
    })

    it("includes cache and fetch exchanges", () => {
      const config = integrations.urql({ wsUrl: "ws://localhost:4000/graphql" })
      expect(config.code).toContain("cacheExchange")
      expect(config.code).toContain("fetchExchange")
    })

    it("returns correct client name and dependencies", () => {
      const config = integrations.urql({ wsUrl: "ws://localhost:4000/graphql" })
      expect(config.clientName).toBe("urql")
      expect(config.dependencies).toContain("urql")
      expect(config.dependencies).toContain("graphql-ws")
    })

    it("uses custom httpUrl when provided", () => {
      const config = integrations.urql({
        wsUrl: "ws://localhost:4000/graphql",
        httpUrl: "https://custom.api.com/graphql",
      })
      expect(config.code).toContain("https://custom.api.com/graphql")
    })
  })

  describe("graphqlWs()", () => {
    let integrations: ClientIntegrations

    beforeEach(() => {
      integrations = new ClientIntegrations()
    })

    it("generates graphql-ws config", () => {
      const config = integrations.graphqlWs({ wsUrl: "ws://localhost:4000/graphql" })
      expect(config.code).toContain("ws://localhost:4000/graphql")
      expect(config.code).toContain("createClient")
    })

    it("includes retry and keepAlive settings", () => {
      const config = integrations.graphqlWs({ wsUrl: "ws://localhost:4000/graphql" })
      expect(config.code).toContain("shouldRetry")
      expect(config.code).toContain("retryAttempts")
      expect(config.code).toContain("keepAlive")
    })

    it("includes event handlers", () => {
      const config = integrations.graphqlWs({ wsUrl: "ws://localhost:4000/graphql" })
      expect(config.code).toContain("connected")
      expect(config.code).toContain("closed")
      expect(config.code).toContain("error")
    })

    it("includes subscribe helper with AsyncIterable", () => {
      const config = integrations.graphqlWs({ wsUrl: "ws://localhost:4000/graphql" })
      expect(config.code).toContain("subscribe")
      expect(config.code).toContain("Symbol.asyncIterator")
    })

    it("returns correct dependencies", () => {
      const config = integrations.graphqlWs({ wsUrl: "ws://localhost:4000/graphql" })
      expect(config.clientName).toBe("graphql-ws")
      expect(config.dependencies).toEqual(["graphql-ws"])
    })
  })

  describe("deriveHttpUrl — protocol conversion", () => {
    it("converts ws:// to http://", () => {
      const integrations = new ClientIntegrations()
      const config = integrations.apollo({ wsUrl: "ws://localhost:4000/graphql" })
      expect(config.code).toContain("http://localhost:4000/graphql")
    })

    it("converts wss:// to https://", () => {
      const integrations = new ClientIntegrations()
      const config = integrations.apollo({ wsUrl: "wss://api.example.com/graphql" })
      expect(config.code).toContain("https://api.example.com/graphql")
    })
  })

  describe("generateSubscriptionDocument()", () => {
    let integrations: ClientIntegrations

    beforeEach(() => {
      integrations = new ClientIntegrations({ compiledSchema: createMockSchema() })
    })

    it("generates row-level subscription document", () => {
      const doc = integrations.generateSubscriptionDocument({
        typeName: "User",
        granularity: "row",
      })
      expect(doc.document).toContain("subscription ON_USER_CHANGED")
      expect(doc.document).toContain("onUserChanged")
      expect(doc.variableName).toBe("ON_USER_CHANGED")
      expect(doc.resultType).toContain("onUserChanged")
    })

    it("generates collection-level subscription document", () => {
      const doc = integrations.generateSubscriptionDocument({
        typeName: "User",
        granularity: "collection",
      })
      expect(doc.document).toContain("ON_USER_LIST")
      expect(doc.document).toContain("onUserList")
      expect(doc.variableName).toBe("ON_USER_LIST")
    })

    it("generates field-level subscription document", () => {
      const doc = integrations.generateSubscriptionDocument({
        typeName: "User",
        granularity: "field",
        watchFields: ["name", "email"],
      })
      expect(doc.document).toContain("ON_USER_FIELD_CHANGED")
      expect(doc.document).toContain("onUserFieldChanged")
      expect(doc.document).toContain("name")
      expect(doc.document).toContain("email")
    })

    it("uses selectFields when provided", () => {
      const doc = integrations.generateSubscriptionDocument({
        typeName: "User",
        granularity: "row",
        selectFields: ["id", "name"],
      })
      expect(doc.document).toContain("id")
      expect(doc.document).toContain("name")
    })

    it("uses schema fields when no selectFields given", () => {
      const doc = integrations.generateSubscriptionDocument({
        typeName: "User",
        granularity: "row",
      })
      // Non-relation fields from the compiled schema
      expect(doc.document).toContain("id")
      expect(doc.document).toContain("name")
      expect(doc.document).toContain("email")
      // Should NOT include relation fields
      expect(doc.document).not.toContain("posts")
    })

    it("falls back to 'id' when type not in schema", () => {
      const doc = integrations.generateSubscriptionDocument({
        typeName: "Unknown",
        granularity: "row",
      })
      expect(doc.document).toContain("id")
    })
  })

  describe("generateReactHooks()", () => {
    it("generates hooks for compiled schema", () => {
      const integrations = new ClientIntegrations({ compiledSchema: createMockSchema() })
      const hooks = integrations.generateReactHooks()
      expect(hooks).toContain("ON_USER_CHANGED")
      expect(hooks).toContain("ON_POST_CHANGED")
      expect(hooks).toContain("subscription On")
    })

    it("returns comment when no schema available", () => {
      const integrations = new ClientIntegrations()
      const hooks = integrations.generateReactHooks()
      expect(hooks).toContain("No compiled schema available")
    })

    it("excludes relation fields from user hooks", () => {
      const integrations = new ClientIntegrations({ compiledSchema: createMockSchema() })
      const hooks = integrations.generateReactHooks()
      // The User type should list non-relation fields only
      const userSection = hooks.split("ON_POST_CHANGED")[0]
      // "posts" is a relation field on User and should not appear in User's field list
      const _userFields = userSection.split("on${type.name}Changed")[0]
      expect(userSection).toContain("id, name, email")
    })
  })

  describe("edge cases", () => {
    it("handles missing httpUrl option", () => {
      const integrations = new ClientIntegrations()
      const config = integrations.apollo({ wsUrl: "ws://localhost:4000/graphql" })
      expect(config.code).toContain("http://localhost:4000/graphql")
    })

    it("handles undefined compiledSchema in subscription document", () => {
      const integrations = new ClientIntegrations()
      const doc = integrations.generateSubscriptionDocument({
        typeName: "User",
        granularity: "row",
      })
      expect(doc.document).toContain("id")
    })
  })
})
