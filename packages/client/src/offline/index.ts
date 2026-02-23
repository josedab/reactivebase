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

// SQLite Cache
export { SQLiteCacheAdapter, generateCacheTableSQL } from "./sqlite-cache.js"
export type { SQLiteAdapter, SQLiteCacheOptions, CacheMetadata } from "./sqlite-cache.js"

// Conflict Resolver
export { ConflictResolver } from "./conflict-resolver.js"
export type { ConflictStrategyType, Conflict, ConflictResolutionConfig, ConflictLogEntry } from "./conflict-resolver.js"

// Background Sync
export { BackgroundSyncManager } from "./background-sync.js"
export type {
  SyncStatus as BackgroundSyncStatus,
  SyncState,
  ConnectivityAwarePrimitive,
  BackgroundSyncOptions,
  PriorityMutation,
} from "./background-sync.js"
