import { describe, it, expect, beforeEach } from "vitest"
import { CloudPlatform } from "../cloud-platform/cloud-platform.js"
import {
  OneClickProvisioner,
  AutoScaler,
  DatabaseManager,
  ProvisioningError,
  DatabaseManagerError,
  generateProvisioningTableSQL,
  buildInsertProvisioningSQL,
  buildQueryTablesSQL,
} from "../cloud-platform/one-click-provisioner.js"
import type { TableInfo } from "../cloud-platform/one-click-provisioner.js"

// ─── OneClickProvisioner ─────────────────────────────────────────────────────

describe("OneClickProvisioner", () => {
  let platform: CloudPlatform
  let provisioner: OneClickProvisioner

  beforeEach(() => {
    platform = new CloudPlatform({ region: "us-east-1" })
    provisioner = new OneClickProvisioner(platform)
  })

  describe("provision", () => {
    it("provisions a full project with all services", async () => {
      const result = await provisioner.provision({
        projectName: "my-app",
        plan: "starter",
      })

      expect(result.status).toBe("provisioned")
      expect(result.projectId).toBeDefined()
      expect(result.environmentId).toBeDefined()
      expect(result.provisionedAt).toBeDefined()
    })

    it("provisions Postgres with connection pooling", async () => {
      const result = await provisioner.provision({
        projectName: "my-app",
        plan: "pro",
      })

      expect(result.postgres.host).toContain("reactivebase.cloud")
      expect(result.postgres.port).toBe(5432)
      expect(result.postgres.connectionUrl).toContain("postgresql://")
      expect(result.postgres.connectionUrl).toContain("pool_size=100")
      expect(result.postgres.poolSize).toBe(100)
      expect(result.postgres.sslEnabled).toBe(true)
    })

    it("respects custom pool size", async () => {
      const result = await provisioner.provision({
        projectName: "my-app",
        plan: "starter",
        postgresPoolSize: 50,
      })

      expect(result.postgres.poolSize).toBe(50)
      expect(result.postgres.connectionUrl).toContain("pool_size=50")
    })

    it("provisions Redis for paid plans", async () => {
      const result = await provisioner.provision({
        projectName: "my-app",
        plan: "starter",
      })

      expect(result.redis).not.toBeNull()
      expect(result.redis!.connectionUrl).toContain("redis://")
      expect(result.redis!.port).toBe(6379)
      expect(result.redis!.maxMemoryMb).toBe(256)
    })

    it("skips Redis for free plan by default", async () => {
      const result = await provisioner.provision({
        projectName: "my-app",
        plan: "free",
      })

      expect(result.redis).toBeNull()
      const redisStep = result.steps.find((s) => s.name === "Provision Redis")
      expect(redisStep?.status).toBe("skipped")
    })

    it("allows Redis override for free plan", async () => {
      const result = await provisioner.provision({
        projectName: "my-app",
        plan: "free",
        redisEnabled: true,
      })

      expect(result.redis).not.toBeNull()
    })

    it("sets up monitoring with health checks and alert rules", async () => {
      const result = await provisioner.provision({
        projectName: "my-app",
        plan: "starter",
      })

      expect(result.monitoring.healthChecks).toHaveLength(2)
      expect(result.monitoring.alertRules.length).toBeGreaterThanOrEqual(4)
      expect(result.monitoring.dashboardUrl).toContain("dashboard.reactivebase.cloud")
    })

    it("skips monitoring when disabled", async () => {
      const result = await provisioner.provision({
        projectName: "my-app",
        plan: "starter",
        monitoringEnabled: false,
      })

      expect(result.monitoring.healthChecks).toHaveLength(0)
      expect(result.monitoring.alertRules).toHaveLength(0)
      const monStep = result.steps.find((s) => s.name === "Setup monitoring")
      expect(monStep?.status).toBe("skipped")
    })

    it("configures auto-scaling based on plan", async () => {
      const result = await provisioner.provision({
        projectName: "my-app",
        plan: "pro",
      })

      expect(result.autoScaling.enabled).toBe(true)
      expect(result.autoScaling.minReplicas).toBe(2)
      expect(result.autoScaling.maxReplicas).toBe(10)
    })

    it("disables auto-scaling for free plan", async () => {
      const result = await provisioner.provision({
        projectName: "my-app",
        plan: "free",
      })

      expect(result.autoScaling.enabled).toBe(false)
    })

    it("accepts custom auto-scaling config", async () => {
      const result = await provisioner.provision({
        projectName: "my-app",
        plan: "pro",
        autoScaling: {
          minReplicas: 3,
          maxReplicas: 20,
          cpuThresholdPercent: 60,
        },
      })

      expect(result.autoScaling.minReplicas).toBe(3)
      expect(result.autoScaling.maxReplicas).toBe(20)
      expect(result.autoScaling.cpuThresholdPercent).toBe(60)
    })

    it("tracks all provisioning steps", async () => {
      const result = await provisioner.provision({
        projectName: "my-app",
        plan: "starter",
      })

      expect(result.steps.length).toBeGreaterThanOrEqual(5)
      expect(result.steps.every((s) => s.status === "completed" || s.status === "skipped")).toBe(true)
    })

    it("returns dashboard URL", async () => {
      const result = await provisioner.provision({
        projectName: "my-app",
        plan: "starter",
      })

      expect(result.dashboardUrl).toContain(result.projectId)
    })
  })

  describe("getProvisioningResult", () => {
    it("retrieves provisioning result by project ID", async () => {
      const result = await provisioner.provision({
        projectName: "my-app",
        plan: "starter",
      })

      const found = provisioner.getProvisioningResult(result.projectId)
      expect(found).toBeDefined()
      expect(found!.projectId).toBe(result.projectId)
    })

    it("returns undefined for unknown project", () => {
      expect(provisioner.getProvisioningResult("nonexistent")).toBeUndefined()
    })
  })

  describe("listProvisionedProjects", () => {
    it("lists all provisioned projects", async () => {
      await provisioner.provision({ projectName: "app-1", plan: "free" })
      await provisioner.provision({ projectName: "app-2", plan: "starter" })

      expect(provisioner.listProvisionedProjects()).toHaveLength(2)
    })
  })
})

