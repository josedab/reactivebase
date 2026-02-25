import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { SQLiteCacheAdapter, generateCacheTableSQL } from "../offline/sqlite-cache.js"
import { ConflictResolver } from "../offline/conflict-resolver.js"
import { BackgroundSyncManager } from "../offline/background-sync.js"
import type { SQLiteAdapter } from "../offline/sqlite-cache.js"
import type { Conflict } from "../offline/conflict-resolver.js"
import type { SyncBatchResult } from "../offline/sync-engine.js"

// ─── In-Memory SQLite Adapter (for testing) ─────────────────────────────────

function createMemorySQLiteAdapter(): SQLiteAdapter {
  const tables = new Map<string, Map<string, Record<string, unknown>>>()
  let _initialized = false

  return {
    async run(sql: string, params: unknown[] = []) {
      const trimmed = sql.trim()

      if (trimmed.startsWith("CREATE TABLE")) {
        const match = trimmed.match(/CREATE TABLE IF NOT EXISTS (\w+)/)
        if (match && !tables.has(match[1])) {
          tables.set(match[1], new Map())
        }
        _initialized = true
        return
      }

      if (trimmed.startsWith("CREATE INDEX")) return

      // Find the table name from the SQL
      const tableName = findTableName(trimmed)
      const table = tables.get(tableName)
      if (!table) return

      if (trimmed.startsWith("INSERT OR REPLACE")) {
        const key = params[0] as string
        table.set(key, {
          key: params[0],
          value: params[1],
          created_at: params[2],
          accessed_at: params[3],
          expires_at: params[4],
          size_bytes: params[5],
        })
      } else if (trimmed.startsWith("DELETE")) {
        if (trimmed.includes("WHERE key IN")) {
          // LRU eviction
          const sorted = Array.from(table.entries()).sort(
            (a, b) => (a[1].accessed_at as number) - (b[1].accessed_at as number),
          )
          const limit = params[0] as number
          for (let i = 0; i < limit && i < sorted.length; i++) {
            table.delete(sorted[i][0])
          }
        } else if (trimmed.includes("expires_at IS NOT NULL")) {
          const now = params[0] as number
          for (const [key, row] of table) {
            if (row.expires_at !== null && (row.expires_at as number) <= now) {
              table.delete(key)
            }
          }
        } else if (trimmed.includes("WHERE key = ?")) {
          table.delete(params[0] as string)
        } else if (trimmed.match(/DELETE FROM \w+$/)) {
          table.clear()
        }
      } else if (trimmed.startsWith("UPDATE")) {
        const key = params[1] as string
        const row = table.get(key)
        if (row) {
          row.accessed_at = params[0]
        }
      }
    },

    async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
      const tableName = findTableName(sql)
      const table = tables.get(tableName)
      if (!table) return undefined

      if (sql.includes("COUNT(*)")) {
        return {
          cnt: table.size,
          entry_count: table.size,
          total_bytes: totalBytes(table),
          oldest: oldest(table),
          newest: newest(table),
        } as T
      }

      if (sql.includes("WHERE key = ?")) {
        return table.get(params[0] as string) as T | undefined
      }

      return undefined
    },

    async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const tableName = findTableName(sql)
      const table = tables.get(tableName)
      if (!table) return []

      if (sql.includes("WHERE key IN")) {
        const keys = params as string[]
        return keys.filter((k) => table.has(k)).map((k) => table.get(k) as T)
      }

      return Array.from(table.values()) as T[]
    },
  }

  function findTableName(sql: string): string {
    const match = sql.match(/(?:FROM|INTO|UPDATE|TABLE IF NOT EXISTS|TABLE) (\w+)/i)
    return match?.[1] ?? "rb_cache"
  }

  function totalBytes(table: Map<string, Record<string, unknown>>): number {
    let sum = 0
    for (const row of table.values()) sum += (row.size_bytes as number) || 0
    return sum
  }

  function oldest(table: Map<string, Record<string, unknown>>): number | null {
    let min: number | null = null
    for (const row of table.values()) {
      const t = row.created_at as number
      if (min === null || t < min) min = t
    }
    return min
  }

  function newest(table: Map<string, Record<string, unknown>>): number | null {
    let max: number | null = null
    for (const row of table.values()) {
      const t = row.created_at as number
      if (max === null || t > max) max = t
    }
    return max
  }
}

