// Cloud
export { CloudClient, CloudError, PLANS, REGIONS, generateDeployCommand, estimateMonthlyCost } from "../cloud/index.js"
export type {
  CloudConfig,
  CloudProject,
  CloudPlan,
  CloudEnvironment,
  CloudDeployment,
  CloudTeamMember,
  CloudApiKey,
  CloudUsage,
  CloudLogEntry,
  ProvisioningOptions,
  DeploymentBundle,
  RegionId,
} from "../cloud/index.js"

// Cloud Platform
export { CloudPlatform } from "../cloud-platform/index.js"
export { CloudProvisioner, generatePreviewEnvTableSQL, generateCustomDomainTableSQL } from "../cloud-platform/index.js"
export type {
  CloudPlatformOptions,
  ProjectPlan,
  CloudProjectConfig,
  CloudProjectRecord,
  EnvironmentConfig,
  EnvironmentRecord,
  DeploymentConfig,
  DeploymentRecord,
  TeamMember,
  UsageRecord,
  UsageLimits,
  CostEstimate,
  CostBreakdownItem,
  BillingProvider,
} from "../cloud-platform/index.js"
export type {
  PreviewEnvironmentConfig,
  PreviewEnvironment as CloudPreviewEnvironment,
  DeployManifest,
  ProvisioningStep,
  ProvisioningPipeline,
  CustomDomain,
  EnvironmentPromotion,
  LogStreamOptions,
} from "../cloud-platform/index.js"

// Cloud Observability
export {
  CloudObservability,
  generateObservabilityTableSQL,
  buildInsertMetricSQL,
  buildQueryMetricsSQL,
  buildInsertAlertSQL,
} from "../cloud-platform/index.js"
export type {
  CloudObservabilityOptions,
  MetricDataPoint,
  AggregatedMetric,
  HealthCheck,
  AlertRule as CloudAlertRule,
  Alert as CloudAlert,
  AutoScaleRecommendation,
  TlsCertificateStatus,
  ObservabilitySnapshot,
  ObservabilitySummary,
} from "../cloud-platform/index.js"

// One-Click Provisioner
export {
  OneClickProvisioner,
  AutoScaler,
  DatabaseManager,
  ProvisioningError,
  DatabaseManagerError,
  generateProvisioningTableSQL,
  buildInsertProvisioningSQL,
  buildQueryTablesSQL,
} from "../cloud-platform/index.js"
export type {
  OneClickProvisionConfig,
  PostgresConfig,
  RedisConfig,
  MonitoringConfig,
  AutoScaleConfig,
  ProvisioningResult,
  AutoScaleState,
  DatabaseInfo as CloudDatabaseInfo,
  TableInfo as CloudTableInfo,
  ConnectionPoolStats,
} from "../cloud-platform/index.js"

// Multi-Region Active-Active
export {
  RegionManager,
  RegionRouter,
  mergeVectorClocks,
  incrementClock,
  happenedBefore,
  areConcurrent,
} from "../multi-region/index.js"
export type {
  RegionConfig,
  RegionManagerOptions,
  ConflictStrategy,
  RegionTopology,
  RegionStatus,
  ReplicationEvent,
  VectorClock,
  ReplicationConflict,
  ConflictHandler,
  RegionRoutingDecision,
  ReplicationStats as MultiRegionReplicationStats,
} from "../multi-region/index.js"

// Kubernetes Operator & Managed Cloud
export {
  KubernetesOperator,
  ControlPlaneDashboard,
  GitHubIntegration,
  generateTenantTableSQL,
  generateGitHubConnectionTableSQL,
  buildInsertTenantSQL,
  buildQueryTenantsSQL,
} from "../cloud-platform/index.js"
export type {
  ReactiveBaseCluster,
  TenantConfig,
  TenantStatus,
  ClusterHealth,
  ProjectCreateRequest,
  DeploymentLogEntry,
  BillingInfo,
  UsageMetrics as KubernetesUsageMetrics,
  BillingBreakdownItem,
  GitHubWebhookPayload,
  GitHubConnection,
} from "../cloud-platform/index.js"

// Edge-First Global Query Layer
export {
  EdgeQueryLayer,
  EdgeQueryCache,
  InvalidationPropagator,
  ConsistencyManager,
  EdgeQueryError,
  buildCreateEdgeCacheTableSQL,
  buildCreateInvalidationLogTableSQL,
  buildUpsertCacheEntrySQL,
  buildGetCacheEntrySQL,
  buildInvalidateByTablesSQL,
  buildInsertInvalidationSQL,
  buildGetPendingInvalidationsSQL,
  buildMarkInvalidationsProcessedSQL,
} from "../edge-query/index.js"
export type {
  EdgeRegion,
  EdgeCacheEntry,
  InvalidationMessage,
  EdgeQueryOptions,
  EdgeQueryLayerOptions,
  EdgeCacheStats as EdgeQueryCacheStats,
  ConsistencyProof,
} from "../edge-query/index.js"
