---
sidebar_position: 11
---

# React Native & Offline-First

*Estimated time: 15 minutes*

The `@reactivebase/react-native` package provides an offline-first SDK for React Native apps. It extends the same `useQuery`/`useMutation` API from `@reactivebase/react` with SQLite-backed caching, a mutation queue with replay-on-reconnect, and configurable conflict resolution.

## Installation

```bash
npm install @reactivebase/react-native
```

## Provider Setup

Wrap your app with the ReactiveBase provider, passing an offline storage adapter:

```tsx
import { ReactiveBaseProvider } from "@reactivebase/react-native"
import { sqliteAdapter } from "./storage" // Your storage implementation

export default function App() {
  return (
    <ReactiveBaseProvider
      url="wss://api.example.com"
      offlineStorage={sqliteAdapter}
    >
      <MainApp />
    </ReactiveBaseProvider>
  )
}
```

## Offline Storage Adapters

The `OfflineStorage` interface is a simple key-value store that any persistence layer can implement:

```typescript
import type { OfflineStorage } from "@reactivebase/react-native"

interface OfflineStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  getAllKeys(): Promise<string[]>
  clear(): Promise<void>
}
```

### SQLite Adapter Example

```typescript
import * as SQLite from "expo-sqlite"
import type { OfflineStorage } from "@reactivebase/react-native"

const db = SQLite.openDatabase("reactivebase.db")

export const sqliteAdapter: OfflineStorage = {
  async get(key) {
    const result = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM kv_store WHERE key = ?", [key]
    )
    return result?.value ?? null
  },
  async set(key, value) {
    await db.runAsync(
      "INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)", [key, value]
    )
  },
  async delete(key) {
    await db.runAsync("DELETE FROM kv_store WHERE key = ?", [key])
  },
  async getAllKeys() {
    const rows = await db.getAllAsync<{ key: string }>("SELECT key FROM kv_store")
    return rows.map(r => r.key)
  },
  async clear() {
    await db.runAsync("DELETE FROM kv_store")
  },
}
```

### In-Memory Adapter (Testing)

For unit tests, use the built-in in-memory implementation:

```typescript
import { InMemoryOfflineStorage } from "@reactivebase/react-native"

const storage = new InMemoryOfflineStorage()
```

## Offline Query Cache

The `OfflineQueryCache` automatically caches query results with TTL-based expiration and LRU eviction:

```typescript
import { OfflineQueryCache } from "@reactivebase/react-native"

const cache = new OfflineQueryCache({
  defaultTtl: 5 * 60 * 1000, // 5 minutes (default)
  maxEntries: 500,             // Max cached queries (default)
})

// Initialize with storage adapter
await cache.init(sqliteAdapter)

// Cache a query result
await cache.put("tasks.list", { userId: "123" }, taskData)

// Read from cache
const cached = cache.get("tasks.list", { userId: "123" })

// Invalidate a specific query
await cache.invalidate("tasks.list", { userId: "123" })

// Invalidate all results for a query name
await cache.invalidate("tasks.list")
```

## Mutation Queue

When the device is offline, mutations are queued and replayed when connectivity is restored.

### Configuration

```typescript
import { MutationQueue } from "@reactivebase/react-native"

const queue = new MutationQueue({
  maxRetries: 3,                        // Max retry attempts (default: 3)
  conflictStrategy: "last-write-wins",  // Default strategy
})

// Initialize with storage (persists queue across app restarts)
await queue.init(sqliteAdapter)
```

### Queue Operations

```typescript
// Enqueue a mutation while offline
const mutation = await queue.enqueue("tasks.complete", { taskId: "abc" })
// mutation.id: "mut_1706123456_a1b2c3d4"
// mutation.status: "pending"

// Check pending mutations
console.log(queue.pending)  // QueuedMutation[] with status === "pending"
console.log(queue.size)     // Total queue size

// Clear all queued mutations
await queue.clear()
```

### Queued Mutation Lifecycle

Each queued mutation tracks its state:

```typescript
interface QueuedMutation {
  id: string
  mutationName: string
  args: unknown
  createdAt: number
  retryCount: number
  status: "pending" | "in-flight" | "failed"
  error?: string
}
```

