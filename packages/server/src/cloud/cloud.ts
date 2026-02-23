/**
 * ReactiveBase Cloud client.
 * Handles project creation, deployment, and management for the managed cloud offering.
 *
 * Features:
 *   - Project provisioning with multi-region support
 *   - Environment management (production, staging, preview)
 *   - Team & API key management
 *   - Deployment pipeline with rollback
 *   - Usage metering and billing
 *   - Log streaming and metrics
 */

export interface CloudConfig {
  /** API key for ReactiveBase Cloud */
  apiKey: string
  /** Cloud API endpoint (default: https://api.reactivebase.dev) */
  apiUrl?: string
  /** Request timeout in ms (default: 30000) */
  timeout?: number
}

export interface CloudProject {
  id: string
  name: string
  region: string
  status: "creating" | "active" | "suspended" | "deleted"
  url: string
  databaseUrl: string
  createdAt: string
}

export interface CloudEnvironment {
  id: string
  projectId: string
  name: string
  type: "production" | "staging" | "preview"
  url: string
  databaseUrl: string
  status: "active" | "suspended"
  branch?: string
  createdAt: string
}

export interface CloudDeployment {
  id: string
  projectId: string
  environmentId: string
  status: "queued" | "building" | "deploying" | "active" | "failed" | "rolled-back"
  version: number
  commitSha?: string
  commitMessage?: string
  buildLogs: string[]
  startedAt: string
  completedAt?: string
  error?: string
}

export interface CloudTeamMember {
  id: string
  email: string
  role: "owner" | "admin" | "developer" | "viewer"
  joinedAt: string
}

export interface CloudApiKey {
  id: string
  name: string
  prefix: string
  permissions: ("read" | "write" | "deploy" | "admin")[]
  createdAt: string
  lastUsedAt?: string
}

export interface CloudUsage {
  period: { start: string; end: string }
  queries: number
  mutations: number
  activeSubscriptions: number
  peakConnections: number
  storageBytes: number
  bandwidthBytes: number
  computeMinutes: number
  estimatedCost: number
}

export interface CloudLogEntry {
  timestamp: string
  level: "debug" | "info" | "warn" | "error"
  message: string
  functionName?: string
  requestId?: string
  durationMs?: number
}

export interface CloudPlan {
  name: string
  price: number
  limits: {
    projects: number
    subscriptions: number
    storage: string
    bandwidth: string
  }
}

export interface ProvisioningOptions {
  name: string
  region?: string
  plan?: string
  /** Auto-create staging environment (default: true) */
  createStaging?: boolean
  /** Git repository URL for auto-deploy */
  gitRepo?: string
  /** Custom domain */
  customDomain?: string
}

export interface DeploymentBundle {
  schema: string
  functions: Record<string, string>
  migrations?: string[]
  commitSha?: string
  commitMessage?: string
}

export const PLANS: Record<string, CloudPlan> = {
  free: {
    name: "Free",
    price: 0,
    limits: {
      projects: 1,
      subscriptions: 1_000,
      storage: "1 GB",
      bandwidth: "5 GB",
    },
  },
  pro: {
    name: "Pro",
    price: 29,
    limits: {
      projects: 5,
      subscriptions: 50_000,
      storage: "10 GB",
      bandwidth: "100 GB",
    },
  },
  team: {
    name: "Team",
    price: 99,
    limits: {
      projects: 20,
      subscriptions: 500_000,
      storage: "100 GB",
      bandwidth: "1 TB",
    },
  },
  enterprise: {
    name: "Enterprise",
    price: -1, // Custom
    limits: {
      projects: -1,
      subscriptions: -1,
      storage: "Custom",
      bandwidth: "Custom",
    },
  },
}

export const REGIONS = [
  { id: "us-east-1", name: "US East (Virginia)", provider: "aws" },
  { id: "us-west-2", name: "US West (Oregon)", provider: "aws" },
  { id: "eu-west-1", name: "EU West (Ireland)", provider: "aws" },
  { id: "eu-central-1", name: "EU Central (Frankfurt)", provider: "aws" },
  { id: "ap-southeast-1", name: "Asia Pacific (Singapore)", provider: "aws" },
  { id: "ap-northeast-1", name: "Asia Pacific (Tokyo)", provider: "aws" },
] as const

