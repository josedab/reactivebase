/** @module @reactivebase/client - Framework-agnostic client SDK */

/** WebSocket connection manager with automatic reconnection */
export { ConnectionManager } from "./connection/index.js"
export type { ConnectionOptions, ConnectionStatus } from "./connection/index.js"

/** Query result cache with TTL and invalidation support */
export { QueryCache } from "./cache/index.js"
export type { CacheEntry } from "./cache/index.js"

/** Core client: manages subscriptions, multiplexes queries over WebSocket */
export { ReactiveBaseClient } from "./subscription/index.js"
export type { ReactiveBaseClientOptions, SubscriptionHandle, QueryListener } from "./subscription/index.js"

/** Client-side subscription middleware: logging, retry, analytics */
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

/** Binary protocol encoding/decoding for WebSocket messages */
export { encodeMessage, decodeMessage, isBinaryMessage, compressionRatio } from "./protocol/index.js"

/** Multi-tab coordination: leader election and cross-tab cache sharing */
export { MultiTabCoordinator } from "./multitab/index.js"
export type { TabMessage, TabRole, BroadcastChannelLike } from "./multitab/index.js"

/** Offline support: persistent cache, mutation queue, sync engine */
export { PersistentCache, MutationQueue, SyncManager, MemoryOfflineStorage } from "./offline/index.js"
export type { OfflineStorage, OfflineOptions, PendingMutation, CachedQuery, SyncResult } from "./offline/index.js"
/** Offline sync with vector clocks for conflict detection */
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

/** SQLite-backed cache adapter for offline persistence */
export { SQLiteCacheAdapter, generateCacheTableSQL } from "./offline/index.js"
export type { SQLiteAdapter, SQLiteCacheOptions, CacheMetadata } from "./offline/index.js"

/** Conflict resolution strategies for offline mutations */
export { ConflictResolver } from "./offline/index.js"
export type { ConflictStrategyType, Conflict, ConflictResolutionConfig, ConflictLogEntry } from "./offline/index.js"

/** Background sync with connectivity awareness and priority queuing */
export { BackgroundSyncManager } from "./offline/index.js"
export type {
  BackgroundSyncStatus,
  SyncState,
  ConnectivityAwarePrimitive,
  BackgroundSyncOptions,
  PriorityMutation,
} from "./offline/index.js"

/** Local-first sync engine with CRDT-based bidirectional sync */
export { LocalFirstSyncEngine, BidirectionalSyncProtocol, WriteAheadLog } from "./offline/index.js"
export type {
  LocalFirstSyncOptions,
  LocalFirstSyncStatus,
  SchemaDefinition,
  TableDefinition,
  ColumnDefinition,
  IndexDefinition,
  WriteAheadEntry,
  SyncProtocolMessage,
  SyncChange,
  BandwidthConfig,
  LocalQuery,
  SyncConnection,
} from "./offline/index.js"

/** Optimistic updates: instant UI feedback with server reconciliation */
export { OptimisticUpdateManager } from "./optimistic/index.js"
export type {
  OptimisticUpdate,
  OptimisticSnapshot,
  OptimisticManagerOptions,
  ConflictInfo,
  ConflictResolver as OptimisticConflictResolver,
  OptimisticCacheAdapter,
} from "./optimistic/index.js"

/** DevTools instrumentation: subscription tracking, cache stats, performance */
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

/** Reactive Query Composition: subscribe to derived/combined/transformed queries */
export { subscribeDerived, subscribeTransformed } from "./composition/index.js"
export type { DerivedSubscriptionHandle, ComposedQueryOptions } from "./composition/index.js"

/** Shared component utilities for framework UI packages */
export {
  sortData,
  toggleSort,
  paginate,
  clampPage,
  validateFields,
  computePresenceVisibility,
} from "./composition/index.js"
export type { FormField, PresenceUser } from "./composition/index.js"

/** Session Resumption: stateful reconnect without re-subscribing */
export { SessionResumeManager } from "./session/index.js"
export type { SessionResumeOptions, SessionState, ResumeHandler } from "./session/index.js"
