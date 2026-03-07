export {
  DatabaseBranching,
  BranchingError,
  generateBranchTableSQL,
  buildCreateBranchSchemaSQL,
  buildDropBranchSchemaSQL,
  buildSetSearchPathSQL,
  buildCopyTableSchemaSQL,
  buildCopyTableDataSQL,
  buildListTablesInSchemaSQL,
  buildInsertBranchSQL,
  generateBranchCLIUsage,
} from "./branching.js"

export type {
  DatabaseBranchingOptions,
  BranchStrategy,
  BranchRecord,
  BranchDiff,
  SchemaChange as BranchSchemaChange,
  DataChange,
  BranchConflict,
  SeedDataConfig,
  GitHubPRConfig,
  QueryExecutor,
} from "./branching.js"

export { NeonBranchingAdapter, NeonBranchingError } from "./neon-branching.js"

export type { NeonConfig, NeonBranch, NeonEndpoint } from "./neon-branching.js"

export {
  generateGitHubActionYAML,
  PRPreviewManager,
  PreviewError,
  generateMigrationPreviewStep,
} from "./github-action.js"

export type { PreviewConfig, PreviewRecord } from "./github-action.js"

export { BranchDashboard } from "./branch-dashboard.js"

export type { BranchTreeNode, DashboardBranching, DashboardPreviewSource } from "./branch-dashboard.js"

// Preview Environment Manager
export {
  PreviewEnvironmentManager,
  PreviewEnvironmentError,
  buildCreatePreviewEnvTableSQL,
  buildUpsertPreviewEnvSQL,
  buildGetExpiredPreviewsSQL,
  buildDeletePreviewEnvSQL,
} from "./preview-environment.js"

export type {
  PreviewEnvironmentOptions,
  PreviewTrigger,
  PreviewEnvironment,
  PreviewEnvStatus,
  MigrationApplyStatus,
  HealthStatus,
  CreatePreviewRequest,
  PreviewEnvironmentStats,
} from "./preview-environment.js"

// Git-like Branch Engine
export { BranchEngine, BranchEngineError } from "./branch-engine.js"
export type {
  BranchEngineOptions,
  BranchInfo,
  BranchStatus,
  MergeStrategy,
  BranchCreateOptions,
  BranchSeedConfig,
  BranchMergeOptions,
  BranchMergeResult,
  BranchConflictInfo,
  BranchLogEntry,
  BranchProtectionRule,
  BranchEngineStats,
} from "./branch-engine.js"
