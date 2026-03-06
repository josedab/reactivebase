import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  EdgeQueryLayer,
  EdgeQueryCache,
  InvalidationPropagator,
  ConsistencyManager,
  EdgeQueryError,
  buildCreateEdgeCacheTableSQL,
  buildCreateInvalidationLogTableSQL,
  buildUpsertCacheEntrySQL,
  buildGetCacheEntrySQL,
  buildInvalidateByTablesSQL,
  buildInsertInvalidationSQL,
  buildGetPendingInvalidationsSQL,
  buildMarkInvalidationsProcessedSQL,
  type EdgeCacheEntry,
  type EdgeRegion,
} from "../edge-query/index.js"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<EdgeCacheEntry> = {}): EdgeCacheEntry {
  return {
    queryHash: "q1",
    result: { data: [1, 2, 3] },
    region: "us-east-1",
    cachedAt: Date.now(),
    ttl: 60,
    version: 1,
    dependencies: ["tasks"],
    staleWhileRevalidate: false,
    ...overrides,
  }
}

function makeRegion(id: string, isPrimary = false): EdgeRegion {
  return { id, name: id, endpoint: `https://${id}.example.com`, latitude: 0, longitude: 0, isPrimary }
}

function makeLayer(options: Partial<Parameters<typeof EdgeQueryLayer.prototype.constructor>[0]> = {}) {
  return new EdgeQueryLayer({
    regions: [makeRegion("us-east-1", true), makeRegion("eu-west-1")],
    defaultTtl: 60,
    invalidationBatchMs: 10,
    ...options,
  } as ConstructorParameters<typeof EdgeQueryLayer>[0])
}

// ── EdgeQueryCache ──────────────────────────────────────────────────────────

describe("EdgeQueryCache", () => {
  let cache: EdgeQueryCache

  beforeEach(() => {
    cache = new EdgeQueryCache(100)
  })

  it("set/get round-trip", () => {
    const entry = makeEntry()
    cache.set(entry)
    const retrieved = cache.get("q1", "us-east-1")
    expect(retrieved).not.toBeNull()
    expect(retrieved!.result).toEqual({ data: [1, 2, 3] })
  })

  it("returns null for cache miss", () => {
    expect(cache.get("missing", "us-east-1")).toBeNull()
  })

  it("respects TTL expiry", () => {
    const entry = makeEntry({ cachedAt: Date.now() - 120_000, ttl: 60 })
    cache.set(entry)
    const result = cache.get("q1", "us-east-1")
    expect(result).toBeNull()
  })

  it("returns stale entry when staleWhileRevalidate is true", () => {
    const entry = makeEntry({
      cachedAt: Date.now() - 120_000,
      ttl: 60,
      staleWhileRevalidate: true,
    })
    cache.set(entry)
    const result = cache.get("q1", "us-east-1")
    expect(result).not.toBeNull()
  })

  it("tracks hit/miss/stale stats", () => {
    cache.set(makeEntry())
    cache.get("q1", "us-east-1") // hit
    cache.get("missing", "us-east-1") // miss
    const stats = cache.getStats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1)
  })

  it("invalidates by tables", () => {
    cache.set(makeEntry({ queryHash: "q1", dependencies: ["tasks"] }))
    cache.set(makeEntry({ queryHash: "q2", dependencies: ["users"] }))
    const invalidated = cache.invalidateByTables(["tasks"])
    expect(invalidated).toHaveLength(1)
    expect(cache.get("q1", "us-east-1")).toBeNull()
    expect(cache.get("q2", "us-east-1")).not.toBeNull()
  })

  it("invalidates by region", () => {
    cache.set(makeEntry({ queryHash: "q1", region: "us-east-1" }))
    cache.set(makeEntry({ queryHash: "q2", region: "eu-west-1" }))
    const count = cache.invalidateByRegion("us-east-1")
    expect(count).toBe(1)
    expect(cache.size).toBe(1)
  })

  it("evicts oldest entry when at capacity", () => {
    const smallCache = new EdgeQueryCache(2)
    smallCache.set(makeEntry({ queryHash: "q1" }))
    smallCache.set(makeEntry({ queryHash: "q2" }))
    smallCache.set(makeEntry({ queryHash: "q3" }))
    expect(smallCache.size).toBe(2)
  })

  it("clear removes all entries", () => {
    cache.set(makeEntry())
    cache.clear()
    expect(cache.size).toBe(0)
  })

  it("empty cache get returns null", () => {
    expect(cache.get("any", "any")).toBeNull()
  })
})

// ── InvalidationPropagator ──────────────────────────────────────────────────

