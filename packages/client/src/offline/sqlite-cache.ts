/**
 * SQLite-backed local cache for offline-first mobile support.
 * Uses an abstract SQL interface so it works with any SQLite binding
 * (better-sqlite3, expo-sqlite, react-native-sqlite-storage, etc.)
 *
 * Features:
 *   - Automatic table creation on first use
 *   - TTL-based expiration
 *   - LRU eviction when cache exceeds max size
 *   - Batch get/set operations
 *   - Cache metadata (size, entry count, oldest entry, total bytes)
 */

import type { OfflineStorage } from "./offline.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SQLiteAdapter {
  /** Execute a write statement (INSERT, UPDATE, DELETE, CREATE) */
  run(sql: string, params?: unknown[]): Promise<void>
  /** Fetch a single row */
  get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>
  /** Fetch all matching rows */
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>
}

export interface SQLiteCacheOptions {
  /** SQLite adapter instance */
  adapter: SQLiteAdapter
  /** Table name for the cache (default: "rb_cache") */
  tableName?: string
  /** Maximum number of entries before LRU eviction (default: 10000) */
  maxEntries?: number
  /** Default TTL in milliseconds (default: 0 = no expiration) */
  defaultTTLMs?: number
}

export interface CacheMetadata {
  /** Number of entries in the cache */
  entryCount: number
  /** Total serialized size in bytes */
  totalBytes: number
  /** Timestamp of the oldest entry (ms since epoch), or null if empty */
  oldestEntryAt: number | null
  /** Timestamp of the newest entry (ms since epoch), or null if empty */
  newestEntryAt: number | null
}

interface CacheRow {
  key: string
  value: string
  created_at: number
  accessed_at: number
  expires_at: number | null
  size_bytes: number
}

// ─── SQL Generation ──────────────────────────────────────────────────────────

