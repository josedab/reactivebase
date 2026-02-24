export {
  EdgeQueryLayer,
  EdgeQueryCache,
  InvalidationPropagator,
  ConsistencyManager,
  EdgeQueryError,
  buildCreateEdgeCacheTableSQL,
  buildCreateInvalidationLogTableSQL,
  buildUpsertCacheEntrySQL,
  buildGetCacheEntrySQL,
  buildInvalidateByTablesSQL,
  buildInsertInvalidationSQL,
  buildGetPendingInvalidationsSQL,
  buildMarkInvalidationsProcessedSQL,
} from "./edge-query.js"

export type {
  EdgeRegion,
  EdgeCacheEntry,
  InvalidationMessage,
  EdgeQueryOptions,
  EdgeQueryLayerOptions,
  EdgeCacheStats,
  ConsistencyProof,
} from "./edge-query.js"
