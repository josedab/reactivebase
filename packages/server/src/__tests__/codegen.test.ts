import { describe, it, expect } from "vitest"
import { scanFunctions, generateApiModule, generateServerModule, groupByModule } from "../codegen/codegen.js"
import { writeFile, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const testDir = join(tmpdir(), `rb-codegen-test-${Date.now()}`)

async function setupTestDir() {
  await mkdir(testDir, { recursive: true })

  await writeFile(
    join(testDir, "tasks.ts"),
    `
import { query, mutation, action } from "@reactivebase/server"

export const listTasks = query(async (ctx, args: { userId: string }) => {
  return ctx.db.tasks.where({ assigneeId: args.userId })
})

export const createTask = mutation(async (ctx, args: { title: string }) => {
  return ctx.db.tasks.insert({ title: args.title })
})

export const sendNotification = action(async (ctx, args: { taskId: string }) => {
  // send notification
})
`,
  )

  await writeFile(
    join(testDir, "users.ts"),
    `
import { query } from "@reactivebase/server"

export const getUser = query(async (ctx, args: { id: string }) => {
  return ctx.db.users.get(args.id)
})
`,
  )

  // schema.ts should be ignored
  await writeFile(
    join(testDir, "schema.ts"),
    `
import { defineSchema } from "@reactivebase/server"
export default defineSchema({})
`,
  )
}

describe("scanFunctions", () => {
  it("scans exported query/mutation/action functions", async () => {
    await setupTestDir()

    const functions = await scanFunctions(testDir)

    expect(functions).toHaveLength(4)
    expect(functions.find((f) => f.name === "tasks.listTasks")).toBeDefined()
    expect(functions.find((f) => f.name === "tasks.createTask")).toBeDefined()
    expect(functions.find((f) => f.name === "tasks.sendNotification")).toBeDefined()
    expect(functions.find((f) => f.name === "users.getUser")).toBeDefined()
  })

  it("correctly identifies function types", async () => {
    await setupTestDir()

    const functions = await scanFunctions(testDir)
    const listTasks = functions.find((f) => f.exportName === "listTasks")!
    const createTask = functions.find((f) => f.exportName === "createTask")!
    const sendNotification = functions.find((f) => f.exportName === "sendNotification")!

    expect(listTasks.type).toBe("query")
    expect(createTask.type).toBe("mutation")
    expect(sendNotification.type).toBe("action")
  })

  it("ignores schema.ts", async () => {
    await setupTestDir()

    const functions = await scanFunctions(testDir)
    const schemaFns = functions.filter((f) => f.module === "schema")
    expect(schemaFns).toHaveLength(0)
  })

  it("returns empty for non-existent directory", async () => {
    const functions = await scanFunctions("/nonexistent")
    expect(functions).toHaveLength(0)
  })
})

describe("generateApiModule", () => {
  it("generates typed api object", async () => {
    await setupTestDir()
    const functions = await scanFunctions(testDir)
    const code = generateApiModule(functions)

    expect(code).toContain("export const api = {")
    expect(code).toContain("tasks: {")
    expect(code).toContain("users: {")
    expect(code).toContain('listTasks: ref("tasks.listTasks", "query")')
    expect(code).toContain('createTask: ref("tasks.createTask", "mutation")')
    expect(code).toContain("FunctionReference")
    expect(code).toContain("Auto-generated")
  })
})

describe("generateServerModule", () => {
  it("generates import and registration code", async () => {
    await setupTestDir()
    const functions = await scanFunctions(testDir)
    const code = generateServerModule(functions, testDir, join(testDir, "_generated"))

    expect(code).toContain("import * as tasks from")
    expect(code).toContain("import * as users from")
    expect(code).toContain('"tasks.listTasks": tasks.listTasks')
    expect(code).toContain('"users.getUser": users.getUser')
  })
})

describe("groupByModule", () => {
  it("groups functions by module name", async () => {
    await setupTestDir()
    const functions = await scanFunctions(testDir)
    const groups = groupByModule(functions)

    expect(groups.size).toBe(2)
    expect(groups.get("tasks")!.length).toBe(3)
    expect(groups.get("users")!.length).toBe(1)
  })
})