// ─── SQLiteCacheAdapter Tests ────────────────────────────────────────────────

describe("SQLiteCacheAdapter", () => {
  let adapter: SQLiteAdapter
  let cache: SQLiteCacheAdapter

  beforeEach(() => {
    adapter = createMemorySQLiteAdapter()
    cache = new SQLiteCacheAdapter({ adapter })
  })

  it("implements get/set/delete", async () => {
    await cache.set("key1", { value: 42 })
    expect(await cache.get("key1")).toEqual({ value: 42 })

    await cache.delete("key1")
    expect(await cache.get("key1")).toBeUndefined()
  })

  it("returns undefined for missing keys", async () => {
    expect(await cache.get("nonexistent")).toBeUndefined()
  })

  it("lists all keys", async () => {
    await cache.set("a", 1)
    await cache.set("b", 2)

    const keys = await cache.keys()
    expect(keys).toContain("a")
    expect(keys).toContain("b")
    expect(keys).toHaveLength(2)
  })

  it("clears all entries", async () => {
    await cache.set("a", 1)
    await cache.set("b", 2)
    await cache.clear()

    expect(await cache.keys()).toHaveLength(0)
  })

  it("supports batch getMany", async () => {
    await cache.set("x", 10)
    await cache.set("y", 20)
    await cache.set("z", 30)

    const result = await cache.getMany(["x", "z", "missing"])
    expect(result.size).toBe(2)
    expect(result.get("x")).toBe(10)
    expect(result.get("z")).toBe(30)
  })

  it("supports batch setMany", async () => {
    await cache.setMany([
      { key: "a", value: "alpha" },
      { key: "b", value: "beta" },
    ])

    expect(await cache.get("a")).toBe("alpha")
    expect(await cache.get("b")).toBe("beta")
  })

  it("returns cache metadata", async () => {
    await cache.set("key1", { data: "test" })
    await cache.set("key2", { data: "test2" })

    const meta = await cache.getMetadata()
    expect(meta.entryCount).toBe(2)
    expect(meta.totalBytes).toBeGreaterThan(0)
    expect(meta.oldestEntryAt).toBeTypeOf("number")
    expect(meta.newestEntryAt).toBeTypeOf("number")
  })

  it("returns empty metadata for empty cache", async () => {
    const meta = await cache.getMetadata()
    expect(meta.entryCount).toBe(0)
    expect(meta.totalBytes).toBe(0)
    expect(meta.oldestEntryAt).toBeNull()
    expect(meta.newestEntryAt).toBeNull()
  })

  it("enforces max entries via LRU eviction", async () => {
    const smallCache = new SQLiteCacheAdapter({ adapter, maxEntries: 3 })

    await smallCache.set("a", 1)
    await smallCache.set("b", 2)
    await smallCache.set("c", 3)

    // Adding a 4th entry should evict one entry (the least recently accessed)
    await smallCache.set("d", 4)

    const keys = await smallCache.keys()
    expect(keys).toHaveLength(3)
    expect(keys).toContain("d") // newly added must survive
  })
})

describe("generateCacheTableSQL", () => {
  it("generates SQL statements with default table name", () => {
    const sql = generateCacheTableSQL()
    expect(sql).toHaveLength(3)
    expect(sql[0]).toContain("CREATE TABLE")
    expect(sql[0]).toContain("rb_cache")
  })

  it("generates SQL with custom table name", () => {
    const sql = generateCacheTableSQL("my_cache")
    expect(sql[0]).toContain("my_cache")
  })
})

// ─── ConflictResolver Tests ─────────────────────────────────────────────────

