import { describe, it, expect, beforeEach } from "vitest"
import {
  PreviewEnvironmentManager,
  PreviewEnvironmentError,
  buildCreatePreviewEnvTableSQL,
  buildUpsertPreviewEnvSQL,
  buildGetExpiredPreviewsSQL,
} from "../branching/preview-environment.js"
import { DatabaseBranching } from "../branching/branching.js"

describe("PreviewEnvironmentManager", () => {
  let branching: DatabaseBranching
  let manager: PreviewEnvironmentManager

  beforeEach(() => {
    branching = new DatabaseBranching({ strategy: "schema", maxBranches: 100 })
    manager = new PreviewEnvironmentManager(branching, { maxPreviews: 5, ttlMs: 60_000 })
  })

  it("creates a preview environment for a PR", async () => {
    const env = await manager.create({ trigger: "pr", prNumber: 42, commitSha: "abc123" })
    expect(env.id).toBe("pr-42")
    expect(env.status).toBe("ready")
    expect(env.prNumber).toBe(42)
    expect(env.url).toContain("pr-42")
    expect(env.envVars.REACTIVEBASE_PREVIEW_ID).toBe("pr-42")
  })

  it("creates a deploy preview environment", async () => {
    const env = await manager.create({ trigger: "deploy", deployId: "dep-abc" })
    expect(env.id).toBe("deploy-dep-abc")
    expect(env.status).toBe("ready")
    expect(env.trigger).toBe("deploy")
  })

  it("creates a manual preview environment", async () => {
    const env = await manager.create({ trigger: "manual" })
    expect(env.id).toMatch(/^manual-/)
    expect(env.status).toBe("ready")
  })

  it("finds preview by PR number", async () => {
    await manager.create({ trigger: "pr", prNumber: 99 })
    const found = manager.getByPR(99)
    expect(found).toBeDefined()
    expect(found!.prNumber).toBe(99)
  })

  it("enforces max previews limit", async () => {
    for (let i = 1; i <= 5; i++) {
      await manager.create({ trigger: "pr", prNumber: i })
    }
    // 6th should trigger cleanup of oldest
    const env = await manager.create({ trigger: "pr", prNumber: 6 })
    expect(env.status).toBe("ready")
    // PR 1 should have been cleaned up
    expect(manager.getByPR(1)).toBeUndefined()
  })

  it("updates a preview with new commit", async () => {
    await manager.create({ trigger: "pr", prNumber: 10, commitSha: "aaa" })
    const updated = await manager.update("pr-10", "bbb")
    expect(updated.commitSha).toBe("bbb")
    expect(updated.status).toBe("ready")
  })

  it("destroys a preview environment", async () => {
    await manager.create({ trigger: "pr", prNumber: 20 })
    await manager.destroy("pr-20")
    expect(manager.get("pr-20")).toBeUndefined()
  })

  it("records health checks", async () => {
    await manager.create({ trigger: "pr", prNumber: 30 })
    manager.recordHealthCheck("pr-30", true, 50)
    expect(manager.get("pr-30")!.health.healthy).toBe(true)
    expect(manager.get("pr-30")!.health.latencyMs).toBe(50)

    manager.recordHealthCheck("pr-30", false)
    manager.recordHealthCheck("pr-30", false)
    manager.recordHealthCheck("pr-30", false)
    expect(manager.get("pr-30")!.status).toBe("unhealthy")
  })

  it("tracks migration status", async () => {
    await manager.create({ trigger: "pr", prNumber: 40 })
    manager.setMigrationStatus("pr-40", "applied")
    expect(manager.get("pr-40")!.migrationStatus).toBe("applied")
  })

  it("cleans up expired previews", async () => {
    const mgr = new PreviewEnvironmentManager(branching, { maxPreviews: 10, ttlMs: 1 })
    await mgr.create({ trigger: "pr", prNumber: 50 })
    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 10))
    const cleaned = await mgr.cleanupExpired()
    expect(cleaned).toContain("pr-50")
  })

  it("provides stats", async () => {
    await manager.create({ trigger: "pr", prNumber: 1 })
    await manager.create({ trigger: "deploy", deployId: "d1" })
    const stats = manager.getStats()
    expect(stats.total).toBe(2)
    expect(stats.byTrigger.pr).toBe(1)
    expect(stats.byTrigger.deploy).toBe(1)
    expect(stats.averageProvisionTimeMs).toBeGreaterThanOrEqual(0)
  })

  it("throws on missing trigger", async () => {
    await expect(manager.create({} as any)).rejects.toThrow("Trigger type is required")
  })

  it("throws on update of non-existent preview", async () => {
    await expect(manager.update("nonexistent", "abc")).rejects.toThrow("not found")
  })
})

describe("Preview SQL builders", () => {
  it("generates create table SQL", () => {
    const sql = buildCreatePreviewEnvTableSQL()
    expect(sql).toContain("_reactivebase_preview_envs")
    expect(sql).toContain("CREATE TABLE")
  })

  it("generates upsert SQL", () => {
    const result = buildUpsertPreviewEnvSQL({
      id: "test",
      trigger: "pr",
      branchName: "preview-test",
      branchRecord: null,
      prNumber: 1,
      commitSha: "abc",
      deployId: null,
      status: "ready",
      url: null,
      connectionString: null,
      migrationStatus: "pending",
      health: { healthy: true, lastCheck: null, consecutiveFailures: 0, latencyMs: null },
      envVars: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: null,
      metadata: {},
    })
    expect(result.sql).toContain("INSERT INTO")
    expect(result.params).toHaveLength(17)
  })

  it("generates expired query SQL", () => {
    const result = buildGetExpiredPreviewsSQL()
    expect(result.sql).toContain("expires_at")
  })
})
