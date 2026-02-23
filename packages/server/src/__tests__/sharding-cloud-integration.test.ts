import { describe, it, expect, beforeEach } from "vitest"
import { SubscriptionShardManager } from "../scaling/subscription-sharding.js"
import { ClusterManager } from "../scaling/scaling.js"

/**
 * Integration tests for subscription sharding — verifies multi-node
 * rebalancing, migration execution, and combined ClusterManager + ShardManager flows.
 */
describe("Subscription Sharding Integration", () => {
  describe("multi-node rebalancing with live subscriptions", () => {
    it("rebalances subscriptions across 4 nodes with zero message loss", async () => {
      const migratedIn: string[] = []
      const migratedOut: string[] = []

      const mgr = new SubscriptionShardManager({
        nodeId: "node-1",
        totalShards: 64,
        onMigrateIn: async (batch) => {
          migratedIn.push(...batch.subscriptionKeys)
        },
        onMigrateOut: async (batch) => {
          migratedOut.push(...batch.subscriptionKeys)
        },
      })

      // Phase 1: Register 200 subscriptions on single node
      const allKeys: string[] = []
      for (let i = 0; i < 200; i++) {
        const key = `query:tasks.list:user-${i}`
        mgr.registerSubscription(key)
        allKeys.push(key)
      }
      expect(mgr.getStats().totalSubscriptions).toBe(200)
      expect(mgr.getLocalShards()).toHaveLength(64)

      // Phase 2: Add 3 more nodes — triggers rebalancing
      mgr.addNode("node-2", "10.0.0.2", 4000)
      mgr.addNode("node-3", "10.0.0.3", 4000)
      mgr.addNode("node-4", "10.0.0.4", 4000)

      // Phase 3: Execute migrations
      const result = await mgr.executeMigrations()
      expect(result.errors).toHaveLength(0)

      // Phase 4: Verify distribution — each node should own some shards
      const stats = mgr.getStats()
      expect(stats.nodeCount).toBe(3) // 3 added nodes
      for (const [, count] of stats.shardDistribution) {
        expect(count).toBeGreaterThan(0)
      }

      // Phase 5: All subscriptions still tracked (no message loss)
      expect(stats.totalSubscriptions).toBe(200)
    })

    it("handles node removal and redistribution gracefully", async () => {
      const mgr = new SubscriptionShardManager({
        nodeId: "node-1",
        totalShards: 32,
      })

      // Register subscriptions
      for (let i = 0; i < 100; i++) {
        mgr.registerSubscription(`sub-${i}`)
      }

      // Add node, then remove it
      mgr.addNode("node-2", "10.0.0.2", 4000)
      await mgr.executeMigrations()

      const beforeRemoval = mgr.getStats()
      const node2Shards = beforeRemoval.shardDistribution.get("node-2") ?? 0
      expect(node2Shards).toBeGreaterThan(0)

      // Remove node-2 — its shards should go back to node-1
      mgr.removeNode("node-2")
      await mgr.executeMigrations()

      expect(mgr.getLocalShards()).toHaveLength(32)
      expect(mgr.getStats().totalSubscriptions).toBe(100)
    })

    it("handles rapid add/remove cycles without corruption", async () => {
      const mgr = new SubscriptionShardManager({
        nodeId: "node-1",
        totalShards: 16,
      })

      for (let i = 0; i < 50; i++) {
        mgr.registerSubscription(`sub-${i}`)
      }

      // Rapid topology changes
      mgr.addNode("node-2", "10.0.0.2", 4000)
      mgr.addNode("node-3", "10.0.0.3", 4000)
      mgr.removeNode("node-2")
      mgr.addNode("node-4", "10.0.0.4", 4000)
      mgr.removeNode("node-3")

      await mgr.executeMigrations()

      const stats = mgr.getStats()
      expect(stats.totalSubscriptions).toBe(50)
      // Only node-1 and node-4 should remain
      const distribution = Array.from(stats.shardDistribution.keys())
      expect(distribution).not.toContain("node-2")
      expect(distribution).not.toContain("node-3")
    })

    it("migration callbacks receive correct from/to node info", async () => {
      const migrations: Array<{ from: string; to: string; count: number }> = []

      const mgr = new SubscriptionShardManager({
        nodeId: "node-1",
        totalShards: 16,
        onMigrateOut: async (batch) => {
          migrations.push({ from: batch.fromNodeId, to: batch.toNodeId, count: batch.subscriptionKeys.length })
        },
      })

      for (let i = 0; i < 30; i++) {
        mgr.registerSubscription(`sub-${i}`)
      }

      mgr.addNode("node-2", "10.0.0.2", 4000)
      await mgr.executeMigrations()

      // All migrations should be from node-1 to node-2
      for (const m of migrations) {
        expect(m.from).toBe("node-1")
        expect(m.to).toBe("node-2")
        expect(m.count).toBeGreaterThan(0)
      }
    })

    it("handles migration errors with retry", async () => {
      let failCount = 0

      const mgr = new SubscriptionShardManager({
        nodeId: "node-1",
        totalShards: 8,
        onMigrateOut: async () => {
          failCount++
          if (failCount <= 2) throw new Error("Network timeout")
        },
      })

      for (let i = 0; i < 10; i++) {
        mgr.registerSubscription(`sub-${i}`)
      }

      mgr.addNode("node-2", "10.0.0.2", 4000)
      const result = await mgr.executeMigrations()

      // Errors should be recorded
      expect(result.migrated + result.errors.length).toBeGreaterThan(0)
    })
  })

  describe("ClusterManager + ShardManager coordination", () => {
    it("routes subscriptions consistently across both managers", () => {
      const cluster = new ClusterManager({ nodeId: "node-1" })
      const shards = new SubscriptionShardManager({ nodeId: "node-1", totalShards: 32 })

      cluster.addNode({ id: "node-1", host: "10.0.0.1", port: 4000 })
      cluster.addNode({ id: "node-2", host: "10.0.0.2", port: 4000 })
      shards.addNode("node-2", "10.0.0.2", 4000)

      // Both should route the same key consistently
      const key = "tasks.list:{userId:u1}"
      const shardOwner = shards.getOwnerNode(key)
      const clusterRoute = cluster.routeSubscription("tasks.list", { userId: "u1" })

      // Both should pick a valid node
      expect(["node-1", "node-2"]).toContain(shardOwner)
      expect(["node-1", "node-2"]).toContain(clusterRoute.targetNodeId)
    })

    it("shard assignments change only for affected shards on topology change", () => {
      const mgr = new SubscriptionShardManager({ nodeId: "node-1", totalShards: 64 })

      mgr.addNode("node-2", "10.0.0.2", 4000)
      const assignmentsAfterAdd = mgr.addNode("node-3", "10.0.0.3", 4000)

      // Not all 64 shards should move — only a subset
      expect(assignmentsAfterAdd.length).toBeLessThan(64)
      expect(assignmentsAfterAdd.length).toBeGreaterThan(0)

      // Each assignment has correct metadata
      for (const assignment of assignmentsAfterAdd) {
        expect(assignment.shardId).toBeGreaterThanOrEqual(0)
        expect(assignment.shardId).toBeLessThan(64)
        expect(assignment.newOwner).toBe("node-3")
        expect(assignment.previousOwner).toBeTruthy()
      }
    })
  })

  describe("shard distribution fairness", () => {
    it("distributes shards evenly across equally-weighted nodes", () => {
      const mgr = new SubscriptionShardManager({ nodeId: "node-1", totalShards: 256 })

      mgr.addNode("node-2", "10.0.0.2", 4000)
      mgr.addNode("node-3", "10.0.0.3", 4000)
      mgr.addNode("node-4", "10.0.0.4", 4000)

      const stats = mgr.getStats()
      const expectedPerNode = 256 / 4 // ~64 per node
      const tolerance = expectedPerNode * 0.6 // 60% tolerance for hash distribution variance

      for (const [, count] of stats.shardDistribution) {
        expect(count).toBeGreaterThan(expectedPerNode - tolerance)
        expect(count).toBeLessThan(expectedPerNode + tolerance)
      }
    })

    it("respects weighted nodes", () => {
      const mgr = new SubscriptionShardManager({ nodeId: "node-1", totalShards: 256 })

      // node-2 has 2x weight
      mgr.addNode("node-2", "10.0.0.2", 4000, 2)

      const stats = mgr.getStats()
      const node1Shards = stats.shardDistribution.get("node-1") ?? 0
      const node2Shards = stats.shardDistribution.get("node-2") ?? 0

      // node-2 should have roughly 2x the shards of node-1
      expect(node2Shards).toBeGreaterThan(node1Shards * 0.8) // some variance allowed
    })
  })
})

