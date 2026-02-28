/**
 * Kubernetes Operator & Managed Cloud Enhancements for ReactiveBase Cloud.
 * Provides multi-tenant K8s orchestration, a control plane dashboard API,
 * and GitHub-based auto-deploy integration.
 *
 * Features:
 *   - Multi-tenant Kubernetes operator with isolated Postgres per tenant
 *   - Control plane dashboard for project management and billing
 *   - GitHub webhook integration for push-to-deploy workflows
 *   - SQL builders for tenant management tables
 *
 * Usage:
 *   const operator = new KubernetesOperator()
 *   await operator.provisionTenant("tenant_1", { plan: "pro", region: "us-east-1" })
 *   const status = operator.getClusterStatus()
 *
 *   const dashboard = new ControlPlaneDashboard(operator)
 *   const project = await dashboard.createProject("my-app", "starter", "us-east-1")
 *
 *   const github = new GitHubIntegration(dashboard)
 *   await github.connectRepository(project.id, "https://github.com/org/repo", "main")
 */

import type { ProjectPlan } from "./cloud-platform.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReactiveBaseCluster {
  id: string
  name: string
  region: string
  kubernetesVersion: string
  nodeCount: number
  status: "provisioning" | "running" | "degraded" | "offline"
  tenants: string[]
  createdAt: string
  updatedAt: string
}

export interface TenantConfig {
  plan: ProjectPlan
  region: string
  postgresVersion?: string
  storageSizeGb?: number
  maxConnections?: number
  replicas?: number
  labels?: Record<string, string>
}

export interface TenantStatus {
  tenantId: string
  clusterId: string
  namespace: string
  status: "provisioning" | "running" | "scaling" | "deleting" | "error"
  replicas: number
  desiredReplicas: number
  postgresUrl: string
  storageSizeGb: number
  cpuUsagePercent: number
  memoryUsagePercent: number
  createdAt: string
  updatedAt: string
}

export interface ClusterHealth {
  clusterId: string
  status: "healthy" | "degraded" | "unhealthy"
  nodeCount: number
  readyNodes: number
  totalTenants: number
  activeTenants: number
  cpuAllocatedPercent: number
  memoryAllocatedPercent: number
  kubernetesVersion: string
  checkedAt: string
}

export interface ProjectCreateRequest {
  name: string
  plan: ProjectPlan
  region: string
  userId: string
  description?: string
}

export interface DeploymentLogEntry {
  id: string
  deploymentId: string
  timestamp: number
  level: "info" | "warn" | "error" | "debug"
  source: "build" | "runtime" | "system" | "kubernetes"
  message: string
  metadata?: Record<string, unknown>
}

export interface BillingInfo {
  projectId: string
  plan: ProjectPlan
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  currentPeriodStart: string
  currentPeriodEnd: string
  usage: UsageMetrics
  totalCostCents: number
  breakdown: BillingBreakdownItem[]
}

export interface UsageMetrics {
  functionInvocations: number
  databaseStorageMb: number
  bandwidthMb: number
  activeConnections: number
  computeHours: number
  tenantReplicas: number
}

export interface BillingBreakdownItem {
  category: string
  quantity: number
  unitLabel: string
  unitCostCents: number
  totalCents: number
}

export interface GitHubWebhookPayload {
  action: string
  ref: string
  after: string
  repository: {
    full_name: string
    clone_url: string
    default_branch: string
  }
  sender: {
    login: string
  }
  commits?: Array<{
    id: string
    message: string
    author: { name: string; email: string }
  }>
}

export interface GitHubConnection {
  id: string
  projectId: string
  repoUrl: string
  branch: string
  webhookSecret: string
  status: "connected" | "disconnected" | "error"
  lastDeployedSha: string | null
  lastDeployedAt: string | null
  createdAt: string
}

// ─── Plan Defaults ───────────────────────────────────────────────────────────

const PLAN_TENANT_DEFAULTS: Record<ProjectPlan, { storage: number; connections: number; replicas: number }> = {
  free: { storage: 1, connections: 10, replicas: 1 },
  starter: { storage: 10, connections: 50, replicas: 1 },
  pro: { storage: 50, connections: 200, replicas: 2 },
  enterprise: { storage: 500, connections: 1000, replicas: 3 },
}

const PLAN_BILLING_CENTS: Record<ProjectPlan, number> = {
  free: 0,
  starter: 2500,
  pro: 9900,
  enterprise: 49900,
}

// ─── SQL Builders ────────────────────────────────────────────────────────────

