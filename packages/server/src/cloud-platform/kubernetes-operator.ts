/**
 * Kubernetes Operator & Managed Cloud Enhancements for ReactiveBase Cloud.
 *
 * This module re-exports from focused sub-modules:
 *   - k8s-types.ts               — Shared types, constants, and SQL builders
 *   - k8s-operator.ts            — KubernetesOperator class
 *   - control-plane-dashboard.ts — ControlPlaneDashboard class
 *   - github-integration.ts      — GitHubIntegration class
 *   - id-generator.ts            — Shared ID generation utility
 */

// ─── Types, constants, SQL builders ─────────────────────────────────────────
export {
  PLAN_TENANT_DEFAULTS,
  PLAN_BILLING_CENTS,
  generateTenantTableSQL,
  generateGitHubConnectionTableSQL,
  buildInsertTenantSQL,
  buildQueryTenantsSQL,
} from "./k8s-types.js"
export type {
  ReactiveBaseCluster,
  TenantConfig,
  TenantStatus,
  ClusterHealth,
  ProjectCreateRequest,
  DeploymentLogEntry,
  BillingInfo,
  UsageMetrics,
  BillingBreakdownItem,
  GitHubWebhookPayload,
  GitHubConnection,
} from "./k8s-types.js"

// ─── K8s Operator ───────────────────────────────────────────────────────────
export { KubernetesOperator } from "./k8s-operator.js"

// ─── Control Plane Dashboard ────────────────────────────────────────────────
export { ControlPlaneDashboard } from "./control-plane-dashboard.js"

// ─── GitHub Integration ─────────────────────────────────────────────────────
export { GitHubIntegration } from "./github-integration.js"

// ─── Shared utility ─────────────────────────────────────────────────────────
export { createIdGenerator } from "./id-generator.js"
