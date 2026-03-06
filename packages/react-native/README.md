# @reactivebase/react-native

ReactiveBase React Native SDK — offline-first reactive queries for mobile applications.

## Features

- **Offline-first** — SQLite-backed query cache serves data when the device is offline
- **Mutation queue** — mutations are queued locally and replayed automatically on reconnect
- **Conflict resolution** — configurable strategies: last-write-wins, client-wins, server-wins, or custom resolver
- **Network-aware sync** — automatic reconnection with exponential backoff
- **Same API as `@reactivebase/react`** — `useQuery`, `useMutation` hooks work identically

## Installation

```bash
npm install @reactivebase/react-native @reactivebase/client
```

## Usage

### Basic Setup

```tsx
import { ReactiveBaseProvider, useQuery } from "@reactivebase/react-native"
import { ReactiveBaseClient } from "@reactivebase/client"

const client = new ReactiveBaseClient({ url: "wss://api.example.com" })

export default function App() {
  return (
    <ReactiveBaseProvider client={client}>
      <TaskList />
    </ReactiveBaseProvider>
  )
}
```

### Offline Storage

Provide an `OfflineStorage` adapter (e.g. backed by `expo-sqlite` or `react-native-mmkv`):

```ts
import { MutationQueue, OfflineQueryCache } from "@reactivebase/react-native"

const storage = createMyStorageAdapter() // implements OfflineStorage

const mutationQueue = new MutationQueue({ maxRetries: 3 })
await mutationQueue.init(storage)

const queryCache = new OfflineQueryCache({ defaultTtl: 5 * 60 * 1000 })
await queryCache.init(storage)
```

### Sync Engine

The `SyncEngine` manages network transitions and replays queued mutations:

```ts
import { SyncEngine } from "@reactivebase/react-native"

const sync = new SyncEngine(
  mutationQueue,
  queryCache,
  {
    reconnectInterval: 3000,
    maxReconnectAttempts: Infinity,
    syncBatchSize: 10,
  },
  {
    onStatusChange: (status) => console.log("Network:", status),
    onSyncComplete: (count) => console.log(`Synced ${count} mutations`),
  },
)
```

### Conflict Resolution

```ts
const queue = new MutationQueue({
  conflictStrategy: "custom",
  conflictResolver: (local, remote, mutation) => {
    // Merge fields from both versions
    return { ...remote, ...local }
  },
})
```

## Documentation

Full documentation is available at [reactivebase.dev/docs](https://reactivebase.dev/docs).

## License

MIT
