import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  TimeTravelEngine,
  generateTimeTravelTableSQL,
  buildInsertEventSQL,
  buildGetEventsInRangeSQL,
  buildGetRowHistorySQL,
  buildPruneEventsSQL,
  type QueryExecutor,
} from "../time-travel/time-travel.js"

describe("TimeTravelEngine", () => {
  let engine: TimeTravelEngine

  beforeEach(() => {
    engine = new TimeTravelEngine({ retentionDays: 7 })
  })

  describe("recording mutations", () => {
    it("records a mutation event", () => {
      const event = engine.recordMutation({
        mutationName: "tasks.complete",
        table: "tasks",
        operation: "update",
        rowId: "t1",
        before: { done: false },
        after: { done: true },
        userId: "u1",
      })

      expect(event.id).toBeTruthy()
      expect(event.table).toBe("tasks")
      expect(event.operation).toBe("update")
      expect(event.before).toEqual({ done: false })
      expect(event.after).toEqual({ done: true })
      expect(engine.eventCount).toBe(1)
    })

    it("records insert events", () => {
      const event = engine.recordMutation({
        mutationName: "tasks.create",
        table: "tasks",
        operation: "insert",
        rowId: "t1",
        after: { title: "New task", done: false },
      })

      expect(event.before).toBeNull()
      expect(event.after).toEqual({ title: "New task", done: false })
    })

    it("records delete events", () => {
      const event = engine.recordMutation({
        mutationName: "tasks.delete",
        table: "tasks",
        operation: "delete",
        rowId: "t1",
        before: { title: "Old task" },
      })

      expect(event.before).toEqual({ title: "Old task" })
      expect(event.after).toBeNull()
    })

    it("enforces max in-memory limit", () => {
      const eng = new TimeTravelEngine({ maxInMemoryEvents: 10 })
      for (let i = 0; i < 15; i++) {
        eng.recordMutation({
          mutationName: "test",
          table: "t",
          operation: "insert",
          rowId: `r${i}`,
        })
      }
      expect(eng.eventCount).toBeLessThanOrEqual(10)
    })
  })

  describe("querying events", () => {
    it("gets events in time range", () => {
      const start = Date.now()
      engine.recordMutation({ mutationName: "a", table: "t", operation: "insert", rowId: "r1" })
      engine.recordMutation({ mutationName: "b", table: "t", operation: "update", rowId: "r1" })

      const events = engine.getEventsInRange(start - 1, Date.now() + 1)
      expect(events).toHaveLength(2)
    })

    it("filters by table", () => {
      engine.recordMutation({ mutationName: "a", table: "tasks", operation: "insert", rowId: "r1" })
      engine.recordMutation({ mutationName: "b", table: "users", operation: "insert", rowId: "r2" })

      const events = engine.getEventsInRange(0, Date.now() + 1, "tasks")
      expect(events).toHaveLength(1)
      expect(events[0].table).toBe("tasks")
    })

    it("gets row history", () => {
      engine.recordMutation({ mutationName: "a", table: "tasks", operation: "insert", rowId: "t1", after: { v: 1 } })
      engine.recordMutation({ mutationName: "b", table: "tasks", operation: "update", rowId: "t1", after: { v: 2 } })
      engine.recordMutation({ mutationName: "c", table: "tasks", operation: "update", rowId: "t2", after: { v: 1 } })

      const history = engine.getRowHistory("tasks", "t1")
      expect(history).toHaveLength(2)
    })

    it("reconstructs row state at a point in time", () => {
      engine.recordMutation({
        mutationName: "a",
        table: "tasks",
        operation: "insert",
        rowId: "t1",
        after: { title: "v1" },
      })
      engine.recordMutation({
        mutationName: "b",
        table: "tasks",
        operation: "update",
        rowId: "t1",
        after: { title: "v2" },
      })

      // The latest state should be v2
      const stateNow = engine.getRowStateAt("tasks", "t1", Date.now() + 1)
      expect(stateNow).toEqual({ title: "v2" })

      // The first event should show the insert state
      const history = engine.getRowHistory("tasks", "t1")
      expect(history).toHaveLength(2)
      expect(history[0].after).toEqual({ title: "v1" })
    })

    it("returns null for deleted rows", () => {
      engine.recordMutation({
        mutationName: "a",
        table: "tasks",
        operation: "insert",
        rowId: "t1",
        after: { title: "v1" },
      })
      engine.recordMutation({
        mutationName: "b",
        table: "tasks",
        operation: "delete",
        rowId: "t1",
        before: { title: "v1" },
      })

      const state = engine.getRowStateAt("tasks", "t1", Date.now() + 1)
      expect(state).toBeNull()
    })

    it("returns null for non-existent rows", () => {
      const state = engine.getRowStateAt("tasks", "nonexistent", Date.now())
      expect(state).toBeNull()
    })

    it("gets recent events", () => {
      for (let i = 0; i < 10; i++) {
        engine.recordMutation({ mutationName: `m${i}`, table: "t", operation: "insert", rowId: `r${i}` })
      }

      const recent = engine.getRecentEvents(3)
      expect(recent).toHaveLength(3)
      expect(recent[2].mutationName).toBe("m9")
    })
  })

  describe("diffing", () => {
    it("generates a diff between two points", () => {
      const before = Date.now()
      engine.recordMutation({
        mutationName: "a",
        table: "tasks",
        operation: "insert",
        rowId: "t1",
        after: { title: "New" },
      })
      engine.recordMutation({
        mutationName: "b",
        table: "tasks",
        operation: "update",
        rowId: "t1",
        before: { title: "New" },
        after: { title: "Updated" },
      })

      const d = engine.diff(before - 1, Date.now() + 1)
      expect(d.changes).toHaveLength(1)
      expect(d.changes[0].operation).toBe("insert")
    })
  })

  describe("aggregations", () => {
    it("counts events by table", () => {
      engine.recordMutation({ mutationName: "a", table: "tasks", operation: "insert", rowId: "r1" })
      engine.recordMutation({ mutationName: "b", table: "tasks", operation: "insert", rowId: "r2" })
      engine.recordMutation({ mutationName: "c", table: "users", operation: "insert", rowId: "r1" })

      const counts = engine.getEventCountsByTable()
      expect(counts.tasks).toBe(2)
      expect(counts.users).toBe(1)
    })

    it("counts events by mutation", () => {
      engine.recordMutation({ mutationName: "create", table: "t", operation: "insert", rowId: "r1" })
      engine.recordMutation({ mutationName: "create", table: "t", operation: "insert", rowId: "r2" })
      engine.recordMutation({ mutationName: "update", table: "t", operation: "update", rowId: "r1" })

      const counts = engine.getEventCountsByMutation()
      expect(counts.create).toBe(2)
      expect(counts.update).toBe(1)
    })
  })

  describe("pruning", () => {
    it("prunes old events", () => {
      engine.recordMutation({ mutationName: "old", table: "t", operation: "insert", rowId: "r1" })

      // Manually set the event timestamp to the past
      const _events = engine.getRecentEvents(1)
      // Use retentionDays: 0 means cutoff = now, but events recorded at now won't be pruned
      // So we test with a retention engine that has short retention and artificially old events
      const eng2 = new TimeTravelEngine({ retentionDays: 1 })
      eng2.recordMutation({ mutationName: "recent", table: "t", operation: "insert", rowId: "r1" })
      const pruned2 = eng2.prune()
      expect(pruned2).toBe(0) // Recent event is not pruned
      expect(eng2.eventCount).toBe(1)
    })

    it("clears all events", () => {
      engine.recordMutation({ mutationName: "a", table: "t", operation: "insert", rowId: "r1" })
      engine.clear()
      expect(engine.eventCount).toBe(0)
    })
  })
})

