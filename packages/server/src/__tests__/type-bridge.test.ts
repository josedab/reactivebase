import { describe, it, expect, beforeEach } from "vitest"
import { TypeBridge } from "../type-bridge/type-bridge.js"
import type { ScannedFunction, ScannedTable, TypeDescriptor, TypeManifest } from "../type-bridge/type-bridge.js"

const sampleTables: ScannedTable[] = [
  {
    name: "tasks",
    columns: {
      id: { name: "id", pgType: "text", tsType: "string", nullable: false, hasDefault: true },
      title: { name: "title", pgType: "text", tsType: "string", nullable: false, hasDefault: false },
      done: { name: "done", pgType: "boolean", tsType: "boolean", nullable: false, hasDefault: true },
      priority: {
        name: "priority",
        pgType: "text",
        tsType: '"low" | "medium" | "high"',
        nullable: false,
        hasDefault: false,
      },
    },
  },
  {
    name: "users",
    columns: {
      id: { name: "id", pgType: "text", tsType: "string", nullable: false, hasDefault: true },
      name: { name: "name", pgType: "text", tsType: "string", nullable: false, hasDefault: false },
      email: { name: "email", pgType: "text", tsType: "string", nullable: false, hasDefault: false },
    },
  },
]

const sampleFunctions: ScannedFunction[] = [
  {
    name: "list",
    module: "tasks",
    kind: "query",
    args: { kind: "object", properties: { userId: { type: { kind: "primitive", type: "string" }, optional: false } } },
    returns: { kind: "array", element: { kind: "reference", table: "tasks", fullRow: true } },
    sourcePath: "convex/tasks.ts",
    sourceLine: 5,
  },
  {
    name: "complete",
    module: "tasks",
    kind: "mutation",
    args: { kind: "object", properties: { taskId: { type: { kind: "primitive", type: "string" }, optional: false } } },
    returns: {
      kind: "object",
      properties: { success: { type: { kind: "primitive", type: "boolean" }, optional: false } },
    },
  },
  {
    name: "getUser",
    module: "users",
    kind: "query",
    args: { kind: "object", properties: { id: { type: { kind: "primitive", type: "string" }, optional: false } } },
    returns: {
      kind: "union",
      members: [
        { kind: "reference", table: "users", fullRow: true },
        { kind: "primitive", type: "null" },
      ],
    },
  },
]

