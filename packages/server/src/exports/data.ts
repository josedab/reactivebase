// Multi-Model Query Interface
export {
  MultiModelQueryBuilder,
  RelationalQueryBuilder,
  DocumentQueryBuilder,
  GraphQueryBuilder,
  MultiModelError,
} from "../multi-model/index.js"
export type {
  MultiModelQueryResult,
  RelationalJoin,
  WhereCondition,
  OrderByClause,
  DocumentMatch,
  GraphTraversal,
} from "../multi-model/index.js"

// Embedded Postgres
export {
  EmbeddedPoolAdapter,
  EmbeddedClientAdapter,
  createEmbeddedPool,
  createAutoPool,
  isPGliteAvailable,
} from "../embedded/index.js"
export type { EmbeddedPoolOptions, PGliteLike } from "../embedded/index.js"

// Storage
export { LocalStorageBackend, S3StorageBackend, MemoryStorageBackend, createStorageContext } from "../storage/index.js"
export type { StorageBackend, StorageOptions, StorageContext, S3ClientLike } from "../storage/index.js"

// Query Builder (for advanced usage)
export { QueryBuilder } from "../query-builder/index.js"
export type { BuiltQuery, QueryDependency } from "../query-builder/index.js"

// Time-Travel Debugging
export {
  TimeTravelEngine,
  generateTimeTravelTableSQL,
  buildInsertEventSQL,
  buildGetEventsInRangeSQL,
  buildGetRowHistorySQL,
  buildPruneEventsSQL,
} from "../time-travel/index.js"
export type {
  MutationEvent,
  TimeTravelSnapshot,
  TimeTravelDiff,
  DiffEntry,
  TimeTravelOptions,
} from "../time-travel/index.js"

// Reactive Materialized Views
export {
  MaterializedViewEngine,
  defineMaterializedView,
  generateMaterializedViewSQL,
  generateRefreshSQL,
  generateDropViewSQL,
  generateViewIndexSQL,
  generateUniqueIndexSQL,
  generateTimeBucketSQL,
} from "../materialized-views/index.js"
export { AnalyticsEngine, generateAnalyticsSQL } from "../materialized-views/index.js"
export type {
  MaterializedViewDefinition,
  MaterializedViewState,
  AggregationDef,
  RefreshStrategy,
  TimeBucket,
} from "../materialized-views/index.js"
export type {
  AnalyticsMetricDef,
  AggregationType,
  TimeBucketSize,
  AnalyticsQueryOptions,
  AnalyticsResult,
  TimeSeriesPoint,
  AnalyticsDimensionResult,
  AnalyticsSubscription,
  AnalyticsEngineStats,
} from "../materialized-views/index.js"

// Multi-Database Federation
export {
  DatabaseFederation,
  FederationError as DatabaseFederationError,
  buildHealthCheckSQL,
  buildPoolStatsSQL,
  buildDatabaseInfoSQL,
} from "../multi-db/index.js"
export {
  createPostgresAdapter,
  createSQLiteAdapter,
  createMySQLAdapter,
  postgresTranslator,
  sqliteTranslator,
  mysqlTranslator,
  getTranslator,
  translateColumnType,
  translateCreateTable,
  DatabaseAdapterError,
} from "../multi-db/index.js"
export type {
  DatabaseConfig,
  FederationConfig,
  DatabaseInfo,
  CrossDatabaseQuery,
  FederatedQueryResult,
} from "../multi-db/index.js"
export type {
  DatabaseAdapter,
  DatabaseDialect,
  TransactionHandle,
  DatabaseAdapterInfo,
  SQLTranslator,
  PostgresAdapterOptions,
  SQLiteAdapterOptions,
  MySQLAdapterOptions,
} from "../multi-db/index.js"

// NoSQL Adapters, Federated Query Planner, Reactivity Bridge
export {
  MongoDBAdapter,
  MongoDBCdcAdapter,
  createMongoDBAdapter,
  DynamoDBAdapter,
  DynamoDBStreamsAdapter,
  createDynamoDBAdapter,
  FederatedQueryPlanner,
  ReactivityBridge,
} from "../multi-db/index.js"
export type {
  MongoDBAdapterConfig,
  DynamoDBAdapterConfig,
  FederatedQuery,
  QueryPlan as FederatedQueryPlan,
  QueryPlanStep,
  FederatedJoinCondition,
  CrossSourceChange,
  ReactivityBridgeOptions,
} from "../multi-db/index.js"

// SQL Playground
export { SqlPlayground } from "../sql-playground/index.js"
export type {
  SqlPlaygroundOptions,
  QueryResult,
  QueryPlan,
  PlanNode,
  IndexSuggestion,
  AiQueryProvider,
  AiQueryResult,
  QueryHistoryEntry,
  QueryAnalysis,
  SchemaInfo as PlaygroundSchemaInfo,
} from "../sql-playground/index.js"

// Database Branching
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
} from "../branching/index.js"
export { NeonBranchingAdapter, NeonBranchingError } from "../branching/index.js"
export { generateGitHubActionYAML, PRPreviewManager } from "../branching/index.js"
export { BranchDashboard } from "../branching/index.js"
export {
  PreviewEnvironmentManager,
  PreviewEnvironmentError,
  buildCreatePreviewEnvTableSQL,
  buildUpsertPreviewEnvSQL,
  buildGetExpiredPreviewsSQL,
  buildDeletePreviewEnvSQL,
} from "../branching/index.js"

