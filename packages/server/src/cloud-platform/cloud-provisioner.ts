/**
 * Cloud Provisioning & Preview Environments.
 * Extends the CloudPlatform with:
 *   - PR-based preview environments (create/destroy per pull request)
 *   - Deploy manifest generation for CLI `reactivebase deploy`
 *   - Provisioning pipeline with step tracking
 *   - Custom domain management
 *   - Environment promotion (staging → production)
 *   - Log streaming API
 *
 * Usage:
 *   const provisioner = new CloudProvisioner(platform)
 *   const preview = await provisioner.createPreviewEnvironment(projectId, { prNumber: 42 })
 *   const manifest = provisioner.generateDeployManifest(project, env)
 */

import type { CloudPlatform, CloudProjectRecord, EnvironmentRecord } from "./cloud-platform.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PreviewEnvironmentConfig {
  prNumber: number
  branch: string
  commitSha: string
  author?: string
  ttlMinutes?: number
}

export interface PreviewEnvironment {
  id: string
  projectId: string
  environmentId: string
  prNumber: number
  branch: string
  commitSha: string
  author: string
  url: string
  status: "provisioning" | "ready" | "expired" | "destroyed"
  createdAt: number
  expiresAt: number
  deploymentId: string | null
}

export interface DeployManifest {
  version: "1.0"
  project: {
    id: string
    name: string
    region: string
  }
  environment: {
    id: string
    name: string
    isProduction: boolean
  }
  build: {
    runtime: "nodejs-20"
    buildCommand: string
    startCommand: string
    envVars: Record<string, string>
  }
  resources: {
    postgres: { version: string; storage: string }
    redis: { enabled: boolean }
    replicas: { min: number; max: number }
  }
  routing: {
    domains: string[]
    healthCheckPath: string
  }
}

export interface ProvisioningStep {
  name: string
  status: "pending" | "running" | "completed" | "failed"
  startedAt: number | null
  completedAt: number | null
  error: string | null
  durationMs: number | null
}

export interface ProvisioningPipeline {
  id: string
  projectId: string
  environmentId: string
  steps: ProvisioningStep[]
  status: "running" | "completed" | "failed"
  startedAt: number
  completedAt: number | null
  totalDurationMs: number | null
}

export interface CustomDomain {
  domain: string
  projectId: string
  environmentId: string
  status: "pending-verification" | "verified" | "active" | "error"
  verificationRecord: { type: string; name: string; value: string }
  sslStatus: "pending" | "active" | "error"
  createdAt: number
}

export interface EnvironmentPromotion {
  id: string
  sourceEnvId: string
  targetEnvId: string
  deploymentId: string
  status: "pending" | "promoting" | "completed" | "rolled-back"
  promotedAt: number
  promotedBy: string
}

export interface LogStreamOptions {
  deploymentId: string
  since?: number
  follow?: boolean
  filter?: "build" | "runtime" | "error"
}

export interface LogEntry {
  timestamp: number
  level: "info" | "warn" | "error" | "debug"
  source: "build" | "runtime" | "system"
  message: string
  metadata?: Record<string, unknown>
}

// ─── SQL Builders ────────────────────────────────────────────────────────────

export function generatePreviewEnvTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_preview_envs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  branch TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  url TEXT,
  status TEXT NOT NULL DEFAULT 'provisioning',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  deployment_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_preview_envs_project ON _reactivebase_preview_envs (project_id);
CREATE INDEX IF NOT EXISTS idx_preview_envs_pr ON _reactivebase_preview_envs (project_id, pr_number);`
}

export function generateCustomDomainTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_custom_domains (
  domain TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending-verification',
  verification_type TEXT NOT NULL,
  verification_name TEXT NOT NULL,
  verification_value TEXT NOT NULL,
  ssl_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`
}

// ─── Cloud Provisioner ───────────────────────────────────────────────────────

const DEFAULT_TTL_MINUTES = 60 * 24 // 24 hours

export class CloudProvisioner {
  private platform: CloudPlatform
  private previews = new Map<string, PreviewEnvironment>()
  private pipelines = new Map<string, ProvisioningPipeline>()
  private domains = new Map<string, CustomDomain>()
  private promotions = new Map<string, EnvironmentPromotion>()
  private logs = new Map<string, LogEntry[]>()
  private idCounter = 0

  constructor(platform: CloudPlatform) {
    this.platform = platform
  }

  private generateId(prefix: string): string {
    return `${prefix}_${++this.idCounter}_${Date.now().toString(36)}`
  }

  // ─── Preview Environments ──────────────────────────────────────────────

