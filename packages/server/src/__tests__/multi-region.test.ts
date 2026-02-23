import { describe, it, expect, beforeEach } from "vitest"
import {
  RegionManager,
  RegionRouter,
  mergeVectorClocks,
  incrementClock,
  happenedBefore,
  areConcurrent,
} from "../multi-region/multi-region.js"
import type { VectorClock, RegionStatus } from "../multi-region/multi-region.js"

// ─── Vector Clock Tests ──────────────────────────────────────────────────────

describe("Vector Clocks", () => {
  it("merges two clocks", () => {
    const a: VectorClock = { "us-east": 3, "eu-west": 1 }
    const b: VectorClock = { "us-east": 2, "eu-west": 4, "ap-south": 1 }
    const merged = mergeVectorClocks(a, b)

    expect(merged["us-east"]).toBe(3)
    expect(merged["eu-west"]).toBe(4)
    expect(merged["ap-south"]).toBe(1)
  })

  it("increments clock for a region", () => {
    const clock: VectorClock = { "us-east": 3 }
    const updated = incrementClock(clock, "us-east")
    expect(updated["us-east"]).toBe(4)
  })

  it("increments new region from 0", () => {
    const clock: VectorClock = { "us-east": 3 }
    const updated = incrementClock(clock, "eu-west")
    expect(updated["eu-west"]).toBe(1)
  })

  it("detects happened-before", () => {
    const a: VectorClock = { r1: 1, r2: 1 }
    const b: VectorClock = { r1: 2, r2: 2 }
    expect(happenedBefore(a, b)).toBe(true)
    expect(happenedBefore(b, a)).toBe(false)
  })

  it("detects equal clocks as not happened-before", () => {
    const a: VectorClock = { r1: 3 }
    const b: VectorClock = { r1: 3 }
    expect(happenedBefore(a, b)).toBe(false)
  })

  it("detects concurrent events", () => {
    const a: VectorClock = { r1: 2, r2: 1 }
    const b: VectorClock = { r1: 1, r2: 2 }
    expect(areConcurrent(a, b)).toBe(true)
  })

  it("non-concurrent events are not concurrent", () => {
    const a: VectorClock = { r1: 1 }
    const b: VectorClock = { r1: 2 }
    expect(areConcurrent(a, b)).toBe(false)
  })
})

// ─── Region Router ───────────────────────────────────────────────────────────

describe("RegionRouter", () => {
  let router: RegionRouter
  const regions: RegionStatus[] = [
    {
      id: "us-east",
      host: "us-east.example.com",
      status: "healthy",
      latencyMs: 10,
      lagMs: 0,
      lastHealthCheck: Date.now(),
      isPrimary: true,
      connectionCount: 100,
    },
    {
      id: "eu-west",
      host: "eu-west.example.com",
      status: "healthy",
      latencyMs: 80,
      lagMs: 5,
      lastHealthCheck: Date.now(),
      isPrimary: false,
      connectionCount: 50,
    },
    {
      id: "ap-south",
      host: "ap-south.example.com",
      status: "unreachable",
      latencyMs: Infinity,
      lagMs: 0,
      lastHealthCheck: Date.now(),
      isPrimary: false,
      connectionCount: 0,
    },
  ]

  beforeEach(() => {
    router = new RegionRouter()
    router.updateTopology(regions)
  })

  it("routes reads to lowest latency healthy region", () => {
    const decision = router.routeRead()
    expect(decision.targetRegion).toBe("us-east")
    expect(decision.latencyMs).toBe(10)
  })

  it("routes reads to preferred region if healthy", () => {
    const decision = router.routeRead("eu-west")
    expect(decision.targetRegion).toBe("eu-west")
  })

  it("falls back if preferred region is unhealthy", () => {
    const decision = router.routeRead("ap-south")
    expect(decision.targetRegion).not.toBe("ap-south")
  })

  it("routes writes to primary region", () => {
    const decision = router.routeWrite()
    expect(decision.targetRegion).toBe("us-east")
  })

  it("fails over writes if primary is down", () => {
    router.updateTopology([{ ...regions[0], status: "unreachable" }, regions[1], regions[2]])
    const decision = router.routeWrite()
    expect(decision.targetRegion).toBe("eu-west")
    expect(decision.reason).toContain("failover")
  })

  it("reports topology", () => {
    const topology = router.getTopology()
    expect(topology.totalRegions).toBe(3)
    expect(topology.healthyRegions).toBe(2)
    expect(topology.primaryRegion).toBe("us-east")
  })
})

