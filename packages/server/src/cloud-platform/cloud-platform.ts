/**
 * ReactiveBase Cloud Platform — Managed Cloud Control Plane.
 * Provides project management, environment provisioning, deployment pipeline,
 * team collaboration, and usage-based billing APIs.
 *
 * Usage:
 *   const platform = new CloudPlatform({ region: "us-east-1" })
 *   const project = await platform.createProject({ name: "my-app", plan: "starter" })
 *   const env = await platform.createEnvironment(project.id, { name: "staging" })
 *   await platform.deploy(project.id, env.id, { source: "git", ref: "main" })
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CloudPlatformOptions {
  /** Default region for new projects (default: "us-east-1") */
  region?: string
  /** Billing provider integration */
  billingProvider?: BillingProvider
  /** Max projects per organization (default: 50) */
  maxProjectsPerOrg?: number
  /** Max environments per project (default: 10) */
  maxEnvsPerProject?: number
}

export type ProjectPlan = "free" | "starter" | "pro" | "enterprise"

export interface CloudProjectConfig {
  name: string
  plan: ProjectPlan
  orgId?: string
  region?: string
  description?: string
}

export interface CloudProjectRecord {
  id: string
  name: string
  plan: ProjectPlan
  orgId: string
  region: string
  description: string
  status: "creating" | "active" | "suspended" | "deleting"
  databaseUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface EnvironmentConfig {
  name: string
  isProduction?: boolean
  parentEnvId?: string
  variables?: Record<string, string>
}

export interface EnvironmentRecord {
  id: string
  projectId: string
  name: string
  isProduction: boolean
  status: "provisioning" | "active" | "sleeping" | "error"
  url: string | null
  databaseUrl: string | null
  variables: Record<string, string>
  createdAt: string
}

export interface DeploymentConfig {
  source: "git" | "upload" | "cli"
  ref?: string
  commitSha?: string
  message?: string
}

export interface DeploymentRecord {
  id: string
  projectId: string
  environmentId: string
  source: DeploymentConfig["source"]
  ref: string | null
  commitSha: string | null
  status: "queued" | "building" | "deploying" | "active" | "failed" | "rolled-back"
  buildLogs: string[]
  startedAt: string
  completedAt: string | null
  url: string | null
}

export interface TeamMember {
  userId: string
  email: string
  role: "owner" | "admin" | "developer" | "viewer"
  invitedAt: string
  acceptedAt: string | null
}

export interface UsageRecord {
  projectId: string
  period: string
  functionInvocations: number
  databaseStorageMb: number
  bandwidthMb: number
  activeConnections: number
  scheduledJobs: number
}

export interface UsageLimits {
  plan: ProjectPlan
  functionInvocationsPerMonth: number
  databaseStorageMb: number
  bandwidthMb: number
  maxConnections: number
  maxEnvironments: number
}

export interface CostEstimate {
  plan: ProjectPlan
  baseCostCents: number
  overageCostCents: number
  totalCostCents: number
  breakdown: CostBreakdownItem[]
}

export interface CostBreakdownItem {
  category: string
  usage: number
  includedInPlan: number
  overage: number
  unitCostCents: number
  totalCents: number
}

export interface BillingProvider {
  createCustomer(email: string, name: string): Promise<string>
  createSubscription(customerId: string, plan: ProjectPlan): Promise<string>
  recordUsage(subscriptionId: string, usage: UsageRecord): Promise<void>
  cancelSubscription(subscriptionId: string): Promise<void>
}

// ─── Plan Limits ─────────────────────────────────────────────────────────────

const PLAN_LIMITS: Record<ProjectPlan, UsageLimits> = {
  free: {
    plan: "free",
    functionInvocationsPerMonth: 100_000,
    databaseStorageMb: 500,
    bandwidthMb: 1_000,
    maxConnections: 50,
    maxEnvironments: 2,
  },
  starter: {
    plan: "starter",
    functionInvocationsPerMonth: 1_000_000,
    databaseStorageMb: 5_000,
    bandwidthMb: 10_000,
    maxConnections: 200,
    maxEnvironments: 5,
  },
  pro: {
    plan: "pro",
    functionInvocationsPerMonth: 10_000_000,
    databaseStorageMb: 50_000,
    bandwidthMb: 100_000,
    maxConnections: 1_000,
    maxEnvironments: 10,
  },
  enterprise: {
    plan: "enterprise",
    functionInvocationsPerMonth: Infinity,
    databaseStorageMb: Infinity,
    bandwidthMb: Infinity,
    maxConnections: Infinity,
    maxEnvironments: Infinity,
  },
}

const PLAN_BASE_COST_CENTS: Record<ProjectPlan, number> = {
  free: 0,
  starter: 2500,    // $25/mo
  pro: 9900,        // $99/mo
  enterprise: 49900, // $499/mo
}

// ─── Cloud Platform ──────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<CloudPlatformOptions, "billingProvider">> & { billingProvider: BillingProvider | null } = {
  region: "us-east-1",
  billingProvider: null,
  maxProjectsPerOrg: 50,
  maxEnvsPerProject: 10,
}

