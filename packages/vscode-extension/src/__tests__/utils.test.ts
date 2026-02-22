import { describe, it, expect } from "vitest"
import { scanFunctionSource, validateSchemaSource, generateApiModule } from "../utils.js"

describe("scanFunctionSource", () => {
  it("scans query functions", () => {
    const source = `
import { query } from "@reactivebase/server"

export const listTasks = query(async (ctx, { userId }: { userId: string }) => {
  return ctx.db.tasks.where({ assigneeId: userId })
})
`
    const result = scanFunctionSource(source, "tasks")
    expect(result.functions).toHaveLength(1)
    expect(result.functions[0].name).toBe("tasks.listTasks")
    expect(result.functions[0].type).toBe("query")
    expect(result.functions[0].argsType).toBe("{ userId: string }")
  })

  it("scans mutation functions", () => {
    const source = `
export const createTask = mutation(async (ctx, args: { title: string }) => {
  return ctx.db.tasks.insert(args)
})
`
    const result = scanFunctionSource(source, "tasks")
    expect(result.functions).toHaveLength(1)
    expect(result.functions[0].type).toBe("mutation")
  })

  it("scans action functions without args", () => {
    const source = `
export const sendEmails = action(async (ctx) => {
  await emailService.sendAll()
})
`
    const result = scanFunctionSource(source, "notifications")
    expect(result.functions).toHaveLength(1)
    expect(result.functions[0].type).toBe("action")
    expect(result.functions[0].argsType).toBe("void")
  })

  it("scans multiple functions from one file", () => {
    const source = `
export const list = query(async (ctx) => {
  return ctx.db.tasks.where({})
})

export const create = mutation(async (ctx, args: { title: string }) => {
  return ctx.db.tasks.insert(args)
})

export const sendNotification = action(async (ctx, args: { userId: string }) => {
  await notify(args.userId)
})
`
    const result = scanFunctionSource(source, "tasks")
    expect(result.functions).toHaveLength(3)
    expect(result.functions.map((f) => f.type)).toEqual(["query", "mutation", "action"])
  })

  it("detects auth usage", () => {
    const source = `
export const getProfile = query(async (ctx) => {
  const user = ctx.auth.getUserIdentity()
  return user
})
`
    const result = scanFunctionSource(source, "users")
    expect(result.functions[0].hasAuth).toBe(true)
  })

  it("detects no auth usage", () => {
    const source = `
export const listPublic = query(async (ctx) => {
  return ctx.db.posts.where({ isPublic: true })
})
`
    const result = scanFunctionSource(source, "posts")
    expect(result.functions[0].hasAuth).toBe(false)
  })

  it("reports duplicate export errors", () => {
    const source = `
export const list = query(async (ctx) => { return [] })
export const list = query(async (ctx) => { return [] })
`
    const result = scanFunctionSource(source, "tasks")
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].message).toContain("Duplicate export")
  })

  it("returns empty for files with no functions", () => {
    const source = `
const helper = (x: number) => x * 2
export type TaskArgs = { title: string }
`
    const result = scanFunctionSource(source, "helpers")
    expect(result.functions).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })
})

describe("validateSchemaSource", () => {
  it("validates a correct schema", () => {
    const source = `
import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
  }),
  tasks: defineTable({
    title: v.string(),
  }),
})
`
    const errors = validateSchemaSource(source)
    expect(errors).toHaveLength(0)
  })

  it("detects missing defineSchema", () => {
    const source = `export const schema = { tables: {} }`
    const errors = validateSchemaSource(source)
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain("Missing defineSchema")
  })

  it("detects duplicate table names", () => {
    const source = `
export default defineSchema({
  users: defineTable({ name: v.string() }),
  tasks: defineTable({ title: v.string() }),
  users: defineTable({ email: v.string() }),
})
`
    const errors = validateSchemaSource(source)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].message).toContain("Duplicate table name")
    expect(errors[0].message).toContain("users")
  })
})

describe("generateApiModule", () => {
  it("generates a typed api module", () => {
    const functions = [
      { name: "tasks.list", type: "query" as const, line: 1, argsType: "void", hasAuth: false },
      { name: "tasks.create", type: "mutation" as const, line: 5, argsType: "{ title: string }", hasAuth: true },
      { name: "users.getProfile", type: "query" as const, line: 1, argsType: "void", hasAuth: true },
    ]

    const output = generateApiModule(functions)

    expect(output).toContain("FunctionReference")
    expect(output).toContain("export const api = {")
    expect(output).toContain("tasks:")
    expect(output).toContain("users:")
    expect(output).toContain('list: ref<void, unknown>("tasks.list", "query")')
    expect(output).toContain('create: ref<{ title: string }, unknown>("tasks.create", "mutation")')
  })

  it("groups functions by module", () => {
    const functions = [
      { name: "a.fn1", type: "query" as const, line: 1, argsType: "void", hasAuth: false },
      { name: "b.fn2", type: "mutation" as const, line: 1, argsType: "void", hasAuth: false },
      { name: "a.fn3", type: "action" as const, line: 1, argsType: "void", hasAuth: false },
    ]

    const output = generateApiModule(functions)
    // "a" module should contain fn1 and fn3
    const aMatch = output.match(/a:\s*\{[\s\S]*?\}/)
    expect(aMatch).toBeTruthy()
    expect(aMatch![0]).toContain("fn1")
    expect(aMatch![0]).toContain("fn3")
  })

  it("handles empty function list", () => {
    const output = generateApiModule([])
    expect(output).toContain("export const api = {")
    expect(output).toContain("} as const")
  })
})