describe("ConflictResolver", () => {
  it("resolves with last-write-wins (default)", () => {
    const resolver = new ConflictResolver()
    const conflict: Conflict = {
      localChange: { name: "local" },
      remoteChange: { name: "remote" },
      table: "users",
      rowId: "u1",
    }

    const result = resolver.resolve(conflict)
    expect(result.resolvedValue).toEqual({ name: "remote" })
    expect(result.strategy).toBe("last-write-wins")
  })

  it("resolves with server-wins", () => {
    const resolver = new ConflictResolver({ defaultStrategy: "server-wins" })
    const result = resolver.resolve({
      localChange: { name: "local" },
      remoteChange: { name: "server" },
      table: "users",
      rowId: "u1",
    })
    expect(result.resolvedValue).toEqual({ name: "server" })
  })

  it("resolves with client-wins", () => {
    const resolver = new ConflictResolver({ defaultStrategy: "client-wins" })
    const result = resolver.resolve({
      localChange: { name: "client" },
      remoteChange: { name: "server" },
      table: "users",
      rowId: "u1",
    })
    expect(result.resolvedValue).toEqual({ name: "client" })
  })

  it("resolves with field-merge (no base)", () => {
    const resolver = new ConflictResolver({ defaultStrategy: "field-merge" })
    const result = resolver.resolve({
      localChange: { name: "local", age: 30 },
      remoteChange: { name: "remote", email: "a@b.com" },
      table: "users",
      rowId: "u1",
    })
    // Client fields override server on conflict; both unique fields preserved
    expect(result.resolvedValue).toEqual({ name: "local", age: 30, email: "a@b.com" })
  })

  it("resolves with custom strategy", () => {
    const resolver = new ConflictResolver({
      defaultStrategy: "custom",
      customResolver: (c) => ({ merged: true, local: c.localChange, remote: c.remoteChange }),
    })
    const result = resolver.resolve({
      localChange: { a: 1 },
      remoteChange: { b: 2 },
      table: "data",
      rowId: "d1",
    })
    expect(result.resolvedValue).toEqual({
      merged: true,
      local: { a: 1 },
      remote: { b: 2 },
    })
  })

  it("supports per-table strategy overrides", () => {
    const resolver = new ConflictResolver({
      defaultStrategy: "last-write-wins",
      tableStrategies: { critical: "client-wins" },
    })

    const normalResult = resolver.resolve({
      localChange: { x: 1 },
      remoteChange: { x: 2 },
      table: "normal",
      rowId: "1",
    })
    expect(normalResult.resolvedValue).toEqual({ x: 2 }) // LWW = remote

    const criticalResult = resolver.resolve({
      localChange: { x: 1 },
      remoteChange: { x: 2 },
      table: "critical",
      rowId: "1",
    })
    expect(criticalResult.resolvedValue).toEqual({ x: 1 }) // client-wins
  })

  it("performs 3-way field merge with base version", () => {
    const resolver = new ConflictResolver()

    const result = resolver.fieldMerge(
      { name: "server-name", age: 25, email: "old@test.com" },
      { name: "original", age: 30, phone: "555-0000" },
      { name: "original", age: 25, email: "old@test.com" },
    )

    // name: server changed, client didn't → server wins
    expect(result.name).toBe("server-name")
    // age: client changed, server didn't → client wins
    expect(result.age).toBe(30)
    // email: neither changed → base kept
    expect(result.email).toBe("old@test.com")
    // phone: client added → client wins
    expect(result.phone).toBe("555-0000")
  })

  it("detects conflicts between local and remote changes", () => {
    const resolver = new ConflictResolver()
    const conflicts = resolver.detectConflicts(
      [
        { table: "users", rowId: "u1", fields: { name: "local" } },
        { table: "tasks", rowId: "t1", fields: { done: true } },
      ],
      [
        { table: "users", rowId: "u1", fields: { name: "remote" } },
        { table: "users", rowId: "u2", fields: { name: "no-conflict" } },
      ],
    )

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].table).toBe("users")
    expect(conflicts[0].rowId).toBe("u1")
  })

  it("maintains a conflict log", () => {
    const resolver = new ConflictResolver()
    resolver.resolve({
      localChange: { a: 1 },
      remoteChange: { a: 2 },
      table: "t",
      rowId: "1",
    })

    const log = resolver.getConflictLog()
    expect(log).toHaveLength(1)
    expect(log[0].strategy).toBe("last-write-wins")

    resolver.clearConflictLog()
    expect(resolver.getConflictLog()).toHaveLength(0)
  })

  it("falls back to last-write-wins when custom resolver is missing", () => {
    const resolver = new ConflictResolver({ defaultStrategy: "custom" })
    const result = resolver.resolve({
      localChange: { a: 1 },
      remoteChange: { a: 2 },
      table: "t",
      rowId: "1",
    })
    expect(result.resolvedValue).toEqual({ a: 2 })
  })
})

