# Conference CFP Submissions — Ready to Paste

## React Summit 2026

**Title:** Building Real-Time AI Apps with Postgres: No WebSocket Code Required

**Talk format:** Full talk (25 min)

**Abstract:**
Modern apps demand real-time data, but building it means assembling 5+ systems: ORM, API layer, WebSocket server, cache, job queue. What if one framework handled all of that on the Postgres you already run?

ReactiveBase is an open-source TypeScript framework that provides Convex-like developer experience on self-hosted Postgres. In this talk, I'll build a live collaborative task board with AI-powered semantic search in under 15 minutes, demonstrating reactive queries that auto-update (no manual subscriptions), automatic SERIALIZABLE transactions, vector similarity search with pgvector, and three React hooks that comprise the entire client API: useQuery, useMutation, useAction.

**Outline:**
1. The problem: assembling 5 tools for real-time (3 min)
2. Live coding: schema → reactive query → React UI (8 min)
3. Adding AI vector search in 5 lines (4 min)
4. Deploying to production (3 min)
5. Architecture: how filter-level invalidation works (5 min)
6. Q&A (2 min)

**Bio:** TypeScript developer and open-source maintainer. Creator of ReactiveBase, a 19K LOC reactive backend framework with 425 tests and 30 server modules.

**Tags:** React, TypeScript, Postgres, Real-time, AI

---

## Node Congress 2026

**Title:** 30 Modules, 1 Framework: Replacing Your Entire Backend Stack

**Talk format:** Full talk (30 min)

**Abstract:**
The average real-time SaaS backend uses Prisma + tRPC + Socket.io + BullMQ + Redis — five tools with five configuration surfaces and thousands of lines of glue code. ReactiveBase is a 19,000+ LOC TypeScript framework with 30 server modules that replaces all of them.

In this talk, I'll walk through the architecture: how filter-level reactive invalidation tracks WHERE predicates to avoid unnecessary subscription re-execution, why every mutation runs in a SERIALIZABLE transaction with auto-retry, and how the plugin ecosystem enables community extensions. Live demo: migrating a Prisma+tRPC app to ReactiveBase with one command.

**Tags:** Node.js, Architecture, Backend, TypeScript, Postgres

---

## TypeScript Congress 2026

**Title:** End-to-End Type Safety from Schema to UI: The ReactiveBase Type Inference Chain

**Talk format:** Lightning talk (20 min)

**Abstract:**
TypeScript's type system can do more than catch typos. ReactiveBase uses it to create an unbroken type inference chain from database schema to React component props — without code generation or manual annotations.

I'll show how defineSchema produces InferSchemaTypes, how TypedDatabaseContext provides typed table accessors, how generated FunctionReference<TArgs, TReturn> carries types through useQuery, and how the validation DSL provides runtime validation aligned with compile-time types. The result: zero `as any` casts in a complete full-stack application.

**Tags:** TypeScript, Type inference, Full-stack, DX