export type RegionId = (typeof REGIONS)[number]["id"]

/**
 * ReactiveBase Cloud API client.
 */
export class CloudClient {
  private apiUrl: string
  private apiKey: string
  private timeout: number

  constructor(config: CloudConfig) {
    this.apiUrl = (config.apiUrl ?? "https://api.reactivebase.dev").replace(/\/$/, "")
    this.apiKey = config.apiKey
    this.timeout = config.timeout ?? 30_000
  }

  // ─── Project Management ──────────────────────────────────────────────────

  async createProject(options: { name: string; region?: string; plan?: string }): Promise<CloudProject> {
    return this.request<CloudProject>("POST", "/projects", {
      name: options.name,
      region: options.region ?? "us-east-1",
      plan: options.plan ?? "free",
    })
  }

  async getProject(projectId: string): Promise<CloudProject> {
    return this.request<CloudProject>("GET", `/projects/${projectId}`)
  }

  async listProjects(): Promise<CloudProject[]> {
    return this.request<CloudProject[]>("GET", "/projects")
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.request("DELETE", `/projects/${projectId}`)
  }

  // ─── Provisioning Pipeline ───────────────────────────────────────────────

  async provision(options: ProvisioningOptions): Promise<{
    project: CloudProject
    environments: CloudEnvironment[]
  }> {
    return this.request("POST", "/provision", {
      name: options.name,
      region: options.region ?? "us-east-1",
      plan: options.plan ?? "free",
      createStaging: options.createStaging ?? true,
      gitRepo: options.gitRepo,
      customDomain: options.customDomain,
    })
  }

  // ─── Environment Management ──────────────────────────────────────────────

  async listEnvironments(projectId: string): Promise<CloudEnvironment[]> {
    return this.request<CloudEnvironment[]>("GET", `/projects/${projectId}/environments`)
  }

  async createEnvironment(
    projectId: string,
    options: { name: string; type: CloudEnvironment["type"]; branch?: string },
  ): Promise<CloudEnvironment> {
    return this.request<CloudEnvironment>("POST", `/projects/${projectId}/environments`, options)
  }

  async deleteEnvironment(projectId: string, envId: string): Promise<void> {
    await this.request("DELETE", `/projects/${projectId}/environments/${envId}`)
  }

  // ─── Deployments ─────────────────────────────────────────────────────────

  async deploy(projectId: string, bundle: DeploymentBundle): Promise<CloudDeployment> {
    return this.request<CloudDeployment>("POST", `/projects/${projectId}/deploy`, bundle)
  }

  async deployToEnvironment(projectId: string, envId: string, bundle: DeploymentBundle): Promise<CloudDeployment> {
    return this.request<CloudDeployment>("POST", `/projects/${projectId}/environments/${envId}/deploy`, bundle)
  }

  async getDeployment(projectId: string, deploymentId: string): Promise<CloudDeployment> {
    return this.request<CloudDeployment>("GET", `/projects/${projectId}/deployments/${deploymentId}`)
  }

  async listDeployments(projectId: string, limit: number = 20): Promise<CloudDeployment[]> {
    return this.request<CloudDeployment[]>("GET", `/projects/${projectId}/deployments?limit=${limit}`)
  }

  async rollback(projectId: string, deploymentId: string): Promise<CloudDeployment> {
    return this.request<CloudDeployment>("POST", `/projects/${projectId}/deployments/${deploymentId}/rollback`)
  }

  // ─── Team Management ─────────────────────────────────────────────────────

  async listTeamMembers(projectId: string): Promise<CloudTeamMember[]> {
    return this.request<CloudTeamMember[]>("GET", `/projects/${projectId}/team`)
  }

  async inviteTeamMember(
    projectId: string,
    options: { email: string; role: CloudTeamMember["role"] },
  ): Promise<CloudTeamMember> {
    return this.request<CloudTeamMember>("POST", `/projects/${projectId}/team`, options)
  }