export function generateTenantTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_tenants (
  tenant_id TEXT PRIMARY KEY,
  cluster_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  plan TEXT NOT NULL,
  region TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'provisioning',
  replicas INTEGER NOT NULL DEFAULT 1,
  desired_replicas INTEGER NOT NULL DEFAULT 1,
  postgres_url TEXT,
  storage_size_gb INTEGER NOT NULL DEFAULT 1,
  cpu_usage_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  memory_usage_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenants_cluster ON _reactivebase_tenants (cluster_id);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON _reactivebase_tenants (status);`
}

export function generateGitHubConnectionTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_github_connections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  webhook_secret TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected',
  last_deployed_sha TEXT,
  last_deployed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_github_connections_project ON _reactivebase_github_connections (project_id);`
}

export function buildInsertTenantSQL(
  tenantId: string,
  clusterId: string,
  namespace: string,
  plan: ProjectPlan,
  region: string,
): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_tenants (tenant_id, cluster_id, namespace, plan, region) VALUES ($1, $2, $3, $4, $5)`,
    params: [tenantId, clusterId, namespace, plan, region],
  }
}

export function buildQueryTenantsSQL(clusterId: string): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT tenant_id, cluster_id, namespace, plan, region, status, replicas, desired_replicas,
            postgres_url, storage_size_gb, cpu_usage_percent, memory_usage_percent, created_at, updated_at
          FROM _reactivebase_tenants
          WHERE cluster_id = $1
          ORDER BY created_at DESC`,
    params: [clusterId],
  }
}

// ─── Kubernetes Operator ─────────────────────────────────────────────────────

/**
 * Multi-tenant Kubernetes operator for ReactiveBase Cloud.
 * Manages tenant lifecycle including provisioning, scaling, and teardown
 * with isolated Postgres instances per tenant.
 */
export class KubernetesOperator {
  private cluster: ReactiveBaseCluster
  private tenants = new Map<string, TenantStatus>()
  private idCounter = 0

