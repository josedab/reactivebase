import { describe, it, expect, beforeEach } from "vitest"
import {
  TypedCodegen,
  extractFunctionTypes,
  parseSchemaSource,
  generateTypedApiModule,
  generateTypedDbContext,
} from "../codegen/typed-codegen.js"

const SAMPLE_QUERY_SOURCE = `
import { query, mutation, action } from "@reactivebase/server"

export const listTasks = query(async (ctx, { userId }: { userId: string }) => {
  return ctx.db.tasks.where({ assigneeId: userId, done: false })
})

export const taskStats = query(async (ctx) => {
  const total = await ctx.db.tasks.count()
  return { total, completed: 0 }
})

export const completeTask = mutation(async (ctx, { taskId }: { taskId: string }) => {
  await ctx.db.tasks.update(taskId, { done: true })
  return { success: true }
})

export const sendEmail = action(async (ctx, { userId }: { userId: string }) => {
  const user = await ctx.db.users.get(userId)
  await ctx.auth.requireUser()
})
`

const SAMPLE_SCHEMA_SOURCE = `
import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  tasks: defineTable({
    title: v.string(),
    done: v.boolean({ default: false }),
    priority: v.enum("low", "medium", "high"),
    assigneeId: v.id("users"),
    tags: v.array(v.string()),
    dueDate: v.optional(v.timestamp()),
  })
    .index("by_assignee", ["assigneeId"])
    .index("by_priority", ["priority"]),
  users: defineTable({
    name: v.string(),
    email: v.string(),
  }).index("by_email", ["email"], { unique: true }),
})
`

describe("extractFunctionTypes", () => {
  it("extracts function types from source", () => {
    const { functions } = extractFunctionTypes(SAMPLE_QUERY_SOURCE)
    expect(functions.length).toBeGreaterThanOrEqual(3)
  })

  it("identifies function types correctly", () => {
    const { functions } = extractFunctionTypes(SAMPLE_QUERY_SOURCE)
    const listTasks = functions.find((f) => f.exportName === "listTasks")
    const completeTask = functions.find((f) => f.exportName === "completeTask")
    const sendEmail = functions.find((f) => f.exportName === "sendEmail")

    expect(listTasks?.type).toBe("query")
    expect(completeTask?.type).toBe("mutation")
    expect(sendEmail?.type).toBe("action")
  })

  it("extracts argument types", () => {
    const { functions } = extractFunctionTypes(SAMPLE_QUERY_SOURCE)
    const listTasks = functions.find((f) => f.exportName === "listTasks")
    expect(listTasks?.argsType).toContain("userId")
    expect(listTasks?.argsType).toContain("string")
  })

  it("detects auth usage", () => {
    const { functions } = extractFunctionTypes(SAMPLE_QUERY_SOURCE)
    const sendEmail = functions.find((f) => f.exportName === "sendEmail")
    expect(sendEmail?.usesAuth).toBe(true)

    const listTasks = functions.find((f) => f.exportName === "listTasks")
    expect(listTasks?.usesAuth).toBe(false)
  })

  it("extracts tables accessed", () => {
    const { functions } = extractFunctionTypes(SAMPLE_QUERY_SOURCE)
    const listTasks = functions.find((f) => f.exportName === "listTasks")
    expect(listTasks?.tablesAccessed).toContain("tasks")
  })

  it("provides line numbers", () => {
    const { functions } = extractFunctionTypes(SAMPLE_QUERY_SOURCE)
    for (const fn of functions) {
      expect(fn.line).toBeGreaterThan(0)
    }
  })
})

describe("parseSchemaSource", () => {
  it("parses tables from schema", () => {
    const schema = parseSchemaSource(SAMPLE_SCHEMA_SOURCE)
    expect(schema.tables).toHaveLength(2)
    expect(schema.tables.map((t) => t.name)).toContain("tasks")
    expect(schema.tables.map((t) => t.name)).toContain("users")
  })

  it("extracts field types", () => {
    const schema = parseSchemaSource(SAMPLE_SCHEMA_SOURCE)
    const tasks = schema.tables.find((t) => t.name === "tasks")!
    expect(tasks.fields.length).toBeGreaterThanOrEqual(3)

    const title = tasks.fields.find((f) => f.name === "title")
    expect(title?.tsType).toBe("string")

    const done = tasks.fields.find((f) => f.name === "done")
    expect(done?.tsType).toBe("boolean")
    expect(done?.hasDefault).toBe(true)
  })

  it("identifies foreign key references", () => {
    const schema = parseSchemaSource(SAMPLE_SCHEMA_SOURCE)
    const tasks = schema.tables.find((t) => t.name === "tasks")!
    const assigneeId = tasks.fields.find((f) => f.name === "assigneeId")
    expect(assigneeId?.isId).toBe(true)
    expect(assigneeId?.referencedTable).toBe("users")
  })

  it("parses enum types", () => {
    const schema = parseSchemaSource(SAMPLE_SCHEMA_SOURCE)
    const tasks = schema.tables.find((t) => t.name === "tasks")!
    const priority = tasks.fields.find((f) => f.name === "priority")
    expect(priority?.tsType).toContain('"low"')
    expect(priority?.tsType).toContain('"high"')
  })

  it("detects optional fields", () => {
    const schema = parseSchemaSource(SAMPLE_SCHEMA_SOURCE)
    const tasks = schema.tables.find((t) => t.name === "tasks")!
    const dueDate = tasks.fields.find((f) => f.name === "dueDate")
    expect(dueDate?.optional).toBe(true)
  })

  it("parses indexes", () => {
    const schema = parseSchemaSource(SAMPLE_SCHEMA_SOURCE)
    const users = schema.tables.find((t) => t.name === "users")!
    expect(users.indexes.length).toBeGreaterThanOrEqual(1)
    const emailIdx = users.indexes.find((i) => i.name === "by_email")
    expect(emailIdx?.unique).toBe(true)
  })
})

