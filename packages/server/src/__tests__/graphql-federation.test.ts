import { describe, it, expect } from "vitest"
import {
  FederationGateway,
  FederationGatewayError,
} from "../graphql-federation/index.js"

describe("graphql-federation", () => {
  it("should export all expected symbols", () => {
    expect(FederationGateway).toBeDefined()
    expect(FederationGatewayError).toBeDefined()
  })

  it("should throw FederationGatewayError with correct message", () => {
    const error = new FederationGatewayError("gateway error")
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe("gateway error")
  })

  it("should construct a FederationGateway instance", () => {
    const gateway = new FederationGateway({})
    expect(gateway).toBeInstanceOf(FederationGateway)
  })

  it("should test gateway construction with subgraph configs", () => {
    const gateway = new FederationGateway({ errorStrategy: "partial" })
    gateway.addSubgraph({
      name: "users",
      url: "http://localhost:4001/graphql",
      sdl: "type User @key(fields: \"id\") { id: ID! name: String! }",
    })
    gateway.addSubgraph({
      name: "orders",
      url: "http://localhost:4002/graphql",
      sdl: "type Order @key(fields: \"id\") { id: ID! total: Float! }",
    })

    const subgraphs = gateway.getSubgraphs()
    expect(subgraphs).toHaveLength(2)
    expect(subgraphs.map((s) => s.name)).toContain("users")
    expect(subgraphs.map((s) => s.name)).toContain("orders")
    expect(subgraphs[0].status).toBe("unknown")
    expect(subgraphs[0].entityTypes).toContain("User")
    expect(subgraphs[1].entityTypes).toContain("Order")
  })

  it("should test schema composition and conflict detection", () => {
    const gateway = new FederationGateway()
    gateway.addSubgraph({
      name: "users",
      url: "http://localhost:4001/graphql",
      sdl: "type User @key(fields: \"id\") { id: ID! name: String! }\ntype Profile { bio: String }",
    })
    gateway.addSubgraph({
      name: "accounts",
      url: "http://localhost:4002/graphql",
      sdl: "type User @key(fields: \"id\") { id: ID! email: String! }\ntype Profile { avatar: String }",
    })

    const composed = gateway.compose()
    expect(composed.subgraphs).toHaveLength(2)
    expect(composed.sdl).toContain("Subgraph: users")
    expect(composed.sdl).toContain("Subgraph: accounts")

    // User is an entity type shared across subgraphs — should be merged
    expect(composed.entityTypes.get("User")).toEqual(expect.arrayContaining(["users", "accounts"]))

    // Profile is a non-entity type defined in multiple subgraphs — should be a conflict
    const profileConflict = composed.conflicts.find((c) => c.typeName === "Profile")
    expect(profileConflict).toBeDefined()
    expect(profileConflict!.resolution).toBe("first_wins")
  })
})
