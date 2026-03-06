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
} from "./computed-tables.js"

export type {
  ComputedTableDefinition,
  RefreshStrategy as ComputedRefreshStrategy,
  ComputedIndexDef,
  ComputedColumnDef,
  ComputedTableState,
  DependencyGraph,
  RefreshResult as ComputedRefreshResult,
  ComputedTableStats,
} from "./computed-tables.js"

// Reactive Computed Tables
export {
  defineComputedTable,
  ReactiveComputedTableEngine,
  buildComputedTableQuery,
  buildComputedTableQuerySQL,
  buildReactiveRefreshTriggerSQL,
  createComputedTableSubscription,
} from "./reactive-computed-tables.js"

export type {
  ReactiveComputedTableDefinition,
  ComputedTableChangeEvent,
  ComputedTableSubscription,
  ComputedTableQueryContext,
  SubscriptionFilter,
  IncrementalUpdateResult,
} from "./reactive-computed-tables.js"
