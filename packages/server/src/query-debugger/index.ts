export { QueryDebugger } from "./query-debugger.js"
export type {
  DebugEventType,
  DebugEvent,
  DependencyEdge,
  InvalidationChain,
  SubscriptionProfile,
  BottleneckReport,
  DebuggerOptions,
  DebugEventHandler,
} from "./query-debugger.js"

export { TraceInstrumentation, VisualDebugger, SmartSuggestionEngine } from "./visual-debugger.js"
export type {
  TraceSpan,
  TraceEvent,
  DependencyNode,
  DependencyLink,
  FlamegraphNode,
  SuggestionSeverity,
  OptimizationSuggestion,
  NPlusOnePattern,
  OverBroadSubscription,
  SlowChain,
  VisualDebuggerOptions,
} from "./visual-debugger.js"
