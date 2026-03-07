import { describe, it, expect } from "vitest"
import {
  SchemaCompiler,
  SchemaCompilerError,
  type SchemaInput,
  type SchemaCompilerOptions,
} from "../schema-compiler.js"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSchema(overrides: Partial<SchemaInput> = {}): SchemaInput {
  return {
    name: "main",
    tableNames: ["tasks"],
    tables: {
      tasks: {
        columns: {
          title: { type: "string", isOptional: false },
          done: { type: "boolean", isOptional: true },
        },
      },
    },
    ...overrides,
  }
}

function compileWith(options: Partial<SchemaCompilerOptions> = {}) {
  const compiler = new SchemaCompiler({
    schemas: [makeSchema()],
    ...options,
  })
  return compiler.compile()
}

// ── Constructor ───────────────────────────────────────────────────────────────

describe("SchemaCompiler", () => {
  it("throws when no schemas are provided", () => {
    expect(() => new SchemaCompiler({ schemas: [] })).toThrow(SchemaCompilerError)
  })

  it("throws when schemas is empty array", () => {
    expect(() => new SchemaCompiler({ schemas: [] })).toThrow("At least one schema is required")
  })

  // ── Single Schema Compilation ─────────────────────────────────────────────

  describe("compile() single schema", () => {
    it("produces valid SDL with type, input, where, query, mutation, subscription", () => {
      const result = compileWith()
      expect(result.sdl).toContain("type Tasks {")
      expect(result.sdl).toContain("input TasksInput {")
      expect(result.sdl).toContain("input TasksWhereInput {")
      expect(result.sdl).toContain("type Query {")
      expect(result.sdl).toContain("type Mutation {")
      expect(result.sdl).toContain("type Subscription {")
    })

    it("includes id field in type", () => {
      const result = compileWith()
      expect(result.sdl).toContain("id: ID!")
    })

    it("maps string columns to String", () => {
      const result = compileWith()
      expect(result.sdl).toContain("title: String!")
    })

    it("maps boolean columns to Boolean", () => {
      const result = compileWith()
      expect(result.sdl).toContain("done: Boolean")
    })

    it("generates CRUD mutations", () => {
      const result = compileWith()
      expect(result.sdl).toContain("createTasks(input: TasksInput!): Tasks!")
      expect(result.sdl).toContain("updateTasks(id: ID!, input: TasksInput!): Tasks!")
      expect(result.sdl).toContain("deleteTasks(id: ID!): Boolean!")
    })

    it("generates singular query", () => {
      const result = compileWith()
      expect(result.sdl).toContain("task(id: ID!): Tasks")
    })
  })

  // ── Per-field Reactivity ──────────────────────────────────────────────────

  describe("per-field reactivity", () => {
    it("adds @reactive directive to fields when enabled", () => {
      const result = compileWith({ perFieldReactivity: true })
      expect(result.sdl).toContain("@reactive")
    })

    it("omits @reactive directive when disabled", () => {
      const result = compileWith({ perFieldReactivity: false })
      // Fields should not have @reactive
      const lines = result.sdl.split("\n").filter((l) => l.includes("title:"))
      expect(lines.every((l) => !l.includes("@reactive"))).toBe(true)
    })

    it("generates field-level subscription when perFieldReactivity is on", () => {
      const result = compileWith({ perFieldReactivity: true })
      expect(result.sdl).toContain("onTasksFieldChanged")
      expect(result.reactivityMap).toHaveProperty("onTasksFieldChanged")
      expect(result.reactivityMap["onTasksFieldChanged"].granularity).toBe("field")
    })

    it("omits field-level subscription when perFieldReactivity is off", () => {
      const result = compileWith({ perFieldReactivity: false })
      expect(result.sdl).not.toContain("onTasksFieldChanged")
    })

    it("generates row-level and collection-level subscriptions", () => {
      const result = compileWith()
      expect(result.reactivityMap).toHaveProperty("onTasksChanged")
      expect(result.reactivityMap["onTasksChanged"].granularity).toBe("row")
      expect(result.reactivityMap).toHaveProperty("onTasksList")
      expect(result.reactivityMap["onTasksList"].granularity).toBe("collection")
    })
  })

  // ── Relay Pagination ──────────────────────────────────────────────────────

  describe("Relay cursor pagination", () => {
    it("generates Connection and Edge types", () => {
      const result = compileWith({ relayPagination: true })
      expect(result.sdl).toContain("type TasksEdge {")
      expect(result.sdl).toContain("cursor: String!")
      expect(result.sdl).toContain("node: Tasks!")
      expect(result.sdl).toContain("type TasksConnection {")
      expect(result.sdl).toContain("edges: [TasksEdge!]!")
      expect(result.sdl).toContain("pageInfo: PageInfo!")
      expect(result.sdl).toContain("totalCount: Int!")
    })

    it("generates PageInfo type", () => {
      const result = compileWith({ relayPagination: true })
      expect(result.sdl).toContain("type PageInfo {")
      expect(result.sdl).toContain("hasNextPage: Boolean!")
      expect(result.sdl).toContain("hasPreviousPage: Boolean!")
    })

    it("query uses Connection when relay is enabled", () => {
      const result = compileWith({ relayPagination: true })
      expect(result.sdl).toContain("tasks(first: Int, after: String")
      expect(result.sdl).toContain("TasksConnection!")
    })

    it("query uses simple list when relay is disabled", () => {
      const result = compileWith({ relayPagination: false })
      expect(result.sdl).toContain("tasks(limit: Int, offset: Int")
      expect(result.sdl).toContain("[Tasks!]!")
      expect(result.sdl).not.toContain("TasksConnection")
    })

    it("sets hasRelayCursor in typeMap", () => {
      const result = compileWith({ relayPagination: true })
      expect(result.typeMap["Tasks"].hasRelayCursor).toBe(true)
    })
  })

  // ── Custom Scalar Mappings ────────────────────────────────────────────────

  describe("custom scalar mappings", () => {
    it("includes custom scalars in SDL", () => {
      const result = compileWith({
        customScalars: {
          Money: { name: "Money", description: "Currency amount", tsType: "number" },
        },
      })
      expect(result.sdl).toContain('"""Currency amount"""')
      expect(result.sdl).toContain("scalar Money")
    })

    it("includes default scalars (DateTime, JSON, GeoJSON)", () => {
      const result = compileWith()
      expect(result.sdl).toContain("scalar DateTime")
      expect(result.sdl).toContain("scalar JSON")
      expect(result.sdl).toContain("scalar GeoJSON")
    })
  })

  // ── Column Type Mappings ──────────────────────────────────────────────────

  describe("column type mappings", () => {
    it("maps number to Float", () => {
      const schema = makeSchema({
        tables: {
          tasks: {
            columns: { price: { type: "number", isOptional: false } },
          },
        },
      })
      const result = new SchemaCompiler({ schemas: [schema] }).compile()
      expect(result.sdl).toContain("price: Float!")
    })

    it("maps integer to Int", () => {
      const schema = makeSchema({
        tables: {
          tasks: {
            columns: { count: { type: "integer", isOptional: false } },
          },
        },
      })
      const result = new SchemaCompiler({ schemas: [schema] }).compile()
      expect(result.sdl).toContain("count: Int!")
    })

    it("maps timestamp to DateTime", () => {
      const schema = makeSchema({
        tables: {
          tasks: {
            columns: { createdAt: { type: "timestamp", isOptional: false } },
          },
        },
      })
      const result = new SchemaCompiler({ schemas: [schema] }).compile()
      expect(result.sdl).toContain("createdAt: DateTime!")
    })

    it("maps json to JSON", () => {
      const schema = makeSchema({
        tables: {
          tasks: {
            columns: { metadata: { type: "json", isOptional: true } },
          },
        },
      })
      const result = new SchemaCompiler({ schemas: [schema] }).compile()
      expect(result.sdl).toContain("metadata: JSON")
    })

    it("maps optional columns without !", () => {
      const schema = makeSchema({
        tables: {
          tasks: {
            columns: {
              title: { type: "string", isOptional: true },
            },
          },
        },
      })
      const result = new SchemaCompiler({ schemas: [schema] }).compile()
      const titleLine = result.sdl.split("\n").find((l) => l.trim().startsWith("title:"))
      expect(titleLine).toContain("String")
      expect(titleLine).not.toContain("String!")
    })
  })

  // ── Multi-schema Stitching ────────────────────────────────────────────────

  describe("multi-schema stitching", () => {
    it("compiles multiple schemas together", () => {
      const schema1: SchemaInput = {
        name: "auth",
        tableNames: ["users"],
        tables: {
          users: {
            columns: {
              email: { type: "string", isOptional: false },
            },
          },
        },
      }
      const schema2: SchemaInput = {
        name: "content",
        tableNames: ["posts"],
        tables: {
          posts: {
            columns: {
              body: { type: "string", isOptional: false },
            },
          },
        },
      }
      const compiler = new SchemaCompiler({ schemas: [schema1, schema2] })
      const result = compiler.compile()
      expect(result.sdl).toContain("type Users {")
      expect(result.sdl).toContain("type Posts {")
      expect(result.sourceSchemas).toEqual(["auth", "content"])
      expect(result.metadata.stitchedSchemas).toBe(2)
    })

    it("applies typePrefix to avoid collisions", () => {
      const schema = makeSchema()
      const compiler = new SchemaCompiler({
        schemas: [schema],
        typePrefix: "App",
      })
      const result = compiler.compile()
      expect(result.sdl).toContain("type AppTasks {")
      expect(result.sdl).toContain("input AppTasksInput {")
    })
  })

  // ── Relations ─────────────────────────────────────────────────────────────

  describe("relations", () => {
    it("generates one-to-one relation field", () => {
      const schema: SchemaInput = {
        name: "main",
        tableNames: ["posts"],
        tables: {
          posts: {
            columns: {
              title: { type: "string", isOptional: false },
            },
            relations: {
              author: { table: "users", type: "one", foreignKey: "author_id" },
            },
          },
        },
      }
      const result = new SchemaCompiler({ schemas: [schema] }).compile()
      expect(result.sdl).toContain("author: Users")
    })

    it("generates one-to-many relation field", () => {
      const schema: SchemaInput = {
        name: "main",
        tableNames: ["users"],
        tables: {
          users: {
            columns: {
              name: { type: "string", isOptional: false },
            },
            relations: {
              posts: { table: "posts", type: "many", foreignKey: "author_id" },
            },
          },
        },
      }
      const result = new SchemaCompiler({ schemas: [schema] }).compile()
      expect(result.sdl).toContain("posts: [Posts!]!")
    })

    it("marks relation fields in compiled type", () => {
      const schema: SchemaInput = {
        name: "main",
        tableNames: ["posts"],
        tables: {
          posts: {
            columns: {
              title: { type: "string", isOptional: false },
            },
            relations: {
              author: { table: "users", type: "one", foreignKey: "author_id" },
            },
          },
        },
      }
      const result = new SchemaCompiler({ schemas: [schema] }).compile()
      const authorField = result.typeMap["Posts"].fields.find((f) => f.name === "author")
      expect(authorField?.isRelation).toBe(true)
      expect(authorField?.relatedType).toBe("Users")
    })
  })

  // ── Metadata ──────────────────────────────────────────────────────────────

  describe("metadata", () => {
    it("accurately tracks compilation metadata", () => {
      const result = compileWith({ perFieldReactivity: true })
      expect(result.metadata.totalTypes).toBe(1)
      expect(result.metadata.totalFields).toBe(2) // title, done
      expect(result.metadata.totalSubscriptions).toBe(3) // row, collection, field
      expect(result.metadata.stitchedSchemas).toBe(1)
      expect(result.metadata.compiledAt).toBeGreaterThan(0)
    })
  })

  // ── Directives ────────────────────────────────────────────────────────────

  describe("directives", () => {
    it("includes directive declarations when enabled", () => {
      const result = compileWith({ directives: true })
      expect(result.sdl).toContain("directive @reactive")
      expect(result.sdl).toContain("directive @computed")
    })

    it("omits directive declarations when disabled", () => {
      const result = compileWith({ directives: false })
      expect(result.sdl).not.toContain("directive @reactive")
    })
  })

  // ── Caching & Invalidation ────────────────────────────────────────────────

  describe("caching", () => {
    it("returns cached result on second compile", () => {
      const compiler = new SchemaCompiler({ schemas: [makeSchema()] })
      const first = compiler.compile()
      const second = compiler.compile()
      expect(first).toBe(second) // Same reference
    })

    it("invalidate clears the cache", () => {
      const compiler = new SchemaCompiler({ schemas: [makeSchema()] })
      const first = compiler.compile()
      compiler.invalidate()
      const second = compiler.compile()
      expect(first).not.toBe(second) // Different reference
    })
  })

  // ── TypeScript Generation ─────────────────────────────────────────────────

  describe("generateTypeDefinitions", () => {
    it("generates TypeScript interfaces", () => {
      const compiler = new SchemaCompiler({ schemas: [makeSchema()] })
      const ts = compiler.generateTypeDefinitions()
      expect(ts).toContain("export interface Tasks {")
      expect(ts).toContain("title: string;")
      expect(ts).toContain("export interface TasksInput {")
    })
  })
})

// ── SchemaCompilerError ─────────────────────────────────────────────────────

describe("SchemaCompilerError", () => {
  it("has correct name", () => {
    const err = new SchemaCompilerError("test error")
    expect(err.name).toBe("SchemaCompilerError")
    expect(err.message).toBe("test error")
    expect(err).toBeInstanceOf(Error)
  })
})