  async createPreviewEnvironment(projectId: string, config: PreviewEnvironmentConfig): Promise<PreviewEnvironment> {
    const project = this.platform.getProject(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)

    // Check for existing preview for this PR
    const existing = this.getPreviewForPR(projectId, config.prNumber)
    if (existing && existing.status === "ready") {
      return existing
    }

    const ttl = (config.ttlMinutes ?? DEFAULT_TTL_MINUTES) * 60 * 1000
    const env = await this.platform.createEnvironment(projectId, {
      name: `pr-${config.prNumber}`,
      isProduction: false,
      variables: {
        PREVIEW_PR: String(config.prNumber),
        PREVIEW_BRANCH: config.branch,
        PREVIEW_SHA: config.commitSha,
      },
    })

    const deployment = await this.platform.deploy(projectId, env.id, {
      source: "git",
      ref: config.branch,
      commitSha: config.commitSha,
      message: `Preview for PR #${config.prNumber}`,
    })

    const preview: PreviewEnvironment = {
      id: this.generateId("preview"),
      projectId,
      environmentId: env.id,
      prNumber: config.prNumber,
      branch: config.branch,
      commitSha: config.commitSha,
      author: config.author ?? "unknown",
      url: env.url ?? `https://${project.name}-pr-${config.prNumber}.reactivebase.cloud`,
      status: "ready",
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl,
      deploymentId: deployment.id,
    }

    this.previews.set(preview.id, preview)
    return preview
  }

  async destroyPreviewEnvironment(previewId: string): Promise<void> {
    const preview = this.previews.get(previewId)
    if (!preview) throw new Error(`Preview ${previewId} not found`)

    preview.status = "destroyed"
    await this.platform.deleteEnvironment(preview.environmentId)
  }

  async destroyPreviewsForPR(projectId: string, prNumber: number): Promise<number> {
    let destroyed = 0
    for (const preview of this.previews.values()) {
      if (preview.projectId === projectId && preview.prNumber === prNumber && preview.status === "ready") {
        preview.status = "destroyed"
        try {
          await this.platform.deleteEnvironment(preview.environmentId)
        } catch {
          /* environment may already be gone */
        }
        destroyed++
      }
    }
    return destroyed
  }

  getPreviewForPR(projectId: string, prNumber: number): PreviewEnvironment | undefined {
    for (const preview of this.previews.values()) {
      if (preview.projectId === projectId && preview.prNumber === prNumber && preview.status === "ready") {
        return preview
      }
    }
    return undefined
  }

  listPreviews(projectId: string): PreviewEnvironment[] {
    return Array.from(this.previews.values()).filter((p) => p.projectId === projectId)
  }

  cleanupExpiredPreviews(): PreviewEnvironment[] {
    const now = Date.now()
    const expired: PreviewEnvironment[] = []
    for (const preview of this.previews.values()) {
      if (preview.status === "ready" && preview.expiresAt < now) {
        preview.status = "expired"
        expired.push(preview)
      }
    }
    return expired
  }

  // ─── Deploy Manifest ────────────────────────────────────────────────────

  generateDeployManifest(
    project: CloudProjectRecord,
    environment: EnvironmentRecord,
    overrides: Partial<DeployManifest["build"] & DeployManifest["resources"]> = {},
  ): DeployManifest {
    const isProduction = environment.isProduction

    return {
      version: "1.0",
      project: {
        id: project.id,
        name: project.name,
        region: project.region,
      },
      environment: {
        id: environment.id,
        name: environment.name,
        isProduction,
      },
      build: {
        runtime: "nodejs-20",
        buildCommand: overrides.buildCommand ?? "npm run build",
        startCommand: overrides.startCommand ?? "npm start",
        envVars: {
          NODE_ENV: isProduction ? "production" : "development",
          DATABASE_URL: environment.databaseUrl ?? "",
          ...environment.variables,
        },
      },
      resources: {
        postgres: {
          version: "16",
          storage: isProduction ? "50Gi" : "5Gi",
        },
        redis: { enabled: isProduction },
        replicas: {
          min: isProduction ? 2 : 1,
          max: isProduction ? 10 : 2,
        },
      },
      routing: {
        domains: [environment.url ?? `${project.name}-${environment.name}.reactivebase.cloud`],
        healthCheckPath: "/api/v1/health",
      },
    }
  }

  // ─── Provisioning Pipeline ──────────────────────────────────────────────

  createProvisioningPipeline(projectId: string, environmentId: string): ProvisioningPipeline {
    const steps: ProvisioningStep[] = [
      {
        name: "Validate configuration",
        status: "pending",
        startedAt: null,
        completedAt: null,
        error: null,
        durationMs: null,
      },
      {
        name: "Provision database",
        status: "pending",
        startedAt: null,
        completedAt: null,
        error: null,
        durationMs: null,
      },
      {
        name: "Configure networking",
        status: "pending",
        startedAt: null,
        completedAt: null,
        error: null,
        durationMs: null,
      },
      {
        name: "Deploy application",
        status: "pending",
        startedAt: null,
        completedAt: null,
        error: null,
        durationMs: null,
      },
      {
        name: "Run health checks",
        status: "pending",
        startedAt: null,
        completedAt: null,
        error: null,
        durationMs: null,
      },
      { name: "Configure DNS", status: "pending", startedAt: null, completedAt: null, error: null, durationMs: null },
    ]

    const pipeline: ProvisioningPipeline = {
      id: this.generateId("pipeline"),
      projectId,
      environmentId,
      steps,
      status: "running",
      startedAt: Date.now(),
      completedAt: null,
      totalDurationMs: null,
    }

    this.pipelines.set(pipeline.id, pipeline)
    return pipeline
  }

