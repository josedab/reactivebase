/**
 * Tests for Universal SDK — protocol builder, code generation for all targets,
 * type mapping, and edge cases.
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
  UniversalSdk,
  UniversalSdkError,
  ProtocolBuilder,
  type ProtocolSpec,
  type TargetLanguage,
} from "../universal-sdk/universal-sdk.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildTestProtocol(): ProtocolSpec {
  return new ProtocolBuilder()
    .addType({
      name: "Task",
      description: "A task item",
      fields: [
        { name: "id", type: { kind: "primitive", primitive: "string" }, optional: false },
        { name: "title", type: { kind: "primitive", primitive: "string" }, optional: false },
        { name: "done", type: { kind: "primitive", primitive: "boolean" }, optional: false },
        { name: "tags", type: { kind: "array", items: { kind: "primitive", primitive: "string" } }, optional: true },
        {
          name: "metadata",
          type: {
            kind: "map",
            keyType: { kind: "primitive", primitive: "string" },
            valueType: { kind: "primitive", primitive: "any" },
          },
          optional: true,
        },
      ],
    })
    .addType({
      name: "User",
      fields: [
        { name: "id", type: { kind: "primitive", primitive: "string" }, optional: false },
        { name: "name", type: { kind: "primitive", primitive: "string" }, optional: false },
        { name: "email", type: { kind: "primitive", primitive: "string" }, optional: true },
        { name: "createdAt", type: { kind: "primitive", primitive: "datetime" }, optional: false },
        { name: "avatar", type: { kind: "primitive", primitive: "binary" }, optional: true },
      ],
    })
    .addEnum({
      name: "TaskStatus",
      values: [
        { name: "Todo", value: "todo" },
        { name: "InProgress", value: "in_progress" },
        { name: "Done", value: "done" },
      ],
    })
    .addEndpoint({
      name: "listTasks",
      method: "query",
      path: "/api/tasks",
      output: { kind: "array", items: { kind: "object", name: "Task" } },
      auth: "required",
    })
    .addEndpoint({
      name: "createTask",
      method: "mutation",
      path: "/api/tasks",
      input: { kind: "object", name: "Task" },
      output: { kind: "object", name: "Task" },
      description: "Create a new task",
    })
    .addEndpoint({
      name: "getUser",
      method: "query",
      path: "/api/users/:id",
      output: { kind: "object", name: "User" },
      deprecated: true,
      deprecatedMessage: "Use getUserV2 instead",
    })
    .addError({ code: "NOT_FOUND", httpStatus: 404, description: "Resource not found" })
    .setAuth({ methods: ["bearer", "api-key"] })
    .build("2.0.0")
}

// ─── UniversalSdkError ───────────────────────────────────────────────────────

describe("UniversalSdkError", () => {
  it("creates error with code", () => {
    const err = new UniversalSdkError("test", "TEST")
    expect(err.name).toBe("UniversalSdkError")
    expect(err.code).toBe("TEST")
  })
})

// ─── ProtocolBuilder ─────────────────────────────────────────────────────────

describe("ProtocolBuilder", () => {
  it("builds protocol with all components", () => {
    const spec = buildTestProtocol()
    expect(spec.version).toBe("2.0.0")
    expect(spec.types).toHaveLength(2)
    expect(spec.enums).toHaveLength(1)
    expect(spec.endpoints).toHaveLength(3)
    expect(spec.errors).toHaveLength(1)
    expect(spec.auth.methods).toContain("bearer")
  })

  it("builds empty protocol", () => {
    const spec = new ProtocolBuilder().build()
    expect(spec.version).toBe("1.0.0")
    expect(spec.types).toHaveLength(0)
    expect(spec.endpoints).toHaveLength(0)
    expect(spec.enums).toHaveLength(0)
  })

  it("methods are chainable", () => {
    const builder = new ProtocolBuilder()
    const result = builder
      .addType({ name: "T", fields: [] })
      .addEnum({ name: "E", values: [] })
      .addEndpoint({ name: "e", method: "query", path: "/", output: { kind: "primitive", primitive: "null" } })
      .addError({ code: "ERR", httpStatus: 500, description: "err" })
      .setAuth({ methods: ["bearer"] })

    expect(result).toBe(builder)
  })
})

// ─── UniversalSdk ────────────────────────────────────────────────────────────

describe("UniversalSdk", () => {
  let sdk: UniversalSdk

  beforeEach(() => {
    sdk = new UniversalSdk()
    sdk.setProtocol(buildTestProtocol())
  })

  describe("setProtocol / getProtocol", () => {
    it("stores and retrieves protocol", () => {
      expect(sdk.getProtocol()).not.toBeNull()
      expect(sdk.getProtocol()!.version).toBe("2.0.0")
    })

    it("clears previous generated results on setProtocol", () => {
      sdk.generate({ target: "typescript" })
      expect(sdk.getGeneratedResult("typescript")).not.toBeNull()
      sdk.setProtocol(buildTestProtocol())
      expect(sdk.getGeneratedResult("typescript")).toBeNull()
    })
  })

  describe("generate - TypeScript", () => {
    it("generates TypeScript SDK files", () => {
      const result = sdk.generate({ target: "typescript" })
      expect(result.target).toBe("typescript")
      expect(result.files.length).toBeGreaterThanOrEqual(2)
      expect(result.files.some((f) => f.path.endsWith("types.ts"))).toBe(true)
      expect(result.files.some((f) => f.path.endsWith("client.ts"))).toBe(true)
    })

    it("generates correct TypeScript types", () => {
      const result = sdk.generate({ target: "typescript" })
      const typesFile = result.files.find((f) => f.path.endsWith("types.ts"))!
      expect(typesFile.content).toContain("export interface Task")
      expect(typesFile.content).toContain("export interface User")
      expect(typesFile.content).toContain("export enum TaskStatus")
      expect(typesFile.content).toContain("string[]") // tags: string[]
      expect(typesFile.content).toContain("Record<string, unknown>") // metadata map
    })

    it("generates TypeScript client methods", () => {
      const result = sdk.generate({ target: "typescript" })
      const clientFile = result.files.find((f) => f.path.endsWith("client.ts"))!
      expect(clientFile.content).toContain("listTasks")
      expect(clientFile.content).toContain("createTask")
      expect(clientFile.content).toContain("@deprecated")
    })

    it("uses custom package name", () => {
      const result = sdk.generate({ target: "typescript", packageName: "my-sdk" })
      expect(result.files.every((f) => f.path.startsWith("my-sdk/"))).toBe(true)
    })
  })

  describe("generate - Python", () => {
    it("generates Python SDK files", () => {
      const result = sdk.generate({ target: "python" })
      expect(result.target).toBe("python")
      expect(result.files.some((f) => f.path.endsWith(".py"))).toBe(true)
    })

    it("generates correct Python types", () => {
      const result = sdk.generate({ target: "python" })
      const file = result.files[0]
      expect(file.content).toContain("@dataclass")
      expect(file.content).toContain("class Task:")
      expect(file.content).toContain("class User:")
      expect(file.content).toContain("class TaskStatus(Enum)")
      expect(file.content).toContain("str")
      expect(file.content).toContain("bool")
      expect(file.content).toContain("list[str]")
    })

    it("generates Python client methods as snake_case", () => {
      const result = sdk.generate({ target: "python" })
      const file = result.files[0]
      expect(file.content).toContain("def list_tasks")
      expect(file.content).toContain("def create_task")
    })
  })

  describe("generate - Go", () => {
    it("generates Go SDK files", () => {
      const result = sdk.generate({ target: "go" })
      expect(result.target).toBe("go")
      expect(result.files.some((f) => f.path.endsWith(".go"))).toBe(true)
    })

    it("generates correct Go types", () => {
      const result = sdk.generate({ target: "go" })
      const file = result.files[0]
      expect(file.content).toContain("type Task struct")
      expect(file.content).toContain("type User struct")
      expect(file.content).toContain("package reactivebase")
      expect(file.content).toContain("string") // Go string type
      expect(file.content).toContain("json:") // struct tags
    })

    it("generates Go client methods as PascalCase", () => {
      const result = sdk.generate({ target: "go" })
      const file = result.files[0]
      expect(file.content).toContain("func (c *Client) ListTasks")
      expect(file.content).toContain("func (c *Client) CreateTask")
    })
  })

  describe("generate - Rust", () => {
    it("generates Rust SDK files", () => {
      const result = sdk.generate({ target: "rust" })
      expect(result.target).toBe("rust")
      expect(result.files.some((f) => f.path.endsWith(".rs"))).toBe(true)
    })

    it("generates correct Rust types", () => {
      const result = sdk.generate({ target: "rust" })
      const file = result.files[0]
      expect(file.content).toContain("pub struct Task")
      expect(file.content).toContain("pub struct User")
      expect(file.content).toContain("#[derive(Debug, Clone, Serialize, Deserialize)]")
      expect(file.content).toContain("pub enum TaskStatus")
      expect(file.content).toContain("String") // Rust string type
      expect(file.content).toContain("Vec<String>") // array
    })

    it("generates Rust client methods as snake_case", () => {
      const result = sdk.generate({ target: "rust" })
      const file = result.files[0]
      expect(file.content).toContain("pub async fn list_tasks")
      expect(file.content).toContain("pub async fn create_task")
    })
  })

  describe("generate - HTMX", () => {
    it("generates HTMX helper files", () => {
      const result = sdk.generate({ target: "htmx" })
      expect(result.target).toBe("htmx")
      expect(result.files.some((f) => f.path.endsWith(".html"))).toBe(true)
    })

    it("generates HTMX attribute helpers", () => {
      const result = sdk.generate({ target: "htmx" })
      const file = result.files[0]
      expect(file.content).toContain("window.ReactiveBase")
      expect(file.content).toContain("hx-")
      expect(file.content).toContain("/api/tasks")
    })
  })

  describe("generate - Angular", () => {
    it("generates Angular SDK (TypeScript variant)", () => {
      const result = sdk.generate({ target: "angular" })
      expect(result.target).toBe("angular")
      expect(result.files.some((f) => f.path.endsWith(".ts"))).toBe(true)
    })
  })

  describe("generateAll", () => {
    it("generates SDKs for all supported targets", () => {
      const results = sdk.generateAll()
      expect(results.size).toBe(5) // typescript, python, go, rust, htmx
      expect(results.has("typescript")).toBe(true)
      expect(results.has("python")).toBe(true)
      expect(results.has("go")).toBe(true)
      expect(results.has("rust")).toBe(true)
      expect(results.has("htmx")).toBe(true)
    })
  })

  describe("getGeneratedResult", () => {
    it("returns null before generation", () => {
      const freshSdk = new UniversalSdk()
      expect(freshSdk.getGeneratedResult("typescript")).toBeNull()
    })

    it("returns result after generation", () => {
      sdk.generate({ target: "typescript" })
      expect(sdk.getGeneratedResult("typescript")).not.toBeNull()
    })
  })

  describe("exportProtocolJson", () => {
    it("exports protocol as JSON string", () => {
      const json = sdk.exportProtocolJson()
      const parsed = JSON.parse(json)
      expect(parsed.version).toBe("2.0.0")
      expect(parsed.endpoints).toHaveLength(3)
    })

    it("throws without protocol", () => {
      const freshSdk = new UniversalSdk()
      expect(() => freshSdk.exportProtocolJson()).toThrow("No protocol spec set")
    })
  })

  describe("getSupportedTargets", () => {
    it("returns all supported languages", () => {
      const targets = sdk.getSupportedTargets()
      expect(targets).toContain("typescript")
      expect(targets).toContain("python")
      expect(targets).toContain("go")
      expect(targets).toContain("rust")
      expect(targets).toContain("angular")
      expect(targets).toContain("htmx")
    })
  })

  describe("error cases", () => {
    it("throws without protocol when generating", () => {
      const freshSdk = new UniversalSdk()
      expect(() => freshSdk.generate({ target: "typescript" })).toThrow("No protocol spec set")
    })

    it("throws for unsupported target", () => {
      expect(() => sdk.generate({ target: "cobol" as TargetLanguage })).toThrow("Unsupported target")
    })
  })

  describe("edge cases - complex nested types", () => {
    it("handles union types in TypeScript", () => {
      const unionSdk = new UniversalSdk()
      const spec = new ProtocolBuilder()
        .addType({
          name: "Result",
          fields: [
            {
              name: "value",
              type: {
                kind: "union",
                members: [
                  { kind: "primitive", primitive: "string" },
                  { kind: "primitive", primitive: "number" },
                  { kind: "primitive", primitive: "null" },
                ],
              },
              optional: false,
            },
          ],
        })
        .addEndpoint({
          name: "getResult",
          method: "query",
          path: "/result",
          output: { kind: "object", name: "Result" },
        })
        .build()

      unionSdk.setProtocol(spec)
      const result = unionSdk.generate({ target: "typescript" })
      const types = result.files.find((f) => f.path.endsWith("types.ts"))!
      expect(types.content).toContain("string | number | null")
    })

    it("handles empty schema", () => {
      const emptySdk = new UniversalSdk()
      const spec = new ProtocolBuilder().build()
      emptySdk.setProtocol(spec)

      const result = emptySdk.generate({ target: "typescript" })
      expect(result.files).toHaveLength(2)
    })

    it("handles enum types in output", () => {
      const result = sdk.generate({ target: "typescript" })
      const typesFile = result.files.find((f) => f.path.endsWith("types.ts"))!
      expect(typesFile.content).toContain('Todo = "todo"')
      expect(typesFile.content).toContain('InProgress = "in_progress"')
    })
  })
})
