/**
 * Shared types for the Kubernetes operator, control plane dashboard,
 * and GitHub integration modules.
 */

import type { ProjectPlan } from "./cloud-platform.js"

// ─── Cluster & Tenant Types ─────────────────────────────────────────────────

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

// ─── Dashboard & Project Types ──────────────────────────────────────────────

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

// ─── GitHub Types ───────────────────────────────────────────────────────────

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

// ─── Plan Defaults ──────────────────────────────────────────────────────────

export const PLAN_TENANT_DEFAULTS: Record<ProjectPlan, { storage: number; connections: number; replicas: number }> = {
  free: { storage: 1, connections: 10, replicas: 1 },
  starter: { storage: 10, connections: 50, replicas: 1 },
  pro: { storage: 50, connections: 200, replicas: 2 },
  enterprise: { storage: 500, connections: 1000, replicas: 3 },
}

export const PLAN_BILLING_CENTS: Record<ProjectPlan, number> = {
  free: 0,
  starter: 2500,
  pro: 9900,
  enterprise: 49900,
}

// ─── SQL Builders ───────────────────────────────────────────────────────────

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
