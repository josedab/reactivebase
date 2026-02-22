import { describe, it, expect } from "vitest"
import {
  generateRestRoutes,
  matchRoute,
  parseQueryFilters,
  generateGraphQLSchema,
} from "../api-gen/api-gen.js"
import { defineSchema, defineTable, v } from "../schema/index.js"

const schema = defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    role: v.enum("admin", "member"),
  }),
  tasks: defineTable({
    title: v.string(),
    done: v.boolean({ default: false }),
    assigneeId: v.id("users"),
    priority: v.optional(v.integer()),
  }),
})

describe("generateRestRoutes", () => {
  it("generates CRUD routes for all tables", () => {
    const routes = generateRestRoutes(schema)

    expect(routes).toHaveLength(10) // 5 per table × 2 tables
    expect(routes.filter((r) => r.table === "users")).toHaveLength(5)
    expect(routes.filter((r) => r.table === "tasks")).toHaveLength(5)
  })

  it("uses custom base path", () => {
    const routes = generateRestRoutes(schema, { basePath: "/v1" })
    expect(routes[0].path.startsWith("/v1/")).toBe(true)
  })

  it("filters to specific tables", () => {
    const routes = generateRestRoutes(schema, { tables: ["tasks"] })
    expect(routes).toHaveLength(5)
    expect(routes.every((r) => r.table === "tasks")).toBe(true)
  })

  it("generates correct CRUD actions", () => {
    const routes = generateRestRoutes(schema, { tables: ["tasks"] })
    const actions = routes.map((r) => r.action)
    expect(actions).toEqual(["list", "get", "create", "update", "delete"])
  })
})

describe("matchRoute", () => {
  const routes = generateRestRoutes(schema)

  it("matches GET /api/users", () => {
    const result = matchRoute("GET", "/api/users", routes)
    expect(result).not.toBeNull()
    expect(result!.route.action).toBe("list")
    expect(result!.route.table).toBe("users")
  })

  it("matches GET /api/users/123", () => {
    const result = matchRoute("GET", "/api/users/123", routes)
    expect(result).not.toBeNull()
    expect(result!.route.action).toBe("get")
    expect(result!.params.id).toBe("123")
  })

  it("matches POST /api/tasks", () => {
    const result = matchRoute("POST", "/api/tasks", routes)
    expect(result).not.toBeNull()
    expect(result!.route.action).toBe("create")
  })

  it("matches PATCH /api/tasks/abc", () => {
    const result = matchRoute("PATCH", "/api/tasks/abc", routes)
    expect(result).not.toBeNull()
    expect(result!.route.action).toBe("update")
    expect(result!.params.id).toBe("abc")
  })

  it("matches DELETE /api/users/u1", () => {
    const result = matchRoute("DELETE", "/api/users/u1", routes)
    expect(result).not.toBeNull()
    expect(result!.route.action).toBe("delete")
  })

  it("returns null for non-matching routes", () => {
    expect(matchRoute("PUT", "/api/users", routes)).toBeNull()
    expect(matchRoute("GET", "/api/unknown", routes)).toBeNull()
  })

  it("strips query params before matching", () => {
    const result = matchRoute("GET", "/api/tasks?done=false&limit=10", routes)
    expect(result).not.toBeNull()
    expect(result!.route.action).toBe("list")
  })
})

describe("parseQueryFilters", () => {
  it("parses query string into filters", () => {
    const filters = parseQueryFilters("/api/tasks?done=false&priority=high")
    expect(filters).toEqual({ done: "false", priority: "high" })
  })

  it("returns empty for no query string", () => {
    expect(parseQueryFilters("/api/tasks")).toEqual({})
  })

  it("handles URL-encoded values", () => {
    const filters = parseQueryFilters("/api/tasks?title=Hello%20World")
    expect(filters.title).toBe("Hello World")
  })
})

describe("generateGraphQLSchema", () => {
  it("generates type definitions for all tables", () => {
    const gql = generateGraphQLSchema(schema)

    expect(gql).toContain("type Users {")
    expect(gql).toContain("type Tasks {")
    expect(gql).toContain("id: ID!")
    expect(gql).toContain("name: String!")
    expect(gql).toContain("done: Boolean!")
  })

  it("generates Query type", () => {
    const gql = generateGraphQLSchema(schema)
    expect(gql).toContain("type Query {")
    expect(gql).toContain("users(id: ID): [Users!]!")
    expect(gql).toContain("tasks(id: ID): [Tasks!]!")
  })

  it("generates Mutation type", () => {
    const gql = generateGraphQLSchema(schema)
    expect(gql).toContain("type Mutation {")
    expect(gql).toContain("createUsers(input: UsersInput!): Users!")
    expect(gql).toContain("deleteUsers(id: ID!): Boolean!")
  })

  it("generates Input types", () => {
    const gql = generateGraphQLSchema(schema)
    expect(gql).toContain("input UsersInput {")
    expect(gql).toContain("input TasksInput {")
  })

  it("maps types correctly", () => {
    const gql = generateGraphQLSchema(schema)
    expect(gql).toContain("String!") // required string
    expect(gql).toContain("Boolean!") // required boolean
    expect(gql).toContain("Int")     // optional integer
  })
})
