/**
 * Preview Environment Manager for ReactiveBase.
 * Provides full lifecycle management for preview environments tied to PRs,
 * deploy previews, and ephemeral testing branches.
 *
 * Features:
 *   - Auto-create preview envs on PR open/update
 *   - Auto-destroy on PR close/merge with configurable TTL
 *   - Health checking and readiness probes
 *   - Migration status tracking per preview
 *   - Resource limits and cleanup policies
 *   - Environment variable injection for preview deployments
 *
 * Usage:
 *   const manager = new PreviewEnvironmentManager({ branching, maxPreviews: 20 })
 *   const env = await manager.create({ trigger: "pr", prNumber: 42, branch: "feat-x", commitSha: "abc" })
 *   await manager.applyMigrations(env.id)
 *   await manager.destroy(env.id)
 */

import type { BranchRecord, SeedDataConfig } from "./branching.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PreviewEnvironmentOptions {
  /** Max concurrent preview environments (default: 20) */
  maxPreviews?: number
  /** Auto-destroy previews after TTL in ms (default: 24h) */
  ttlMs?: number
  /** Enable health checks (default: true) */
  healthChecks?: boolean
  /** Health check interval in ms (default: 60000) */
  healthCheckIntervalMs?: number
  /** Seed configuration for new previews */
  seedConfig?: SeedDataConfig
  /** Base URL template for preview environments. Use {{id}} placeholder */
  baseUrlTemplate?: string
  /** Environment variables injected into each preview */
  envVars?: Record<string, string>
  /** Cleanup strategy when max previews exceeded */
  cleanupStrategy?: "oldest" | "least-recently-used" | "manual"
}

export type PreviewTrigger = "pr" | "deploy" | "manual" | "ci"

export interface PreviewEnvironment {
  id: string
  trigger: PreviewTrigger
  branchName: string
  branchRecord: BranchRecord | null
  prNumber: number | null
  commitSha: string | null
  deployId: string | null
  status: PreviewEnvStatus
  url: string | null
  connectionString: string | null
  migrationStatus: MigrationApplyStatus
  health: HealthStatus
  envVars: Record<string, string>
  createdAt: number
  updatedAt: number
  expiresAt: number | null
  metadata: Record<string, unknown>
}

export type PreviewEnvStatus =
  | "provisioning"
  | "migrating"
  | "seeding"
  | "ready"
  | "unhealthy"
  | "destroying"
  | "destroyed"
  | "expired"
  | "error"

export type MigrationApplyStatus = "pending" | "running" | "applied" | "failed" | "skipped"

export interface HealthStatus {
  healthy: boolean
  lastCheck: number | null
  consecutiveFailures: number
  latencyMs: number | null
}

export interface CreatePreviewRequest {
  trigger: PreviewTrigger
  prNumber?: number
  branch?: string
  commitSha?: string
  deployId?: string
  seedConfig?: SeedDataConfig
  envVars?: Record<string, string>
  ttlMs?: number
  metadata?: Record<string, unknown>
}

export interface PreviewEnvironmentStats {
  total: number
  byStatus: Record<PreviewEnvStatus, number>
  byTrigger: Record<PreviewTrigger, number>
  oldestActiveAge: number | null
  averageProvisionTimeMs: number
}

// ─── SQL Builders ────────────────────────────────────────────────────────────

export function buildCreatePreviewEnvTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_preview_envs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  pr_number INTEGER,
  commit_sha TEXT,
  deploy_id TEXT,
  status TEXT NOT NULL DEFAULT 'provisioning',
  url TEXT,
  connection_string TEXT,
  migration_status TEXT NOT NULL DEFAULT 'pending',
  health_healthy BOOLEAN NOT NULL DEFAULT FALSE,
  health_last_check TIMESTAMPTZ,
  health_failures INTEGER NOT NULL DEFAULT 0,
  health_latency_ms REAL,
  env_vars JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_preview_envs_status ON _reactivebase_preview_envs(status);
CREATE INDEX IF NOT EXISTS idx_preview_envs_pr ON _reactivebase_preview_envs(pr_number) WHERE pr_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_preview_envs_expires ON _reactivebase_preview_envs(expires_at) WHERE expires_at IS NOT NULL;
`.trim()
}

export function buildUpsertPreviewEnvSQL(env: PreviewEnvironment): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_preview_envs
      (id, trigger, branch_name, pr_number, commit_sha, deploy_id, status, url, connection_string, migration_status, health_healthy, health_last_check, health_failures, health_latency_ms, env_vars, expires_at, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        status = $7, url = $8, connection_string = $9, migration_status = $10,
        health_healthy = $11, health_last_check = $12, health_failures = $13,
        health_latency_ms = $14, updated_at = NOW(), metadata = $17::jsonb`,
    params: [
      env.id,
      env.trigger,
      env.branchName,
      env.prNumber,
      env.commitSha,
      env.deployId,
      env.status,
      env.url,
      env.connectionString,
      env.migrationStatus,
      env.health.healthy,
      env.health.lastCheck ? new Date(env.health.lastCheck).toISOString() : null,
      env.health.consecutiveFailures,
      env.health.latencyMs,
      JSON.stringify(env.envVars),
      env.expiresAt ? new Date(env.expiresAt).toISOString() : null,
      JSON.stringify(env.metadata),
    ],
  }
}

