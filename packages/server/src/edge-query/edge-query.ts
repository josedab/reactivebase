// --------------------------------------------------------------------------
// Edge-First Global Query Layer
// CDN-like caching for reactive queries with invalidation propagation
// --------------------------------------------------------------------------

import { randomUUID } from "node:crypto"

// ── Types ──────────────────────────────────────────────────────────────────

export interface EdgeRegion {
  id: string
  name: string
  endpoint: string
  latitude: number
  longitude: number
  isPrimary: boolean
}

export interface EdgeCacheEntry {
  queryHash: string
  result: unknown
  region: string
  cachedAt: number
  ttl: number
  version: number
  dependencies: string[]
  staleWhileRevalidate: boolean
}

export interface InvalidationMessage {
  id: string
  tables: string[]
  rowKeys?: string[]
  originRegion: string
  timestamp: number
  version: number
  propagationPath: string[]
}

export interface EdgeQueryOptions {
  cacheTtl?: number
  staleWhileRevalidate?: boolean
  regionAffinity?: string
  consistencyLevel?: "eventual" | "strong" | "bounded-staleness"
  maxStalenessMs?: number
}

export interface EdgeQueryLayerOptions {
  regions: EdgeRegion[]
  defaultTtl?: number
  maxCacheSize?: number
  invalidationBatchMs?: number
  consistencyLevel?: "eventual" | "strong" | "bounded-staleness"
}

export interface EdgeCacheStats {
  hits: number
  misses: number
  staleHits: number
  invalidations: number
  avgLatencyMs: number
  entriesByRegion: Record<string, number>
}

export interface ConsistencyProof {
  version: number
  regionVersions: Record<string, number>
  quorumMet: boolean
  timestamp: number
}

// ── Error ──────────────────────────────────────────────────────────────────

export class EdgeQueryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly region?: string,
  ) {
    super(message)
    this.name = "EdgeQueryError"
  }
}

// ── SQL Builders ───────────────────────────────────────────────────────────

export function buildCreateEdgeCacheTableSQL(): string {
  return `
    CREATE TABLE IF NOT EXISTS _rb_edge_cache (
      query_hash TEXT NOT NULL,
      region TEXT NOT NULL,
      result JSONB NOT NULL,
      dependencies TEXT[] NOT NULL DEFAULT '{}',
      version BIGINT NOT NULL DEFAULT 1,
      ttl INTEGER NOT NULL DEFAULT 60,
      cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      stale_while_revalidate BOOLEAN NOT NULL DEFAULT false,
      PRIMARY KEY (query_hash, region)
    );
    CREATE INDEX IF NOT EXISTS idx_edge_cache_expires ON _rb_edge_cache (expires_at);
    CREATE INDEX IF NOT EXISTS idx_edge_cache_deps ON _rb_edge_cache USING GIN (dependencies);
  `
}

export function buildCreateInvalidationLogTableSQL(): string {
  return `
    CREATE TABLE IF NOT EXISTS _rb_invalidation_log (
      id TEXT PRIMARY KEY,
      tables TEXT[] NOT NULL,
      row_keys TEXT[],
      origin_region TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      version BIGINT NOT NULL,
      propagation_path TEXT[] NOT NULL DEFAULT '{}',
      processed BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_invalidation_log_ts ON _rb_invalidation_log (timestamp);
    CREATE INDEX IF NOT EXISTS idx_invalidation_log_tables ON _rb_invalidation_log USING GIN (tables);
  `
}

export function buildUpsertCacheEntrySQL(): string {
  return `
    INSERT INTO _rb_edge_cache (query_hash, region, result, dependencies, version, ttl, cached_at, expires_at, stale_while_revalidate)
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW() + ($6 || ' seconds')::INTERVAL, $7)
    ON CONFLICT (query_hash, region)
    DO UPDATE SET result = $3, dependencies = $4, version = $5, ttl = $6,
      cached_at = NOW(), expires_at = NOW() + ($6 || ' seconds')::INTERVAL, stale_while_revalidate = $7
  `
}

export function buildGetCacheEntrySQL(): string {
  return `
    SELECT query_hash, region, result, dependencies, version, ttl, cached_at, expires_at, stale_while_revalidate
    FROM _rb_edge_cache
    WHERE query_hash = $1 AND region = $2 AND expires_at > NOW()
  `
}

export function buildInvalidateByTablesSQL(): string {
  return `
    DELETE FROM _rb_edge_cache
    WHERE dependencies && $1
    RETURNING query_hash, region
  `
}

export function buildInsertInvalidationSQL(): string {
  return `
    INSERT INTO _rb_invalidation_log (id, tables, row_keys, origin_region, version, propagation_path)
    VALUES ($1, $2, $3, $4, $5, $6)
  `
}