describe("TypeBridge", () => {
  let bridge: TypeBridge

  beforeEach(() => {
    bridge = new TypeBridge()
  })

  describe("generateManifest", () => {
    it("generates manifest with functions and tables", () => {
      const manifest = bridge.generateManifest(sampleFunctions, sampleTables)

      expect(manifest.version).toBe(1)
      expect(manifest.generatedAt).toBeDefined()
      expect(manifest.schemaHash).toBeDefined()
      expect(Object.keys(manifest.functions)).toHaveLength(3)
      expect(Object.keys(manifest.tables)).toHaveLength(2)
    })

    it("maps function keys as module.name", () => {
      const manifest = bridge.generateManifest(sampleFunctions, sampleTables)
      expect(manifest.functions["tasks.list"]).toBeDefined()
      expect(manifest.functions["tasks.complete"]).toBeDefined()
      expect(manifest.functions["users.getUser"]).toBeDefined()
    })

    it("includes source paths when enabled", () => {
      const manifest = bridge.generateManifest(sampleFunctions, sampleTables)
      expect(manifest.functions["tasks.list"].sourcePath).toBe("convex/tasks.ts")
      expect(manifest.functions["tasks.list"].sourceLine).toBe(5)
    })

    it("excludes source paths when disabled", () => {
      bridge = new TypeBridge({ includeSourcePaths: false })
      const manifest = bridge.generateManifest(sampleFunctions, sampleTables)
      expect(manifest.functions["tasks.list"].sourcePath).toBeUndefined()
    })

    it("generates table type names from table names", () => {
      const manifest = bridge.generateManifest([], sampleTables)
      expect(manifest.tables.tasks.typeName).toBe("Tasks")
      expect(manifest.tables.users.typeName).toBe("Users")
    })
  })

  describe("generateDeclarations", () => {
    it("generates valid TypeScript declarations", () => {
      const manifest = bridge.generateManifest(sampleFunctions, sampleTables)
      const dts = bridge.generateDeclarations(manifest)

      expect(dts).toContain("export interface Tasks")
      expect(dts).toContain("export interface Users")
      expect(dts).toContain("export declare const api")
      expect(dts).toContain("tasks:")
      expect(dts).toContain("users:")
      expect(dts).toContain("TypedFunctionReference")
    })

    it("includes column types in interfaces", () => {
      const manifest = bridge.generateManifest([], sampleTables)
      const dts = bridge.generateDeclarations(manifest)

      expect(dts).toContain("title: string")
      expect(dts).toContain("done: boolean")
    })
  })

  describe("createApiFromManifest", () => {
    it("creates nested API structure", () => {
      const manifest = bridge.generateManifest(sampleFunctions, sampleTables)
      const api = bridge.createApiFromManifest(manifest)

      expect(api.tasks).toBeDefined()
      expect(api.tasks.list).toBeDefined()
      expect(api.tasks.list._path).toBe("tasks.list")
      expect(api.tasks.list._kind).toBe("query")

      expect(api.tasks.complete).toBeDefined()
      expect(api.tasks.complete._kind).toBe("mutation")

      expect(api.users.getUser).toBeDefined()
      expect(api.users.getUser._kind).toBe("query")
    })
  })

  describe("validateManifest", () => {
    it("validates a correct manifest", () => {
      const manifest = bridge.generateManifest(sampleFunctions, sampleTables)
      const result = bridge.validateManifest(manifest, sampleTables)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.schemaChanged).toBe(false)
    })

    it("detects schema changes", () => {
      const manifest = bridge.generateManifest(sampleFunctions, sampleTables)
      const modifiedTables = [
        ...sampleTables,
        {
          name: "comments",
          columns: { id: { name: "id", pgType: "text", tsType: "string", nullable: false, hasDefault: true } },
        },
      ]
      const result = bridge.validateManifest(manifest, modifiedTables)

      expect(result.schemaChanged).toBe(true)
      expect(result.warnings.length).toBeGreaterThan(0)
    })

    it("rejects invalid manifest version", () => {
      const manifest = bridge.generateManifest(sampleFunctions, sampleTables)
      manifest.version = 99

      const result = bridge.validateManifest(manifest, sampleTables)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Unsupported manifest version: 99")
    })
  })

  describe("typeDescriptorToTS", () => {
    it("converts primitive types", () => {
      expect(bridge.typeDescriptorToTS({ kind: "primitive", type: "string" })).toBe("string")
      expect(bridge.typeDescriptorToTS({ kind: "primitive", type: "number" })).toBe("number")
      expect(bridge.typeDescriptorToTS({ kind: "primitive", type: "boolean" })).toBe("boolean")
    })

    it("converts void type", () => {
      expect(bridge.typeDescriptorToTS({ kind: "void" })).toBe("void")
    })

    it("converts array types", () => {
      const desc: TypeDescriptor = { kind: "array", element: { kind: "primitive", type: "string" } }
      expect(bridge.typeDescriptorToTS(desc)).toBe("string[]")
    })

    it("converts object types", () => {
      const desc: TypeDescriptor = {
        kind: "object",
        properties: {
          name: { type: { kind: "primitive", type: "string" }, optional: false },
          age: { type: { kind: "primitive", type: "number" }, optional: true },
        },
      }
      const result = bridge.typeDescriptorToTS(desc)
      expect(result).toContain("name: string")
      expect(result).toContain("age?: number")
    })

    it("converts union types", () => {
      const desc: TypeDescriptor = {
        kind: "union",
        members: [
          { kind: "primitive", type: "string" },
          { kind: "primitive", type: "null" },
        ],
      }
      expect(bridge.typeDescriptorToTS(desc)).toBe("string | null")
    })

    it("converts literal types", () => {
      expect(bridge.typeDescriptorToTS({ kind: "literal", value: "active" })).toBe('"active"')
      expect(bridge.typeDescriptorToTS({ kind: "literal", value: 42 })).toBe("42")
    })

    it("converts reference types", () => {
      expect(bridge.typeDescriptorToTS({ kind: "reference", table: "users", fullRow: true })).toBe("Users")
      expect(bridge.typeDescriptorToTS({ kind: "reference", table: "users", fullRow: false })).toBe("string")
    })
  })
})
