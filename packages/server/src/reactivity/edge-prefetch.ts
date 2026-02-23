/**
 * Edge Query Prefetch Cache.
 * CDN-edge query result caching with pub/sub invalidation.
 * First response from edge cache (<10ms), then live WebSocket for updates.
 *
 * Usage:
 *   const cache = new EdgePrefetchCache({ ttlMs: 30000 })
 *   cache.set("tasks.list", { userId: "u1" }, results)
 *   const hit = cache.get("tasks.list", { userId: "u1" })
 *   cache.invalidate("tasks")  // Invalidate all queries touching "tasks" table
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EdgePrefetchOptions {
  /** Cache TTL in ms (default: 30000) */
  ttlMs?: number
  /** Stale-while-revalidate window in ms (default: 5000) */
  staleWhileRevalidateMs?: number
  /** Max cache entries (default: 10000) */
  maxEntries?: number
  /** Enable invalidation tracking (default: true) */
  trackInvalidations?: boolean
  /** On invalidation callback — wire to pub/sub for multi-edge */
  onInvalidation?: (pattern: string) => void
}

export interface CachedQueryResult<T = unknown> {
  data: T
  queryName: string
  argsHash: string
  tables: string[]
  cachedAt: number
  expiresAt: number
  staleAt: number
  hits: number
  source: "fresh" | "stale" | "miss"
}

export interface EdgeCacheStats {
  entries: number
  hits: number
  misses: number
  staleHits: number
  invalidations: number
  hitRate: number
  avgAgeMs: number
  memoryEstimateBytes: number
}

export interface InvalidationEvent {
  pattern: string
  table?: string
  timestamp: number
  entriesRemoved: number
}

// ─── Edge Prefetch Cache ─────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<EdgePrefetchOptions, "onInvalidation">> &
  Pick<EdgePrefetchOptions, "onInvalidation"> = {
  ttlMs: 30_000,
  staleWhileRevalidateMs: 5_000,
  maxEntries: 10_000,
  trackInvalidations: true,
  onInvalidation: undefined,
}

export class EdgePrefetchCache {
  private options: typeof DEFAULT_OPTIONS
  private cache = new Map<string, CachedQueryResult>()
  private tableIndex = new Map<string, Set<string>>()
  private hits = 0
  private misses = 0
  private staleHits = 0
  private invalidationCount = 0
  private invalidationLog: InvalidationEvent[] = []

  constructor(options: EdgePrefetchOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Cache a query result with table dependency tracking.
   */
  set<T>(queryName: string, args: unknown, data: T, tables: string[] = []): void {
    const key = this.cacheKey(queryName, args)
    const now = Date.now()

    // Evict if at capacity
    if (this.cache.size >= this.options.maxEntries && !this.cache.has(key)) {
      this.evictOldest()
    }

    const entry: CachedQueryResult<T> = {
      data,
      queryName,
      argsHash: this.hashArgs(args),
      tables,
      cachedAt: now,
      expiresAt: now + this.options.ttlMs,
      staleAt: now + this.options.ttlMs - this.options.staleWhileRevalidateMs,
      hits: 0,
      source: "fresh",
    }

    this.cache.set(key, entry as CachedQueryResult)

    // Index by table for invalidation
    for (const table of tables) {
      if (!this.tableIndex.has(table)) this.tableIndex.set(table, new Set())
      this.tableIndex.get(table)!.add(key)
    }
  }

  /**
   * Get a cached query result. Returns with source="fresh", "stale", or null for miss.
   */
  get<T>(queryName: string, args: unknown): CachedQueryResult<T> | null {
    const key = this.cacheKey(queryName, args)
    const entry = this.cache.get(key) as CachedQueryResult<T> | undefined

    if (!entry) {
      this.misses++
      return null
    }

    const now = Date.now()

    // Expired — remove and miss
    if (now > entry.expiresAt) {
      this.cache.delete(key)
      this.removeFromTableIndex(key, entry.tables)
      this.misses++
      return null
    }

    entry.hits++

    // Stale but usable — return with stale flag
    if (now > entry.staleAt) {
      this.staleHits++
      return { ...entry, source: "stale" }
    }

    // Fresh hit
    this.hits++
    return { ...entry, source: "fresh" }
  }

  /**
   * Invalidate all cache entries that depend on a table.
   */
  invalidateByTable(table: string): number {
    const keys = this.tableIndex.get(table)
    if (!keys) return 0

    let removed = 0
    for (const key of keys) {
      const entry = this.cache.get(key)
      if (entry) {
        this.removeFromTableIndex(key, entry.tables)
        this.cache.delete(key)
        removed++
      }
    }
    this.tableIndex.delete(table)

    this.invalidationCount++
    if (this.options.trackInvalidations) {
      this.invalidationLog.push({ pattern: `table:${table}`, table, timestamp: Date.now(), entriesRemoved: removed })
      if (this.invalidationLog.length > 100) this.invalidationLog.shift()
    }
    this.options.onInvalidation?.(`table:${table}`)

    return removed
  }

  /**
   * Invalidate by query name pattern.
   */
  invalidateByQuery(queryName: string): number {
    let removed = 0
    for (const [key, entry] of this.cache) {
      if (entry.queryName === queryName) {
        this.removeFromTableIndex(key, entry.tables)
        this.cache.delete(key)
        removed++
      }
    }
    this.invalidationCount++
    this.options.onInvalidation?.(`query:${queryName}`)
    return removed
  }

  /**
   * Invalidate all entries.
   */
  invalidateAll(): number {
    const count = this.cache.size
    this.cache.clear()
    this.tableIndex.clear()
    this.invalidationCount++
    return count
  }

  /**
   * Process a mutation event — invalidate affected caches.
   * Wire this to ReactivityEngine.onUpdate() or pub/sub.
   */
  handleMutation(tables: string[]): number {
    let total = 0
    for (const table of tables) {
      total += this.invalidateByTable(table)
    }
    return total
  }

  getStats(): EdgeCacheStats {
    const totalRequests = this.hits + this.misses + this.staleHits
    let totalAge = 0
    const now = Date.now()

    for (const entry of this.cache.values()) {
      totalAge += now - entry.cachedAt
    }

    return {
      entries: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      staleHits: this.staleHits,
      invalidations: this.invalidationCount,
      hitRate: totalRequests > 0 ? Math.round((this.hits / totalRequests) * 1000) / 1000 : 0,
      avgAgeMs: this.cache.size > 0 ? Math.round(totalAge / this.cache.size) : 0,
      memoryEstimateBytes: this.cache.size * 512, // rough estimate
    }
  }

  getInvalidationLog(): InvalidationEvent[] {
    return [...this.invalidationLog]
  }

  get size(): number {
    return this.cache.size
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private cacheKey(queryName: string, args: unknown): string {
    return `${queryName}:${this.hashArgs(args)}`
  }

  private hashArgs(args: unknown): string {
    return JSON.stringify(args ?? {})
  }

  private evictOldest(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity
    for (const [key, entry] of this.cache) {
      if (entry.cachedAt < oldestTime) {
        oldestTime = entry.cachedAt
        oldestKey = key
      }
    }
    if (oldestKey) {
      const entry = this.cache.get(oldestKey)
      if (entry) this.removeFromTableIndex(oldestKey, entry.tables)
      this.cache.delete(oldestKey)
    }
  }

  private removeFromTableIndex(key: string, tables: string[]): void {
    for (const table of tables) {
      this.tableIndex.get(table)?.delete(key)
    }
  }
}
