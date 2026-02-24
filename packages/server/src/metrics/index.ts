export { MetricsCollector } from "./metrics.js"
export type {
  MetricsSnapshot,
  ServerMetrics,
  QueryMetrics,
  MutationMetrics,
  SubscriptionMetrics,
  InvalidationMetrics,
  FunctionMetrics,
} from "./metrics.js"

export { toPrometheusFormat } from "./prometheus.js"

export { NoopTracer, ConsoleTracer, createOtelTracerAdapter, traced } from "./tracing.js"
export type { Tracer, Span, OtelTracerLike, OtelSpanLike } from "./tracing.js"

// Performance Profiler
export { PerformanceProfiler } from "./performance-profiler.js"
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
} from "./performance-profiler.js"

// OTel Instrumentation
export { OtelInstrumentation, createAutoInstrumentedTracer } from "./otel-instrumentation.js"
export type { OtelConfig, ConnectionPoolLike, InstrumentedResult } from "./otel-instrumentation.js"

// Realtime Dashboard
export { RealtimeDashboard } from "./realtime-dashboard.js"
export type {
  SlowQueryEntry as DashboardSlowQueryEntry,
  SubscriptionHeatmapEntry,
  ConnectionPoolMetrics,
  ErrorBreakdownEntry,
} from "./realtime-dashboard.js"

// Alert Engine
export { AlertEngine, builtInRules } from "./alert-engine.js"
export type { AlertRule as AlertEngineRule, Alert, AlertAction, AlertSeverity } from "./alert-engine.js"

// Performance Advisor
export {
  PerformanceAdvisor,
  buildUnusedIndexesSQL,
  buildTableSeqScanSQL,
  buildIndexSuggestionsSQL,
} from "./performance-advisor.js"
export type {
  AdvisorOptions,
  QueryRecord,
  InvalidationRecord,
  IndexUsageRecord,
  Recommendation,
  RecommendationType,
  RecommendationSeverity,
  AdvisorReport,
} from "./performance-advisor.js"
