export {
  IncrementalViewMaintainer,
  extractDependencies,
  isIvmEligible,
  evaluatePredicate,
} from "./ivm.js"

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
} from "./ivm.js"