// ─── BackgroundSyncManager Tests ─────────────────────────────────────────────

describe("BackgroundSyncManager", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createSuccessResult(synced = 1): SyncBatchResult {
    return { synced, failed: 0, conflicts: [], durationMs: 10 }
  }

  function _createFailResult(): SyncBatchResult {
    return { synced: 0, failed: 1, conflicts: [], durationMs: 5 }
  }

  it("starts and stops the sync loop", async () => {
    const syncFn = vi.fn().mockResolvedValue(createSuccessResult())
    const manager = new BackgroundSyncManager({
      syncFn,
      getPendingCount: async () => 0,
      syncIntervalMs: 1000,
    })

    manager.start()
    expect(manager.isRunning).toBe(true)

    // First sync fires immediately (delay=0)
    await vi.advanceTimersByTimeAsync(0)
    expect(syncFn).toHaveBeenCalledTimes(1)

    manager.stop()
    expect(manager.isRunning).toBe(false)
  })

  it("triggers immediate sync with syncNow()", async () => {
    const syncFn = vi.fn().mockResolvedValue(createSuccessResult())
    const manager = new BackgroundSyncManager({
      syncFn,
      getPendingCount: async () => 0,
    })

    const result = await manager.syncNow()
    expect(result).toBeDefined()
    expect(result!.synced).toBe(1)
    expect(syncFn).toHaveBeenCalledTimes(1)
  })

  it("returns null from syncNow when offline", async () => {
    const syncFn = vi.fn().mockResolvedValue(createSuccessResult())
    const manager = new BackgroundSyncManager({
      syncFn,
      getPendingCount: async () => 0,
    })

    manager.onConnectivityChange(false)
    const result = await manager.syncNow()
    expect(result).toBeNull()
    expect(syncFn).not.toHaveBeenCalled()
  })

  it("reports sync status correctly", async () => {
    const syncFn = vi.fn().mockResolvedValue(createSuccessResult())
    const manager = new BackgroundSyncManager({
      syncFn,
      getPendingCount: async () => 3,
    })

    const status = manager.getSyncStatus()
    expect(status.state).toBe("idle")
    expect(status.pendingCount).toBe(0)
    expect(status.lastSyncAt).toBeNull()
    expect(status.consecutiveFailures).toBe(0)
  })

  it("updates status after successful sync", async () => {
    const syncFn = vi.fn().mockResolvedValue(createSuccessResult())
    const manager = new BackgroundSyncManager({
      syncFn,
      getPendingCount: async () => 0,
    })

    await manager.syncNow()
    const status = manager.getSyncStatus()
    expect(status.state).toBe("idle")
    expect(status.lastSyncAt).toBeTypeOf("number")
    expect(status.consecutiveFailures).toBe(0)
  })

  it("tracks consecutive failures", async () => {
    const syncFn = vi.fn().mockRejectedValue(new Error("Network error"))
    const manager = new BackgroundSyncManager({
      syncFn,
      getPendingCount: async () => 5,
    })

    await manager.syncNow()
    expect(manager.getSyncStatus().consecutiveFailures).toBe(1)
    expect(manager.getSyncStatus().state).toBe("error")

    await manager.syncNow()
    expect(manager.getSyncStatus().consecutiveFailures).toBe(2)
  })

  it("applies exponential backoff on failures", async () => {
    const syncFn = vi.fn().mockRejectedValue(new Error("fail"))
    const manager = new BackgroundSyncManager({
      syncFn,
      getPendingCount: async () => 1,
      initialBackoffMs: 1000,
      maxBackoffMs: 60000,
      syncIntervalMs: 5000,
    })

    manager.start()

    // First sync fires immediately
    await vi.advanceTimersByTimeAsync(0)
    expect(syncFn).toHaveBeenCalledTimes(1)

    // After 1st failure: backoff = 1000ms * 2^0 = 1000ms
    await vi.advanceTimersByTimeAsync(1000)
    expect(syncFn).toHaveBeenCalledTimes(2)

    // After 2nd failure: backoff = 1000ms * 2^1 = 2000ms
    await vi.advanceTimersByTimeAsync(2000)
    expect(syncFn).toHaveBeenCalledTimes(3)

    manager.stop()
  })

  it("reacts to connectivity changes", async () => {
    const syncFn = vi.fn().mockResolvedValue(createSuccessResult())
    const manager = new BackgroundSyncManager({
      syncFn,
      getPendingCount: async () => 0,
    })

    manager.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(syncFn).toHaveBeenCalledTimes(1)

    // Go offline
    manager.onConnectivityChange(false)
    expect(manager.getSyncStatus().state).toBe("offline")

    // Go back online — triggers immediate sync
    manager.onConnectivityChange(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(syncFn).toHaveBeenCalledTimes(2)

    manager.stop()
  })

  it("invokes onSyncComplete callbacks", async () => {
    const syncFn = vi.fn().mockResolvedValue(createSuccessResult(5))
    const manager = new BackgroundSyncManager({
      syncFn,
      getPendingCount: async () => 0,
    })

    const results: SyncBatchResult[] = []
    manager.onSyncComplete((r) => results.push(r))

    await manager.syncNow()
    expect(results).toHaveLength(1)
    expect(results[0].synced).toBe(5)
  })

  it("invokes onConflict callbacks when conflicts occur", async () => {
    const resultWithConflicts: SyncBatchResult = {
      synced: 1,
      failed: 1,
      conflicts: [
        {
          mutationId: "m1",
          mutationName: "test",
          clientArgs: {},
          serverState: {},
          resolution: "server-wins",
        },
      ],
      durationMs: 10,
    }
    const syncFn = vi.fn().mockResolvedValue(resultWithConflicts)
    const manager = new BackgroundSyncManager({
      syncFn,
      getPendingCount: async () => 0,
    })

    const conflictResults: unknown[] = []
    manager.onConflict((c) => conflictResults.push(c))

    await manager.syncNow()
    expect(conflictResults).toHaveLength(1)
  })

  it("supports callback unsubscription", async () => {
    const syncFn = vi.fn().mockResolvedValue(createSuccessResult())
    const manager = new BackgroundSyncManager({
      syncFn,
      getPendingCount: async () => 0,
    })

    const results: SyncBatchResult[] = []
    const unsub = manager.onSyncComplete((r) => results.push(r))

    await manager.syncNow()
    expect(results).toHaveLength(1)

    unsub()
    await manager.syncNow()
    expect(results).toHaveLength(1) // no new callback
  })

  it("manages priority queue", () => {
    const manager = new BackgroundSyncManager({
      syncFn: async () => createSuccessResult(),
      getPendingCount: async () => 0,
    })

    manager.enqueuePriority({
      id: "m1",
      mutationName: "low-priority",
      args: {},
      priority: "low",
      timestamp: 100,
    })
    manager.enqueuePriority({
      id: "m2",
      mutationName: "critical-op",
      args: {},
      priority: "critical",
      timestamp: 200,
    })
    manager.enqueuePriority({
      id: "m3",
      mutationName: "normal-op",
      args: {},
      priority: "normal",
      timestamp: 50,
    })

    const queue = manager.getPriorityQueue()
    expect(queue[0].priority).toBe("critical")
    expect(queue[1].priority).toBe("normal")
    expect(queue[2].priority).toBe("low")

    manager.clearPriorityQueue()
    expect(manager.getPriorityQueue()).toHaveLength(0)
  })

  it("returns connectivity state", () => {
    const manager = new BackgroundSyncManager({
      syncFn: async () => createSuccessResult(),
      getPendingCount: async () => 0,
    })

    const state = manager.getConnectivityState()
    expect(state.isOnline).toBe(true)
    expect(state.pendingChangesCount).toBe(0)

    manager.onConnectivityChange(false)
    expect(manager.getConnectivityState().isOnline).toBe(false)
  })

  it("does not start sync loop when offline", () => {
    const syncFn = vi.fn().mockResolvedValue(createSuccessResult())
    const manager = new BackgroundSyncManager({
      syncFn,
      getPendingCount: async () => 0,
    })

    manager.onConnectivityChange(false)
    manager.start()

    expect(manager.isRunning).toBe(true)
    expect(manager.getSyncStatus().state).toBe("offline")
  })
})
