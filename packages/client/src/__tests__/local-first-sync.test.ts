import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  WriteAheadLog,
  BidirectionalSyncProtocol,
  LocalFirstSyncEngine,
  type WriteAheadEntry,
  type SchemaDefinition,
  type SyncProtocolMessage,
} from "../offline/local-first-sync.js"
import {
  createVectorClock,
  incrementClock,
  mergeClock,
  happensBefore,
  areConcurrent,
  type VectorClock,
} from "../offline/sync-engine.js"
import type { SQLiteAdapter } from "../offline/sqlite-cache.js"

// ── Mock SQLite Adapter ───────────────────────────────────────────────────────

function createMockAdapter(): SQLiteAdapter {
  const tables = new Map<string, Record<string, unknown>[]>()
  const _schema = new Map<string, string>()

  return {
    async run(sql: string, params?: unknown[]): Promise<void> {
      const trimmed = sql.trim()
      const upper = trimmed.toUpperCase()
      if (upper.includes("CREATE TABLE")) {
        const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i) ?? sql.match(/CREATE TABLE (\w+)/i)
        if (match) tables.set(match[1], [])
        return
      }
      if (upper.includes("CREATE") && upper.includes("INDEX")) return

      if (upper.includes("INSERT")) {
        const match = sql.match(/INTO\s+(\w+)/i) ?? sql.match(/INTO\s+"(\w+)"/i)
        if (match) {
          const tableName = match[1]
          if (!tables.has(tableName)) tables.set(tableName, [])
          const rows = tables.get(tableName)!

          // For WAL table: parse params
          if (params && params.length >= 7) {
            const row: Record<string, unknown> = {
              id: params[0],
              tbl: params[1],
              operation: params[2],
              data: params[3],
              timestamp: params[4],
              vector_clock: params[5],
              synced: params[6],
            }
            // INSERT OR REPLACE behavior
            const idx = rows.findIndex((r) => r.id === row.id)
            if (idx >= 0) rows[idx] = row
            else rows.push(row)
          } else if (params) {
            // Generic insert from applyLocalMutation
            const colMatch = sql.match(/\(([^)]+)\)\s+VALUES/i)
            if (colMatch) {
              const cols = colMatch[1].split(",").map((c) => c.trim().replace(/"/g, ""))
              const row: Record<string, unknown> = {}
              cols.forEach((col, i) => {
                row[col] = params[i]
              })
              const pk = cols[0]
              const idx = rows.findIndex((r) => r[pk] === row[pk])
              if (idx >= 0) rows[idx] = { ...rows[idx], ...row }
              else rows.push(row)
            }
          }
        }
        return
      }

      if (upper.includes("UPDATE")) {
        const match = sql.match(/UPDATE\s+(\w+)/i)
        if (match) {
          const tableName = match[1]
          const rows = tables.get(tableName)
          if (rows && params) {
            // WAL markSynced: UPDATE rb_wal SET synced = 1 WHERE id IN (...)
            if (upper.includes("SYNCED = 1")) {
              for (const row of rows) {
                if ((params as unknown[]).includes(row.id)) row.synced = 1
              }
            } else {
              // Generic UPDATE from applyLocalMutation
              const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/is)
              const whereMatch = sql.match(/WHERE\s+(.+)$/is)
              if (setMatch && whereMatch && params) {
                const setCols = setMatch[1].split(",").map((s) => s.split("=")[0].trim().replace(/"/g, ""))
                const whereCols = whereMatch[1].split(/\s+AND\s+/i).map((s) => s.split("=")[0].trim().replace(/"/g, ""))
                const setParams = params.slice(0, setCols.length)
                const whereParams = params.slice(setCols.length)
                for (const row of rows) {
                  const matches = whereCols.every((col, i) => row[col] === whereParams[i])
                  if (matches) {
                    setCols.forEach((col, i) => {
                      row[col] = setParams[i]
                    })
                  }
                }
              }
            }
          }
        }
        return
      }

      if (upper.includes("DELETE")) {
        const match = sql.match(/FROM\s+(\w+)/i) ?? sql.match(/FROM\s+"(\w+)"/i)
        if (match) {
          const tableName = match[1]
          const rows = tables.get(tableName)
          if (rows) {
            if (upper.includes("SYNCED = 1") || upper.includes("synced = 1")) {
              tables.set(
                tableName,
                rows.filter((r) => r.synced !== 1),
              )
            } else if (upper.includes("WHERE") && params && upper.includes("ID IN")) {
              // Compact: delete oldest by limit
              const limit = params[0] as number
              if (limit && typeof limit === "number") {
                const sorted = [...rows].sort((a, b) => (a.timestamp as number) - (b.timestamp as number))
                const idsToRemove = new Set(sorted.slice(0, limit).map((r) => r.id))
                tables.set(
                  tableName,
                  rows.filter((r) => !idsToRemove.has(r.id as string)),
                )
              }
            } else if (upper.includes("WHERE") && params) {
              // Generic DELETE from applyLocalMutation
              const whereMatch = sql.match(/WHERE\s+(.+)$/i)
              if (whereMatch) {
                const whereCols = whereMatch[1].split(/\s+AND\s+/i).map((s) => s.split("=")[0].trim().replace(/"/g, ""))
                tables.set(
                  tableName,
                  rows.filter((row) => !whereCols.every((col, i) => row[col] === params[i])),
                )
              }
            }
          }
        }
        return
      }
    },

    async get<T = unknown>(sql: string, _params?: unknown[]): Promise<T | undefined> {
      const match = sql.match(/FROM\s+(\w+)/i)
      if (match) {
        const rows = tables.get(match[1]) ?? []
        if (sql.toUpperCase().includes("COUNT(*)")) {
          return { cnt: rows.length } as T
        }
        return rows[0] as T | undefined
      }
      return undefined
    },

    async all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
      const match = sql.match(/FROM\s+(\w+)/i) ?? sql.match(/FROM\s+"(\w+)"/i)
      if (match) {
        const tableName = match[1].replace(/"/g, "")
        let rows = [...(tables.get(tableName) ?? [])]
        const upper = sql.toUpperCase()

        // Apply WHERE filtering - handle both parameterized and hardcoded values
        if (upper.includes("WHERE")) {
          if (upper.includes("SYNCED = 0")) {
            rows = rows.filter((r) => r.synced === 0)
          } else if (params) {
            // Generic where clause for getLocalData
            const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|\s*$)/i)
            if (whereMatch) {
              const conditions = whereMatch[1].split(/\s+AND\s+/i).map((s) => s.trim())
              let paramIdx = 0
              for (const cond of conditions) {
                const colMatch = cond.match(/"?(\w+)"?\s*=\s*\?/)
                if (colMatch && params[paramIdx] !== undefined) {
                  const col = colMatch[1]
                  const val = params[paramIdx]
                  rows = rows.filter((r) => r[col] === val)
                  paramIdx++
                }
              }
            }
          }
        }

        // Apply ORDER BY
        if (sql.toUpperCase().includes("ORDER BY")) {
          const orderMatch = sql.match(/ORDER BY\s+"?(\w+)"?\s+(ASC|DESC)?/i)
          if (orderMatch) {
            const col = orderMatch[1]
            const dir = (orderMatch[2] ?? "ASC").toUpperCase()
            rows.sort((a, b) => {
              const av = a[col] as number
              const bv = b[col] as number
              return dir === "ASC" ? av - bv : bv - av
            })
          }
        }

        // Apply LIMIT
        if (sql.toUpperCase().includes("LIMIT") && params) {
          // Find the LIMIT param
          const sqlParts = sql.split("?")
          let limitParamIdx = -1
          for (let i = 0; i < sqlParts.length - 1; i++) {
            if (
              sqlParts
                .slice(0, i + 1)
                .join("?")
                .toUpperCase()
                .includes("LIMIT")
            ) {
              limitParamIdx = i
              break
            }
          }
          if (limitParamIdx >= 0 && typeof params[limitParamIdx] === "number") {
            rows = rows.slice(0, params[limitParamIdx] as number)
          }
        }

        return rows as T[]
      }
      return []
    },
  }
}

// ── WriteAheadLog ─────────────────────────────────────────────────────────────

describe("WriteAheadLog", () => {
  let adapter: SQLiteAdapter
  let wal: WriteAheadLog

  beforeEach(() => {
    adapter = createMockAdapter()
    wal = new WriteAheadLog(adapter, "rb_", 5)
  })

  function makeEntry(id: string, synced = false): WriteAheadEntry {
    return {
      id,
      table: "tasks",
      operation: "insert",
      data: { id: "row1", title: "Test" },
      timestamp: Date.now(),
      vectorClock: { client1: 1 },
      synced,
    }
  }

  it("initializes and appends entries", async () => {
    await wal.initialize()
    await wal.append(makeEntry("w1"))
    const size = await wal.size()
    expect(size).toBe(1)
  })

  it("getUnsynced returns only unsynced entries", async () => {
    await wal.initialize()
    await wal.append(makeEntry("w1", false))
    // Append a synced entry (synced=true → stored as 1)
    const syncedEntry = makeEntry("w2", false)
    await wal.append(syncedEntry)
    await wal.markSynced(["w2"])
    const unsynced = await wal.getUnsynced()
    expect(unsynced).toHaveLength(1)
    expect(unsynced[0].id).toBe("w1")
    expect(unsynced[0].synced).toBe(false)
  })

  it("markSynced updates entries", async () => {
    await wal.initialize()
    await wal.append(makeEntry("w1"))
    const before = await wal.getUnsynced()
    expect(before).toHaveLength(1)
    await wal.markSynced(["w1"])
    // Verify WAL size is still 1 (entry not removed, just marked)
    const size = await wal.size()
    expect(size).toBe(1)
    const unsynced = await wal.getUnsynced()
    expect(unsynced).toHaveLength(0)
  })

  it("markSynced with empty array is a no-op", async () => {
    await wal.initialize()
    await wal.append(makeEntry("w1"))
    await wal.markSynced([])
    const unsynced = await wal.getUnsynced()
    expect(unsynced).toHaveLength(1)
  })

  it("compact removes synced entries", async () => {
    await wal.initialize()
    await wal.append(makeEntry("w1", true))
    await wal.append(makeEntry("w2", false))

    // Manually mark as synced in the mock
    await wal.markSynced(["w1"])
    await wal.compact()

    const size = await wal.size()
    expect(size).toBe(1)
  })

  it("does not re-initialize", async () => {
    const spy = vi.spyOn(adapter, "run")
    await wal.initialize()
    await wal.initialize()
    // Should only call CREATE TABLE once (+ index)
    const createCalls = spy.mock.calls.filter((c) => (c[0] as string).toUpperCase().includes("CREATE TABLE"))
    expect(createCalls.length).toBe(1)
  })

  it("auto-initializes on append if not initialized", async () => {
    await wal.append(makeEntry("w1"))
    const size = await wal.size()
    expect(size).toBe(1)
  })
})

// ── BidirectionalSyncProtocol ─────────────────────────────────────────────────

describe("BidirectionalSyncProtocol", () => {
  it("creates a sync request with client state vector", () => {
    const protocol = new BidirectionalSyncProtocol("client-1")
    const clock: VectorClock = { "client-1": 5 }
    const request = protocol.createSyncRequest(clock)
    expect(request.type).toBe("sync-request")
    expect(request.clientId).toBe("client-1")
    expect(request.stateVector).toEqual(clock)
  })

  it("applySyncResponse returns changes when hasMore is false", () => {
    const protocol = new BidirectionalSyncProtocol("client-1")
    const response: SyncProtocolMessage = {
      type: "sync-response",
      clientId: "server",
      stateVector: { "client-1": 3 },
      changes: [
        {
          table: "tasks",
          operation: "insert",
          data: { id: "1" },
          vectorClock: { server: 1 },
          clientId: "server",
          timestamp: Date.now(),
        },
      ],
      hasMore: false,
      batchIndex: 0,
    }
    const changes = protocol.applySyncResponse(response)
    expect(changes).toHaveLength(1)
    expect(changes[0].table).toBe("tasks")
  })

  it("applySyncResponse buffers changes when hasMore is true", () => {
    const protocol = new BidirectionalSyncProtocol("client-1")
    const batch1: SyncProtocolMessage = {
      type: "sync-response",
      clientId: "server",
      stateVector: {},
      changes: [{ table: "t", operation: "insert", data: { id: "1" }, vectorClock: {}, clientId: "s", timestamp: 1 }],
      hasMore: true,
      batchIndex: 0,
    }
    expect(protocol.applySyncResponse(batch1)).toHaveLength(0)

    const batch2: SyncProtocolMessage = {
      type: "sync-response",
      clientId: "server",
      stateVector: {},
      changes: [{ table: "t", operation: "insert", data: { id: "2" }, vectorClock: {}, clientId: "s", timestamp: 2 }],
      hasMore: false,
      batchIndex: 1,
    }
    const all = protocol.applySyncResponse(batch2)
    expect(all).toHaveLength(2)
  })

  it("applySyncResponse ignores non-sync-response messages", () => {
    const protocol = new BidirectionalSyncProtocol("client-1")
    const msg: SyncProtocolMessage = { type: "ack", clientId: "server", stateVector: {} }
    expect(protocol.applySyncResponse(msg)).toHaveLength(0)
  })

  it("createSyncResponse splits into batches", () => {
    const protocol = new BidirectionalSyncProtocol("client-1")
    protocol.setBandwidthLimit(200) // yields batchSize=1
    const changes = [
      { table: "t", operation: "insert" as const, data: {}, vectorClock: { s: 2 }, clientId: "s", timestamp: 1 },
      { table: "t", operation: "insert" as const, data: {}, vectorClock: { s: 3 }, clientId: "s", timestamp: 2 },
    ]
    const batches = protocol.createSyncResponse({ s: 0 }, changes)
    expect(batches.length).toBe(2)
    expect(batches[0].hasMore).toBe(true)
    expect(batches[1].hasMore).toBe(false)
  })

  it("createSyncResponse returns empty response when no missing changes", () => {
    const protocol = new BidirectionalSyncProtocol("client-1")
    const serverData = [
      { table: "t", operation: "insert" as const, data: {}, vectorClock: { s: 1 }, clientId: "s", timestamp: 1 },
    ]
    // Client already has version {s: 2}, so {s:1} happens-before
    const batches = protocol.createSyncResponse({ s: 2 }, serverData)
    expect(batches).toHaveLength(1)
    expect(batches[0].changes).toHaveLength(0)
  })

  it("compareStateVectors detects ahead/behind/diverged/equal", () => {
    const protocol = new BidirectionalSyncProtocol("c1")
    expect(protocol.compareStateVectors({ c1: 3 }, { c1: 1 })).toBe("ahead")
    expect(protocol.compareStateVectors({ c1: 1 }, { c1: 3 })).toBe("behind")
    expect(protocol.compareStateVectors({ c1: 2 }, { c2: 2 })).toBe("diverged")
    expect(protocol.compareStateVectors({ c1: 1 }, { c1: 1 })).toBe("equal")
  })

  it("setBandwidthLimit adjusts batch size", () => {
    const protocol = new BidirectionalSyncProtocol("c1")
    protocol.setBandwidthLimit(10000)
    expect(protocol.bandwidth.batchSize).toBe(50) // 10000/200
    expect(protocol.bandwidth.bytesPerSecond).toBe(10000)
  })
})

// ── LocalFirstSyncEngine ──────────────────────────────────────────────────────

describe("LocalFirstSyncEngine", () => {
  let adapter: SQLiteAdapter
  let engine: LocalFirstSyncEngine

  const schema: SchemaDefinition = {
    tables: [
      {
        name: "tasks",
        columns: [
          { name: "id", type: "TEXT", nullable: false },
          { name: "title", type: "TEXT" },
          { name: "done", type: "INTEGER" },
        ],
        primaryKey: ["id"],
      },
    ],
  }

  beforeEach(() => {
    adapter = createMockAdapter()
    engine = new LocalFirstSyncEngine({
      clientId: "client-1",
      adapter,
      maxWalEntries: 5,
    })
  })

  it("syncSchema creates tables and initializes WAL", async () => {
    const spy = vi.spyOn(adapter, "run")
    await engine.syncSchema(schema)
    const calls = spy.mock.calls.map((c) => c[0] as string)
    expect(calls.some((sql) => sql.includes("CREATE TABLE") && sql.includes("tasks"))).toBe(true)
  })

  it("applyLocalMutation inserts data locally and appends to WAL", async () => {
    await engine.syncSchema(schema)
    const walId = await engine.applyLocalMutation("tasks", "insert", {
      id: "t1",
      title: "Buy milk",
      done: 0,
    })
    expect(walId).toBeTruthy()

    const data = await engine.getLocalData("tasks")
    expect(data).toHaveLength(1)
    expect((data[0] as Record<string, unknown>).title).toBe("Buy milk")
  })

  it("applyLocalMutation update modifies existing data", async () => {
    await engine.syncSchema(schema)
    await engine.applyLocalMutation("tasks", "insert", { id: "t1", title: "Old", done: 0 })
    await engine.applyLocalMutation("tasks", "update", { id: "t1", title: "New" })

    const data = await engine.getLocalData("tasks")
    expect((data[0] as Record<string, unknown>).title).toBe("New")
  })

  it("applyLocalMutation delete removes data", async () => {
    await engine.syncSchema(schema)
    await engine.applyLocalMutation("tasks", "insert", { id: "t1", title: "Test", done: 0 })
    await engine.applyLocalMutation("tasks", "delete", { id: "t1" })

    const data = await engine.getLocalData("tasks")
    expect(data).toHaveLength(0)
  })

  it("getLocalData supports where filtering", async () => {
    await engine.syncSchema(schema)
    await engine.applyLocalMutation("tasks", "insert", { id: "t1", title: "A", done: 0 })
    await engine.applyLocalMutation("tasks", "insert", { id: "t2", title: "B", done: 1 })

    const data = await engine.getLocalData("tasks", { where: { done: 0 } })
    expect(data).toHaveLength(1)
    expect((data[0] as Record<string, unknown>).id).toBe("t1")
  })

  it("increments vector clock on each mutation", async () => {
    await engine.syncSchema(schema)
    const clockBefore = engine.vectorClock
    await engine.applyLocalMutation("tasks", "insert", { id: "t1", title: "A", done: 0 })
    const clockAfter = engine.vectorClock
    expect(clockAfter["client-1"]).toBeGreaterThan(clockBefore["client-1"] ?? 0)
  })

  it("receiveClock merges remote clock", () => {
    const remote: VectorClock = { "client-2": 5 }
    engine.receiveClock(remote)
    const clock = engine.vectorClock
    expect(clock["client-2"]).toBe(5)
    expect(clock["client-1"]).toBeGreaterThan(0)
  })

  it("exposes status and clientId", () => {
    expect(engine.status).toBe("idle")
    expect(engine.clientId).toBe("client-1")
  })

  it("writeAheadLog is accessible", () => {
    expect(engine.writeAheadLog).toBeInstanceOf(WriteAheadLog)
  })

  it("syncProtocol is accessible", () => {
    expect(engine.syncProtocol).toBeInstanceOf(BidirectionalSyncProtocol)
  })
})

// ── Vector Clock Functions ────────────────────────────────────────────────────

describe("vector clock utilities", () => {
  it("createVectorClock initializes with 0", () => {
    const clock = createVectorClock("c1")
    expect(clock).toEqual({ c1: 0 })
  })

  it("incrementClock increments for given client", () => {
    const clock = incrementClock({ c1: 0 }, "c1")
    expect(clock.c1).toBe(1)
  })

  it("mergeClock takes max of each entry", () => {
    const a: VectorClock = { c1: 3, c2: 1 }
    const b: VectorClock = { c1: 1, c2: 5, c3: 2 }
    const merged = mergeClock(a, b)
    expect(merged).toEqual({ c1: 3, c2: 5, c3: 2 })
  })

  it("happensBefore detects causal ordering", () => {
    expect(happensBefore({ c1: 1 }, { c1: 2 })).toBe(true)
    expect(happensBefore({ c1: 2 }, { c1: 1 })).toBe(false)
    expect(happensBefore({ c1: 1 }, { c1: 1 })).toBe(false)
  })

  it("areConcurrent detects concurrent clocks", () => {
    expect(areConcurrent({ c1: 2, c2: 0 }, { c1: 0, c2: 2 })).toBe(true)
    expect(areConcurrent({ c1: 1 }, { c1: 2 })).toBe(false)
  })
})
