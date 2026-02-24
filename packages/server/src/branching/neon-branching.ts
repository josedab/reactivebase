/**
 * Neon Branching API integration for ReactiveBase.
 * Provides copy-on-write database branching via Neon's platform API.
 *
 * Usage:
 *   const adapter = new NeonBranchingAdapter({ apiKey: "neon_key", projectId: "proj_123" })
 *   const branch = await adapter.createBranch("proj_123", "feature-x")
 *   const connStr = await adapter.getConnectionString("proj_123", branch.id)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NeonConfig {
  /** Neon API key */
  apiKey: string
  /** Neon project ID */
  projectId: string
  /** Base URL for the Neon API (default: https://console.neon.tech/api/v2) */
  baseUrl?: string
}

export interface NeonBranch {
  id: string
  name: string
  parentId: string | null
  createdAt: string
  currentState: "init" | "ready" | "deleting" | "deleted"
  endpoints: NeonEndpoint[]
}

export interface NeonEndpoint {
  id: string
  host: string
  port: number
  type: "read_write" | "read_only"
}

interface NeonApiError {
  message: string
  code: string
}

// ─── Neon Branching Adapter ──────────────────────────────────────────────────

const DEFAULT_BASE_URL = "https://console.neon.tech/api/v2"

export class NeonBranchingAdapter {
  private apiKey: string
  private baseUrl: string

  constructor(config: NeonConfig) {
    if (!config.apiKey) {
      throw new NeonBranchingError("Neon API key is required")
    }
    this.apiKey = config.apiKey
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
  }

  // ─── Branch Operations ──────────────────────────────────────────────────

  async createBranch(projectId: string, name: string, parentId?: string): Promise<NeonBranch> {
    const body: Record<string, unknown> = {
      branch: { name },
      endpoints: [{ type: "read_write" }],
    }
    if (parentId) {
      ;(body.branch as Record<string, unknown>).parent_id = parentId
    }

    const response = await this.request<{ branch: NeonApiBranch; endpoints: NeonApiEndpoint[] }>(
      `/projects/${projectId}/branches`,
      { method: "POST", body },
    )

    return mapBranch(response.branch, response.endpoints ?? [])
  }

  async deleteBranch(projectId: string, branchId: string): Promise<void> {
    await this.request(`/projects/${projectId}/branches/${branchId}`, { method: "DELETE" })
  }

  async getBranch(projectId: string, branchId: string): Promise<NeonBranch> {
    const response = await this.request<{ branch: NeonApiBranch }>(`/projects/${projectId}/branches/${branchId}`, {
      method: "GET",
    })
    const endpoints = await this.fetchEndpoints(projectId, branchId)
    return mapBranch(response.branch, endpoints)
  }

  async listBranches(projectId: string): Promise<NeonBranch[]> {
    const response = await this.request<{ branches: NeonApiBranch[] }>(`/projects/${projectId}/branches`, {
      method: "GET",
    })
    return response.branches.map((b) => mapBranch(b, []))
  }

  async getConnectionString(projectId: string, branchId: string): Promise<string> {
    const branch = await this.getBranch(projectId, branchId)
    const rwEndpoint = branch.endpoints.find((e) => e.type === "read_write")
    if (!rwEndpoint) {
      throw new NeonBranchingError(`No read_write endpoint found for branch "${branchId}"`)
    }
    return `postgresql://${rwEndpoint.host}:${rwEndpoint.port}/neondb`
  }

  async resetBranch(projectId: string, branchId: string): Promise<void> {
    await this.request(`/projects/${projectId}/branches/${branchId}/reset`, { method: "POST", body: {} })
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private async fetchEndpoints(projectId: string, branchId: string): Promise<NeonApiEndpoint[]> {
    const response = await this.request<{ endpoints: NeonApiEndpoint[] }>(
      `/projects/${projectId}/branches/${branchId}/endpoints`,
      { method: "GET" },
    )
    return response.endpoints ?? []
  }

  private async request<T = unknown>(path: string, options: { method: string; body?: unknown }): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    }

    const init: RequestInit = {
      method: options.method,
      headers,
    }
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body)
    }

    const res = await fetch(url, init)

    if (!res.ok) {
      let errorMessage = `Neon API error: ${res.status} ${res.statusText}`
      try {
        const errorBody = (await res.json()) as NeonApiError
        if (errorBody.message) errorMessage = `Neon API error: ${errorBody.message}`
      } catch {
        // use default error message
      }
      throw new NeonBranchingError(errorMessage)
    }

    if (res.status === 204 || options.method === "DELETE") {
      return {} as T
    }

    return (await res.json()) as T
  }
}

// ─── API Response Mapping ────────────────────────────────────────────────────

interface NeonApiBranch {
  id: string
  name: string
  parent_id?: string | null
  created_at: string
  current_state: string
}

interface NeonApiEndpoint {
  id: string
  host: string
  port?: number
  type: string
}

function mapBranch(raw: NeonApiBranch, rawEndpoints: NeonApiEndpoint[]): NeonBranch {
  return {
    id: raw.id,
    name: raw.name,
    parentId: raw.parent_id ?? null,
    createdAt: raw.created_at,
    currentState: raw.current_state as NeonBranch["currentState"],
    endpoints: rawEndpoints.map((e) => ({
      id: e.id,
      host: e.host,
      port: e.port ?? 5432,
      type: e.type as NeonEndpoint["type"],
    })),
  }
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class NeonBranchingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NeonBranchingError"
  }
}