  advancePipelineStep(pipelineId: string, stepIndex: number, success: boolean, error?: string): ProvisioningPipeline {
    const pipeline = this.pipelines.get(pipelineId)
    if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`)

    const step = pipeline.steps[stepIndex]
    if (!step) throw new Error(`Step ${stepIndex} not found`)

    const now = Date.now()

    if (step.status === "pending") {
      step.status = "running"
      step.startedAt = now
    }

    if (success) {
      step.status = "completed"
      step.completedAt = now
      step.durationMs = step.startedAt ? now - step.startedAt : 0
    } else {
      step.status = "failed"
      step.completedAt = now
      step.error = error ?? "Unknown error"
      step.durationMs = step.startedAt ? now - step.startedAt : 0
      pipeline.status = "failed"
    }

    // Check if all steps completed
    if (pipeline.steps.every((s) => s.status === "completed")) {
      pipeline.status = "completed"
      pipeline.completedAt = now
      pipeline.totalDurationMs = now - pipeline.startedAt
    }

    return pipeline
  }

  getPipeline(pipelineId: string): ProvisioningPipeline | undefined {
    return this.pipelines.get(pipelineId)
  }

  // ─── Custom Domains ─────────────────────────────────────────────────────

  addCustomDomain(domain: string, projectId: string, environmentId: string): CustomDomain {
    if (this.domains.has(domain)) {
      throw new Error(`Domain "${domain}" is already registered`)
    }

    const verificationValue = `reactivebase-verify=${this.generateId("v")}`
    const record: CustomDomain = {
      domain,
      projectId,
      environmentId,
      status: "pending-verification",
      verificationRecord: {
        type: "CNAME",
        name: `_reactivebase.${domain}`,
        value: verificationValue,
      },
      sslStatus: "pending",
      createdAt: Date.now(),
    }

    this.domains.set(domain, record)
    return record
  }

  verifyDomain(domain: string): CustomDomain {
    const record = this.domains.get(domain)
    if (!record) throw new Error(`Domain "${domain}" not found`)

    record.status = "verified"
    return record
  }

  activateDomain(domain: string): CustomDomain {
    const record = this.domains.get(domain)
    if (!record) throw new Error(`Domain "${domain}" not found`)
    if (record.status !== "verified") throw new Error("Domain must be verified first")

    record.status = "active"
    record.sslStatus = "active"
    return record
  }

  removeDomain(domain: string): void {
    if (!this.domains.has(domain)) throw new Error(`Domain "${domain}" not found`)
    this.domains.delete(domain)
  }

  listDomains(projectId: string): CustomDomain[] {
    return Array.from(this.domains.values()).filter((d) => d.projectId === projectId)
  }

  // ─── Environment Promotion ──────────────────────────────────────────────

  async promoteEnvironment(
    sourceEnvId: string,
    targetEnvId: string,
    promotedBy: string,
  ): Promise<EnvironmentPromotion> {
    const sourceEnv = this.platform.getEnvironment(sourceEnvId)
    if (!sourceEnv) throw new Error(`Source environment ${sourceEnvId} not found`)

    const targetEnv = this.platform.getEnvironment(targetEnvId)
    if (!targetEnv) throw new Error(`Target environment ${targetEnvId} not found`)

    // Get latest deployment from source
    const deployments = this.platform.listDeployments(sourceEnv.projectId, sourceEnvId)
    const latestDeployment = deployments.filter((d) => d.status === "active").pop()
    if (!latestDeployment) throw new Error("No active deployment found in source environment")

    // Deploy same version to target
    const newDeployment = await this.platform.deploy(sourceEnv.projectId, targetEnvId, {
      source: latestDeployment.source,
      ref: latestDeployment.ref ?? undefined,
      commitSha: latestDeployment.commitSha ?? undefined,
      message: `Promoted from ${sourceEnv.name}`,
    })

    const promotion: EnvironmentPromotion = {
      id: this.generateId("promo"),
      sourceEnvId,
      targetEnvId,
      deploymentId: newDeployment.id,
      status: "completed",
      promotedAt: Date.now(),
      promotedBy,
    }

    this.promotions.set(promotion.id, promotion)
    return promotion
  }

  listPromotions(_projectId: string): EnvironmentPromotion[] {
    return Array.from(this.promotions.values())
  }

  // ─── Log Streaming ──────────────────────────────────────────────────────

  appendLog(deploymentId: string, entry: Omit<LogEntry, "timestamp">): void {
    if (!this.logs.has(deploymentId)) {
      this.logs.set(deploymentId, [])
    }
    this.logs.get(deploymentId)!.push({ ...entry, timestamp: Date.now() })
  }

  getLogs(options: LogStreamOptions): LogEntry[] {
    const entries = this.logs.get(options.deploymentId) ?? []
    let filtered = entries

    if (options.since) {
      filtered = filtered.filter((e) => e.timestamp >= options.since!)
    }
    if (options.filter) {
      filtered = filtered.filter((e) => e.source === options.filter)
    }

    return filtered
  }
}