  async removeTeamMember(projectId: string, memberId: string): Promise<void> {
    await this.request("DELETE", `/projects/${projectId}/team/${memberId}`)
  }

  // ─── API Keys ────────────────────────────────────────────────────────────

  async listApiKeys(projectId: string): Promise<CloudApiKey[]> {
    return this.request<CloudApiKey[]>("GET", `/projects/${projectId}/api-keys`)
  }

  async createApiKey(
    projectId: string,
    options: { name: string; permissions: CloudApiKey["permissions"] },
  ): Promise<CloudApiKey & { secret: string }> {
    return this.request("POST", `/projects/${projectId}/api-keys`, options)
  }

  async revokeApiKey(projectId: string, keyId: string): Promise<void> {
    await this.request("DELETE", `/projects/${projectId}/api-keys/${keyId}`)
  }

  // ─── Usage & Metrics ─────────────────────────────────────────────────────

  async getMetrics(projectId: string): Promise<Record<string, unknown>> {
    return this.request("GET", `/projects/${projectId}/metrics`)
  }

  async getUsage(projectId: string, period?: { start: string; end: string }): Promise<CloudUsage> {
    const qs = period ? `?start=${period.start}&end=${period.end}` : ""
    return this.request<CloudUsage>("GET", `/projects/${projectId}/usage${qs}`)
  }

  // ─── Logs ────────────────────────────────────────────────────────────────

  async getLogs(
    projectId: string,
    options?: { level?: string; limit?: number; since?: string },
  ): Promise<CloudLogEntry[]> {
    const params = new URLSearchParams()
    if (options?.level) params.set("level", options.level)
    if (options?.limit) params.set("limit", String(options.limit))
    if (options?.since) params.set("since", options.since)
    const qs = params.toString()
    return this.request<CloudLogEntry[]>("GET", `/projects/${projectId}/logs${qs ? `?${qs}` : ""}`)
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(`${this.apiUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      if (!response.ok) {
        const error = await response.text()
        throw new CloudError(`Cloud API error: ${response.status} ${error}`, response.status)
      }

      if (response.status === 204) return undefined as T
      return response.json() as Promise<T>
    } finally {
      clearTimeout(timer)
    }
  }
}

export class CloudError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = "CloudError"
  }
}

/**
 * Generate the deploy command for the CLI.
 */
export function generateDeployCommand(): string {
  return `
Usage: reactivebase deploy [options]

Deploy your ReactiveBase project to the cloud.

Options:
  --cloud         Deploy to ReactiveBase Cloud (default)
  --fly           Deploy to Fly.io
  --railway       Deploy to Railway
  --docker        Build Docker image only

Environment:
  REACTIVEBASE_API_KEY    API key for ReactiveBase Cloud

Examples:
  reactivebase deploy --cloud
  reactivebase deploy --fly
  REACTIVEBASE_API_KEY=xxx reactivebase deploy
`
}

/**
 * Estimate monthly cost for a given usage pattern.
 */
export function estimateMonthlyCost(usage: { subscriptions: number; storageGb: number; bandwidthGb: number }): {
  plan: string
  monthlyCost: number
  overageCost: number
} {
  const planEntries = Object.entries(PLANS).filter(([, p]) => p.price >= 0)

  for (const [key, plan] of planEntries) {
    const storageLimit = parseStorageToGb(plan.limits.storage)
    const bandwidthLimit = parseStorageToGb(plan.limits.bandwidth)

    if (
      usage.subscriptions <= plan.limits.subscriptions &&
      usage.storageGb <= storageLimit &&
      usage.bandwidthGb <= bandwidthLimit
    ) {
      return { plan: key, monthlyCost: plan.price, overageCost: 0 }
    }
  }

  // Exceeds team plan — needs enterprise
  return { plan: "enterprise", monthlyCost: -1, overageCost: 0 }
}

function parseStorageToGb(value: string): number {
  const num = parseFloat(value)
  if (value.includes("TB") || value.includes("T")) return num * 1024
  return num
}
