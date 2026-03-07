import { describe, it, expect, vi } from "vitest"
import { SQLiteCacheAdapter, generateCacheTableSQL } from "../offline/sqlite-cache.js"
import type { SQLiteAdapter } from "../offline/sqlite-cache.js"

// ─── Mock SQLite Adapter ─────────────────────────────────────────────────────

function createMockAdapter(): SQLiteAdapter & {
  _store: Map<string, Record<string, unknown>>
  run: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  all: ReturnType<typeof vi.fn>
} {
  const store = new Map<string, Record<string, unknown>>()

  return {
    _store: store,
    run: vi.fn(async (_sql: string, _params?: unknown[]) => {}),
    get: vi.fn(async (_sql: string, _params?: unknown[]) => undefined),
    all: vi.fn(async (_sql: string, _params?: unknown[]) => []),
  }
}

// In-memory functional mock for round-trip tests
function createInMemoryAdapter(): SQLiteAdapter {
  const rows = new Map<string, { key: string; value: string; created_at: number; accessed_at: number; expires_at: number | null; size_bytes: number }>()

  return {
    async run(sql: string, params?: unknown[]) {
      if (sql.startsWith("CREATE")) return
      if (sql.startsWith("INSERT OR REPLACE")) {
        const [key, value, created_at, accessed_at, expires_at, size_bytes] = params as [string, string, number, number, number | null, number]
        rows.set(key, { key, value, created_at, accessed_at, expires_at, size_bytes })
        return
      }
      if (sql.startsWith("DELETE") && sql.includes("WHERE key = ?")) {
        rows.delete(params![0] as string)
        return
      }
      if (sql.startsWith("DELETE") && sql.includes("WHERE key IN")) {
        // LRU eviction: parse the subquery
        const limit = params![0] as number
        const sorted = [...rows.values()].sort((a, b) => a.accessed_at - b.accessed_at)
        for (let i = 0; i < limit && i < sorted.length; i++) {
          rows.delete(sorted[i].key)
        }
        return
      }
      if (sql.startsWith("DELETE") && sql.includes("expires_at")) {
        const now = params![0] as number
        for (const [key, row] of rows) {
          if (row.expires_at !== null && row.expires_at <= now) rows.delete(key)
        }
        return
      }
      if (sql.startsWith("DELETE") && !sql.includes("WHERE")) {
        rows.clear()
        return
      }
      if (sql.startsWith("UPDATE") && sql.includes("accessed_at")) {
        const [accessed_at, key] = params as [number, string]
        const row = rows.get(key)
        if (row) row.accessed_at = accessed_at
        return
      }
    },
    async get<T>(sql: string, params?: unknown[]): Promise<T | undefined> {
      if (sql.includes("SELECT key, value") && sql.includes("WHERE key = ?")) {
        const row = rows.get(params![0] as string)
        return row ? ({ key: row.key, value: row.value } as T) : undefined
      }
      if (sql.includes("SUM(size_bytes)")) {
        let totalBytes = 0
        let oldest: number | null = null
        let newest: number | null = null
        for (const row of rows.values()) {
          totalBytes += row.size_bytes
          if (oldest === null || row.created_at < oldest) oldest = row.created_at
          if (newest === null || row.created_at > newest) newest = row.created_at
        }
        return { entry_count: rows.size, total_bytes: totalBytes, oldest, newest } as T
      }
      if (sql.includes("COUNT(*)")) {
        return { cnt: rows.size } as T
      }
      return undefined
    },
    async all<T>(sql: string, params?: unknown[]): Promise<T[]> {
      if (sql.includes("WHERE key IN")) {
        const keys = params as string[]
        return keys
          .filter((k) => rows.has(k))
          .map((k) => {
            const row = rows.get(k)!
            return { key: row.key, value: row.value } as T
          })
      }
      if (sql.includes("SELECT key FROM")) {
        return [...rows.values()].map((r) => ({ key: r.key }) as T)
      }
      return []
    },
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("generateCacheTableSQL()", () => {
  it("returns CREATE TABLE and index statements", () => {
    const statements = generateCacheTableSQL()
    expect(statements).toHaveLength(3)
    expect(statements[0]).toContain("CREATE TABLE IF NOT EXISTS rb_cache")
    expect(statements[1]).toContain("CREATE INDEX IF NOT EXISTS idx_rb_cache_accessed_at")
    expect(statements[2]).toContain("CREATE INDEX IF NOT EXISTS idx_rb_cache_expires_at")
  })

  it("uses custom table name", () => {
    const statements = generateCacheTableSQL("my_cache")
    expect(statements[0]).toContain("my_cache")
    expect(statements[1]).toContain("idx_my_cache_accessed_at")
  })
})

describe("SQLiteCacheAdapter", () => {
  describe("constructor", () => {
    it("accepts valid table name", () => {
      const adapter = createMockAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      expect(cache).toBeInstanceOf(SQLiteCacheAdapter)
    })

    it("rejects invalid table name", () => {
      const adapter = createMockAdapter()
      expect(() => new SQLiteCacheAdapter({ adapter, tableName: "drop; --" })).toThrow("Invalid tableName")
    })

    it("accepts custom options", () => {
      const adapter = createMockAdapter()
      const cache = new SQLiteCacheAdapter({ adapter, tableName: "custom_cache", maxEntries: 100, defaultTTLMs: 5000 })
      expect(cache).toBeInstanceOf(SQLiteCacheAdapter)
    })
  })

  describe("table initialization", () => {
    it("creates table on first operation", async () => {
      const adapter = createMockAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      await cache.set("key", "value")
      // Should have run CREATE TABLE + 2 indexes
      const createCalls = adapter.run.mock.calls.filter((c: unknown[]) => (c[0] as string).includes("CREATE"))
      expect(createCalls).toHaveLength(3)
    })

    it("only initializes once", async () => {
      const adapter = createMockAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      await cache.set("key1", "v1")
      await cache.set("key2", "v2")
      const createCalls = adapter.run.mock.calls.filter((c: unknown[]) => (c[0] as string).includes("CREATE"))
      expect(createCalls).toHaveLength(3) // still just 3
    })
  })

  describe("set/get round-trip with serialization", () => {
    it("stores and retrieves string values", async () => {
      const adapter = createInMemoryAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      await cache.set("key", "hello")
      const result = await cache.get("key")
      expect(result).toBe("hello")
    })

    it("stores and retrieves object values via JSON serialization", async () => {
      const adapter = createInMemoryAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      const obj = { name: "test", count: 42, nested: { a: 1 } }
      await cache.set("obj", obj)
      const result = await cache.get("obj")
      expect(result).toEqual(obj)
    })

    it("stores and retrieves array values", async () => {
      const adapter = createInMemoryAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      await cache.set("arr", [1, 2, 3])
      expect(await cache.get("arr")).toEqual([1, 2, 3])
    })

    it("returns undefined for missing keys", async () => {
      const adapter = createInMemoryAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      const result = await cache.get("missing")
      expect(result).toBeUndefined()
    })

    it("overwrites existing keys", async () => {
      const adapter = createInMemoryAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      await cache.set("key", "first")
      await cache.set("key", "second")
      expect(await cache.get("key")).toBe("second")
    })
  })

  describe("TTL expiry", () => {
    it("expires entries after TTL", async () => {
      vi.useFakeTimers()
      try {
        const adapter = createInMemoryAdapter()
        const cache = new SQLiteCacheAdapter({ adapter, defaultTTLMs: 1000 })
        await cache.set("key", "value")
        vi.advanceTimersByTime(1500)
        const result = await cache.get("key")
        expect(result).toBeUndefined()
      } finally {
        vi.useRealTimers()
      }
    })

    it("does not expire when TTL is 0", async () => {
      vi.useFakeTimers()
      try {
        const adapter = createInMemoryAdapter()
        const cache = new SQLiteCacheAdapter({ adapter, defaultTTLMs: 0 })
        await cache.set("key", "value")
        vi.advanceTimersByTime(100_000)
        const result = await cache.get("key")
        expect(result).toBe("value")
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe("delete and clear", () => {
    it("deletes a single key", async () => {
      const adapter = createInMemoryAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      await cache.set("key", "value")
      await cache.delete("key")
      expect(await cache.get("key")).toBeUndefined()
    })

    it("clears all entries", async () => {
      const adapter = createInMemoryAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      await cache.set("a", 1)
      await cache.set("b", 2)
      await cache.clear()
      expect(await cache.get("a")).toBeUndefined()
      expect(await cache.get("b")).toBeUndefined()
    })
  })

  describe("keys()", () => {
    it("returns all keys", async () => {
      const adapter = createInMemoryAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      await cache.set("a", 1)
      await cache.set("b", 2)
      const keys = await cache.keys()
      expect(keys).toContain("a")
      expect(keys).toContain("b")
      expect(keys).toHaveLength(2)
    })

    it("returns empty for empty cache", async () => {
      const adapter = createInMemoryAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      expect(await cache.keys()).toEqual([])
    })
  })

  describe("batch operations", () => {
    it("getMany returns matching entries", async () => {
      const adapter = createInMemoryAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      await cache.set("a", 1)
      await cache.set("b", 2)
      await cache.set("c", 3)
      const result = await cache.getMany(["a", "c", "missing"])
      expect(result.get("a")).toBe(1)
      expect(result.get("c")).toBe(3)
      expect(result.has("missing")).toBe(false)
    })

    it("getMany returns empty map for empty keys", async () => {
      const adapter = createInMemoryAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      const result = await cache.getMany([])
      expect(result.size).toBe(0)
    })

    it("setMany stores multiple entries", async () => {
      const adapter = createInMemoryAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      await cache.setMany([
        { key: "x", value: 10 },
        { key: "y", value: 20 },
      ])
      expect(await cache.get("x")).toBe(10)
      expect(await cache.get("y")).toBe(20)
    })
  })

  describe("LRU eviction", () => {
    it("evicts least recently accessed when exceeding maxEntries", async () => {
      const adapter = createInMemoryAdapter()
      const cache = new SQLiteCacheAdapter({ adapter, maxEntries: 2 })
      await cache.set("a", 1)
      await cache.set("b", 2)
      await cache.set("c", 3) // should evict "a"
      expect(await cache.get("a")).toBeUndefined()
      expect(await cache.get("b")).toBe(2)
      expect(await cache.get("c")).toBe(3)
    })
  })

  describe("getMetadata()", () => {
    it("returns metadata for populated cache", async () => {
      const adapter = createInMemoryAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      await cache.set("a", "hello")
      await cache.set("b", "world")
      const meta = await cache.getMetadata()
      expect(meta.entryCount).toBe(2)
      expect(meta.totalBytes).toBeGreaterThan(0)
      expect(meta.oldestEntryAt).toBeGreaterThan(0)
      expect(meta.newestEntryAt).toBeGreaterThanOrEqual(meta.oldestEntryAt!)
    })

    it("returns zeros for empty cache", async () => {
      const adapter = createInMemoryAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      const meta = await cache.getMetadata()
      expect(meta.entryCount).toBe(0)
      expect(meta.totalBytes).toBe(0)
      expect(meta.oldestEntryAt).toBeNull()
      expect(meta.newestEntryAt).toBeNull()
    })
  })

  describe("edge cases", () => {
    it("handles empty string key", async () => {
      const adapter = createInMemoryAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      await cache.set("", "empty-key-value")
      expect(await cache.get("")).toBe("empty-key-value")
    })

    it("handles large values", async () => {
      const adapter = createInMemoryAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      const largeValue = "x".repeat(100_000)
      await cache.set("large", largeValue)
      expect(await cache.get("large")).toBe(largeValue)
    })

    it("handles null values in objects", async () => {
      const adapter = createInMemoryAdapter()
      const cache = new SQLiteCacheAdapter({ adapter })
      await cache.set("nullable", { a: null, b: 1 })
      expect(await cache.get("nullable")).toEqual({ a: null, b: 1 })
    })
  })
})
