import { describe, it, expect, beforeEach } from "vitest"
import { ConsistentHashRing, ClusterManager } from "../scaling/scaling.js"
import type { ClusterMessage } from "../scaling/scaling.js"

describe("ConsistentHashRing", () => {
  let ring: ConsistentHashRing

  beforeEach(() => {
    ring = new ConsistentHashRing(50)
  })

  it("routes keys after adding nodes", () => {
    ring.addNode("node-1")
    ring.addNode("node-2")
    const node = ring.getNode("test-key")
    expect(node).toBeDefined()
    expect(["node-1", "node-2"]).toContain(node)
  })

  it("returns undefined when empty", () => {
    expect(ring.getNode("key")).toBeUndefined()
  })

  it("distributes keys across nodes", () => {
    ring.addNode("a")
    ring.addNode("b")
    ring.addNode("c")

    const counts: Record<string, number> = { a: 0, b: 0, c: 0 }
    for (let i = 0; i < 300; i++) {
      const node = ring.getNode(`key-${i}`)!
      counts[node]++
    }

    // Each node should get at least some keys
    expect(counts.a).toBeGreaterThan(10)
    expect(counts.b).toBeGreaterThan(10)
    expect(counts.c).toBeGreaterThan(10)
  })

  it("maintains consistency when node is added", () => {
    ring.addNode("a")
    ring.addNode("b")

    const before = new Map<string, string>()
    for (let i = 0; i < 100; i++) {
      before.set(`key-${i}`, ring.getNode(`key-${i}`)!)
    }

    ring.addNode("c")

    let unchanged = 0
    for (let i = 0; i < 100; i++) {
      if (ring.getNode(`key-${i}`) === before.get(`key-${i}`)) unchanged++
    }

    // Most keys should stay with the same node
    expect(unchanged).toBeGreaterThan(50)
  })

  it("removes node correctly", () => {
    ring.addNode("a")
    ring.addNode("b")
    ring.removeNode("a")
    expect(ring.nodeCount).toBe(1)

    // All keys should route to b
    for (let i = 0; i < 10; i++) {
      expect(ring.getNode(`key-${i}`)).toBe("b")
    }
  })

  it("gets multiple distinct nodes", () => {
    ring.addNode("a")
    ring.addNode("b")
    ring.addNode("c")
    const nodes = ring.getNodes("key", 2)
    expect(nodes).toHaveLength(2)
    expect(new Set(nodes).size).toBe(2)
  })

  it("respects node weight", () => {
    ring.addNode("heavy", 3)
    ring.addNode("light", 1)
    expect(ring.size).toBeGreaterThan(0)

    // Heavy node should get more keys
    let heavyCount = 0
    for (let i = 0; i < 200; i++) {
      if (ring.getNode(`key-${i}`) === "heavy") heavyCount++
    }
    expect(heavyCount).toBeGreaterThan(100)
  })
})

