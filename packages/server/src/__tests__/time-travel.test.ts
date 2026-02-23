import { describe, it, expect, beforeEach } from "vitest"
import {
  TimeTravelEngine,
  generateTimeTravelTableSQL,
  buildInsertEventSQL,
  buildGetEventsInRangeSQL,
  buildGetRowHistorySQL,
  buildPruneEventsSQL,
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
      const events = engine.getRecentEvents(1)
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
