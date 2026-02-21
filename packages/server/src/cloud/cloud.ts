/**
 * ReactiveBase Cloud client.
 * Handles project creation, deployment, and management for the managed cloud offering.
 */

export interface CloudConfig {
  /** API key for ReactiveBase Cloud */
  apiKey: string
  /** Cloud API endpoint (default: https://api.reactivebase.dev) */
  apiUrl?: string
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

/**
 * ReactiveBase Cloud API client.
 */
export class CloudClient {
  private apiUrl: string
  private apiKey: string

  constructor(config: CloudConfig) {
    this.apiUrl = (config.apiUrl ?? "https://api.reactivebase.dev").replace(/\/$/, "")
    this.apiKey = config.apiKey
  }

  /**
   * Create a new cloud project.
   */
  async createProject(options: {
    name: string
    region?: string
    plan?: string
  }): Promise<CloudProject> {
    return this.request<CloudProject>("POST", "/projects", {
      name: options.name,
      region: options.region ?? "us-east-1",
      plan: options.plan ?? "free",
    })
  }

  /**
   * Get project details.
   */
  async getProject(projectId: string): Promise<CloudProject> {
    return this.request<CloudProject>("GET", `/projects/${projectId}`)
  }

  /**
   * List all projects.
   */
  async listProjects(): Promise<CloudProject[]> {
    return this.request<CloudProject[]>("GET", "/projects")
  }

  /**
   * Deploy to a cloud project.
   */
  async deploy(projectId: string, bundle: {
    schema: string
    functions: Record<string, string>
  }): Promise<{ success: boolean; url: string }> {
    return this.request("POST", `/projects/${projectId}/deploy`, bundle)
  }

  /**
   * Delete a cloud project.
   */
  async deleteProject(projectId: string): Promise<void> {
    await this.request("DELETE", `/projects/${projectId}`)
  }

  /**
   * Get project metrics.
   */
  async getMetrics(projectId: string): Promise<Record<string, unknown>> {
    return this.request("GET", `/projects/${projectId}/metrics`)
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new CloudError(`Cloud API error: ${response.status} ${error}`, response.status)
    }

    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }
}

export class CloudError extends Error {
  constructor(message: string, public readonly statusCode: number) {
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
