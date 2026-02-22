import { describe, it, expect, beforeEach } from "vitest"
import { CloudPlatform } from "../cloud-platform/cloud-platform.js"
import type { CloudProjectRecord, EnvironmentRecord } from "../cloud-platform/cloud-platform.js"

describe("CloudPlatform", () => {
  let platform: CloudPlatform

  beforeEach(() => {
    platform = new CloudPlatform({ region: "us-east-1", maxProjectsPerOrg: 5 })
  })

  // ─── Projects ──────────────────────────────────────────────────────────

  describe("Projects", () => {
    it("creates a project with active status", async () => {
      const project = await platform.createProject({ name: "my-app", plan: "starter" })
      expect(project.name).toBe("my-app")
      expect(project.plan).toBe("starter")
      expect(project.status).toBe("active")
      expect(project.databaseUrl).toContain("postgresql://")
      expect(project.region).toBe("us-east-1")
    })

    it("gets a project by ID", async () => {
      const project = await platform.createProject({ name: "test", plan: "free" })
      const found = platform.getProject(project.id)
      expect(found).toBeDefined()
      expect(found!.name).toBe("test")
    })

    it("lists all projects", async () => {
      await platform.createProject({ name: "a", plan: "free" })
      await platform.createProject({ name: "b", plan: "starter" })
      expect(platform.listProjects()).toHaveLength(2)
    })

    it("lists projects by org", async () => {
      await platform.createProject({ name: "a", plan: "free", orgId: "org1" })
      await platform.createProject({ name: "b", plan: "free", orgId: "org2" })
      expect(platform.listProjects("org1")).toHaveLength(1)
    })

    it("enforces max projects per org", async () => {
      for (let i = 0; i < 5; i++) {
        await platform.createProject({ name: `p${i}`, plan: "free", orgId: "org1" })
      }
      await expect(
        platform.createProject({ name: "p5", plan: "free", orgId: "org1" }),
      ).rejects.toThrow("maximum of 5 projects")
    })

    it("updates project plan", async () => {
      const project = await platform.createProject({ name: "test", plan: "free" })
      const updated = await platform.updateProjectPlan(project.id, "pro")
      expect(updated.plan).toBe("pro")
    })

    it("deletes project and its environments", async () => {
      const project = await platform.createProject({ name: "test", plan: "free" })
      await platform.createEnvironment(project.id, { name: "staging" })
      await platform.deleteProject(project.id)
      expect(platform.getProject(project.id)).toBeUndefined()
      expect(platform.listEnvironments(project.id)).toHaveLength(0)
    })

    it("throws on unknown project update", async () => {
      await expect(platform.updateProjectPlan("nonexistent", "pro")).rejects.toThrow("not found")
    })
  })

  // ─── Environments ──────────────────────────────────────────────────────

  describe("Environments", () => {
    let project: CloudProjectRecord

    beforeEach(async () => {
      project = await platform.createProject({ name: "my-app", plan: "pro" })
    })

    it("creates environment with active status", async () => {
      const env = await platform.createEnvironment(project.id, { name: "staging" })
      expect(env.name).toBe("staging")
      expect(env.status).toBe("active")
      expect(env.url).toContain("staging")
      expect(env.databaseUrl).toContain("postgresql://")
    })

    it("lists environments for a project", async () => {
      await platform.createEnvironment(project.id, { name: "dev" })
      await platform.createEnvironment(project.id, { name: "staging" })
      expect(platform.listEnvironments(project.id)).toHaveLength(2)
    })

    it("enforces environment limit per plan", async () => {
      const smallProject = await platform.createProject({ name: "small", plan: "free" })
      await platform.createEnvironment(smallProject.id, { name: "env1" })
      await platform.createEnvironment(smallProject.id, { name: "env2" })
      await expect(
        platform.createEnvironment(smallProject.id, { name: "env3" }),
      ).rejects.toThrow("maximum of 2 environments")
    })

    it("deletes non-production environment", async () => {
      const env = await platform.createEnvironment(project.id, { name: "staging" })
      await platform.deleteEnvironment(env.id)
      expect(platform.getEnvironment(env.id)).toBeUndefined()
    })

    it("prevents deleting production environment", async () => {
      const env = await platform.createEnvironment(project.id, {
        name: "production",
        isProduction: true,
      })
      await expect(platform.deleteEnvironment(env.id)).rejects.toThrow("Cannot delete production")
    })
  })

  // ─── Deployments ───────────────────────────────────────────────────────

  describe("Deployments", () => {
    let project: CloudProjectRecord
    let env: EnvironmentRecord

    beforeEach(async () => {
      project = await platform.createProject({ name: "my-app", plan: "starter" })
      env = await platform.createEnvironment(project.id, { name: "production" })
    })

    it("creates deployment with build lifecycle", async () => {
      const deployment = await platform.deploy(project.id, env.id, {
        source: "git",
        ref: "main",
      })
      expect(deployment.status).toBe("active")
      expect(deployment.source).toBe("git")
      expect(deployment.ref).toBe("main")
      expect(deployment.buildLogs.length).toBeGreaterThan(0)
      expect(deployment.completedAt).not.toBeNull()
    })

    it("lists deployments for project", async () => {
      await platform.deploy(project.id, env.id, { source: "git" })
      await platform.deploy(project.id, env.id, { source: "cli" })
      expect(platform.listDeployments(project.id)).toHaveLength(2)
    })

    it("rolls back deployment", async () => {
      const deployment = await platform.deploy(project.id, env.id, { source: "git" })
      const rolledBack = await platform.rollbackDeployment(deployment.id)
      expect(rolledBack.status).toBe("rolled-back")
    })
  })

  // ─── Team ──────────────────────────────────────────────────────────────

  describe("Team", () => {
    let project: CloudProjectRecord

    beforeEach(async () => {
      project = await platform.createProject({ name: "team-app", plan: "pro" })
    })

    it("adds team member", () => {
      const member = platform.addTeamMember(project.id, {
        userId: "u1",
        email: "alice@example.com",
        role: "developer",
      })
      expect(member.email).toBe("alice@example.com")
      expect(member.invitedAt).toBeDefined()
    })

    it("prevents duplicate members", () => {
      platform.addTeamMember(project.id, { userId: "u1", email: "a@b.com", role: "developer" })
      expect(() =>
        platform.addTeamMember(project.id, { userId: "u1", email: "a@b.com", role: "admin" }),
      ).toThrow("already a member")
    })

    it("removes team member", () => {
      platform.addTeamMember(project.id, { userId: "u1", email: "a@b.com", role: "developer" })
      platform.removeTeamMember(project.id, "u1")
      expect(platform.listTeamMembers(project.id)).toHaveLength(0)
    })

    it("prevents removing owner", () => {
      platform.addTeamMember(project.id, { userId: "u1", email: "a@b.com", role: "owner" })
      expect(() => platform.removeTeamMember(project.id, "u1")).toThrow("Cannot remove project owner")
    })
  })

  // ─── Usage & Billing ───────────────────────────────────────────────────

  describe("Usage & Billing", () => {
    it("records and retrieves usage", async () => {
      const project = await platform.createProject({ name: "test", plan: "starter" })
      const usage = platform.recordUsage(project.id, {
        functionInvocations: 50000,
        databaseStorageMb: 100,
        bandwidthMb: 500,
        activeConnections: 10,
        scheduledJobs: 5,
      })
      expect(usage.functionInvocations).toBe(50000)

      const retrieved = platform.getUsage(project.id)
      expect(retrieved).toBeDefined()
    })

    it("returns plan limits", () => {
      const limits = platform.getPlanLimits("free")
      expect(limits.functionInvocationsPerMonth).toBe(100_000)
      expect(limits.maxEnvironments).toBe(2)
    })

    it("estimates cost with no overage", () => {
      const estimate = platform.estimateCost("starter", {
        functionInvocations: 500_000,
        databaseStorageMb: 1000,
        bandwidthMb: 5000,
      })
      expect(estimate.baseCostCents).toBe(2500)
      expect(estimate.overageCostCents).toBe(0)
      expect(estimate.totalCostCents).toBe(2500)
    })

    it("estimates cost with overage", () => {
      const estimate = platform.estimateCost("free", {
        functionInvocations: 200_000,
        databaseStorageMb: 2000,
        bandwidthMb: 3000,
      })
      expect(estimate.baseCostCents).toBe(0)
      expect(estimate.overageCostCents).toBeGreaterThan(0)
      expect(estimate.breakdown).toHaveLength(3)
    })

    it("enterprise has zero overage", () => {
      const estimate = platform.estimateCost("enterprise", {
        functionInvocations: 100_000_000,
        databaseStorageMb: 1_000_000,
        bandwidthMb: 500_000,
      })
      expect(estimate.overageCostCents).toBe(0)
    })
  })
})
