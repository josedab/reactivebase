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

| Function | Description |
|----------|-------------|
| `jwtProvider(options)` | JWT authentication (HS256, RS256, JWKS) |
| `customProvider(handler)` | Custom authentication handler |
| `tokenProvider(options)` | Token-based authentication |
| `roles(...names)` | Define named roles |
| `allow(role, action, resource)` | Create role-based access rule |
| `createAuthContext(req)` | Extract auth context from a request |
| `defineRlsPolicy(table, policy)` | Define row-level security policy |
| `enforceAccess(ctx, resource)` | Enforce access control at runtime |
| `definePermissions(definitions)` | Define permission rules |

### AI

```typescript
import { openaiProvider, ollamaProvider, mockAiProvider, createAiContext } from "@reactivebase/server"
```

| Function / Class | Description |
|------------------|-------------|
| `openaiProvider(options)` | OpenAI LLM provider |
| `ollamaProvider(options)` | Ollama local LLM provider |
| `mockAiProvider(options)` | Mock provider for testing |
| `createAiContext(ctx)` | Create AI context for RAG pipelines |
| `QueryAssistant` | Natural language to query assistant |
| `SchemaGenerator` | AI-powered schema generation |
| `QueryBuilderAssistant` | AI-assisted query building |
| `MigrationCopilot` | AI-assisted migration helper |

### Benchmark

```typescript
import { bench, runSuite, StressTestSuite } from "@reactivebase/server"
```

| Function / Class | Description |
|------------------|-------------|
| `bench(name, fn)` | Define a benchmark case |
| `runSuite(benchmarks)` | Execute a benchmark suite |
| `formatResults(results)` | Format results as a table |
| `formatResultsJSON(results)` | Format results as JSON |
| `StressTestSuite` | Latency, throughput, and stress testing |

### Cloud

```typescript
import { CloudClient, CloudPlatform, EdgeQueryLayer } from "@reactivebase/server"
```

| Class | Description |
|-------|-------------|
| `CloudClient` | Client for ReactiveBase Cloud API |
| `CloudPlatform` | Cloud platform management |
| `CloudProvisioner` | Infrastructure provisioning |
| `OneClickProvisioner` | Simplified one-click deployment |
| `AutoScaler` | Automatic resource scaling |
| `DatabaseManager` | Cloud database management |
| `RegionManager` | Multi-region management |
| `RegionRouter` | Route requests to nearest region |
| `EdgeQueryLayer` | Edge query caching and execution |
| `EdgeQueryCache` | Edge-level query cache |

### Codegen

```typescript
import { generate, scanFunctions, generateApiModule } from "@reactivebase/server"
```

| Function / Class | Description |
|------------------|-------------|
| `generate(schema)` | Run full code generation pipeline |
| `scanFunctions(dir)` | Scan directory for function definitions |
| `generateApiModule(fns)` | Generate type-safe API module |
| `generateServerModule(fns)` | Generate server function module |
| `TypedCodegen` | Type-safe code generation engine |
| `RpcTypeGenerator` | RPC type generation |
| `ApiGateway` | Unified API gateway |
| `OpenApiGenerator` | Generate OpenAPI specs |
| `GraphQLSchemaGenerator` | Generate GraphQL schema from ReactiveBase schema |
| `UniversalSdk` | Multi-language SDK generator |

### Config

```typescript
import { defineConfig } from "@reactivebase/server"
```

| Function | Description |
|----------|-------------|
| `defineConfig(options)` | Define server configuration |

### Dashboard

```typescript
import { LiveDashboard, PlaygroundEngine, WorkflowStudio } from "@reactivebase/server"
```

| Function / Class | Description |
|------------------|-------------|
| `generateDashboardHTML(schema)` | Generate admin dashboard HTML |
| `generateFullDashboardHTML(options)` | Full-featured dashboard |
| `DashboardV2Engine` | Dashboard engine with live metrics |
| `LiveDashboard` | Real-time dashboard with query inspector |
| `PlaygroundEngine` | Interactive query playground |
| `WorkflowStudio` | Visual workflow designer and debugger |
| `AdminStudio` | Admin panel with data browser |
| `schemaToVisualModel(schema)` | Convert schema to visual model |
| `generatePlaygroundHTML(options)` | Interactive playground HTML |

