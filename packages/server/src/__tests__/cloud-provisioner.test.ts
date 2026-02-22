import { describe, it, expect } from "vitest"
import { CloudPlatform } from "../cloud-platform/cloud-platform.js"
import { CloudProvisioner, generatePreviewEnvTableSQL, generateCustomDomainTableSQL } from "../cloud-platform/cloud-provisioner.js"

function createPlatformWithProject() {
  const platform = new CloudPlatform({ region: "us-east-1" })
  return { platform }
}

describe("CloudProvisioner", () => {
  describe("preview environments", () => {
    it("creates a preview environment for a PR", async () => {
      const { platform } = createPlatformWithProject()
      const project = await platform.createProject({ name: "my-app", plan: "starter" })
      const provisioner = new CloudProvisioner(platform)

      const preview = await provisioner.createPreviewEnvironment(project.id, {
        prNumber: 42,
        branch: "feature/auth",
        commitSha: "abc123",
        author: "dev@example.com",
      })

      expect(preview.prNumber).toBe(42)
      expect(preview.branch).toBe("feature/auth")
      expect(preview.status).toBe("ready")
      expect(preview.url).toContain("pr-42")
    })

    it("returns existing preview for same PR", async () => {
      const { platform } = createPlatformWithProject()
      const project = await platform.createProject({ name: "my-app", plan: "starter" })
      const provisioner = new CloudProvisioner(platform)

      const config = { prNumber: 42, branch: "feat", commitSha: "abc" }
      const preview1 = await provisioner.createPreviewEnvironment(project.id, config)
      const preview2 = await provisioner.createPreviewEnvironment(project.id, config)
      expect(preview1.id).toBe(preview2.id)
    })

    it("destroys a preview environment", async () => {
      const { platform } = createPlatformWithProject()
      const project = await platform.createProject({ name: "my-app", plan: "starter" })
      const provisioner = new CloudProvisioner(platform)

      const preview = await provisioner.createPreviewEnvironment(project.id, {
        prNumber: 10,
        branch: "fix",
        commitSha: "def",
      })

      await provisioner.destroyPreviewEnvironment(preview.id)
      const previews = provisioner.listPreviews(project.id)
      expect(previews[0].status).toBe("destroyed")
    })

    it("destroys all previews for a PR", async () => {
      const { platform } = createPlatformWithProject()
      const project = await platform.createProject({ name: "my-app", plan: "pro" })
      const provisioner = new CloudProvisioner(platform)

      await provisioner.createPreviewEnvironment(project.id, { prNumber: 10, branch: "a", commitSha: "x" })
      const count = await provisioner.destroyPreviewsForPR(project.id, 10)
      expect(count).toBe(1)
    })

    it("cleans up expired previews", async () => {
      const { platform } = createPlatformWithProject()
      const project = await platform.createProject({ name: "my-app", plan: "starter" })
      const provisioner = new CloudProvisioner(platform)

      const preview = await provisioner.createPreviewEnvironment(project.id, {
        prNumber: 99,
        branch: "expired",
        commitSha: "old",
        ttlMinutes: 0, // Expire immediately
      })

      // Force expiry
      preview.expiresAt = Date.now() - 1000
      const expired = provisioner.cleanupExpiredPreviews()
      expect(expired).toHaveLength(1)
      expect(expired[0].status).toBe("expired")
    })
  })

  describe("deploy manifest", () => {
    it("generates a deploy manifest for production", async () => {
      const { platform } = createPlatformWithProject()
      const project = await platform.createProject({ name: "my-app", plan: "pro" })
      const env = await platform.createEnvironment(project.id, { name: "production", isProduction: true })
      const provisioner = new CloudProvisioner(platform)

      const manifest = provisioner.generateDeployManifest(project, env)

      expect(manifest.version).toBe("1.0")
      expect(manifest.project.name).toBe("my-app")
      expect(manifest.environment.isProduction).toBe(true)
      expect(manifest.build.runtime).toBe("nodejs-20")
      expect(manifest.build.envVars.NODE_ENV).toBe("production")
      expect(manifest.resources.redis.enabled).toBe(true)
      expect(manifest.resources.replicas.min).toBe(2)
    })

    it("generates different config for non-production", async () => {
      const { platform } = createPlatformWithProject()
      const project = await platform.createProject({ name: "my-app", plan: "starter" })
      const env = await platform.createEnvironment(project.id, { name: "staging" })
      const provisioner = new CloudProvisioner(platform)

      const manifest = provisioner.generateDeployManifest(project, env)
      expect(manifest.build.envVars.NODE_ENV).toBe("development")
      expect(manifest.resources.redis.enabled).toBe(false)
      expect(manifest.resources.replicas.min).toBe(1)
    })

    it("accepts build overrides", async () => {
      const { platform } = createPlatformWithProject()
      const project = await platform.createProject({ name: "my-app", plan: "starter" })
      const env = await platform.createEnvironment(project.id, { name: "staging" })
      const provisioner = new CloudProvisioner(platform)

      const manifest = provisioner.generateDeployManifest(project, env, {
        buildCommand: "turbo build",
        startCommand: "node dist/server.js",
      })

      expect(manifest.build.buildCommand).toBe("turbo build")
      expect(manifest.build.startCommand).toBe("node dist/server.js")
    })
  })

  describe("provisioning pipeline", () => {
    it("creates a pipeline with pending steps", () => {
      const platform = new CloudPlatform()
      const provisioner = new CloudProvisioner(platform)

      const pipeline = provisioner.createProvisioningPipeline("proj-1", "env-1")
      expect(pipeline.steps).toHaveLength(6)
      expect(pipeline.status).toBe("running")
      expect(pipeline.steps.every((s) => s.status === "pending")).toBe(true)
    })

    it("advances pipeline steps to completion", () => {
      const platform = new CloudPlatform()
      const provisioner = new CloudProvisioner(platform)

      const pipeline = provisioner.createProvisioningPipeline("proj-1", "env-1")
      for (let i = 0; i < pipeline.steps.length; i++) {
        provisioner.advancePipelineStep(pipeline.id, i, true)
      }

      const updated = provisioner.getPipeline(pipeline.id)!
      expect(updated.status).toBe("completed")
      expect(updated.totalDurationMs).toBeGreaterThanOrEqual(0)
    })

    it("marks pipeline as failed on step failure", () => {
      const platform = new CloudPlatform()
      const provisioner = new CloudProvisioner(platform)

      const pipeline = provisioner.createProvisioningPipeline("proj-1", "env-1")
      provisioner.advancePipelineStep(pipeline.id, 0, true)
      provisioner.advancePipelineStep(pipeline.id, 1, false, "Database quota exceeded")

      const updated = provisioner.getPipeline(pipeline.id)!
      expect(updated.status).toBe("failed")
      expect(updated.steps[1].error).toBe("Database quota exceeded")
    })
  })

  describe("custom domains", () => {
    it("adds and verifies a custom domain", () => {
      const platform = new CloudPlatform()
      const provisioner = new CloudProvisioner(platform)

      const domain = provisioner.addCustomDomain("app.example.com", "proj-1", "env-1")
      expect(domain.status).toBe("pending-verification")
      expect(domain.verificationRecord.type).toBe("CNAME")

      provisioner.verifyDomain("app.example.com")
      const verified = provisioner.listDomains("proj-1")
      expect(verified[0].status).toBe("verified")
    })

    it("activates a verified domain with SSL", () => {
      const platform = new CloudPlatform()
      const provisioner = new CloudProvisioner(platform)

      provisioner.addCustomDomain("app.example.com", "proj-1", "env-1")
      provisioner.verifyDomain("app.example.com")
      const activated = provisioner.activateDomain("app.example.com")

      expect(activated.status).toBe("active")
      expect(activated.sslStatus).toBe("active")
    })

    it("prevents activating unverified domain", () => {
      const platform = new CloudPlatform()
      const provisioner = new CloudProvisioner(platform)

      provisioner.addCustomDomain("app.example.com", "proj-1", "env-1")
      expect(() => provisioner.activateDomain("app.example.com")).toThrow("verified first")
    })

    it("prevents duplicate domains", () => {
      const platform = new CloudPlatform()
      const provisioner = new CloudProvisioner(platform)

      provisioner.addCustomDomain("app.example.com", "proj-1", "env-1")
      expect(() => provisioner.addCustomDomain("app.example.com", "proj-2", "env-2")).toThrow("already registered")
    })

    it("removes a domain", () => {
      const platform = new CloudPlatform()
      const provisioner = new CloudProvisioner(platform)

      provisioner.addCustomDomain("app.example.com", "proj-1", "env-1")
      provisioner.removeDomain("app.example.com")
      expect(provisioner.listDomains("proj-1")).toHaveLength(0)
    })
  })

  describe("environment promotion", () => {
    it("promotes staging to production", async () => {
      const platform = new CloudPlatform()
      const provisioner = new CloudProvisioner(platform)
      const project = await platform.createProject({ name: "test", plan: "pro" })
      const staging = await platform.createEnvironment(project.id, { name: "staging" })
      const prod = await platform.createEnvironment(project.id, { name: "production", isProduction: true })

      await platform.deploy(project.id, staging.id, { source: "git", ref: "main", commitSha: "abc" })
      const promotion = await provisioner.promoteEnvironment(staging.id, prod.id, "admin@example.com")

      expect(promotion.status).toBe("completed")
      expect(promotion.promotedBy).toBe("admin@example.com")
    })
  })

  describe("log streaming", () => {
    it("appends and retrieves logs", () => {
      const platform = new CloudPlatform()
      const provisioner = new CloudProvisioner(platform)

      provisioner.appendLog("deploy-1", { level: "info", source: "build", message: "Building..." })
      provisioner.appendLog("deploy-1", { level: "error", source: "build", message: "Build failed" })
      provisioner.appendLog("deploy-1", { level: "info", source: "runtime", message: "Started" })

      const allLogs = provisioner.getLogs({ deploymentId: "deploy-1" })
      expect(allLogs).toHaveLength(3)

      const errorLogs = provisioner.getLogs({ deploymentId: "deploy-1", filter: "build" })
      expect(errorLogs).toHaveLength(2)
    })
  })
})

describe("SQL builders", () => {
  it("generates preview env table SQL", () => {
    const sql = generatePreviewEnvTableSQL()
    expect(sql).toContain("_reactivebase_preview_envs")
    expect(sql).toContain("pr_number")
  })

  it("generates custom domain table SQL", () => {
    const sql = generateCustomDomainTableSQL()
    expect(sql).toContain("_reactivebase_custom_domains")
    expect(sql).toContain("ssl_status")
  })
})
