/**
 * Edge-Native Query Execution for ReactiveBase.
 * Extends the edge client with read replica routing, stale-while-revalidate
 * caching, and latency-based replica selection.
 *
 * Usage:
 *   const edge = new EdgeQueryRouter({
 *     replicas: [
 *       { url: "https://us-east.db.example.com", region: "us-east" },
 *       { url: "https://eu-west.db.example.com", region: "eu-west" },
 *     ],
 *     originUrl: "https://api.example.com",
 *   })
 *   const result = await edge.query("tasks.list", { userId: "u1" })
 */

import { EdgeClient, createCacheKey, type PrefetchResult, type EdgeClientOptions } from "./index.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReplicaConfig {
  /** Replica server URL */
  url: string
  /** Geographic region identifier */
  region: string
  /** Priority (lower = preferred, default: 0) */
  priority?: number
  /** Whether this is a read replica (default: true) */
  readOnly?: boolean
}

export interface EdgeQueryRouterOptions {
  /** Origin server URL (for mutations and fresh reads) */
  originUrl: string
  /** Read replica configurations */
  replicas: ReplicaConfig[]
  /** Auth token */
  token?: string
  /** Stale-while-revalidate window in ms (default: 5000) */
  staleWhileRevalidateMs?: number
  /** Cache TTL in ms (default: 30000) */
  cacheTtlMs?: number
  /** Max cache entries (default: 1000) */
  maxCacheEntries?: number
  /** Request timeout in ms (default: 10000) */
  timeout?: number
  /** Custom fetch implementation */
  fetch?: typeof globalThis.fetch
}

export interface CachedEdgeResult<T = unknown> {
  data: T
  source: "cache" | "replica" | "origin"
  region?: string
  stale: boolean
  cachedAt: number
  latencyMs: number
}

export interface ReplicaHealth {
  url: string
  region: string
  healthy: boolean
  latencyMs: number
  lastChecked: number
  errorCount: number
}

// ─── Edge Cache ──────────────────────────────────────────────────────────────

interface CacheEntry {
  data: unknown
  cachedAt: number
  ttl: number
  region: string
}

class EdgeCache {
  private entries = new Map<string, CacheEntry>()
  private maxEntries: number

  constructor(maxEntries: number = 1000) {
    this.maxEntries = maxEntries
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined

    if (Date.now() - entry.cachedAt > entry.ttl * 2) {
      // Hard expiry: remove completely
      this.entries.delete(key)
      return undefined
    }

    return entry
  }

  set(key: string, data: unknown, ttl: number, region: string): void {
    if (this.entries.size >= this.maxEntries) {
      const oldest = [...this.entries.entries()].sort(([, a], [, b]) => a.cachedAt - b.cachedAt)[0]
      if (oldest) this.entries.delete(oldest[0])
    }

    this.entries.set(key, { data, cachedAt: Date.now(), ttl, region })
  }

  invalidate(pattern?: string): number {
    if (!pattern) {
      const count = this.entries.size
      this.entries.clear()
      return count
    }

    let count = 0
    for (const key of this.entries.keys()) {
      if (key.includes(pattern)) {
        this.entries.delete(key)
        count++
      }
    }
    return count
  }

  get size(): number {
    return this.entries.size
  }
}

// ─── Edge Query Router ───────────────────────────────────────────────────────

export class EdgeQueryRouter {
  private originClient: EdgeClient
  private replicaClients = new Map<string, EdgeClient>()
  private replicaHealth = new Map<string, ReplicaHealth>()
  private cache: EdgeCache
  private staleMs: number
  private cacheTtlMs: number
  private replicas: ReplicaConfig[]

  constructor(options: EdgeQueryRouterOptions) {
    this.staleMs = options.staleWhileRevalidateMs ?? 5000
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000
    this.replicas = options.replicas
    this.cache = new EdgeCache(options.maxCacheEntries)

    const clientOptions: Partial<EdgeClientOptions> = {
      token: options.token,
      timeout: options.timeout,
      fetch: options.fetch,
    }

    this.originClient = new EdgeClient({
      serverUrl: options.originUrl,
      ...clientOptions,
    })

    for (const replica of options.replicas) {
      const client = new EdgeClient({
        serverUrl: replica.url,
        ...clientOptions,
      })
      this.replicaClients.set(replica.region, client)
      this.replicaHealth.set(replica.region, {
        url: replica.url,
        region: replica.region,
        healthy: true,
        latencyMs: 0,
        lastChecked: 0,
        errorCount: 0,
      })
    }
  }

