export {
  CloudPlatform,
  generateCloudPlatformTableSQL,
  buildInsertProjectSQL,
  buildUpdateProjectSQL,
  buildDeleteProjectSQL,
  buildInsertEnvironmentSQL,
  buildDeleteEnvironmentSQL,
  buildInsertDeploymentSQL,
  buildUpdateDeploymentSQL,
} from "./cloud-platform.js"

export type {
  QueryExecutor as CloudPlatformQueryExecutor,
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
  ApiKeyConfig,
  ApiKeyRecord,
  AutoScaleConfig,
  ScaleMetrics,
  AutoScaleDecision,
  OneClickDeployConfig,
  OneClickDeployStep,
  OneClickDeployResult,
} from "./cloud-platform.js"

// Cloud Provisioner & Preview Environments
export { CloudProvisioner, generatePreviewEnvTableSQL, generateCustomDomainTableSQL } from "./cloud-provisioner.js"
export type {
  PreviewEnvironmentConfig,
  PreviewEnvironment,
  DeployManifest,
  ProvisioningStep,
  ProvisioningPipeline,
  CustomDomain,
  EnvironmentPromotion,
  LogStreamOptions,
  LogEntry as CloudLogEntry,
} from "./cloud-provisioner.js"

// Cloud Dashboard
export { generateCloudDashboardHTML } from "./cloud-dashboard.js"
export type { CloudDashboardData } from "./cloud-dashboard.js"

// Cloud Observability
export {
  CloudObservability,
  generateObservabilityTableSQL,
  buildInsertMetricSQL,
  buildQueryMetricsSQL,
  buildInsertAlertSQL,
} from "./cloud-observability.js"
export type {
  CloudObservabilityOptions,
  MetricDataPoint,
  AggregatedMetric,
  HealthCheck,
  AlertRule,
  Alert,
  AutoScaleRecommendation,
  TlsCertificateStatus,
  ObservabilitySnapshot,
  ObservabilitySummary,
} from "./cloud-observability.js"

// One-Click Provisioner
// NOTE: AutoScaleConfig is exported as ProvisionerAutoScaleConfig to avoid conflict
// with the cloud-platform AutoScaleConfig. The two interfaces have different shapes:
//   - AutoScaleConfig (cloud-platform): minInstances/maxInstances based (high-level scaling)
//   - ProvisionerAutoScaleConfig (one-click-provisioner): minReplicas/maxReplicas based (container orchestration)
export {
  OneClickProvisioner,
  AutoScaler,
  DatabaseManager,
  ProvisioningError,
  DatabaseManagerError,
  generateProvisioningTableSQL,
  buildInsertProvisioningSQL,
  buildQueryTablesSQL,
} from "./one-click-provisioner.js"
export type {
  OneClickProvisionConfig,
  PostgresConfig,
  RedisConfig,
  MonitoringConfig,
  HealthCheckRule,
  AlertRuleConfig,
  AutoScaleConfig as ProvisionerAutoScaleConfig,
  ProvisioningResult,
  ProvisionStep,
  AutoScaleState,
  ScaleMetricSnapshot,
  ScaleDecision,
  DatabaseInfo,
  TableInfo,
  ColumnInfo,
  ConnectionPoolStats,
  QueryResult,
} from "./one-click-provisioner.js"

// Kubernetes Operator & Managed Cloud
export {
  KubernetesOperator,
  ControlPlaneDashboard,
  GitHubIntegration,
  generateTenantTableSQL,
  generateGitHubConnectionTableSQL,
  buildInsertTenantSQL,
  buildQueryTenantsSQL,
} from "./kubernetes-operator.js"
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
} from "./kubernetes-operator.js"
