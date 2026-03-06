# ADR-009: Offline-First Sync Protocol

## Status

Accepted

## Context

The React Native SDK (`@reactivebase/react-native`) must support offline-first operation for mobile applications where network connectivity is intermittent. Key requirements:

1. Queries must return cached data when offline
2. Mutations must be queued locally and replayed when connectivity is restored
3. Conflicts between local mutations and server state must be resolved deterministically
4. The sync protocol must handle partial sync (some mutations succeed, some fail)

## Decision

We implement a three-layer offline sync protocol in `packages/react-native/src/`:

- **OfflineQueryCache** — an LRU cache backed by device storage (SQLite, MMKV, or AsyncStorage via the `OfflineStorage` interface). Queries are served from cache when offline, with configurable TTL and max entry limits. Stale entries are evicted on access.

- **MutationQueue** — mutations performed while offline are persisted to device storage as an ordered queue. Each mutation records its name, arguments, timestamp, and retry count. On reconnect, the `SyncEngine` replays mutations in FIFO order.

- **SyncEngine** — manages network state transitions (`online` → `offline` → `reconnecting`) and orchestrates mutation replay. Features:
  - Exponential backoff for reconnection (base interval × 1.5^attempt, capped at 30s)
  - Batched mutation replay (configurable `syncBatchSize`, default 10)
  - Per-mutation error handling — failed mutations are retried up to `maxRetries` (default 3), then marked as permanently failed
  - Event callbacks for status changes, sync progress, and conflicts

- **Conflict resolution** — four strategies:
  - `last-write-wins` (default) — server state always wins
  - `client-wins` — local mutation is re-applied over server state
  - `server-wins` — local mutation is discarded
  - `custom` — user-provided `ConflictResolver` function receives both versions and the original mutation

## Consequences

### Positive

- Users experience instant UI updates even when offline — mutations are applied optimistically
- The `OfflineStorage` interface is adapter-agnostic, supporting SQLite, MMKV, or AsyncStorage
- Batched replay prevents overwhelming the server on reconnect
- Configurable conflict strategies accommodate different application semantics

### Negative

- Optimistic updates may show data that is later rolled back on sync failure
- The mutation queue grows unboundedly while offline — long offline periods may accumulate significant pending mutations
- Custom conflict resolvers add complexity and are difficult to test exhaustively
- FIFO replay may produce incorrect results if mutations have ordering dependencies
