---
sidebar_position: 3
---

# API Reference

## Server Package (`@reactivebase/server`)

### Schema Definition

```typescript
import { defineSchema, defineTable, v } from "@reactivebase/server"
```

| Function | Description |
|----------|-------------|
| `defineSchema(tables)` | Define the data model |
| `defineTable(columns)` | Define a table with typed columns |
| `v.string()` | Text column |
| `v.number()` | Double precision column |
| `v.integer()` | Integer column |
| `v.boolean()` | Boolean column |
| `v.timestamp()` | Timestamptz column |
| `v.json<T>()` | JSONB column |
| `v.enum(...values)` | Text with CHECK constraint |
| `v.id(table)` | Foreign key reference |
| `v.optional(v)` | Nullable column |
| `v.vector(dims)` | pgvector column |
| `v.array(v)` | Postgres array |
| `v.storageId()` | File storage reference |

### Functions

```typescript
import { query, mutation, action } from "@reactivebase/server"
```

| Function | Description |
|----------|-------------|
| `query(handler, opts?)` | Define a reactive query |
| `mutation(handler, opts?)` | Define a transactional mutation |
| `action(handler, opts?)` | Define a background action |

### Server

```typescript
import { createReactiveBaseServer, defineConfig } from "@reactivebase/server"
```

### Auth

```typescript
import { jwtProvider, customProvider, tokenProvider, roles, allow } from "@reactivebase/server"
```

### AI

```typescript
import { openaiProvider, ollamaProvider, mockAiProvider, createAiContext } from "@reactivebase/server"
```

## Client Packages

### React (`@reactivebase/react`)

#### Core Hooks

| Hook | Description |
|------|-------------|
| `useQuery(ref, args)` | Subscribe to a reactive query |
| `useMutation(ref, config?)` | Get a mutation caller with optimistic updates |
| `useAction(ref)` | Get an action caller |
| `useAggregateQuery(ref, args, opts?)` | Subscribe to an aggregate query (count, sum, etc.) |

#### Collaboration Hooks

| Hook | Description |
|------|-------------|
| `useOptimistic(opts)` | Optimistic update state management |
| `useCursors()` | Track collaborator cursor positions |
| `useTypingUsers()` | Track which users are currently typing |
| `useSelections()` | Track collaborator text/element selections |
| `useDevTools()` | Access ReactiveBase DevTools state |

#### CRDT Hooks

| Hook | Description |
|------|-------------|
| `useCollabText(docId)` | Collaborative real-time text editing (CRDT-backed) |
| `useCollabList(docId)` | Collaborative real-time list (CRDT-backed) |
| `useCollabMap(docId)` | Collaborative real-time key-value map (CRDT-backed) |
| `useCollabCounter(docId)` | Collaborative real-time counter (CRDT-backed) |

### Vue (`@reactivebase/vue`)

| Composable | Description |
|------------|-------------|
| `useQuery(ref, args)` | Reactive query with `data`, `error`, `isLoading` refs |
| `useMutation(ref)` | Mutation with `mutate`, `isLoading`, `error` |
| `useAction(ref)` | Action with `run`, `isLoading`, `error` |

### Svelte (`@reactivebase/svelte`)

| Function | Description |
|----------|-------------|
| `queryStore(ref, args)` | Readable store with reactive data |
| `createMutation(ref)` | Mutation handle |
| `createAction(ref)` | Action handle |

### Next.js (`@reactivebase/nextjs`)

| Function | Description |
|----------|-------------|
| `preloadQuery(url, name, args)` | SSR query prefetch |
| `usePreloadedQuery(preloaded)` | Hydrate + subscribe |

### Edge (`@reactivebase/edge`)

| Class | Description |
|-------|-------------|
| `EdgeClient` | HTTP-only query prefetching for edge runtimes |

### Testing (`@reactivebase/testing`)

| Class | Description |
|-------|-------------|
| `TestServer` | In-memory test server |
| `MockDatabase` | Mock database for unit tests |

### GraphQL (`@reactivebase/graphql`)

```typescript
import { GraphQLSubscriptionGateway, GraphQLGatewayError } from "@reactivebase/graphql"
```

| Export | Description |
|--------|-------------|
| `GraphQLSubscriptionGateway` | Auto-generates GraphQL schema from ReactiveBase schema with subscriptions |
| `GraphQLGatewayError` | Error class for gateway operations |

**Types:**

| Type | Description |
|------|-------------|
| `GraphQLGatewayOptions` | Gateway configuration (schema, scalars, subscriptions, relay, basePath) |
| `GraphQLRequest` | Incoming GraphQL request (query, variables, operationName) |
| `GraphQLResponse` | GraphQL response with data and errors |
| `GraphQLError` | Structured GraphQL error |
| `GraphQLSubscriptionEvent` | Subscription push event |
| `SubscriptionTransportMessage` | graphql-ws protocol message |
| `GraphQLFieldDefinition` | Field definition in generated schema |
| `GraphQLTypeDefinition` | Type definition in generated schema |
| `GeneratedGraphQLSchema` | Full generated schema with SDL, types, and mappings |
| `SubscriptionMapping` | Mapping from subscription field to table/query |
| `SubscriptionHandle` | Handle returned from `subscribe()` with `onData` and `unsubscribe` |

**Client Utilities:**

| Method | Description |
|--------|-------------|
| `gateway.generateApolloClientConfig(wsUrl, httpUrl?)` | Generate Apollo Client setup snippet |
| `gateway.generateUrqlClientConfig(wsUrl, httpUrl?)` | Generate urql client setup snippet |
| `gateway.generateTypeDefinitions()` | Generate TypeScript types from schema |

### React Native (`@reactivebase/react-native`)

```typescript
import { MutationQueue, SyncEngine, OfflineQueryCache } from "@reactivebase/react-native"
```

| Export | Description |
|--------|-------------|
| `MutationQueue` | Offline mutation queue with retry and conflict resolution |
| `OfflineQueryCache` | TTL-based offline query cache with LRU eviction |
| `SyncEngine` | Network-aware sync engine with reconnection and mutation replay |
| `InMemoryOfflineStorage` | In-memory `OfflineStorage` implementation (for testing) |

**Interfaces:**

| Type | Description |
|------|-------------|
| `OfflineStorage` | Storage adapter interface (get, set, delete, getAllKeys, clear) |
| `QueuedMutation` | Queued mutation with status, retry count, and error |
| `ConflictStrategy` | `"last-write-wins"` \| `"client-wins"` \| `"server-wins"` \| `"custom"` |
| `ConflictResolver` | Custom conflict resolution function |
| `MutationQueueOptions` | Queue config (maxRetries, conflictStrategy, conflictResolver) |
| `SyncEngineOptions` | Sync config (reconnectInterval, maxReconnectAttempts, syncBatchSize) |
| `SyncEngineEvents` | Event callbacks (onStatusChange, onSyncStart, onSyncComplete, onConflict) |
| `NetworkStatus` | `"online"` \| `"offline"` \| `"reconnecting"` |
