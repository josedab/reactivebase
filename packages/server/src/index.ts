// Schema
export { defineSchema, defineTable, v } from "./schema/index.js"
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
} from "./schema/index.js"
export { generateMigrationSQL } from "./schema/index.js"

// Functions
export { query, mutation, action } from "./functions/index.js"
export type {
  FunctionContext,
  RegisteredFunction,
  QueryOptions,
  MutationOptions,
  ActionOptions,
  SchedulerContext,
  LogContext,
} from "./functions/index.js"

// Auth
export {
  createAuthContext,
  jwtProvider,
  customProvider,
  tokenProvider,
  defineRlsPolicy,
  AuthenticationError,
  AuthorizationError,
} from "./auth/index.js"
export type { AuthContext, AuthProvider, JwtProviderOptions, RlsPolicy } from "./auth/index.js"

// Config
export { defineConfig } from "./config/index.js"
export type { ReactiveBaseConfig } from "./config/index.js"

// Server
export { createReactiveBaseServer } from "./server.js"
export type { ReactiveBaseServer } from "./server.js"

// Transport (for advanced usage)
export { TransportServer } from "./transport/index.js"
export type { ClientMessage, ServerMessage } from "./transport/index.js"

// Reactivity (for advanced usage)
export { ReactivityEngine } from "./reactivity/index.js"
export type { SubscriptionUpdate } from "./reactivity/index.js"
export {
  RowLevelTracker,
  BloomFilter,
  generateRowTrackingTableSQL,
  buildUpsertRowTrackingSQL,
  buildDeleteRowTrackingSQL,
  buildGetAffectedSubscriptionsSQL,
} from "./reactivity/index.js"
export type {
  RowLevelTrackerOptions,
  RowTrackingState,
  RowInvalidationResult,
  RowLevelStats,
} from "./reactivity/index.js"
export { EdgePrefetchCache } from "./reactivity/index.js"
export type { EdgePrefetchOptions, CachedQueryResult, EdgeCacheStats } from "./reactivity/index.js"

// Metrics
export { MetricsCollector } from "./metrics/index.js"
export { toPrometheusFormat } from "./metrics/index.js"
export { NoopTracer, ConsoleTracer, createOtelTracerAdapter, traced } from "./metrics/index.js"
export { PerformanceProfiler } from "./metrics/index.js"
export { OtelInstrumentation, createAutoInstrumentedTracer } from "./metrics/index.js"
export { RealtimeDashboard } from "./metrics/index.js"
export { AlertEngine, builtInRules } from "./metrics/index.js"
export type {
  MetricsSnapshot,
  ServerMetrics,
  QueryMetrics,
  MutationMetrics,
  SubscriptionMetrics,
  InvalidationMetrics,
  FunctionMetrics,
  Tracer,
  Span,
} from "./metrics/index.js"
export type {
  ProfilerOptions,
  SlowQueryEntry,
  NPlusOneDetection,
  SubscriptionFanout,
  QueryProfile,
  ProfilerAlert,
  AlertRule,
  ProfilerStats,
  GrafanaDashboard,
  GrafanaPanel,
} from "./metrics/index.js"
export type { OtelConfig, ConnectionPoolLike, InstrumentedResult } from "./metrics/index.js"
export type {
  SlowQueryEntry as DashboardSlowQueryEntry,
  SubscriptionHeatmapEntry as DashboardSubscriptionHeatmapEntry,
  ConnectionPoolMetrics,
  ErrorBreakdownEntry,
} from "./metrics/index.js"
export type {
  AlertRule as AlertEngineRule,
  Alert as MetricsAlert,
  AlertAction,
  AlertSeverity,
} from "./metrics/index.js"

// Embedded Postgres
export {
  EmbeddedPoolAdapter,
  EmbeddedClientAdapter,
  createEmbeddedPool,
  createAutoPool,
  isPGliteAvailable,
} from "./embedded/index.js"
export type { EmbeddedPoolOptions, PGliteLike } from "./embedded/index.js"

// Pub/Sub
export { RedisPubSubAdapter, InMemoryPubSubAdapter } from "./pubsub/index.js"
export type { PubSubAdapter, RedisPubSubOptions, RedisLike } from "./pubsub/index.js"

// Scheduler
export { JobScheduler, parseDelay, getNextCronRun } from "./scheduler/index.js"
export type { ScheduledJob, CronDefinition, SchedulerOptions } from "./scheduler/index.js"

// Middleware
export { MiddlewareManager } from "./middleware/index.js"

// Schema Migration Tools
export { convertPrismaToReactiveBase, parsePrismaSchema } from "./migrate-from/index.js"
export { convertDrizzleToReactiveBase, parseDrizzleSchema } from "./migrate-from/index.js"
export {
  MigrationWizard,
  discoverTrpcRoutes,
  discoverExpressRoutes,
  mapPrismaType,
  mapDrizzleType,
  analyzeFeatureGaps,
} from "./migrate-from/index.js"
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
} from "./migrate-from/index.js"

// Storage
export { LocalStorageBackend, S3StorageBackend, MemoryStorageBackend, createStorageContext } from "./storage/index.js"
export type { StorageBackend, StorageOptions, StorageContext, S3ClientLike } from "./storage/index.js"