### Data

```typescript
import { createEmbeddedPool, QueryBuilder, TimeTravelEngine, DatabaseBranching } from "@reactivebase/server"
```

| Function / Class | Description |
|------------------|-------------|
| `createEmbeddedPool(options)` | Create embedded PGlite pool |
| `createAutoPool(options)` | Auto-detect pool adapter |
| `QueryBuilder` | Fluent SQL query builder |
| `TimeTravelEngine` | Mutation history and point-in-time queries |
| `MaterializedViewEngine` | Manage materialized views |
| `DatabaseBranching` | Database branching (schema, Neon, database) |
| `NeonBranchingAdapter` | Neon.tech copy-on-write branches |
| `BranchDashboard` | Branch management dashboard |
| `SmartPool` | Adaptive connection pooling |
| `SeedRegistry` | Test data seeding |
| `SearchQueryBuilder` | Full-text search queries |
| `AuditTrail` | Access audit logging |
| `TemporalQuery` | Historical state queries |
| `StoredProcedureRegistry` | Server-side stored procedures |
| `AnalyticsEngine` | Analytics and aggregation pipelines |

### Metrics

```typescript
import { MetricsCollector, toPrometheusFormat, AlertEngine } from "@reactivebase/server"
```

| Class / Function | Description |
|------------------|-------------|
| `MetricsCollector` | Collect and track runtime metrics |
| `PerformanceProfiler` | Profile query and mutation performance |
| `OtelInstrumentation` | OpenTelemetry instrumentation |
| `AlertEngine` | Define and evaluate alert rules |
| `RealtimeDashboard` | Live metrics dashboard |
| `toPrometheusFormat(metrics)` | Export metrics in Prometheus format |
| `traced(name, fn)` | Wrap a function with tracing |
| `createAutoInstrumentedTracer()` | Auto-instrument all operations |

### Middleware

```typescript
import { validateArgs, s, rateLimit, RateLimiter } from "@reactivebase/server"
```

| Function / Class | Description |
|------------------|-------------|
| `validateArgs(schema, handler)` | Validate function arguments |
| `s` | Schema builder for validation (string, number, etc.) |
| `withValidation(schema, handler)` | Combine validation + handler |
| `rateLimit(options)` | Simple rate limiting middleware |
| `RateLimiter` | Configurable rate limiter |
| `RateLimitEngine` | Advanced rate limiting engine |
| `SlidingWindowLimiter` | Sliding window rate limiter |
| `TokenBucketLimiter` | Token bucket rate limiter |
| `UsageMeter` | Track and meter API usage |
| `MiddlewareManager` | Middleware pipeline manager |

### Plugins

```typescript
import { definePlugin, PluginRegistry, clerkPlugin, stripePlugin } from "@reactivebase/server"
```

| Function / Class | Description |
|------------------|-------------|
| `definePlugin(config)` | Define a custom plugin |
| `PluginRegistry` | Register and manage plugins |
| `PluginMarketplace` | Browse and install plugins |
| `PluginSDK` | Plugin development SDK |
| `PluginTestHarness` | Test harness for plugin development |
| `clerkPlugin` | Clerk authentication plugin |
| `stripePlugin` | Stripe payments plugin |
| `resendPlugin` | Resend email plugin |
| `sentryPlugin` | Sentry error tracking plugin |
| `vercelPlugin` | Vercel deployment plugin |
| `s3StoragePlugin` | S3 file storage plugin |
| `posthogPlugin` | PostHog analytics plugin |

### Reactivity

```typescript
import { ReactivityEngine, CdcListener, LogicalReplicator } from "@reactivebase/server"
```

| Class | Description |
|-------|-------------|
| `ReactivityEngine` | Core reactive query invalidation engine |
| `RowLevelTracker` | Row-level dependency tracking |
| `CdcListener` | Change data capture listener |
| `ReactiveCdcAdapter` | CDC adapter for reactivity |
| `RowLevelCdcAdapter` | Row-level CDC adapter |
| `LogicalReplicator` | Postgres logical replication |
| `WalDecoder` | WAL log decoder |
| `IncrementalViewMaintainer` | Incremental view maintenance (IVM) |
| `SubscriptionAnalytics` | Subscription performance analytics |
| `BloomFilter` | Bloom filter for efficient tracking |