// ─── AutoScaler ──────────────────────────────────────────────────────────────

describe("AutoScaler", () => {
  let scaler: AutoScaler

  beforeEach(() => {
    scaler = new AutoScaler({ minReplicas: 1, maxReplicas: 5, cooldownMs: 0 })
  })

  describe("getState", () => {
    it("returns initial state", () => {
      const state = scaler.getState()
      expect(state.currentReplicas).toBe(1)
      expect(state.minReplicas).toBe(1)
      expect(state.maxReplicas).toBe(5)
      expect(state.lastScaleAt).toBeNull()
    })
  })

  describe("updateMetrics", () => {
    it("updates CPU metric", () => {
      scaler.updateMetrics({ cpuPercent: 90 })
      expect(scaler.getState().metrics.cpuPercent).toBe(90)
    })

    it("updates multiple metrics", () => {
      scaler.updateMetrics({ cpuPercent: 50, memoryPercent: 60, activeConnections: 30 })
      const metrics = scaler.getState().metrics
      expect(metrics.cpuPercent).toBe(50)
      expect(metrics.memoryPercent).toBe(60)
      expect(metrics.activeConnections).toBe(30)
    })
  })

  describe("evaluate", () => {
    it("scales up on high CPU", () => {
      scaler.updateMetrics({ cpuPercent: 90 })
      const decision = scaler.evaluate({ cpuThresholdPercent: 75 })
      expect(decision.action).toBe("scale-up")
      expect(decision.fromReplicas).toBe(1)
      expect(decision.toReplicas).toBe(2)
      expect(decision.reason).toContain("CPU")
    })

    it("scales up on high memory", () => {
      scaler.updateMetrics({ memoryPercent: 90 })
      const decision = scaler.evaluate({ memoryThresholdPercent: 80 })
      expect(decision.action).toBe("scale-up")
      expect(decision.reason).toContain("Memory")
    })

    it("scales up on high connections", () => {
      scaler.updateMetrics({ activeConnections: 100 })
      const decision = scaler.evaluate({ connectionThreshold: 80 })
      expect(decision.action).toBe("scale-up")
      expect(decision.reason).toContain("Connections")
    })

    it("scales down when all metrics are low", () => {
      // First scale up
      scaler.updateMetrics({ cpuPercent: 90 })
      scaler.evaluate({ cpuThresholdPercent: 75 })
      expect(scaler.getState().currentReplicas).toBe(2)

      // Then metrics drop
      scaler.updateMetrics({ cpuPercent: 10, memoryPercent: 10, activeConnections: 5 })
      const decision = scaler.evaluate()
      expect(decision.action).toBe("scale-down")
      expect(decision.toReplicas).toBe(1)
    })

    it("does not scale below min replicas", () => {
      scaler.updateMetrics({ cpuPercent: 5, memoryPercent: 5, activeConnections: 5 })
      const decision = scaler.evaluate()
      expect(decision.action).toBe("none")
      expect(decision.toReplicas).toBe(1)
    })

    it("does not scale above max replicas", () => {
      const smallScaler = new AutoScaler({ minReplicas: 1, maxReplicas: 2, cooldownMs: 0 })
      smallScaler.updateMetrics({ cpuPercent: 95 })
      smallScaler.evaluate()
      expect(smallScaler.getState().currentReplicas).toBe(2)

      smallScaler.updateMetrics({ cpuPercent: 95 })
      const decision = smallScaler.evaluate()
      expect(decision.action).toBe("none")
      expect(decision.toReplicas).toBe(2)
    })

    it("respects cooldown period", () => {
      const coolScaler = new AutoScaler({ minReplicas: 1, maxReplicas: 5, cooldownMs: 999_999 })
      coolScaler.updateMetrics({ cpuPercent: 95 })
      const first = coolScaler.evaluate()
      expect(first.action).toBe("scale-up")

      coolScaler.updateMetrics({ cpuPercent: 95 })
      const second = coolScaler.evaluate()
      expect(second.action).toBe("none")
      expect(second.reason).toContain("Cooldown")
    })

    it("returns none when metrics are in acceptable range", () => {
      scaler.updateMetrics({ cpuPercent: 50, memoryPercent: 50, activeConnections: 30 })
      const decision = scaler.evaluate()
      expect(decision.action).toBe("none")
      expect(decision.reason).toContain("acceptable range")
    })

    it("includes multiple reasons when several metrics exceed thresholds", () => {
      scaler.updateMetrics({ cpuPercent: 90, memoryPercent: 90 })
      const decision = scaler.evaluate({ cpuThresholdPercent: 75, memoryThresholdPercent: 80 })
      expect(decision.reason).toContain("CPU")
      expect(decision.reason).toContain("Memory")
    })
  })

  describe("getHistory", () => {
    it("tracks scaling decisions", () => {
      scaler.updateMetrics({ cpuPercent: 90 })
      scaler.evaluate()
      scaler.updateMetrics({ cpuPercent: 5, memoryPercent: 5, activeConnections: 5 })
      scaler.evaluate()

      const history = scaler.getHistory()
      expect(history).toHaveLength(2)
      expect(history[0].action).toBe("scale-up")
      expect(history[1].action).toBe("scale-down")
    })
  })
})