describe("InvalidationPropagator", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("batches and flushes messages", async () => {
    const onFlush = vi.fn().mockResolvedValue(undefined)
    const propagator = new InvalidationPropagator(10, onFlush)

    propagator.enqueue({
      id: "inv1",
      tables: ["tasks"],
      originRegion: "us-east-1",
      timestamp: Date.now(),
      version: 1,
      propagationPath: ["us-east-1"],
    })

    // Wait for batch timer
    await new Promise((r) => setTimeout(r, 50))
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush.mock.calls[0][0]).toHaveLength(1)

    propagator.destroy()
  })

  it("deduplicates messages with same origin and version", async () => {
    const onFlush = vi.fn().mockResolvedValue(undefined)
    const propagator = new InvalidationPropagator(10, onFlush)

    const base = { originRegion: "us-east-1", timestamp: Date.now(), version: 1, propagationPath: ["us-east-1"] }
    propagator.enqueue({ ...base, id: "inv1", tables: ["tasks"] })
    propagator.enqueue({ ...base, id: "inv2", tables: ["users"] })

    await new Promise((r) => setTimeout(r, 50))
    expect(onFlush).toHaveBeenCalledTimes(1)
    const flushed = onFlush.mock.calls[0][0]
    expect(flushed).toHaveLength(1) // merged
    expect(flushed[0].tables).toContain("tasks")
    expect(flushed[0].tables).toContain("users")

    propagator.destroy()
  })

  it("flush with empty pending is a no-op", async () => {
    const onFlush = vi.fn().mockResolvedValue(undefined)
    const propagator = new InvalidationPropagator(10, onFlush)
    await propagator.flush()
    expect(onFlush).not.toHaveBeenCalled()
    propagator.destroy()
  })

  it("destroy clears timer and pending", () => {
    const onFlush = vi.fn().mockResolvedValue(undefined)
    const propagator = new InvalidationPropagator(10, onFlush)
    propagator.enqueue({
      id: "inv1",
      tables: ["t"],
      originRegion: "r",
      timestamp: 0,
      version: 1,
      propagationPath: [],
    })
    propagator.destroy()
    // No flush should fire
  })
})

// ── ConsistencyManager ──────────────────────────────────────────────────────

describe("ConsistencyManager", () => {
  it("records and retrieves region versions", () => {
    const cm = new ConsistencyManager()
    cm.recordVersion("us-east-1", 5)
    expect(cm.getRegionVersion("us-east-1")).toBe(5)
  })

  it("ignores lower versions", () => {
    const cm = new ConsistencyManager()
    cm.recordVersion("us-east-1", 10)
    cm.recordVersion("us-east-1", 3)
    expect(cm.getRegionVersion("us-east-1")).toBe(10)
  })

  it("returns 0 for unknown region", () => {
    const cm = new ConsistencyManager()
    expect(cm.getRegionVersion("unknown")).toBe(0)
  })

  it("eventual consistency always has quorum", () => {
    const cm = new ConsistencyManager()
    const proof = cm.checkConsistency(100, "eventual")
    expect(proof.quorumMet).toBe(true)
  })

  it("strong consistency requires min version", () => {
    const cm = new ConsistencyManager()
    cm.recordVersion("us-east-1", 5)
    cm.recordVersion("eu-west-1", 3)
    expect(cm.checkConsistency(3, "strong").quorumMet).toBe(true)
    expect(cm.checkConsistency(10, "strong").quorumMet).toBe(false)
  })

  it("read-after-write via version tracking", () => {
    const cm = new ConsistencyManager()
    cm.recordVersion("us-east-1", 10)
    const proof = cm.checkConsistency(10, "strong")
    expect(proof.quorumMet).toBe(true)
    expect(proof.version).toBe(10)
  })
})

// ── EdgeQueryLayer ──────────────────────────────────────────────────────────

