export {
  AnalyticsEngine,
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
} from "./analytics.js"

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
} from "./analytics.js"

// Embedded Analytics Query Engine
export { EmbeddedAnalyticsQueryEngine, AnalyticsQueryError } from "./embedded-analytics-query.js"

export type {
  TimeSeriesQuery,
  TimeBucket as AnalyticsTimeBucket,
  MetricDefinition,
  FilterCondition,
  TimeRange,
  FunnelQuery,
  FunnelStep,
  FunnelResult,
  RetentionQuery,
  TopNQuery,
  AnalyticsQueryResult,
} from "./embedded-analytics-query.js"
