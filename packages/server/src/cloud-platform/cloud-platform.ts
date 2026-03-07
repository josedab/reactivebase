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

import { randomBytes, createHash, timingSafeEqual } from "node:crypto"
import { CloudPlatformNotFoundError, CloudPlatformLimitError, CloudPlatformConflictError, CloudPlatformError } from "../errors.js"

/** Executes a SQL query and returns rows. Used for optional DB persistence. */
import type { QueryExecutor } from "../types/index.js"
export type { QueryExecutor } from "../types/index.js"

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
  /** Optional: persist cloud platform data to a database (e.g. Postgres) */
  db?: QueryExecutor
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
  starter: 2500, // $25/mo
  pro: 9900, // $99/mo
  enterprise: 49900, // $499/mo
}

// ─── Persistence SQL ─────────────────────────────────────────────────────────

export function generateCloudPlatformTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_cloud_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
  org_id TEXT NOT NULL,
  region TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('creating', 'active', 'suspended', 'deleting')),
  database_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _reactivebase_cloud_environments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES _reactivebase_cloud_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_production BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL CHECK (status IN ('provisioning', 'active', 'sleeping', 'error')),
  url TEXT,
  database_url TEXT,
  variables JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _reactivebase_cloud_deployments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES _reactivebase_cloud_projects(id) ON DELETE CASCADE,
  environment_id TEXT NOT NULL REFERENCES _reactivebase_cloud_environments(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('git', 'upload', 'cli')),
  ref TEXT,
  commit_sha TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'building', 'deploying', 'active', 'failed', 'rolled-back')),
  build_logs JSONB NOT NULL DEFAULT '[]',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  url TEXT
);

CREATE INDEX IF NOT EXISTS idx_cloud_envs_project
  ON _reactivebase_cloud_environments(project_id);

CREATE INDEX IF NOT EXISTS idx_cloud_deployments_project
  ON _reactivebase_cloud_deployments(project_id);

CREATE INDEX IF NOT EXISTS idx_cloud_deployments_env
  ON _reactivebase_cloud_deployments(environment_id);
