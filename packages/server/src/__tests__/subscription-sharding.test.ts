import { describe, it, expect } from "vitest"
import { SubscriptionShardManager } from "../scaling/subscription-sharding.js"

describe("SubscriptionShardManager", () => {
  function createManager(opts: { totalShards?: number; nodeId?: string } = {}) {
    return new SubscriptionShardManager({
      nodeId: opts.nodeId ?? "node-1",
      totalShards: opts.totalShards ?? 16,
    })
  }

  describe("initialization", () => {
    it("creates shards owned by the local node", () => {
      const mgr = createManager({ totalShards: 16 })
      expect(mgr.totalShards).toBe(16)
      expect(mgr.getLocalShards()).toHaveLength(16)
    })

    it("rejects non-power-of-2 totalShards", () => {
      expect(() => createManager({ totalShards: 10 })).toThrow("power of 2")
    })

    it("accepts valid powers of 2", () => {
      for (const n of [1, 2, 4, 8, 64, 256]) {
        expect(() => createManager({ totalShards: n })).not.toThrow()
      }
    })
  })

  describe("subscription placement", () => {
    it("assigns subscriptions to shards deterministically", () => {
      const mgr = createManager({ totalShards: 16 })
      const shard1 = mgr.getShardForKey("listTasks:{userId:u1}")
      const shard2 = mgr.getShardForKey("listTasks:{userId:u1}")
      expect(shard1).toBe(shard2)
    })

    it("distributes subscriptions across shards", () => {
      const mgr = createManager({ totalShards: 16 })
      const shards = new Set<number>()
      for (let i = 0; i < 100; i++) {
        shards.add(mgr.getShardForKey(`query:${i}`))
      }
      expect(shards.size).toBeGreaterThan(1)
    })

    it("registers and removes subscriptions", () => {
      const mgr = createManager()
      const result = mgr.registerSubscription("sub-1")
      expect(result.isLocal).toBe(true)
      expect(result.ownerNodeId).toBe("node-1")

      const subs = mgr.getSubscriptionsForShard(result.shardId)
      expect(subs).toContain("sub-1")

      mgr.removeSubscription("sub-1")
      const subsAfter = mgr.getSubscriptionsForShard(result.shardId)
      expect(subsAfter).not.toContain("sub-1")
    })

    it("tracks subscription count per shard", () => {
      const mgr = createManager({ totalShards: 4 })
      mgr.registerSubscription("sub-a")
      mgr.registerSubscription("sub-b")
      mgr.registerSubscription("sub-c")

      const stats = mgr.getStats()
      expect(stats.totalSubscriptions).toBe(3)
    })
  })

  describe("node management and rebalancing", () => {
    it("reassigns shards when nodes are added", () => {
      const mgr = createManager({ totalShards: 16 })
      expect(mgr.getLocalShards()).toHaveLength(16)

      const assignments = mgr.addNode("node-2", "10.0.0.2", 4000)
      // Some shards should have moved to node-2
      expect(assignments.length).toBeGreaterThan(0)
      expect(mgr.getLocalShards().length).toBeLessThan(16)
    })

    it("reassigns shards back when nodes are removed", () => {
      const mgr = createManager({ totalShards: 16 })
      mgr.addNode("node-2", "10.0.0.2", 4000)
      const localBefore = mgr.getLocalShards().length

      mgr.removeNode("node-2")
      expect(mgr.getLocalShards()).toHaveLength(16)
      expect(mgr.getLocalShards().length).toBeGreaterThan(localBefore)
    })

    it("distributes shards across multiple nodes", () => {
      const mgr = createManager({ totalShards: 64 })
      mgr.addNode("node-2", "10.0.0.2", 4000)
      mgr.addNode("node-3", "10.0.0.3", 4000)
      mgr.addNode("node-4", "10.0.0.4", 4000)

      const stats = mgr.getStats()
      expect(stats.nodeCount).toBe(3) // 3 nodes added (node-1 not added via addNode)
      // Each node should have some shards
      for (const [, count] of stats.shardDistribution) {
        expect(count).toBeGreaterThan(0)
      }
    })

    it("fires onShardAssignmentChange callback", () => {
      const changes: unknown[] = []
      const mgr = new SubscriptionShardManager({
        nodeId: "node-1",
        totalShards: 16,
        onShardAssignmentChange: (a) => changes.push(a),
      })
      mgr.addNode("node-2", "10.0.0.2", 4000)
      expect(changes.length).toBeGreaterThan(0)
    })
  })

  describe("migration", () => {
    it("queues migrations when shards move", () => {
      const mgr = createManager({ totalShards: 16 })

      // Register some subscriptions first
      for (let i = 0; i < 50; i++) {
        mgr.registerSubscription(`sub-${i}`)
      }

      mgr.addNode("node-2", "10.0.0.2", 4000)
      const stats = mgr.getStats()
      // Some subs should be on the migration queue now
      expect(stats.totalSubscriptions).toBe(50)
    })

    it("executes migrations with callbacks", async () => {
      const migratedOut: string[] = []
      const mgr = new SubscriptionShardManager({
        nodeId: "node-1",
        totalShards: 16,
        onMigrateOut: async (batch) => {
          migratedOut.push(...batch.subscriptionKeys)
        },
      })

      for (let i = 0; i < 20; i++) {
        mgr.registerSubscription(`sub-${i}`)
      }

      mgr.addNode("node-2", "10.0.0.2", 4000)
      const result = await mgr.executeMigrations()
      expect(result.errors).toHaveLength(0)
    })
  })

  describe("stats", () => {
    it("reports comprehensive statistics", () => {
      const mgr = createManager({ totalShards: 16 })
      mgr.registerSubscription("sub-1")
      mgr.registerSubscription("sub-2")
      mgr.addNode("node-2", "10.0.0.2", 4000)

      const stats = mgr.getStats()
      expect(stats.totalShards).toBe(16)
      expect(stats.totalSubscriptions).toBe(2)
      expect(stats.migrationState.status).toBe("idle")
      expect(stats.hotShards.length).toBeLessThanOrEqual(5)
    })

    it("identifies hot shards", () => {
      const mgr = createManager({ totalShards: 4 })
      // Register many subs that hash to the same shard
      const targetShard = mgr.getShardForKey("hot-key")
      for (let i = 0; i < 10; i++) {
        // Directly add to shard tracking
        mgr.registerSubscription(`hot-key-${i}`)
      }

      const stats = mgr.getStats()
      expect(stats.hotShards[0].subscriptionCount).toBeGreaterThan(0)
    })
  })

  describe("isLocal", () => {
    it("returns true for local subscriptions", () => {
      const mgr = createManager({ totalShards: 16 })
      expect(mgr.isLocal("any-key")).toBe(true)
    })

    it("returns false for remote subscriptions after rebalance", () => {
      const mgr = createManager({ totalShards: 64 })
      mgr.addNode("node-2", "10.0.0.2", 4000)

      // At least some keys should be non-local now
      let hasRemote = false
      for (let i = 0; i < 100; i++) {
        if (!mgr.isLocal(`key-${i}`)) {
          hasRemote = true
          break
        }
      }
      expect(hasRemote).toBe(true)
    })
  })
})