  /**
   * Execute a query with automatic replica routing and caching.
   * 1. Check cache → return if fresh
   * 2. If stale, return cached + revalidate in background
   * 3. If miss, query nearest healthy replica
   * 4. Fall back to origin if replicas fail
   */
  async query<T = unknown>(
    queryName: string,
    args: unknown = {},
    options: { fresh?: boolean; region?: string } = {},
  ): Promise<CachedEdgeResult<T>> {
    const startTime = Date.now()
    const cacheKey = createCacheKey(queryName, args)

    // Force fresh read from origin
    if (options.fresh) {
      return this.queryOrigin<T>(queryName, args, startTime)
    }

    // Check cache
    const cached = this.cache.get(cacheKey)
    if (cached) {
      const age = Date.now() - cached.cachedAt
      const isStale = age > cached.ttl

      if (!isStale) {
        return {
          data: cached.data as T,
          source: "cache",
          region: cached.region,
          stale: false,
          cachedAt: cached.cachedAt,
          latencyMs: Date.now() - startTime,
        }
      }

      // Stale-while-revalidate: return stale data and revalidate in background
      if (age < cached.ttl + this.staleMs) {
        this.revalidateInBackground(queryName, args, cacheKey)
        return {
          data: cached.data as T,
          source: "cache",
          region: cached.region,
          stale: true,
          cachedAt: cached.cachedAt,
          latencyMs: Date.now() - startTime,
        }
      }
    }

    // Cache miss: try replicas, then origin
    return this.queryWithFallback<T>(queryName, args, cacheKey, startTime, options.region)
  }

  /**
   * Execute a mutation (always routes to origin).
   */
  async mutate<T = unknown>(
    mutationName: string,
    args: unknown = {},
  ): Promise<{ data: T; latencyMs: number }> {
    const startTime = Date.now()
    const result = await this.originClient.prefetchQuery<T>(mutationName, args)

    // Invalidate related cache entries
    this.cache.invalidate(mutationName.split(".")[0])

    return {
      data: result.data,
      latencyMs: Date.now() - startTime,
    }
  }

  /**
   * Get health status of all replicas.
   */
  getReplicaHealth(): ReplicaHealth[] {
    return [...this.replicaHealth.values()]
  }

  /**
   * Invalidate cached queries.
   */
  invalidateCache(pattern?: string): number {
    return this.cache.invalidate(pattern)
  }

  /**
   * Update auth token for all clients.
   */
  setToken(token: string | undefined): void {
    this.originClient.setToken(token)
    for (const client of this.replicaClients.values()) {
      client.setToken(token)
    }
  }

  get cacheSize(): number {
    return this.cache.size
  }

  get replicaCount(): number {
    return this.replicaClients.size
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private async queryWithFallback<T>(
    queryName: string,
    args: unknown,
    cacheKey: string,
    startTime: number,
    preferredRegion?: string,
  ): Promise<CachedEdgeResult<T>> {
    // Try preferred region first, then healthy replicas sorted by latency
    const orderedReplicas = this.getOrderedReplicas(preferredRegion)

    for (const replica of orderedReplicas) {
      const client = this.replicaClients.get(replica.region)
      if (!client) continue

      try {
        const result = await client.prefetchQuery<T>(queryName, args)
        const latencyMs = Date.now() - startTime

        // Update health
        this.updateReplicaHealth(replica.region, latencyMs, true)

        // Cache the result
        this.cache.set(cacheKey, result.data, this.cacheTtlMs, replica.region)

        return {
          data: result.data,
          source: "replica",
          region: replica.region,
          stale: false,
          cachedAt: Date.now(),
          latencyMs,
        }
      } catch {
        this.updateReplicaHealth(replica.region, 0, false)
      }
    }

    // All replicas failed, fall back to origin
    return this.queryOrigin<T>(queryName, args, startTime)
  }

  private async queryOrigin<T>(
    queryName: string,
    args: unknown,
    startTime: number,
  ): Promise<CachedEdgeResult<T>> {
    const result = await this.originClient.prefetchQuery<T>(queryName, args)
    const latencyMs = Date.now() - startTime
    const cacheKey = createCacheKey(queryName, args)

    this.cache.set(cacheKey, result.data, this.cacheTtlMs, "origin")

    return {
      data: result.data,
      source: "origin",
      stale: false,
      cachedAt: Date.now(),
      latencyMs,
    }
  }

  private revalidateInBackground(queryName: string, args: unknown, cacheKey: string): void {
    // Fire and forget
    const orderedReplicas = this.getOrderedReplicas()
    const firstHealthy = orderedReplicas[0]
    const client = firstHealthy
      ? this.replicaClients.get(firstHealthy.region)
      : this.originClient

    if (client) {
      client.prefetchQuery(queryName, args).then((result) => {
        this.cache.set(cacheKey, result.data, this.cacheTtlMs, firstHealthy?.region ?? "origin")
      }).catch(() => {
        // Silently fail background revalidation
      })
    }
  }

  private getOrderedReplicas(preferredRegion?: string): ReplicaHealth[] {
    const healthy = [...this.replicaHealth.values()].filter((r) => r.healthy || r.errorCount < 3)

    healthy.sort((a, b) => {
      // Preferred region first
      if (preferredRegion) {
        if (a.region === preferredRegion && b.region !== preferredRegion) return -1
        if (b.region === preferredRegion && a.region !== preferredRegion) return 1
      }
      // Then by latency
      return a.latencyMs - b.latencyMs
    })

    return healthy
  }

  private updateReplicaHealth(region: string, latencyMs: number, success: boolean): void {
    const health = this.replicaHealth.get(region)
    if (!health) return

    if (success) {
      health.healthy = true
      health.latencyMs = latencyMs
      health.errorCount = 0
    } else {
      health.errorCount++
      health.healthy = health.errorCount < 3
    }
    health.lastChecked = Date.now()
  }
}