// Webhooks
export {
  WebhookRegistry,
  OutboundWebhookManager,
  defineWebhook,
  parseNotifyPayload,
  generateNotifyTriggerSQL,
} from "./webhooks/index.js"
export type { WebhookDefinition, WebhookResult, OutboundWebhook } from "./webhooks/index.js"

// Event Streaming
export {
  EventStreamManager,
  KafkaStreamAdapter,
  NatsStreamAdapter,
  SqsStreamAdapter,
  generateEventStreamTableSQL,
  buildInsertDeadLetterSQL,
} from "./webhooks/index.js"
export type {
  EventStreamAdapter,
  StreamEvent,
  PublishResult,
  EventFilter,
  EventTransform,
  RetryPolicy,
  DeadLetterConfig,
  EventStreamManagerOptions,
  KafkaAdapterOptions,
  NatsAdapterOptions,
  SqsAdapterOptions,
} from "./webhooks/index.js"

// Presence & Collaboration
export {
  PresenceManager,
  buildIncrementSQL,
  buildArrayAppendSQL,
  buildArrayRemoveSQL,
  buildJsonMergeSQL,
} from "./presence/index.js"
export type { PresenceData, PresenceOptions, PresenceListener } from "./presence/index.js"

// Dashboard & Schema Visualizer
export {
  schemaToVisualModel,
  visualModelToCode,
  generateDashboardHTML,
  generateFullDashboardHTML,
  generateAdminPanelHTML,
  generateAdminRoutes,
} from "./dashboard/index.js"
export {
  DashboardV2Engine,
  generateDashboardV2HTML,
  generateDashboardV2TableSQL,
  buildInsertMutationLogSQL,
  buildQueryMutationLogSQL,
  buildUpdateQueryStatsSQL,
  buildDataBrowserQuerySQL,
} from "./dashboard/index.js"
export { AdminStudio, buildDataBrowserSQL, buildCountSQL } from "./dashboard/index.js"
export type {
  SchemaVisualModel,
  VisualTable,
  VisualColumn,
  VisualRelation,
  AdminPanelOptions,
  AdminRoute,
} from "./dashboard/index.js"
export type {
  QueryInspectorEntry,
  SubscriptionHeatmapEntry,
  DataBrowserOptions,
  DataBrowserFilter,
  DataBrowserResult,
  MutationReplayEntry,
  MutationReplayOptions,
  DashboardV2Metrics,
  DashboardV2Options,
} from "./dashboard/index.js"
export type {
  AdminStudioOptions,
  SchemaChange,
  MigrationPreview,
  DataBrowserQuery,
  DataBrowserFilterEntry,
  DataBrowserResponse,
  SubscriptionInspectorEntry,
  StudioMetricsSummary,
} from "./dashboard/index.js"

// Live Dashboard & Admin Panel
export {
  LiveDashboard,
  generateLiveDashboardTableSQL,
  buildInsertQueryLogSQL,
  buildInsertMutationTimelineSQL,
} from "./dashboard/index.js"
export type {
  LiveDashboardOptions,
  DashboardAuthConfig,
  QueryExecution,
  QuerySpan,
  MutationTimelineEntry,
  ActiveConnection,
  DashboardAlert,
  LiveDashboardMetrics,
  FlamechartData,
  FlamechartSpan,
  LiveAdminRoute,
} from "./dashboard/index.js"
export type {
  Middleware,
  MiddlewareContext,
  MiddlewareResult,
  BeforeHook,
  AfterHook,
  ErrorHook,
} from "./middleware/index.js"

// Permissions
export { roles, allow, enforceAccess } from "./permissions/index.js"
export type { AccessRule, RoleRule, CustomRule } from "./permissions/index.js"

// Code Generation
export { scanFunctions, generateApiModule, generateServerModule, generate } from "./codegen/index.js"
export {
  TypedCodegen,
  extractFunctionTypes,
  parseSchemaSource,
  generateTypedApiModule,
  generateTypedDbContext,
} from "./codegen/index.js"
export { RpcTypeGenerator, schemaToTypeScript, schemaToValidationCode } from "./codegen/index.js"
export type { ScannedFunction, GenerateResult } from "./codegen/index.js"
export type {
  TypedFunctionInfo,
  SchemaField,
  SchemaTable,
  ParsedSchema,
  TypedCodegenOptions,
  TypedGenerateResult,
  WatchEvent,
} from "./codegen/index.js"
export type {
  RpcFunctionDef,
  RpcSchema,
  RpcGenerateOutput,
  RpcClientSdkConfig,
  FileHashEntry,
} from "./codegen/index.js"

// Change Data Capture
export { CdcListener, ChangeEventBuffer, deduplicateEvents } from "./cdc/index.js"
export { ReactiveCdcAdapter } from "./cdc/index.js"
export { RowLevelCdcAdapter } from "./cdc/index.js"
export type { CdcOptions, CdcHandler, PgListenClient } from "./cdc/index.js"
export type { ReactiveCdcOptions, WalChangeEvent, CdcAdapterStats, ProcessChangesCallback } from "./cdc/index.js"
export type { RowChange, RowLevelBatch, RowLevelCdcStats, SubscriptionFilter } from "./cdc/index.js"

