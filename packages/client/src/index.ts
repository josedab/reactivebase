export { ConnectionManager } from "./connection/index.js"
export type { ConnectionOptions, ConnectionStatus } from "./connection/index.js"

export { QueryCache } from "./cache/index.js"
export type { CacheEntry } from "./cache/index.js"

export { ReactiveBaseClient } from "./subscription/index.js"
export type { ReactiveBaseClientOptions, SubscriptionHandle, QueryListener } from "./subscription/index.js"

export { encodeMessage, decodeMessage, isBinaryMessage, compressionRatio } from "./protocol/index.js"

export { MultiTabCoordinator } from "./multitab/index.js"
export type { TabMessage, TabRole, BroadcastChannelLike } from "./multitab/index.js"

export { PersistentCache, MutationQueue, SyncManager, MemoryOfflineStorage } from "./offline/index.js"
export type { OfflineStorage, OfflineOptions, PendingMutation, CachedQuery, SyncResult } from "./offline/index.js"
