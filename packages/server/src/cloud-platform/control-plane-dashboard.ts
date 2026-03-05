/**
 * Control plane dashboard API for managing ReactiveBase Cloud projects.
 * Provides project CRUD, environment management, deployment logs,
 * billing information, and HTML dashboard generation.
 */

import type { ProjectPlan } from "./cloud-platform.js"
import { createIdGenerator } from "./id-generator.js"
import type { KubernetesOperator } from "./k8s-operator.js"
import type { TenantConfig, DeploymentLogEntry, BillingInfo, UsageMetrics, BillingBreakdownItem } from "./k8s-types.js"
import { PLAN_BILLING_CENTS } from "./k8s-types.js"

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

export class ControlPlaneDashboard {
  private operator: KubernetesOperator
  private projects = new Map<string, ControlPlaneProject>()
  private deploymentLogs = new Map<string, DeploymentLogEntry[]>()
  private generateId = createIdGenerator()

  constructor(operator: KubernetesOperator) {
    this.operator = operator
  }

  // ─── Projects ─────────────────────────────────────────────────────────

  async createProject(name: string, plan: ProjectPlan, region: string): Promise<ControlPlaneProject> {
    const projectId = this.generateId("proj")
    const tenantId = `tenant_${projectId}`

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