export function generateCacheTableSQL(tableName = "rb_cache"): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS ${tableName} (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL,
  expires_at INTEGER,
  size_bytes INTEGER NOT NULL
)`,
    `CREATE INDEX IF NOT EXISTS idx_${tableName}_accessed_at ON ${tableName} (accessed_at)`,
    `CREATE INDEX IF NOT EXISTS idx_${tableName}_expires_at ON ${tableName} (expires_at)`,
  ]
}

// ─── SQLite Cache Adapter ────────────────────────────────────────────────────

const DEFAULT_OPTIONS = {
  tableName: "rb_cache",
  maxEntries: 10_000,
  defaultTTLMs: 0,
}

export class SQLiteCacheAdapter implements OfflineStorage {
  private adapter: SQLiteAdapter
  private tableName: string
  private maxEntries: number
  private defaultTTLMs: number
  private initialized = false

  constructor(options: SQLiteCacheOptions) {
    this.adapter = options.adapter
    this.tableName = options.tableName ?? DEFAULT_OPTIONS.tableName
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(this.tableName)) {
      throw new Error(`Invalid tableName "${this.tableName}": must match /^[a-zA-Z_][a-zA-Z0-9_]*$/`)
    }
    this.maxEntries = options.maxEntries ?? DEFAULT_OPTIONS.maxEntries
    this.defaultTTLMs = options.defaultTTLMs ?? DEFAULT_OPTIONS.defaultTTLMs
  }

  // ─── OfflineStorage interface ─────────────────────────────────────────────

  async get(key: string): Promise<unknown | undefined> {
    await this.ensureTable()
    await this.purgeExpired()

    const row = await this.adapter.get<CacheRow>(`SELECT key, value FROM ${this.tableName} WHERE key = ?`, [key])

    if (!row) return undefined

    // Update accessed_at for LRU tracking
    await this.adapter.run(`UPDATE ${this.tableName} SET accessed_at = ? WHERE key = ?`, [Date.now(), key])

    return JSON.parse(row.value)
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.ensureTable()

    const serialized = JSON.stringify(value)
    const now = Date.now()
    const expiresAt = this.defaultTTLMs > 0 ? now + this.defaultTTLMs : null

    await this.adapter.run(
      `INSERT OR REPLACE INTO ${this.tableName} (key, value, created_at, accessed_at, expires_at, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [key, serialized, now, now, expiresAt, serialized.length],
    )

    await this.evictIfNeeded()
  }

  async delete(key: string): Promise<void> {
    await this.ensureTable()
    await this.adapter.run(`DELETE FROM ${this.tableName} WHERE key = ?`, [key])
  }

  async clear(): Promise<void> {
    await this.ensureTable()
    await this.adapter.run(`DELETE FROM ${this.tableName}`)
  }

  async keys(): Promise<string[]> {
    await this.ensureTable()
    await this.purgeExpired()
    const rows = await this.adapter.all<{ key: string }>(`SELECT key FROM ${this.tableName}`)
    return rows.map((r) => r.key)
  }

  // ─── Batch Operations ─────────────────────────────────────────────────────

  async getMany(keys: string[]): Promise<Map<string, unknown>> {
    await this.ensureTable()
    await this.purgeExpired()

    const result = new Map<string, unknown>()
    if (keys.length === 0) return result

    const placeholders = keys.map(() => "?").join(", ")
    const rows = await this.adapter.all<CacheRow>(
      `SELECT key, value FROM ${this.tableName} WHERE key IN (${placeholders})`,
      keys,
    )

    const now = Date.now()
    for (const row of rows) {
      result.set(row.key, JSON.parse(row.value))
      await this.adapter.run(`UPDATE ${this.tableName} SET accessed_at = ? WHERE key = ?`, [now, row.key])
    }

    return result
  }

  async setMany(entries: Array<{ key: string; value: unknown }>): Promise<void> {
    await this.ensureTable()

    const now = Date.now()
    const expiresAt = this.defaultTTLMs > 0 ? now + this.defaultTTLMs : null

    for (const entry of entries) {
      const serialized = JSON.stringify(entry.value)
      await this.adapter.run(
        `INSERT OR REPLACE INTO ${this.tableName} (key, value, created_at, accessed_at, expires_at, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [entry.key, serialized, now, now, expiresAt, serialized.length],
      )
    }

    await this.evictIfNeeded()
  }

  // ─── Cache Metadata ───────────────────────────────────────────────────────

  async getMetadata(): Promise<CacheMetadata> {
    await this.ensureTable()
    await this.purgeExpired()

    const stats = await this.adapter.get<{
      entry_count: number
      total_bytes: number
      oldest: number | null
      newest: number | null
    }>(
      `SELECT
        COUNT(*) as entry_count,
        COALESCE(SUM(size_bytes), 0) as total_bytes,
        MIN(created_at) as oldest,
        MAX(created_at) as newest
      FROM ${this.tableName}`,
    )

    return {
      entryCount: stats?.entry_count ?? 0,
      totalBytes: stats?.total_bytes ?? 0,
      oldestEntryAt: stats?.oldest ?? null,
      newestEntryAt: stats?.newest ?? null,
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async ensureTable(): Promise<void> {
    if (this.initialized) return
    const statements = generateCacheTableSQL(this.tableName)
    for (const sql of statements) {
      await this.adapter.run(sql)
    }
    this.initialized = true
  }

  private async purgeExpired(): Promise<void> {
    await this.adapter.run(`DELETE FROM ${this.tableName} WHERE expires_at IS NOT NULL AND expires_at <= ?`, [
      Date.now(),
    ])
  }

  private async evictIfNeeded(): Promise<void> {
    const countRow = await this.adapter.get<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM ${this.tableName}`)
    const count = countRow?.cnt ?? 0

    if (count > this.maxEntries) {
      const excess = count - this.maxEntries
      // Evict least recently accessed entries
      await this.adapter.run(
        `DELETE FROM ${this.tableName} WHERE key IN (
          SELECT key FROM ${this.tableName} ORDER BY accessed_at ASC LIMIT ?
        )`,
        [excess],
      )
    }
  }
}