// Multi-Tenancy
export {
  createTenancyMiddleware,
  getTenantId,
  buildTenantFilter,
  generateTenantSchemaSQL,
  generateSetSchemaSQL,
  generateDropTenantSQL,
} from "./tenancy/index.js"
export { SaasKit, DEFAULT_PLANS, generateSaasTablesSQL } from "./tenancy/index.js"
export {
  TenantConnectionRouter,
  buildSetTenantContextSQL,
  buildCreateRlsPolicySQL,
  buildEnableRlsSQL,
} from "./tenancy/index.js"
export { StripeBillingProvider } from "./tenancy/index.js"
export { TenantAdminDashboard } from "./tenancy/index.js"
export type { TenancyConfig, TenantContext } from "./tenancy/index.js"
export type {
  SaasKitOptions,
  SaasPlan,
  SaasPlanLimits,
  SaasTenant,
  SaasTenantUsage,
  SaasBillingProvider,
  OnboardingConfig,
  PlanLimitCheck,
  SaasAdminOverview,
} from "./tenancy/index.js"
export type { TenantConnectionConfig, TenantConnection, TenantPoolStats } from "./tenancy/index.js"
export type { StripeConfig, StripeWebhookEvent, CheckoutSession, Invoice } from "./tenancy/index.js"
export type { TenantOverview, TenantDetail, RevenueSummary, TenantActivity } from "./tenancy/index.js"

// AI / RAG Pipeline
export { openaiProvider, ollamaProvider, mockAiProvider, createAiContext } from "./ai/index.js"
export type { AiProvider, AiContext, EmbedOptions, GenerateOptions, SearchOptions, SearchResult } from "./ai/index.js"

// REST/GraphQL API Generation
export { generateRestRoutes, matchRoute, parseQueryFilters, generateGraphQLSchema } from "./api-gen/index.js"
export type { RestApiOptions, RestRoute } from "./api-gen/index.js"
export {
  ApiGateway,
  generateApiKeyTableSQL,
  buildInsertApiKeySQL,
  buildValidateApiKeySQL,
  buildRevokeApiKeySQL,
  buildIncrementRequestCountSQL,
} from "./api-gen/index.js"
export { OpenApiGenerator } from "./api-gen/index.js"
export { GraphQLSchemaGenerator } from "./api-gen/index.js"
export { UnifiedGateway } from "./api-gen/index.js"
export type {
  ApiGatewayOptions,
  ApiKeyRecord,
  ApiPermission,
  ApiKeyValidationResult,
  OpenApiSpec,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiSchema,
  OpenApiSchemaRef,
  OpenApiSecurityScheme,
  GraphQLSubscriptionField,
  GatewayRoute,
  GatewayStats,
} from "./api-gen/index.js"
export type {
  OpenApi31Spec,
  OpenApi31PathItem,
  OpenApi31Operation,
  OpenApi31Schema,
  FunctionDescriptor,
  OpenApiGeneratorOptions,
} from "./api-gen/index.js"
export type {
  GatewayRequest,
  GatewayResponse,
  UnifiedGatewayOptions,
  GatewayRouteInfo,
  GatewayTransportStats,
} from "./api-gen/index.js"

// Validation & Rate Limiting
export { RateLimiter, RateLimitError, rateLimit } from "./validation/index.js"
export type { RateLimitOptions } from "./validation/index.js"
export { validateArgs, ValidationError, s, withValidation } from "./validation/index.js"
export type { ValidationSchema } from "./validation/index.js"

// Migration Manager
export { MigrationManager } from "./migrations/index.js"
export { diffSchema, generateDiffSQL, introspectionQueries } from "./migrations/index.js"
export { MigrationPlanner } from "./migrations/index.js"
export type {
  MigrationRecord,
  MigrationFile,
  ApplyResult,
  RollbackResult,
  MigrationStatus,
  DatabaseState,
  SchemaDiff,
} from "./migrations/index.js"
export type {
  MigrationSchemaChange,
  ChangeAnalysis,
  AnalyzedChange,
  SafeMigrationPlan,
  MigrationPhase,
  DryRunResult,
} from "./migrations/index.js"

// Type Inference Utilities
export { typedRef } from "./types/index.js"
export type {
  TypedFunctionReference,
  TypedDatabaseContext,
  TypedTableAccessor,
  TypedQueryResult,
  InferArgs,
  InferReturn,
  TypedApi,
  TableNames,
  TableRow,
} from "./types/index.js"

// Benchmark
export { bench, runSuite, formatResults, formatResultsJSON } from "./benchmark/index.js"
export { StressTestSuite } from "./benchmark/index.js"
export type { BenchmarkResult, BenchmarkSuite } from "./benchmark/index.js"
export type {
  StressTestOptions,
  StressTestThresholds,
  StressTestReport,
  StressTestPhase,
  ChaosTestResult,
  StressTestSummary,
} from "./benchmark/index.js"