// ─── Region Manager ──────────────────────────────────────────────────────────

describe("RegionManager", () => {
  let manager: RegionManager

  beforeEach(() => {
    manager = new RegionManager({
      regionId: "us-east",
      regions: [
        { id: "us-east", host: "us.example.com", primary: true },
        { id: "eu-west", host: "eu.example.com" },
      ],
    })
  })

  it("initializes with correct region ID", () => {
    expect(manager.getRegionId()).toBe("us-east")
  })

  it("creates replication events with vector clock", () => {
    const event = manager.createEvent("insert", "tasks", "t1", { title: "Test" })
    expect(event.sourceRegion).toBe("us-east")
    expect(event.type).toBe("insert")
    expect(event.vectorClock["us-east"]).toBe(1)
  })

  it("increments vector clock on each event", () => {
    manager.createEvent("insert", "tasks", "t1", {})
    const event2 = manager.createEvent("insert", "tasks", "t2", {})
    expect(event2.vectorClock["us-east"]).toBe(2)
  })

  it("receives remote events and merges clocks", () => {
    manager.receiveEvent({
      id: "e1",
      sourceRegion: "eu-west",
      targetRegion: "us-east",
      type: "insert",
      table: "tasks",
      rowId: "t1",
      data: { title: "Remote" },
      vectorClock: { "eu-west": 5 },
      timestamp: Date.now(),
    })

    const clock = manager.getClock()
    expect(clock["eu-west"]).toBe(5)
    expect(clock["us-east"]).toBeGreaterThan(0)
  })

  it("detects conflicts for concurrent writes", () => {
    // Local write
    manager.createEvent("update", "tasks", "t1", { title: "Local" })

    // Remote concurrent write
    const conflict = manager.receiveEvent({
      id: "e2",
      sourceRegion: "eu-west",
      targetRegion: "us-east",
      type: "update",
      table: "tasks",
      rowId: "t1",
      data: { title: "Remote" },
      vectorClock: { "eu-west": 1 }, // Concurrent — doesn't include us-east clock
      timestamp: Date.now() + 100,
    })

    expect(conflict).not.toBeNull()
    expect(conflict!.resolution).toBeDefined()
  })

  it("resolves conflicts with last-write-wins", () => {
    manager.createEvent("update", "tasks", "t1", { title: "Local" })

    const conflict = manager.receiveEvent({
      id: "e2",
      sourceRegion: "eu-west",
      targetRegion: "us-east",
      type: "update",
      table: "tasks",
      rowId: "t1",
      data: { title: "Remote" },
      vectorClock: { "eu-west": 1 },
      timestamp: Date.now() + 1000, // Later timestamp
    })

    if (conflict) {
      expect(conflict.resolution).toBe("remote")
    }
  })

  it("acknowledges replicated events", () => {
    const e1 = manager.createEvent("insert", "tasks", "t1", {})
    const e2 = manager.createEvent("insert", "tasks", "t2", {})
    expect(manager.getPendingEvents()).toHaveLength(2)

    manager.acknowledgeEvents([e1.id])
    expect(manager.getPendingEvents()).toHaveLength(1)
  })

  it("promotes a region to primary", () => {
    manager.promoteToPrimary("eu-west")
    const topology = manager.getTopology()
    expect(topology.primaryRegion).toBe("eu-west")
  })

  it("routes reads and writes", () => {
    const readDecision = manager.routeRead()
    expect(readDecision.targetRegion).toBeDefined()

    const writeDecision = manager.routeWrite()
    expect(writeDecision.targetRegion).toBe("us-east")
  })

  it("tracks replication stats", () => {
    manager.createEvent("insert", "tasks", "t1", {})
    manager.receiveEvent({
      id: "e1",
      sourceRegion: "eu-west",
      targetRegion: "us-east",
      type: "insert",
      table: "users",
      rowId: "u1",
      data: {},
      vectorClock: { "eu-west": 1 },
      timestamp: Date.now(),
    })

    const stats = manager.getStats()
    expect(stats.eventsReplicated).toBe(1)
    expect(stats.pendingEvents).toBe(1)
  })

  it("starts and stops health checks", () => {
    manager.start()
    manager.stop() // Should not throw
  })
})