export function buildGetPendingInvalidationsSQL(): string {
  return `
    SELECT id, tables, row_keys, origin_region, timestamp, version, propagation_path
    FROM _rb_invalidation_log
    WHERE processed = false AND origin_region != $1
    ORDER BY timestamp ASC
    LIMIT $2
  `
}

export function buildMarkInvalidationsProcessedSQL(): string {
  return `UPDATE _rb_invalidation_log SET processed = true WHERE id = ANY($1)`
}

// ── Invalidation Propagator ────────────────────────────────────────────────

export class InvalidationPropagator {
  private pending: InvalidationMessage[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly batchMs: number,
    private readonly onFlush: (messages: InvalidationMessage[]) => Promise<void>,
  ) {}

  enqueue(message: InvalidationMessage): void {
    this.pending.push(message)
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.batchMs)
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.pending.length === 0) return
    const batch = this.pending.splice(0)
    // Deduplicate by merging overlapping table sets
    const merged = this.deduplicateBatch(batch)
    await this.onFlush(merged)
  }

  private deduplicateBatch(messages: InvalidationMessage[]): InvalidationMessage[] {
    const byOrigin = new Map<string, InvalidationMessage>()
    for (const msg of messages) {
      const key = `${msg.originRegion}:${msg.version}`
      const existing = byOrigin.get(key)
      if (existing) {
        const tableSet = new Set([...existing.tables, ...msg.tables])
        existing.tables = Array.from(tableSet)
        if (msg.rowKeys) {
          existing.rowKeys = [...(existing.rowKeys || []), ...msg.rowKeys]
        }
      } else {
        byOrigin.set(key, { ...msg })
      }
    }
    return Array.from(byOrigin.values())
  }

  destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.pending = []
  }
}

// ── Edge Query Cache ───────────────────────────────────────────────────────

export class EdgeQueryCache {
  private cache = new Map<string, EdgeCacheEntry>()
  private stats: EdgeCacheStats = {
    hits: 0,
    misses: 0,
    staleHits: 0,
    invalidations: 0,
    avgLatencyMs: 0,
    entriesByRegion: {},
  }
  private latencySum = 0
  private latencyCount = 0

  constructor(private readonly maxSize: number = 10000) {}

  get(queryHash: string, region: string): EdgeCacheEntry | null {
    const start = Date.now()
    const key = `${region}:${queryHash}`
    const entry = this.cache.get(key)

    if (!entry) {
      this.stats.misses++
      this.recordLatency(Date.now() - start)
      return null
    }

    const now = Date.now()
    if (now > entry.cachedAt + entry.ttl * 1000) {
      if (entry.staleWhileRevalidate) {
        this.stats.staleHits++
        this.recordLatency(Date.now() - start)
        return entry
      }
      this.cache.delete(key)
      this.stats.misses++
      this.recordLatency(Date.now() - start)
      return null
    }

    this.stats.hits++
    this.recordLatency(Date.now() - start)
    return entry
  }

  set(entry: EdgeCacheEntry): void {
    const key = `${entry.region}:${entry.queryHash}`

    // Evict if at capacity (LRU-like: remove oldest)
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldest = this.cache.keys().next().value
      if (oldest) this.cache.delete(oldest)
    }

    this.cache.set(key, entry)
    this.stats.entriesByRegion[entry.region] = (this.stats.entriesByRegion[entry.region] || 0) + 1
  }

  invalidateByTables(tables: string[]): string[] {
    const invalidated: string[] = []
    const tableSet = new Set(tables)

    for (const [key, entry] of this.cache) {
      if (entry.dependencies.some((dep) => tableSet.has(dep))) {
        this.cache.delete(key)
        invalidated.push(key)
        this.stats.invalidations++
      }
    }

    return invalidated
  }

  invalidateByRegion(region: string): number {
    let count = 0
    for (const [key, entry] of this.cache) {
      if (entry.region === region) {
        this.cache.delete(key)
        count++
      }
    }
    this.stats.invalidations += count
    return count
  }

  getStats(): EdgeCacheStats {
    return { ...this.stats }
  }

  clear(): void {
    this.cache.clear()
    this.stats.entriesByRegion = {}
  }

  get size(): number {
    return this.cache.size
  }

  private recordLatency(ms: number): void {
    this.latencySum += ms
    this.latencyCount++
    this.stats.avgLatencyMs = this.latencyCount > 0 ? this.latencySum / this.latencyCount : 0
  }
}

// ── Consistency Manager ────────────────────────────────────────────────────

export class ConsistencyManager {
  private regionVersions = new Map<string, number>()

  recordVersion(region: string, version: number): void {
    const current = this.regionVersions.get(region) || 0
    if (version > current) {
      this.regionVersions.set(region, version)
    }
  }