// ─── DatabaseManager ─────────────────────────────────────────────────────────

describe("DatabaseManager", () => {
  let manager: DatabaseManager
  const testTables: TableInfo[] = [
    {
      name: "users",
      rowCount: 1000,
      sizeMb: 5.2,
      columns: [
        { name: "id", type: "uuid", nullable: false },
        { name: "email", type: "text", nullable: false },
        { name: "name", type: "text", nullable: true },
      ],
    },
    {
      name: "orders",
      rowCount: 5000,
      sizeMb: 12.8,
      columns: [
        { name: "id", type: "uuid", nullable: false },
        { name: "user_id", type: "uuid", nullable: false },
        { name: "total", type: "numeric", nullable: false },
      ],
    },
  ]

  beforeEach(() => {
    manager = new DatabaseManager()
    manager.registerDatabase("mydb", testTables, 100)
  })

  describe("registerDatabase", () => {
    it("registers a database with tables and pool stats", () => {
      const db = manager.getDatabase("mydb")
      expect(db).toBeDefined()
      expect(db!.name).toBe("mydb")
      expect(db!.tables).toHaveLength(2)
      expect(db!.connectionPool.maxConnections).toBe(100)
    })
  })

  describe("listDatabases", () => {
    it("lists all registered databases", () => {
      manager.registerDatabase("other", [], 50)
      expect(manager.listDatabases()).toHaveLength(2)
    })
  })

  describe("listTables", () => {
    it("lists tables in a database", () => {
      const tables = manager.listTables("mydb")
      expect(tables).toHaveLength(2)
      expect(tables[0].name).toBe("users")
    })

    it("throws for unknown database", () => {
      expect(() => manager.listTables("unknown")).toThrow(DatabaseManagerError)
    })
  })

  describe("getTableStats", () => {
    it("returns table stats", () => {
      const stats = manager.getTableStats("mydb", "users")
      expect(stats.rowCount).toBe(1000)
      expect(stats.sizeMb).toBe(5.2)
      expect(stats.columns).toHaveLength(3)
    })

    it("throws for unknown table", () => {
      expect(() => manager.getTableStats("mydb", "nonexistent")).toThrow("not found")
    })

    it("throws for unknown database", () => {
      expect(() => manager.getTableStats("unknown", "users")).toThrow("not found")
    })
  })

  describe("executeReadOnlyQuery", () => {
    it("executes a SELECT query", () => {
      const result = manager.executeReadOnlyQuery("mydb", "SELECT * FROM users")
      expect(result.rowCount).toBeGreaterThanOrEqual(0)
      expect(result.durationMs).toBeDefined()
    })

    it("returns table data for known tables", () => {
      const result = manager.executeReadOnlyQuery("mydb", "SELECT * FROM users")
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].table_name).toBe("users")
    })

    it("blocks INSERT operations", () => {
      expect(() => manager.executeReadOnlyQuery("mydb", "INSERT INTO users VALUES (1)")).toThrow("not allowed")
    })

    it("blocks UPDATE operations", () => {
      expect(() => manager.executeReadOnlyQuery("mydb", "UPDATE users SET name = 'x'")).toThrow("not allowed")
    })

    it("blocks DELETE operations", () => {
      expect(() => manager.executeReadOnlyQuery("mydb", "DELETE FROM users")).toThrow("not allowed")
    })

    it("blocks DROP operations", () => {
      expect(() => manager.executeReadOnlyQuery("mydb", "DROP TABLE users")).toThrow("not allowed")
    })

    it("throws for unknown database", () => {
      expect(() => manager.executeReadOnlyQuery("unknown", "SELECT 1")).toThrow(DatabaseManagerError)
    })
  })

  describe("connection pool monitoring", () => {
    it("returns pool stats", () => {
      const stats = manager.getConnectionPoolStats("mydb")
      expect(stats.totalConnections).toBe(100)
      expect(stats.activeConnections).toBe(0)
      expect(stats.idleConnections).toBe(100)
      expect(stats.maxConnections).toBe(100)
    })

    it("updates pool stats", () => {
      manager.updateConnectionPoolStats("mydb", { activeConnections: 30, waitingRequests: 5 })
      const stats = manager.getConnectionPoolStats("mydb")
      expect(stats.activeConnections).toBe(30)
      expect(stats.idleConnections).toBe(70)
      expect(stats.waitingRequests).toBe(5)
    })

    it("throws for unknown database", () => {
      expect(() => manager.getConnectionPoolStats("unknown")).toThrow(DatabaseManagerError)
    })
  })
})

