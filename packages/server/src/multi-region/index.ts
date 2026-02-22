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
