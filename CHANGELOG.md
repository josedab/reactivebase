# Changelog

All notable changes to ReactiveBase will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Structured error hierarchy** — domain-specific error types (`SchemaValidationError`, `InvalidMessageError`, etc.) replacing string errors
- **Graceful shutdown** — proper pool cleanup and SIGTERM handling
- **Structured logging module** — leveled logger with JSON output
- **Dashboard authentication** — token-based auth for the metrics dashboard
- **Security response headers** — HSTS and other security headers on all responses
- **Configurable CORS origin** — `cors.origin` server config option
- **Embeddable in-process transport** — run client and server in the same process
- **Federation extensions & replica routing** — multi-database federation support
- **Live migration preview** — shadow execution for safe migration previews
- **Automated performance advisor** — metrics-based query optimization suggestions
- **`ctx.emit()` and `ctx.query()` composition** — function composition primitives
- **Transactional outbox pattern** — reliable event delivery from mutations
- **Declarative data access policies** — fine-grained authorization rules
- **Middleware support for Vue and Svelte adapters** — framework adapter middleware pipeline
- **`useAggregateQuery` hook** — React hook for aggregate queries with dependent query support
- **Subscription lifecycle middleware** — client-side subscription middleware pipeline
- **Virtual field evaluation** — computed/virtual fields in database context
- **Aggregate query builder** — fluent API for GROUP BY / aggregate queries
- **Computed and virtual field validators** — `v.computed()` and `v.virtual()` schema types
- **Reactive full-text search** — `tsvector`-based full-text search with live updates
- Client SDK packages for React Native, Vue, Svelte, Next.js, and Edge runtimes
- VS Code extension with watch mode, diagnostics, and schema validation
- 5 example applications (basic-todo, collaborative-board, collaborative-editor, project-manager, saas-dashboard)

### Changed

- Replace `Math.random` with `crypto.randomUUID` / `crypto.randomBytes` across server and client
- Use structured error types instead of string errors in functions, schema, and transport modules
- Use `console.info` instead of `console.log` in migrate-from-prisma

### Fixed

- **Security:** enforce `JWT_SECRET` in production — remove insecure defaults
- **Security:** use parameterized queries in logical replication, migrations, stored procedures, and dashboard
- **Security:** validate and escape SQL identifiers in authz, encryption, stored procedures, CDC, and triggers
- **Security:** use timing-safe comparison for dashboard token authentication
- **Security:** replace MD5 with SHA-256 for consistent hash ring
- **Security:** use HKDF for cryptographic key derivation in vault
- **Security:** close WebSocket connection on authentication failure
- **Security:** guard against ReDoS in playground validation patterns
- **Security:** use `crypto.randomInt` for partition selection in event streaming
- Detect tenant ID collisions after sanitization
- Add payload size limit and input validation for webhooks
- Catch network errors in outbound webhook delivery
- Validate language parameter against allowlist in search
- Escape single quotes in RLS policy role names
- Validate scheduler `defaultMaxRetries` option
- Handle invalid JSON in IVM delta patch decoding and playground share state
- Quote index names in temporal SQL generation
- Sanitize default values in generated SQL

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