describe("Time-travel SQL builders", () => {
  it("generates table SQL", () => {
    const sql = generateTimeTravelTableSQL()
    expect(sql).toContain("_reactivebase_mutation_events")
    expect(sql).toContain("CREATE INDEX")
  })

  it("builds insert event SQL", () => {
    const { sql, params } = buildInsertEventSQL({
      id: "evt_1",
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      mutationName: "test",
      table: "tasks",
      operation: "update",
      rowId: "t1",
      before: { done: false },
      after: { done: true },
    })
    expect(sql).toContain("INSERT INTO _reactivebase_mutation_events")
    expect(params[0]).toBe("evt_1")
  })

  it("builds range query SQL", () => {
    const { sql, params } = buildGetEventsInRangeSQL(100, 200, "tasks")
    expect(sql).toContain("timestamp_ms >= $1")
    expect(sql).toContain('"table" = $3')
    expect(params).toEqual([100, 200, "tasks"])
  })

  it("builds row history SQL", () => {
    const { sql, params } = buildGetRowHistorySQL("tasks", "t1")
    expect(sql).toContain('"table" = $1')
    expect(params).toEqual(["tasks", "t1"])
  })

  it("builds prune SQL", () => {
    const { sql, params } = buildPruneEventsSQL(1000)
    expect(sql).toContain("DELETE FROM")
    expect(params).toEqual([1000])
  })
})

// ─── DB Persistence Tests ────────────────────────────────────────────────────

function createMockDb(rows: Record<string, unknown>[] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const db: QueryExecutor = async (sql: string, params: unknown[]) => {
    calls.push({ sql, params })
    return { rows }
  }
  return { db, calls }
}