describe("ClusterManager", () => {
  let manager: ClusterManager
  let broadcasts: ClusterMessage[]

  beforeEach(() => {
    broadcasts = []
    manager = new ClusterManager({
      nodeId: "server-1",
      virtualNodes: 50,
      onBroadcast: (msg) => broadcasts.push(msg),
    })
  })

  describe("node management", () => {
    it("adds nodes", () => {
      manager.addNode({ id: "server-1", host: "10.0.0.1", port: 4000 })
      manager.addNode({ id: "server-2", host: "10.0.0.2", port: 4000 })
      expect(manager.nodeCount).toBe(2)
      expect(manager.activeNodeCount).toBe(2)
    })

    it("removes nodes", () => {
      manager.addNode({ id: "server-1", host: "10.0.0.1", port: 4000 })
      manager.addNode({ id: "server-2", host: "10.0.0.2", port: 4000 })
      manager.removeNode("server-2")
      expect(manager.nodeCount).toBe(1)
    })

    it("retrieves node info", () => {
      manager.addNode({ id: "server-1", host: "10.0.0.1", port: 4000 })
      const node = manager.getNode("server-1")
      expect(node?.host).toBe("10.0.0.1")
      expect(node?.status).toBe("active")
    })
  })

  describe("subscription routing", () => {
    it("routes subscriptions to nodes", () => {
      manager.addNode({ id: "server-1", host: "10.0.0.1", port: 4000 })
      manager.addNode({ id: "server-2", host: "10.0.0.2", port: 4000 })

      const route = manager.routeSubscription("listTasks", { userId: "u1" })
      expect(route.targetNodeId).toBeDefined()
      expect(route.subscriptionKey).toContain("listTasks")
    })

    it("consistently routes same query to same node", () => {
      manager.addNode({ id: "server-1", host: "10.0.0.1", port: 4000 })
      manager.addNode({ id: "server-2", host: "10.0.0.2", port: 4000 })

      const route1 = manager.routeSubscription("listTasks", { userId: "u1" })
      const route2 = manager.routeSubscription("listTasks", { userId: "u1" })
      expect(route1.targetNodeId).toBe(route2.targetNodeId)
    })

    it("checks local subscription", () => {
      manager.addNode({ id: "server-1", host: "10.0.0.1", port: 4000 })
      // With only one node, all subscriptions are local
      expect(manager.isLocalSubscription("q", {})).toBe(true)
    })

    it("tracks subscription counts", () => {
      manager.addNode({ id: "server-1", host: "10.0.0.1", port: 4000 })
      manager.routeSubscription("q1", {})
      manager.routeSubscription("q2", {})

      const node = manager.getNode("server-1")!
      expect(node.subscriptionCount).toBe(2)
    })

    it("removes subscription routes", () => {
      manager.addNode({ id: "server-1", host: "10.0.0.1", port: 4000 })
      manager.routeSubscription("q1", {})
      manager.removeSubscriptionRoute("q1", {})
      const node = manager.getNode("server-1")!
      expect(node.subscriptionCount).toBe(0)
    })
  })

  describe("invalidation broadcasting", () => {
    it("broadcasts invalidation messages", () => {
      manager.broadcastInvalidation({
        tables: ["tasks"],
        changeSet: [{ table: "tasks", operation: "insert", rowIds: ["r1"] }],
      })
      expect(broadcasts).toHaveLength(1)
      expect(broadcasts[0].type).toBe("invalidation")
      expect(broadcasts[0].sourceNodeId).toBe("server-1")
    })
  })

  describe("graceful drain", () => {
    it("drains a node and migrates subscriptions", () => {
      manager.addNode({ id: "server-1", host: "10.0.0.1", port: 4000 })
      manager.addNode({ id: "server-2", host: "10.0.0.2", port: 4000 })

      // Route subscriptions to both nodes
      for (let i = 0; i < 10; i++) {
        manager.routeSubscription(`q-${i}`, { i })
      }

      const result = manager.drainNode("server-1")
      expect(result.durationMs).toBeGreaterThanOrEqual(0)

      const node1 = manager.getNode("server-1")!
      expect(node1.status).toBe("draining")
      expect(node1.subscriptionCount).toBe(0)
    })
  })

  describe("health checking", () => {
    it("marks node unhealthy after max failures", () => {
      manager.addNode({ id: "server-2", host: "10.0.0.2", port: 4000 })

      manager.reportHealthCheckFailure("server-2")
      manager.reportHealthCheckFailure("server-2")
      manager.reportHealthCheckFailure("server-2")

      const node = manager.getNode("server-2")!
      expect(node.status).toBe("unhealthy")
    })

    it("recovers node on health check success", () => {
      manager.addNode({ id: "server-2", host: "10.0.0.2", port: 4000 })

      // Make unhealthy
      for (let i = 0; i < 3; i++) manager.reportHealthCheckFailure("server-2")
      expect(manager.getNode("server-2")!.status).toBe("unhealthy")

      // Recover
      manager.reportHealthCheckSuccess("server-2")
      expect(manager.getNode("server-2")!.status).toBe("active")
    })

    it("starts and stops health checks", () => {
      manager.startHealthChecks()
      manager.stopHealthChecks()
    })
  })

  describe("cluster stats", () => {
    it("returns cluster statistics", () => {
      manager.addNode({ id: "server-1", host: "10.0.0.1", port: 4000 })
      manager.addNode({ id: "server-2", host: "10.0.0.2", port: 4000 })
      manager.routeSubscription("q1", {})

      const stats = manager.getStats()
      expect(stats.totalNodes).toBe(2)
      expect(stats.activeNodes).toBe(2)
      expect(stats.totalSubscriptions).toBe(1)
      expect(stats.ringSize).toBeGreaterThan(0)
    })
  })
})