export function buildGetExpiredPreviewsSQL(): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT id FROM _reactivebase_preview_envs WHERE expires_at IS NOT NULL AND expires_at < NOW() AND status NOT IN ('destroyed', 'destroying')`,
    params: [],
  }
}

export function buildDeletePreviewEnvSQL(id: string): { sql: string; params: unknown[] } {
  return {
    sql: `DELETE FROM _reactivebase_preview_envs WHERE id = $1`,
    params: [id],
  }
}

// ─── Preview Environment Manager ─────────────────────────────────────────────

interface BranchingAdapter {
  createBranch(
    name: string,
    options?: { fromBranch?: string; createdBy?: string; seedConfig?: SeedDataConfig },
  ): Promise<BranchRecord>
  deleteBranch(name: string): Promise<void>
  getBranch(name: string): BranchRecord | undefined
  listBranches(): BranchRecord[]
}

const DEFAULT_OPTIONS: Required<PreviewEnvironmentOptions> = {
  maxPreviews: 20,
  ttlMs: 24 * 60 * 60 * 1000, // 24 hours
  healthChecks: true,
  healthCheckIntervalMs: 60_000,
  seedConfig: {},
  baseUrlTemplate: "https://preview-{{id}}.reactivebase.dev",
  envVars: {},
  cleanupStrategy: "oldest",
}

export class PreviewEnvironmentManager {
  private options: Required<PreviewEnvironmentOptions>
  private environments = new Map<string, PreviewEnvironment>()
  private branching: BranchingAdapter
  private provisionTimes: number[] = []

  constructor(branching: BranchingAdapter, options: PreviewEnvironmentOptions = {}) {
    this.branching = branching
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Create a new preview environment.
   */
  async create(request: CreatePreviewRequest): Promise<PreviewEnvironment> {
    if (!request.trigger) {
      throw new PreviewEnvironmentError("Trigger type is required")
    }

    // Enforce limits - clean up if needed
    if (this.environments.size >= this.options.maxPreviews) {
      const cleaned = await this.enforceCleanupPolicy()
      if (!cleaned) {
        throw new PreviewEnvironmentError(
          `Maximum preview environments (${this.options.maxPreviews}) reached. ` +
            `Destroy an existing preview or increase the limit.`,
        )
      }
    }

    const id = this.generateId(request)
    const branchName = `preview-${id}`
    const ttl = request.ttlMs ?? this.options.ttlMs
    const startTime = Date.now()

    const env: PreviewEnvironment = {
      id,
      trigger: request.trigger,
      branchName,
      branchRecord: null,
      prNumber: request.prNumber ?? null,
      commitSha: request.commitSha ?? null,
      deployId: request.deployId ?? null,
      status: "provisioning",
      url: null,
      connectionString: null,
      migrationStatus: "pending",
      health: { healthy: false, lastCheck: null, consecutiveFailures: 0, latencyMs: null },
      envVars: { ...this.options.envVars, ...request.envVars },
      createdAt: startTime,
      updatedAt: startTime,
      expiresAt: ttl > 0 ? startTime + ttl : null,
      metadata: request.metadata ?? {},
    }

    this.environments.set(id, env)

    try {
      const branchRecord = await this.branching.createBranch(branchName, {
        fromBranch: "main",
        createdBy: `preview-${request.trigger}-${id}`,
        seedConfig: request.seedConfig ?? this.options.seedConfig,
      })

      env.branchRecord = branchRecord
      env.connectionString = branchRecord.connectionString
      env.url = this.options.baseUrlTemplate.replace("{{id}}", id)

      // Inject preview-specific env vars
      env.envVars.REACTIVEBASE_BRANCH = branchName
      env.envVars.REACTIVEBASE_PREVIEW_ID = id
      if (env.connectionString) {
        env.envVars.DATABASE_URL = env.connectionString
      }

      env.status = "ready"
      env.health.healthy = true
      env.updatedAt = Date.now()

      this.provisionTimes.push(Date.now() - startTime)
      if (this.provisionTimes.length > 100) this.provisionTimes.shift()

      return env
    } catch (error: unknown) {
      env.status = "error"
      env.updatedAt = Date.now()
      env.metadata.error = error instanceof Error ? error.message : String(error)
      throw new PreviewEnvironmentError(`Failed to provision preview environment "${id}": ${env.metadata.error}`)
    }
  }

  /**
   * Update preview environment for new commit (re-provisions the branch).
   */
  async update(id: string, commitSha: string): Promise<PreviewEnvironment> {
    const env = this.environments.get(id)
    if (!env) throw new PreviewEnvironmentError(`Preview environment "${id}" not found`)
    if (env.status === "destroyed" || env.status === "destroying") {
      throw new PreviewEnvironmentError(`Preview environment "${id}" is already destroyed`)
    }

    env.status = "provisioning"
    env.commitSha = commitSha
    env.updatedAt = Date.now()

    try {
      await this.branching.deleteBranch(env.branchName)
    } catch {
      // Branch may not exist
    }

    const branchRecord = await this.branching.createBranch(env.branchName, {
      fromBranch: "main",
      createdBy: `preview-update-${id}`,
    })

    env.branchRecord = branchRecord
    env.connectionString = branchRecord.connectionString
    env.migrationStatus = "pending"
    env.status = "ready"
    env.health.healthy = true
    env.health.consecutiveFailures = 0
    env.updatedAt = Date.now()

    return env
  }

  /**
   * Mark migrations as applied/failed for a preview.
   */
  setMigrationStatus(id: string, status: MigrationApplyStatus): void {
    const env = this.environments.get(id)
    if (!env) throw new PreviewEnvironmentError(`Preview environment "${id}" not found`)
    env.migrationStatus = status
    env.updatedAt = Date.now()
  }

  /**
   * Record a health check result.
   */
  recordHealthCheck(id: string, healthy: boolean, latencyMs?: number): void {
    const env = this.environments.get(id)
    if (!env) return

    env.health.lastCheck = Date.now()
    env.health.latencyMs = latencyMs ?? null

    if (healthy) {
      env.health.healthy = true
      env.health.consecutiveFailures = 0
      if (env.status === "unhealthy") {
        env.status = "ready"
      }
    } else {
      env.health.consecutiveFailures++
      if (env.health.consecutiveFailures >= 3) {
        env.health.healthy = false
        env.status = "unhealthy"
      }
    }
    env.updatedAt = Date.now()
  }

  /**
   * Destroy a preview environment and clean up its branch.
   */
  async destroy(id: string): Promise<void> {
    const env = this.environments.get(id)
    if (!env) return

    env.status = "destroying"
    env.updatedAt = Date.now()

    try {
      await this.branching.deleteBranch(env.branchName)
    } catch {
      // Branch may already be cleaned up
    }

    env.status = "destroyed"
    env.updatedAt = Date.now()
    this.environments.delete(id)
  }

  /**
   * Clean up all expired preview environments.
   */
  async cleanupExpired(): Promise<string[]> {
    const now = Date.now()
    const expired: string[] = []

    for (const [id, env] of this.environments) {
      if (env.expiresAt && env.expiresAt < now && env.status !== "destroyed" && env.status !== "destroying") {
        expired.push(id)
      }
    }

    for (const id of expired) {
      await this.destroy(id)
    }

    return expired
  }

  /**
   * Get a preview environment by ID.
   */
  get(id: string): PreviewEnvironment | undefined {
    return this.environments.get(id)
  }

  /**
   * Find preview environment by PR number.
   */
  getByPR(prNumber: number): PreviewEnvironment | undefined {
    return [...this.environments.values()].find((e) => e.prNumber === prNumber && e.status !== "destroyed")
  }

  /**
   * List all active preview environments.
   */
  list(): PreviewEnvironment[] {
    return [...this.environments.values()]
  }

  /**
   * Get statistics about preview environments.
   */
  getStats(): PreviewEnvironmentStats {
    const envs = [...this.environments.values()]
    const now = Date.now()

    const byStatus = {} as Record<PreviewEnvStatus, number>
    const byTrigger = {} as Record<PreviewTrigger, number>

    for (const env of envs) {
      byStatus[env.status] = (byStatus[env.status] ?? 0) + 1
      byTrigger[env.trigger] = (byTrigger[env.trigger] ?? 0) + 1
    }

    const activeEnvs = envs.filter((e) => e.status !== "destroyed" && e.status !== "destroying")
    const oldestActive = activeEnvs.length > 0 ? Math.min(...activeEnvs.map((e) => e.createdAt)) : null

    return {
      total: envs.length,
      byStatus,
      byTrigger,
      oldestActiveAge: oldestActive !== null ? now - oldestActive : null,
      averageProvisionTimeMs:
        this.provisionTimes.length > 0
          ? this.provisionTimes.reduce((a, b) => a + b, 0) / this.provisionTimes.length
          : 0,
    }
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private generateId(request: CreatePreviewRequest): string {
    if (request.trigger === "pr" && request.prNumber) {
      return `pr-${request.prNumber}`
    }
    if (request.trigger === "deploy" && request.deployId) {
      return `deploy-${request.deployId}`
    }
    return `${request.trigger}-${Date.now().toString(36)}`
  }

  private async enforceCleanupPolicy(): Promise<boolean> {
    if (this.options.cleanupStrategy === "manual") return false

    // Clean expired first
    const expired = await this.cleanupExpired()
    if (expired.length > 0) return true

    const envs = [...this.environments.values()].filter((e) => e.status !== "destroyed" && e.status !== "destroying")

    if (envs.length === 0) return false

    if (this.options.cleanupStrategy === "oldest") {
      envs.sort((a, b) => a.createdAt - b.createdAt)
    } else {
      // least-recently-used
      envs.sort((a, b) => a.updatedAt - b.updatedAt)
    }

    await this.destroy(envs[0].id)
    return true
  }
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class PreviewEnvironmentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PreviewEnvironmentError"
  }
}
