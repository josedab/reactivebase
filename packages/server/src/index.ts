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

// Metrics
export { MetricsCollector } from "./metrics/index.js"
export { toPrometheusFormat } from "./metrics/index.js"
export { NoopTracer, ConsoleTracer, createOtelTracerAdapter, traced } from "./metrics/index.js"
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

// Embedded Postgres
export { EmbeddedPoolAdapter, EmbeddedClientAdapter, createEmbeddedPool, createAutoPool, isPGliteAvailable } from "./embedded/index.js"
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

// Storage
export {
  LocalStorageBackend,
  S3StorageBackend,
  MemoryStorageBackend,
  createStorageContext,
} from "./storage/index.js"
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
export { schemaToVisualModel, visualModelToCode, generateDashboardHTML, generateFullDashboardHTML, generateAdminPanelHTML, generateAdminRoutes } from "./dashboard/index.js"
export type { SchemaVisualModel, VisualTable, VisualColumn, VisualRelation, AdminPanelOptions, AdminRoute } from "./dashboard/index.js"
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
export type { ScannedFunction, GenerateResult } from "./codegen/index.js"

// Change Data Capture
export { CdcListener, ChangeEventBuffer, deduplicateEvents } from "./cdc/index.js"
export type { CdcOptions, CdcHandler, PgListenClient } from "./cdc/index.js"

// Multi-Tenancy
export {
  createTenancyMiddleware,
  getTenantId,
  buildTenantFilter,
  generateTenantSchemaSQL,
  generateSetSchemaSQL,
  generateDropTenantSQL,
} from "./tenancy/index.js"
export type { TenancyConfig, TenantContext } from "./tenancy/index.js"

// AI / RAG Pipeline
export { openaiProvider, ollamaProvider, mockAiProvider, createAiContext } from "./ai/index.js"
export type { AiProvider, AiContext, EmbedOptions, GenerateOptions, SearchOptions, SearchResult } from "./ai/index.js"

// REST/GraphQL API Generation
export { generateRestRoutes, matchRoute, parseQueryFilters, generateGraphQLSchema } from "./api-gen/index.js"
export type { RestApiOptions, RestRoute } from "./api-gen/index.js"

// Validation & Rate Limiting
export { RateLimiter, RateLimitError, rateLimit } from "./validation/index.js"
export type { RateLimitOptions } from "./validation/index.js"
export { validateArgs, ValidationError, s, withValidation } from "./validation/index.js"
export type { ValidationSchema } from "./validation/index.js"

// Migration Manager
export { MigrationManager } from "./migrations/index.js"
export { diffSchema, generateDiffSQL, introspectionQueries } from "./migrations/index.js"
export type { MigrationRecord, MigrationFile, ApplyResult, RollbackResult, MigrationStatus, DatabaseState, SchemaDiff } from "./migrations/index.js"

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
export type { BenchmarkResult, BenchmarkSuite } from "./benchmark/index.js"

// Plugins
export { definePlugin, PluginRegistry, clerkPlugin, stripePlugin, PluginRegistryClient, BUILTIN_PLUGINS } from "./plugins/index.js"
export type { PluginDefinition, PluginContext, PluginManifest, RegistryEntry } from "./plugins/index.js"

// Cloud
export { CloudClient, CloudError, PLANS, generateDeployCommand } from "./cloud/index.js"
export type { CloudConfig, CloudProject, CloudPlan } from "./cloud/index.js"

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
export {
  generateFederatedSchema,
  generateResolverSkeleton,
  getSubscriptionMappings,
} from "./api-gen/federation.js"
export type {
  FederationOptions,
  FederatedSchema,
  SubscriptionMapping,
} from "./api-gen/federation.js"

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
export type {
  MaterializedViewDefinition,
  MaterializedViewState,
  AggregationDef,
  RefreshStrategy,
  TimeBucket,
} from "./materialized-views/index.js"

// Multi-Database Federation
export {
  DatabaseFederation,
  FederationError as DatabaseFederationError,
  buildHealthCheckSQL,
  buildPoolStatsSQL,
  buildDatabaseInfoSQL,
} from "./multi-db/index.js"
export type {
  DatabaseConfig,
  FederationConfig,
  DatabaseInfo,
  CrossDatabaseQuery,
  FederatedQueryResult,
} from "./multi-db/index.js"