`.trim()
}

export function buildInsertProjectSQL(project: CloudProjectRecord): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_cloud_projects
  (id, name, plan, org_id, region, description, status, database_url, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    params: [
      project.id,
      project.name,
      project.plan,
      project.orgId,
      project.region,
      project.description,
      project.status,
      project.databaseUrl,
      project.createdAt,
      project.updatedAt,
    ],
  }
}

export function buildUpdateProjectSQL(
  projectId: string,
  updates: Partial<CloudProjectRecord>,
): { sql: string; params: unknown[] } {
  const setClauses: string[] = []
  const params: unknown[] = []
  let idx = 1

  if (updates.plan !== undefined) { setClauses.push(`plan = $${idx++}`); params.push(updates.plan) }
  if (updates.status !== undefined) { setClauses.push(`status = $${idx++}`); params.push(updates.status) }
  if (updates.databaseUrl !== undefined) { setClauses.push(`database_url = $${idx++}`); params.push(updates.databaseUrl) }
  if (updates.updatedAt !== undefined) { setClauses.push(`updated_at = $${idx++}`); params.push(updates.updatedAt) }

  params.push(projectId)
  return {
    sql: `UPDATE _reactivebase_cloud_projects SET ${setClauses.join(", ")} WHERE id = $${idx}`,
    params,
  }
}

export function buildDeleteProjectSQL(projectId: string): { sql: string; params: unknown[] } {
  return {
    sql: `DELETE FROM _reactivebase_cloud_projects WHERE id = $1`,
    params: [projectId],
  }
}

export function buildInsertEnvironmentSQL(env: EnvironmentRecord): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_cloud_environments
  (id, project_id, name, is_production, status, url, database_url, variables, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    params: [
      env.id,
      env.projectId,
      env.name,
      env.isProduction,
      env.status,
      env.url,
      env.databaseUrl,
      JSON.stringify(env.variables),
      env.createdAt,
    ],
  }
}

export function buildDeleteEnvironmentSQL(envId: string): { sql: string; params: unknown[] } {
  return {
    sql: `DELETE FROM _reactivebase_cloud_environments WHERE id = $1`,
    params: [envId],
  }
}

export function buildInsertDeploymentSQL(deployment: DeploymentRecord): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_cloud_deployments
  (id, project_id, environment_id, source, ref, commit_sha, status, build_logs, started_at, completed_at, url)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
    params: [
      deployment.id,
      deployment.projectId,
      deployment.environmentId,
      deployment.source,
      deployment.ref,
      deployment.commitSha,
      deployment.status,
      JSON.stringify(deployment.buildLogs),
      deployment.startedAt,
      deployment.completedAt,
      deployment.url,
    ],
  }
}

export function buildUpdateDeploymentSQL(
  deploymentId: string,
  updates: Partial<DeploymentRecord>,
): { sql: string; params: unknown[] } {
  const setClauses: string[] = []
  const params: unknown[] = []
  let idx = 1

  if (updates.status !== undefined) { setClauses.push(`status = $${idx++}`); params.push(updates.status) }
  if (updates.completedAt !== undefined) { setClauses.push(`completed_at = $${idx++}`); params.push(updates.completedAt) }
  if (updates.url !== undefined) { setClauses.push(`url = $${idx++}`); params.push(updates.url) }
  if (updates.buildLogs !== undefined) { setClauses.push(`build_logs = $${idx++}::jsonb`); params.push(JSON.stringify(updates.buildLogs)) }

  params.push(deploymentId)
  return {
    sql: `UPDATE _reactivebase_cloud_deployments SET ${setClauses.join(", ")} WHERE id = $${idx}`,
    params,
  }
}

// ─── Cloud Platform ──────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<CloudPlatformOptions, "billingProvider" | "db">> & {
  billingProvider: BillingProvider | null
} = {
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
  private db?: QueryExecutor
  private projects = new Map<string, CloudProjectRecord>()
  private environments = new Map<string, EnvironmentRecord>()
  private deployments = new Map<string, DeploymentRecord>()
  private teamMembers = new Map<string, TeamMember[]>()
  private usage = new Map<string, UsageRecord>()
  private idCounter = 0

  constructor(options: CloudPlatformOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options } as typeof DEFAULT_OPTIONS
    this.db = options.db
  }

  private generateId(prefix: string): string {
    return `${prefix}_${++this.idCounter}_${Date.now().toString(36)}`
  }

  // ─── Projects ────────────────────────────────────────────────────────────

  async createProject(config: CloudProjectConfig): Promise<CloudProjectRecord> {
    const orgId = config.orgId ?? "default_org"

    // Enforce per-org project limit to prevent unbounded resource consumption
    const orgProjects = [...this.projects.values()].filter((p) => p.orgId === orgId)
    if (orgProjects.length >= this.options.maxProjectsPerOrg) {
      throw new CloudPlatformLimitError(`Organization has reached the maximum of ${this.options.maxProjectsPerOrg} projects`)
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

    // Transition to active and provision database URL after creation succeeds.
    // In production, this would be an async provisioning step with status polling.
    project.status = "active"
    project.databaseUrl = `postgresql://rb_${project.id}:****@db.${project.region}.reactivebase.cloud:5432/rb_${project.id}`
    project.updatedAt = new Date().toISOString()

    // Best-effort DB persistence (fire-and-forget)
    if (this.db) {
      const { sql, params } = buildInsertProjectSQL(project)
      this.db(sql, params).catch(() => {})
    }

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
    if (!project) throw new CloudPlatformNotFoundError("Project", projectId)

    project.plan = plan
    project.updatedAt = new Date().toISOString()

    if (this.db) {
      const { sql, params } = buildUpdateProjectSQL(projectId, { plan, updatedAt: project.updatedAt })
      this.db(sql, params).catch(() => {})
    }

    return project
  }

  async deleteProject(projectId: string): Promise<void> {
    const project = this.projects.get(projectId)
    if (!project) throw new CloudPlatformNotFoundError("Project", projectId)

    project.status = "deleting"

    // Cascade delete: remove all child environments and deployments before the project
    for (const [id, env] of this.environments) {
      if (env.projectId === projectId) this.environments.delete(id)
    }
    for (const [id, dep] of this.deployments) {
      if (dep.projectId === projectId) this.deployments.delete(id)
    }

    this.projects.delete(projectId)
    this.teamMembers.delete(projectId)
    this.usage.delete(projectId)

    if (this.db) {
      const { sql, params } = buildDeleteProjectSQL(projectId)
      this.db(sql, params).catch(() => {})
    }
  }

  // ─── Environments ────────────────────────────────────────────────────────

  async createEnvironment(projectId: string, config: EnvironmentConfig): Promise<EnvironmentRecord> {
    const project = this.projects.get(projectId)
    if (!project) throw new CloudPlatformNotFoundError("Project", projectId)

    // Environment count is plan-gated (e.g., free plan allows only 2)
    const projectEnvs = [...this.environments.values()].filter((e) => e.projectId === projectId)
    const limits = this.getPlanLimits(project.plan)
    if (projectEnvs.length >= limits.maxEnvironments) {
      throw new CloudPlatformLimitError(
        `Project has reached the maximum of ${limits.maxEnvironments} environments for ${project.plan} plan`,
      )
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

    // Simulate async provisioning: assign URL and database connection.
    // In production, this would involve infrastructure API calls.
    env.status = "active"
    env.url = `https://${project.name}-${env.name}.reactivebase.cloud`
    env.databaseUrl = `postgresql://rb_${env.id}:****@db.${project.region}.reactivebase.cloud:5432/rb_${env.id}`

    if (this.db) {
      const { sql, params } = buildInsertEnvironmentSQL(env)
      this.db(sql, params).catch(() => {})
    }

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
    if (!env) throw new CloudPlatformNotFoundError("Environment", envId)
    if (env.isProduction) throw new CloudPlatformConflictError("Cannot delete production environment directly")
    this.environments.delete(envId)

    if (this.db) {
      const { sql, params } = buildDeleteEnvironmentSQL(envId)
      this.db(sql, params).catch(() => {})
    }
  }

  // ─── Deployments ─────────────────────────────────────────────────────────

  async deploy(projectId: string, envId: string, config: DeploymentConfig): Promise<DeploymentRecord> {
    const project = this.projects.get(projectId)
    if (!project) throw new CloudPlatformNotFoundError("Project", projectId)

    const env = this.environments.get(envId)
    if (!env) throw new CloudPlatformNotFoundError("Environment", envId)

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

    // Simulate the build/deploy pipeline (build → deploy → activate).
    // In production, each step would be an async operation with real build output.
    deployment.status = "building"
    deployment.buildLogs.push("[1/4] Installing dependencies...")
    deployment.buildLogs.push("[2/4] Building TypeScript...")
    deployment.buildLogs.push("[3/4] Generating types...")
    deployment.status = "deploying"
    deployment.buildLogs.push("[4/4] Deploying to environment...")
    deployment.status = "active"
    deployment.completedAt = new Date().toISOString()
    deployment.url = env.url

    if (this.db) {
      const { sql, params } = buildInsertDeploymentSQL(deployment)
      this.db(sql, params).catch(() => {})
    }

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
    if (!deployment) throw new CloudPlatformNotFoundError("Deployment", deploymentId)
    deployment.status = "rolled-back"

    if (this.db) {
      const { sql, params } = buildUpdateDeploymentSQL(deploymentId, { status: "rolled-back" })
      this.db(sql, params).catch(() => {})
    }

    return deployment
  }

  // ─── Team ────────────────────────────────────────────────────────────────

  addTeamMember(projectId: string, member: Omit<TeamMember, "invitedAt" | "acceptedAt">): TeamMember {
    const members = this.teamMembers.get(projectId)
    if (!members) throw new CloudPlatformNotFoundError("Project", projectId)

    const existing = members.find((m) => m.userId === member.userId)
    if (existing) throw new CloudPlatformConflictError(`User ${member.userId} is already a member`)

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
    if (!members) throw new CloudPlatformNotFoundError("Project", projectId)

    const idx = members.findIndex((m) => m.userId === userId)
    if (idx === -1) throw new CloudPlatformNotFoundError("User", userId)
    if (members[idx].role === "owner") throw new CloudPlatformConflictError("Cannot remove project owner")
    members.splice(idx, 1)
  }

  listTeamMembers(projectId: string): TeamMember[] {
    return this.teamMembers.get(projectId) ?? []
  }

  // ─── Usage & Billing ─────────────────────────────────────────────────────

  recordUsage(projectId: string, usage: Omit<UsageRecord, "projectId" | "period">): UsageRecord {
    const project = this.projects.get(projectId)
    if (!project) throw new CloudPlatformNotFoundError("Project", projectId)

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

    // Function invocations: $0.50 per 100K over plan limit
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

    // Storage: $0.25 per GB over plan limit (converted from MB)
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

    // Bandwidth: $0.10 per GB over plan limit (converted from MB)
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

  // ─── API Key Management ─────────────────────────────────────────────────

  private apiKeys = new Map<string, ApiKeyRecord>()

  /**
   * Provision an API key for a project environment.
   *
   * @param projectId - Project to create the key for
   * @param config - API key configuration
   * @returns The created API key record (key is only returned on creation)
   */
  createApiKey(projectId: string, config: ApiKeyConfig): ApiKeyRecord {
    const project = this.projects.get(projectId)
    if (!project) throw new CloudPlatformNotFoundError("Project", projectId)

    const keyValue = `rb_${config.type}_${randomId()}`
    const record: ApiKeyRecord = {
      id: this.generateId("key"),
      projectId,
      name: config.name,
      type: config.type,
      keyPrefix: keyValue.slice(0, 12) + "...",
      keyHash: hashApiKey(keyValue),
      permissions: config.permissions ?? ["read", "write"],
      environmentId: config.environmentId,
      expiresAt: config.expiresAt ?? null,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    }

    this.apiKeys.set(record.id, record)
    return { ...record, _secretKey: keyValue } as ApiKeyRecord
  }

  /**
   * Validate an API key and return its associated project/permissions.
   *
   * @param key - The raw API key string
   * @returns The key record if valid, null if invalid/expired/revoked
   */
  validateApiKey(key: string): ApiKeyRecord | null {
    const hash = hashApiKey(key)
    const hashBuffer = Buffer.from(hash)
    // Iterate all keys and use timing-safe comparison to prevent timing attacks
    for (const record of this.apiKeys.values()) {
      const recordHashBuffer = Buffer.from(record.keyHash)
      if (hashBuffer.length === recordHashBuffer.length && timingSafeEqual(hashBuffer, recordHashBuffer)) {
        if (record.revokedAt) return null
        if (record.expiresAt && new Date(record.expiresAt) < new Date()) return null
        record.lastUsedAt = new Date().toISOString()
        return record
      }
    }
    return null
  }

  /**
   * Revoke an API key.
   */
  revokeApiKey(keyId: string): void {
    const record = this.apiKeys.get(keyId)
    if (!record) throw new CloudPlatformNotFoundError("API key", keyId)
    record.revokedAt = new Date().toISOString()
  }

  /**
   * List all API keys for a project.
   */
  listApiKeys(projectId: string): ApiKeyRecord[] {
    return [...this.apiKeys.values()].filter((k) => k.projectId === projectId)
  }

  // ─── Stripe Billing Integration ─────────────────────────────────────────

  /**
   * Set up Stripe billing for a project.
   * Creates a Stripe customer and subscription via the BillingProvider.
   *
   * @param projectId - Project to set up billing for
   * @param email - Customer email
   * @param name - Customer name
   * @returns Billing setup result
   */
  async setupBilling(
    projectId: string,
    email: string,
    name: string,
  ): Promise<{ customerId: string; subscriptionId: string }> {
    const project = this.projects.get(projectId)
    if (!project) throw new CloudPlatformNotFoundError("Project", projectId)
    if (!this.options.billingProvider) throw new CloudPlatformError("No billing provider configured")

    const customerId = await this.options.billingProvider.createCustomer(email, name)
    const subscriptionId = await this.options.billingProvider.createSubscription(customerId, project.plan)

    return { customerId, subscriptionId }
  }

  /**
   * Report current usage to billing provider for usage-based billing.
   */
  async reportUsageToBilling(projectId: string, subscriptionId: string): Promise<void> {
    if (!this.options.billingProvider) throw new CloudPlatformError("No billing provider configured")

    const usage = this.getUsage(projectId)
    if (!usage) return

    await this.options.billingProvider.recordUsage(subscriptionId, usage)
  }

  // ─── Auto-Scaling ───────────────────────────────────────────────────────

  private autoScaleConfigs = new Map<string, AutoScaleConfig>()

  /**
   * Configure auto-scaling for a project.
   */
  configureAutoScale(projectId: string, config: AutoScaleConfig): void {
    const project = this.projects.get(projectId)
    if (!project) throw new CloudPlatformNotFoundError("Project", projectId)

    if (config.minInstances < 0) throw new CloudPlatformError("minInstances must be non-negative")
    if (config.maxInstances < config.minInstances) throw new CloudPlatformError("maxInstances must be >= minInstances")

    this.autoScaleConfigs.set(projectId, config)
  }

  /**
   * Get auto-scale configuration for a project.
   */
  getAutoScaleConfig(projectId: string): AutoScaleConfig | undefined {
    return this.autoScaleConfigs.get(projectId)
  }

  /**
   * Evaluate auto-scaling based on current metrics.
   * Returns a scaling recommendation.
   */
  evaluateAutoScale(projectId: string, metrics: ScaleMetrics): AutoScaleDecision {
    const config = this.autoScaleConfigs.get(projectId)
    if (!config) {
      return { action: "none", reason: "auto-scaling not configured", currentInstances: 1, targetInstances: 1 }
    }

    const currentInstances = metrics.currentInstances

    // Scale up when any resource exceeds threshold, or connections approach capacity (80%)
    if (
      metrics.cpuPercent > config.scaleUpThreshold ||
      metrics.memoryPercent > config.scaleUpThreshold ||
      metrics.activeConnections > config.maxConnectionsPerInstance * currentInstances * 0.8
    ) {
      const target = Math.min(currentInstances + 1, config.maxInstances)
      if (target > currentInstances) {
        return { action: "scale-up", reason: "resource threshold exceeded", currentInstances, targetInstances: target }
      }
    }

    // Scale down only when ALL resources are below threshold (conservative)
    if (
      metrics.cpuPercent < config.scaleDownThreshold &&
      metrics.memoryPercent < config.scaleDownThreshold &&
      currentInstances > config.minInstances
    ) {
      const target = Math.max(currentInstances - 1, config.minInstances)
      return { action: "scale-down", reason: "resources underutilized", currentInstances, targetInstances: target }
    }

    return { action: "none", reason: "within thresholds", currentInstances, targetInstances: currentInstances }
  }

  // ─── One-Click Deploy ───────────────────────────────────────────────────

  /**
   * One-click deploy: creates project, environment, and deploys in a single call.
   */
  async oneClickDeploy(config: OneClickDeployConfig): Promise<OneClickDeployResult> {
    const steps: OneClickDeployStep[] = []

    // Step 1: Create project
    steps.push({ step: "create-project", status: "running", startedAt: new Date().toISOString() })
    const project = await this.createProject({
      name: config.projectName,
      plan: config.plan ?? "starter",
      orgId: config.orgId,
      region: config.region,
    })
    steps[0].status = "completed"
    steps[0].completedAt = new Date().toISOString()

    // Step 2: Create production environment
    steps.push({ step: "create-environment", status: "running", startedAt: new Date().toISOString() })
    const env = await this.createEnvironment(project.id, {
      name: "production",
      isProduction: true,
      variables: config.envVariables,
    })
    steps[1].status = "completed"
    steps[1].completedAt = new Date().toISOString()

    // Step 3: Provision API key
    steps.push({ step: "provision-api-key", status: "running", startedAt: new Date().toISOString() })
    const apiKey = this.createApiKey(project.id, {
      name: "Production API Key",
      type: "live",
      environmentId: env.id,
    })
    steps[2].status = "completed"
    steps[2].completedAt = new Date().toISOString()

    // Step 4: Deploy
    steps.push({ step: "deploy", status: "running", startedAt: new Date().toISOString() })
    const deployment = await this.deploy(project.id, env.id, {
      source: config.source ?? "cli",
      ref: config.ref,
    })
    steps[3].status = "completed"
    steps[3].completedAt = new Date().toISOString()

    // Step 5: Auto-scale config
    if (config.autoScale) {
      steps.push({ step: "configure-auto-scale", status: "running", startedAt: new Date().toISOString() })
      this.configureAutoScale(project.id, config.autoScale)
      steps[4].status = "completed"
      steps[4].completedAt = new Date().toISOString()
    }

    return {
      project,
      environment: env,
      deployment,
      apiKey,
      steps,
      url: deployment.url ?? env.url ?? `https://${config.projectName}.reactivebase.cloud`,
    }
  }
}

// ─── Additional Types ────────────────────────────────────────────────────────

export interface ApiKeyConfig {
  name: string
  type: "live" | "test"
  permissions?: string[]
  environmentId?: string
  expiresAt?: string | null
}

export interface ApiKeyRecord {
  id: string
  projectId: string
  name: string
  type: "live" | "test"
  keyPrefix: string
  keyHash: string
  permissions: string[]
  environmentId?: string
  expiresAt: string | null
  lastUsedAt: string | null
  createdAt: string
  revokedAt: string | null
  /** Only present on creation response */
  _secretKey?: string
}

export interface AutoScaleConfig {
  minInstances: number
  maxInstances: number
  scaleUpThreshold: number
  scaleDownThreshold: number
  maxConnectionsPerInstance: number
  cooldownSeconds?: number
}

export interface ScaleMetrics {
  currentInstances: number
  cpuPercent: number
  memoryPercent: number
  activeConnections: number
  requestsPerSecond: number
}

export interface AutoScaleDecision {
  action: "scale-up" | "scale-down" | "none"
  reason: string
  currentInstances: number
  targetInstances: number
}

export interface OneClickDeployConfig {
  projectName: string
  plan?: ProjectPlan
  orgId?: string
  region?: string
  source?: "git" | "upload" | "cli"
  ref?: string
  envVariables?: Record<string, string>
  autoScale?: AutoScaleConfig
}

export interface OneClickDeployStep {
  step: string
  status: "running" | "completed" | "failed"
  startedAt: string
  completedAt?: string
  error?: string
}

export interface OneClickDeployResult {
  project: CloudProjectRecord
  environment: EnvironmentRecord
  deployment: DeploymentRecord
  apiKey: ApiKeyRecord
  steps: OneClickDeployStep[]
  url: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomId(): string {
  return randomBytes(18).toString("base64url")
}

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex")
}