// Plugins
export {
  definePlugin,
  PluginRegistry,
  clerkPlugin,
  stripePlugin,
  PluginRegistryClient,
  BUILTIN_PLUGINS,
} from "./plugins/index.js"
export {
  PluginMarketplace,
  PluginMarketplaceError,
  validatePluginConfig,
  MARKETPLACE_CATALOG,
} from "./plugins/index.js"
export {
  computePluginQualityScore,
  checkPluginCompatibility,
  generatePluginTemplate,
  resendPlugin,
  sentryPlugin,
  vercelPlugin,
  FIRST_PARTY_PLUGINS,
} from "./plugins/index.js"
export { PluginPortal } from "./plugins/index.js"
export { PluginSDK, PluginTestHarness, validateWithJSONSchema } from "./plugins/index.js"
export { s3StoragePlugin, posthogPlugin, ALL_BUILTIN_PLUGINS, BUILTIN_PLUGIN_METADATA } from "./plugins/index.js"
export { PluginCLI } from "./plugins/index.js"
export type { PluginDefinition, PluginContext, PluginManifest, RegistryEntry } from "./plugins/index.js"
export type {
  PluginV2Definition,
  PluginV2Instance,
  PluginV2Context,
  PluginCategory,
  ConfigField,
  MarketplaceEntry,
  MarketplaceSearchOptions,
} from "./plugins/index.js"
export type { PluginQualityInfo, PluginQualityScore, PluginCompatibility, PluginTemplate } from "./plugins/index.js"
export type {
  PortalPlugin,
  PluginCompatibilityStatus,
  CompatibilityMatrix,
  PluginScaffold,
  PortalStats,
} from "./plugins/index.js"
export type { PluginV2Config, PluginHook, PluginCLIConfig, CLIResult } from "./plugins/index.js"

// Cloud
export { CloudClient, CloudError, PLANS, REGIONS, generateDeployCommand, estimateMonthlyCost } from "./cloud/index.js"
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
} from "./cloud/index.js"

// Query Builder (for advanced usage)
export { QueryBuilder } from "./query-builder/index.js"
export type { BuiltQuery, QueryDependency } from "./query-builder/index.js"

// CRDT Engine
export {
  CrdtEngine,
  CrdtDocumentHandle,
  CrdtError,
  generateCrdtTableSQL,
  buildUpsertDocumentSQL,
  buildInsertOperationSQL,
  buildGetDocumentSQL,
  buildGetOperationsSinceSQL,
  buildCompactOperationsSQL,
} from "./crdt/index.js"
export type {
  CrdtOperation,
  CrdtType,
  CrdtDocument,
  CrdtEngineOptions,
  CrdtSnapshot,
  LwwRegisterOp,
  GCounterOp,
  PnCounterOp,
  OrSetOp,
  RgaOp,
} from "./crdt/index.js"

// Declarative Authorization (Zanzibar-style)
export {
  AuthzEngine,
  AuthzError,
  definePermissions,
  derived,
  computed,
  generateAuthzTableSQL,
  buildAddRelationSQL,
  buildRemoveRelationSQL,
  buildCheckRelationSQL,
  buildListRelationsSQL,
  buildListUserPermissionsSQL,
  permissionToWhereClause,
} from "./authz/index.js"
export type {
  PermissionSchema,
  ResourceDefinition,
  PermissionRule,
  DerivedPermission,
  ComputedPermission,
  AuthzCheckContext,
  AuthzRelationTuple,
  AuthzEvaluationResult,
  AuthzEngineOptions,
  PermissionConfig,
} from "./authz/index.js"

// Time-Travel Debugging
export {
  TimeTravelEngine,
  generateTimeTravelTableSQL,
  buildInsertEventSQL,
  buildGetEventsInRangeSQL,
  buildGetRowHistorySQL,
  buildPruneEventsSQL,
} from "./time-travel/index.js"
export type {
  MutationEvent,
  TimeTravelSnapshot,
  TimeTravelDiff,
  DiffEntry,
  TimeTravelOptions,
} from "./time-travel/index.js"

// Workflow Orchestration
export {
  WorkflowEngine,
  WorkflowContext,
  defineWorkflow,
  WorkflowError,
  WorkflowStepError,
  WorkflowWaitingError,
  WorkflowCancelledError,
  generateWorkflowTableSQL,
  buildInsertWorkflowSQL,
  buildUpdateWorkflowSQL,
  buildGetPendingWorkflowsSQL,
  buildGetWaitingWorkflowsSQL,
} from "./workflow/index.js"
export type {
  WorkflowDefinition,
  WorkflowOptions,
  WorkflowInstance,
  WorkflowStatus,
  StepRecord,
  StepStatus,
  StepOptions,
} from "./workflow/index.js"

// GraphQL Federation
export { generateFederatedSchema, generateResolverSkeleton, getSubscriptionMappings } from "./api-gen/federation.js"
export type { FederationOptions, FederatedSchema, SubscriptionMapping } from "./api-gen/federation.js"

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
} from "./materialized-views/index.js"
export { AnalyticsEngine, generateAnalyticsSQL } from "./materialized-views/index.js"
export type {
  MaterializedViewDefinition,
  MaterializedViewState,
  AggregationDef,
  RefreshStrategy,
  TimeBucket,
} from "./materialized-views/index.js"
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
} from "./materialized-views/index.js"

// Multi-Database Federation
export {
  DatabaseFederation,
  FederationError as DatabaseFederationError,
  buildHealthCheckSQL,
  buildPoolStatsSQL,
  buildDatabaseInfoSQL,
} from "./multi-db/index.js"
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
} from "./multi-db/index.js"
export type {
  DatabaseConfig,
  FederationConfig,
  DatabaseInfo,
  CrossDatabaseQuery,
  FederatedQueryResult,
} from "./multi-db/index.js"
export type {
  DatabaseAdapter,
  DatabaseDialect,
  TransactionHandle,
  DatabaseAdapterInfo,
  SQLTranslator,
  PostgresAdapterOptions,
  SQLiteAdapterOptions,
  MySQLAdapterOptions,
} from "./multi-db/index.js"

