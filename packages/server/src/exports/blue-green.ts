// Blue-Green Deployments: zero-downtime, canary rollout, auto-rollback
export { DeploymentCoordinator, VersionRouter, SubscriptionMigrator } from "../blue-green/index.js"
export type {
  DeploymentPhase,
  VersionStatus,
  ServerVersion,
  BlueGreenDeploymentConfig,
  VersionRoute,
  DeploymentState,
  DeploymentError,
  RollbackReason,
  SubscriptionMigration,
  DeploymentEventHandler,
} from "../blue-green/index.js"

// Schema Versioning & Traffic Splitting
export { SchemaVersionRegistry, SchemaVersionError } from "../blue-green/index.js"
export type {
  SchemaVersion as BlueGreenSchemaVersion,
  SchemaVersionStatus,
  SchemaVersionSchema,
  TrafficSplitConfig,
  TrafficOverride,
  VersionNegotiationResult,
  CanaryConfig,
  CanaryState,
  MigrationPlan as BlueGreenMigrationPlan,
  MigrationStep as BlueGreenMigrationStep,
  RegistryStats as BlueGreenRegistryStats,
} from "../blue-green/index.js"