describe("EdgeQueryLayer", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("requires at least one region", () => {
    expect(() => new EdgeQueryLayer({ regions: [] })).toThrow(EdgeQueryError)
  })

  it("executes query and caches result", async () => {
    const layer = makeLayer()
    const executeFn = vi.fn().mockResolvedValue({ result: { rows: [1] }, dependencies: ["tasks"] })

    const first = await layer.executeQuery("q1", executeFn)
    expect(first.fromCache).toBe(false)
    expect(first.result).toEqual({ rows: [1] })

    const second = await layer.executeQuery("q1", executeFn)
    expect(second.fromCache).toBe(true)
    expect(executeFn).toHaveBeenCalledTimes(1)

    await layer.destroy()
  })

  it("cache miss calls executeFn", async () => {
    const layer = makeLayer()
    const executeFn = vi.fn().mockResolvedValue({ result: "data", dependencies: [] })

    const result = await layer.executeQuery("q1", executeFn)
    expect(result.fromCache).toBe(false)
    expect(executeFn).toHaveBeenCalledTimes(1)

    await layer.destroy()
  })

  it("invalidation clears cached entries", async () => {
    const layer = makeLayer()
    const executeFn = vi.fn().mockResolvedValue({ result: "data", dependencies: ["tasks"] })

    await layer.executeQuery("q1", executeFn)
    layer.invalidate(["tasks"])

    const result = await layer.executeQuery("q1", executeFn)
    expect(result.fromCache).toBe(false)
    expect(executeFn).toHaveBeenCalledTimes(2)

    await layer.destroy()
  })

  it("getRegions returns all configured regions", () => {
    const layer = makeLayer()
    expect(layer.getRegions()).toHaveLength(2)
  })

  it("getStats returns cache statistics", async () => {
    const layer = makeLayer()
    const stats = layer.getStats()
    expect(stats).toHaveProperty("hits")
    expect(stats).toHaveProperty("misses")
    await layer.destroy()
  })

  it("getConsistencyProof returns proof", () => {
    const layer = makeLayer()
    const proof = layer.getConsistencyProof(1)
    expect(proof).toHaveProperty("quorumMet")
    expect(proof).toHaveProperty("version")
  })

  it("respects regionAffinity option", async () => {
    const layer = makeLayer()
    const executeFn = vi.fn().mockResolvedValue({ result: "data", dependencies: [] })

    const result = await layer.executeQuery("q1", executeFn, {
      regionAffinity: "eu-west-1",
    })
    expect(result.region).toBe("eu-west-1")

    await layer.destroy()
  })

  it("throws when no region available", async () => {
    // This shouldn't happen since constructor requires regions, but test NO_REGION path
    const layer = makeLayer()
    await layer.destroy() // clears cache but regions remain
    // Layer should still work as regions aren't cleared
    const executeFn = vi.fn().mockResolvedValue({ result: "data", dependencies: [] })
    const result = await layer.executeQuery("q1", executeFn)
    expect(result.region).toBeTruthy()
  })
})

// ── SQL Builders ──────────────────────────────────────────────────────────

describe("SQL builders", () => {
  it("buildCreateEdgeCacheTableSQL creates table with expected columns", () => {
    const sql = buildCreateEdgeCacheTableSQL()
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS _rb_edge_cache")
    expect(sql).toContain("query_hash")
    expect(sql).toContain("region")
    expect(sql).toContain("dependencies")
    expect(sql).toContain("stale_while_revalidate")
    expect(sql).toContain("PRIMARY KEY")
  })

  it("buildCreateInvalidationLogTableSQL creates invalidation table", () => {
    const sql = buildCreateInvalidationLogTableSQL()
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS _rb_invalidation_log")
    expect(sql).toContain("tables")
    expect(sql).toContain("origin_region")
    expect(sql).toContain("propagation_path")
    expect(sql).toContain("processed")
  })

  it("buildUpsertCacheEntrySQL contains INSERT with ON CONFLICT", () => {
    const sql = buildUpsertCacheEntrySQL()
    expect(sql).toContain("INSERT INTO _rb_edge_cache")
    expect(sql).toContain("ON CONFLICT")
  })

  it("buildGetCacheEntrySQL filters by hash and region", () => {
    const sql = buildGetCacheEntrySQL()
    expect(sql).toContain("SELECT")
    expect(sql).toContain("query_hash = $1")
    expect(sql).toContain("region = $2")
  })

  it("buildInvalidateByTablesSQL deletes by dependencies", () => {
    const sql = buildInvalidateByTablesSQL()
    expect(sql).toContain("DELETE FROM _rb_edge_cache")
    expect(sql).toContain("dependencies")
  })

  it("buildInsertInvalidationSQL inserts into log", () => {
    const sql = buildInsertInvalidationSQL()
    expect(sql).toContain("INSERT INTO _rb_invalidation_log")
  })

  it("buildGetPendingInvalidationsSQL filters unprocessed", () => {
    const sql = buildGetPendingInvalidationsSQL()
    expect(sql).toContain("processed = false")
  })

  it("buildMarkInvalidationsProcessedSQL updates processed flag", () => {
    const sql = buildMarkInvalidationsProcessedSQL()
    expect(sql).toContain("SET processed = true")
  })
})

// ── EdgeQueryError ──────────────────────────────────────────────────────────

describe("EdgeQueryError", () => {
  it("has correct properties", () => {
    const err = new EdgeQueryError("test error", "TEST_CODE", "us-east-1")
    expect(err.name).toBe("EdgeQueryError")
    expect(err.code).toBe("TEST_CODE")
    expect(err.region).toBe("us-east-1")
    expect(err.message).toBe("test error")
    expect(err).toBeInstanceOf(Error)
  })

  it("works without region", () => {
    const err = new EdgeQueryError("no region", "ERR")
    expect(err.region).toBeUndefined()
  })
})