export type {
  DatabaseBranchingOptions,
  BranchStrategy,
  BranchRecord,
  BranchDiff,
  BranchSchemaChange,
  DataChange as BranchDataChange,
  BranchConflict,
  SeedDataConfig,
  GitHubPRConfig,
} from "../branching/index.js"
export type { NeonConfig, NeonBranch, NeonEndpoint } from "../branching/index.js"
export type { PreviewConfig, PreviewRecord } from "../branching/index.js"
export type { BranchTreeNode } from "../branching/index.js"
export type {
  PreviewEnvironmentOptions,
  PreviewTrigger,
  PreviewEnvironment,
  PreviewEnvStatus,
  MigrationApplyStatus,
  HealthStatus,
  CreatePreviewRequest,
  PreviewEnvironmentStats,
} from "../branching/index.js"

// Embedded Analytics & Materialized Dashboards
export {
  AnalyticsEngine as EmbeddedAnalyticsEngine,
  AggregationEngine,
  AnalyticsError,
  compilePipelineToSQL,
  generateEmbedToken,
  generateEmbedSnippet,
  buildCreateAnalyticsTablesSQL,
  buildUpsertPipelineSQL,
  buildUpsertResultSQL,
  buildGetResultSQL,
  buildUpsertDashboardSQL,
  buildGetDashboardSQL,
} from "../analytics/index.js"
export type {
  AggregationPipeline,
  AggregationStage,
  MatchStage,
  GroupStage,
  SortStage,
  LimitStage,
  ProjectStage,
  WindowStage,
  AggregationFunction,
  WindowFunction,
  CronSchedule,
  MaterializedResult,
  DashboardDefinition,
  DashboardWidget,
  WidgetType,
  WidgetConfig,
  Threshold,
  LayoutConfig,
  EmbedConfig,
  AnalyticsOptions,
  AnalyticsStats,
} from "../analytics/index.js"
export { EmbeddedAnalyticsQueryEngine, AnalyticsQueryError } from "../analytics/index.js"

// Time-Travel Debugging & Audit (extended)
export {
  AuditTrail,
  TemporalQuery,
  TimelineBuilder,
  generateAuditTableSQL,
  buildInsertAuditSQL as buildInsertAuditEntrySQL,
  buildQueryAuditSQL,
  buildTemporalQuerySQL,
  buildTemporalRangeQuerySQL,
  buildEnableTemporalSQL,
} from "../time-travel/index.js"
export type { AuditEntry, AuditFilter, AuditTrailOptions, TimelineEntry } from "../time-travel/index.js"

// Reactive Stored Procedures
export {
  StoredProcedureRegistry,
  ProcedureBuilder,
  ProcedureCompileError,
  compileProcedure,
  defineProcedure,
  defineRawProcedure,
  createProcedureRegistry,
} from "../stored-procedures/index.js"
export type {
  ProcedureDefinition,
  ProcedureParam,
  ProcedureBody,
  ProcedureStatement,
  PgParamType,
  PgReturnType,
  StoredProcedureRegistryOptions,
} from "../stored-procedures/index.js"

// Smart Connection Pooling & Query Coalescing
export {
  SmartPool,
  QueryDeduplicator,
  AdaptivePoolSizer,
  SubscriptionCoalescer,
  BatchInvalidationEvaluator,
  BackpressureError,
  PoolExhaustedError,
  createSmartPool,
  createQueryDeduplicator,
  createSubscriptionCoalescer,
} from "../smart-pool/index.js"
export type { SmartPoolOptions, CoalescedQuery, PoolStats, BatchEvaluatorOptions } from "../smart-pool/index.js"

// Data Seeding & Fixtures
export {
  SeedRegistry,
  SeedError,
  SeedDependencyError,
  SeedCycleError,
  defineSeed,
  defineSeedProfile,
  createSeedRegistry,
  generateSeedTrackingTableSQL,
} from "../seeding/index.js"
export type {
  SeedDefinition,
  SeedProfile,
  SeedContext,
  SeedEnvironment,
  SeedRecord,
  SeedExecutionResult,
  SeedStatus,
  FakeDataGenerators,
} from "../seeding/index.js"

// Postgres Extension Auto-Provisioner
export { ExtensionDetector, createExtensionDetector } from "../extensions/index.js"
export type {
  PgExtensionInfo,
  CloudProvider,
  ExtensionDetectionResult,
  ExtensionProvisionOptions,
} from "../extensions/index.js"

// Reactive Full-Text Search
export {
  SearchQueryBuilder,
  SearchError,
  generateSearchIndexSQL,
  generateFacetSQL,
  createSearchQuery,
  searchTable,
} from "../full-text-search/index.js"
export type {
  SearchableColumnConfig,
  SearchOptions as FullTextSearchOptions,
  FuzzySearchOptions,
  HighlightOptions,
  FacetConfig,
  FacetResult,
  SearchResult as FullTextSearchResult,
  SearchIndexDefinition,
  SearchQueryPlan,
  SearchLanguage,
  FuzzyMatchType,
  SearchRankFunction,
  SearchableValidatorOptions,
} from "../full-text-search/index.js"
