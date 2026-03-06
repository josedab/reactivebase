// Reactivity (for advanced usage)
export { ReactivityEngine } from "../reactivity/index.js"
export type { SubscriptionUpdate } from "../reactivity/index.js"
export {
  RowLevelTracker,
  BloomFilter,
  AutoLevelTracker,
  QueryPrimaryKeyCapture,
  generateRowTrackingTableSQL,
  buildUpsertRowTrackingSQL,
  buildDeleteRowTrackingSQL,
  buildGetAffectedSubscriptionsSQL,
  buildGetTableStatsSQL,
} from "../reactivity/index.js"
export type {
  RowLevelTrackerOptions,
  RowTrackingState,
  RowInvalidationResult,
  RowLevelStats,
  TrackingLevel,
  LevelDecision,
  AutoLevelTrackerOptions,
} from "../reactivity/index.js"
export { EdgePrefetchCache } from "../reactivity/index.js"
export type { EdgePrefetchOptions, CachedQueryResult, EdgeCacheStats } from "../reactivity/index.js"

// Change Data Capture
export { CdcListener, ChangeEventBuffer, deduplicateEvents } from "../cdc/index.js"
export { ReactiveCdcAdapter } from "../cdc/index.js"
export { RowLevelCdcAdapter } from "../cdc/index.js"
export type { CdcOptions, CdcHandler, PgListenClient } from "../cdc/index.js"
export type { ReactiveCdcOptions, WalChangeEvent, CdcAdapterStats, ProcessChangesCallback } from "../cdc/index.js"
export type { RowChange, RowLevelBatch, RowLevelCdcStats, SubscriptionFilter } from "../cdc/index.js"

// Logical Replication
export {
  LogicalReplicator,
  WalDecoder,
  ChangeBatcher,
  parseLsn,
  formatLsn,
  compareLsn,
} from "../logical-replication/index.js"
export type {
  LogicalReplicatorOptions,
  ReplicatorStatus,
  WalChange,
  WalColumnInfo,
  ReplicationSlotInfo,
  ReplicationStats as LogicalReplicationStats,
  ChangeHandler,
} from "../logical-replication/index.js"

// Incremental View Maintenance (IVM)
export { IncrementalViewMaintainer, extractDependencies, isIvmEligible, evaluatePredicate } from "../ivm/index.js"
export {
  DeltaPatchEncoder,
  DeltaPatchDecoder,
  PatchAccumulator,
  encodeDeltaPatch,
  decodeDeltaPatch,
} from "../ivm/index.js"
export { IvmPipeline } from "../ivm/index.js"
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
} from "../ivm/index.js"
export type { DeltaPatch, DeltaPatchStats } from "../ivm/index.js"
export type { PipelineStats, PipelineResult } from "../ivm/index.js"

// Subscription Analytics & Cost Attribution
export { SubscriptionAnalytics, createSubscriptionAnalytics } from "../subscription-analytics/index.js"
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
} from "../subscription-analytics/index.js"

// Reactive Computed Tables
export {
  ComputedTableEngine,
  ComputedTableError,
  buildCreateComputedTableSQL,
  buildRefreshComputedTableSQL,
  buildDropComputedTableSQL,
  buildCreateTriggerSQL,
  buildCreateMetadataTableSQL,
  buildUpsertMetadataSQL,
  defineComputedAggregation,
  defineComputedJoin,
  defineComputedTable,
  ReactiveComputedTableEngine,
  buildComputedTableQuery,
  buildComputedTableQuerySQL,
  buildReactiveRefreshTriggerSQL,
  createComputedTableSubscription,
} from "../computed-tables/index.js"
export type {
  ComputedTableDefinition,
  ComputedRefreshStrategy,
  ComputedIndexDef,
  ComputedColumnDef,
  ComputedTableState,
  DependencyGraph,
  ComputedRefreshResult,
  ComputedTableStats,
  ReactiveComputedTableDefinition,
  ComputedTableChangeEvent,
  ComputedTableSubscription,
  ComputedTableQueryContext,
  SubscriptionFilter as ComputedSubscriptionFilter,
  IncrementalUpdateResult,
} from "../computed-tables/index.js"