// Playground
export {
  PlaygroundEngine,
  PlaygroundError,
  generatePlaygroundHTML,
  generatePlaygroundTableSQL,
  buildSaveSessionSQL,
  buildLoadSessionSQL,
  buildListSessionsSQL,
  buildDeleteSessionSQL,
  PLAYGROUND_TEMPLATES,
  BUILTIN_TUTORIALS,
} from "./playground/index.js"
export { TutorialManager, INTERACTIVE_TUTORIALS } from "./playground/index.js"
export {
  LivePlaygroundEngine,
  encodeShareState,
  decodeShareState,
  generateLivePlaygroundHTML,
} from "./playground/index.js"
export { generateEmbeddableWidgetHTML, generateEmbedScript } from "./playground/index.js"
export { GuidedTutorialEngine, GUIDED_TUTORIALS } from "./playground/index.js"
export type {
  PlaygroundSession,
  ExecutionResult,
  TutorialDefinition,
  TutorialStep,
  PlaygroundOptions,
  PlaygroundContext,
  LogEntry,
  PlaygroundTemplate,
  PlaygroundHTMLOptions,
} from "./playground/index.js"
export type {
  InteractiveTutorial,
  TutorialStepDef,
  ValidationRule,
  StepValidationResult,
  PlaygroundShareState,
  ExportConfig,
  ExportResult,
} from "./playground/index.js"
export type { LivePlaygroundSession, ShareableState, PlaygroundWidget } from "./playground/index.js"
export type { GuidedTutorialDef, GuidedStepDef, GuidedTutorialSession, TutorialProgress } from "./playground/index.js"

// Horizontal Scaling
export { ConsistentHashRing, ClusterManager } from "./scaling/index.js"
export type {
  ClusterNode,
  ClusterManagerOptions,
  ClusterMessage,
  InvalidationBroadcast,
  SubscriptionRoute,
  ClusterStats,
  DrainResult,
} from "./scaling/index.js"
export { SubscriptionShardManager } from "./scaling/index.js"
export type {
  ShardInfo,
  ShardManagerOptions,
  MigrationBatch,
  ShardAssignment,
  ShardMigrationState,
  ShardMigrationError,
  ShardStats,
  ShardManagerNode,
} from "./scaling/index.js"

// E2E Encryption
export {
  EncryptionEngine,
  EncryptionError,
  localKeyProvider,
  rotatingKeyProvider,
  kmsKeyProvider,
  generateEncryptionTableSQL,
  buildInsertAuditSQL,
} from "./encryption/index.js"
export {
  ComplianceToolkit,
  generateAccessLogTableSQL,
  generateErasureRequestTableSQL,
  buildRetentionPruneSQL,
} from "./encryption/index.js"
export type {
  EncryptionEngineOptions,
  EncryptionMode,
  KeyProvider,
  EncryptedValue,
  FieldEncryptionConfig,
  EncryptionStats,
} from "./encryption/index.js"
export type {
  PiiDetection,
  PiiType,
  AccessLogEntry,
  RetentionPolicy,
  ErasureRequest,
  ComplianceReport,
  ComplianceSection,
  ComplianceToolkitOptions,
} from "./encryption/index.js"

// Vault & GCP KMS Key Providers
export { vaultKeyProvider, gcpKmsKeyProvider, VaultError } from "./encryption/index.js"
export type {
  VaultKeyProviderOptions,
  VaultKeyInfo,
  VaultKeyProvider,
  GcpKmsKeyProviderOptions,
} from "./encryption/index.js"

// AI Query Assistant
export { QueryAssistant } from "./ai-assistant/index.js"
export { SchemaGenerator } from "./ai-assistant/index.js"
export { QueryBuilderAssistant } from "./ai-assistant/index.js"
export { MigrationCopilot } from "./ai-assistant/index.js"
export type {
  QueryAssistantOptions,
  AiProviderAdapter,
  SchemaInfo,
  QueryGenerationResult,
  SchemaOptimization,
  QueryExplanation,
  AccessPattern,
} from "./ai-assistant/index.js"
export type { SchemaGenerationResult, SchemaAntiPattern } from "./ai-assistant/index.js"
export type { CompletionItem, ExplainPlanAnalysis, QueryOptimization } from "./ai-assistant/index.js"
export type {
  MigrationAnalysis,
  MigrationSafetyCheck,
  IndexOptimization,
  MigrationImpact as AiMigrationImpact,
  RollbackPlan,
} from "./ai-assistant/index.js"

// Logical Replication
export {
  LogicalReplicator,
  WalDecoder,
  ChangeBatcher,
  parseLsn,
  formatLsn,
  compareLsn,
} from "./logical-replication/index.js"
export type {
  LogicalReplicatorOptions,
  ReplicatorStatus,
  WalChange,
  WalColumnInfo,
  ReplicationSlotInfo,
  ReplicationStats as LogicalReplicationStats,
  ChangeHandler,
} from "./logical-replication/index.js"

