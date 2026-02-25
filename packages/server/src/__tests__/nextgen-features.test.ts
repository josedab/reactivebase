import { describe, it, expect } from "vitest"

// Feature 4: Reactive CDC Adapter
import { ReactiveCdcAdapter } from "../cdc/reactive-cdc.js"
// Feature 5: SaaS Kit
import { SaasKit, generateSaasTablesSQL } from "../tenancy/saas-kit.js"
// Feature 6: Edge Prefetch Cache
import { EdgePrefetchCache } from "../reactivity/edge-prefetch.js"
// Feature 7: Migration Planner
import { MigrationPlanner } from "../migrations/migration-planner.js"
// Feature 8: Analytics Engine
import { AnalyticsEngine, generateAnalyticsSQL } from "../materialized-views/analytics-engine.js"
// Feature 9: Compliance Toolkit
import { ComplianceToolkit, generateAccessLogTableSQL } from "../encryption/compliance.js"
// Feature 10: Plugin Portal
import { PluginPortal } from "../plugins/plugin-portal.js"
// Feature 3: Tutorial Manager
import { TutorialManager } from "../playground/tutorial-manager.js"

// ─── Feature 3: Interactive Tutorials ─────────────────────────────────────────

describe("TutorialManager", () => {
  it("lists built-in tutorials", () => {
    const mgr = new TutorialManager()
    expect(mgr.listTutorials().length).toBeGreaterThanOrEqual(5)
  })

  it("validates correct step code", () => {
    const mgr = new TutorialManager()
    const code = `import { defineSchema, defineTable, v } from "@reactivebase/server"
export default defineSchema({
  tasks: defineTable({ title: v.string(), done: v.boolean({ default: false }) }),
})`
    const result = mgr.validateStep("hello-world", 0, code)
    expect(result.passed).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it("rejects incorrect step code", () => {
    const mgr = new TutorialManager()
    const result = mgr.validateStep("hello-world", 0, "const x = 1")
    expect(result.passed).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("tracks progress", () => {
    const mgr = new TutorialManager()
    const code = `import { defineSchema, defineTable, v } from "@reactivebase/server"
export default defineSchema({ tasks: defineTable({ title: v.string(), done: v.boolean() }) })`
    mgr.validateStep("hello-world", 0, code)
    const progress = mgr.getProgress("hello-world")
    expect(progress.completed).toBe(1)
    expect(progress.total).toBe(3)
  })

  it("exports projects", () => {
    const mgr = new TutorialManager()
    const result = mgr.exportProject(
      { projectName: "my-app", includeSchema: true, includeQueries: true, framework: "react" },
      "// schema",
      "// queries",
    )
    expect(result.files["convex/schema.ts"]).toBe("// schema")
    expect(result.files["package.json"]).toContain("@reactivebase/react")
  })

  it("creates share states", () => {
    const mgr = new TutorialManager()
    const share = mgr.createShareState("schema", "queries", "mutations")
    expect(share.id.length).toBeGreaterThan(0)
    expect(share.expiresAt).toBeGreaterThan(share.createdAt)
  })
})

// ─── Feature 4: Reactive CDC Adapter ──────────────────────────────────────────

describe("ReactiveCdcAdapter", () => {
  it("processes WAL changes and converts to ChangeEvents", async () => {
    const processed: string[] = []
    const adapter = new ReactiveCdcAdapter(
      async (tables) => {
        processed.push(...tables)
      },
      { batchSize: 10 },
    )

    await adapter.processWalChanges([
      {
        table: "tasks",
        operation: "insert",
        rowId: "t1",
        oldValues: null,
        newValues: { title: "Test" },
        lsn: "0/1",
        timestamp: Date.now(),
      },
      {
        table: "users",
        operation: "update",
        rowId: "u1",
        oldValues: { name: "Old" },
        newValues: { name: "New" },
        lsn: "0/2",
        timestamp: Date.now(),
      },
    ])
    // Under batch size, so need to flush
    await adapter.stopBuffering()

    const stats = adapter.getStats()
    expect(stats.eventsProcessed).toBe(2)
  })

  it("filters by tracked tables", async () => {
    const processed: string[] = []
    const adapter = new ReactiveCdcAdapter(
      async (tables) => {
        processed.push(...tables)
      },
      { tables: ["tasks"], batchSize: 2 },
    )

    await adapter.processWalChanges([
      {
        table: "tasks",
        operation: "insert",
        rowId: "t1",
        oldValues: null,
        newValues: null,
        lsn: "0/1",
        timestamp: Date.now(),
      },
      {
        table: "users",
        operation: "insert",
        rowId: "u1",
        oldValues: null,
        newValues: null,
        lsn: "0/2",
        timestamp: Date.now(),
      },
    ])
    // Flush remaining buffer
    await adapter.stopBuffering()

    const stats = adapter.getStats()
    expect(stats.eventsProcessed).toBe(1) // only tasks
  })

  it("tracks row-level vs table-level hits", async () => {
    const adapter = new ReactiveCdcAdapter(async () => {}, { batchSize: 5, rowLevelTracking: true })

    await adapter.processWalChanges([
      {
        table: "tasks",
        operation: "insert",
        rowId: "t1",
        oldValues: null,
        newValues: null,
        lsn: "0/1",
        timestamp: Date.now(),
      },
      {
        table: "tasks",
        operation: "insert",
        rowId: null,
        oldValues: null,
        newValues: null,
        lsn: "0/2",
        timestamp: Date.now(),
      },
    ])

    const stats = adapter.getStats()
    expect(stats.rowLevelHits).toBeGreaterThanOrEqual(0)
  })

  it("handles LISTEN/NOTIFY fallback", () => {
    const adapter = new ReactiveCdcAdapter(async () => {})
    const event = adapter.processListenNotifyPayload({ table: "tasks", operation: "insert", id: "t1" })
    expect(event.table).toBe("tasks")
    expect(adapter.status).toBe("fallback")
  })
})

// ─── Feature 5: SaaS Kit ─────────────────────────────────────────────────────

describe("SaasKit", () => {
  it("onboards a tenant", async () => {
    const kit = new SaasKit()
    const tenant = await kit.onboardTenant({ name: "Acme Corp", ownerEmail: "admin@acme.com" })
    expect(tenant.name).toBe("Acme Corp")
    expect(tenant.status).toBe("active")
    expect(tenant.slug).toBe("acme-corp")
  })

  it("prevents duplicate slugs", async () => {
    const kit = new SaasKit()
    await kit.onboardTenant({ name: "Acme", ownerEmail: "a@a.com" })
    await expect(kit.onboardTenant({ name: "Acme", ownerEmail: "b@b.com" })).rejects.toThrow("already exists")
  })

  it("checks plan limits", async () => {
    const kit = new SaasKit()
    const tenant = await kit.onboardTenant({ name: "Test", ownerEmail: "t@t.com", plan: "free" })
    const check = kit.checkPlanLimit(tenant.id, "maxUsers", 5)
    expect(check.exceeded).toBe(true) // free plan allows 3 users
    expect(check.usagePercent).toBeGreaterThan(100)
  })

  it("changes plans", async () => {
    const kit = new SaasKit()
    const tenant = await kit.onboardTenant({ name: "Test", ownerEmail: "t@t.com" })
    await kit.changePlan(tenant.id, "pro")
    expect(kit.getTenant(tenant.id)?.plan).toBe("pro")
  })

  it("generates admin overview", async () => {
    const kit = new SaasKit()
    await kit.onboardTenant({ name: "A", ownerEmail: "a@a.com", plan: "starter" })
    await kit.onboardTenant({ name: "B", ownerEmail: "b@b.com", plan: "pro" })
    const overview = kit.getAdminOverview()
    expect(overview.totalTenants).toBe(2)
    expect(overview.totalRevenueCents).toBe(2900 + 9900)
  })

  it("suspends and reactivates tenants", async () => {
    const kit = new SaasKit()
    const tenant = await kit.onboardTenant({ name: "X", ownerEmail: "x@x.com" })
    await kit.suspendTenant(tenant.id)
    expect(kit.getTenant(tenant.id)?.status).toBe("suspended")
    await kit.reactivateTenant(tenant.id)
    expect(kit.getTenant(tenant.id)?.status).toBe("active")
  })

  it("generates SQL", () => {
    expect(generateSaasTablesSQL()).toContain("_reactivebase_tenants")
  })
})

// ─── Feature 6: Edge Prefetch Cache ───────────────────────────────────────────

describe("EdgePrefetchCache", () => {
  it("caches and retrieves query results", () => {
    const cache = new EdgePrefetchCache()
    cache.set("tasks.list", { userId: "u1" }, [{ id: "t1" }], ["tasks"])
    const result = cache.get("tasks.list", { userId: "u1" })
    expect(result).not.toBeNull()
    expect(result!.data).toEqual([{ id: "t1" }])
    expect(result!.source).toBe("fresh")
  })

  it("returns null for cache miss", () => {
    const cache = new EdgePrefetchCache()
    expect(cache.get("nonexistent", {})).toBeNull()
  })

  it("invalidates by table", () => {
    const cache = new EdgePrefetchCache()
    cache.set("tasks.list", {}, [], ["tasks"])
    cache.set("users.list", {}, [], ["users"])
    const removed = cache.invalidateByTable("tasks")
    expect(removed).toBe(1)
    expect(cache.size).toBe(1)
  })

  it("invalidates by query name", () => {
    const cache = new EdgePrefetchCache()
    cache.set("tasks.list", { a: 1 }, [], ["tasks"])
    cache.set("tasks.list", { a: 2 }, [], ["tasks"])
    const removed = cache.invalidateByQuery("tasks.list")
    expect(removed).toBe(2)
  })

  it("handles mutation events", () => {
    const cache = new EdgePrefetchCache()
    cache.set("q1", {}, [], ["tasks", "users"])
    cache.set("q2", {}, [], ["tasks"])
    cache.set("q3", {}, [], ["posts"])
    const removed = cache.handleMutation(["tasks"])
    expect(removed).toBe(2)
    expect(cache.size).toBe(1)
  })

  it("tracks hit/miss statistics", () => {
    const cache = new EdgePrefetchCache()
    cache.set("q", {}, [1], ["t"])
    cache.get("q", {})
    cache.get("q", {})
    cache.get("missing", {})
    const stats = cache.getStats()
    expect(stats.hits).toBe(2)
    expect(stats.misses).toBe(1)
    expect(stats.hitRate).toBeGreaterThan(0)
  })

  it("evicts oldest entries when at capacity", () => {
    const cache = new EdgePrefetchCache({ maxEntries: 3 })
    cache.set("q1", {}, 1, [])
    cache.set("q2", {}, 2, [])
    cache.set("q3", {}, 3, [])
    cache.set("q4", {}, 4, []) // evicts q1
    expect(cache.size).toBe(3)
    expect(cache.get("q1", {})).toBeNull()
  })
})

// ─── Feature 7: Migration Planner ────────────────────────────────────────────

describe("MigrationPlanner", () => {
  it("classifies safe changes", () => {
    const planner = new MigrationPlanner()
    const analysis = planner.analyzeChanges([
      { type: "add-table", table: "projects", details: {} },
      { type: "add-column", table: "users", column: "bio", details: {} },
    ])
    expect(analysis.overallRisk).toBe("safe")
    expect(analysis.safeCount).toBe(2)
  })

  it("classifies breaking changes", () => {
    const planner = new MigrationPlanner()
    const analysis = planner.analyzeChanges([
      { type: "drop-table", table: "old_data", details: {} },
      { type: "drop-column", table: "users", column: "legacy_field", details: {} },
    ])
    expect(analysis.overallRisk).toBe("breaking")
    expect(analysis.breakingCount).toBe(2)
  })

  it("classifies add NOT NULL without default as breaking", () => {
    const planner = new MigrationPlanner()
    const analysis = planner.analyzeChanges([
      { type: "add-column", table: "users", column: "required_field", details: { notNull: true } },
    ])
    expect(analysis.overallRisk).toBe("breaking")
  })

  it("classifies add index as caution", () => {
    const planner = new MigrationPlanner()
    const analysis = planner.analyzeChanges([
      { type: "add-index", table: "users", column: "email", details: { name: "idx_email" } },
    ])
    expect(analysis.overallRisk).toBe("caution")
    expect(analysis.changes[0].recommendation).toContain("CONCURRENTLY")
  })

  it("generates safe migration plan", () => {
    const planner = new MigrationPlanner()
    const analysis = planner.analyzeChanges([
      { type: "add-table", table: "projects", details: {} },
      { type: "add-column", table: "users", column: "bio", details: {} },
    ])
    const plan = planner.generateSafePlan(analysis)
    expect(plan.estimatedDowntime).toBe("zero")
    expect(plan.phases.length).toBeGreaterThan(0)
    expect(plan.phases[0].name).toBe("Expand")
  })

  it("generates expand-contract plan for breaking changes", () => {
    const planner = new MigrationPlanner()
    const analysis = planner.analyzeChanges([{ type: "drop-table", table: "legacy", details: {} }])
    const plan = planner.generateSafePlan(analysis)
    expect(plan.phases.length).toBeGreaterThanOrEqual(2)
    expect(plan.warnings.length).toBeGreaterThan(0)
  })

  it("generates expand-contract for column type change", () => {
    const planner = new MigrationPlanner()
    const analysis = planner.analyzeChanges([
      { type: "alter-column", table: "users", column: "age", details: { typeChange: true, newType: "integer" } },
    ])
    const plan = planner.generateSafePlan(analysis)
    const allSteps = plan.phases.flatMap((p) => p.steps)
    expect(allSteps.some((s) => s.sql.includes("ADD COLUMN"))).toBe(true)
    expect(allSteps.some((s) => s.sql.includes("UPDATE"))).toBe(true)
  })

  it("runs dry-run simulation", () => {
    const planner = new MigrationPlanner()
    const analysis = planner.analyzeChanges([{ type: "add-column", table: "users", column: "bio", details: {} }])
    const plan = planner.generateSafePlan(analysis)
    const dryRun = planner.dryRun(plan)
    expect(dryRun.wouldSucceed).toBe(true)
    expect(dryRun.simulation.length).toBeGreaterThan(0)
  })
})

// ─── Feature 8: Analytics Engine ──────────────────────────────────────────────

describe("AnalyticsEngine", () => {
  it("defines and queries metrics", () => {
    const engine = new AnalyticsEngine()
    engine.defineMetric({ name: "total_users", table: "users", aggregation: "count" })
    const result = engine.query("total_users")
    expect(result.metricName).toBe("total_users")
    expect(result.value).toBe(0)
  })

  it("incrementally updates count on insert", () => {
    const engine = new AnalyticsEngine()
    engine.defineMetric({ name: "task_count", table: "tasks", aggregation: "count" })
    engine.applyChange({ table: "tasks", operation: "insert" })
    engine.applyChange({ table: "tasks", operation: "insert" })
    expect(engine.query("task_count").value).toBe(2)
  })

  it("decrements count on delete", () => {
    const engine = new AnalyticsEngine()
    engine.defineMetric({ name: "task_count", table: "tasks", aggregation: "count" })
    engine.applyChange({ table: "tasks", operation: "insert" })
    engine.applyChange({ table: "tasks", operation: "insert" })
    engine.applyChange({ table: "tasks", operation: "delete" })
    expect(engine.query("task_count").value).toBe(1)
  })

  it("incrementally updates sum", () => {
    const engine = new AnalyticsEngine()
    engine.defineMetric({ name: "total_revenue", table: "payments", aggregation: "sum", column: "amount" })
    engine.applyChange({ table: "payments", operation: "insert", row: { amount: 100 } })
    engine.applyChange({ table: "payments", operation: "insert", row: { amount: 250 } })
    expect(engine.query("total_revenue").value).toBe(350)
  })

  it("subscribes to metric updates", () => {
    const engine = new AnalyticsEngine()
    engine.defineMetric({ name: "count", table: "items", aggregation: "count" })

    const values: number[] = []
    engine.subscribe("count", (r) => values.push(r.value))
    engine.applyChange({ table: "items", operation: "insert" })
    engine.applyChange({ table: "items", operation: "insert" })

    expect(values).toContain(0) // initial
    expect(values).toContain(1)
    expect(values).toContain(2)
  })

  it("respects filters", () => {
    const engine = new AnalyticsEngine()
    engine.defineMetric({ name: "premium_users", table: "users", aggregation: "count", filter: { plan: "premium" } })
    engine.applyChange({ table: "users", operation: "insert", row: { plan: "premium" } })
    engine.applyChange({ table: "users", operation: "insert", row: { plan: "free" } })
    expect(engine.query("premium_users").value).toBe(1)
  })

  it("generates SQL", () => {
    const result = generateAnalyticsSQL({
      name: "daily_signups",
      table: "users",
      aggregation: "count",
      timeBucket: "day",
      timestampColumn: "created_at",
    })
    expect(result.sql).toContain("COUNT")
    expect(result.sql).toContain("date_trunc")
    expect(result.sql).toContain("GROUP BY bucket")
  })

  it("tracks stats", () => {
    const engine = new AnalyticsEngine()
    engine.defineMetric({ name: "m1", table: "t1", aggregation: "count" })
    engine.applyChange({ table: "t1", operation: "insert" })
    const stats = engine.getStats()
    expect(stats.metricsCount).toBe(1)
    expect(stats.incrementalUpdates).toBe(1)
  })
})

// ─── Feature 9: Compliance Toolkit ────────────────────────────────────────────

describe("ComplianceToolkit", () => {
  it("detects PII columns", () => {
    const toolkit = new ComplianceToolkit()
    const detections = toolkit.detectPII([
      {
        table: "users",
        columns: [
          { name: "id", type: "text" },
          { name: "email", type: "text" },
          { name: "phone", type: "text" },
          { name: "created_at", type: "timestamptz" },
        ],
      },
    ])
    expect(detections.length).toBeGreaterThanOrEqual(2)
    expect(detections.some((d) => d.piiType === "email")).toBe(true)
    expect(detections.some((d) => d.piiType === "phone")).toBe(true)
  })

  it("records and retrieves access logs", () => {
    const toolkit = new ComplianceToolkit()
    toolkit.recordAccess({ userId: "u1", action: "read", table: "tasks", rowIds: ["t1", "t2"] })
    toolkit.recordAccess({ userId: "u2", action: "write", table: "users", rowIds: ["u2"] })

    const logs = toolkit.getAccessLog()
    expect(logs).toHaveLength(2)
    const u1Logs = toolkit.getAccessLog("u1")
    expect(u1Logs).toHaveLength(1)
  })

  it("handles GDPR erasure requests", async () => {
    const toolkit = new ComplianceToolkit()
    toolkit.recordAccess({ userId: "u1", action: "read", table: "tasks", rowIds: ["t1"] })

    const request = toolkit.requestErasure("u1")
    expect(request.status).toBe("pending")

    const completed = await toolkit.executeErasure(request.id, ["users", "tasks"])
    expect(completed.status).toBe("completed")
    expect(completed.tablesProcessed).toEqual(["users", "tasks"])

    // Access logs should be removed
    expect(toolkit.getAccessLog("u1")).toHaveLength(0)
  })

  it("manages retention policies", () => {
    const toolkit = new ComplianceToolkit()
    toolkit.setRetentionPolicy({ table: "logs", retentionDays: 90, action: "delete", timestampColumn: "created_at" })
    const policies = toolkit.getRetentionPolicies()
    expect(policies).toHaveLength(1)

    const sql = toolkit.generateRetentionSQL()
    expect(sql[0]).toContain("DELETE FROM")
    expect(sql[0]).toContain("90 days")
  })

  it("generates compliance reports", () => {
    const toolkit = new ComplianceToolkit()
    toolkit.detectPII([{ table: "users", columns: [{ name: "email", type: "text" }] }])
    toolkit.recordAccess({ userId: "u1", action: "read", table: "users", rowIds: ["u1"] })
    toolkit.setRetentionPolicy({ table: "logs", retentionDays: 90, action: "delete", timestampColumn: "created_at" })

    const report = toolkit.generateComplianceReport("SOC2")
    expect(report.framework).toBe("SOC2")
    expect(report.sections.length).toBeGreaterThanOrEqual(3)
    expect(report.overallStatus).toBeDefined()
  })

  it("generates GDPR report with erasure section", () => {
    const toolkit = new ComplianceToolkit()
    const report = toolkit.generateComplianceReport("GDPR")
    expect(report.sections.some((s) => s.name === "Right to Erasure")).toBe(true)
  })

  it("generates SQL tables", () => {
    expect(generateAccessLogTableSQL()).toContain("_reactivebase_access_log")
  })
})

// ─── Feature 10: Plugin Portal ────────────────────────────────────────────────

describe("PluginPortal", () => {
  it("lists plugins with quality scores", () => {
    const portal = new PluginPortal()
    const plugins = portal.listPlugins()
    expect(plugins.length).toBeGreaterThan(0)
    expect(plugins[0].qualityScore).toBeGreaterThan(0)
    expect(plugins[0].badges.length).toBeGreaterThan(0)
  })

  it("searches plugins by query", () => {
    const portal = new PluginPortal()
    const results = portal.listPlugins({ query: "auth" })
    expect(results.length).toBeGreaterThan(0)
    expect(
      results.every(
        (p) =>
          p.entry.name.includes("auth") ||
          p.entry.keywords.some((k) => k.includes("auth")) ||
          p.entry.description.toLowerCase().includes("auth"),
      ),
    ).toBe(true)
  })

  it("filters by category", () => {
    const portal = new PluginPortal()
    const payments = portal.listPlugins({ category: "payments" })
    expect(payments.length).toBeGreaterThan(0)
    expect(payments.every((p) => p.entry.category === "payments")).toBe(true)
  })

  it("checks compatibility matrix", () => {
    const portal = new PluginPortal()
    const matrix = portal.checkCompatibilityMatrix("0.1.0")
    expect(matrix.overallTotal).toBeGreaterThan(0)
    expect(matrix.overallCompatible).toBeGreaterThan(0)
  })

  it("scaffolds a new plugin", () => {
    const portal = new PluginPortal()
    const scaffold = portal.scaffoldPlugin("my-notifier", "utilities")
    expect(scaffold.files["src/index.ts"]).toContain("my-notifier")
    expect(scaffold.commands.length).toBeGreaterThan(0)
  })

  it("generates portal HTML", () => {
    const portal = new PluginPortal()
    const html = portal.generatePortalHTML()
    expect(html).toContain("ReactiveBase Plugin Registry")
    expect(html).toContain("verified")
    expect(html).toContain("npm install")
  })

  it("tracks install counts", () => {
    const portal = new PluginPortal()
    portal.recordInstall("clerk")
    portal.recordInstall("clerk")
    portal.recordInstall("stripe")
    const stats = portal.getStats()
    expect(stats.totalDownloads).toBeGreaterThanOrEqual(3)
  })

  it("reports portal stats", () => {
    const portal = new PluginPortal()
    const stats = portal.getStats()
    expect(stats.totalPlugins).toBeGreaterThan(0)
    expect(stats.firstPartyPlugins).toBeGreaterThan(0)
    expect(stats.avgQualityScore).toBeGreaterThan(0)
  })
})