describe("generateTypedApiModule", () => {
  it("generates typed API module", () => {
    const functions = [
      {
        name: "tasks.listTasks",
        module: "tasks",
        type: "query" as const,
        exportName: "listTasks",
        argsType: "{ userId: string }",
        returnType: "Task[]",
        usesAuth: false,
        tablesAccessed: ["tasks"],
        filePath: "",
        line: 1,
      },
    ]
    const output = generateTypedApiModule(functions)
    expect(output).toContain("FunctionReference")
    expect(output).toContain("listTasks")
    expect(output).toContain("{ userId: string }")
    expect(output).toContain("Task[]")
    expect(output).toContain("api")
  })

  it("generates data model types from schema", () => {
    const schema = parseSchemaSource(SAMPLE_SCHEMA_SOURCE)
    const output = generateTypedApiModule([], schema)
    expect(output).toContain("interface Task")
    expect(output).toContain("interface User")
    expect(output).toContain("DataModel")
  })
})

describe("generateTypedDbContext", () => {
  it("generates typed database context", () => {
    const schema = parseSchemaSource(SAMPLE_SCHEMA_SOURCE)
    const output = generateTypedDbContext(schema)
    expect(output).toContain("TypedDatabaseContext")
    expect(output).toContain("TypedTableAccessor")
    expect(output).toContain("TypedQueryChain")
    expect(output).toContain("tasks:")
    expect(output).toContain("users:")
  })
})

describe("TypedCodegen", () => {
  let codegen: TypedCodegen

  beforeEach(() => {
    codegen = new TypedCodegen()
  })

  it("scans source and accumulates functions", () => {
    const fns = codegen.scanSource(SAMPLE_QUERY_SOURCE, "tasks", "tasks.ts")
    expect(fns.length).toBeGreaterThanOrEqual(3)
    expect(codegen.lastFunctions.length).toBeGreaterThanOrEqual(3)
  })

  it("sets module name on scanned functions", () => {
    const fns = codegen.scanSource(SAMPLE_QUERY_SOURCE, "tasks")
    expect(fns[0].module).toBe("tasks")
    expect(fns[0].name).toContain("tasks.")
  })

  it("parses schema", () => {
    const schema = codegen.parseSchema(SAMPLE_SCHEMA_SOURCE)
    expect(schema.tables).toHaveLength(2)
  })

  it("generates full API module", () => {
    codegen.scanSource(SAMPLE_QUERY_SOURCE, "tasks")
    codegen.parseSchema(SAMPLE_SCHEMA_SOURCE)
    const api = codegen.generateApi()
    expect(api).toContain("FunctionReference")
    expect(api).toContain("api")
    expect(api).toContain("DataModel")
  })

  it("generates db context", () => {
    codegen.parseSchema(SAMPLE_SCHEMA_SOURCE)
    const ctx = codegen.generateDbContext()
    expect(ctx).toContain("TypedDatabaseContext")
  })

  it("returns placeholder when no schema", () => {
    const ctx = codegen.generateDbContext()
    expect(ctx).toContain("No schema found")
  })

  it("resets state", () => {
    codegen.scanSource(SAMPLE_QUERY_SOURCE, "tasks")
    codegen.parseSchema(SAMPLE_SCHEMA_SOURCE)
    codegen.reset()
    expect(codegen.lastFunctions).toHaveLength(0)
  })

  it("supports watch callbacks", () => {
    const events: { type: string }[] = []
    codegen.onWatch((e) => events.push(e))
    codegen.emitWatchEvent({ type: "changed", path: "tasks.ts", timestamp: Date.now() })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("changed")
  })
})
