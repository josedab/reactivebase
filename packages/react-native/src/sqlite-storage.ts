/**
 * SQLite-backed offline storage for React Native.
 * Uses a key-value table for persistent offline data.
 *
 * Usage:
 *   import { SQLiteOfflineStorage } from "@reactivebase/react-native/sqlite-storage"
 *
 *   // With expo-sqlite
 *   const db = SQLite.openDatabaseSync("reactivebase.db")
 *   const storage = new SQLiteOfflineStorage({
 *     execute: (sql, params) => db.getAllSync(sql, params),
 *     run: (sql, params) => db.runSync(sql, params),
 *   })
 *   await storage.init()
 */

import type { OfflineStorage } from "./index.js"

export interface SQLiteExecutor {
  /** Execute a query and return rows */
  execute(sql: string, params?: unknown[]): { rows: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
  /** Execute a statement (INSERT, UPDATE, DELETE) */
  run(sql: string, params?: unknown[]): void
}

export class SQLiteOfflineStorage implements OfflineStorage {
  private executor: SQLiteExecutor
  private tableName: string
  private initialized = false

  constructor(executor: SQLiteExecutor, tableName = "_rb_offline_kv") {
    this.executor = executor
    this.tableName = tableName
  }

  async init(): Promise<void> {
    if (this.initialized) return
    this.executor.run(
      `CREATE TABLE IF NOT EXISTS "${this.tableName}" (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0)`,
    )
    this.initialized = true
  }

  async get(key: string): Promise<string | null> {
    this.ensureInitialized()
    const result = this.executor.execute(`SELECT value FROM "${this.tableName}" WHERE key = ?`, [key])
    const rows = Array.isArray(result) ? result : result.rows
    if (rows.length === 0) return null
    return rows[0].value as string
  }

  async set(key: string, value: string): Promise<void> {
    this.ensureInitialized()
    this.executor.run(`INSERT OR REPLACE INTO "${this.tableName}" (key, value, updated_at) VALUES (?, ?, ?)`, [
      key,
      value,
      Date.now(),
    ])
  }

  async delete(key: string): Promise<void> {
    this.ensureInitialized()
    this.executor.run(`DELETE FROM "${this.tableName}" WHERE key = ?`, [key])
  }

  async getAllKeys(): Promise<string[]> {
    this.ensureInitialized()
    const result = this.executor.execute(`SELECT key FROM "${this.tableName}" ORDER BY key`)
    const rows = Array.isArray(result) ? result : result.rows
    return rows.map((r) => r.key as string)
  }

  async clear(): Promise<void> {
    this.ensureInitialized()
    this.executor.run(`DELETE FROM "${this.tableName}"`)
  }

  /** Get the number of stored entries */
  async count(): Promise<number> {
    this.ensureInitialized()
    const result = this.executor.execute(`SELECT COUNT(*) as cnt FROM "${this.tableName}"`)
    const rows = Array.isArray(result) ? result : result.rows
    return (rows[0]?.cnt as number) ?? 0
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("SQLiteOfflineStorage not initialized. Call init() first.")
    }
  }
}
