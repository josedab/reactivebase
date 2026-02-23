export {
  MaterializedViewEngine,
  defineMaterializedView,
  generateMaterializedViewSQL,
  generateRefreshSQL,
  generateDropViewSQL,
  generateViewIndexSQL,
  generateUniqueIndexSQL,
  generateTimeBucketSQL,
} from "./materialized-views.js"
export type {
  MaterializedViewDefinition,
  MaterializedViewState,
  AggregationDef,
  RefreshStrategy,
  TimeBucket,
} from "./materialized-views.js"

// Real-Time Analytics Engine
export { AnalyticsEngine, generateAnalyticsSQL } from "./analytics-engine.js"
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
} from "./analytics-engine.js"