### Real-time

```typescript
import { RedisPubSubAdapter, WebhookRegistry, CrdtEngine, CollaborationManager, EventStore } from "@reactivebase/server"
```

| Class | Description |
|-------|-------------|
| `RedisPubSubAdapter` | Redis pub/sub for multi-server |
| `InMemoryPubSubAdapter` | In-memory pub/sub (single server) |
| `WebhookRegistry` | Inbound webhook registration |
| `OutboundWebhookManager` | Outbound webhook delivery |
| `WebhookDeliveryQueue` | Reliable webhook delivery with retries |
| `EventStreamManager` | Event stream processing |
| `PresenceManager` | User presence tracking |
| `CrdtEngine` | Conflict-free replicated data types |
| `CollaborationManager` | Real-time collaboration (cursors, typing) |
| `DocumentCollaboration` | Yjs-compatible document collaboration |
| `MultiplayerKit` | Multiplayer room management |
| `EventStore` | Event sourcing store |
| `ProjectionEngine` | Event sourcing projections |
| `MediaPipeline` | Media processing pipeline |

### Scheduling

```typescript
import { JobScheduler, defineWorkflow, WorkflowEngine } from "@reactivebase/server"
```

| Function / Class | Description |
|------------------|-------------|
| `JobScheduler` | Schedule jobs with cron or delay |
| `defineWorkflow(config)` | Define a multi-step workflow |
| `WorkflowEngine` | Execute and manage workflows |
| `WorkflowContext` | Context available inside workflow steps |
| `parseDelay(str)` | Parse delay strings (e.g., `"5m"`, `"1h"`) |
| `getNextCronRun(expr)` | Get next cron execution time |

### Security

```typescript
import { EncryptionEngine, ComplianceToolkit, localKeyProvider, rotatingKeyProvider } from "@reactivebase/server"
```

| Function / Class | Description |
|------------------|-------------|
| `EncryptionEngine` | AES-256-GCM field-level encryption |
| `ComplianceToolkit` | PII detection, GDPR erasure, audit logging |
| `localKeyProvider(key)` | Local key derivation provider |
| `rotatingKeyProvider(keys, currentId)` | Multi-key rotation provider |
| `kmsKeyProvider(options)` | AWS KMS key provider |
| `vaultKeyProvider(options)` | HashiCorp Vault key provider |
| `gcpKmsKeyProvider(options)` | GCP KMS key provider |

### Tenant

```typescript
import { createTenancyMiddleware, SaasKit, StripeBillingProvider } from "@reactivebase/server"
```

| Function / Class | Description |
|------------------|-------------|
| `createTenancyMiddleware(config)` | Auto-inject tenant filtering |
| `getTenantId(auth, claim)` | Extract tenant ID from auth context |
| `buildTenantFilter()` | Generate tenant WHERE clause |
| `SaasKit` | SaaS tenant lifecycle management |
| `TenantConnectionRouter` | Per-tenant connection pooling |
| `StripeBillingProvider` | Stripe billing integration |
| `TenantAdminDashboard` | Tenant admin analytics dashboard |

### Transport

```typescript
import { TransportServer, ClusterManager, ConsistentHashRing } from "@reactivebase/server"
```

| Class | Description |
|-------|-------------|
| `TransportServer` | WebSocket transport server |
| `ConsistentHashRing` | Consistent hashing for subscription sharding |
| `ClusterManager` | Multi-node cluster management |
| `SubscriptionShardManager` | Shard subscriptions across nodes |

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
| `provideReactiveBase(options)` | Provide a ReactiveBase client to descendant components (call in root setup) |
| `useReactiveBaseClient()` | Inject the ReactiveBase client from a parent provider |
| `useQuery(ref, args)` | Reactive query with `data`, `error`, `isLoading` refs |
| `useMutation(ref)` | Mutation with `mutate`, `isLoading`, `error` |
| `useAction(ref)` | Action with `run`, `isLoading`, `error` |

### Svelte (`@reactivebase/svelte`)

| Function | Description |
|----------|-------------|
| `initReactiveBase(options)` | Initialize the ReactiveBase client (call once at app startup) |
| `getReactiveBaseClient()` | Get the current client instance |
| `destroyReactiveBase()` | Disconnect and clean up the client |
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
