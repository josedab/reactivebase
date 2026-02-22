# Conference Talk Proposals

## Talk 1: React Summit 2026

**Title:** "Building Real-Time AI Apps with Postgres: No WebSocket Code Required"

**Abstract:**
Modern apps demand real-time data, but building it means assembling 5+ systems: ORM, API layer, WebSocket server, cache, job queue. What if one framework handled all of that on the Postgres you already run?

In this talk, I'll show how ReactiveBase — an open-source TypeScript framework — provides Convex-like developer experience on self-hosted Postgres. I'll build a live collaborative task board with AI-powered semantic search in under 15 minutes, demonstrating:
- Reactive queries that auto-update when data changes (no manual subscriptions)
- Automatic SERIALIZABLE transactions (no partial writes)
- Vector similarity search with pgvector (reactive semantic search)
- Three React hooks: useQuery, useMutation, useAction — that's the entire API

**Duration:** 25 minutes
**Level:** Intermediate
**Tags:** React, Postgres, Real-time, AI, TypeScript

---

## Talk 2: Node Congress 2026

**Title:** "30 Modules, 1 Framework: How ReactiveBase Replaces Your Entire Backend Stack"

**Abstract:**
The average real-time SaaS backend uses Prisma + tRPC + Socket.io + BullMQ + Redis — five tools with five configuration surfaces, five upgrade cycles, and thousands of lines of glue code.

ReactiveBase is a 19,000+ LOC TypeScript framework with 30 server modules that replaces all of them. In this talk, I'll walk through the architecture: how filter-level reactive invalidation works, why every mutation runs in a SERIALIZABLE transaction, and how the plugin ecosystem enables community extensions.

Live demo: migrating a Prisma+tRPC app to ReactiveBase with one command.

**Duration:** 30 minutes
**Level:** Advanced
**Tags:** Node.js, Architecture, Backend, TypeScript

---

## Talk 3: TypeScript Congress 2026

**Title:** "End-to-End Type Safety from Schema to UI: The ReactiveBase Type Inference Chain"

**Abstract:**
TypeScript's type system can do more than catch typos. ReactiveBase uses it to create an unbroken type inference chain from database schema to React component props — without code generation or manual annotations.

I'll show how `defineSchema` produces `InferSchemaTypes`, how `TypedDatabaseContext` provides typed table accessors, how generated `FunctionReference<TArgs, TReturn>` carries types through `useQuery`, and how the validation DSL (`s.string().min(1).email()`) provides runtime validation aligned with compile-time types.

The result: zero `as any` casts in a complete full-stack application.

**Duration:** 20 minutes
**Level:** Advanced
**Tags:** TypeScript, Type inference, DX, Full-stack
