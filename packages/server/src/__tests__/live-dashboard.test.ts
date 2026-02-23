import { describe, it, expect, beforeEach } from "vitest"
import { LiveDashboard } from "../dashboard/live-dashboard.js"
import { generateLiveDashboardTableSQL } from "../dashboard/live-dashboard.js"

describe("LiveDashboard", () => {
  let dashboard: LiveDashboard

  beforeEach(() => {
    dashboard = new LiveDashboard({ auth: { secret: "test-secret" } })
  })

  describe("auth", () => {
    it("allows access with correct token", () => {
      expect(dashboard.checkAccess({ authorization: "Bearer test-secret" })).toBe(true)
    })

    it("denies access with wrong token", () => {
      expect(dashboard.checkAccess({ authorization: "Bearer wrong" })).toBe(false)
    })

    it("allows all access when no auth configured", () => {
      const open = new LiveDashboard()
      expect(open.checkAccess({})).toBe(true)
    })

    it("supports custom auth check", () => {
      const custom = new LiveDashboard({
        auth: { checkAuth: (h) => h["x-admin"] === "yes" },
      })
      expect(custom.checkAccess({ "x-admin": "yes" })).toBe(true)
      expect(custom.checkAccess({ "x-admin": "no" })).toBe(false)
    })
  })

  describe("query recording", () => {
    it("records queries and updates stats", () => {
      const exec = dashboard.recordQueryExecution("tasks.list", 45, ["tasks"], {
        subscriberCount: 5,
        resultSize: 100,
      })
      expect(exec.queryName).toBe("tasks.list")
      expect(exec.durationMs).toBe(45)

      const metrics = dashboard.getMetrics()
      expect(metrics.totalQueries).toBe(1)
      expect(metrics.topSlowQueries[0].name).toBe("tasks.list")
    })

    it("auto-alerts on slow queries", () => {
      dashboard.recordQueryExecution("slow.query", 5500, ["tasks"])
      const metrics = dashboard.getMetrics()
      expect(metrics.alerts.length).toBeGreaterThan(0)
      expect(metrics.alerts[0].severity).toBe("critical")
    })

    it("tracks cache hits", () => {
      dashboard.recordQueryExecution("cached", 1, [], { cached: true })
      dashboard.recordQueryExecution("miss", 50, [])
      const metrics = dashboard.getMetrics()
      expect(metrics.cacheHitRate).toBe(50)
    })
  })

  describe("mutation recording", () => {
    it("records mutations with metadata", () => {
      const entry = dashboard.recordMutation("tasks.create", { title: "test" }, { id: "1" }, ["tasks"], 12, {
        userId: "u1",
      })
      expect(entry.mutationName).toBe("tasks.create")
      expect(entry.replayable).toBe(true)
      expect(entry.userId).toBe("u1")
    })

    it("records error mutations", () => {
      const entry = dashboard.recordMutation("tasks.create", {}, null, ["tasks"], 5, { error: "validation failed" })
      expect(entry.status).toBe("error")
      expect(entry.replayable).toBe(false)

      const metrics = dashboard.getMetrics()
      expect(metrics.errorRate).toBeGreaterThan(0)
    })
  })

  describe("connections", () => {
    it("tracks active connections", () => {
      dashboard.addConnection({ connectionId: "c1", userId: "u1", ip: "1.2.3.4", userAgent: "Chrome" })
      dashboard.addConnection({ connectionId: "c2", userId: null, ip: "5.6.7.8", userAgent: "Firefox" })
      expect(dashboard.getMetrics().activeConnections).toBe(2)

      dashboard.removeConnection("c1")
      expect(dashboard.getMetrics().activeConnections).toBe(1)
    })

    it("updates connection activity", () => {
      dashboard.addConnection({ connectionId: "c1", userId: null, ip: "1.2.3.4", userAgent: "test" })
      dashboard.updateConnectionActivity("c1", 5, 12)
    })
  })

  describe("flamechart", () => {
    it("generates flamechart from spans", () => {
      dashboard.recordQueryExecution("q1", 100, ["tasks"], {
        spans: [
          {
            name: "db.query",
            startMs: 0,
            durationMs: 80,
            children: [{ name: "parse", startMs: 0, durationMs: 10, children: [], metadata: {} }],
            metadata: {},
          },
        ],
      })
      const chart = dashboard.generateFlamechart("q1")
      expect(chart).not.toBeNull()
      expect(chart!.queryName).toBe("q1")
      expect(chart!.spans.length).toBeGreaterThan(0)
      expect(chart!.spans[0].name).toBe("db.query")
    })

    it("returns null for unknown query", () => {
      expect(dashboard.generateFlamechart("nonexistent")).toBeNull()
    })
  })

  describe("query replay", () => {
    it("retrieves replayable mutations", () => {
      dashboard.recordMutation("m1", {}, {}, ["t"], 1)
      dashboard.recordMutation("m2", {}, null, ["t"], 1, { error: "fail" })
      const replayable = dashboard.getReplayableMutations()
      expect(replayable).toHaveLength(1)
      expect(replayable[0].mutationName).toBe("m1")
    })
  })

  describe("alerts", () => {
    it("adds and acknowledges alerts", () => {
      const alert = dashboard.addAlert({
        type: "custom",
        severity: "warning",
        message: "test alert",
        metric: "x",
        value: 1,
        threshold: 0,
      })
      expect(dashboard.getMetrics().alerts).toHaveLength(1)

      dashboard.acknowledgeAlert(alert.id)
      expect(dashboard.getMetrics().alerts).toHaveLength(0)
    })
  })

  describe("admin routes", () => {
    it("generates correct admin routes", () => {
      const routes = dashboard.generateAdminRoutes()
      expect(routes.length).toBeGreaterThan(5)
      expect(routes.some((r) => r.path === "/admin")).toBe(true)
      expect(routes.some((r) => r.path === "/admin/api/metrics")).toBe(true)
    })
  })

  describe("dashboard HTML", () => {
    it("generates valid HTML", () => {
      dashboard.recordQueryExecution("tasks.list", 45, ["tasks"])
      const html = dashboard.generateHTML()
      expect(html).toContain("<!DOCTYPE html>")
      expect(html).toContain("ReactiveBase Admin")
    })
  })

  describe("SQL builders", () => {
    it("generates live dashboard table SQL", () => {
      const sql = generateLiveDashboardTableSQL()
      expect(sql).toContain("_reactivebase_live_query_log")
      expect(sql).toContain("_reactivebase_live_mutation_log")
      expect(sql).toContain("_reactivebase_live_alerts")
    })
  })
})
