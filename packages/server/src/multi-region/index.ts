export {
  RegionManager,
  RegionRouter,
  mergeVectorClocks,
  incrementClock,
  happenedBefore,
  areConcurrent,
} from "./multi-region.js"

export type {
  RegionConfig,
  RegionManagerOptions,
  ConflictStrategy,
  RegionTopology,
  RegionStatus,
  ReplicationEvent,
  VectorClock,
  ReplicationConflict,
  ConflictHandler,
  RegionRoutingDecision,
  ReplicationStats,
} from "./multi-region.js"

// Geo-Distributed Conflict Resolution
export {
  ConflictResolver,
  PartitionTester,
  formatConflictReport,
} from "./conflict-resolution.js"
export type {
  ConflictStrategyType,
  ConflictRecord,
  VersionedRow,
  MergeFunction,
  OperationalTransform,
  Operation,
  ResolutionResult,
  FieldConflict,
  ConflictResolverOptions,
  PartitionConfig,
  PartitionTestResult,
  PartitionEvent,
} from "./conflict-resolution.js"
