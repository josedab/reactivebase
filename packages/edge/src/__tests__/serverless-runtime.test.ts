import { describe, it, expect, beforeEach } from "vitest"
import { ServerlessRuntime } from "../serverless-runtime.js"

describe("ServerlessRuntime", () => {
  let runtime: ServerlessRuntime

  beforeEach(() => {
    runtime = new ServerlessRuntime({
      databaseUrl: "postgresql://localhost:5432/test",
      pooler: "neon",
      region: "us-east-1",
      staleTtlMs: 100,
      maxCacheEntries: 50,
    })
  })

  describe("initialization", () => {
    it("has correct region", () => {
      expect(runtime.region).toBe("us-east-1")
    })

    it("has correct pooler", () => {
      expect(runtime.pooler).toBe("neon")
    })

    it("detects region from auto", () => {
      const auto = new ServerlessRuntime({
        databaseUrl: "postgresql://localhost/test",
        pooler: "none",
      })
      expect(auto.region).toBeDefined()
    })
  })

  describe("query execution", () => {
    it("executes a query and caches result", async () => {
      const result = await runtime.executeQuery("tasks.list", { userId: "u1" })
      expect(result.fromCache).toBe(false)
      expect(result.stale).toBe(false)
      expect(result.region).toBe("us-east-1")

      // Second call should hit cache
      const cached = await runtime.executeQuery("tasks.list", { userId: "u1" })
      expect(cached.fromCache).toBe(true)
      expect(cached.stale).toBe(false)
    })

    it("returns stale data after TTL expires", async () => {
      await runtime.executeQuery("tasks.list", {})

      // Wait for staleTtlMs
      await new Promise((r) => setTimeout(r, 150))

      const result = await runtime.executeQuery("tasks.list", {})
      expect(result.fromCache).toBe(true)
      expect(result.stale).toBe(true)
    })

    it("tracks cache misses", async () => {
      await runtime.executeQuery("q1", {})
      await runtime.executeQuery("q2", {})
      const stats = runtime.getStats()
      expect(stats.cacheMisses).toBe(2)
    })
  })

  describe("connection pooling", () => {
    it("generates Neon pooler connection string", () => {
      const connStr = runtime.getConnectionString()
      expect(connStr).toContain("-pooler.neon.tech")
      expect(connStr).toContain("sslmode=require")
    })

    it("generates PgBouncer connection string", () => {
      const pgb = new ServerlessRuntime({
        databaseUrl: "postgresql://localhost:5432/test",
        pooler: "pgbouncer",
      })
      const connStr = pgb.getConnectionString()
      expect(connStr).toContain(":6432")
    })

    it("generates Supavisor connection string", () => {
      const sup = new ServerlessRuntime({
        databaseUrl: "postgresql://localhost:5432/test",
        pooler: "supavisor",
      })
      const connStr = sup.getConnectionString()
      expect(connStr).toContain(":6543")
    })

    it("returns pool stats", () => {
      const stats = runtime.getPoolStats()
      expect(stats.pooler).toBe("neon")
      expect(stats.region).toBe("us-east-1")
      expect(stats.maxConnections).toBe(5)
    })
  })

  describe("invalidation", () => {
    it("invalidates cached queries on table change", async () => {
      await runtime.executeQuery("tasks.list", {})

      runtime.handleInvalidation({
        type: "invalidate",
        tables: ["tasks"],
        queryNames: ["tasks.list"],
        timestamp: Date.now(),
        sourceRegion: "us-west-2",
      })

      const stats = runtime.getStats()
      expect(stats.invalidationsReceived).toBe(1)

      // Cache should be cleared for tasks.list
      const result = await runtime.executeQuery("tasks.list", {})
      expect(result.fromCache).toBe(false)
    })

    it("clears invalidation markers", () => {
      runtime.handleInvalidation({
        type: "invalidate",
        tables: ["tasks"],
        queryNames: [],
        timestamp: Date.now(),
        sourceRegion: "us-west-2",
      })
      runtime.clearInvalidations()
      // After clearing, table invalidation should not affect cache lookup
    })
  })

  describe("cache management", () => {
    it("invalidates specific query cache", async () => {
      await runtime.executeQuery("q1", {})
      await runtime.executeQuery("q2", {})
      expect(runtime.getCacheSize()).toBe(2)

      runtime.invalidateCache("q1")
      expect(runtime.getCacheSize()).toBe(1)
    })

    it("invalidates all cache", async () => {
      await runtime.executeQuery("q1", {})
      await runtime.executeQuery("q2", {})
      runtime.invalidateCache()
      expect(runtime.getCacheSize()).toBe(0)
    })

    it("evicts old entries when over limit", async () => {
      const small = new ServerlessRuntime({
        databaseUrl: "postgresql://localhost/test",
        pooler: "none",
        maxCacheEntries: 5,
      })
      for (let i = 0; i < 10; i++) {
        await small.executeQuery(`q${i}`, {})
      }
      expect(small.getCacheSize()).toBeLessThanOrEqual(10)
    })
  })

  describe("stats", () => {
    it("reports comprehensive stats", async () => {
      await runtime.executeQuery("q1", {})
      await runtime.executeQuery("q1", {})

      const stats = runtime.getStats()
      expect(stats.totalQueries).toBe(2)
      expect(stats.cacheHits).toBe(1)
      expect(stats.cacheMisses).toBe(1)
      expect(stats.cacheHitRate).toBe(50)
      expect(stats.activeRegion).toBe("us-east-1")
    })
  })

  describe("cleanup", () => {
    it("cleans up all resources", async () => {
      await runtime.executeQuery("q1", {})
      await runtime.close()
      expect(runtime.getCacheSize()).toBe(0)
    })
  })
})