// Cloud Platform
export { CloudPlatform } from "./cloud-platform/index.js"
export { CloudProvisioner, generatePreviewEnvTableSQL, generateCustomDomainTableSQL } from "./cloud-platform/index.js"
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
} from "./cloud-platform/index.js"
export type {
  PreviewEnvironmentConfig,
  PreviewEnvironment,
  DeployManifest,
  ProvisioningStep,
  ProvisioningPipeline,
  CustomDomain,
  EnvironmentPromotion,
  LogStreamOptions,
} from "./cloud-platform/index.js"

// Cloud Observability
export {
  CloudObservability,
  generateObservabilityTableSQL,
  buildInsertMetricSQL,
  buildQueryMetricsSQL,
  buildInsertAlertSQL,
} from "./cloud-platform/index.js"
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
} from "./cloud-platform/index.js"

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
} from "./cloud-platform/index.js"
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
} from "./cloud-platform/index.js"

// Type Bridge (E2E Type Safety)
export { TypeBridge } from "./type-bridge/index.js"
export type {
  TypeManifest,
  FunctionSignature,
  TypeDescriptor,
  PrimitiveType,
  ObjectType,
  TypeProperty,
  ArrayType,
  UnionType,
  LiteralType,
  ReferenceType,
  VoidType,
  TableTypeInfo,
  ColumnTypeInfo as TypeBridgeColumnTypeInfo,
  TypeBridgeOptions,
  TypedFunctionReference as BridgedFunctionReference,
  ExtractArgs,
  ExtractReturn,
  ExtractKind,
  ScannedFunction as BridgeScannedFunction,
  ScannedTable,
  ManifestValidation,
} from "./type-bridge/index.js"

// Collaboration Primitives
export { CollaborationManager } from "./collaboration/index.js"
export { createCollabContext } from "./collaboration/index.js"
export type { CollabContextOptions, CollabText, CollabList, CollabMap, CollabCounter } from "./collaboration/index.js"
export {
  DocumentCollaboration,
  generateCollabDocTableSQL,
  buildInsertDocumentSQL,
  buildInsertUpdateSQL,
} from "./collaboration/index.js"
export {
  writeVarUint,
  readVarUint,
  writeVarBytes,
  readVarBytes,
  writeVarString,
  readVarString,
  encodeStateVector,
  decodeStateVector,
  encodeUpdate,
  decodeUpdate,
  createSyncStep1,
  createSyncStep2,
  createUpdateMessage,
  parseSyncMessage,
  encodeAwarenessUpdate,
  decodeAwarenessUpdate,
  mergeUpdates,
  computeMissingUpdates,
  computeStateDiff,
  hashClientId,
  YjsSyncMessageType,
  YjsAwarenessMessageType,
} from "./collaboration/index.js"
export type {
  CursorPosition,
  SelectionRange,
  UserAwareness,
  RoomAwarenessState,
  CollaborationOptions,
  AwarenessListener,
} from "./collaboration/index.js"
export type {
  CollaborativeDocument,
  DocumentType,
  DocumentUpdate,
  DocumentSnapshot,
  UndoEntry,
  DocumentAwareness,
  DocumentCollaborationOptions,
  DocumentStats,
} from "./collaboration/index.js"
export type {
  StateVector,
  YjsUpdate,
  SyncMessage,
  AwarenessMessage,
  AwarenessClientState,
  MergeResult,
} from "./collaboration/index.js"

// SQL Playground
export { SqlPlayground } from "./sql-playground/index.js"
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
} from "./sql-playground/index.js"

// Declarative Access Control Language (DACL)
export { DaclEngine, PolicyBuilder, allow as daclAllow, deny as daclDeny } from "./dacl/index.js"
export type {
  Action as DaclAction,
  PolicyDefinition,
  PolicyCondition,
  PolicyCheckContext,
  PolicyCheckResult,
  PolicyTestCase,
  PolicyTestResult,
  PolicyAuditEntry,
  RlsPolicy as DaclRlsPolicy,
  DaclEngineOptions,
  PolicyCoverageItem,
  PolicyCoverageReport,
} from "./dacl/index.js"

// Incremental View Maintenance (IVM)
export { IncrementalViewMaintainer, extractDependencies, isIvmEligible, evaluatePredicate } from "./ivm/index.js"
export {
  DeltaPatchEncoder,
  DeltaPatchDecoder,
  PatchAccumulator,
  encodeDeltaPatch,
  decodeDeltaPatch,
} from "./ivm/index.js"
export { IvmPipeline } from "./ivm/index.js"
export type {
  QueryAstNode,
  ScanNode,
  FilterNode,
  ProjectNode,
  JoinNode,
  AggregateNode,
  SortNode,
  LimitNode,
  FilterPredicate,
  AggregationSpec,
  Row,
  DataChange,
  ViewDelta,
  RegisteredView,
  IvmStats,
} from "./ivm/index.js"
export type { DeltaPatch, DeltaPatchStats } from "./ivm/index.js"
export type { PipelineStats, PipelineResult } from "./ivm/index.js"

