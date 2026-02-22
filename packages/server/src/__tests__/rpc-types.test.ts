import { describe, it, expect } from "vitest"
import { RpcTypeGenerator, schemaToTypeScript, schemaToValidationCode } from "../codegen/rpc-types.js"
import type { RpcSchema, RpcFunctionDef } from "../codegen/rpc-types.js"

describe("schemaToTypeScript", () => {
  it("converts primitive types", () => {
    expect(schemaToTypeScript({ kind: "string" })).toBe("string")
    expect(schemaToTypeScript({ kind: "number" })).toBe("number")
    expect(schemaToTypeScript({ kind: "boolean" })).toBe("boolean")
    expect(schemaToTypeScript({ kind: "date" })).toBe("Date")
    expect(schemaToTypeScript({ kind: "id" })).toBe("string")
  })

  it("converts array types", () => {
    expect(schemaToTypeScript({ kind: "array", items: { kind: "string" } })).toBe("string[]")
    expect(schemaToTypeScript({ kind: "array", items: { kind: "number" } })).toBe("number[]")
  })

  it("converts enum types", () => {
    const schema: RpcSchema = { kind: "enum", values: ["low", "medium", "high"] }
    expect(schemaToTypeScript(schema)).toBe('"low" | "medium" | "high"')
  })

  it("converts object types", () => {
    const schema: RpcSchema = {
      kind: "object",
      properties: {
        title: { kind: "string", required: true },
        done: { kind: "boolean", required: true },
        notes: { kind: "string", required: false },
      },
    }
    const ts = schemaToTypeScript(schema)
    expect(ts).toContain("title: string")
    expect(ts).toContain("done: boolean")
    expect(ts).toContain("notes?: string")
  })

  it("converts optional types", () => {
    const schema: RpcSchema = { kind: "optional", inner: { kind: "string" } }
    expect(schemaToTypeScript(schema)).toBe("string | undefined")
  })

  it("converts union types", () => {
    const schema: RpcSchema = {
      kind: "union",
      members: [{ kind: "string" }, { kind: "number" }],
    }
    expect(schemaToTypeScript(schema)).toBe("string | number")
  })
})

describe("schemaToValidationCode", () => {
  it("generates string validation", () => {
    const code = schemaToValidationCode({ kind: "string", minLength: 1, maxLength: 100 })
    expect(code).toContain('typeof value !== "string"')
    expect(code).toContain("length < 1")
    expect(code).toContain("length > 100")
  })

  it("generates number validation with range", () => {
    const code = schemaToValidationCode({ kind: "number", min: 0, max: 999 })
    expect(code).toContain('typeof value !== "number"')
    expect(code).toContain("value < 0")
    expect(code).toContain("value > 999")
  })

  it("generates enum validation", () => {
    const code = schemaToValidationCode({ kind: "enum", values: ["a", "b", "c"] })
    expect(code).toContain('"a"')
    expect(code).toContain("Invalid enum value")
  })
})

describe("RpcTypeGenerator", () => {
  function createTestDefs(): RpcFunctionDef[] {
    return [
      {
        name: "tasks.list",
        module: "tasks",
        exportName: "list",
        type: "query",
        argsSchema: { kind: "object", properties: { userId: { kind: "string", required: true } } },
        returnSchema: { kind: "array", items: { kind: "object", properties: { id: { kind: "id" }, title: { kind: "string" } } } },
        requiresAuth: true,
      },
      {
        name: "tasks.create",
        module: "tasks",
        exportName: "create",
        type: "mutation",
        argsSchema: {
          kind: "object",
          properties: {
            title: { kind: "string", required: true, minLength: 1 },
            priority: { kind: "enum", values: ["low", "medium", "high"] },
          },
        },
        returnSchema: { kind: "object", properties: { id: { kind: "id" } } },
        requiresAuth: true,
      },
      {
        name: "users.getProfile",
        module: "users",
        exportName: "getProfile",
        type: "query",
        argsSchema: null,
        returnSchema: { kind: "object", properties: { name: { kind: "string" }, email: { kind: "string" } } },
        requiresAuth: false,
      },
    ]
  }

  it("generates a complete API module", () => {
    const gen = new RpcTypeGenerator()
    for (const def of createTestDefs()) gen.addFunction(def)

    const output = gen.generate()
    expect(output.functionCount).toBe(3)
    expect(output.apiModule).toContain("FunctionReference")
    expect(output.apiModule).toContain("tasks_list_Args")
    expect(output.apiModule).toContain("tasks_create_Args")
    expect(output.apiModule).toContain("api =")
    expect(output.apiModule).toContain("tasks:")
    expect(output.apiModule).toContain("users:")
  })

  it("generates validation module", () => {
    const gen = new RpcTypeGenerator()
    for (const def of createTestDefs()) gen.addFunction(def)

    const output = gen.generate()
    expect(output.validationModule).toContain("ValidationError")
    expect(output.validationModule).toContain("validate_tasks_list")
    expect(output.validationModule).toContain("validate_tasks_create")
    expect(output.validationModule).toContain("validators")
  })

  it("generates client types", () => {
    const gen = new RpcTypeGenerator()
    for (const def of createTestDefs()) gen.addFunction(def)

    const output = gen.generate()
    expect(output.clientTypes).toContain("ReactiveBaseClient")
    expect(output.clientTypes).toContain("query")
    expect(output.clientTypes).toContain("mutation")
    expect(output.clientTypes).toContain("subscribe")
  })

  it("generates Python SDK stub", () => {
    const gen = new RpcTypeGenerator()
    for (const def of createTestDefs()) gen.addFunction(def)

    const sdk = gen.generateSdkStub({ language: "python", packageName: "rb_client", serverUrl: "http://localhost:4000" })
    expect(sdk).toContain("ReactiveBaseClient")
    expect(sdk).toContain("httpx")
    expect(sdk).toContain("tasks_list")
  })

  it("generates Go SDK stub", () => {
    const gen = new RpcTypeGenerator()
    const sdk = gen.generateSdkStub({ language: "go", packageName: "rbclient", serverUrl: "http://localhost:4000" })
    expect(sdk).toContain("package rbclient")
    expect(sdk).toContain("NewClient")
  })

  it("tracks file hashes for incremental generation", () => {
    const gen = new RpcTypeGenerator()
    expect(gen.hasFileChanged("tasks.ts", "abc123")).toBe(true)

    gen.updateFileHash("tasks.ts", "abc123")
    expect(gen.hasFileChanged("tasks.ts", "abc123")).toBe(false)
    expect(gen.hasFileChanged("tasks.ts", "def456")).toBe(true)
  })

  it("removes functions", () => {
    const gen = new RpcTypeGenerator()
    gen.addFunction(createTestDefs()[0])
    expect(gen.getFunctions()).toHaveLength(1)

    gen.removeFunction("tasks.list")
    expect(gen.getFunctions()).toHaveLength(0)
  })
})
