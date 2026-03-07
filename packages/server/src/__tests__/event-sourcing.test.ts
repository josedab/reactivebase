import { describe, it, expect } from "vitest"
import {
  EventStore,
  ProjectionEngine,
  EventSourcingError,
  buildCreateEventStoreTablesSQL,
  buildAppendEventSQL,
  buildGetEventsSQL,
  buildUpsertStreamSQL,
  buildSaveSnapshotSQL,
} from "../event-sourcing/index.js"
import type { QueryExecutor, DomainEvent } from "../event-sourcing/index.js"

function createMockDb() {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const db: QueryExecutor = async (sql: string, params: unknown[]) => {
    calls.push({ sql, params })
    return { rows: [] }
  }
  return { db, calls }
}

function createFailingDb() {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const db: QueryExecutor = async (sql: string, params: unknown[]) => {
    calls.push({ sql, params })
    throw new Error("DB connection refused")
  }
  return { db, calls }
}

describe("event-sourcing", () => {
  it("should export all expected symbols", () => {
    expect(EventStore).toBeDefined()
    expect(ProjectionEngine).toBeDefined()
    expect(EventSourcingError).toBeDefined()
    expect(buildCreateEventStoreTablesSQL).toBeDefined()
    expect(buildAppendEventSQL).toBeDefined()
    expect(buildGetEventsSQL).toBeDefined()
  })

  it("should generate valid event store tables SQL", () => {
    const sql = buildCreateEventStoreTablesSQL()
    expect(typeof sql).toBe("string")
    expect(sql.toUpperCase()).toContain("CREATE")
  })

  it("should throw EventSourcingError with correct message", () => {
    const error = new EventSourcingError("test error", "TEST_CODE")
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe("test error")
    expect(error.code).toBe("TEST_CODE")
  })

  it.todo("should test error propagation with event metadata")

  // ── DB Persistence Tests ───────────────────────────────────────────────

  describe("initTables()", () => {
    it("should call db with CREATE TABLE SQL when db is configured", async () => {
      const { db, calls } = createMockDb()
      const store = new EventStore({ db })

      await store.initTables()

      expect(calls).toHaveLength(1)
      const sql = calls[0].sql.toUpperCase()
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS _RB_ES_EVENTS")
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS _RB_ES_STREAMS")
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS _RB_ES_SNAPSHOTS")
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS _RB_ES_PROJECTIONS")
      expect(calls[0].params).toEqual([])
    })

    it("should be a no-op when db is not configured", async () => {
      const store = new EventStore()
      // Should not throw and should complete silently
      await expect(store.initTables()).resolves.toBeUndefined()
    })
  })

  describe("append() with DB", () => {
    it("should persist events and upsert stream via db calls", async () => {
      const { db, calls } = createMockDb()
      const store = new EventStore({ db })

      const result = await store.append("stream-1", [
        { type: "UserCreated", data: { name: "Alice" } },
        { type: "UserUpdated", data: { name: "Bob" } },
      ])

      expect(result.eventsWritten).toBe(2)
      expect(result.streamId).toBe("stream-1")
      expect(result.version).toBe(2)

      // 2 event inserts + 1 stream upsert = 3 DB calls
      expect(calls).toHaveLength(3)

      // First two calls are event inserts
      const expectedInsertSQL = buildAppendEventSQL().trim()
      expect(calls[0].sql.trim()).toBe(expectedInsertSQL)
      expect(calls[0].params[1]).toBe("stream-1") // streamId
      expect(calls[0].params[2]).toBe("UserCreated") // type
      expect(calls[0].params[3]).toEqual({ name: "Alice" }) // data
      expect(calls[0].params[5]).toBe(1) // version

      expect(calls[1].sql.trim()).toBe(expectedInsertSQL)
      expect(calls[1].params[2]).toBe("UserUpdated")
      expect(calls[1].params[5]).toBe(2) // version

      // Third call is stream upsert
      const expectedUpsertSQL = buildUpsertStreamSQL().trim()
      expect(calls[2].sql.trim()).toBe(expectedUpsertSQL)
      expect(calls[2].params[0]).toBe("stream-1")
      expect(calls[2].params[2]).toBe(2) // latest version
    })
  })

  describe("append() without DB", () => {
    it("should work purely in-memory with no db configured", async () => {
      const store = new EventStore()

      const result = await store.append("stream-1", [{ type: "ItemAdded", data: { item: "widget" } }])

      expect(result.eventsWritten).toBe(1)
      expect(result.version).toBe(1)

      const events = store.getEvents("stream-1")
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("ItemAdded")
      expect(events[0].data).toEqual({ item: "widget" })
    })

    it("should still enforce concurrency checks without db", async () => {
      const store = new EventStore()
      await store.append("stream-1", [{ type: "Init", data: {} }])

      await expect(store.append("stream-1", [{ type: "Conflict", data: {} }], 0)).rejects.toThrow(
        "Concurrency conflict",
      )
    })
  })

  describe("auto-snapshot with DB", () => {
    it("should persist snapshot via db when snapshot interval fires", async () => {
      const { db, calls } = createMockDb()
      const snapshotInterval = 3
      const store = new EventStore({ db, snapshotInterval })

      // Append exactly snapshotInterval events to trigger a snapshot
      const events = Array.from({ length: snapshotInterval }, (_, i) => ({
        type: "Event",
        data: { seq: i },
      }))
      await store.append("snap-stream", events)

      // Find the snapshot save call
      const snapshotCalls = calls.filter((c) => c.sql.toUpperCase().includes("_RB_ES_SNAPSHOTS"))
      expect(snapshotCalls).toHaveLength(1)

      const expectedSnapshotSQL = buildSaveSnapshotSQL().trim()
      expect(snapshotCalls[0].sql.trim()).toBe(expectedSnapshotSQL)
      expect(snapshotCalls[0].params[0]).toBe("snap-stream")
      expect(snapshotCalls[0].params[1]).toBe(snapshotInterval) // version

      // Verify the snapshot state is the merged event data
      const snapshotState = snapshotCalls[0].params[2] as Record<string, unknown>
      expect(snapshotState).toEqual({ seq: snapshotInterval - 1 })
    })

    it("should not persist snapshot when threshold is not reached", async () => {
      const { db, calls } = createMockDb()
      const store = new EventStore({ db, snapshotInterval: 100 })

      await store.append("no-snap", [{ type: "Event", data: { x: 1 } }])

      const snapshotCalls = calls.filter((c) => c.sql.toUpperCase().includes("_RB_ES_SNAPSHOTS"))
      expect(snapshotCalls).toHaveLength(0)
    })
  })

  describe("executeCommand() with DB", () => {
    it("should persist events generated by command execution", async () => {
      const { db, calls } = createMockDb()
      const store = new EventStore({ db })

      store.registerCommand({
        type: "CreateUser",
        handle: (command: unknown) => {
          const cmd = command as { name: string }
          return [
            {
              id: "",
              streamId: "",
              type: "UserCreated",
              data: { name: cmd.name },
              metadata: {},
              version: 0,
              timestamp: 0,
            },
          ] as DomainEvent[]
        },
        validate: (command: unknown) => {
          const cmd = command as { name?: string }
          return cmd.name ? null : "name is required"
        },
      })

      const result = await store.executeCommand("user-1", "CreateUser", { name: "Alice" })

      expect(result.eventsWritten).toBe(1)
      expect(result.streamId).toBe("user-1")

      // Should have event insert + stream upsert
      const insertCalls = calls.filter((c) => c.sql.toUpperCase().includes("INSERT INTO _RB_ES_EVENTS"))
      expect(insertCalls).toHaveLength(1)
      expect(insertCalls[0].params[2]).toBe("UserCreated")
      expect(insertCalls[0].params[3]).toEqual({ name: "Alice" })

      const streamCalls = calls.filter((c) => c.sql.toUpperCase().includes("_RB_ES_STREAMS"))
      expect(streamCalls).toHaveLength(1)
    })

    it("should reject invalid commands without making db calls", async () => {
      const { db, calls } = createMockDb()
      const store = new EventStore({ db })

      store.registerCommand({
        type: "CreateUser",
        handle: () => [] as DomainEvent[],
        validate: () => "always fails",
      })

      await expect(store.executeCommand("user-1", "CreateUser", {})).rejects.toThrow("Command validation failed")

      expect(calls).toHaveLength(0)
    })
  })

  describe("QueryExecutor receives correct SQL", () => {
    it("should use expected table names and columns in event insert SQL", () => {
      const sql = buildAppendEventSQL()
      expect(sql).toContain("_rb_es_events")
      expect(sql).toContain("id")
      expect(sql).toContain("stream_id")
      expect(sql).toContain("type")
      expect(sql).toContain("data")
      expect(sql).toContain("metadata")
      expect(sql).toContain("version")
    })

    it("should use expected table names in stream upsert SQL", () => {
      const sql = buildUpsertStreamSQL()
      expect(sql).toContain("_rb_es_streams")
      expect(sql).toContain("stream_id")
      expect(sql).toContain("version")
      expect(sql).toContain("ON CONFLICT")
    })

    it("should use expected table names in snapshot SQL", () => {
      const sql = buildSaveSnapshotSQL()
      expect(sql).toContain("_rb_es_snapshots")
      expect(sql).toContain("stream_id")
      expect(sql).toContain("version")
      expect(sql).toContain("state")
    })

    it("should pass correct params order for event insert", async () => {
      const { db, calls } = createMockDb()
      const store = new EventStore({ db })

      await store.append("s1", [{ type: "TestEvent", data: { key: "val" }, metadata: { userId: "u1" } }])

      const insertCall = calls[0]
      expect(typeof insertCall.params[0]).toBe("string") // id
      expect(insertCall.params[1]).toBe("s1") // streamId
      expect(insertCall.params[2]).toBe("TestEvent") // type
      expect(insertCall.params[3]).toEqual({ key: "val" }) // data
      expect(insertCall.params[4]).toEqual({ userId: "u1" }) // metadata
      expect(insertCall.params[5]).toBe(1) // version
    })
  })

  describe("DB error handling", () => {
    it("should succeed in-memory even if DB event insert fails", async () => {
      const { db } = createFailingDb()
      const store = new EventStore({ db })

      const result = await store.append("stream-1", [{ type: "EventA", data: { a: 1 } }])

      // In-memory append should still succeed
      expect(result.eventsWritten).toBe(1)
      expect(result.version).toBe(1)

      const events = store.getEvents("stream-1")
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("EventA")
    })

    it("should succeed in-memory even if DB stream upsert fails", async () => {
      const { db } = createFailingDb()
      const store = new EventStore({ db })

      const result = await store.append("stream-err", [
        { type: "E1", data: {} },
        { type: "E2", data: {} },
      ])

      expect(result.eventsWritten).toBe(2)

      const stream = store.getStream("stream-err")
      expect(stream).not.toBeNull()
      expect(stream!.version).toBe(2)
    })

    it("should succeed in-memory even if DB snapshot persist fails", async () => {
      const { db } = createFailingDb()
      const store = new EventStore({ db, snapshotInterval: 2 })

      const result = await store.append("snap-err", [
        { type: "E1", data: { x: 1 } },
        { type: "E2", data: { x: 2 } },
      ])

      expect(result.eventsWritten).toBe(2)

      // In-memory snapshot should still exist
      const snapshot = store.getLatestSnapshot("snap-err")
      expect(snapshot).not.toBeNull()
      expect(snapshot!.version).toBe(2)
    })

    it("should handle initTables failure gracefully when called", async () => {
      const { db } = createFailingDb()
      const store = new EventStore({ db })

      await expect(store.initTables()).rejects.toThrow("DB connection refused")
    })
  })
})
