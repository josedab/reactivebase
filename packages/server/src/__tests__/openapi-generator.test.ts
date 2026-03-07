import { describe, it, expect, beforeEach } from "vitest"
import { OpenApiGenerator } from "../api-gen/openapi-generator.js"
import type { FunctionDescriptor } from "../api-gen/openapi-generator.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeQueryFn(overrides: Partial<FunctionDescriptor> = {}): FunctionDescriptor {
  return {
    name: "getUsers",
    type: "query",
    args: {
      limit: { type: "integer", required: false, description: "Max results" },
      status: { type: "string", required: true },
    },
    returns: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } } },
    description: "Get users list",
    module: "users",
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
    module: "users",
    ...overrides,
  }
}

// ─── OpenApiGenerator ────────────────────────────────────────────────────────

describe("OpenApiGenerator", () => {
  let generator: OpenApiGenerator

  describe("constructor", () => {
    it("uses default options", () => {
      generator = new OpenApiGenerator()
      const spec = generator.generateSpec([])
      expect(spec.info.title).toBe("ReactiveBase API")
      expect(spec.info.version).toBe("1.0.0")
      expect(spec.servers[0].url).toBe("http://localhost:4000")
    })

    it("accepts custom options", () => {
      generator = new OpenApiGenerator({
        title: "My API",
        version: "2.0.0",
        serverUrl: "https://api.example.com",
        basePath: "/v2",
      })
      const spec = generator.generateSpec([])
      expect(spec.info.title).toBe("My API")
      expect(spec.info.version).toBe("2.0.0")
      expect(spec.servers[0].url).toBe("https://api.example.com")
    })

    it("accepts contact and license", () => {
      generator = new OpenApiGenerator({
        contact: { name: "Dev", email: "dev@test.com" },
        license: { name: "MIT", url: "https://opensource.org/licenses/MIT" },
      })
      const spec = generator.generateSpec([])
      expect(spec.info.contact).toEqual({ name: "Dev", email: "dev@test.com" })
      expect(spec.info.license).toEqual({ name: "MIT", url: "https://opensource.org/licenses/MIT" })
    })
  })

  describe("generateSpec() — structure", () => {
    beforeEach(() => {
      generator = new OpenApiGenerator()
    })

    it("generates valid OpenAPI 3.1 spec", () => {
      const spec = generator.generateSpec([makeQueryFn()])
      expect(spec.openapi).toBe("3.1.0")
      expect(spec.info).toBeDefined()
      expect(spec.paths).toBeDefined()
      expect(spec.components).toBeDefined()
      expect(spec.components.schemas).toBeDefined()
      expect(spec.components.securitySchemes).toBeDefined()
    })

    it("includes security schemes", () => {
      const spec = generator.generateSpec([])
      expect(spec.components.securitySchemes.bearerAuth).toBeDefined()
      expect(spec.components.securitySchemes.bearerAuth.type).toBe("http")
      expect(spec.components.securitySchemes.bearerAuth.scheme).toBe("bearer")
      expect(spec.components.securitySchemes.apiKey).toBeDefined()
      expect(spec.components.securitySchemes.apiKey.type).toBe("apiKey")
    })

    it("includes global security requirements", () => {
      const spec = generator.generateSpec([])
      expect(spec.security).toEqual([{ bearerAuth: [] }, { apiKey: [] }])
    })

    it("generates tags from function modules", () => {
      const spec = generator.generateSpec([makeQueryFn({ module: "users" }), makeMutationFn({ module: "admin" })])
      expect(spec.tags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "users" }),
          expect.objectContaining({ name: "admin" }),
        ]),
      )
    })

    it("uses custom tags when provided", () => {
      const customTags = [{ name: "custom", description: "Custom tag" }]
      const spec = generator.generateSpec([makeQueryFn()], { tags: customTags })
      expect(spec.tags).toEqual(customTags)
    })
  })

  describe("generateSpec() — query functions → GET", () => {
    beforeEach(() => {
      generator = new OpenApiGenerator()
    })

    it("generates GET endpoints for query functions", () => {
      const spec = generator.generateSpec([makeQueryFn()])
      const path = spec.paths["/api/v1/getUsers"]
      expect(path).toBeDefined()
      expect(path.get).toBeDefined()
      expect(path.post).toBeUndefined()
    })

    it("maps args to query parameters", () => {
      const spec = generator.generateSpec([makeQueryFn()])
      const params = spec.paths["/api/v1/getUsers"].get!.parameters!
      expect(params).toHaveLength(2)
      expect(params.find((p) => p.name === "limit")).toEqual(
        expect.objectContaining({ in: "query", required: false }),
      )
      expect(params.find((p) => p.name === "status")).toEqual(
        expect.objectContaining({ in: "query", required: true }),
      )
    })

    it("sets operationId to function name", () => {
      const spec = generator.generateSpec([makeQueryFn()])
      expect(spec.paths["/api/v1/getUsers"].get!.operationId).toBe("getUsers")
    })

    it("includes 200, 400, 401 responses", () => {
      const spec = generator.generateSpec([makeQueryFn()])
      const responses = spec.paths["/api/v1/getUsers"].get!.responses
      expect(responses["200"]).toBeDefined()
      expect(responses["400"]).toBeDefined()
      expect(responses["401"]).toBeDefined()
    })

    it("references return schema via $ref", () => {
      const spec = generator.generateSpec([makeQueryFn()])
      const content = spec.paths["/api/v1/getUsers"].get!.responses["200"].content!
      expect(content["application/json"].schema.$ref).toBe("#/components/schemas/GetUsersResponse")
    })
  })

  describe("generateSpec() — mutation/action functions → POST", () => {
    beforeEach(() => {
      generator = new OpenApiGenerator()
    })

    it("generates POST endpoints for mutation functions", () => {
      const spec = generator.generateSpec([makeMutationFn()])
      const path = spec.paths["/api/v1/createUser"]
      expect(path).toBeDefined()
      expect(path.post).toBeDefined()
      expect(path.get).toBeUndefined()
    })

    it("generates POST endpoints for action functions", () => {
      const spec = generator.generateSpec([makeMutationFn({ type: "action", name: "sendEmail" })])
      expect(spec.paths["/api/v1/sendEmail"].post).toBeDefined()
    })

    it("creates input schema for request body", () => {
      const spec = generator.generateSpec([makeMutationFn()])
      expect(spec.components.schemas["CreateUserInput"]).toBeDefined()
      expect(spec.components.schemas["CreateUserInput"].type).toBe("object")
      expect(spec.components.schemas["CreateUserInput"].properties).toBeDefined()
    })

    it("marks required args in input schema", () => {
      const spec = generator.generateSpec([makeMutationFn()])
      expect(spec.components.schemas["CreateUserInput"].required).toContain("name")
      expect(spec.components.schemas["CreateUserInput"].required).toContain("email")
    })

    it("references input schema in requestBody", () => {
      const spec = generator.generateSpec([makeMutationFn()])
      const reqBody = spec.paths["/api/v1/createUser"].post!.requestBody!
      expect(reqBody.required).toBe(true)
      expect(reqBody.content["application/json"].schema.$ref).toBe("#/components/schemas/CreateUserInput")
    })
  })

  describe("scalar type mapping", () => {
    beforeEach(() => {
      generator = new OpenApiGenerator()
    })

    it("maps string type", () => {
      const spec = generator.generateSpec([makeQueryFn({ args: { q: { type: "string" } }, returns: { type: "string" } })])
      const param = spec.paths["/api/v1/getUsers"].get!.parameters![0]
      expect(param.schema.type).toBe("string")
    })

    it("maps number type with double format", () => {
      const spec = generator.generateSpec([makeQueryFn({ args: { price: { type: "number" } }, returns: { type: "string" } })])
      const param = spec.paths["/api/v1/getUsers"].get!.parameters![0]
      expect(param.schema.type).toBe("number")
      expect(param.schema.format).toBe("double")
    })

    it("maps integer type", () => {
      const spec = generator.generateSpec([makeQueryFn({ args: { count: { type: "integer" } }, returns: { type: "string" } })])
      const param = spec.paths["/api/v1/getUsers"].get!.parameters![0]
      expect(param.schema.type).toBe("integer")
    })

    it("maps boolean type", () => {
      const spec = generator.generateSpec([makeQueryFn({ args: { active: { type: "boolean" } }, returns: { type: "string" } })])
      const param = spec.paths["/api/v1/getUsers"].get!.parameters![0]
      expect(param.schema.type).toBe("boolean")
    })

    it("maps unknown type to string", () => {
      const spec = generator.generateSpec([makeQueryFn({ args: { x: { type: "unknown" } }, returns: { type: "string" } })])
      const param = spec.paths["/api/v1/getUsers"].get!.parameters![0]
      expect(param.schema.type).toBe("string")
    })
  })

  describe("array parameters", () => {
    it("maps array arg with items type", () => {
      generator = new OpenApiGenerator()
      const spec = generator.generateSpec([
        makeQueryFn({ args: { ids: { type: "array", items: { type: "integer" } } }, returns: { type: "string" } }),
      ])
      const param = spec.paths["/api/v1/getUsers"].get!.parameters![0]
      expect(param.schema.type).toBe("array")
      expect(param.schema.items).toEqual({ type: "integer" })
    })

    it("defaults array items to string", () => {
      generator = new OpenApiGenerator()
      const spec = generator.generateSpec([
        makeQueryFn({ args: { tags: { type: "array" } }, returns: { type: "string" } }),
      ])
      const param = spec.paths["/api/v1/getUsers"].get!.parameters![0]
      expect(param.schema.items).toEqual({ type: "string" })
    })
  })

  describe("optional parameters & enum", () => {
    it("handles optional parameters (required: false)", () => {
      generator = new OpenApiGenerator()
      const spec = generator.generateSpec([
        makeQueryFn({ args: { filter: { type: "string", required: false } }, returns: { type: "string" } }),
      ])
      const param = spec.paths["/api/v1/getUsers"].get!.parameters![0]
      expect(param.required).toBe(false)
    })

    it("handles enum values", () => {
      generator = new OpenApiGenerator()
      const spec = generator.generateSpec([
        makeQueryFn({ args: { role: { type: "string", enum: ["admin", "user"] } }, returns: { type: "string" } }),
      ])
      const param = spec.paths["/api/v1/getUsers"].get!.parameters![0]
      expect(param.schema.enum).toEqual(["admin", "user"])
    })

    it("includes default value", () => {
      generator = new OpenApiGenerator()
      const spec = generator.generateSpec([
        makeQueryFn({ args: { page: { type: "integer", default: 1 } }, returns: { type: "string" } }),
      ])
      const param = spec.paths["/api/v1/getUsers"].get!.parameters![0]
      expect(param.schema.default).toBe(1)
    })
  })

  describe("nested object args", () => {
    it("generates object schema with properties", () => {
      generator = new OpenApiGenerator()
      const spec = generator.generateSpec([
        makeMutationFn({
          args: {
            address: {
              type: "object",
              properties: {
                street: { type: "string" },
                city: { type: "string" },
              },
            },
          },
        }),
      ])
      const inputSchema = spec.components.schemas["CreateUserInput"]
      expect(inputSchema.properties!.address.type).toBe("object")
      expect(inputSchema.properties!.address.properties!.street.type).toBe("string")
    })
  })

  describe("generateSwaggerUIHTML()", () => {
    it("returns valid HTML with spec embedded", () => {
      generator = new OpenApiGenerator()
      const spec = generator.generateSpec([makeQueryFn()])
      const html = generator.generateSwaggerUIHTML(spec)
      expect(html).toContain("<!DOCTYPE html>")
      expect(html).toContain("swagger-ui")
      expect(html).toContain(spec.info.title)
      expect(html).toContain("SwaggerUIBundle")
    })

    it("embeds the spec as JSON", () => {
      generator = new OpenApiGenerator()
      const spec = generator.generateSpec([])
      const html = generator.generateSwaggerUIHTML(spec)
      expect(html).toContain(JSON.stringify(spec))
    })
  })

  describe("generateRedocHTML()", () => {
    it("returns valid HTML with Redoc", () => {
      generator = new OpenApiGenerator()
      const spec = generator.generateSpec([makeQueryFn()])
      const html = generator.generateRedocHTML(spec)
      expect(html).toContain("<!DOCTYPE html>")
      expect(html).toContain("redoc")
      expect(html).toContain(spec.info.title)
      expect(html).toContain("Redoc.init")
    })

    it("embeds the spec as JSON", () => {
      generator = new OpenApiGenerator()
      const spec = generator.generateSpec([])
      const html = generator.generateRedocHTML(spec)
      expect(html).toContain(JSON.stringify(spec))
    })
  })

  describe("edge cases", () => {
    beforeEach(() => {
      generator = new OpenApiGenerator()
    })

    it("handles empty function list", () => {
      const spec = generator.generateSpec([])
      expect(spec.paths).toEqual({})
      expect(spec.openapi).toBe("3.1.0")
    })

    it("handles function with no description", () => {
      const fn = makeQueryFn({ description: undefined })
      const spec = generator.generateSpec([fn])
      const op = spec.paths["/api/v1/getUsers"].get!
      expect(op.summary).toBe("Query getUsers")
    })

    it("handles function with no module", () => {
      const fn = makeQueryFn({ module: undefined })
      const spec = generator.generateSpec([fn])
      expect(spec.tags).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "default" })]),
      )
    })

    it("handles mutation with no args", () => {
      const spec = generator.generateSpec([makeMutationFn({ args: {} })])
      const inputSchema = spec.components.schemas["CreateUserInput"]
      expect(inputSchema.type).toBe("object")
      expect(inputSchema.required).toBeUndefined()
    })

    it("handles custom basePath", () => {
      generator = new OpenApiGenerator({ basePath: "/v2" })
      const spec = generator.generateSpec([makeQueryFn()])
      expect(Object.keys(spec.paths)[0]).toBe("/v2/getUsers")
    })

    it("generates return type schemas for all return types", () => {
      const spec = generator.generateSpec([
        makeQueryFn({ name: "getString", returns: { type: "string" } }),
        makeQueryFn({ name: "getNumber", returns: { type: "number" } }),
        makeQueryFn({ name: "getBool", returns: { type: "boolean" } }),
      ])
      expect(spec.components.schemas["GetStringResponse"].type).toBe("string")
      expect(spec.components.schemas["GetNumberResponse"].type).toBe("number")
      expect(spec.components.schemas["GetBoolResponse"].type).toBe("boolean")
    })
  })
})
