export { ConnectionManager } from "./connection/index.js"
export type { ConnectionOptions, ConnectionStatus } from "./connection/index.js"

export { QueryCache } from "./cache/index.js"
export type { CacheEntry } from "./cache/index.js"

export { ReactiveBaseClient } from "./subscription/index.js"
export type { ReactiveBaseClientOptions, SubscriptionHandle, QueryListener } from "./subscription/index.js"

// Client Subscription Middleware
export {
  ClientMiddlewarePipeline,
  loggingMiddleware,
  retryMiddleware,
  analyticsMiddleware,
} from "./subscription/index.js"
export type {
  ClientSubscriptionMiddleware,
  SubscriptionEvent,
  SubscriptionUpdateEvent,
  SubscriptionErrorEvent,
  SubscriptionStaleEvent,
  SubscriptionReconnectEvent,
  AnalyticsMetric,
} from "./subscription/index.js"

export { encodeMessage, decodeMessage, isBinaryMessage, compressionRatio } from "./protocol/index.js"

export { MultiTabCoordinator } from "./multitab/index.js"
export type { TabMessage, TabRole, BroadcastChannelLike } from "./multitab/index.js"

export { PersistentCache, MutationQueue, SyncManager, MemoryOfflineStorage } from "./offline/index.js"
export type { OfflineStorage, OfflineOptions, PendingMutation, CachedQuery, SyncResult } from "./offline/index.js"
export {
  OfflineSyncEngine,
  createVectorClock,
  incrementClock,
  mergeClock,
  happensBefore,
  areConcurrent,
  clocksEqual,
} from "./offline/index.js"
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
} from "./offline/index.js"

// SQLite Cache
export { SQLiteCacheAdapter, generateCacheTableSQL } from "./offline/index.js"
export type { SQLiteAdapter, SQLiteCacheOptions, CacheMetadata } from "./offline/index.js"

// Conflict Resolver
export { ConflictResolver } from "./offline/index.js"
export type { ConflictStrategyType, Conflict, ConflictResolutionConfig, ConflictLogEntry } from "./offline/index.js"

// Background Sync
export { BackgroundSyncManager } from "./offline/index.js"
export type {
  BackgroundSyncStatus,
  SyncState,
  ConnectivityAwarePrimitive,
  BackgroundSyncOptions,
  PriorityMutation,
} from "./offline/index.js"

// Optimistic Updates
export { OptimisticUpdateManager } from "./optimistic/index.js"
export type {
  OptimisticUpdate,
  OptimisticSnapshot,
  OptimisticManagerOptions,
  ConflictInfo,
  ConflictResolver as OptimisticConflictResolver,
  OptimisticCacheAdapter,
} from "./optimistic/index.js"

// DevTools Instrumentation
export { DevToolsInstrumentation } from "./devtools/index.js"
export type {
  DevToolsEvent,
  DevToolsEventType,
  SubscriptionInfo,
  MutationInfo,
  CacheStats,
  WebSocketStats,
  PerformanceSnapshot,
  DevToolsEventHandler,
  DevToolsOptions,
  DevToolsSummary,
} from "./devtools/index.js"