- **pending** → waiting to be sent
- **in-flight** → currently being sent to server
- **failed** → exceeded `maxRetries`, requires manual intervention

## Conflict Resolution

When a queued mutation conflicts with server state, you can choose from four strategies:

### Strategies

| Strategy | Behavior |
|----------|----------|
| `"last-write-wins"` | Most recent write (by timestamp) takes precedence. Default. |
| `"client-wins"` | The queued client mutation always wins. |
| `"server-wins"` | The server state always wins; client mutation is discarded. |
| `"custom"` | You provide a resolver function. |

### Custom Conflict Resolver

```typescript
import { MutationQueue } from "@reactivebase/react-native"
import type { ConflictResolver } from "@reactivebase/react-native"

const resolver: ConflictResolver = (local, remote, mutation) => {
  // Merge fields — keep server's updatedAt but client's content
  return {
    ...remote,
    ...local,
    updatedAt: (remote as any).updatedAt,
  }
}

const queue = new MutationQueue({
  conflictStrategy: "custom",
  conflictResolver: resolver,
})
```

## Sync Engine

The `SyncEngine` manages network state, reconnection, and mutation replay:

```typescript
import { SyncEngine, MutationQueue, OfflineQueryCache } from "@reactivebase/react-native"

const mutationQueue = new MutationQueue({ maxRetries: 3 })
const queryCache = new OfflineQueryCache()

const sync = new SyncEngine(mutationQueue, queryCache, {
  reconnectInterval: 3000,       // Base reconnect delay in ms (default: 3000)
  maxReconnectAttempts: Infinity, // Max attempts (default: Infinity)
  syncBatchSize: 10,             // Mutations per replay batch (default: 10)
}, {
  onStatusChange: (status) => {
    // status: "online" | "offline" | "reconnecting"
    console.log("Network:", status)
  },
  onSyncStart: () => console.log("Syncing queued mutations..."),
  onSyncComplete: (count) => console.log(`Synced ${count} mutations`),
  onSyncError: (error) => console.error("Sync failed:", error),
  onConflict: (mutation, error) => {
    console.warn(`Conflict on ${mutation.mutationName}:`, error.message)
  },
})
```

### Network Status

```typescript
sync.isOnline         // boolean
sync.networkStatus    // "online" | "offline" | "reconnecting"
sync.pendingMutations // number of pending mutations

// Manually set network state
sync.setOnline()
sync.setOffline()
```

### Mutation Replay

When the connection is restored, replay queued mutations:

```typescript
sync.setOnline()

const syncedCount = await sync.replayMutations(async (name, args) => {
  // Send to server via your transport
  return await client.mutation(name, args)
})

console.log(`Replayed ${syncedCount} mutations`)
```

### Automatic Reconnection

Start automatic reconnection with exponential backoff:

```typescript
sync.startReconnect(async () => {
  // Return true if connection succeeds
  try {
    await client.connect()
    return true
  } catch {
    return false
  }
})

// Stop reconnection attempts
sync.stopReconnect()

// Clean up on unmount
sync.destroy()
```

The reconnect uses exponential backoff capped at 30 seconds: `delay = min(reconnectInterval × 1.5^attempt, 30000)`.

## Complete Example

```tsx
import { useEffect, useState } from "react"
import { MutationQueue, SyncEngine, OfflineQueryCache } from "@reactivebase/react-native"

function useOfflineSync(client, storage) {
  const [status, setStatus] = useState("offline")

  useEffect(() => {
    const queue = new MutationQueue({ maxRetries: 3 })
    const cache = new OfflineQueryCache()
    const sync = new SyncEngine(queue, cache, {}, {
      onStatusChange: setStatus,
      onSyncComplete: (count) => console.log(`Synced ${count}`),
    })

    async function init() {
      await queue.init(storage)
      await cache.init(storage)
      sync.startReconnect(() => client.connect())
    }

    init()
    return () => sync.destroy()
  }, [client, storage])

  return status
}
```

## Next Steps

→ [GraphQL Gateway](./graphql.md) — expose your data via GraphQL
→ [Performance & Scaling](./performance.md) — subscription sharding, edge caching
