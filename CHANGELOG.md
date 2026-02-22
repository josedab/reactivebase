# Changelog

All notable changes to ReactiveBase will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-02-22

### Added

#### Core Framework
- **Reactive Query Engine** — filter-level dependency tracking, subscription invalidation, result diffing
- **Automatic Transactions** — SERIALIZABLE Postgres transactions with auto-retry on serialization failures
- **Type-Safe Query Builder** — fluent SQL builder with WHERE, JOIN, GROUP BY, ORDER BY, vector similarity
- **Schema Definition** — `defineSchema`, `defineTable`, validators (string, number, boolean, timestamp, json, enum, id, vector, storageId, array, optional, custom)
- **Migration System** — SQL generation, migration manager, schema diffing with incremental ALTER TABLE
- **Server Functions** — `query()`, `mutation()`, `action()` primitives with dependency tracking

#### Auth & Security
- **JWT Authentication** — HS256, RS256, JWKS auto-caching
- **Custom & Token Providers** — pluggable auth verification
- **RBAC Permissions** — `roles()`, `allow()`, declarative access control on functions
- **Row-Level Security** — `defineRlsPolicy()` for database-level filtering
- **Multi-Tenant Isolation** — row-level and schema-per-tenant modes
- **Rate Limiting** — sliding window per-client rate limiter middleware
- **Argument Validation** — `s.string().min(1).email()` DSL with auto-enforcement

#### Infrastructure
- **Job Scheduler** — Postgres-backed queue with FOR UPDATE SKIP LOCKED, cron parser, retry/dead-letter
- **Redis Pub/Sub** — cross-server invalidation with in-memory fallback
- **Webhooks** — inbound (HMAC-verified) and outbound (mutation-triggered)
- **File Storage** — Local filesystem, S3-compatible, and in-memory backends
- **Presence System** — room-based presence tracking with conflict-free operations
- **Middleware System** — before/after/error hooks
- **Metrics** — collector with Prometheus exposition format and OTEL-compatible tracing
- **CDC** — Postgres LISTEN/NOTIFY change data capture with event buffering

#### AI & Intelligence
- **AI Providers** — OpenAI, Ollama, mock provider adapters
- **Vector Search** — `v.vector()` type, HNSW/IVFFlat indexes, `whereVectorSimilar()` with cosine/L2/inner_product
- **RAG Context** — `createAiContext()` with embed, generate, and search

#### Client SDKs
- **@reactivebase/client** — WebSocket connection, query cache with optimistic updates, binary protocol, multi-tab dedup, offline persistence + sync
- **@reactivebase/react** — `useQuery`, `useMutation`, `useAction` hooks
- **@reactivebase/vue** — Vue 3 composables
- **@reactivebase/svelte** — Svelte stores
- **@reactivebase/nextjs** — `preloadQuery`, `usePreloadedQuery`, streaming SSR with Suspense
- **@reactivebase/edge** — edge runtime query prefetching
- **@reactivebase/testing** — `TestServer`, `MockDatabase`, `snapshotReactiveUpdates`

#### Developer Tools
- **Type-Safe Codegen** — `scanFunctions()`, `generateApiModule()` with typed `FunctionReference<TArgs, TReturn>`
- **Schema Migration Tools** — `convertPrismaToReactiveBase()`, `convertDrizzleToReactiveBase()`
- **REST/GraphQL Auto-Generation** — `generateRestRoutes()`, `generateGraphQLSchema()`
- **Visual Dashboard** — live metrics dashboard served at `/dashboard`
- **Embedded Postgres** — PGlite adapter for zero-dependency local development
- **Plugin System** — `definePlugin()`, `PluginRegistry`, first-party Clerk/Stripe plugins
- **Plugin Registry** — searchable registry with 5 built-in plugins
- **Cloud Client** — API client for managed cloud offering
- **Benchmark Suite** — `bench()`, `runSuite()`, built-in load tests for 10K+ subscriptions
- **CLI** — `reactivebase dev`, `generate`, `migrate`
- **Project Scaffolding** — `create-reactivebase` with interactive wizard
- **Prisma Migration CLI** — `@reactivebase/migrate-from-prisma` standalone tool

#### Deployment & Ops
- CI/CD with GitHub Actions (Node 20/22 matrix + automated npm release)
- Docker, docker-compose, Fly.io, Railway, Render deployment templates
- Docusaurus documentation site (10 pages + 2 blog posts)
- CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md
- Enterprise page with support tiers and pilot program
