/**
 * Tests for TestServer and SnapshotManager.
 * Covers query/mutation execution, auth context switching,
 * snapshot capture/diff, mutation replay, and assertion helpers.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { MockDatabase } from "../mock-database.js"
import { TestServer, createTestServer } from "../test-server.js"
import { SnapshotManager, replayMutations, assertSnapshotMatches, assertDiffContains } from "../snapshot-testing.js"
import type { FunctionDefinition } from "../test-server.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function listTasksHandler(ctx: Record<string, unknown>, args: Record<string, unknown>) {
  const tasks = ctx.db as Record<string, { where: (f: Record<string, unknown>) => unknown }>
  return tasks.tasks.where(args.filter ? (args.filter as Record<string, unknown>) : {})
}

function createTaskHandler(ctx: Record<string, unknown>, args: Record<string, unknown>) {
  const db = ctx.db as Record<string, { insert: (d: Record<string, unknown>) => unknown }>
  return db.tasks.insert({ title: args.title, done: false })
}

function updateTaskHandler(ctx: Record<string, unknown>, args: Record<string, unknown>) {
  const db = ctx.db as Record<string, { update: (id: string, d: Record<string, unknown>) => unknown }>
  return db.tasks.update(args.id as string, { done: args.done })
}

function authCheckHandler(ctx: Record<string, unknown>) {
  const auth = ctx.auth as { userId: string | null; requireUser: () => string }
  return { userId: auth.userId }
}

const functions: Record<string, FunctionDefinition> = {
  "tasks.list": { type: "query", handler: listTasksHandler as never },
  "tasks.create": { type: "mutation", handler: createTaskHandler as never },
  "tasks.update": { type: "mutation", handler: updateTaskHandler as never },
  "auth.check": { type: "query", handler: authCheckHandler as never },
}

// ─── TestServer ──────────────────────────────────────────────────────────────

describe("TestServer", () => {
  let server: TestServer

  beforeEach(() => {
    server = createTestServer()
    server.registerFunctions(functions)
    server.db.seed("tasks", [
      { id: "t1", title: "Task 1", done: false },
      { id: "t2", title: "Task 2", done: true },
      { id: "t3", title: "Task 3", done: false },
    ])
  })

  describe("createTestServer", () => {
    it("creates a TestServer instance", () => {
      const s = createTestServer()
      expect(s).toBeInstanceOf(TestServer)
    })
  })

  describe("runQuery", () => {
    it("runs a query by name and returns data", async () => {
      const result = await server.runQuery("tasks.list", {})
      expect(result.data).toHaveLength(3)
    })

    it("returns dependency tracking info", async () => {
      const result = await server.runQuery("tasks.list", { filter: { done: false } })
      expect(result.dependencies).toBeDefined()
      expect(result.dependencies.length).toBeGreaterThan(0)
      expect(result.dependencies[0].table).toBe("tasks")
    })

    it("runs query by function ref", async () => {
      const result = await server.runQuery({ handler: listTasksHandler as never }, {})
      expect(result.data).toHaveLength(3)
    })

    it("throws for unknown function name", async () => {
      await expect(server.runQuery("nonexistent", {})).rejects.toThrow("Function not found")
    })
  })

  describe("runMutation", () => {
    it("runs a mutation and returns data + modified tables", async () => {
      const result = await server.runMutation("tasks.create", { title: "New Task" })
      expect(result.data).toHaveProperty("id")
      expect(result.modifiedTables).toContain("tasks")
    })

    it("persists mutation effects", async () => {
      await server.runMutation("tasks.create", { title: "New" })
      const query = await server.runQuery("tasks.list", {})
      expect(query.data).toHaveLength(4)
    })
  })

  describe("runAction", () => {
    it("runs an action and returns result", async () => {
      const result = await server.runAction("auth.check", {})
      expect(result).toBeDefined()
    })
  })

  describe("auth context switching", () => {
    it("asUser sets userId", async () => {
      server.asUser("user123")
      const result = await server.runQuery<{ userId: string }>("auth.check", {})
      expect(result.data.userId).toBe("user123")
    })

    it("asAnonymous sets userId to null", async () => {
      server.asUser("user1")
      server.asAnonymous()
      const result = await server.runQuery<{ userId: string | null }>("auth.check", {})
      expect(result.data.userId).toBeNull()
    })

    it("asUser accepts claims", async () => {
      server.asUser("user1", { role: "admin" })
      const result = await server.runQuery<{ userId: string }>("auth.check", {})
      expect(result.data.userId).toBe("user1")
    })
  })

  describe("expectMutationToModify", () => {
    it("passes when mutation modifies expected tables", async () => {
      await expect(server.expectMutationToModify("tasks.create", { title: "X" }, ["tasks"])).resolves.not.toThrow()
    })

    it("throws when expected table is missing", async () => {
      await expect(server.expectMutationToModify("tasks.create", { title: "X" }, ["tasks", "users"])).rejects.toThrow(
        "missing: [users]",
      )
    })
  })

  describe("expectQueryToReturn", () => {
    it("passes when query returns expected data", async () => {
      server.db.reset()
      server.db.seed("tasks", [{ id: "t1", title: "A", done: false }])
      await expect(
        server.expectQueryToReturn("tasks.list", { filter: { id: "t1" } }, [{ id: "t1", title: "A", done: false }]),
      ).resolves.not.toThrow()
    })

    it("throws on mismatch", async () => {
      await expect(server.expectQueryToReturn("tasks.list", {}, [])).rejects.toThrow("Query result mismatch")
    })
  })

  describe("snapshotReactiveUpdates", () => {
    it("captures initial and post-mutation query results", async () => {
      const snapshots = await server.snapshotReactiveUpdates("tasks.list", {}, [
        { fn: "tasks.create", args: { title: "New1" } },
        { fn: "tasks.create", args: { title: "New2" } },
      ])
      expect(snapshots).toHaveLength(3)
      expect(snapshots[0].label).toBe("initial")
      expect(snapshots[0].step).toBe(0)
      expect((snapshots[0].data as unknown[]).length).toBe(3)
      expect((snapshots[2].data as unknown[]).length).toBe(5)
    })
  })

  describe("reset", () => {
    it("clears all data and resets auth", async () => {
      server.asUser("user1")
      server.reset()
      const result = await server.runQuery<{ userId: string | null }>("auth.check", {})
      expect(result.data.userId).toBeNull()
    })
  })

  describe("withSeed", () => {
    it("seeds data into the database", async () => {
      server.db.reset()
      await server.withSeed([
        { table: "tasks", data: { id: "s1", title: "Seeded", done: false } },
        { table: "tasks", data: { id: "s2", title: "Seeded2", done: true } },
      ])
      const result = await server.runQuery("tasks.list", {})
      expect(result.data).toHaveLength(2)
    })
  })
})

// ─── SnapshotManager ─────────────────────────────────────────────────────────

describe("SnapshotManager", () => {
  let db: MockDatabase
  let mgr: SnapshotManager

  beforeEach(() => {
    db = new MockDatabase()
    db.seed("tasks", [
      { id: "t1", title: "Task 1", done: false },
      { id: "t2", title: "Task 2", done: true },
    ])
    mgr = new SnapshotManager(db, ["tasks"])
  })

  describe("capture", () => {
    it("captures a named snapshot", () => {
      const snap = mgr.capture("initial")
      expect(snap.name).toBe("initial")
      expect(snap.tables.tasks).toHaveLength(2)
      expect(snap.capturedAt).toBeGreaterThan(0)
    })

    it("captures snapshot with metadata", () => {
      const snap = mgr.capture("v1", { version: 1 })
      expect(snap.metadata).toEqual({ version: 1 })
    })

    it("throws on duplicate snapshot name", () => {
      mgr.capture("dup")
      expect(() => mgr.capture("dup")).toThrow('Snapshot "dup" already exists')
    })
  })

  describe("get", () => {
    it("returns captured snapshot", () => {
      mgr.capture("test")
      expect(mgr.get("test")).toBeDefined()
      expect(mgr.get("test")!.name).toBe("test")
    })

    it("returns undefined for missing snapshot", () => {
      expect(mgr.get("missing")).toBeUndefined()
    })
  })

  describe("list", () => {
    it("lists all snapshots with metadata", () => {
      mgr.capture("s1")
      mgr.capture("s2")
      const list = mgr.list()
      expect(list).toHaveLength(2)
      expect(list[0]).toHaveProperty("name")
      expect(list[0]).toHaveProperty("tableCount")
      expect(list[0]).toHaveProperty("rowCount")
    })
  })

  describe("delete", () => {
    it("deletes a snapshot", () => {
      mgr.capture("del")
      expect(mgr.delete("del")).toBe(true)
      expect(mgr.get("del")).toBeUndefined()
    })

    it("returns false for missing snapshot", () => {
      expect(mgr.delete("missing")).toBe(false)
    })
  })

  describe("clear", () => {
    it("removes all snapshots", () => {
      mgr.capture("a")
      mgr.capture("b")
      mgr.clear()
      expect(mgr.list()).toHaveLength(0)
    })
  })

  describe("diff", () => {
    it("computes diff between two snapshots", () => {
      mgr.capture("before")
      db.table("tasks").insert({ id: "t3", title: "Task 3", done: false })
      mgr.capture("after")

      const diff = mgr.diff("before", "after")
      expect(diff.from).toBe("before")
      expect(diff.to).toBe("after")
      expect(diff.summary.totalInserts).toBe(1)
      expect(diff.tables.tasks.inserted).toHaveLength(1)
      expect(diff.tables.tasks.inserted[0].id).toBe("t3")
    })

    it("detects deletions", () => {
      mgr.capture("before")
      db.table("tasks").delete("t1")
      mgr.capture("after")

      const diff = mgr.diff("before", "after")
      expect(diff.summary.totalDeletes).toBe(1)
      expect(diff.tables.tasks.deleted).toHaveLength(1)
    })

    it("detects updates", () => {
      mgr.capture("before")
      db.table("tasks").update("t1", { done: true })
      mgr.capture("after")

      const diff = mgr.diff("before", "after")
      expect(diff.summary.totalUpdates).toBe(1)
      expect(diff.tables.tasks.updated[0].changes.done).toEqual({
        from: false,
        to: true,
      })
    })

    it("throws for missing snapshot", () => {
      mgr.capture("exists")
      expect(() => mgr.diff("exists", "missing")).toThrow('Snapshot "missing" not found')
      expect(() => mgr.diff("missing", "exists")).toThrow('Snapshot "missing" not found')
    })

    it("handles table added between snapshots", () => {
      mgr.capture("before")
      // Add a new table by registering with a new SnapshotManager
      db.seed("users", [{ id: "u1", name: "Alice" }])
      const mgr2 = new SnapshotManager(db, ["tasks", "users"])
      mgr2.capture("before2")
      mgr2.capture("after2")
      const diff = mgr2.diff("before2", "after2")
      expect(diff.summary.totalInserts).toBe(0)
    })

    it("empty diff when no changes", () => {
      mgr.capture("a")
      mgr.capture("b")
      const diff = mgr.diff("a", "b")
      expect(diff.summary.totalInserts).toBe(0)
      expect(diff.summary.totalDeletes).toBe(0)
      expect(diff.summary.totalUpdates).toBe(0)
    })
  })

  describe("diffFromCurrent", () => {
    it("diffs snapshot against current state", () => {
      mgr.capture("snap")
      db.table("tasks").insert({ id: "t4", title: "New", done: false })

      const diff = mgr.diffFromCurrent("snap")
      expect(diff.summary.totalInserts).toBe(1)
      expect(diff.to).toBe("<current>")
    })

    it("throws for missing snapshot", () => {
      expect(() => mgr.diffFromCurrent("missing")).toThrow('Snapshot "missing" not found')
    })
  })
})

// ─── replayMutations ─────────────────────────────────────────────────────────

describe("replayMutations", () => {
  let db: MockDatabase
  let server: TestServer
  let mgr: SnapshotManager

  beforeEach(() => {
    server = createTestServer()
    server.registerFunctions(functions)
    server.db.seed("tasks", [{ id: "t1", title: "Task 1", done: false }])
    db = server.db
    mgr = new SnapshotManager(db, ["tasks"])
  })

  it("replays mutations and captures diffs", async () => {
    const runner = {
      async runMutation(fn: string, args: Record<string, unknown>) {
        return server.runMutation(fn, args)
      },
    }

    const result = await replayMutations(runner, mgr, [
      { label: "add task", fn: "tasks.create", args: { title: "Added" } },
      { label: "update task", fn: "tasks.update", args: { id: "t1", done: true } },
    ])

    expect(result.entries).toHaveLength(2)
    expect(result.diffs).toHaveLength(2)
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0)
    expect(result.entries[0].label).toBe("add task")
    expect(result.diffs[0].summary.totalInserts).toBe(1)
  })
})

// ─── assertSnapshotMatches ───────────────────────────────────────────────────

describe("assertSnapshotMatches", () => {
  it("passes when snapshot matches expected data", () => {
    const db = new MockDatabase()
    db.seed("tasks", [{ id: "t1", title: "A", done: false }])
    const mgr = new SnapshotManager(db, ["tasks"])
    const snap = mgr.capture("test")

    expect(() =>
      assertSnapshotMatches(snap, {
        tasks: [{ id: "t1", title: "A", done: false }],
      }),
    ).not.toThrow()
  })

  it("throws on mismatch", () => {
    const db = new MockDatabase()
    db.seed("tasks", [{ id: "t1", title: "A", done: false }])
    const mgr = new SnapshotManager(db, ["tasks"])
    const snap = mgr.capture("test")

    expect(() =>
      assertSnapshotMatches(snap, {
        tasks: [{ id: "t1", title: "B", done: false }],
      }),
    ).toThrow("mismatch")
  })

  it("throws on missing table", () => {
    const db = new MockDatabase()
    const mgr = new SnapshotManager(db, [])
    const snap = mgr.capture("test")

    expect(() =>
      assertSnapshotMatches(snap, {
        users: [{ id: "u1" }],
      }),
    ).toThrow('Table "users" not found')
  })
})

// ─── assertDiffContains ──────────────────────────────────────────────────────

describe("assertDiffContains", () => {
  it("passes when diff matches expectations", () => {
    const db = new MockDatabase()
    db.seed("tasks", [{ id: "t1", title: "A" }])
    const mgr = new SnapshotManager(db, ["tasks"])
    mgr.capture("before")
    db.table("tasks").insert({ id: "t2", title: "B" })
    mgr.capture("after")
    const diff = mgr.diff("before", "after")

    expect(() => assertDiffContains(diff, { inserts: { tasks: 1 } })).not.toThrow()
  })

  it("throws on wrong insert count", () => {
    const db = new MockDatabase()
    db.seed("tasks", [{ id: "t1", title: "A" }])
    const mgr = new SnapshotManager(db, ["tasks"])
    mgr.capture("before")
    mgr.capture("after")
    const diff = mgr.diff("before", "after")

    expect(() => assertDiffContains(diff, { inserts: { tasks: 1 } })).toThrow("Expected 1 inserts")
  })

  it("validates delete counts", () => {
    const db = new MockDatabase()
    db.seed("tasks", [{ id: "t1", title: "A" }])
    const mgr = new SnapshotManager(db, ["tasks"])
    mgr.capture("before")
    db.table("tasks").delete("t1")
    mgr.capture("after")
    const diff = mgr.diff("before", "after")

    expect(() => assertDiffContains(diff, { deletes: { tasks: 1 } })).not.toThrow()
  })

  it("validates update counts", () => {
    const db = new MockDatabase()
    db.seed("tasks", [{ id: "t1", title: "A" }])
    const mgr = new SnapshotManager(db, ["tasks"])
    mgr.capture("before")
    db.table("tasks").update("t1", { title: "B" })
    mgr.capture("after")
    const diff = mgr.diff("before", "after")

    expect(() => assertDiffContains(diff, { updates: { tasks: 1 } })).not.toThrow()
  })
})