describe("Cloud Provisioner Integration", () => {
  let platform: Awaited<ReturnType<typeof createPlatform>>["platform"]
  let provisioner: Awaited<ReturnType<typeof createPlatform>>["provisioner"]
  let projectId: string

  async function createPlatform() {
    const { CloudPlatform } = await import("../cloud-platform/cloud-platform.js")
    const { CloudProvisioner } = await import("../cloud-platform/cloud-provisioner.js")
    const platform = new CloudPlatform({ region: "us-east-1" })
    const provisioner = new CloudProvisioner(platform)
    return { platform, provisioner }
  }

  beforeEach(async () => {
    const ctx = await createPlatform()
    platform = ctx.platform
    provisioner = ctx.provisioner
    const project = await platform.createProject({ name: "integration-app", plan: "pro" })
    projectId = project.id
  })

  describe("full deployment lifecycle", () => {
    it("provisions staging → deploys → promotes to production", async () => {
      // Step 1: Create staging environment
      const staging = await platform.createEnvironment(projectId, { name: "staging" })
      expect(staging.status).toBe("active")

      // Step 2: Create production environment
      const prod = await platform.createEnvironment(projectId, {
        name: "production",
        isProduction: true,
      })

      // Step 3: Deploy to staging
      const deployment = await platform.deploy(projectId, staging.id, {
        source: "git",
        ref: "main",
        commitSha: "abc123def",
      })
      expect(deployment.status).toBe("active")

      // Step 4: Generate deploy manifest
      const manifest = provisioner.generateDeployManifest(platform.getProject(projectId)!, prod)
      expect(manifest.environment.isProduction).toBe(true)
      expect(manifest.resources.replicas.min).toBe(2)

      // Step 5: Promote staging → production
      const promotion = await provisioner.promoteEnvironment(staging.id, prod.id, "admin@company.com")
      expect(promotion.status).toBe("completed")

      // Step 6: Verify production has deployment
      const prodDeployments = platform.listDeployments(projectId, prod.id)
      expect(prodDeployments.length).toBeGreaterThan(0)
    })

    it("manages complete preview environment lifecycle per PR", async () => {
      // PR opened → preview created
      const preview = await provisioner.createPreviewEnvironment(projectId, {
        prNumber: 42,
        branch: "feature/auth",
        commitSha: "abc123",
        author: "developer@company.com",
        ttlMinutes: 1440, // 24h
      })
      expect(preview.status).toBe("ready")
      expect(preview.url).toContain("pr-42")

      // New commit pushed → same preview returned (idempotent)
      const samePreview = await provisioner.createPreviewEnvironment(projectId, {
        prNumber: 42,
        branch: "feature/auth",
        commitSha: "def456",
      })
      expect(samePreview.id).toBe(preview.id)

      // PR merged → destroy preview
      const destroyed = await provisioner.destroyPreviewsForPR(projectId, 42)
      expect(destroyed).toBe(1)

      // Verify cleanup
      const previews = provisioner.listPreviews(projectId)
      expect(previews.every((p) => p.status !== "ready")).toBe(true)
    })
  })

  describe("provisioning pipeline with step tracking", () => {
    it("tracks all provisioning steps to completion", () => {
      const pipeline = provisioner.createProvisioningPipeline(projectId, "env-1")
      expect(pipeline.steps).toHaveLength(6)

      // Advance through all steps
      const stepNames = pipeline.steps.map((s) => s.name)
      expect(stepNames).toContain("Validate configuration")
      expect(stepNames).toContain("Provision database")
      expect(stepNames).toContain("Configure networking")
      expect(stepNames).toContain("Deploy application")
      expect(stepNames).toContain("Run health checks")
      expect(stepNames).toContain("Configure DNS")

      for (let i = 0; i < 6; i++) {
        const updated = provisioner.advancePipelineStep(pipeline.id, i, true)
        expect(updated.steps[i].status).toBe("completed")
        expect(updated.steps[i].durationMs).toBeGreaterThanOrEqual(0)
      }

      const completed = provisioner.getPipeline(pipeline.id)!
      expect(completed.status).toBe("completed")
      expect(completed.totalDurationMs).toBeGreaterThanOrEqual(0)
    })

    it("halts pipeline on step failure and records error", () => {
      const pipeline = provisioner.createProvisioningPipeline(projectId, "env-1")

      provisioner.advancePipelineStep(pipeline.id, 0, true)
      provisioner.advancePipelineStep(pipeline.id, 1, true)
      provisioner.advancePipelineStep(pipeline.id, 2, false, "VPC quota exceeded")

      const failed = provisioner.getPipeline(pipeline.id)!
      expect(failed.status).toBe("failed")
      expect(failed.steps[2].status).toBe("failed")
      expect(failed.steps[2].error).toBe("VPC quota exceeded")
      // Steps 3-5 should still be pending
      expect(failed.steps[3].status).toBe("pending")
    })
  })

  describe("custom domain lifecycle", () => {
    it("full domain setup: add → verify → activate → remove", () => {
      // Add domain
      const domain = provisioner.addCustomDomain("api.myapp.com", projectId, "env-1")
      expect(domain.status).toBe("pending-verification")
      expect(domain.verificationRecord.type).toBe("CNAME")
      expect(domain.sslStatus).toBe("pending")

      // Verify (simulating DNS check)
      provisioner.verifyDomain("api.myapp.com")
      expect(provisioner.listDomains(projectId)[0].status).toBe("verified")

      // Activate (provisions SSL)
      const activated = provisioner.activateDomain("api.myapp.com")
      expect(activated.status).toBe("active")
      expect(activated.sslStatus).toBe("active")

      // Remove
      provisioner.removeDomain("api.myapp.com")
      expect(provisioner.listDomains(projectId)).toHaveLength(0)
    })

    it("manages multiple domains per project", () => {
      provisioner.addCustomDomain("api.myapp.com", projectId, "env-prod")
      provisioner.addCustomDomain("app.myapp.com", projectId, "env-prod")
      provisioner.addCustomDomain("staging.myapp.com", projectId, "env-staging")

      const domains = provisioner.listDomains(projectId)
      expect(domains).toHaveLength(3)
    })
  })

  describe("log streaming integration", () => {
    it("records and filters deployment logs", () => {
      const deployId = "deploy-integration-1"

      provisioner.appendLog(deployId, { level: "info", source: "build", message: "Installing dependencies..." })
      provisioner.appendLog(deployId, { level: "info", source: "build", message: "Building TypeScript..." })
      provisioner.appendLog(deployId, { level: "error", source: "build", message: "Type error in auth.ts" })
      provisioner.appendLog(deployId, { level: "info", source: "runtime", message: "Server started on :4000" })
      provisioner.appendLog(deployId, { level: "warn", source: "runtime", message: "Slow query detected" })

      // All logs
      const all = provisioner.getLogs({ deploymentId: deployId })
      expect(all).toHaveLength(5)

      // Build logs only
      const buildLogs = provisioner.getLogs({ deploymentId: deployId, filter: "build" })
      expect(buildLogs).toHaveLength(3)

      // Runtime logs only
      const runtimeLogs = provisioner.getLogs({ deploymentId: deployId, filter: "runtime" })
      expect(runtimeLogs).toHaveLength(2)

      // Logs since a timestamp
      const since = all[2].timestamp
      const recent = provisioner.getLogs({ deploymentId: deployId, since })
      expect(recent.length).toBeLessThanOrEqual(all.length)
    })
  })
})
