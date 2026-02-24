export { MigrationManager } from "./migration-manager.js"
export type {
  MigrationRecord,
  MigrationFile,
  ApplyResult,
  RollbackResult,
  MigrationStatus,
} from "./migration-manager.js"

export { diffSchema, generateDiffSQL, introspectionQueries } from "./schema-diff.js"
export type { DatabaseColumn, DatabaseIndex, DatabaseState, SchemaDiff } from "./schema-diff.js"

// Zero-Downtime Migration Planner
export { MigrationPlanner } from "./migration-planner.js"
export type {
  SchemaChange as MigrationSchemaChange,
  ChangeAnalysis,
  AnalyzedChange,
  SafeMigrationPlan,
  MigrationPhase,
  MigrationStep as PlannerMigrationStep,
  DryRunResult,
} from "./migration-planner.js"

// Live Migration Previews (Shadow Execution)
export { MigrationPreview } from "./shadow-preview.js"
export type {
  MigrationPreviewOptions,
  MigrationPreviewRequest,
  MigrationPreviewReport,
  RecentQuery,
  QueryReplayResult,
  BreakingChange,
  PerformanceRegression,
  IndexRecommendation,
} from "./shadow-preview.js"