// ─── SQL Builders ────────────────────────────────────────────────────────────

describe("SQL Builders", () => {
  it("generates provisioning table SQL", () => {
    const sql = generateProvisioningTableSQL()
    expect(sql).toContain("CREATE TABLE")
    expect(sql).toContain("_reactivebase_provisioning")
    expect(sql).toContain("project_id")
  })

  it("builds insert provisioning SQL", () => {
    const { sql, params } = buildInsertProvisioningSQL("p1", "proj_1", "env_1", "starter")
    expect(sql).toContain("INSERT INTO")
    expect(params).toHaveLength(4)
    expect(params[0]).toBe("p1")
  })

  it("builds query tables SQL", () => {
    const { sql, params } = buildQueryTablesSQL("mydb")
    expect(sql).toContain("information_schema.tables")
    expect(params).toEqual(["mydb"])
  })
})

// ─── Error Classes ───────────────────────────────────────────────────────────

describe("Error classes", () => {
  it("ProvisioningError includes step info", () => {
    const err = new ProvisioningError("fail", "Create project")
    expect(err.name).toBe("ProvisioningError")
    expect(err.step).toBe("Create project")
    expect(err.message).toBe("fail")
  })

  it("DatabaseManagerError includes operation info", () => {
    const err = new DatabaseManagerError("fail", "listTables")
    expect(err.name).toBe("DatabaseManagerError")
    expect(err.operation).toBe("listTables")
  })
})
