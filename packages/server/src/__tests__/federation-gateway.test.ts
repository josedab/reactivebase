import { describe, it, expect, beforeEach } from "vitest"
import {
  FederationGateway,
  FederationGatewayError as _FederationGatewayError,
} from "../graphql-federation/federation-gateway.js"

const USERS_SDL = `
type User @key(fields: "id") {
  id: ID!
  name: String!
  email: String!
}

type Query {
  users: [User!]!
  user(id: ID!): User
}
`

const ORDERS_SDL = `
type Order @key(fields: "id") {
  id: ID!
  userId: String!
  total: Float!
}

type Query {
  orders: [Order!]!
  order(id: ID!): Order
}
`

describe("FederationGateway", () => {
  let gateway: FederationGateway

  beforeEach(() => {
    gateway = new FederationGateway()
  })

  it("registers subgraphs", () => {
    gateway.addSubgraph({ name: "users", url: "http://localhost:4001/graphql", sdl: USERS_SDL })
    gateway.addSubgraph({ name: "orders", url: "http://localhost:4002/graphql", sdl: ORDERS_SDL })
    expect(gateway.getSubgraphs()).toHaveLength(2)
  })

  it("validates subgraph name", () => {
    expect(() => gateway.addSubgraph({ name: "", url: "http://x", sdl: "type Q{}" })).toThrow("name is required")
  })

  it("validates subgraph URL", () => {
    expect(() => gateway.addSubgraph({ name: "test", url: "", sdl: "type Q{}" })).toThrow("requires a URL")
  })

  it("validates subgraph SDL", () => {
    expect(() => gateway.addSubgraph({ name: "test", url: "http://x", sdl: "" })).toThrow("requires an SDL")
  })

  it("removes subgraphs", () => {
    gateway.addSubgraph({ name: "users", url: "http://localhost:4001/graphql", sdl: USERS_SDL })
    gateway.removeSubgraph("users")
    expect(gateway.getSubgraphs()).toHaveLength(0)
  })

  it("composes schemas", () => {
    gateway.addSubgraph({ name: "users", url: "http://localhost:4001/graphql", sdl: USERS_SDL })
    gateway.addSubgraph({ name: "orders", url: "http://localhost:4002/graphql", sdl: ORDERS_SDL })
    const composed = gateway.compose()
    expect(composed.subgraphs).toEqual(["users", "orders"])
    expect(composed.entityTypes.has("User")).toBe(true)
    expect(composed.entityTypes.has("Order")).toBe(true)
    expect(composed.sdl).toContain("User")
    expect(composed.sdl).toContain("Order")
  })

  it("throws on compose with no subgraphs", () => {
    expect(() => gateway.compose()).toThrow("No subgraphs registered")
  })

  it("creates query plans", () => {
    gateway.addSubgraph({ name: "users", url: "http://localhost:4001/graphql", sdl: USERS_SDL })
    gateway.addSubgraph({ name: "orders", url: "http://localhost:4002/graphql", sdl: ORDERS_SDL })
    const plan = gateway.planQuery("{ users { id name } }")
    expect(plan.steps.length).toBeGreaterThanOrEqual(1)
    expect(plan.estimatedSubgraphCalls).toBeGreaterThanOrEqual(1)
  })

  it("caches query plans", () => {
    gateway.addSubgraph({ name: "users", url: "http://localhost:4001/graphql", sdl: USERS_SDL })
    gateway.planQuery("{ users { id } }")
    gateway.planQuery("{ users { id } }") // cached
    const stats = gateway.getStats()
    expect(stats.cacheHitRate).toBeGreaterThan(0)
  })

  it("records health checks", () => {
    gateway.addSubgraph({ name: "users", url: "http://localhost:4001/graphql", sdl: USERS_SDL })
    gateway.recordHealthCheck("users", true, 50)
    const subgraphs = gateway.getSubgraphs()
    expect(subgraphs[0].status).toBe("healthy")
    expect(subgraphs[0].latencyMs).toBe(50)
  })

  it("detects entity types from SDL", () => {
    gateway.addSubgraph({ name: "users", url: "http://localhost:4001/graphql", sdl: USERS_SDL })
    const subgraphs = gateway.getSubgraphs()
    expect(subgraphs[0].entityTypes).toContain("User")
  })

  it("detects schema conflicts", () => {
    const sharedSDL = `type SharedType @key(fields: "id") { id: ID! name: String! }`
    gateway.addSubgraph({ name: "a", url: "http://a", sdl: sharedSDL })
    gateway.addSubgraph({ name: "b", url: "http://b", sdl: sharedSDL })
    const composed = gateway.compose()
    expect(composed.conflicts.length).toBeGreaterThan(0)
  })

  it("provides gateway stats", () => {
    gateway.addSubgraph({ name: "users", url: "http://localhost:4001/graphql", sdl: USERS_SDL })
    const stats = gateway.getStats()
    expect(stats.totalRequests).toBe(0)
    expect(stats.subgraphStats.has("users")).toBe(true)
  })
})
