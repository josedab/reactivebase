import { describe, it, expect, beforeEach } from "vitest"
import { GraphQLSchemaGenerator } from "../api-gen/graphql-schema-generator.js"
import type { FunctionDescriptor } from "../api-gen/openapi-generator.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeQueryFn(overrides: Partial<FunctionDescriptor> = {}): FunctionDescriptor {
  return {
    name: "getUsers",
    type: "query",
    args: {
      limit: { type: "integer", required: false },
      status: { type: "string", required: true },
    },
    returns: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } } },
    description: "Get users list",
    ...overrides,
  }
}

function makeMutationFn(overrides: Partial<FunctionDescriptor> = {}): FunctionDescriptor {
  return {
    name: "createUser",
    type: "mutation",
    args: {
      name: { type: "string", required: true },
      email: { type: "string", required: true },
    },
    returns: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
    description: "Create a new user",
    ...overrides,
  }
}

// ─── GraphQLSchemaGenerator ──────────────────────────────────────────────────

describe("GraphQLSchemaGenerator", () => {
  let generator: GraphQLSchemaGenerator

  beforeEach(() => {
    generator = new GraphQLSchemaGenerator()
  })

  describe("constructor", () => {
    it("enables subscriptions by default", () => {
      const result = generator.generateSchema([makeQueryFn()])
      expect(result.subscriptionFields.length).toBeGreaterThan(0)
    })

    it("disables subscriptions when configured", () => {
      generator = new GraphQLSchemaGenerator({ subscriptions: false })
      const result = generator.generateSchema([makeQueryFn()])
      expect(result.subscriptionFields).toHaveLength(0)
    })

    it("supports custom scalars", () => {
      generator = new GraphQLSchemaGenerator({ customScalars: { UUID: "A UUID scalar" } })
      const result = generator.generateSchema([])
      expect(result.sdl).toContain("scalar UUID")
      expect(result.sdl).toContain("A UUID scalar")
    })
  })

  describe("generateSchema() — Query type", () => {
    it("generates Query type for query functions", () => {
      const result = generator.generateSchema([makeQueryFn()])
      expect(result.sdl).toContain("type Query {")
      expect(result.queryFields).toContain("getUsers")
    })

    it("includes inline args for query fields", () => {
      const result = generator.generateSchema([makeQueryFn()])
      expect(result.sdl).toMatch(/getUsers\(.*limit.*status.*\)/)
    })

    it("marks required args with !", () => {
      const result = generator.generateSchema([makeQueryFn()])
      expect(result.sdl).toContain("status: String!")
    })

    it("leaves optional args without !", () => {
      const result = generator.generateSchema([makeQueryFn()])
      expect(result.sdl).toMatch(/limit: Int(?!\!)/)
    })

    it("includes description as doc comment", () => {
      const result = generator.generateSchema([makeQueryFn()])
      expect(result.sdl).toContain('"""Get users list"""')
    })
  })

  describe("generateSchema() — Mutation type", () => {
    it("generates Mutation type for mutation functions", () => {
      const result = generator.generateSchema([makeMutationFn()])
      expect(result.sdl).toContain("type Mutation {")
      expect(result.mutationFields).toContain("createUser")
    })

    it("generates Mutation type for action functions", () => {
      const result = generator.generateSchema([makeMutationFn({ type: "action", name: "sendEmail" })])
      expect(result.mutationFields).toContain("sendEmail")
    })

    it("uses input type reference for mutations", () => {
      const result = generator.generateSchema([makeMutationFn()])
      expect(result.sdl).toContain("createUser(input: CreateUserInput!)")
    })

    it("generates input types for mutation args", () => {
      const result = generator.generateSchema([makeMutationFn()])
      expect(result.sdl).toContain("input CreateUserInput {")
      expect(result.inputTypes).toContain("CreateUserInput")
    })

    it("handles mutation with no args", () => {
      const result = generator.generateSchema([makeMutationFn({ args: {} })])
      expect(result.sdl).toContain("createUser:")
      // No input type generated for empty args
      expect(result.inputTypes).not.toContain("CreateUserInput")
    })
  })

  describe("generateSchema() — Subscription type", () => {
    it("generates Subscription type from query functions", () => {
      const result = generator.generateSchema([makeQueryFn()])
      expect(result.sdl).toContain("type Subscription {")
      expect(result.subscriptionFields).toContain("onGetUsersChanged")
    })

    it("does not generate subscriptions when disabled", () => {
      generator = new GraphQLSchemaGenerator({ subscriptions: false })
      const result = generator.generateSchema([makeQueryFn()])
      expect(result.sdl).not.toContain("type Subscription {")
      expect(result.subscriptionFields).toHaveLength(0)
    })
  })

  describe("scalar type mapping", () => {
    it("maps string → String", () => {
      const result = generator.generateSchema([makeQueryFn({ args: { q: { type: "string" } }, returns: { type: "string" } })])
      expect(result.sdl).toContain("String")
    })

    it("maps number → Float", () => {
      const result = generator.generateSchema([makeQueryFn({ args: { price: { type: "number" } }, returns: { type: "string" } })])
      expect(result.sdl).toContain("Float")
    })

    it("maps integer → Int", () => {
      const result = generator.generateSchema([makeQueryFn({ args: { count: { type: "integer" } }, returns: { type: "string" } })])
      expect(result.sdl).toContain("Int")
    })

    it("maps boolean → Boolean", () => {
      const result = generator.generateSchema([makeQueryFn({ args: { active: { type: "boolean" } }, returns: { type: "string" } })])
      expect(result.sdl).toContain("Boolean")
    })

    it("maps object → JSON", () => {
      const result = generator.generateSchema([makeQueryFn({ args: { meta: { type: "object" } }, returns: { type: "string" } })])
      expect(result.sdl).toContain("JSON")
    })

    it("maps unknown type → String", () => {
      const result = generator.generateSchema([makeQueryFn({ args: { x: { type: "custom" } }, returns: { type: "string" } })])
      expect(result.sdl).toContain("String")
    })
  })

  describe("object type generation", () => {
    it("generates output types for object return types", () => {
      const result = generator.generateSchema([makeMutationFn()])
      expect(result.sdl).toContain("type CreateUserOutput {")
      expect(result.types).toContain("CreateUserOutput")
    })

    it("generates output types for array-of-objects return types", () => {
      const result = generator.generateSchema([makeQueryFn()])
      expect(result.sdl).toContain("type GetUsersOutput {")
      expect(result.types).toContain("GetUsersOutput")
    })

    it("uses output type reference in return types", () => {
      const result = generator.generateSchema([makeQueryFn()])
      expect(result.sdl).toContain("[GetUsersOutput]")
    })
  })

  describe("array type handling", () => {
    it("wraps array items in brackets", () => {
      const result = generator.generateSchema([
        makeQueryFn({
          args: { ids: { type: "array", items: { type: "integer" } } },
          returns: { type: "string" },
        }),
      ])
      expect(result.sdl).toContain("[Int]")
    })

    it("defaults array items to String", () => {
      const result = generator.generateSchema([
        makeQueryFn({
          args: { tags: { type: "array" } },
          returns: { type: "string" },
        }),
      ])
      expect(result.sdl).toContain("[String]")
    })
  })

  describe("built-in scalars", () => {
    it("always includes JSON and DateTime scalars", () => {
      const result = generator.generateSchema([])
      expect(result.sdl).toContain("scalar JSON")
      expect(result.sdl).toContain("scalar DateTime")
    })
  })

  describe("generateGraphQLPlaygroundHTML()", () => {
    it("returns valid HTML", () => {
      const html = generator.generateGraphQLPlaygroundHTML("/graphql")
      expect(html).toContain("<!DOCTYPE html>")
      expect(html).toContain("graphiql")
      expect(html).toContain("/graphql")
    })

    it("sets the endpoint URL", () => {
      const html = generator.generateGraphQLPlaygroundHTML("https://api.example.com/graphql")
      expect(html).toContain("https://api.example.com/graphql")
    })

    it("includes React and GraphiQL scripts", () => {
      const html = generator.generateGraphQLPlaygroundHTML("/graphql")
      expect(html).toContain("react.production.min.js")
      expect(html).toContain("graphiql.min.js")
    })
  })

  describe("generateIntrospectionResponse()", () => {
    it("returns valid introspection structure", () => {
      const response = generator.generateIntrospectionResponse([makeQueryFn(), makeMutationFn()])
      expect(response.data.__schema).toBeDefined()
      expect(response.data.__schema.queryType).toEqual({ name: "Query" })
      expect(response.data.__schema.mutationType).toEqual({ name: "Mutation" })
    })

    it("includes built-in scalar types", () => {
      const response = generator.generateIntrospectionResponse([])
      const typeNames = response.data.__schema.types.map((t) => t.name)
      expect(typeNames).toContain("String")
      expect(typeNames).toContain("Int")
      expect(typeNames).toContain("Float")
      expect(typeNames).toContain("Boolean")
      expect(typeNames).toContain("JSON")
    })

    it("includes Query type with fields", () => {
      const response = generator.generateIntrospectionResponse([makeQueryFn()])
      const queryType = response.data.__schema.types.find((t) => t.name === "Query")
      expect(queryType).toBeDefined()
      expect(queryType!.kind).toBe("OBJECT")
      expect(queryType!.fields).toHaveLength(1)
      expect(queryType!.fields![0].name).toBe("getUsers")
    })

    it("includes Mutation type with fields", () => {
      const response = generator.generateIntrospectionResponse([makeMutationFn()])
      const mutationType = response.data.__schema.types.find((t) => t.name === "Mutation")
      expect(mutationType).toBeDefined()
      expect(mutationType!.fields).toHaveLength(1)
      expect(mutationType!.fields![0].name).toBe("createUser")
    })

    it("includes Subscription type when subscriptions enabled", () => {
      const response = generator.generateIntrospectionResponse([makeQueryFn()])
      expect(response.data.__schema.subscriptionType).toEqual({ name: "Subscription" })
      const subType = response.data.__schema.types.find((t) => t.name === "Subscription")
      expect(subType).toBeDefined()
    })

    it("sets subscriptionType to null when no queries", () => {
      const response = generator.generateIntrospectionResponse([makeMutationFn()])
      expect(response.data.__schema.subscriptionType).toBeNull()
    })

    it("sets mutationType to null when no mutations", () => {
      const response = generator.generateIntrospectionResponse([makeQueryFn()])
      expect(response.data.__schema.mutationType).toBeNull()
    })
  })

  describe("edge cases", () => {
    it("handles empty function list", () => {
      const result = generator.generateSchema([])
      expect(result.queryFields).toHaveLength(0)
      expect(result.mutationFields).toHaveLength(0)
      expect(result.subscriptionFields).toHaveLength(0)
    })

    it("handles function with no description", () => {
      const result = generator.generateSchema([makeQueryFn({ description: undefined })])
      expect(result.sdl).toContain("getUsers")
      expect(result.sdl).not.toContain('""""""')
    })

    it("handles function with no return type properties", () => {
      const result = generator.generateSchema([makeQueryFn({ returns: { type: "string" } })])
      expect(result.types).not.toContain("GetUsersOutput")
    })

    it("handles enum args in GraphQL as String", () => {
      const result = generator.generateSchema([
        makeQueryFn({ args: { role: { type: "string", enum: ["admin", "user"] } }, returns: { type: "string" } }),
      ])
      expect(result.sdl).toContain("String")
    })

    it("handles PascalCase conversion for names with separators", () => {
      const result = generator.generateSchema([makeQueryFn({ name: "get-all.users" })])
      expect(result.sdl).toContain("get-all.users")
      // Output type should use PascalCase
      expect(result.types.some((t) => t.includes("Output"))).toBe(true)
    })
  })
})