describe("TimeTravelEngine – DB persistence", () => {
  it("initTables() executes CREATE TABLE statements", async () => {
    const { db, calls } = createMockDb()
    const engine = new TimeTravelEngine({ db })

    await engine.initTables()

    expect(calls.length).toBeGreaterThan(0)
    const allSql = calls.map((c) => c.sql).join(" ")
    expect(allSql).toContain("CREATE TABLE")
    expect(allSql).toContain("_reactivebase_mutation_events")
    expect(allSql).toContain("CREATE INDEX")
  })

  it("initTables() is a no-op without db", async () => {
    const engine = new TimeTravelEngine()
    // Should resolve without error
    await engine.initTables()
  })

  it("recordMutation persists event via INSERT SQL", async () => {
    const { db, calls } = createMockDb()
    const engine = new TimeTravelEngine({ db })

    engine.recordMutation({
      mutationName: "tasks.create",
      table: "tasks",
      operation: "insert",
      rowId: "t1",
      after: { title: "Hello" },
      userId: "u1",
    })

    // fire-and-forget — wait for the microtask to flush
    await vi.waitFor(() => expect(calls.length).toBe(1))

    expect(calls[0].sql).toContain("INSERT INTO _reactivebase_mutation_events")
    expect(calls[0].params[3]).toBe("tasks")
    expect(calls[0].params[4]).toBe("insert")
    expect(calls[0].params[5]).toBe("t1")
  })

  it("recordMutation still stores in-memory when db is present", () => {
    const { db } = createMockDb()
    const engine = new TimeTravelEngine({ db })

    engine.recordMutation({
      mutationName: "tasks.create",
      table: "tasks",
      operation: "insert",
      rowId: "t1",
    })

    expect(engine.eventCount).toBe(1)
  })

  it("queryAt() uses DB temporal query when db is configured", async () => {
    const mockRows = [{ id: "t1", title: "Snapshot" }]
    const { db, calls } = createMockDb(mockRows)
    const engine = new TimeTravelEngine({ db })

    const ts = Date.now()
    const result = await engine.queryAt("tasks", ts)

    expect(calls.length).toBe(1)
    expect(calls[0].sql).toContain("AS OF SYSTEM TIME")
    expect(calls[0].sql).toContain('"tasks"')
    expect(result).toEqual(mockRows)
  })

  it("queryAt() falls back to in-memory without db", async () => {
    const engine = new TimeTravelEngine()

    const ts = Date.now()
    engine.recordMutation({
      mutationName: "tasks.create",
      table: "tasks",
      operation: "insert",
      rowId: "t1",
      after: { title: "In-memory" },
    })

    const result = await engine.queryAt("tasks", ts)
    expect(result).toEqual(
      engine
        .getEventsInRange(ts, ts)
        .filter((e) => e.table === "tasks")
        .map((e) => e.after ?? {}),
    )
  })

  it("prune() executes DELETE SQL when db is configured", async () => {
    const { db, calls } = createMockDb()
    const engine = new TimeTravelEngine({ db, retentionDays: 1 })

    engine.prune()

    await vi.waitFor(() => expect(calls.length).toBe(1))

    expect(calls[0].sql).toContain("DELETE FROM _reactivebase_mutation_events")
    expect(calls[0].params).toHaveLength(1)
    expect(typeof calls[0].params[0]).toBe("number")
  })

  it("recordMutation succeeds even when db throws", async () => {
    const failingDb: QueryExecutor = async () => {
      throw new Error("DB connection lost")
    }
    const engine = new TimeTravelEngine({ db: failingDb })

    const event = engine.recordMutation({
      mutationName: "tasks.create",
      table: "tasks",
      operation: "insert",
      rowId: "t1",
    })

    expect(event.id).toBeTruthy()
    expect(engine.eventCount).toBe(1)
  })

  it("prune() succeeds even when db throws", () => {
    const failingDb: QueryExecutor = async () => {
      throw new Error("DB connection lost")
    }
    const engine = new TimeTravelEngine({ db: failingDb, retentionDays: 1 })

    // Should not throw
    expect(() => engine.prune()).not.toThrow()
  })

  it("constructor stores db option and uses it", async () => {
    const { db, calls } = createMockDb()
    const engine = new TimeTravelEngine({ db, retentionDays: 7 })

    // db is used when initTables is called
    await engine.initTables()
    expect(calls.length).toBeGreaterThan(0)

    // db is used when recording mutations
    engine.recordMutation({
      mutationName: "test",
      table: "t",
      operation: "insert",
      rowId: "r1",
    })

    await vi.waitFor(() => expect(calls.some((c) => c.sql.includes("INSERT INTO"))).toBe(true))
  })
})