// Multi-Region Active-Active
export {
  RegionManager,
  RegionRouter,
  mergeVectorClocks,
  incrementClock,
  happenedBefore,
  areConcurrent,
} from "./multi-region/index.js"
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
} from "./multi-region/index.js"

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
} from "./branching/index.js"
export { NeonBranchingAdapter, NeonBranchingError } from "./branching/index.js"
export { generateGitHubActionYAML, PRPreviewManager } from "./branching/index.js"
export { BranchDashboard } from "./branching/index.js"
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
} from "./branching/index.js"
export type { NeonConfig, NeonBranch, NeonEndpoint } from "./branching/index.js"
export type { PreviewConfig, PreviewRecord } from "./branching/index.js"
export type { BranchTreeNode } from "./branching/index.js"

// Schema Designer
export { SchemaDesigner } from "./schema-designer/index.js"
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
} from "./schema-designer/index.js"

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
} from "./edge-query/index.js"
export type {
  EdgeRegion,
  EdgeCacheEntry,
  InvalidationMessage,
  EdgeQueryOptions,
  EdgeQueryLayerOptions,
  EdgeCacheStats as EdgeQueryCacheStats,
  ConsistencyProof,
} from "./edge-query/index.js"

// Multiplayer Collaboration Kit
export {
  MultiplayerKit,
  CrdtDocument as MultiplayerCrdtDocument,
  PresenceTracker,
  CursorManager,
  MultiplayerError,
  incrementVectorClock,
  mergeVectorClocks as mergeMultiplayerClocks,
  buildCreateMultiplayerTablesSQL,
  buildInsertRoomSQL,
  buildUpsertPermissionSQL,
  buildGetPermissionSQL,
  buildInsertOperationSQL as buildInsertMpOperationSQL,
  buildGetOperationsSinceSQL as buildGetMpOperationsSinceSQL,
} from "./multiplayer/index.js"
export type {
  MultiplayerUser,
  CursorPosition as MultiplayerCursorPosition,
  PresenceState,
  SelectionRange as MultiplayerSelectionRange,
  MultiplayerPermission,
  MultiplayerRoom,
  MultiplayerEvent,
  CrdtOperation as MultiplayerCrdtOperation,
  MultiplayerKitOptions,
  RoomStats,
} from "./multiplayer/index.js"

// Declarative Authorization (Zanzibar)
export {
  ZanzibarEngine,
  ZanzibarError,
  buildCreateZanzibarTablesSQL,
  buildWriteTupleSQL,
  buildDeleteTupleSQL,
  buildReadTuplesSQL,
  buildListObjectsSQL as buildZanzibarListObjectsSQL,
  buildReverseExpandSQL,
  buildLogChangeSQL,
} from "./zanzibar/index.js"
export type {
  RelationTuple,
  NamespaceConfig,
  RelationRule,
  RelationRef,
  CheckRequest,
  CheckResult,
  ResolutionStep,
  ExpandResult,
  UsersetTree,
  ListObjectsRequest,
  ZanzibarOptions,
  ZanzibarStats,
} from "./zanzibar/index.js"

// Visual Workflow Studio
export {
  WorkflowStudio,
  WorkflowValidator,
  WorkflowDebugger,
  WorkflowStudioError,
  builtInTemplates,
  buildCreateWorkflowStudioTablesSQL,
  buildUpsertDesignSQL,
  buildGetDesignSQL,
  buildInsertExecutionSQL as buildInsertWfExecutionSQL,
  buildUpdateExecutionSQL as buildUpdateWfExecutionSQL,
  buildInsertDebugSnapshotSQL,
} from "./workflow-studio/index.js"
export type {
  WorkflowNode,
  WorkflowNodeType,
  PortDefinition,
  WorkflowEdge,
  WorkflowDesign,
  WorkflowVariable,
  WorkflowTemplate,
  WorkflowExecution,
  NodeExecutionState,
  DebugBreakpoint,
  DebugSnapshot,
  WorkflowStudioOptions,
  ValidationError as WorkflowValidationError,
  MonitoringSnapshot,
} from "./workflow-studio/index.js"

// Event Sourcing & CQRS
export {
  EventStore,
  ProjectionEngine,
  EventSourcingError,
  buildCreateEventStoreTablesSQL,
  buildAppendEventSQL,
  buildGetEventsSQL as buildGetEsEventsSQL,
  buildGetEventsByFilterSQL,
  buildUpsertStreamSQL,
  buildSaveSnapshotSQL,
  buildGetLatestSnapshotSQL,
  buildUpsertProjectionSQL,
} from "./event-sourcing/index.js"
export type {
  DomainEvent,
  EventMetadata,
  EventStream,
  Snapshot,
  Projection,
  ProjectionState,
  EventFilter as EventSourcingFilter,
  EventStoreOptions,
  AppendResult,
  ReplaySession,
  CommandHandler,
  ReadModel,
  EventStoreStats,
} from "./event-sourcing/index.js"

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
} from "./analytics/index.js"
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
} from "./analytics/index.js"

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
} from "./time-travel/index.js"
export type { AuditEntry, AuditFilter, AuditTrailOptions, TimelineEntry } from "./time-travel/index.js"

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
} from "./schema-registry/index.js"
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
} from "./schema-registry/index.js"

