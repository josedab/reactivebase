import { describe, it, expect, vi } from "vitest"
import {
  VersionRouter,
  SubscriptionMigrator,
  DeploymentCoordinator,
  generateDeploymentTableSQL,
} from "../blue-green/blue-green.js"
import type { QueryExecutor } from "../blue-green/blue-green.js"

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

    migrator.queueMigration(
      "conn1",
      [
        { subscriptionId: "sub1", queryName: "listTasks", args: {} },
        { subscriptionId: "sub2", queryName: "listUsers", args: {} },
      ],
      "v1",
      "v2",
    )

    expect(migrator.getPendingCount()).toBe(2)

    const result = await migrator.processBatch(10, async () => true)

    expect(result.migrated).toBe(2)
    expect(result.failed).toBe(0)
    expect(migrator.getPendingCount()).toBe(0)
  })

  it("handles migration failures", async () => {
    const migrator = new SubscriptionMigrator()

    migrator.queueMigration("conn1", [{ subscriptionId: "sub1", queryName: "q1", args: {} }], "v1", "v2")

    const result = await migrator.processBatch(10, async () => false)

    expect(result.migrated).toBe(0)
    expect(result.failed).toBe(1)
  })

  it("reports stats", async () => {
    const migrator = new SubscriptionMigrator()

    migrator.queueMigration(
      "conn1",
      [
        { subscriptionId: "sub1", queryName: "q1", args: {} },
        { subscriptionId: "sub2", queryName: "q2", args: {} },
      ],
      "v1",
      "v2",
    )

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

// ── Helpers for DB persistence tests ─────────────────────────────────────────

function createMockDb(): QueryExecutor & ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({ rows: [] })
}

// ── DB Persistence Tests ─────────────────────────────────────────────────────

describe("generateDeploymentTableSQL", () => {
  it("contains expected table names and columns", () => {
    const sql = generateDeploymentTableSQL()

    expect(sql).toContain("_reactivebase_deployments")
    expect(sql).toContain("_reactivebase_subscription_migrations")
    expect(sql).toContain("blue_version")
    expect(sql).toContain("green_version")
    expect(sql).toContain("canary_percent")
    expect(sql).toContain("phase")
    expect(sql).toContain("deployment_id")
    expect(sql).toContain("subscription_id")
    expect(sql).toContain("from_version")
    expect(sql).toContain("to_version")
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS")
  })
})

describe("DeploymentCoordinator DB persistence", () => {
  it("initTables executes deployment table SQL statements", async () => {
    const mockDb = createMockDb()
    const coord = new DeploymentCoordinator({ db: mockDb })

    await coord.initTables()

    expect(mockDb).toHaveBeenCalled()
    const allSql = mockDb.mock.calls.map((c: unknown[]) => c[0] as string).join(" ")
    expect(allSql).toContain("_reactivebase_deployments")
    expect(allSql).toContain("_reactivebase_subscription_migrations")
  })

  it("initTables is a no-op without db", async () => {
    const coord = new DeploymentCoordinator()
    await expect(coord.initTables()).resolves.toBeUndefined()
  })

  it("persistState is called after startCanaryDeployment", async () => {
    const mockDb = createMockDb()
    const coord = new DeploymentCoordinator({ db: mockDb })
    coord.registerVersion("v1")
    coord.registerVersion("v2")

    coord.startCanaryDeployment("v1", "v2")

    // Wait for the async persistState to settle
    await vi.waitFor(() => {
      const insertCalls = mockDb.mock.calls.filter((c: unknown[]) =>
        (c[0] as string).includes("INSERT INTO _reactivebase_deployments"),
      )
      expect(insertCalls.length).toBeGreaterThanOrEqual(1)
    })

    const insertCall = mockDb.mock.calls.find((c: unknown[]) =>
      (c[0] as string).includes("INSERT INTO _reactivebase_deployments"),
    )!
    const params = insertCall[1] as unknown[]
    expect(params).toContain("v1")
    expect(params).toContain("v2")
    expect(params).toContain("canary")
  })

  it("persistState is called after triggerRollback", async () => {
    const mockDb = createMockDb()
    const coord = new DeploymentCoordinator({ db: mockDb })
    coord.registerVersion("v1")
    coord.registerVersion("v2")

    coord.startCanaryDeployment("v1", "v2")
    mockDb.mockClear()

    coord.triggerRollback({
      trigger: "manual",
      details: "operator initiated",
      timestamp: new Date(),
    })

    await vi.waitFor(() => {
      const insertCalls = mockDb.mock.calls.filter((c: unknown[]) =>
        (c[0] as string).includes("INSERT INTO _reactivebase_deployments"),
      )
      expect(insertCalls.length).toBeGreaterThanOrEqual(1)
    })

    const insertCall = mockDb.mock.calls.find((c: unknown[]) =>
      (c[0] as string).includes("INSERT INTO _reactivebase_deployments"),
    )!
    const params = insertCall[1] as unknown[]
    expect(params).toContain("rolled_back")
    expect(params).toContain(0)
  })

  it("recoverState loads state from DB", async () => {
    const mockDb = createMockDb()
    const coord = new DeploymentCoordinator({ db: mockDb })

    mockDb.mockResolvedValueOnce({
      rows: [
        {
          phase: "rolling",
          blue_version: "v1",
          green_version: "v2",
          canary_percent: 50,
        },
      ],
    })

    await coord.recoverState()

    expect(mockDb).toHaveBeenCalledWith(
      expect.stringContaining("SELECT * FROM _reactivebase_deployments"),
      expect.any(Array),
    )

    const state = coord.getState()
    expect(state.phase).toBe("rolling")
    expect(state.oldVersion).toBe("v1")
    expect(state.newVersion).toBe("v2")
    expect(state.currentPercentage).toBe(50)
  })

  it("recoverState is a no-op without db", async () => {
    const coord = new DeploymentCoordinator()
    await expect(coord.recoverState()).resolves.toBeUndefined()
    expect(coord.getState().phase).toBe("idle")
  })

  it("recoverState keeps idle state when no rows returned", async () => {
    const mockDb = createMockDb()
    const coord = new DeploymentCoordinator({ db: mockDb })

    await coord.recoverState()

    expect(coord.getState().phase).toBe("idle")
  })
})

describe("SubscriptionMigrator default migration handler", () => {
  it("processBatch works without custom migrateFn", async () => {
    const migrator = new SubscriptionMigrator()

    migrator.queueMigration(
      "conn1",
      [
        { subscriptionId: "sub1", queryName: "listTasks", args: {} },
        { subscriptionId: "sub2", queryName: "listUsers", args: {} },
      ],
      "v1",
      "v2",
    )

    const result = await migrator.processBatch(10)

    expect(result.migrated).toBe(2)
    expect(result.failed).toBe(0)
    expect(migrator.getPendingCount()).toBe(0)

    const stats = migrator.getStats()
    expect(stats.migrated).toBe(2)
    expect(stats.total).toBe(2)
  })
})