  checkConsistency(
    requiredVersion: number,
    level: "eventual" | "strong" | "bounded-staleness",
    maxStalenessMs?: number,
  ): ConsistencyProof {
    const versions = Object.fromEntries(this.regionVersions)
    const minVersion = Math.min(...Object.values(versions), Infinity)

    let quorumMet = false
    switch (level) {
      case "eventual":
        quorumMet = true
        break
      case "strong":
        quorumMet = minVersion >= requiredVersion
        break
      case "bounded-staleness":
        quorumMet = minVersion >= requiredVersion - (maxStalenessMs || 5000)
        break
    }

    return {
      version: minVersion === Infinity ? 0 : minVersion,
      regionVersions: versions,
      quorumMet,
      timestamp: Date.now(),
    }
  }

  getRegionVersion(region: string): number {
    return this.regionVersions.get(region) || 0
  }
}

// ── Edge Query Layer (Main Engine) ─────────────────────────────────────────

export class EdgeQueryLayer {
  private readonly cache: EdgeQueryCache
  private readonly propagator: InvalidationPropagator
  private readonly consistency: ConsistencyManager
  private readonly regions: Map<string, EdgeRegion>
  private readonly defaultTtl: number
  private readonly consistencyLevel: "eventual" | "strong" | "bounded-staleness"
  private globalVersion = 0

  constructor(options: EdgeQueryLayerOptions) {
    if (!options.regions || options.regions.length === 0) {
      throw new EdgeQueryError("At least one region is required", "INVALID_CONFIG")
    }

    this.regions = new Map(options.regions.map((r) => [r.id, r]))
    this.defaultTtl = options.defaultTtl ?? 60
    this.consistencyLevel = options.consistencyLevel ?? "eventual"
    this.cache = new EdgeQueryCache(options.maxCacheSize ?? 10000)
    this.consistency = new ConsistencyManager()

    this.propagator = new InvalidationPropagator(options.invalidationBatchMs ?? 50, async (messages) => {
      for (const msg of messages) {
        this.cache.invalidateByTables(msg.tables)
        for (const region of this.regions.keys()) {
          if (!msg.propagationPath.includes(region)) {
            this.consistency.recordVersion(region, msg.version)
          }
        }
      }
    })
  }

  async executeQuery(
    queryHash: string,
    executeFn: () => Promise<{ result: unknown; dependencies: string[] }>,
    options: EdgeQueryOptions = {},
  ): Promise<{ result: unknown; fromCache: boolean; region: string; version: number }> {
    const region = options.regionAffinity || this.getPrimaryRegion()
    if (!region) {
      throw new EdgeQueryError("No region available", "NO_REGION")
    }

    // Check cache
    const cached = this.cache.get(queryHash, region)
    if (cached) {
      const level = options.consistencyLevel || this.consistencyLevel
      if (level === "eventual" || level === "bounded-staleness") {
        return { result: cached.result, fromCache: true, region, version: cached.version }
      }

      // Strong consistency: verify version
      const proof = this.consistency.checkConsistency(cached.version, "strong")
      if (proof.quorumMet) {
        return { result: cached.result, fromCache: true, region, version: cached.version }
      }
    }

    // Cache miss or stale: execute query
    const { result, dependencies } = await executeFn()
    this.globalVersion++

    const entry: EdgeCacheEntry = {
      queryHash,
      result,
      region,
      cachedAt: Date.now(),
      ttl: options.cacheTtl ?? this.defaultTtl,
      version: this.globalVersion,
      dependencies,
      staleWhileRevalidate: options.staleWhileRevalidate ?? false,
    }

    this.cache.set(entry)
    this.consistency.recordVersion(region, this.globalVersion)

    return { result, fromCache: false, region, version: this.globalVersion }
  }

  invalidate(tables: string[], rowKeys?: string[], originRegion?: string): void {
    this.globalVersion++
    const origin = originRegion || this.getPrimaryRegion() || "unknown"

    const message: InvalidationMessage = {
      id: `inv_${randomUUID()}`,
      tables,
      rowKeys,
      originRegion: origin,
      timestamp: Date.now(),
      version: this.globalVersion,
      propagationPath: [origin],
    }

    // Immediate local invalidation
    this.cache.invalidateByTables(tables)

    // Propagate to other regions
    this.propagator.enqueue(message)
  }

  getRegions(): EdgeRegion[] {
    return Array.from(this.regions.values())
  }

  getStats(): EdgeCacheStats {
    return this.cache.getStats()
  }

  getConsistencyProof(requiredVersion: number): ConsistencyProof {
    return this.consistency.checkConsistency(requiredVersion, this.consistencyLevel)
  }

  async destroy(): Promise<void> {
    await this.propagator.flush()
    this.propagator.destroy()
    this.cache.clear()
  }

  private getPrimaryRegion(): string | null {
    for (const [id, region] of this.regions) {
      if (region.isPrimary) return id
    }
    return this.regions.keys().next().value || null
  }
}
