// Schema
export { defineSchema, defineTable, v } from "../schema/index.js"
export type {
  Schema,
  SchemaDefinition,
  InferSchemaTypes,
  TableDefinition,
  ColumnDefinitions,
  InferRow,
  Validator,
  ValidatorType,
  ValidatorOptions,
  IndexDefinition,
  RelationDefinition,
  Migration,
} from "../schema/index.js"
export { generateMigrationSQL } from "../schema/index.js"

// Schema Migration Tools
export { convertPrismaToReactiveBase, parsePrismaSchema } from "../migrate-from/index.js"
export { convertDrizzleToReactiveBase, parseDrizzleSchema } from "../migrate-from/index.js"
export {
  MigrationWizard,
  discoverTrpcRoutes,
  discoverExpressRoutes,
  mapPrismaType,
  mapDrizzleType,
  analyzeFeatureGaps,
} from "../migrate-from/index.js"
export type {
  ProjectAnalysis,
  MigrationTable,
  MigrationField,
  MigrationPlan,
  MigrationStep,
  MigrationDiff,
  DiscoveredRoute,
  MigrationWarning,
  FeatureGap,
} from "../migrate-from/index.js"

// Migration Manager
export { MigrationManager } from "../migrations/index.js"
export { diffSchema, generateDiffSQL, introspectionQueries } from "../migrations/index.js"
export { MigrationPlanner } from "../migrations/index.js"
export type {
  MigrationRecord,
  MigrationFile,
  ApplyResult,
  RollbackResult,
  MigrationStatus,
  DatabaseState,
  SchemaDiff,
} from "../migrations/index.js"
export type {
  MigrationSchemaChange,
  ChangeAnalysis,
  AnalyzedChange,
  SafeMigrationPlan,
  MigrationPhase,
  DryRunResult,
} from "../migrations/index.js"

// Migration Safety Net
export { MigrationSafetyNet, MigrationSafetyError } from "../migrations/index.js"
export type {
  MigrationSafetyOptions,
  MigrationValidator,
  ValidationContext,
  IssueSeverity,
  ValidationIssue,
  MigrationSafetyReport,
  BreakingChangeInfo,
  BreakingChangeType as SafetyBreakingChangeType,
  LockAnalysis,
  DataLossRisk,
  ImpactedObject,
} from "../migrations/index.js"

// Schema Designer
export { SchemaDesigner } from "../schema-designer/index.js"
export type {
  SchemaDesignerOptions,
  ERModel,
  ERNode,
  ERColumn,
  EREdge,
  ERStats,
  SchemaChangeProposal,
  MigrationImpact as SchemaDesignerMigrationImpact,
  CodeGenerationResult,
} from "../schema-designer/index.js"

// Schema Registry & Consumer-Driven Contracts
export {
  SchemaRegistry,
  BreakingChangeDetector,
  ContractValidator,
  MigrationSafetyChecker,
  SchemaRegistryError,
  computeFingerprint,
  buildCreateSchemaRegistryTablesSQL,
  buildInsertVersionSQL,
  buildGetVersionSQL,
  buildGetLatestVersionSQL,
  buildUpsertContractSQL,
  buildGetContractsByStatusSQL,
} from "../schema-registry/index.js"
export type {
  SchemaVersion,
  SchemaSpec,
  TableSpec,
  ColumnSpec,
  IndexSpec as SchemaIndexSpec,
  ConstraintSpec,
  EnumSpec,
  ConsumerContract,
  RequiredTable,
  RequiredColumn,
  BreakingChange,
  BreakingChangeType,
  CompatibilityResult,
  MigrationSafetyCheck as SchemaRegistryMigrationSafetyCheck,
  MigrationRisk,
  SchemaRegistryOptions,
  RegistryStats,
} from "../schema-registry/index.js"

// Live Migration Validator
export { LiveMigrationValidator, MigrationCIReporter, MigrationValidationError } from "../migrations/index.js"
export type {
  MigrationAnalysisResult,
  LiveBreakingChange,
  LockEstimate,
  RollbackPlan,
  ShadowExecutionResult,
  CIReportOptions,
  TableStats,
  ShadowDatabase,
} from "../migrations/index.js"

// Zero-Downtime Safe Migrations
export {
  MigrationAnalyzer,
  SafeMigrationExecutor,
  SafeMigrationError,
  UnsafeMigrationError,
  createMigrationAnalyzer,
  createSafeMigrationExecutor,
} from "../safe-migrations/index.js"
export type {
  MigrationSafety,
  OperationType,
  SchemaOperation,
  MigrationPlan as ExpandContractPlan,
  MigrationImpact,
  MigrationPhase as ExpandContractPhase,
  MigrationExecutionState,
  ExpandContractOptions,
} from "../safe-migrations/index.js"
