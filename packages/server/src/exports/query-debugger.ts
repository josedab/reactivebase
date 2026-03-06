// Query Debugger: live dependency graphs, invalidation traces, profiling
export { QueryDebugger } from "../query-debugger/index.js"
export type {
  DebugEventType,
  DebugEvent,
  DependencyEdge,
  InvalidationChain,
  SubscriptionProfile,
  BottleneckReport,
  DebuggerOptions,
  DebugEventHandler,
} from "../query-debugger/index.js"

// Visual Debugger: trace instrumentation, browser dashboard, smart suggestions
export { TraceInstrumentation, VisualDebugger, SmartSuggestionEngine } from "../query-debugger/index.js"
export type {
  TraceSpan as DebuggerTraceSpan,
  TraceEvent as DebuggerTraceEvent,
  DependencyNode,
  DependencyLink,
  FlamegraphNode,
  SuggestionSeverity,
  OptimizationSuggestion as DebuggerOptimizationSuggestion,
  NPlusOnePattern,
  OverBroadSubscription,
  SlowChain,
  VisualDebuggerOptions,
} from "../query-debugger/index.js"
