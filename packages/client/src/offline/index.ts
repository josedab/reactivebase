export { PersistentCache, MutationQueue, SyncManager, MemoryOfflineStorage } from "./offline.js"
export type { OfflineStorage, OfflineOptions, PendingMutation, CachedQuery, SyncResult } from "./offline.js"

// Advanced Sync Engine
export {
  OfflineSyncEngine,
  createVectorClock,
  incrementClock,
  mergeClock,
  happensBefore,
  areConcurrent,
  clocksEqual,
} from "./sync-engine.js"
export type {
  SyncEngineOptions,
  ConflictStrategy,
  MergeFunction,
  VectorClock,
  SyncStatus,
  SyncConflict,
  SyncBatchResult,
  VersionedValue,
  DeltaChange,
} from "./sync-engine.js"
