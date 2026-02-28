/** @module @reactivebase/server - Core server framework for reactive backends on Postgres */

/** AI & RAG pipeline: vector embeddings, semantic search, LLM integration */
export * from "./exports/ai.js"
/** Authentication & authorization: JWT, custom providers, RLS policies, Zanzibar */
export * from "./exports/auth.js"
/** Benchmark suite: latency, throughput, and stress testing utilities */
export * from "./exports/benchmark.js"
/** Cloud deployment: managed hosting, multi-region, edge query layer */
export * from "./exports/cloud.js"
/** Code generation: type-safe API modules, RPC types, OpenAPI, GraphQL */
export * from "./exports/codegen.js"
/** Server configuration: defineConfig() and ReactiveBaseConfig */
export * from "./exports/config.js"
/** Admin dashboard: schema visualizer, query inspector, live metrics */
export * from "./exports/dashboard.js"
/** Data layer: embedded Postgres, storage, query builder, time-travel, seeding */
export * from "./exports/data.js"
/** Server functions: query(), mutation(), action() primitives and error types */
export * from "./exports/functions.js"
/** Observability: metrics collection, Prometheus export, tracing, alerting */
export * from "./exports/metrics.js"
/** Middleware: pipeline, validation, rate limiting */
export * from "./exports/middleware.js"
/** Plugin system: marketplace, SDK, built-in integrations (Clerk, Stripe, etc.) */
export * from "./exports/plugins.js"
/** Reactivity engine: CDC, IVM, logical replication, subscription analytics */
export * from "./exports/reactivity.js"
/** Real-time: pub/sub, webhooks, CRDT, collaboration, multiplayer, event sourcing */
export * from "./exports/realtime.js"
/** Scheduling: job scheduler, workflow orchestration, cron */
export * from "./exports/scheduling.js"
/** Schema: defineSchema(), defineTable(), validators, migrations, registry */
export * from "./exports/schema.js"
/** Security: encryption, vault/KMS providers, compliance toolkit (PII, GDPR) */
export * from "./exports/security.js"
/** Server: createReactiveBaseServer() entry point */
export * from "./exports/server.js"
/** Multi-tenancy: row-level/schema isolation, SaaS kit, Stripe billing */
export * from "./exports/tenant.js"
/** Transport: WebSocket protocol, horizontal scaling, cluster management */
export * from "./exports/transport.js"
/** Distributed Transactions: 2PC coordinator, saga runtime, dead letter recovery */
export * from "./exports/distributed-tx.js"
/** Reactive Query Composition: DAG-based derived queries with incremental propagation */
export * from "./exports/query-composition.js"
