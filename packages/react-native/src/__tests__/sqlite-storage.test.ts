import { describe, it, expect, beforeEach } from "vitest"
import { SQLiteOfflineStorage } from "../sqlite-storage.js"
import type { SQLiteExecutor } from "../sqlite-storage.js"

// Simple in-memory SQLite mock
function createMockSQLite(): SQLiteExecutor {
  const tables = new Map<string, Map<string, Record<string, unknown>>>()

  return {
    execute(sql: string, params: unknown[] = []) {
      // Parse SELECT queries
      if (sql.trim().toUpperCase().startsWith("SELECT")) {
        const tableMatch = sql.match(/FROM "?(\w+)"?/i)
        const tableName = tableMatch?.[1] ?? ""
        const table = tables.get(tableName) ?? new Map()

        if (sql.includes("COUNT(*)")) {
          return [{ cnt: table.size }]
        }

        if (sql.includes("WHERE key = ?")) {
          const key = params[0] as string
          const row = table.get(key)
          return row ? [row] : []
        }

        // SELECT key ...
        return [...table.values()]
      }
      return []
    },
    run(sql: string, params: unknown[] = []) {
      if (sql.includes("CREATE TABLE")) {
        const nameMatch = sql.match(/CREATE TABLE IF NOT EXISTS "?(\w+)"?/i)
        const name = nameMatch?.[1] ?? "unknown"
        if (!tables.has(name)) tables.set(name, new Map())
        return
      }

      const intoMatch = sql.match(/INTO\s+"?(\w+)"?/i)
      const fromMatch = sql.match(/FROM\s+"?(\w+)"?/i)
      const tableName = intoMatch?.[1] ?? fromMatch?.[1] ?? ""

      if (!tables.has(tableName)) tables.set(tableName, new Map())
      const table = tables.get(tableName)!

      if (sql.includes("INSERT OR REPLACE")) {
        const key = params[0] as string
        table.set(key, {
          key,
          value: params[1],
          updated_at: params[2],
        })
      } else if (sql.includes("DELETE") && sql.includes("WHERE")) {
        const key = params[0] as string
        table.delete(key)
      } else if (sql.includes("DELETE")) {
        table.clear()
      }
    },
  }
}

describe("SQLiteOfflineStorage", () => {
  let storage: SQLiteOfflineStorage

  beforeEach(async () => {
    const db = createMockSQLite()
    storage = new SQLiteOfflineStorage(db)
    await storage.init()
  })

  it("throws if not initialized", async () => {
    const db = createMockSQLite()
    const uninitialized = new SQLiteOfflineStorage(db)
    await expect(uninitialized.get("key")).rejects.toThrow("not initialized")
  })

  it("returns null for missing keys", async () => {
    expect(await storage.get("missing")).toBeNull()
  })

  it("sets and gets values", async () => {
    await storage.set("key1", "value1")
    expect(await storage.get("key1")).toBe("value1")
  })

  it("overwrites existing keys", async () => {
    await storage.set("key1", "first")
    await storage.set("key1", "second")
    expect(await storage.get("key1")).toBe("second")
  })

  it("deletes keys", async () => {
    await storage.set("key1", "value1")
    await storage.delete("key1")
    expect(await storage.get("key1")).toBeNull()
  })

  it("returns all keys", async () => {
    await storage.set("a", "1")
    await storage.set("b", "2")
    await storage.set("c", "3")
    const keys = await storage.getAllKeys()
    expect(keys).toContain("a")
    expect(keys).toContain("b")
    expect(keys).toContain("c")
  })

  it("clears all data", async () => {
    await storage.set("a", "1")
    await storage.set("b", "2")
    await storage.clear()
    expect(await storage.getAllKeys()).toEqual([])
  })

  it("counts entries", async () => {
    expect(await storage.count()).toBe(0)
    await storage.set("a", "1")
    await storage.set("b", "2")
    expect(await storage.count()).toBe(2)
  })

  it("double init is safe", async () => {
    await storage.init()
    await storage.set("key", "val")
    expect(await storage.get("key")).toBe("val")
  })
})