  constructor(clusterConfig?: Partial<ReactiveBaseCluster>) {
    this.cluster = {
      id: clusterConfig?.id ?? `cluster_${Date.now().toString(36)}`,
      name: clusterConfig?.name ?? "reactivebase-primary",
      region: clusterConfig?.region ?? "us-east-1",
      kubernetesVersion: clusterConfig?.kubernetesVersion ?? "1.29",
      nodeCount: clusterConfig?.nodeCount ?? 3,
      status: "running",
      tenants: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  private generateId(prefix: string): string {
    return `${prefix}_${++this.idCounter}_${Date.now().toString(36)}`
  }

  // ─── Reconciliation ───────────────────────────────────────────────────

  async reconcile(cluster: ReactiveBaseCluster): Promise<ReactiveBaseCluster> {
    // Reconcile desired state with actual state
    for (const tenantId of cluster.tenants) {
      const tenant = this.tenants.get(tenantId)
      if (!tenant) continue

      // Scale to desired replicas if mismatched
      if (tenant.replicas !== tenant.desiredReplicas) {
        tenant.replicas = tenant.desiredReplicas
        tenant.status = "running"
        tenant.updatedAt = new Date().toISOString()
      }
    }

    // Update cluster status based on tenant health
    const allTenants = [...this.tenants.values()]
    const errorTenants = allTenants.filter((t) => t.status === "error")
    if (errorTenants.length > allTenants.length * 0.5) {
      cluster.status = "degraded"
    } else {
      cluster.status = "running"
    }

    cluster.tenants = [...this.tenants.keys()]
    cluster.updatedAt = new Date().toISOString()
    this.cluster = cluster

    return cluster
  }

  // ─── Tenant Management ────────────────────────────────────────────────

  async provisionTenant(tenantId: string, config: TenantConfig): Promise<TenantStatus> {
    if (this.tenants.has(tenantId)) {
      throw new Error(`Tenant ${tenantId} already exists`)
    }

    const defaults = PLAN_TENANT_DEFAULTS[config.plan]
    const namespace = `rb-tenant-${tenantId}`
    const storageSizeGb = config.storageSizeGb ?? defaults.storage
    const replicas = config.replicas ?? defaults.replicas

    const tenant: TenantStatus = {
      tenantId,
      clusterId: this.cluster.id,
      namespace,
      status: "provisioning",
      replicas: 0,
      desiredReplicas: replicas,
      postgresUrl: `postgresql://rb_${tenantId}:****@pg-${namespace}.${config.region}.reactivebase.cloud:5432/rb_${tenantId}`,
      storageSizeGb,
      cpuUsagePercent: 0,
      memoryUsagePercent: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    this.tenants.set(tenantId, tenant)
    this.cluster.tenants.push(tenantId)
    this.cluster.updatedAt = new Date().toISOString()

    // Simulate provisioning completion
    tenant.status = "running"
    tenant.replicas = replicas
    tenant.updatedAt = new Date().toISOString()

    return tenant
  }

  async scaleTenant(tenantId: string, replicas: number): Promise<TenantStatus> {
    const tenant = this.tenants.get(tenantId)
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`)

    if (replicas < 0) throw new Error("Replicas must be non-negative")

    tenant.status = "scaling"
    tenant.desiredReplicas = replicas
    tenant.updatedAt = new Date().toISOString()

    // Simulate scaling completion
    tenant.replicas = replicas
    tenant.status = "running"
    tenant.updatedAt = new Date().toISOString()

    return tenant
  }

  async deleteTenant(tenantId: string): Promise<void> {
    const tenant = this.tenants.get(tenantId)
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`)

    tenant.status = "deleting"
    tenant.updatedAt = new Date().toISOString()

    // Clean up tenant resources
    this.tenants.delete(tenantId)
    this.cluster.tenants = this.cluster.tenants.filter((id) => id !== tenantId)
    this.cluster.updatedAt = new Date().toISOString()
  }

  // ─── Cluster Status ───────────────────────────────────────────────────

  getClusterStatus(): ClusterHealth {
    const allTenants = [...this.tenants.values()]
    const activeTenants = allTenants.filter((t) => t.status === "running")
    const totalCpu = allTenants.reduce((sum, t) => sum + t.cpuUsagePercent, 0)
    const totalMemory = allTenants.reduce((sum, t) => sum + t.memoryUsagePercent, 0)
    const tenantCount = Math.max(allTenants.length, 1)

    const avgCpu = totalCpu / tenantCount
    const avgMemory = totalMemory / tenantCount

    let status: ClusterHealth["status"] = "healthy"
    if (avgCpu > 90 || avgMemory > 90) {
      status = "unhealthy"
    } else if (avgCpu > 75 || avgMemory > 75) {
      status = "degraded"
    }

    return {
      clusterId: this.cluster.id,
      status,
      nodeCount: this.cluster.nodeCount,
      readyNodes: this.cluster.status === "running" ? this.cluster.nodeCount : 0,
      totalTenants: allTenants.length,
      activeTenants: activeTenants.length,
      cpuAllocatedPercent: avgCpu,
      memoryAllocatedPercent: avgMemory,
      kubernetesVersion: this.cluster.kubernetesVersion,
      checkedAt: new Date().toISOString(),
    }
  }

  listTenants(): TenantStatus[] {
    return [...this.tenants.values()]
  }

  getTenant(tenantId: string): TenantStatus | undefined {
    return this.tenants.get(tenantId)
  }
}

// ─── Control Plane Dashboard ─────────────────────────────────────────────────

interface ControlPlaneProject {
  id: string
  name: string
  plan: ProjectPlan
  region: string
  userId: string
  description: string
  status: "creating" | "active" | "suspended" | "deleting"
  tenantId: string | null
  environments: ControlPlaneEnvironment[]
  createdAt: string
  updatedAt: string
}

interface ControlPlaneEnvironment {
  id: string
  name: string
  status: "provisioning" | "active" | "sleeping" | "error"
  url: string | null
  isProduction: boolean
  createdAt: string
}

/**
 * Control plane dashboard API for managing ReactiveBase Cloud projects.
 * Provides project CRUD, environment management, deployment logs,
 * billing information, and HTML dashboard generation.
 */
export class ControlPlaneDashboard {
  private operator: KubernetesOperator
  private projects = new Map<string, ControlPlaneProject>()
  private deploymentLogs = new Map<string, DeploymentLogEntry[]>()
  private idCounter = 0

  constructor(operator: KubernetesOperator) {
    this.operator = operator
  }

  private generateId(prefix: string): string {
    return `${prefix}_${++this.idCounter}_${Date.now().toString(36)}`
  }

  // ─── Projects ─────────────────────────────────────────────────────────

  async createProject(name: string, plan: ProjectPlan, region: string): Promise<ControlPlaneProject> {
    const projectId = this.generateId("proj")
    const tenantId = `tenant_${projectId}`

    // Provision tenant in K8s cluster
    const tenantConfig: TenantConfig = { plan, region }
    await this.operator.provisionTenant(tenantId, tenantConfig)

    const project: ControlPlaneProject = {
      id: projectId,
      name,
      plan,
      region,
      userId: "",
      description: "",
      status: "creating",
      tenantId,
      environments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    this.projects.set(projectId, project)

    // Simulate activation
    project.status = "active"
    project.updatedAt = new Date().toISOString()

    return project
  }

  listProjects(userId: string): ControlPlaneProject[] {
    return [...this.projects.values()].filter((p) => p.userId === userId || userId === "*")
  }

  getProjectDetails(projectId: string): ControlPlaneProject | undefined {
    return this.projects.get(projectId)
  }

  // ─── Environments ─────────────────────────────────────────────────────

  manageEnvironments(projectId: string): {
    create: (name: string, isProduction?: boolean) => ControlPlaneEnvironment
    list: () => ControlPlaneEnvironment[]
    delete: (envId: string) => void
  } {
    const project = this.projects.get(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)

    return {
      create: (name: string, isProduction = false): ControlPlaneEnvironment => {
        const env: ControlPlaneEnvironment = {
          id: this.generateId("env"),
          name,
          status: "provisioning",
          url: null,
          isProduction,
          createdAt: new Date().toISOString(),
        }

        // Simulate provisioning
        env.status = "active"
        env.url = `https://${project.name}-${name}.reactivebase.cloud`
        project.environments.push(env)
        project.updatedAt = new Date().toISOString()

        return env
      },
      list: (): ControlPlaneEnvironment[] => {
        return project.environments
      },
      delete: (envId: string): void => {
        const idx = project.environments.findIndex((e) => e.id === envId)
        if (idx === -1) throw new Error(`Environment ${envId} not found`)
        if (project.environments[idx].isProduction) throw new Error("Cannot delete production environment")
        project.environments.splice(idx, 1)
        project.updatedAt = new Date().toISOString()
      },
    }
  }

  // ─── Deployment Logs ──────────────────────────────────────────────────

  getDeploymentLogs(
    deploymentId: string,
    options?: { since?: number; level?: DeploymentLogEntry["level"]; limit?: number },
  ): DeploymentLogEntry[] {
    const entries = this.deploymentLogs.get(deploymentId) ?? []
    let filtered = entries

    if (options?.since) {
      filtered = filtered.filter((e) => e.timestamp >= options.since!)
    }
    if (options?.level) {
      filtered = filtered.filter((e) => e.level === options.level)
    }
    if (options?.limit) {
      filtered = filtered.slice(-options.limit)
    }

    return filtered
  }

  appendDeploymentLog(
    deploymentId: string,
    entry: Omit<DeploymentLogEntry, "id" | "deploymentId" | "timestamp">,
  ): void {
    if (!this.deploymentLogs.has(deploymentId)) {
      this.deploymentLogs.set(deploymentId, [])
    }
    this.deploymentLogs.get(deploymentId)!.push({
      ...entry,
      id: this.generateId("log"),
      deploymentId,
      timestamp: Date.now(),
    })
  }

  // ─── Billing ──────────────────────────────────────────────────────────

  getBillingInfo(projectId: string): BillingInfo {
    const project = this.projects.get(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)

    const baseCost = PLAN_BILLING_CENTS[project.plan]
    const tenant = project.tenantId ? this.operator.getTenant(project.tenantId) : undefined

    const usage: UsageMetrics = {
      functionInvocations: 0,
      databaseStorageMb: (tenant?.storageSizeGb ?? 0) * 1024,
      bandwidthMb: 0,
      activeConnections: 0,
      computeHours: 0,
      tenantReplicas: tenant?.replicas ?? 0,
    }

    const breakdown: BillingBreakdownItem[] = [
      {
        category: "Base Plan",
        quantity: 1,
        unitLabel: "month",
        unitCostCents: baseCost,
        totalCents: baseCost,
      },
      {
        category: "Database Storage",
        quantity: usage.databaseStorageMb,
        unitLabel: "MB",
        unitCostCents: 0,
        totalCents: 0,
      },
      {
        category: "Compute Replicas",
        quantity: usage.tenantReplicas,
        unitLabel: "replica",
        unitCostCents: 1000,
        totalCents: usage.tenantReplicas * 1000,
      },
    ]

    const totalCostCents = breakdown.reduce((sum, b) => sum + b.totalCents, 0)

    const now = new Date()
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString()

    return {
      projectId,
      plan: project.plan,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      usage,
      totalCostCents,
      breakdown,
    }
  }

  // ─── Dashboard HTML ───────────────────────────────────────────────────

  generateDashboardHTML(projects: ControlPlaneProject[]): string {
    const clusterHealth = this.operator.getClusterStatus()

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ReactiveBase Cloud - Control Plane</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; }
    .header { background: linear-gradient(135deg, #1e293b, #334155); padding: 24px 32px; border-bottom: 1px solid #475569; }
    .header h1 { font-size: 24px; font-weight: 600; }
    .header .subtitle { color: #94a3b8; margin-top: 4px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; padding: 24px 32px; }
    .card { background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155; }
    .card h3 { font-size: 14px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
    .metric { font-size: 36px; font-weight: 700; }
    .metric.good { color: #34d399; }
    .metric.warn { color: #fbbf24; }
    .metric.bad { color: #f87171; }
    .metric-label { color: #64748b; font-size: 12px; margin-top: 4px; }
    .section { padding: 0 32px 24px; }
    .section h2 { font-size: 18px; margin-bottom: 16px; }
    .project-row { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 16px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
    .project-name { font-weight: 600; font-size: 15px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-left: 8px; }
    .badge-active { background: rgba(52,211,153,0.15); color: #34d399; }
    .badge-plan { background: rgba(88,166,255,0.15); color: #58a6ff; }
    .project-meta { font-size: 12px; color: #94a3b8; display: flex; gap: 16px; margin-top: 6px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>⚡ ReactiveBase Cloud — Control Plane</h1>
    <div class="subtitle">Cluster: ${clusterHealth.clusterId} | K8s ${clusterHealth.kubernetesVersion} | ${new Date().toISOString()}</div>
  </div>

  <div class="grid">
    <div class="card">
      <h3>Cluster Status</h3>
      <div class="metric ${clusterHealth.status === "healthy" ? "good" : clusterHealth.status === "degraded" ? "warn" : "bad"}">${clusterHealth.status}</div>
      <div class="metric-label">${clusterHealth.readyNodes}/${clusterHealth.nodeCount} nodes ready</div>
    </div>
    <div class="card">
      <h3>Total Projects</h3>
      <div class="metric good">${projects.length}</div>
      <div class="metric-label">Across all regions</div>
    </div>
    <div class="card">
      <h3>Active Tenants</h3>
      <div class="metric good">${clusterHealth.activeTenants}</div>
      <div class="metric-label">${clusterHealth.totalTenants} total</div>
    </div>
    <div class="card">
      <h3>CPU Allocated</h3>
      <div class="metric ${clusterHealth.cpuAllocatedPercent > 80 ? "bad" : clusterHealth.cpuAllocatedPercent > 60 ? "warn" : "good"}">${clusterHealth.cpuAllocatedPercent.toFixed(1)}%</div>
      <div class="metric-label">Cluster average</div>
    </div>
    <div class="card">
      <h3>Memory Allocated</h3>
      <div class="metric ${clusterHealth.memoryAllocatedPercent > 80 ? "bad" : clusterHealth.memoryAllocatedPercent > 60 ? "warn" : "good"}">${clusterHealth.memoryAllocatedPercent.toFixed(1)}%</div>
      <div class="metric-label">Cluster average</div>
    </div>
  </div>

  <div class="section">
    <h2>Projects</h2>
    ${projects
      .map(
        (p) => `
      <div class="project-row">
        <div>
          <span class="project-name">${p.name}</span>
          <span class="badge badge-active">${p.status}</span>
          <span class="badge badge-plan">${p.plan}</span>
          <div class="project-meta">
            <span>🌍 ${p.region}</span>
            <span>📦 ${p.environments.length} environments</span>
            <span>🕐 Created ${p.createdAt}</span>
          </div>
        </div>
      </div>`,
      )
      .join("")}
    ${projects.length === 0 ? "<p style='color:#64748b'>No projects yet</p>" : ""}
  </div>
</body>
</html>`
  }
}

// ─── GitHub Integration ──────────────────────────────────────────────────────

/**
 * GitHub auto-deploy integration for ReactiveBase Cloud.
 * Connects GitHub repositories to projects for push-to-deploy workflows
 * via webhook events.
 */
export class GitHubIntegration {
  private dashboard: ControlPlaneDashboard
  private connections = new Map<string, GitHubConnection>()
  private deployments = new Map<
    string,
    { projectId: string; commitSha: string; status: string; startedAt: string; completedAt: string | null }
  >()
  private idCounter = 0

  constructor(dashboard: ControlPlaneDashboard) {
    this.dashboard = dashboard
  }

  private generateId(prefix: string): string {
    return `${prefix}_${++this.idCounter}_${Date.now().toString(36)}`
  }

  // ─── Repository Connection ────────────────────────────────────────────

  async connectRepository(projectId: string, repoUrl: string, branch: string): Promise<GitHubConnection> {
    const project = this.dashboard.getProjectDetails(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)

    // Check for existing connection
    for (const conn of this.connections.values()) {
      if (conn.projectId === projectId && conn.status === "connected") {
        throw new Error(`Project ${projectId} already has a connected repository`)
      }
    }

    const connection: GitHubConnection = {
      id: this.generateId("ghconn"),
      projectId,
      repoUrl,
      branch,
      webhookSecret: `whsec_${this.generateId("secret")}`,
      status: "connected",
      lastDeployedSha: null,
      lastDeployedAt: null,
      createdAt: new Date().toISOString(),
    }

    this.connections.set(connection.id, connection)
    return connection
  }

  async disconnectRepository(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId)
    if (!connection) throw new Error(`Connection ${connectionId} not found`)
    connection.status = "disconnected"
  }

  // ─── Webhook Handling ─────────────────────────────────────────────────

  async handleWebhook(payload: GitHubWebhookPayload): Promise<{ deployed: boolean; deploymentId?: string }> {
    // Find matching connection by repo URL
    let matchedConnection: GitHubConnection | undefined
    for (const conn of this.connections.values()) {
      if (conn.status === "connected" && conn.repoUrl === payload.repository.clone_url) {
        // Check branch match
        const pushBranch = payload.ref.replace("refs/heads/", "")
        if (pushBranch === conn.branch) {
          matchedConnection = conn
          break
        }
      }
    }

    if (!matchedConnection) {
      return { deployed: false }
    }

    const commitSha = payload.after
    const deploymentId = await this.triggerDeploy(matchedConnection.projectId, commitSha)

    matchedConnection.lastDeployedSha = commitSha
    matchedConnection.lastDeployedAt = new Date().toISOString()

    return { deployed: true, deploymentId }
  }

  // ─── Deployments ──────────────────────────────────────────────────────

  async triggerDeploy(projectId: string, commitSha: string): Promise<string> {
    const project = this.dashboard.getProjectDetails(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)

    const deploymentId = this.generateId("deploy")

    this.deployments.set(deploymentId, {
      projectId,
      commitSha,
      status: "queued",
      startedAt: new Date().toISOString(),
      completedAt: null,
    })

    // Simulate deployment lifecycle via logs
    this.dashboard.appendDeploymentLog(deploymentId, {
      level: "info",
      source: "system",
      message: `Deployment triggered for commit ${commitSha.slice(0, 7)}`,
    })
    this.dashboard.appendDeploymentLog(deploymentId, {
      level: "info",
      source: "build",
      message: "[1/4] Installing dependencies...",
    })
    this.dashboard.appendDeploymentLog(deploymentId, {
      level: "info",
      source: "build",
      message: "[2/4] Building TypeScript...",
    })
    this.dashboard.appendDeploymentLog(deploymentId, {
      level: "info",
      source: "build",
      message: "[3/4] Generating types...",
    })
    this.dashboard.appendDeploymentLog(deploymentId, {
      level: "info",
      source: "kubernetes",
      message: "[4/4] Rolling out to Kubernetes...",
    })

    const deployment = this.deployments.get(deploymentId)!
    deployment.status = "active"
    deployment.completedAt = new Date().toISOString()

    this.dashboard.appendDeploymentLog(deploymentId, {
      level: "info",
      source: "system",
      message: "Deployment completed successfully",
    })

    return deploymentId
  }

  getDeploymentStatus(
    deploymentId: string,
  ): { deploymentId: string; status: string; startedAt: string; completedAt: string | null } | undefined {
    const deployment = this.deployments.get(deploymentId)
    if (!deployment) return undefined
    return {
      deploymentId,
      status: deployment.status,
      startedAt: deployment.startedAt,
      completedAt: deployment.completedAt,
    }
  }

  getConnection(connectionId: string): GitHubConnection | undefined {
    return this.connections.get(connectionId)
  }

  listConnections(projectId: string): GitHubConnection[] {
    return [...this.connections.values()].filter((c) => c.projectId === projectId)
  }
}
