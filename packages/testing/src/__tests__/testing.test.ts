import { describe, it, expect, beforeEach } from "vitest"
import { MockDatabase } from "../mock-database.js"
import { TestServer } from "../test-server.js"

interface TestCtx {
  db: {
    tasks: {
      where: (filter: Record<string, unknown>) => Promise<unknown[]>
      insert: (data: Record<string, unknown>) => Promise<unknown>
      update: (id: string, data: Record<string, unknown>) => Promise<unknown>
    }
    [key: string]: unknown
  }
  auth: { userId: string | null; claims: Record<string, unknown> }
  [key: string]: unknown
}

describe("MockDatabase", () => {
  let db: MockDatabase

  beforeEach(() => {
    db = new MockDatabase()
  })

  it("inserts and retrieves rows", () => {
    db.seed("users", [
      { name: "Alice", email: "alice@test.com" },
      { name: "Bob", email: "bob@test.com" },
    ])

    const table = db.table("users")
    expect(table.all()).toHaveLength(2)
    expect(table.all()[0].name).toBe("Alice")
  })

  it("filters rows with where", () => {
    db.seed("tasks", [
      { title: "Task 1", done: false },
      { title: "Task 2", done: true },
      { title: "Task 3", done: false },
    ])

    const pending = db.table("tasks").where({ done: false })
    expect(pending).toHaveLength(2)
  })

  it("updates and deletes rows", () => {
    const [row] = db.seed("items", [{ name: "test" }])
    db.table("items").update(row.id, { name: "updated" })
    expect(db.table("items").get(row.id)!.name).toBe("updated")

    db.table("items").delete(row.id)
    expect(db.table("items").get(row.id)).toBeNull()
  })

  it("creates database context for functions", async () => {
    db.seed("tasks", [
      { title: "A", assigneeId: "u1", done: false },
      { title: "B", assigneeId: "u1", done: true },
      { title: "C", assigneeId: "u2", done: false },
    ])

    const ctx = db.createContext("readwrite")
    const tasks = ctx["tasks"] as {
      where: (filter: Record<string, unknown>) => Promise<unknown[]>
      insert: (data: Record<string, unknown>) => Promise<unknown>
    }

    const result = await tasks.where({ assigneeId: "u1" })
    expect(result).toHaveLength(2)

    await tasks.insert({ title: "D", assigneeId: "u1", done: false })
    expect(db.table("tasks").count()).toBe(4)
    expect(ctx.getModifiedTables()).toContain("tasks")
  })

  it("prevents writes in read-only mode", async () => {
    const ctx = db.createContext("read")
    const tasks = ctx["tasks"] as { insert: (data: Record<string, unknown>) => Promise<unknown> }

    await expect(tasks.insert({ title: "fail" })).rejects.toThrow("read-only")
  })

  it("tracks read and write logs", async () => {
    db.seed("tasks", [{ title: "A" }])
    const ctx = db.createContext("readwrite")
    const tasks = ctx["tasks"] as {
      where: (filter: Record<string, unknown>) => Promise<unknown[]>
      insert: (data: Record<string, unknown>) => Promise<unknown>
    }

    await tasks.where({ done: false })
    await tasks.insert({ title: "B" })

    expect(db.getReadLog()).toHaveLength(1)
    expect(db.getWriteLog()).toHaveLength(1)
    expect(db.getWriteLog()[0].operation).toBe("insert")
  })
})

describe("TestServer", () => {
  let server: TestServer

  const listTasks = {
    type: "query",
    handler: async (ctx: TestCtx, args: { userId: string }) => {
      return ctx.db.tasks.where({ assigneeId: args.userId, done: false })
    },
  }

  const createTask = {
    type: "mutation",
    handler: async (ctx: TestCtx, args: { title: string; userId: string }) => {
      return ctx.db.tasks.insert({
        title: args.title,
        assigneeId: args.userId,
        done: false,
      })
    },
  }

  const completeTask = {
    type: "mutation",
    handler: async (ctx: TestCtx, args: { taskId: string }) => {
      return ctx.db.tasks.update(args.taskId, { done: true })
    },
  }

  beforeEach(() => {
    server = new TestServer()
  })

  it("runs queries against mock database", async () => {
    server.db.seed("tasks", [
      { title: "Task 1", assigneeId: "u1", done: false },
      { title: "Task 2", assigneeId: "u1", done: true },
      { title: "Task 3", assigneeId: "u2", done: false },
    ])

    const result = await server.runQuery(listTasks, { userId: "u1" })
    expect(result.data).toHaveLength(1)
  })

  it("runs mutations and tracks modified tables", async () => {
    const result = await server.runMutation(createTask, {
      title: "New task",
      userId: "u1",
    })

    expect(result.data).toHaveProperty("id")
    expect(result.modifiedTables).toContain("tasks")
    expect(server.db.table("tasks").count()).toBe(1)
  })

  it("expectMutationToModify validates table modifications", async () => {
    await expect(
      server.expectMutationToModify(createTask, { title: "T", userId: "u1" }, ["tasks"]),
    ).resolves.not.toThrow()

    await expect(server.expectMutationToModify(createTask, { title: "T", userId: "u1" }, ["users"])).rejects.toThrow(
      "missing",
    )
  })

  it("snapshots reactive updates across mutations", async () => {
    server.db.seed("tasks", [{ title: "Existing", assigneeId: "u1", done: false }])

    const snapshots = await server.snapshotReactiveUpdates(listTasks, { userId: "u1" }, [
      { fn: createTask, args: { title: "New", userId: "u1" } },
      { fn: completeTask, args: { taskId: server.db.table("tasks").all()[0].id } },
    ])

    expect(snapshots).toHaveLength(3)
    expect(snapshots[0].data).toHaveLength(1) // initial
    expect(snapshots[1].data).toHaveLength(2) // after create
    expect(snapshots[2].data).toHaveLength(1) // after complete (filtered out done=true)
  })

  it("supports auth context switching", async () => {
    const authQuery = {
      type: "query",
      handler: async (ctx: TestCtx) => ({ userId: ctx.auth.userId }),
    }

    server.asUser("user-123", { role: "admin" })
    const result = await server.runQuery(authQuery)
    expect((result.data as { userId: string }).userId).toBe("user-123")

    server.asAnonymous()
    const result2 = await server.runQuery(authQuery)
    expect((result2.data as { userId: string | null }).userId).toBeNull()
  })

  it("supports registered functions by name", async () => {
    server.registerFunctions({
      "tasks.list": listTasks,
      "tasks.create": createTask,
    })

    await server.runMutation("tasks.create", { title: "Test", userId: "u1" })
    const result = await server.runQuery("tasks.list", { userId: "u1" })
    expect(result.data).toHaveLength(1)
  })
})