/**
 * Core cloud platform management for ReactiveBase Cloud.
 * Manages projects, environments, deployments, team members, and usage tracking.
 */
export class CloudPlatform {
  private options: typeof DEFAULT_OPTIONS
  private projects = new Map<string, CloudProjectRecord>()
  private environments = new Map<string, EnvironmentRecord>()
  private deployments = new Map<string, DeploymentRecord>()
  private teamMembers = new Map<string, TeamMember[]>()
  private usage = new Map<string, UsageRecord>()
  private idCounter = 0

  constructor(options: CloudPlatformOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options } as typeof DEFAULT_OPTIONS
  }

  private generateId(prefix: string): string {
    return `${prefix}_${++this.idCounter}_${Date.now().toString(36)}`
  }

  // ─── Projects ────────────────────────────────────────────────────────────

  async createProject(config: CloudProjectConfig): Promise<CloudProjectRecord> {
    const orgId = config.orgId ?? "default_org"
    const orgProjects = [...this.projects.values()].filter((p) => p.orgId === orgId)
    if (orgProjects.length >= this.options.maxProjectsPerOrg) {
      throw new Error(`Organization has reached the maximum of ${this.options.maxProjectsPerOrg} projects`)
    }

    const project: CloudProjectRecord = {
      id: this.generateId("proj"),
      name: config.name,
      plan: config.plan,
      orgId,
      region: config.region ?? this.options.region,
      description: config.description ?? "",
      status: "creating",
      databaseUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    this.projects.set(project.id, project)
    this.teamMembers.set(project.id, [])

    // Simulate provisioning completion
    project.status = "active"
    project.databaseUrl = `postgresql://rb_${project.id}:****@db.${project.region}.reactivebase.cloud:5432/rb_${project.id}`
    project.updatedAt = new Date().toISOString()

    return project
  }

  getProject(projectId: string): CloudProjectRecord | undefined {
    return this.projects.get(projectId)
  }

  listProjects(orgId?: string): CloudProjectRecord[] {
    const all = [...this.projects.values()]
    return orgId ? all.filter((p) => p.orgId === orgId) : all
  }

  async updateProjectPlan(projectId: string, plan: ProjectPlan): Promise<CloudProjectRecord> {
    const project = this.projects.get(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)

    project.plan = plan
    project.updatedAt = new Date().toISOString()
    return project
  }

  async deleteProject(projectId: string): Promise<void> {
    const project = this.projects.get(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)

    project.status = "deleting"

    // Clean up environments and deployments
    for (const [id, env] of this.environments) {
      if (env.projectId === projectId) this.environments.delete(id)
    }
    for (const [id, dep] of this.deployments) {
      if (dep.projectId === projectId) this.deployments.delete(id)
    }

    this.projects.delete(projectId)
    this.teamMembers.delete(projectId)
    this.usage.delete(projectId)
  }

  // ─── Environments ────────────────────────────────────────────────────────

  async createEnvironment(projectId: string, config: EnvironmentConfig): Promise<EnvironmentRecord> {
    const project = this.projects.get(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)

    const projectEnvs = [...this.environments.values()].filter((e) => e.projectId === projectId)
    const limits = this.getPlanLimits(project.plan)
    if (projectEnvs.length >= limits.maxEnvironments) {
      throw new Error(`Project has reached the maximum of ${limits.maxEnvironments} environments for ${project.plan} plan`)
    }

    const env: EnvironmentRecord = {
      id: this.generateId("env"),
      projectId,
      name: config.name,
      isProduction: config.isProduction ?? false,
      status: "provisioning",
      url: null,
      databaseUrl: null,
      variables: config.variables ?? {},
      createdAt: new Date().toISOString(),
    }

    this.environments.set(env.id, env)

    // Simulate provisioning
    env.status = "active"
    env.url = `https://${project.name}-${env.name}.reactivebase.cloud`
    env.databaseUrl = `postgresql://rb_${env.id}:****@db.${project.region}.reactivebase.cloud:5432/rb_${env.id}`

    return env
  }

  getEnvironment(envId: string): EnvironmentRecord | undefined {
    return this.environments.get(envId)
  }

  listEnvironments(projectId: string): EnvironmentRecord[] {
    return [...this.environments.values()].filter((e) => e.projectId === projectId)
  }

  async deleteEnvironment(envId: string): Promise<void> {
    const env = this.environments.get(envId)
    if (!env) throw new Error(`Environment ${envId} not found`)
    if (env.isProduction) throw new Error("Cannot delete production environment directly")
    this.environments.delete(envId)
  }

  // ─── Deployments ─────────────────────────────────────────────────────────

  async deploy(projectId: string, envId: string, config: DeploymentConfig): Promise<DeploymentRecord> {
    const project = this.projects.get(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)

    const env = this.environments.get(envId)
    if (!env) throw new Error(`Environment ${envId} not found`)

    const deployment: DeploymentRecord = {
      id: this.generateId("deploy"),
      projectId,
      environmentId: envId,
      source: config.source,
      ref: config.ref ?? null,
      commitSha: config.commitSha ?? null,
      status: "queued",
      buildLogs: [],
      startedAt: new Date().toISOString(),
      completedAt: null,
      url: null,
    }

    this.deployments.set(deployment.id, deployment)

    // Simulate build/deploy lifecycle
    deployment.status = "building"
    deployment.buildLogs.push("[1/4] Installing dependencies...")
    deployment.buildLogs.push("[2/4] Building TypeScript...")
    deployment.buildLogs.push("[3/4] Generating types...")
    deployment.status = "deploying"
    deployment.buildLogs.push("[4/4] Deploying to environment...")
    deployment.status = "active"
    deployment.completedAt = new Date().toISOString()
    deployment.url = env.url

    return deployment
  }

  getDeployment(deploymentId: string): DeploymentRecord | undefined {
    return this.deployments.get(deploymentId)
  }

  listDeployments(projectId: string, envId?: string): DeploymentRecord[] {
    return [...this.deployments.values()].filter(
      (d) => d.projectId === projectId && (!envId || d.environmentId === envId),
    )
  }

  async rollbackDeployment(deploymentId: string): Promise<DeploymentRecord> {
    const deployment = this.deployments.get(deploymentId)
    if (!deployment) throw new Error(`Deployment ${deploymentId} not found`)
    deployment.status = "rolled-back"
    return deployment
  }

  // ─── Team ────────────────────────────────────────────────────────────────

  addTeamMember(projectId: string, member: Omit<TeamMember, "invitedAt" | "acceptedAt">): TeamMember {
    const members = this.teamMembers.get(projectId)
    if (!members) throw new Error(`Project ${projectId} not found`)

    const existing = members.find((m) => m.userId === member.userId)
    if (existing) throw new Error(`User ${member.userId} is already a member`)

    const newMember: TeamMember = {
      ...member,
      invitedAt: new Date().toISOString(),
      acceptedAt: null,
    }
    members.push(newMember)
    return newMember
  }

  removeTeamMember(projectId: string, userId: string): void {
    const members = this.teamMembers.get(projectId)
    if (!members) throw new Error(`Project ${projectId} not found`)

    const idx = members.findIndex((m) => m.userId === userId)
    if (idx === -1) throw new Error(`User ${userId} not found in project`)
    if (members[idx].role === "owner") throw new Error("Cannot remove project owner")
    members.splice(idx, 1)
  }

  listTeamMembers(projectId: string): TeamMember[] {
    return this.teamMembers.get(projectId) ?? []
  }

  // ─── Usage & Billing ─────────────────────────────────────────────────────

  recordUsage(projectId: string, usage: Omit<UsageRecord, "projectId" | "period">): UsageRecord {
    const project = this.projects.get(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)

    const period = new Date().toISOString().slice(0, 7) // YYYY-MM
    const record: UsageRecord = {
      projectId,
      period,
      ...usage,
    }
    this.usage.set(`${projectId}:${period}`, record)
    return record
  }

  getUsage(projectId: string, period?: string): UsageRecord | undefined {
    const p = period ?? new Date().toISOString().slice(0, 7)
    return this.usage.get(`${projectId}:${p}`)
  }

  getPlanLimits(plan: ProjectPlan): UsageLimits {
    return PLAN_LIMITS[plan]
  }

  estimateCost(plan: ProjectPlan, usage: Partial<UsageRecord>): CostEstimate {
    const limits = PLAN_LIMITS[plan]
    const baseCost = PLAN_BASE_COST_CENTS[plan]

    const breakdown: CostBreakdownItem[] = []
    let totalOverage = 0

    // Function invocations: $0.50 per 100K over limit
    const invocations = usage.functionInvocations ?? 0
    const invOverage = Math.max(0, invocations - limits.functionInvocationsPerMonth)
    const invCost = Math.ceil(invOverage / 100_000) * 50
    breakdown.push({
      category: "Function Invocations",
      usage: invocations,
      includedInPlan: limits.functionInvocationsPerMonth,
      overage: invOverage,
      unitCostCents: 50,
      totalCents: invCost,
    })
    totalOverage += invCost

    // Storage: $0.25 per GB over limit
    const storageMb = usage.databaseStorageMb ?? 0
    const storageOverage = Math.max(0, storageMb - limits.databaseStorageMb)
    const storageCost = Math.ceil(storageOverage / 1024) * 25
    breakdown.push({
      category: "Database Storage",
      usage: storageMb,
      includedInPlan: limits.databaseStorageMb,
      overage: storageOverage,
      unitCostCents: 25,
      totalCents: storageCost,
    })
    totalOverage += storageCost

    // Bandwidth: $0.10 per GB over limit
    const bandwidthMb = usage.bandwidthMb ?? 0
    const bwOverage = Math.max(0, bandwidthMb - limits.bandwidthMb)
    const bwCost = Math.ceil(bwOverage / 1024) * 10
    breakdown.push({
      category: "Bandwidth",
      usage: bandwidthMb,
      includedInPlan: limits.bandwidthMb,
      overage: bwOverage,
      unitCostCents: 10,
      totalCents: bwCost,
    })
    totalOverage += bwCost

    return {
      plan,
      baseCostCents: baseCost,
      overageCostCents: totalOverage,
      totalCostCents: baseCost + totalOverage,
      breakdown,
    }
  }
}
