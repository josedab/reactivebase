export { IncrementalViewMaintainer, extractDependencies, isIvmEligible, evaluatePredicate } from "./ivm.js"

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

// Delta Patch Protocol
export {
  DeltaPatchEncoder,
  DeltaPatchDecoder,
  PatchAccumulator,
  encodeDeltaPatch,
  decodeDeltaPatch,
  computeChecksum,
} from "./delta-protocol.js"
export type { DeltaPatch, DeltaPatchStats } from "./delta-protocol.js"

// IVM Pipeline
export { IvmPipeline } from "./ivm-pipeline.js"
export type { PipelineStats, PipelineResult } from "./ivm-pipeline.js"
