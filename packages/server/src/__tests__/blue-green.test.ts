import { describe, it, expect, vi } from "vitest"
import {
  VersionRouter,
  SubscriptionMigrator,
  DeploymentCoordinator,
} from "../blue-green/blue-green.js"

describe("VersionRouter", () => {
  it("routes connections based on canary percentage", () => {
    const router = new VersionRouter()
    router.setVersions("v1", "v2", 50)

    const versions = new Set<string>()
    for (let i = 0; i < 200; i++) {
      versions.add(router.routeConnection(`conn_${i}`))
    }

    expect(versions.has("v1")).toBe(true)
    expect(versions.has("v2")).toBe(true)
  })

  it("maintains sticky routing for existing connections", () => {
    const router = new VersionRouter()
    router.setVersions("v1", "v2", 50)

    const first = router.routeConnection("conn1")
    const second = router.routeConnection("conn1")

    expect(first).toBe(second)
  })

  it("tracks connection distribution", () => {
    const router = new VersionRouter()
    router.setVersions("v1", "v2", 100)

    router.routeConnection("conn1")
    router.routeConnection("conn2")

    const dist = router.getDistribution()
    expect(dist.size).toBeGreaterThan(0)
    expect(router.getRouteCount()).toBe(2)
  })

  it("removes connections", () => {
    const router = new VersionRouter()
    router.setVersions("v1", "v2", 50)

    router.routeConnection("conn1")
    router.removeConnection("conn1")

    expect(router.getRouteCount()).toBe(0)
  })
})

describe("SubscriptionMigrator", () => {
  it("queues and processes migrations", async () => {
    const migrator = new SubscriptionMigrator()

    migrator.queueMigration("conn1", [
      { subscriptionId: "sub1", queryName: "listTasks", args: {} },
      { subscriptionId: "sub2", queryName: "listUsers", args: {} },
    ], "v1", "v2")

    expect(migrator.getPendingCount()).toBe(2)

    const result = await migrator.processBatch(10, async () => true)

    expect(result.migrated).toBe(2)
    expect(result.failed).toBe(0)
    expect(migrator.getPendingCount()).toBe(0)
  })

  it("handles migration failures", async () => {
    const migrator = new SubscriptionMigrator()

    migrator.queueMigration("conn1", [
      { subscriptionId: "sub1", queryName: "q1", args: {} },
    ], "v1", "v2")

    const result = await migrator.processBatch(10, async () => false)

    expect(result.migrated).toBe(0)
    expect(result.failed).toBe(1)
  })

  it("reports stats", async () => {
    const migrator = new SubscriptionMigrator()

    migrator.queueMigration("conn1", [
      { subscriptionId: "sub1", queryName: "q1", args: {} },
      { subscriptionId: "sub2", queryName: "q2", args: {} },
    ], "v1", "v2")

    await migrator.processBatch(1, async () => true)

    const stats = migrator.getStats()
    expect(stats.total).toBe(2)
    expect(stats.migrated).toBe(1)
    expect(stats.pending).toBe(1)
  })
})

describe("DeploymentCoordinator", () => {
  it("runs a canary deployment lifecycle", () => {
    const coord = new DeploymentCoordinator({ canaryPercentage: 10, rolloutStepPercentage: 45 })
    coord.registerVersion("v1")
    coord.registerVersion("v2")

    coord.startCanaryDeployment("v1", "v2")
    expect(coord.getState().phase).toBe("canary")
    expect(coord.getState().currentPercentage).toBe(10)

    coord.advanceRollout()
    expect(coord.getState().phase).toBe("rolling")
    expect(coord.getState().currentPercentage).toBe(55)

    coord.advanceRollout()
    expect(coord.getState().phase).toBe("complete")
    expect(coord.getState().currentPercentage).toBe(100)
  })

  it("triggers rollback on high error rate", () => {
    const events: string[] = []
    const coord = new DeploymentCoordinator({ errorRateThreshold: 0.1 })
    coord.registerVersion("v1")
    coord.registerVersion("v2")
    coord.onEvent((e) => events.push(e.type))

    coord.startCanaryDeployment("v1", "v2")

    // Simulate requests with high error rate
    for (let i = 0; i < 10; i++) coord.recordRequest("v2")
    for (let i = 0; i < 5; i++) coord.recordError("v2", "500 error")

    expect(coord.getState().phase).toBe("rolled_back")
    expect(events).toContain("rollback_triggered")
  })

  it("rejects deployment when one is already running", () => {
    const coord = new DeploymentCoordinator()
    coord.registerVersion("v1")
    coord.registerVersion("v2")
    coord.registerVersion("v3")

    coord.startCanaryDeployment("v1", "v2")

    expect(() => coord.startCanaryDeployment("v2", "v3")).toThrow("already in progress")
  })

  it("emits phase change events", () => {
    const events: string[] = []
    const coord = new DeploymentCoordinator()
    coord.registerVersion("v1")
    coord.registerVersion("v2")
    coord.onEvent((e) => events.push(e.type))

    coord.startCanaryDeployment("v1", "v2")
    expect(events).toContain("phase_changed")
  })

  it("routes connections to versions", () => {
    const coord = new DeploymentCoordinator({ canaryPercentage: 100 })
    coord.registerVersion("v1")
    coord.registerVersion("v2")

    coord.startCanaryDeployment("v1", "v2")

    const version = coord.routeConnection("conn1")
    expect(["v1", "v2"]).toContain(version)
  })
})
