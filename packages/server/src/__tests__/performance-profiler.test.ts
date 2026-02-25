import { describe, it, expect } from "vitest"
import { PerformanceProfiler } from "../metrics/performance-profiler.js"

describe("PerformanceProfiler", () => {
  describe("query recording", () => {
    it("records query executions", () => {
      const profiler = new PerformanceProfiler()
      profiler.recordQueryExecution("tasks.list", 50, ["tasks"])
      profiler.recordQueryExecution("tasks.list", 30, ["tasks"])
      profiler.recordQueryExecution("users.get", 10, ["users"])

      const stats = profiler.getStats()
      expect(stats.totalQueries).toBe(3)
      expect(stats.activeProfiles).toBe(2)
    })

    it("builds query profiles with percentiles", () => {
      const profiler = new PerformanceProfiler()
      for (let i = 1; i <= 100; i++) {
        profiler.recordQueryExecution("tasks.list", i, ["tasks"])
      }

      const profile = profiler.getQueryProfile("tasks.list")!
      expect(profile.callCount).toBe(100)
      expect(profile.minDurationMs).toBe(1)
      expect(profile.maxDurationMs).toBe(100)
      expect(profile.avgDurationMs).toBeGreaterThan(0)
      expect(profile.p50DurationMs).toBeLessThanOrEqual(55)
      expect(profile.p99DurationMs).toBeGreaterThanOrEqual(95)
    })

    it("returns undefined for unknown query", () => {
      const profiler = new PerformanceProfiler()
      expect(profiler.getQueryProfile("nonexistent")).toBeUndefined()
    })
  })

  describe("slow query detection", () => {
    it("detects slow queries", () => {
      const profiler = new PerformanceProfiler({ slowQueryThresholdMs: 50 })
      profiler.recordQueryExecution("tasks.list", 10, ["tasks"])
      profiler.recordQueryExecution("tasks.list", 200, ["tasks"])

      const slow = profiler.getSlowQueries()
      expect(slow).toHaveLength(1)
      expect(slow[0].durationMs).toBe(200)
    })

    it("fires alerts for slow queries", () => {
      const alerts: unknown[] = []
      const profiler = new PerformanceProfiler({
        slowQueryThresholdMs: 50,
        onAlert: (a) => alerts.push(a),
      })

      profiler.recordQueryExecution("slow.query", 150, ["tasks"])
      expect(alerts).toHaveLength(1)
    })

    it("limits slow query history", () => {
      const profiler = new PerformanceProfiler({ slowQueryThresholdMs: 10, maxSlowQueries: 5 })
      for (let i = 0; i < 20; i++) {
        profiler.recordQueryExecution("q", 100, ["t"])
      }
      expect(profiler.getSlowQueries(100)).toHaveLength(5)
    })
  })

  describe("N+1 detection", () => {
    it("detects N+1 query patterns", () => {
      const profiler = new PerformanceProfiler({ nPlusOneThreshold: 3 })

      for (let i = 0; i < 5; i++) {
        profiler.recordQueryExecution("users.get", 5, ["users"])
      }

      const detections = profiler.getNPlusOneDetections()
      expect(detections.length).toBeGreaterThan(0)
      expect(detections[0].queryName).toBe("users.get")
      expect(detections[0].occurrences).toBeGreaterThanOrEqual(3)
    })

    it("does not trigger for unique queries", () => {
      const profiler = new PerformanceProfiler({ nPlusOneThreshold: 5 })

      profiler.recordQueryExecution("a.query", 5, ["t"])
      profiler.recordQueryExecution("b.query", 5, ["t"])
      profiler.recordQueryExecution("c.query", 5, ["t"])

      expect(profiler.getNPlusOneDetections()).toHaveLength(0)
    })
  })

  describe("subscription fanout", () => {
    it("records fanout events", () => {
      const profiler = new PerformanceProfiler()
      profiler.recordFanout("tasks", "update", 500, 120)
      const stats = profiler.getStats()
      expect(stats.totalQueries).toBe(0) // fanout doesn't count as query
    })

    it("fires alert for high fanout", () => {
      const alerts: unknown[] = []
      const profiler = new PerformanceProfiler({ onAlert: (a) => alerts.push(a) })
      profiler.recordFanout("tasks", "delete", 2000, 500)

      expect(alerts.length).toBeGreaterThan(0)
      expect((alerts[0] as Record<string, unknown>).type).toBe("high-fanout")
    })
  })

  describe("alert management", () => {
    it("lists default alert rules", () => {
      const profiler = new PerformanceProfiler()
      const rules = profiler.getAlertRules()
      expect(rules.length).toBeGreaterThan(0)
      expect(rules.map((r) => r.type)).toContain("slow-query")
      expect(rules.map((r) => r.type)).toContain("n-plus-one")
    })

    it("disables alert rules", () => {
      const alerts: unknown[] = []
      const profiler = new PerformanceProfiler({
        slowQueryThresholdMs: 10,
        onAlert: (a) => alerts.push(a),
      })

      profiler.setAlertRule("Slow Query", { enabled: false })
      profiler.recordQueryExecution("q", 1000, ["t"])
      expect(alerts).toHaveLength(0)
    })

    it("clears alerts", () => {
      const profiler = new PerformanceProfiler({ slowQueryThresholdMs: 10 })
      profiler.recordQueryExecution("q", 100, ["t"])
      expect(profiler.getAlerts().length).toBeGreaterThan(0)

      profiler.clearAlerts()
      expect(profiler.getAlerts()).toHaveLength(0)
    })
  })

  describe("Grafana dashboard generation", () => {
    it("generates a complete dashboard", () => {
      const profiler = new PerformanceProfiler()
      const dashboard = profiler.generateGrafanaDashboard("My Dashboard")

      expect(dashboard.title).toBe("My Dashboard")
      expect(dashboard.panels.length).toBeGreaterThanOrEqual(8)
      expect(dashboard.refresh).toBe("10s")
      expect(dashboard.time.from).toBe("now-1h")
    })

    it("includes essential panels", () => {
      const profiler = new PerformanceProfiler()
      const dashboard = profiler.generateGrafanaDashboard()
      const titles = dashboard.panels.map((p) => p.title)

      expect(titles).toContain("Query Rate")
      expect(titles).toContain("Query Latency (p99)")
      expect(titles).toContain("Active Subscriptions")
      expect(titles).toContain("Error Rate")
      expect(titles).toContain("Subscription Fanout")
      expect(titles).toContain("Slow Queries")
    })

    it("panels have valid Prometheus expressions", () => {
      const profiler = new PerformanceProfiler()
      const dashboard = profiler.generateGrafanaDashboard()

      for (const panel of dashboard.panels) {
        expect(panel.targets.length).toBeGreaterThan(0)
        for (const target of panel.targets) {
          expect(target.expr).toBeTruthy()
          expect(target.expr).toContain("reactivebase_")
        }
      }
    })
  })

  describe("profiles listing", () => {
    it("returns all profiles sorted by avg duration", () => {
      const profiler = new PerformanceProfiler()
      profiler.recordQueryExecution("fast", 5, ["t"])
      profiler.recordQueryExecution("slow", 500, ["t"])
      profiler.recordQueryExecution("medium", 50, ["t"])

      const profiles = profiler.getAllProfiles()
      expect(profiles).toHaveLength(3)
      expect(profiles[0].queryName).toBe("slow")
    })

    it("tracks error rates", () => {
      const profiler = new PerformanceProfiler()
      profiler.recordQueryExecution("q", 10, ["t"])
      profiler.recordQueryExecution("q", 10, ["t"], { isError: true })
      profiler.recordQueryExecution("q", 10, ["t"])

      const profile = profiler.getQueryProfile("q")!
      expect(profile.errorCount).toBe(1)
      expect(profile.errorRate).toBeCloseTo(0.333, 1)
    })
  })

  describe("stats", () => {
    it("reports comprehensive stats", () => {
      const profiler = new PerformanceProfiler({ slowQueryThresholdMs: 50 })
      profiler.recordQueryExecution("q1", 10, ["t1"])
      profiler.recordQueryExecution("q2", 200, ["t2"])

      const stats = profiler.getStats()
      expect(stats.totalQueries).toBe(2)
      expect(stats.slowQueries).toBe(1)
      expect(stats.avgQueryDurationMs).toBeGreaterThan(0)
      expect(stats.topSlowQueries).toHaveLength(1)
    })
  })
})