// Reactive File & Media Pipeline
export {
  MediaPipeline,
  TransformBuilder,
  ReactiveUrlBuilder,
  UploadValidator,
  MediaPipelineError,
  transformPresets,
  buildCreateMediaTablesSQL,
  buildInsertFileSQL,
  buildGetFileSQL,
  buildListFilesSQL,
  buildInsertVariantSQL,
  buildGetVariantsSQL,
  buildDeleteFileSQL,
} from "./media-pipeline/index.js"
export type {
  MediaFile,
  MediaMetadata,
  MediaVariant,
  ImageTransform,
  VideoTransform,
  WatermarkConfig,
  UploadOptions,
  UploadResult,
  CdnConfig,
  SignedUrlOptions,
  MediaPipelineOptions,
  MediaPipelineStats,
} from "./media-pipeline/index.js"

// Cross-Framework Universal SDK
export { UniversalSdk, ProtocolBuilder, UniversalSdkError } from "./universal-sdk/index.js"
export type {
  ProtocolSpec,
  EndpointSpec,
  TypeSpec,
  FieldSpec,
  TypeRef,
  EnumTypeSpec,
  ErrorSpec,
  AuthSpec,
  TargetLanguage,
  CodegenOptions,
  GeneratedFile,
  GenerationResult,
  UniversalSdkOptions,
} from "./universal-sdk/index.js"

// Webhook Delivery Queue & Integration Bus
export {
  WebhookDeliveryQueue,
  WebhookSimulator,
  WebhookDeliveryError,
  webhookTemplates,
  generateDeliveryQueueTableSQL,
  createDeliveryQueue,
  createWebhookSimulator,
} from "./webhooks/index.js"
export type {
  DeliveryRecord,
  DeliveryStatus,
  DeliveryQueueOptions,
  DeliveryMetrics,
  WebhookTemplate,
  SimulatedDelivery,
} from "./webhooks/index.js"

// Reactive Stored Procedures
export {
  StoredProcedureRegistry,
  ProcedureBuilder,
  ProcedureCompileError,
  compileProcedure,
  defineProcedure,
  defineRawProcedure,
  createProcedureRegistry,
} from "./stored-procedures/index.js"
export type {
  ProcedureDefinition,
  ProcedureParam,
  ProcedureBody,
  ProcedureStatement,
  PgParamType,
  PgReturnType,
  StoredProcedureRegistryOptions,
} from "./stored-procedures/index.js"

// Zero-Downtime Safe Migrations
export {
  MigrationAnalyzer,
  SafeMigrationExecutor,
  SafeMigrationError,
  UnsafeMigrationError,
  createMigrationAnalyzer,
  createSafeMigrationExecutor,
} from "./safe-migrations/index.js"
export type {
  MigrationSafety,
  OperationType,
  SchemaOperation,
  MigrationPlan as ExpandContractPlan,
  MigrationImpact,
  MigrationPhase as ExpandContractPhase,
  MigrationExecutionState,
  ExpandContractOptions,
} from "./safe-migrations/index.js"

// Reactive Permissions Debugger
export {
  PermissionsDebugger,
  TraceRingBuffer,
  AuthDebugDashboard,
  AuthDebugError,
  createPermissionsDebugger,
  createAuthDebugDashboard,
} from "./auth-debugger/index.js"
export type {
  DebugTraceEntry,
  PermissionsDebugResult,
  AuthDebugOptions,
  RlsPolicyInfo,
  ZanzibarTupleInfo,
  AuthDebugDashboardData,
} from "./auth-debugger/index.js"

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
} from "./smart-pool/index.js"
export type { SmartPoolOptions, CoalescedQuery, PoolStats, BatchEvaluatorOptions } from "./smart-pool/index.js"

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
} from "./seeding/index.js"
export type {
  SeedDefinition,
  SeedProfile,
  SeedContext,
  SeedEnvironment,
  SeedRecord,
  SeedExecutionResult,
  SeedStatus,
  FakeDataGenerators,
} from "./seeding/index.js"

// Reactive Rate Limiting & Usage Metering
export {
  RateLimitEngine,
  SlidingWindowLimiter,
  TokenBucketLimiter,
  UsageMeter,
  AdvancedRateLimitError,
  createRateLimitEngine,
  createUsageMeter,
} from "./rate-limiting/index.js"
export type {
  RateLimitRule,
  RateLimitContext,
  RateLimitResult,
  RateLimitAlgorithm,
  RateLimitScope,
  UsageMetrics,
  TenantUsage,
  FunctionUsage,
  UsageAlert,
  UsageAlertRule,
} from "./rate-limiting/index.js"

// Postgres Extension Auto-Provisioner
export {
  ExtensionDetector,
  createExtensionDetector,
} from "./extensions/index.js"
export type {
  PgExtensionInfo,
  CloudProvider,
  ExtensionDetectionResult,
  ExtensionProvisionOptions,
} from "./extensions/index.js"

// Subscription Analytics & Cost Attribution
export {
  SubscriptionAnalytics,
  createSubscriptionAnalytics,
} from "./subscription-analytics/index.js"
export type {
  SubscriptionCostRecord,
  CostAttribution,
  QueryCostSummary,
  UserCostSummary,
  TenantCostSummary,
  CostTotals,
  OptimizationSuggestion,
  InvalidationTrigger,
  SubscriptionAnalyticsOptions,
} from "./subscription-analytics/index.js"

// Reactive Full-Text Search
export {
  SearchQueryBuilder,
  SearchError,
  generateSearchIndexSQL,
  generateFacetSQL,
  createSearchQuery,
  searchTable,
} from "./full-text-search/index.js"
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
} from "./full-text-search/index.js"
