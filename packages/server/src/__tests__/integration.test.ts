/**
 * Integration tests for the full ReactiveBase pipeline.
 * Exercises: server creation, function registration, query/mutation execution,
 * dependency tracking, reactive snapshots, auth context, middleware, validation,
 * error handling, and query composition — all against the in-memory TestServer.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { defineSchema, defineTable, v } from "../schema/index.js"
import { query, mutation, action } from "../functions/server-functions.js"
import { createAuthContext, AuthenticationError } from "../auth/auth.js"
import { MiddlewareManager, createMiddlewareState, type MiddlewareContext } from "../middleware/middleware.js"
import { validateArgs, ValidationError, s } from "../validation/args-validation.js"
import { MockDatabase } from "../../../testing/src/mock-database.js"
import { TestServer, createTestServer, type FunctionDefinition } from "../../../testing/src/test-server.js"

// ─── Test schema ─────────────────────────────────────────────────────────────

const schema = defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    role: v.string(),
  }),
  tasks: defineTable({
    title: v.string(),
    assigneeId: v.string(),
    done: v.boolean(),
    priority: v.number(),
  }),
  comments: defineTable({
    taskId: v.string(),
    authorId: v.string(),
    body: v.string(),
  }),
})

// ─── Handler helpers (plain functions matching TestServer context shape) ──────

type Ctx = Record<string, unknown>
type Db = Record<string, {
  where: (f: Record<string, unknown>) => unknown
  get: (id: string) => Promise<unknown>
  getOrThrow: (id: string) => Promise<unknown>
  insert: (d: Record<string, unknown>) => Promise<unknown>
  update: (id: string, d: Record<string, unknown>) => Promise<unknown>
  delete: (id: string) => Promise<void>
  count: () => Promise<number>
}>
type Auth = { userId: string | null; claims: Record<string, unknown>; requireUser: () => string }

function db(ctx: Ctx): Db { return ctx.db as Db }
function auth(ctx: Ctx): Auth { return ctx.auth as Auth }

// ─── Function definitions ────────────────────────────────────────────────────

const functions: Record<string, FunctionDefinition> = {
  // Queries
  "tasks.list": {
    type: "query",
    handler: ((ctx: Ctx) => db(ctx).tasks.where({})) as never,
  },
  "tasks.listByUser": {
    type: "query",
    handler: ((ctx: Ctx, args: Record<string, unknown>) =>
      db(ctx).tasks.where({ assigneeId: args.userId })) as never,
  },
  "tasks.pending": {
    type: "query",
    handler: ((ctx: Ctx) => db(ctx).tasks.where({ done: false })) as never,
  },
  "tasks.get": {
    type: "query",
    handler: (async (ctx: Ctx, args: Record<string, unknown>) =>
      db(ctx).tasks.getOrThrow(args.id as string)) as never,
  },
  "tasks.count": {
    type: "query",
    handler: (async (ctx: Ctx) => db(ctx).tasks.count()) as never,
  },
  "users.list": {
    type: "query",
    handler: ((ctx: Ctx) => db(ctx).users.where({})) as never,
  },
  "auth.whoami": {
    type: "query",
    handler: ((ctx: Ctx) => ({
      userId: auth(ctx).userId,
      claims: auth(ctx).claims,
    })) as never,
  },
  "auth.requireUser": {
    type: "query",
    handler: ((ctx: Ctx) => {
      const uid = auth(ctx).requireUser()
      return { userId: uid }
    }) as never,
  },

  // Mutations
  "tasks.create": {
    type: "mutation",
    handler: (async (ctx: Ctx, args: Record<string, unknown>) =>
      db(ctx).tasks.insert({
        title: args.title,
        assigneeId: args.assigneeId ?? "unassigned",
        done: false,
        priority: args.priority ?? 0,
      })) as never,
  },
  "tasks.complete": {
    type: "mutation",
    handler: (async (ctx: Ctx, args: Record<string, unknown>) =>
      db(ctx).tasks.update(args.id as string, { done: true })) as never,
  },
  "tasks.delete": {
    type: "mutation",
    handler: (async (ctx: Ctx, args: Record<string, unknown>) => {
      await db(ctx).tasks.delete(args.id as string)
      return { deleted: true }
    }) as never,
  },
  "tasks.updatePriority": {
    type: "mutation",
    handler: (async (ctx: Ctx, args: Record<string, unknown>) =>
      db(ctx).tasks.update(args.id as string, { priority: args.priority })) as never,
  },
  "users.create": {
    type: "mutation",
    handler: (async (ctx: Ctx, args: Record<string, unknown>) =>
      db(ctx).users.insert({
        name: args.name,
        email: args.email,
        role: args.role ?? "member",
      })) as never,
  },
  "comments.create": {
    type: "mutation",
    handler: (async (ctx: Ctx, args: Record<string, unknown>) =>
      db(ctx).comments.insert({
        taskId: args.taskId,
        authorId: args.authorId,
        body: args.body,
      })) as never,
  },

  // Actions
  "tasks.cleanup": {
    type: "action",
    handler: (async (ctx: Ctx) => {
      const done = await db(ctx).tasks.where({ done: true }) as Array<{ id: string }>
      for (const task of done) {
        await db(ctx).tasks.delete(task.id)
      }
      return { removed: done.length }
    }) as never,
  },
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Integration: ReactiveBase pipeline", () => {
  let server: TestServer

  beforeEach(() => {
    server = createTestServer({ schema })
    server.registerFunctions(functions)
  })

  // ── 1. Server creation & function registration ───────────────────────────

  describe("server creation and function registration", () => {
    it("creates a TestServer with schema", () => {
      expect(server).toBeInstanceOf(TestServer)
      expect(server.db).toBeInstanceOf(MockDatabase)
    })

    it("registers functions by name", async () => {
      await server.runMutation("tasks.create", { title: "Test" })
      const result = await server.runQuery("tasks.list")
      expect(result.data).toHaveLength(1)
    })

    it("throws for unregistered function names", async () => {
      await expect(server.runQuery("nonexistent.fn")).rejects.toThrow("Function not found")
    })

    it("supports function ref objects alongside name strings", async () => {
      const inlineQuery = {
        type: "query",
        handler: ((ctx: Ctx) => db(ctx).tasks.where({})) as never,
      }
      server.db.seed("tasks", [{ id: "t1", title: "A", assigneeId: "u1", done: false, priority: 1 }])
      const result = await server.runQuery(inlineQuery)
      expect(result.data).toHaveLength(1)
    })
  })

  // ── 2. Query execution with dependency tracking ──────────────────────────

  describe("query execution with dependency tracking", () => {
    beforeEach(() => {
      server.db.seed("tasks", [
        { id: "t1", title: "Task 1", assigneeId: "u1", done: false, priority: 1 },
        { id: "t2", title: "Task 2", assigneeId: "u1", done: true, priority: 2 },
        { id: "t3", title: "Task 3", assigneeId: "u2", done: false, priority: 3 },
      ])
    })

    it("returns query data correctly", async () => {
      const result = await server.runQuery("tasks.list")
      expect(result.data).toHaveLength(3)
    })

    it("filters by arguments", async () => {
      const result = await server.runQuery("tasks.listByUser", { userId: "u1" })
      expect(result.data).toHaveLength(2)
    })

    it("tracks table dependencies", async () => {
      const result = await server.runQuery("tasks.pending")
      expect(result.dependencies).toBeDefined()
      expect(result.dependencies.length).toBeGreaterThan(0)
      expect(result.dependencies[0].table).toBe("tasks")
    })

    it("tracks filter-level dependencies", async () => {
      const result = await server.runQuery("tasks.listByUser", { userId: "u1" })
      expect(result.dependencies.some(d => d.table === "tasks")).toBe(true)
    })

    it("queries with getOrThrow return a single row", async () => {
      const result = await server.runQuery("tasks.get", { id: "t1" })
      expect((result.data as { title: string }).title).toBe("Task 1")
    })

    it("queries with count return a number", async () => {
      const result = await server.runQuery("tasks.count")
      expect(result.data).toBe(3)
    })
  })

  // ── 3. Mutation execution with modified table tracking ───────────────────

  describe("mutation execution with modified table tracking", () => {
    it("inserts a row and reports modified tables", async () => {
      const result = await server.runMutation("tasks.create", { title: "New Task", assigneeId: "u1" })
      expect(result.data).toHaveProperty("id")
      expect(result.modifiedTables).toContain("tasks")
    })

    it("updates a row and reports modified tables", async () => {
      server.db.seed("tasks", [{ id: "t1", title: "T", assigneeId: "u1", done: false, priority: 0 }])
      const result = await server.runMutation("tasks.complete", { id: "t1" })
      expect((result.data as { done: boolean }).done).toBe(true)
      expect(result.modifiedTables).toContain("tasks")
    })

    it("deletes a row and reports modified tables", async () => {
      server.db.seed("tasks", [{ id: "t1", title: "T", assigneeId: "u1", done: false, priority: 0 }])
      const result = await server.runMutation("tasks.delete", { id: "t1" })
      expect((result.data as { deleted: boolean }).deleted).toBe(true)
      expect(result.modifiedTables).toContain("tasks")
    })

    it("mutations across different tables track each table", async () => {
      const res1 = await server.runMutation("tasks.create", { title: "T" })
      const res2 = await server.runMutation("users.create", { name: "Alice", email: "a@b.com" })
      expect(res1.modifiedTables).toContain("tasks")
      expect(res2.modifiedTables).toContain("users")
    })

    it("expectMutationToModify passes for correct tables", async () => {
      await expect(
        server.expectMutationToModify("tasks.create", { title: "T" }, ["tasks"]),
      ).resolves.not.toThrow()
    })

    it("expectMutationToModify fails for wrong tables", async () => {
      await expect(
        server.expectMutationToModify("tasks.create", { title: "T" }, ["users"]),
      ).rejects.toThrow("missing")
    })
  })

  // ── 4. Reactive update snapshots ─────────────────────────────────────────

  describe("reactive update snapshots (subscribe → mutate → see change)", () => {
    beforeEach(() => {
      server.db.seed("tasks", [
        { id: "t1", title: "Existing", assigneeId: "u1", done: false, priority: 1 },
      ])
    })

    it("captures initial snapshot then changes after mutations", async () => {
      const snapshots = await server.snapshotReactiveUpdates(
        "tasks.list",
        {},
        [
          { fn: "tasks.create", args: { title: "Second", assigneeId: "u1" } },
          { fn: "tasks.create", args: { title: "Third", assigneeId: "u1" } },
        ],
      )

      expect(snapshots).toHaveLength(3)
      expect(snapshots[0].label).toBe("initial")
      expect(snapshots[0].step).toBe(0)
      expect((snapshots[0].data as unknown[]).length).toBe(1)
      expect((snapshots[1].data as unknown[]).length).toBe(2)
      expect((snapshots[2].data as unknown[]).length).toBe(3)
    })

    it("reflects deletion in subsequent snapshots", async () => {
      const snapshots = await server.snapshotReactiveUpdates(
        "tasks.list",
        {},
        [{ fn: "tasks.delete", args: { id: "t1" } }],
      )

      expect(snapshots).toHaveLength(2)
      expect((snapshots[0].data as unknown[]).length).toBe(1)
      expect((snapshots[1].data as unknown[]).length).toBe(0)
    })

    it("reflects updates (e.g., completing a task) in filtered queries", async () => {
      const snapshots = await server.snapshotReactiveUpdates(
        "tasks.pending",
        {},
        [{ fn: "tasks.complete", args: { id: "t1" } }],
      )

      expect((snapshots[0].data as unknown[]).length).toBe(1)
      expect((snapshots[1].data as unknown[]).length).toBe(0)
    })

    it("snapshot steps are labeled sequentially", async () => {
      const snapshots = await server.snapshotReactiveUpdates(
        "tasks.list",
        {},
        [
          { fn: "tasks.create", args: { title: "A" } },
          { fn: "tasks.create", args: { title: "B" } },
        ],
      )

      expect(snapshots[0].step).toBe(0)
      expect(snapshots[1].step).toBe(1)
      expect(snapshots[1].label).toBe("after mutation 0")
      expect(snapshots[2].step).toBe(2)
      expect(snapshots[2].label).toBe("after mutation 1")
    })
  })

  // ── 5. Auth context ──────────────────────────────────────────────────────

  describe("auth context (authenticated vs anonymous)", () => {
    it("defaults to anonymous", async () => {
      const result = await server.runQuery("auth.whoami")
      const data = result.data as { userId: string | null }
      expect(data.userId).toBeNull()
    })

    it("asUser sets userId and claims", async () => {
      server.asUser("user-42", { role: "admin", org: "acme" })
      const result = await server.runQuery("auth.whoami")
      const data = result.data as { userId: string; claims: Record<string, unknown> }
      expect(data.userId).toBe("user-42")
      expect(data.claims.role).toBe("admin")
      expect(data.claims.org).toBe("acme")
    })

    it("asAnonymous resets to unauthenticated", async () => {
      server.asUser("user-1")
      server.asAnonymous()
      const result = await server.runQuery("auth.whoami")
      expect((result.data as { userId: string | null }).userId).toBeNull()
    })

    it("requireUser throws when anonymous", async () => {
      server.asAnonymous()
      await expect(server.runQuery("auth.requireUser")).rejects.toThrow("Authentication required")
    })

    it("requireUser succeeds when authenticated", async () => {
      server.asUser("user-1")
      const result = await server.runQuery("auth.requireUser")
      expect((result.data as { userId: string }).userId).toBe("user-1")
    })

    it("auth context persists across multiple calls", async () => {
      server.asUser("persistent-user")
      const r1 = await server.runQuery("auth.whoami")
      const r2 = await server.runQuery("auth.whoami")
      expect((r1.data as { userId: string }).userId).toBe("persistent-user")
      expect((r2.data as { userId: string }).userId).toBe("persistent-user")
    })
  })

  // ── 6. Middleware pipeline execution ──────────────────────────────────────

  describe("middleware pipeline execution", () => {
    function createTestMwContext(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
      return {
        functionName: "testFn",
        functionType: "query",
        args: {},
        auth: createAuthContext(null),
        state: createMiddlewareState(),
        ...overrides,
      }
    }

    it("before hook modifies args", async () => {
      const mgr = new MiddlewareManager()
      mgr.use({
        name: "inject-timestamp",
        before: (ctx) => ({ args: { ...(ctx.args as object), timestamp: 12345 } }),
      })

      const result = await mgr.runBefore(createTestMwContext({ args: { foo: "bar" } }))
      expect(result.args).toEqual({ foo: "bar", timestamp: 12345 })
    })

    it("before hook short-circuits with cached result", async () => {
      const mgr = new MiddlewareManager()
      mgr.use({
        name: "cache",
        before: () => ({ result: { cached: true } }),
      })

      const result = await mgr.runBefore(createTestMwContext())
      expect(result.shortCircuit).toEqual({ cached: true })
    })

    it("after hook transforms result", async () => {
      const mgr = new MiddlewareManager()
      mgr.use({
        name: "add-meta",
        after: (_ctx, result) => ({
          ...(result as object),
          _meta: { source: "cache" },
        }),
      })

      const result = await mgr.runAfter(createTestMwContext(), { items: [] })
      expect(result).toEqual({ items: [], _meta: { source: "cache" } })
    })

    it("middleware priority ordering is respected", async () => {
      const mgr = new MiddlewareManager()
      const order: string[] = []

      mgr.use({ name: "low", priority: 200, before: () => { order.push("low") } })
      mgr.use({ name: "high", priority: 10, before: () => { order.push("high") } })
      mgr.use({ name: "default", before: () => { order.push("default") } })

      await mgr.runBefore(createTestMwContext())
      expect(order).toEqual(["high", "default", "low"])
    })

    it("onError hooks receive the error", async () => {
      const mgr = new MiddlewareManager()
      const captured: string[] = []

      mgr.use({
        name: "error-logger",
        onError: (_ctx, err) => { captured.push(err.message) },
      })

      await mgr.runOnError(createTestMwContext(), new Error("boom"))
      expect(captured).toEqual(["boom"])
    })

    it("middleware state is propagated immutably", async () => {
      const mgr = new MiddlewareManager()
      mgr.use({
        name: "set-tenant",
        before: () => ({ state: { tenantId: "t1" } }),
      })
      mgr.use({
        name: "read-tenant",
        before: (ctx) => {
          expect((ctx.state as { tenantId?: string }).tenantId).toBe("t1")
        },
      })

      const result = await mgr.runBefore(createTestMwContext())
      expect((result.state as { tenantId?: string }).tenantId).toBe("t1")
    })
  })

  // ── 7. Error handling ────────────────────────────────────────────────────

  describe("error handling", () => {
    it("throws for missing function", async () => {
      await expect(server.runQuery("doesnt.exist")).rejects.toThrow("Function not found")
    })

    it("throws for getOrThrow on missing row", async () => {
      await expect(server.runQuery("tasks.get", { id: "nonexistent" })).rejects.toThrow("Not found")
    })

    it("throws for delete on missing row", async () => {
      await expect(server.runMutation("tasks.delete", { id: "ghost" })).rejects.toThrow("Not found")
    })

    it("throws for update on missing row", async () => {
      await expect(
        server.runMutation("tasks.complete", { id: "ghost" }),
      ).rejects.toThrow("Row not found")
    })

    it("validates required string fields", () => {
      const validationSchema = { title: s.string() }
      expect(() => validateArgs({}, validationSchema)).toThrow(ValidationError)
      expect(() => validateArgs({ title: "ok" }, validationSchema)).not.toThrow()
    })

    it("validates number fields with min/max", () => {
      const validationSchema = { age: s.number().min(0).max(150) }
      expect(() => validateArgs({ age: -1 }, validationSchema)).toThrow()
      expect(() => validateArgs({ age: 25 }, validationSchema)).not.toThrow()
      expect(() => validateArgs({ age: 200 }, validationSchema)).toThrow()
    })

    it("validates string email format", () => {
      const validationSchema = { email: s.string().email() }
      expect(() => validateArgs({ email: "bad" }, validationSchema)).toThrow()
      expect(() => validateArgs({ email: "a@b.com" }, validationSchema)).not.toThrow()
    })

    it("validates optional fields (skips when missing)", () => {
      const validationSchema = { nickname: s.string().optional() }
      expect(() => validateArgs({}, validationSchema)).not.toThrow()
      expect(() => validateArgs({ nickname: "ok" }, validationSchema)).not.toThrow()
    })

    it("validation rejects non-object args", () => {
      expect(() => validateArgs(null, { x: s.string() })).toThrow("Args must be an object")
      expect(() => validateArgs("string", { x: s.string() })).toThrow("Args must be an object")
    })

    it("ValidationError contains field-level details", () => {
      try {
        validateArgs({}, { name: s.string(), age: s.number() })
        expect.unreachable("Should have thrown")
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError)
        const ve = err as ValidationError
        expect(ve.errors).toHaveLength(2)
        expect(ve.errors.map(e => e.field).sort()).toEqual(["age", "name"])
      }
    })
  })

  // ── 8. Query composition (calling queries from within queries) ───────────

  describe("query composition", () => {
    it("runs a query that composes another query internally", async () => {
      // Simulate composition by having one handler call logic from another
      const composedFunctions: Record<string, FunctionDefinition> = {
        "stats.taskCountForUser": {
          type: "query",
          handler: (async (ctx: Ctx, args: Record<string, unknown>) => {
            const tasks = await db(ctx).tasks.where({ assigneeId: args.userId }) as unknown[]
            return { count: tasks.length }
          }) as never,
        },
        "stats.dashboard": {
          type: "query",
          handler: (async (ctx: Ctx) => {
            const allTasks = await db(ctx).tasks.where({}) as Array<{ done: boolean }>
            const total = allTasks.length
            const done = allTasks.filter(t => t.done).length
            return { total, done, pending: total - done }
          }) as never,
        },
      }

      server.registerFunctions(composedFunctions)
      server.db.seed("tasks", [
        { id: "t1", title: "A", assigneeId: "u1", done: false, priority: 1 },
        { id: "t2", title: "B", assigneeId: "u1", done: true, priority: 2 },
        { id: "t3", title: "C", assigneeId: "u2", done: false, priority: 3 },
      ])

      const userStats = await server.runQuery("stats.taskCountForUser", { userId: "u1" })
      expect((userStats.data as { count: number }).count).toBe(2)

      const dashboard = await server.runQuery("stats.dashboard")
      const dashData = dashboard.data as { total: number; done: number; pending: number }
      expect(dashData.total).toBe(3)
      expect(dashData.done).toBe(1)
      expect(dashData.pending).toBe(2)
    })

    it("composed queries accumulate dependencies from all accessed tables", async () => {
      const composedFn: Record<string, FunctionDefinition> = {
        "combined.userTasks": {
          type: "query",
          handler: (async (ctx: Ctx, args: Record<string, unknown>) => {
            const users = await db(ctx).users.where({ id: args.userId }) as Array<Record<string, unknown>>
            const tasks = await db(ctx).tasks.where({ assigneeId: args.userId }) as unknown[]
            return { user: users[0] ?? null, tasks }
          }) as never,
        },
      }

      server.registerFunctions(composedFn)
      server.db.seed("users", [{ id: "u1", name: "Alice", email: "a@b.com", role: "dev" }])
      server.db.seed("tasks", [
        { id: "t1", title: "Task", assigneeId: "u1", done: false, priority: 1 },
      ])

      const result = await server.runQuery("combined.userTasks", { userId: "u1" })
      const tables = result.dependencies.map(d => d.table)
      expect(tables).toContain("users")
      expect(tables).toContain("tasks")
    })
  })

  // ── 9. Actions ───────────────────────────────────────────────────────────

  describe("action execution", () => {
    it("runs an action and returns a result", async () => {
      server.db.seed("tasks", [
        { id: "t1", title: "Done 1", assigneeId: "u1", done: true, priority: 0 },
        { id: "t2", title: "Pending", assigneeId: "u1", done: false, priority: 0 },
        { id: "t3", title: "Done 2", assigneeId: "u1", done: true, priority: 0 },
      ])

      const result = await server.runAction<{ removed: number }>("tasks.cleanup")
      expect(result.removed).toBe(2)
      expect(server.db.table("tasks").count()).toBe(1)
    })
  })

  // ── 10. Server reset and seed ────────────────────────────────────────────

  describe("server reset and seed", () => {
    it("reset clears all data and auth", async () => {
      server.asUser("user-1")
      server.db.seed("tasks", [{ id: "t1", title: "A", assigneeId: "u1", done: false, priority: 0 }])

      server.reset()

      const result = await server.runQuery("tasks.list")
      expect(result.data).toHaveLength(0)

      const authResult = await server.runQuery("auth.whoami")
      expect((authResult.data as { userId: string | null }).userId).toBeNull()
    })

    it("withSeed populates data", async () => {
      await server.withSeed([
        { table: "tasks", data: { id: "s1", title: "Seeded", assigneeId: "u1", done: false, priority: 5 } },
      ])

      const result = await server.runQuery("tasks.list")
      expect(result.data).toHaveLength(1)
    })

    it("expectQueryToReturn passes for exact match", async () => {
      server.db.seed("tasks", [{ id: "t1", title: "X", assigneeId: "u1", done: false, priority: 0 }])
      await expect(
        server.expectQueryToReturn("tasks.listByUser", { userId: "u1" }, [
          { id: "t1", title: "X", assigneeId: "u1", done: false, priority: 0 },
        ]),
      ).resolves.not.toThrow()
    })

    it("expectQueryToReturn throws on mismatch", async () => {
      server.db.seed("tasks", [{ id: "t1", title: "X", assigneeId: "u1", done: false, priority: 0 }])
      await expect(
        server.expectQueryToReturn("tasks.listByUser", { userId: "u1" }, []),
      ).rejects.toThrow("Query result mismatch")
    })
  })

  // ── 11. Schema definition ────────────────────────────────────────────────

  describe("schema definition", () => {
    it("defineSchema exposes table names", () => {
      expect(schema.tableNames).toContain("users")
      expect(schema.tableNames).toContain("tasks")
      expect(schema.tableNames).toContain("comments")
    })

    it("defineTable adds system timestamp columns by default", () => {
      const table = defineTable({ name: v.string() })
      expect(table.columns).toHaveProperty("_createdAt")
      expect(table.columns).toHaveProperty("_updatedAt")
    })

    it("defineTable respects disableTimestamps option", () => {
      const table = defineTable({ name: v.string() }, { disableTimestamps: true })
      expect(table.columns).not.toHaveProperty("_createdAt")
      expect(table.columns).not.toHaveProperty("_updatedAt")
    })
  })

  // ── 12. Function definition helpers ──────────────────────────────────────

  describe("function definition helpers (query/mutation/action)", () => {
    it("query() creates a RegisteredFunction of type query", () => {
      const fn = query(async () => [])
      expect(fn.type).toBe("query")
      expect((fn.options as { reactive: boolean }).reactive).toBe(true)
    })

    it("query() with reactive: false", () => {
      const fn = query(async () => [], { reactive: false })
      expect((fn.options as { reactive: boolean }).reactive).toBe(false)
    })

    it("mutation() creates a RegisteredFunction of type mutation", () => {
      const fn = mutation(async () => ({}))
      expect(fn.type).toBe("mutation")
    })

    it("action() creates a RegisteredFunction with options", () => {
      const fn = action(async () => {}, { cron: "*/5 * * * *", retries: 3 })
      expect(fn.type).toBe("action")
      expect((fn.options as { cron: string }).cron).toBe("*/5 * * * *")
      expect((fn.options as { retries: number }).retries).toBe(3)
    })
  })

  // ── 13. Cross-table operations ───────────────────────────────────────────

  describe("cross-table operations", () => {
    it("mutation writes to multiple tables in sequence", async () => {
      const multiWrite: FunctionDefinition = {
        type: "mutation",
        handler: (async (ctx: Ctx, args: Record<string, unknown>) => {
          const task = await db(ctx).tasks.insert({
            title: args.title,
            assigneeId: args.userId,
            done: false,
            priority: 0,
          })
          await db(ctx).comments.insert({
            taskId: (task as { id: string }).id,
            authorId: args.userId as string,
            body: `Created task: ${args.title}`,
          })
          return task
        }) as never,
      }

      const result = await server.runMutation(multiWrite, { title: "Multi", userId: "u1" })
      expect(result.modifiedTables).toContain("tasks")
      expect(result.modifiedTables).toContain("comments")
      expect(server.db.table("tasks").count()).toBe(1)
      expect(server.db.table("comments").count()).toBe(1)
    })
  })

  // ── 14. Read-only enforcement ────────────────────────────────────────────

  describe("read-only enforcement", () => {
    it("prevents writes in a read-only context", async () => {
      const ctx = server.db.createContext("read")
      const tasks = ctx["tasks"] as { insert: (d: Record<string, unknown>) => Promise<unknown> }
      await expect(tasks.insert({ title: "fail" })).rejects.toThrow("read-only")
    })
  })

  // ── 15. createAuthContext unit tests ──────────────────────────────────────

  describe("createAuthContext", () => {
    it("authenticated context has userId", () => {
      const ctx = createAuthContext("u1", { role: "admin" })
      expect(ctx.userId).toBe("u1")
      expect(ctx.requireUser()).toBe("u1")
      expect(ctx.hasClaim("role")).toBe(true)
    })

    it("anonymous context throws on requireUser", () => {
      const ctx = createAuthContext(null)
      expect(ctx.userId).toBeNull()
      expect(() => ctx.requireUser()).toThrow(AuthenticationError)
    })

    it("requireRole throws for wrong role", () => {
      const ctx = createAuthContext("u1", { role: "member" })
      expect(() => ctx.requireRole("admin")).toThrow()
    })

    it("requireRole passes for correct role", () => {
      const ctx = createAuthContext("u1", { role: "admin" })
      expect(() => ctx.requireRole("admin")).not.toThrow()
    })

    it("hasClaim returns false for missing claims", () => {
      const ctx = createAuthContext("u1")
      expect(ctx.hasClaim("org")).toBe(false)
    })
  })

  // ── 16. Mock database logs ───────────────────────────────────────────────

  describe("mock database read/write logs", () => {
    it("tracks read operations", async () => {
      server.db.seed("tasks", [{ id: "t1", title: "A", assigneeId: "u1", done: false, priority: 0 }])
      await server.runQuery("tasks.list")
      expect(server.db.getReadLog().length).toBeGreaterThan(0)
    })

    it("tracks write operations", async () => {
      await server.runMutation("tasks.create", { title: "W" })
      expect(server.db.getWriteLog().length).toBeGreaterThan(0)
      expect(server.db.getWriteLog()[0].operation).toBe("insert")
    })

    it("reset clears logs", () => {
      server.db.reset()
      expect(server.db.getReadLog()).toHaveLength(0)
      expect(server.db.getWriteLog()).toHaveLength(0)
    })
  })
})
