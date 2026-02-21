# Product Requirements Document: ReactiveBase

**Version:** 1.0
**Author:** Jose David Baena
**Date:** February 21, 2026
**Status:** Draft

---

## 1. Executive Summary

ReactiveBase is an open-source, TypeScript-native reactive backend framework that provides Convex-like developer experience (live queries, automatic transactions, built-in scheduling) while running on infrastructure teams already own and understand: Postgres and Redis.

The framework targets engineering teams building real-time SaaS applications who want the productivity benefits of platforms like Convex or Firebase but cannot accept vendor lock-in, need Postgres compatibility, or require self-hosted infrastructure for compliance, cost, or latency reasons.

ReactiveBase differentiates through three interlocking capabilities that no existing open-source tool combines: a reactive query engine that automatically pushes data changes to connected clients, an automatic transaction layer that wraps every mutation in serializable Postgres transactions, and an integrated job scheduler that eliminates the need for separate background processing infrastructure.

The business model follows an open-core approach: a permissively licensed framework with paid tiers for a managed cloud offering, an observability dashboard, and enterprise features.

---

## 2. Problem Statement

### 2.1 The Reactive Backend Gap

Modern applications increasingly require real-time data synchronization. Users expect dashboards that update live, collaborative features that reflect changes instantly, and notifications that arrive without page refreshes. Building these experiences on traditional backend stacks requires assembling and integrating multiple systems:

**The typical "reactive" stack today:**

```
┌─────────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐
│  Postgres   │  │  ORM     │  │  REST/   │  │  WebSocket│  │  Job     │
│  (storage)  │  │  (Prisma │  │  GraphQL │  │  Server   │  │  Queue   │
│             │  │  Drizzle)│  │  (API)   │  │  (Socket. │  │  (Bull   │
│             │  │          │  │          │  │  io/ws)   │  │  Celery) │
└──────┬──────┘  └────┬─────┘  └────┬─────┘  └─────┬─────┘  └────┬─────┘
       │              │             │               │              │
       └──────────────┴─────────────┴───────────────┴──────────────┘
                    Developer assembles and maintains all of this
```

Each component requires its own configuration, error handling, scaling strategy, and operational knowledge. The integration points between them (invalidating caches when data changes, pushing updates to the right WebSocket connections, scheduling follow-up jobs after mutations) are where most bugs and complexity live.

**Platforms like Convex solve this by owning the entire stack.** You write functions, Convex handles storage, reactivity, transactions, and scheduling. The developer experience is exceptional. But this comes with total vendor lock-in: your data model, query logic, and application architecture are coupled to Convex's proprietary runtime. You cannot run Convex locally without their cloud, you cannot migrate to another database, and you cannot inspect or tune the underlying infrastructure.

**The gap ReactiveBase fills:** a framework that provides the integrated, reactive developer experience of Convex while running on standard Postgres and Redis infrastructure that teams already operate, understand, and control.

### 2.2 Specific Pain Points

**Pain Point 1: "Adding real-time to our app was harder than building the feature itself."**

Teams that add live updates to existing Postgres-backed applications face a complex integration challenge. They must set up a WebSocket server, determine which clients need which updates, manage connection lifecycle, handle reconnection and state synchronization, and ensure consistency between the HTTP API and WebSocket channels. This often takes weeks of engineering time for a feature that Convex provides out of the box.

**Pain Point 2: "We love Convex's DX but we can't use it."**

Enterprise teams, teams in regulated industries, and teams with existing Postgres infrastructure frequently evaluate Convex and conclude they cannot adopt it. Reasons include: compliance requirements mandating self-hosted or specific-cloud infrastructure, existing data in Postgres that would require migration, inability to accept single-vendor dependency for core infrastructure, or cost concerns at scale. These teams want the developer experience but need infrastructure control.

**Pain Point 3: "Our transactions are a mess."**

Developers routinely mishandle database transactions in application code. Common issues include: not wrapping related writes in a transaction, using incorrect isolation levels, not handling serialization failures with retries, and allowing partial writes when errors occur mid-operation. Convex solves this by making every mutation automatically transactional. ReactiveBase brings this same guarantee to Postgres.

**Pain Point 4: "We have three separate systems for API, real-time, and background jobs."**

A typical SaaS backend maintains an API server, a WebSocket server, and a job processing system as separate deployments with separate codebases, monitoring, and scaling policies. ReactiveBase unifies these into a single framework where queries, mutations, and background actions are all defined in the same codebase and share the same data access layer.

**Pain Point 5: "Our caching layer is a source of bugs, not performance."**

Teams that add Redis caching in front of Postgres to improve read performance inevitably face cache invalidation problems. Stale data, cache stampedes, and inconsistency between cache and database are recurring issues. ReactiveBase's reactivity engine replaces manual caching with automatic query invalidation: when data changes, affected queries are re-executed and fresh results are pushed to clients.

---

## 3. Product Vision

### 3.1 Vision Statement

ReactiveBase is the backend framework that makes real-time the default. Define your data access as queries and mutations in TypeScript. The framework handles transactions, reactivity, and scheduling on infrastructure you control. Your UI stays in sync with your database automatically, every mutation is transactional, and background jobs run without separate infrastructure.

### 3.2 Design Principles

**Reactive by default, not by opt-in.** Every query is live. When underlying data changes, subscribed clients receive updated results automatically. Developers do not need to set up WebSockets, manage subscriptions, or build invalidation logic. Non-reactive (one-shot) queries are available for cases where live updates are unnecessary, but the default path is reactive.

**Postgres is the source of truth.** ReactiveBase does not replace Postgres or abstract it away. It enhances Postgres with a reactive layer. Developers can always drop down to raw SQL, use Postgres-specific features (JSONB, full-text search, PostGIS), and access their data with standard Postgres tools. Migrations are standard SQL migrations.

**Transactions are automatic.** Every mutation executes inside a serializable Postgres transaction. If any operation within a mutation fails, the entire mutation rolls back. Serialization conflicts are retried automatically. Developers never write `BEGIN`/`COMMIT`/`ROLLBACK` manually.

**One framework, three capabilities.** Queries (reactive reads), mutations (transactional writes), and actions (background jobs with side effects) are all defined in the same codebase using the same data access layer. No separate job queue, no separate WebSocket server, no separate caching layer.

**Progressive disclosure of complexity.** Getting started requires defining a schema and writing a query function. Advanced features (custom invalidation strategies, raw SQL escape hatches, worker pool tuning, horizontal scaling) are available but never required for basic usage.

**Self-hosted first, cloud optional.** The framework runs on any infrastructure where Postgres and Redis are available. A managed cloud offering provides convenience but is never required.

---

## 4. Target Users

### 4.1 User Personas

**Persona 1: SaaS Product Developer (Primary)**

- Full-stack TypeScript developer at a startup or scale-up (10-100 engineers)
- Building a product with real-time requirements: dashboards, collaborative editing, notifications, live feeds
- Currently using Next.js/Remix + Prisma/Drizzle + tRPC + a WebSocket layer + BullMQ
- Frustrated by the number of systems they must maintain and integrate
- Has evaluated Convex or Firebase but cannot adopt due to infrastructure requirements
- Values: developer experience, type safety, reduced operational surface area, Postgres compatibility

**Persona 2: Tech Lead / Architect (Secondary)**

- Responsible for technology choices at a mid-size company
- Evaluating frameworks for a new product or a rewrite of an aging system
- Needs to justify technology choices to engineering leadership
- Cares about: vendor lock-in risk, team onboarding curve, long-term maintainability, production operational characteristics
- Values: self-hosting capability, Postgres compatibility (existing expertise), clear scaling model, active open-source community

**Persona 3: Indie Developer / Solo Founder (Tertiary)**

- Building a real-time product alone (collaboration tool, dashboard product, multiplayer game)
- Wants the fastest path from idea to working product
- Currently choosing between Convex (great DX, vendor lock-in) and a custom stack (full control, weeks of setup)
- ReactiveBase offers a middle path: great DX with the freedom to deploy anywhere
- Values: speed of development, low operational overhead, ability to start free and scale

### 4.2 User Journey

```
Discovery               Evaluation              Adoption                 Growth
────────────────────────────────────────────────────────────────────────────────
Blog post about     →   npx create-reactive  →   First reactive      →   Team adopts
"Convex DX on          -base my-app              query in                for new
Postgres"                                         production              features
                    →   Follow tutorial:     →   Replace custom      →   Enterprise
HN discussion           define schema,            WebSocket code          evaluation
about Convex            write query,              with framework          begins
alternatives            see live updates          subscriptions
                    →   Compare DX to        →   Migrate BullMQ      →   Cloud tier
                        Convex/Supabase           jobs to actions         for managed
                        /Drizzle+tRPC                                     hosting
```

---

## 5. Functional Requirements

### 5.1 Schema & Data Layer

#### 5.1.1 Schema Definition

**FR-101: TypeScript-native schema definition with Postgres type mapping.**

Developers define their data model in TypeScript. The framework generates Postgres DDL, TypeScript types, and query builder types from a single source of truth.

```typescript
import { defineSchema, defineTable, v } from "reactivebase"

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    role: v.enum("admin", "member", "viewer"),
    avatarUrl: v.optional(v.string()),
    metadata: v.optional(v.json()),
    createdAt: v.timestamp({ default: "now" }),
  })
    .index("by_email", ["email"], { unique: true })
    .index("by_role", ["role"]),

  tasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    done: v.boolean({ default: false }),
    priority: v.enum("low", "medium", "high", "critical"),
    assigneeId: v.id("users"),
    dueDate: v.optional(v.timestamp()),
    tags: v.array(v.string()),
    createdAt: v.timestamp({ default: "now" }),
    updatedAt: v.timestamp({ default: "now", onUpdate: "now" }),
  })
    .index("by_assignee", ["assigneeId"])
    .index("by_assignee_status", ["assigneeId", "done"])
    .index("by_priority", ["priority"]),

  comments: defineTable({
    taskId: v.id("tasks"),
    authorId: v.id("users"),
    body: v.string(),
    createdAt: v.timestamp({ default: "now" }),
  })
    .index("by_task", ["taskId"]),
})
```

**Acceptance criteria:**
- Schema definitions produce fully typed query builders (autocomplete for field names, correct return types)
- `v.id("tableName")` creates a typed foreign key reference that the query builder understands for joins
- Schema changes generate SQL migration files (up and down) that developers review before applying
- Supported types map to Postgres types: `v.string()` to `text`, `v.number()` to `double precision`, `v.integer()` to `integer`, `v.boolean()` to `boolean`, `v.timestamp()` to `timestamptz`, `v.json()` to `jsonb`, `v.array()` to Postgres arrays, `v.enum()` to Postgres enums
- Custom Postgres types (PostGIS geometry, tsvector, etc.) are supported via `v.custom<T>(pgType)`
- Schema validation catches errors at definition time: duplicate table names, invalid index columns, circular references

**FR-102: Automatic migration generation.**

Schema changes are detected by diffing the current schema against the database state, producing migration SQL.

```bash
npx reactivebase migrate --generate    # Generates migration file
npx reactivebase migrate --apply       # Applies pending migrations
npx reactivebase migrate --status      # Shows migration state
npx reactivebase migrate --rollback    # Rolls back last migration
```

**Acceptance criteria:**
- Migrations are standard SQL files that can be reviewed, edited, and version-controlled
- Non-destructive changes (add column, add table, add index) are auto-generated
- Destructive changes (drop column, drop table) require explicit confirmation
- Migration history is tracked in a `_reactivebase_migrations` table
- Migrations work with standard Postgres tooling (can be applied via psql if needed)
- Zero-downtime migration guidance: framework warns when a migration may require table locks

#### 5.1.2 Query Builder

**FR-103: Type-safe query builder with Postgres-native capabilities.**

The query builder provides a fluent API for constructing queries that is fully typed based on the schema definition.

```typescript
// Basic filtering
ctx.db.tasks.where({ assigneeId: userId, done: false })

// Complex filters
ctx.db.tasks
  .where({ assigneeId: userId })
  .where("priority", "in", ["high", "critical"])
  .where("dueDate", "<", new Date())
  .orderBy("priority", "desc")
  .limit(20)

// Joins (typed based on v.id() references)
ctx.db.tasks
  .where({ done: false })
  .join("users", "assigneeId")  // Type-safe: knows assigneeId references users
  .select("tasks.*", "users.name as assigneeName")

// Aggregations
ctx.db.tasks
  .where({ assigneeId: userId })
  .groupBy("priority")
  .select("priority", ctx.db.fn.count("*").as("count"))

// Full-text search (Postgres native)
ctx.db.tasks
  .whereTextSearch("title", "urgent bug fix")
  .orderByRelevance()
```

**Acceptance criteria:**
- All filter operators produce type-safe comparisons (cannot compare string field with number)
- Join paths are validated at compile time based on `v.id()` references in the schema
- Query builder produces parameterized SQL (no SQL injection risk)
- `explain()` method returns the Postgres query plan for performance debugging
- Raw SQL escape hatch: `ctx.db.raw<T>(sql, params)` for queries that exceed the builder's capabilities
- Query builder supports Postgres-specific features: JSONB operators, array operators, `ILIKE`, `ANY/ALL`, window functions via raw SQL

**FR-104: Relation definitions and nested queries.**

Developers define relationships between tables for convenient nested data loading.

```typescript
export default defineSchema({
  tasks: defineTable({
    // ... fields
    assigneeId: v.id("users"),
  })
    .relation("assignee", { from: "assigneeId", to: "users" })
    .relation("comments", { from: "id", to: "comments.taskId" }),

  comments: defineTable({
    taskId: v.id("tasks"),
    authorId: v.id("users"),
    // ... fields
  })
    .relation("author", { from: "authorId", to: "users" }),
})

// Usage in queries
const tasksWithComments = await ctx.db.tasks
  .where({ assigneeId: userId })
  .include({
    assignee: true,
    comments: {
      include: { author: true },
      orderBy: { createdAt: "desc" },
      limit: 10,
    },
  })
```

**Acceptance criteria:**
- Relations are resolved using efficient SQL (single query with lateral joins, not N+1)
- Nested includes are type-safe: available relations are autocompleted based on schema definitions
- Circular relations are handled (A has many B, B belongs to A)
- Include queries participate in the reactivity system (live updates when related records change)

### 5.2 Server Functions

#### 5.2.1 Queries (Reactive Reads)

**FR-201: Reactive query functions that automatically push updates to subscribed clients.**

Queries are the core primitive. A query is a function that reads data and returns results. When a client subscribes to a query, the framework ensures the client always has the latest results.

```typescript
import { query } from "reactivebase/server"

// Simple reactive query
export const listTasks = query(async (ctx, { assigneeId }: { assigneeId: string }) => {
  return ctx.db.tasks
    .where({ assigneeId, done: false })
    .orderBy("priority", "desc")
    .include({ assignee: true })
})

// Query with authentication
export const myTasks = query(async (ctx) => {
  const userId = ctx.auth.requireUser()  // Throws if not authenticated
  return ctx.db.tasks.where({ assigneeId: userId, done: false })
})

// Query with computed data
export const taskStats = query(async (ctx, { teamId }: { teamId: string }) => {
  const members = await ctx.db.users.where({ teamId })
  const memberIds = members.map(m => m.id)

  const [total, completed, overdue] = await Promise.all([
    ctx.db.tasks.where("assigneeId", "in", memberIds).count(),
    ctx.db.tasks.where("assigneeId", "in", memberIds).where({ done: true }).count(),
    ctx.db.tasks
      .where("assigneeId", "in", memberIds)
      .where({ done: false })
      .where("dueDate", "<", new Date())
      .count(),
  ])

  return { total, completed, overdue, completionRate: total > 0 ? completed / total : 0 }
})
```

**Acceptance criteria:**
- Query functions receive a context object with database access and authentication info
- Query arguments are validated using the function's TypeScript types (runtime validation via schema)
- Queries are read-only: attempting to call `insert`, `update`, or `delete` inside a query throws at compile time and runtime
- Queries execute inside a Postgres `READ COMMITTED` transaction (consistent snapshot)
- Multiple database reads within a single query see a consistent snapshot
- Query results are serializable (JSON-compatible types)

**FR-202: Client-side query subscriptions with automatic re-execution.**

When a client subscribes to a query, the framework tracks which tables and filter conditions the query accessed. When a mutation modifies data that could affect the query's results, the framework re-executes the query and pushes updated results if they differ.

**Acceptance criteria:**
- Client subscribes via: `const tasks = useQuery(api.listTasks, { assigneeId: "123" })`
- Initial results are delivered immediately (same as a one-shot fetch)
- When a mutation modifies the `tasks` table, queries that accessed that table are re-evaluated
- Only changed results are sent to the client (diff-based updates, not full result replacement)
- If re-execution produces identical results, no update is sent (prevents unnecessary re-renders)
- Subscription management handles: client disconnect/reconnect, argument changes, component unmount
- Queries that access multiple tables are invalidated when any of those tables change

**FR-203: One-shot (non-reactive) query mode.**

For queries that do not need live updates (e.g., data exports, admin reports), a non-reactive mode avoids the overhead of subscription tracking.

```typescript
// Server-side
export const exportTasks = query(async (ctx, filters) => {
  return ctx.db.tasks.where(filters)
}, { reactive: false })

// Client-side
const tasks = await fetchQuery(api.exportTasks, filters)  // Returns data, no subscription
```

**Acceptance criteria:**
- Non-reactive queries skip dependency tracking and subscription registration
- Non-reactive queries return a promise (resolved once) instead of a reactive subscription
- Performance: non-reactive queries have lower overhead than reactive queries

#### 5.2.2 Mutations (Transactional Writes)

**FR-301: Automatically transactional mutation functions.**

Mutations are functions that modify data. Every mutation executes inside a serializable Postgres transaction. If any operation fails, the entire mutation rolls back.

```typescript
import { mutation } from "reactivebase/server"

export const completeTask = mutation(async (ctx, { taskId }: { taskId: string }) => {
  const task = await ctx.db.tasks.getOrThrow(taskId)

  // All writes are in a single transaction
  await ctx.db.tasks.update(taskId, {
    done: true,
    updatedAt: new Date(),
  })

  await ctx.db.comments.insert({
    taskId,
    authorId: ctx.auth.requireUser(),
    body: "Marked as complete",
  })

  // Schedule a follow-up action (runs outside the transaction, after commit)
  await ctx.scheduler.runAfter("5m", api.notifications.sendSummary, {
    userId: task.assigneeId,
  })

  return { success: true }
})

export const reassignTasks = mutation(async (ctx, {
  fromUserId,
  toUserId,
}: {
  fromUserId: string
  toUserId: string
}) => {
  const tasks = await ctx.db.tasks.where({ assigneeId: fromUserId, done: false })

  // Bulk update - all within the same transaction
  for (const task of tasks) {
    await ctx.db.tasks.update(task.id, { assigneeId: toUserId })
  }

  return { reassigned: tasks.length }
})
```

**Acceptance criteria:**
- Every mutation executes inside a `SERIALIZABLE` isolation level transaction
- If any database operation within the mutation throws, all changes roll back
- Serialization failures (Postgres error code `40001`) are automatically retried (up to configurable max, default 3)
- Mutations can read and write data (full database access)
- Mutations receive typed arguments validated at runtime
- Mutation return values are delivered to the calling client
- Scheduled actions (`ctx.scheduler.runAfter`) are enqueued after the transaction commits (not during), preventing orphaned jobs if the transaction rolls back
- Mutations trigger reactivity: after commit, the framework identifies affected queries and pushes updates

**FR-302: Optimistic updates on the client.**

The client SDK supports optimistic updates: the UI reflects the expected mutation result immediately while the actual mutation executes server-side.

```typescript
const completeTask = useMutation(api.completeTask, {
  optimisticUpdate: (localStore, { taskId }) => {
    localStore.update("tasks", taskId, { done: true })
  },
})

// UI updates instantly, then confirms or rolls back when server responds
await completeTask({ taskId: "abc123" })
```

**Acceptance criteria:**
- Optimistic updates apply immediately to the local query cache
- If the server mutation succeeds, the optimistic update is confirmed (no flicker)
- If the server mutation fails, the optimistic update rolls back and queries revert to server state
- Optimistic updates work correctly with multiple concurrent mutations
- Type-safe: the `localStore.update()` API knows the schema types

**FR-303: Mutation input validation.**

Mutations validate their inputs at runtime using schemas derived from TypeScript types, with support for custom validation rules.

```typescript
export const createTask = mutation({
  args: {
    title: v.string({ minLength: 1, maxLength: 500 }),
    priority: v.enum("low", "medium", "high", "critical"),
    assigneeId: v.id("users"),
    dueDate: v.optional(v.timestamp({ min: "now" })),  // Cannot be in the past
  },
  handler: async (ctx, args) => {
    // args is fully typed and validated
    return ctx.db.tasks.insert({
      ...args,
      done: false,
      createdAt: new Date(),
    })
  },
})
```

**Acceptance criteria:**
- Validation errors return structured error objects with field-level details
- Client SDK surfaces validation errors in a format compatible with form libraries
- Custom validation functions can access the database (e.g., check uniqueness)
- Validation runs before the transaction begins (fast-fail for invalid inputs)

#### 5.2.3 Actions (Background Jobs & Side Effects)

**FR-401: Action functions for background processing and external API calls.**

Actions are functions that perform side effects (send emails, call external APIs, process files). Unlike mutations, actions do not run inside a database transaction and can take arbitrary time to execute.

```typescript
import { action } from "reactivebase/server"

export const sendWelcomeEmail = action(async (ctx, { userId }: { userId: string }) => {
  const user = await ctx.db.users.get(userId)
  if (!user) throw new Error("User not found")

  await emailService.send({
    to: user.email,
    template: "welcome",
    data: { name: user.name },
  })

  // Actions can call mutations to write data
  await ctx.runMutation(api.users.markEmailSent, { userId })
})

export const processUpload = action(async (ctx, { fileUrl }: { fileUrl: string }) => {
  const file = await fetch(fileUrl)
  const processed = await imageProcessor.resize(await file.arrayBuffer(), { width: 800 })

  const storedUrl = await storage.upload(processed, "processed/")

  await ctx.runMutation(api.files.setProcessedUrl, {
    originalUrl: fileUrl,
    processedUrl: storedUrl,
  })
})
```

**Acceptance criteria:**
- Actions execute outside of a database transaction
- Actions can read from the database (non-transactional reads)
- Actions can call mutations (which execute in their own transactions)
- Actions support configurable retries, timeouts, and backoff strategies
- Failed actions are recorded with error details for debugging
- Actions can be triggered from mutations via `ctx.scheduler.runAfter(delay, actionRef, args)`
- Actions can be triggered on a schedule via cron expressions
- Actions can be triggered directly from the client (with appropriate auth checks)

**FR-402: Job scheduling and cron.**

The framework includes built-in job scheduling, eliminating the need for a separate job queue system.

```typescript
// Trigger from a mutation (runs after transaction commits)
export const createUser = mutation(async (ctx, args) => {
  const user = await ctx.db.users.insert(args)

  // Fire-and-forget: runs in background after mutation commits
  await ctx.scheduler.runAfter("0s", api.actions.sendWelcomeEmail, { userId: user.id })

  // Delayed execution
  await ctx.scheduler.runAfter("24h", api.actions.sendOnboardingTip, { userId: user.id })

  // Scheduled for a specific time
  await ctx.scheduler.runAt(
    new Date("2026-03-01T09:00:00Z"),
    api.actions.sendTrialExpiry,
    { userId: user.id }
  )

  return user
})

// Cron-scheduled actions
export const dailyDigest = action(async (ctx) => {
  const users = await ctx.db.users.where({ digestEnabled: true })
  for (const user of users) {
    await ctx.scheduler.runAfter("0s", api.actions.sendDigestEmail, { userId: user.id })
  }
}, {
  cron: "0 9 * * *",
  timezone: "UTC",
})
```

**Acceptance criteria:**
- Scheduled jobs are persisted (survive server restarts)
- Scheduled jobs enqueued within a mutation are only dispatched after the transaction commits
- Cron jobs use distributed locking to prevent duplicate execution across multiple server instances
- Job execution is observable: status, duration, retry count, error details
- Cancellation of scheduled jobs is supported via a returned job ID
- At-least-once delivery guarantee for all scheduled jobs
- Configurable retry strategies per action (max retries, backoff, timeout)

### 5.3 Reactivity Engine

This is the core IP of ReactiveBase and the primary engineering challenge.

#### 5.3.1 Dependency Tracking

**FR-501: Automatic query dependency tracking at the table and filter level.**

When a query executes, the framework records which tables it accessed and what filter conditions it applied. This information determines which queries need re-evaluation when data changes.

**Dependency granularity levels (from coarsest to finest):**

```
Level 1 - Table level:
  "This query reads from the tasks table"
  → Invalidate when ANY write to tasks occurs
  → Simple, high false-positive rate

Level 2 - Table + filter level (target for v1):
  "This query reads tasks WHERE assigneeId = '123' AND done = false"
  → Invalidate when a write to tasks affects rows matching these conditions
  → Good balance of precision and implementation complexity

Level 3 - Row level:
  "This query returned rows with IDs [a, b, c]"
  → Invalidate only when these specific rows change
  → Most precise, highest implementation complexity and memory cost
```

**Acceptance criteria:**
- The framework tracks dependencies at Level 2 (table + filter) for the initial release
- Dependency tracking is automatic: developers do not annotate queries with dependency information
- The query builder instruments all `.where()`, `.join()`, and `.include()` calls to record accessed tables and filter conditions
- Raw SQL queries (`ctx.db.raw()`) fall back to Level 1 (table-level) dependency tracking
- Dependency information is stored in-memory on the server instance that executed the query
- Memory overhead per active subscription is bounded and documented (target: < 1 KB per subscription)

**FR-502: Change detection from mutations.**

When a mutation commits, the framework determines which tables were modified and what the nature of the changes was (inserts, updates, deletes) to evaluate which subscriptions need re-execution.

**Acceptance criteria:**
- The framework captures the set of tables modified by a mutation and the affected filter dimensions
- For inserts: the framework knows which table received a new row and the values of indexed/filtered columns
- For updates: the framework knows which table, which rows (by primary key), and which columns changed
- For deletes: the framework knows which table and which rows were removed
- This information is derived from the query builder's write operations (not from Postgres triggers, in the initial implementation)
- External writes to Postgres (not through ReactiveBase) are detected via LISTEN/NOTIFY or logical replication (see FR-504)

**FR-503: Subscription invalidation and re-execution.**

When a mutation's change set intersects with a subscription's dependency set, the framework re-executes the query and pushes updated results.

**Invalidation logic (table + filter level):**

```
Mutation writes to tasks table with:
  - Insert: assigneeId = "123", done = false, priority = "high"

Subscription A: tasks WHERE assigneeId = "123" AND done = false
  → Filter match on assigneeId AND done → INVALIDATE

Subscription B: tasks WHERE assigneeId = "456" AND done = false
  → Filter mismatch on assigneeId → SKIP (no re-execution needed)

Subscription C: tasks WHERE done = true
  → Filter mismatch on done → SKIP

Subscription D: tasks (no filter, e.g., count all tasks)
  → Table match, no filter to exclude → INVALIDATE
```

**Acceptance criteria:**
- Invalidation is evaluated in-memory (no additional database queries for the evaluation itself)
- Only subscriptions whose filter conditions could be affected by the change are re-executed
- Re-execution produces a new result set that is compared (deep equality) to the previous result
- If results are identical, no update is sent to the client (avoids unnecessary re-renders)
- If results differ, only the diff (or full new result, depending on result size) is sent
- Invalidation evaluation target: < 1ms per subscription check for in-memory filter matching
- Re-execution is batched: if a mutation triggers invalidation of 100 subscriptions, they are re-executed in parallel with configurable concurrency

**FR-504: External change detection.**

Changes made to Postgres outside of ReactiveBase (direct SQL, other applications, migration scripts) are detected and trigger appropriate invalidations.

**Acceptance criteria:**
- Postgres LISTEN/NOTIFY channels are used to broadcast table-level change notifications
- The framework installs lightweight Postgres triggers on managed tables that issue NOTIFY on INSERT/UPDATE/DELETE
- External changes trigger Level 1 (table-level) invalidation (since filter details are not available)
- Logical replication is supported as an alternative to triggers for high-throughput scenarios (optional, advanced configuration)
- External change detection can be disabled per-table for performance-sensitive scenarios

#### 5.3.2 Client Communication

**FR-505: WebSocket-based subscription transport.**

The framework manages WebSocket connections between clients and the server for delivering reactive query updates.

**Acceptance criteria:**
- Each client maintains a single WebSocket connection to the server (multiplexed subscriptions)
- Connection protocol handles: authentication, subscription registration, subscription updates, subscription cancellation, heartbeat/keepalive, reconnection
- Server-side connection state tracks: active subscriptions, last-sent results (for diffing), authentication context
- Connection is authenticated: subscriptions respect the same auth rules as the initial query
- Backpressure: if a client is slow to consume updates, the server buffers up to a configurable limit before dropping the connection
- Binary protocol (MessagePack or similar) optional for bandwidth-sensitive applications; JSON default

**FR-506: Reconnection and state synchronization.**

Clients that disconnect and reconnect receive a consistent state without missing intermediate updates.

**Acceptance criteria:**
- Client SDK automatically reconnects with exponential backoff on disconnection
- On reconnection, client sends its last-known state version for each active subscription
- Server compares last-known version to current state and sends a minimal update (or full re-send if gap is too large)
- During disconnection, client retains the last-known data (stale but available) and marks it as potentially stale
- Reconnection does not cause a flash of empty state followed by data (seamless for the user)

#### 5.3.3 Multi-Server Reactivity

**FR-507: Redis pub/sub for cross-server invalidation.**

In multi-server deployments, mutations on one server must trigger invalidations on all servers that hold affected subscriptions.

```
┌──────────┐         ┌──────────────┐         ┌──────────┐
│ Server A │         │    Redis     │         │ Server B │
│          │         │   Pub/Sub    │         │          │
│ Mutation │───────▶ │              │ ───────▶│ Evaluate │
│ commits  │ publish │  "tasks"     │subscribe│ local    │
│          │ change  │  channel     │         │ subs     │
│          │ event   │              │         │          │
└──────────┘         └──────────────┘         └──────────┘
```

**Acceptance criteria:**
- After a mutation commits, the originating server publishes a change event to Redis pub/sub
- Change events include: table name, operation type (insert/update/delete), and affected filter dimensions
- All servers subscribe to change event channels and evaluate their local subscriptions
- Redis pub/sub message size is minimized (no row data, only metadata needed for invalidation evaluation)
- If Redis is unavailable, the framework degrades to periodic polling for invalidation (configurable interval, default 5 seconds)
- In single-server deployments, invalidation is local (no Redis required for single-server setups)

### 5.4 Authentication & Authorization

#### 5.4.1 Authentication

**FR-601: Pluggable authentication with built-in JWT support.**

The framework provides a flexible authentication layer that supports common auth providers.

```typescript
// reactivebase.config.ts
export default defineConfig({
  auth: {
    providers: [
      jwtProvider({
        issuer: "https://auth.myapp.com",
        audience: "myapp-api",
        jwksUrl: "https://auth.myapp.com/.well-known/jwks.json",
      }),
      // Or bring your own
      customProvider(async (request) => {
        const token = request.headers.get("Authorization")
        const user = await verifyToken(token)
        return { userId: user.id, role: user.role }
      }),
    ],
  },
})
```

**Acceptance criteria:**
- JWT verification with JWKS rotation support
- Integration guides for: Clerk, Auth0, Supabase Auth, NextAuth.js, custom JWT
- Auth context is available in all server functions via `ctx.auth`
- `ctx.auth.requireUser()` throws an authentication error if no valid user
- `ctx.auth.userId` and `ctx.auth.claims` provide typed access to user info
- Authentication is evaluated once per WebSocket connection and cached (re-evaluated on token refresh)
- Unauthenticated queries/mutations are supported for public endpoints

#### 5.4.2 Authorization

**FR-602: Function-level and row-level authorization.**

Developers define access control rules that are enforced automatically.

```typescript
// Function-level auth
export const deleteTask = mutation({
  args: { taskId: v.id("tasks") },
  auth: (ctx) => ctx.auth.requireRole("admin"),
  handler: async (ctx, { taskId }) => {
    await ctx.db.tasks.delete(taskId)
  },
})

// Row-level security (applied to all queries on a table)
export default defineSchema({
  tasks: defineTable({ /* ... */ })
    .rowLevelSecurity((ctx, row) => {
      // Users can only see their own tasks, admins see all
      if (ctx.auth.claims.role === "admin") return true
      return row.assigneeId === ctx.auth.userId
    }),
})
```

**Acceptance criteria:**
- Authorization functions run before the main handler
- Authorization failures return a structured 403 error (not a generic 500)
- Row-level security policies are applied as additional WHERE clauses in queries (pushed down to Postgres, not filtered in application code)
- RLS policies are applied consistently across all access paths (direct queries, joins, includes)
- RLS policies participate in reactivity: if a row becomes visible/invisible to a user due to a data change, their subscriptions update accordingly

### 5.5 Client SDK

#### 5.5.1 React Integration

**FR-701: React hooks for reactive queries and mutations.**

```typescript
import { useQuery, useMutation, useAction } from "reactivebase/react"
import { api } from "../convex/_generated/api"  // Generated from schema

function TaskList({ userId }: { userId: string }) {
  // Reactive query: re-renders when data changes
  const tasks = useQuery(api.tasks.listTasks, { assigneeId: userId })

  // Mutation with optimistic update
  const completeTask = useMutation(api.tasks.completeTask, {
    optimisticUpdate: (localStore, { taskId }) => {
      localStore.update("tasks", taskId, { done: true })
    },
  })

  // Loading and error states
  if (tasks === undefined) return <Spinner />
  if (tasks instanceof Error) return <ErrorView error={tasks} />

  return (
    <ul>
      {tasks.map(task => (
        <li key={task.id}>
          {task.title}
          <button onClick={() => completeTask({ taskId: task.id })}>
            Complete
          </button>
        </li>
      ))}
    </ul>
  )
}
```

**Acceptance criteria:**
- `useQuery` returns `undefined` during initial load, then the typed result, enabling loading state handling
- `useQuery` automatically re-renders the component when the server pushes updated results
- `useQuery` unsubscribes when the component unmounts
- `useQuery` with changing arguments automatically unsubscribes from the old query and subscribes to the new one
- `useMutation` returns a typed function that calls the server mutation
- `useMutation` supports optimistic updates with automatic rollback on failure
- `useAction` triggers background actions and returns a handle for tracking progress
- All hooks are compatible with React Suspense and Error Boundaries
- Generated `api` object provides full autocompletion for function names and argument types

**FR-702: Framework-agnostic client core.**

The reactive subscription engine is framework-agnostic, with React hooks as one adapter.

**Acceptance criteria:**
- `@reactivebase/client` provides the core subscription engine (WebSocket management, caching, optimistic updates)
- `@reactivebase/react` wraps the client core in React hooks
- Additional framework adapters can be built for: Vue (`@reactivebase/vue`), Svelte (`@reactivebase/svelte`), Solid (`@reactivebase/solid`)
- The client core is usable in non-framework contexts (Node.js scripts, CLI tools, server-side rendering)
- Client core handles: connection management, subscription multiplexing, local cache, optimistic updates, reconnection

**FR-703: Server-side rendering support.**

Reactive queries can be pre-fetched during server-side rendering for initial page load performance.

```typescript
// Next.js App Router example
import { preloadQuery } from "reactivebase/nextjs"

export default async function TaskPage({ params }) {
  const preloaded = await preloadQuery(api.tasks.listTasks, {
    assigneeId: params.userId,
  })

  return <TaskList preloaded={preloaded} />
}

// Component hydrates and becomes reactive after initial render
function TaskList({ preloaded }) {
  const tasks = usePreloadedQuery(preloaded)
  // ...
}
```

**Acceptance criteria:**
- `preloadQuery` executes the query server-side and serializes the result
- `usePreloadedQuery` hydrates the preloaded result on the client and establishes a reactive subscription
- No loading flash: the component renders immediately with server-fetched data, then transitions to reactive mode
- Framework integrations for: Next.js App Router, Next.js Pages Router, Remix, and generic SSR

### 5.6 Developer Experience

#### 5.6.1 Project Setup

**FR-801: Zero-config project scaffolding.**

```bash
npx create-reactivebase@latest my-app
cd my-app
npm run dev
```

**Acceptance criteria:**
- Scaffolding creates a project with: schema definition, example query/mutation/action, TypeScript configuration, dev server, and README
- `npm run dev` starts a local server with an embedded Postgres (via embedded-postgres or pg-mem for testing) for true zero-dependency local development
- Hot reload on file changes (schema, server functions)
- Type generation runs automatically on schema changes
- Dev dashboard available at `http://localhost:4001` showing active subscriptions, recent mutations, and scheduled jobs

**FR-802: Type generation.**

The framework generates TypeScript types from the schema definition and server function signatures, providing end-to-end type safety.

**Acceptance criteria:**
- Running `npx reactivebase generate` produces a `_generated/` directory with:
  - `api.ts`: typed references to all server functions
  - `dataModel.ts`: TypeScript types for all tables
  - `server.ts`: typed context objects for server functions
- Generation runs automatically in dev mode on file changes
- Generated types are deterministic (same input always produces same output, suitable for version control)
- No runtime code generation: all types are compile-time only

#### 5.6.2 Local Development

**FR-803: Development server with observability.**

The local development server provides built-in tools for understanding system behavior.

**Acceptance criteria:**
- Dev server logs: every query execution, mutation, subscription invalidation, and scheduled job
- Dev dashboard shows:
  - Active WebSocket connections and their subscriptions
  - Mutation timeline with transaction details
  - Reactivity graph: which mutations triggered which query re-executions
  - Scheduled job queue with status and timing
  - Database query log with execution times and explain plans
- One-click query replay: re-execute any query from the dashboard for debugging
- Simulated latency: configurable artificial delay for testing loading states and optimistic updates

#### 5.6.3 CLI Tooling

**FR-804: CLI for development and production operations.**

```bash
reactivebase dev              # Start development server
reactivebase generate         # Generate types from schema
reactivebase migrate          # Database migration commands
reactivebase deploy           # Deploy to production (cloud tier)
reactivebase logs             # Tail production logs
reactivebase functions list   # List all defined functions
reactivebase functions run    # Execute a function manually (for debugging)
reactivebase subscriptions    # List active subscriptions (production)
reactivebase jobs             # View scheduled/running jobs
```

**Acceptance criteria:**
- All commands support `--help` with examples
- `reactivebase functions run` accepts JSON arguments and prints the result
- `reactivebase subscriptions` shows active subscription count per query, useful for capacity planning
- CLI connects to both local dev server and remote production instances

### 5.7 Observability & Operations

#### 5.7.1 Metrics

**FR-901: Built-in metrics for monitoring reactivity performance.**

**Acceptance criteria:**
- Prometheus-compatible metrics endpoint on configurable port
- Core metrics:
  - `reactivebase_queries_executed_total` (counter, by query name)
  - `reactivebase_query_duration_seconds` (histogram, by query name)
  - `reactivebase_mutations_executed_total` (counter, by mutation name)
  - `reactivebase_mutation_duration_seconds` (histogram, by mutation name)
  - `reactivebase_subscriptions_active` (gauge, by query name)
  - `reactivebase_invalidations_total` (counter, by query name, reason: mutation/external)
  - `reactivebase_invalidations_skipped_total` (counter, filter-level skips)
  - `reactivebase_serialization_retries_total` (counter)
  - `reactivebase_websocket_connections_active` (gauge)
  - `reactivebase_scheduled_jobs_pending` (gauge)
  - `reactivebase_scheduled_jobs_executed_total` (counter, by action name, status)

#### 5.7.2 Tracing

**FR-902: OpenTelemetry distributed tracing.**

**Acceptance criteria:**
- Every query, mutation, and action execution creates a trace span
- Mutation traces include child spans for: transaction begin, each database operation, transaction commit, invalidation evaluation, and scheduled job enqueue
- Reactivity traces link: mutation span to invalidation evaluation span to query re-execution span to WebSocket push span
- Custom attributes: function name, argument hash (not full args, for privacy), result size, subscription count affected
- Compatible with: Jaeger, Honeycomb, Datadog, Grafana Tempo, and any OTLP-compatible backend

#### 5.7.3 Logging

**FR-903: Structured logging with context.**

**Acceptance criteria:**
- All framework operations produce structured JSON logs
- Log entries include: timestamp, level, function name, request ID, user ID (if authenticated), duration
- Developers can log from server functions via `ctx.log.info/warn/error(message, data)`
- Log levels are configurable per function (e.g., debug logging for a specific query while others are at info level)
- Sensitive data redaction: configurable fields that are masked in logs

### 5.8 Deployment & Scaling

#### 5.8.1 Infrastructure Requirements

**FR-1001: Minimal production infrastructure.**

```
Required:
  - Postgres 14+ (primary database, source of truth)
  - Node.js 20+ runtime

Required for multi-server deployments:
  - Redis 7+ (pub/sub for cross-server invalidation, subscription state)

Optional:
  - OpenTelemetry collector (tracing)
  - Prometheus (metrics)
```

**Acceptance criteria:**
- Single-server deployment requires only Postgres (no Redis)
- Multi-server deployment adds Redis for cross-server reactivity
- Docker Compose file provided for local production-like setup
- Helm chart provided for Kubernetes deployment
- Compatible with managed Postgres (RDS, Cloud SQL, Supabase Postgres, Neon)
- Compatible with managed Redis (ElastiCache, Upstash, Redis Cloud)

#### 5.8.2 Horizontal Scaling

**FR-1002: Stateless server processes for horizontal scaling.**

**Acceptance criteria:**
- Server processes are stateless (subscription state is in-memory but reconstructed on restart)
- Adding more server processes increases capacity linearly
- WebSocket connections are distributed across servers via a load balancer (sticky sessions recommended but not required)
- If a server process crashes, clients reconnect to another server and re-establish subscriptions
- Redis pub/sub ensures mutations on any server trigger invalidations across all servers
- No leader election or coordination protocol required between server processes

#### 5.8.3 Performance Characteristics

**FR-1003: Documented performance targets and tuning guidance.**

| Metric | Target (single server) | Target (multi-server) |
|--------|----------------------|----------------------|
| Query latency (p50) | < 5ms | < 10ms |
| Query latency (p99) | < 50ms | < 100ms |
| Mutation latency (p50) | < 10ms | < 20ms |
| Mutation latency (p99) | < 100ms | < 200ms |
| Subscription update delivery (p50) | < 50ms after commit | < 100ms after commit |
| Subscription update delivery (p99) | < 200ms after commit | < 500ms after commit |
| Max concurrent subscriptions per server | 50,000 | N/A (distribute) |
| Max mutations per second per server | 5,000 | N/A (distribute) |

**Acceptance criteria:**
- Performance benchmarks are reproducible and published
- Tuning guide documents: Postgres connection pool sizing, Redis pub/sub channel design, invalidation batching, subscription memory management
- Degradation is graceful: under load, latency increases but no data loss or subscription loss
- Backpressure mechanisms prevent server OOM from unbounded subscription growth

---

## 6. Non-Functional Requirements

### 6.1 Consistency

- Mutations are serializable (strongest Postgres isolation level)
- Serialization failures are retried automatically (up to configurable limit)
- Reactive query updates are eventually consistent: after a mutation commits, all affected subscriptions receive updated results within the target latency
- No split-brain: a subscription never shows a state that combines pre-mutation and post-mutation data
- Optimistic updates on the client may show a temporarily inconsistent state, which resolves when the server confirms or rejects

### 6.2 Reliability

- Server process crashes do not lose committed data (Postgres is the source of truth)
- Server process crashes cause temporary subscription disconnection; clients reconnect and receive current state
- Scheduled jobs are persisted in Postgres; server restarts do not lose pending jobs
- Redis unavailability in multi-server mode causes degraded reactivity (periodic polling fallback), not data loss
- WebSocket connection failures are handled with automatic reconnection and state resynchronization

### 6.3 Security

- All WebSocket connections authenticated (no anonymous subscriptions by default; opt-in public queries)
- Row-level security policies enforced at the database query level (not application-level filtering)
- SQL injection prevention via parameterized queries (no string interpolation in generated SQL)
- Mutation arguments validated before transaction begins
- Rate limiting configurable per function and per client
- HTTPS/WSS required in production mode
- No eval() or dynamic code execution
- Secrets (database connection strings, JWT keys) loaded from environment variables, never stored in code

### 6.4 Compatibility

- Node.js 20+ (LTS)
- TypeScript 5.0+
- Postgres 14+ (uses `FOR UPDATE SKIP LOCKED`, `LISTEN/NOTIFY`, serializable isolation)
- Redis 7+ (pub/sub, optional)
- Client: all modern browsers (Chrome, Firefox, Safari, Edge, last 2 versions)
- React 18+ for React hooks
- Next.js 14+ for SSR integration
- Tested on: Linux (x64, ARM64), macOS (ARM64)

---

## 7. Architecture Overview

### 7.1 System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client Tier                           │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐    │
│  │ React Hooks │  │ Vue/Svelte  │  │ Vanilla Client   │    │
│  │ useQuery()  │  │ Adapters    │  │ subscribe()      │    │
│  └──────┬──────┘  └──────┬──────┘  └────────┬─────────┘    │
│         └────────────────┼──────────────────┘               │
│                    ┌─────▼──────┐                            │
│                    │ Client Core│                            │
│                    │ WebSocket  │                            │
│                    │ Cache      │                            │
│                    │ Optimistic │                            │
│                    └─────┬──────┘                            │
└──────────────────────────┼──────────────────────────────────┘
                           │ WSS
┌──────────────────────────▼──────────────────────────────────┐
│                       Server Tier                            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   HTTP + WebSocket Server              │   │
│  │  ┌──────────┐  ┌────────────┐  ┌──────────────────┐  │   │
│  │  │ Query    │  │ Mutation   │  │ Action           │  │   │
│  │  │ Router   │  │ Router     │  │ Router           │  │   │
│  │  └────┬─────┘  └─────┬──────┘  └────────┬─────────┘  │   │
│  └───────┼──────────────┼──────────────────┼─────────────┘   │
│          │              │                  │                  │
│  ┌───────▼──────────────▼──────────────────▼─────────────┐   │
│  │                  Function Executor                     │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │   │
│  │  │ Dependency   │  │ Transaction  │  │ Scheduler  │  │   │
│  │  │ Tracker      │  │ Manager      │  │ Engine     │  │   │
│  │  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘  │   │
│  └─────────┼────────────────┼────────────────┼───────────┘   │
│            │                │                │               │
│  ┌─────────▼────────────────▼────────────────▼───────────┐   │
│  │                Reactivity Engine                       │   │
│  │  ┌──────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │ Subscription │  │ Invalidation│  │ Result      │  │   │
│  │  │ Registry     │  │ Evaluator   │  │ Differ      │  │   │
│  │  └──────────────┘  └─────────────┘  └─────────────┘  │   │
│  └───────────────────────────┬───────────────────────────┘   │
└──────────────────────────────┼───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│                      Infrastructure Tier                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐   │
│  │  Postgres    │  │  Redis       │  │  (Optional)       │   │
│  │  - Tables    │  │  - Pub/Sub   │  │  OTEL Collector   │   │
│  │  - Triggers  │  │  - Sessions  │  │  Prometheus       │   │
│  │  - Jobs table│  │              │  │                   │   │
│  └──────────────┘  └──────────────┘  └───────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### 7.2 Package Structure

```
@reactivebase/server         # Server framework: queries, mutations, actions, reactivity
@reactivebase/client         # Framework-agnostic client core: subscriptions, cache, transport
@reactivebase/react          # React hooks wrapping client core
@reactivebase/nextjs         # Next.js SSR integration
@reactivebase/vue            # Vue composables (Phase 2)
@reactivebase/svelte         # Svelte stores (Phase 2)
@reactivebase/cli            # CLI tooling
@reactivebase/testing        # Test utilities, in-memory server
create-reactivebase          # Project scaffolding
```

### 7.3 Reactivity Data Flow

```
1. Client subscribes to query
   Client ──WSS──▶ Server: { subscribe: "listTasks", args: { userId: "123" } }

2. Server executes query and tracks dependencies
   Server: execute listTasks({ userId: "123" })
   Server: dependency = { table: "tasks", filters: { assigneeId: "123", done: false } }
   Server: result = [{ id: "a", title: "Fix bug", ... }, { id: "b", title: "Review PR", ... }]
   Server ──WSS──▶ Client: { queryId: "q1", data: [...], version: 1 }

3. Mutation modifies data
   Client ──WSS──▶ Server: { mutate: "completeTask", args: { taskId: "a" } }
   Server: BEGIN SERIALIZABLE
   Server: UPDATE tasks SET done = true WHERE id = 'a'
   Server: COMMIT
   Server: changeSet = { table: "tasks", update: { id: "a", changed: { done: true } } }

4. Invalidation evaluation
   Server: subscription "q1" has dependency { table: "tasks", filters: { done: false } }
   Server: mutation changed tasks.done from false to true for row matching filters
   Server: → INVALIDATE q1

5. Re-execution and diff
   Server: re-execute listTasks({ userId: "123" })
   Server: new result = [{ id: "b", title: "Review PR", ... }]  (row "a" no longer matches)
   Server: diff = { removed: ["a"] }
   Server ──WSS──▶ Client: { queryId: "q1", diff: { removed: ["a"] }, version: 2 }

6. Multi-server propagation
   Server A ──Redis pub/sub──▶ Server B: { table: "tasks", change: { ... } }
   Server B: evaluate local subscriptions against change
   Server B: re-execute affected queries, push updates to local clients
```

---

## 8. Release Plan

### 8.1 Phase 1: Core Reactive Framework (Months 1-4)

**Goal:** Deliver a working framework that demonstrates the core value proposition: define queries and mutations in TypeScript, get automatic reactivity and transactions on Postgres.

**Deliverables:**
- Schema definition and migration generation
- Query builder with TypeScript type inference
- Reactive queries with table-level dependency tracking (Level 1)
- Automatic serializable transactions for mutations
- WebSocket subscription transport
- React hooks (`useQuery`, `useMutation`)
- Basic action support (background functions, no scheduling yet)
- `create-reactivebase` scaffolding with embedded Postgres for local dev
- Type generation
- Documentation site with tutorial, API reference, and Convex comparison
- GitHub repository with CI, contributing guide, and examples

**Scope explicitly excluded from Phase 1:**
- Filter-level dependency tracking (Level 2)
- Multi-server support (Redis pub/sub)
- SSR integration
- Job scheduling and cron
- Row-level security
- Dashboard
- Vue/Svelte/Solid adapters

**Success criteria:**
- 1,000+ GitHub stars
- 100+ weekly npm downloads
- 20+ developers building with it (tracked via opt-in telemetry or Discord)
- 5+ community bug reports (signals real usage)
- Positive reception on Hacker News (front page)

### 8.2 Phase 2: Production Readiness (Months 4-8)

**Goal:** Make ReactiveBase viable for production workloads.

**Deliverables:**
- Filter-level dependency tracking (Level 2) for precise invalidation
- Multi-server support via Redis pub/sub
- Job scheduling and cron (built-in scheduler)
- External change detection (Postgres triggers + LISTEN/NOTIFY)
- Optimistic updates in client SDK
- Next.js SSR integration (`preloadQuery`, `usePreloadedQuery`)
- Authentication integration (JWT, Clerk, Auth0 guides)
- Row-level security
- OpenTelemetry tracing
- Prometheus metrics endpoint
- Production deployment guides (Docker, Kubernetes, Fly.io, Railway)
- Performance benchmarks (published, reproducible)

**Success criteria:**
- 3,000+ GitHub stars
- 500+ weekly npm downloads
- 50+ production deployments
- 5+ case studies from production users
- Conference talk accepted (React Summit, Node Congress, or similar)

### 8.3 Phase 3: Ecosystem & Monetization (Months 8-14)

**Goal:** Build the ecosystem and begin generating revenue.

**Deliverables:**
- Observability dashboard (paid tier, source-available)
  - Live subscription viewer
  - Mutation timeline with transaction details
  - Reactivity graph visualization
  - Scheduled job management
  - Historical query performance analytics
- Vue and Svelte adapters
- Relation system with nested queries and reactive includes
- Advanced query builder: aggregations, window functions, subqueries
- File storage integration (S3-compatible, with reactive URLs)
- Plugin system for extending the framework
- Migration tools from Convex, Supabase, and Prisma+tRPC stacks
- Enterprise features: SSO for dashboard, audit logging, dedicated support

**Success criteria:**
- 7,000+ GitHub stars
- 2,000+ weekly npm downloads
- $5,000+ MRR from dashboard and enterprise tiers
- 200+ production deployments
- Active contributor community (20+ external contributors with merged PRs)

### 8.4 Phase 4: Cloud & Scale (Year 2)

**Goal:** Launch managed cloud offering and pursue sustainable growth.

**Deliverables:**
- ReactiveBase Cloud: managed hosting with auto-scaling
- Global edge deployment for low-latency query execution
- Multi-region Postgres with reactive replication
- SOC 2 Type II compliance
- Usage-based pricing for cloud tier
- Row-level (Level 3) dependency tracking for high-precision invalidation at scale

**Success criteria:**
- $25,000+ MRR across all tiers
- 500+ total paying customers
- Path to full-time commitment or seed funding

---

## 9. Competitive Analysis

### 9.1 Detailed Comparison Matrix

| Capability | ReactiveBase | Convex | Supabase | Firebase | Prisma + tRPC + WS | ElectricSQL |
|---|---|---|---|---|---|---|
| Reactive queries | Yes (core feature) | Yes (core feature) | Partial (Realtime add-on) | Yes (Firestore) | Manual assembly | Yes (local-first) |
| Automatic transactions | Yes (serializable) | Yes (serializable) | No (manual) | No (limited) | No (manual) | No |
| Background jobs | Yes (built-in) | Yes (built-in) | No (separate) | Yes (Cloud Functions) | No (separate) | No |
| Self-hosted | Yes (primary) | No | Yes | No | Yes | Yes |
| Database | Postgres | Proprietary | Postgres | Proprietary | Any (via ORM) | Postgres (sync) |
| Raw SQL access | Yes | No | Yes | No | Yes (via ORM) | Limited |
| TypeScript-native | Yes | Yes | Partial | Partial | Yes | Yes |
| Vendor lock-in | None | Total | Low | Total | None | Low |
| Local dev (zero deps) | Yes (embedded PG) | No (cloud required) | No (Docker) | No (emulator) | Manual setup | Yes (SQLite) |
| SSR support | Yes (Next.js, Remix) | Yes (Next.js) | Limited | Limited | Manual | Limited |
| Optimistic updates | Yes (client SDK) | Yes (client SDK) | No | Yes (Firestore SDK) | Manual | Yes (local-first) |
| Client frameworks | React, Vue, Svelte | React | Any | Any (Firebase SDK) | React (tRPC) | React |
| Pricing model | Open core | SaaS | Open core | SaaS | Free (OSS) | Open core |

### 9.2 Positioning Against Key Competitors

**vs. Convex:** "Same DX, your infrastructure." ReactiveBase provides the reactive queries, automatic transactions, and integrated scheduling that make Convex productive, but runs on Postgres you control. You keep your data, your SQL access, and your deployment flexibility. The tradeoff: you operate the infrastructure (or use our cloud tier).

**vs. Supabase:** "Reactivity as a first-class primitive, not a bolt-on." Supabase Realtime is an add-on to a Postgres platform. ReactiveBase makes reactivity the default. Every query is automatically reactive, mutations automatically trigger updates, and the client SDK manages subscriptions seamlessly. Supabase requires you to manually subscribe to table changes and reconcile them with your query logic.

**vs. Firebase/Firestore:** "Real database, real queries, no vendor lock-in." Firebase provides a reactive client SDK but locks you into a proprietary database with limited query capabilities. ReactiveBase gives you the full power of Postgres (joins, aggregations, full-text search, PostGIS) with the same reactive client experience.

**vs. Prisma + tRPC + WebSocket stack:** "All of that, in one framework." ReactiveBase replaces the 4-5 libraries you'd assemble (ORM, API layer, WebSocket server, subscription management, job queue) with a single cohesive framework. Less integration code, fewer moving parts, better DX.

**vs. ElectricSQL:** "Server-authoritative, not local-first." ElectricSQL is excellent for local-first applications where data lives primarily on the client. ReactiveBase is server-authoritative: the database is the source of truth, and the client receives updates. Different architecture for different use cases. ReactiveBase is better suited for multi-user SaaS applications where server-side business logic and authorization are critical.

---

## 10. Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | Reactivity engine performance does not meet targets | Medium | Critical | Start with table-level tracking (simpler, proven approach). Filter-level tracking in Phase 2 after core architecture is validated. Publish benchmarks early to build confidence. |
| 2 | Scope is too large for initial release | High | High | Phase 1 scope is aggressively trimmed: no filter-level tracking, no multi-server, no scheduling, no RLS. Ship the minimum that demonstrates the core value (reactive queries + auto transactions). |
| 3 | Convex releases a self-hosted or open-source tier | Low | High | ReactiveBase's Postgres-native architecture is structurally different from Convex's proprietary engine. Even a self-hosted Convex would not provide raw SQL access, Postgres ecosystem compatibility, or pluggable infrastructure. |
| 4 | Developer mindshare captured by Supabase or Drizzle ecosystem | Medium | Medium | Content strategy emphasizes the integrated reactive experience (not just "another ORM"). Clear comparisons showing what ReactiveBase provides that assembling individual tools does not. |
| 5 | WebSocket scaling becomes a bottleneck | Medium | Medium | Documented scaling guide from Phase 1. Multi-server Redis pub/sub in Phase 2. Sticky sessions and connection draining patterns well understood. |
| 6 | Postgres change detection misses external writes | Low | Medium | Phase 2 adds Postgres triggers for external change detection. LISTEN/NOTIFY for immediate notification. Logical replication as advanced option. |
| 7 | Maintaining multiple client framework adapters is unsustainable | Medium | Low | Client core is framework-agnostic (one codebase). Framework adapters are thin wrappers (< 500 LOC each). Community can contribute adapters using documented interfaces. |
| 8 | Embedded Postgres for local dev is fragile across platforms | Medium | Medium | Use pg-mem for unit testing and lightweight dev. Provide Docker Compose as fallback. Test on Linux, macOS (ARM/x64), and Windows in CI. |
| 9 | Adoption blocked by "not invented here" at larger companies | Medium | Low | Enterprise tier with SLA and support addresses organizational risk concerns. Case studies and production benchmarks provide evidence. Postgres compatibility reduces perceived risk. |
| 10 | Revenue generation takes longer than projected | Medium | Medium | Framework generates independent value (blog content, speaking, consulting). Pro dashboard and enterprise support have proven revenue models in OSS (Sidekiq, Supabase, PostHog). |

---

## 11. Success Metrics

### 11.1 Product Health

| Metric | Phase 1 | Phase 2 | Phase 3 |
|--------|---------|---------|---------|
| GitHub stars | 1,000 | 3,000 | 7,000 |
| npm weekly downloads | 100 | 500 | 2,000 |
| Production deployments | 20 | 50 | 200 |
| Active Discord members | 100 | 300 | 800 |
| External contributors (merged PRs) | 5 | 15 | 30 |

### 11.2 Technical Health

| Metric | Target |
|--------|--------|
| Subscription update latency (p50) | < 50ms |
| Subscription update latency (p99) | < 200ms |
| False invalidation rate (table-level) | < 30% |
| False invalidation rate (filter-level) | < 10% |
| Memory per active subscription | < 1 KB |
| CI test suite pass rate | > 99.5% |
| Benchmark regression (version over version) | < 5% |

### 11.3 Business Health

| Metric | Phase 2 | Phase 3 | Phase 4 |
|--------|---------|---------|---------|
| MRR | - | $5,000 | $25,000 |
| Paying customers | - | 50 | 300 |
| Enterprise customers | - | 5 | 25 |
| Monthly churn | - | < 8% | < 5% |

### 11.4 North Star Metric

**Active reactive subscriptions across all production deployments** (opt-in, anonymous telemetry).

This metric captures both adoption breadth (number of deployments) and depth (how deeply teams rely on reactivity). Growth indicates that ReactiveBase is becoming core infrastructure, not a toy. High subscription counts per deployment indicate real-time features are central to the product, which correlates with high retention and willingness to pay.

---

## 12. Open Questions

1. **Embedded Postgres strategy.** What is the best approach for zero-dependency local development? Options: pg-mem (in-memory Postgres emulation, may have compatibility gaps), embedded-postgres-binaries (real Postgres, large download), require Docker (simplest but adds friction), or default to SQLite with a Postgres compatibility layer. Each has tradeoffs between fidelity and developer friction.

2. **Query result diffing strategy.** When a subscription is re-executed, how should results be compared and transmitted? Options: full replacement (simple, higher bandwidth), structural diff (efficient, complex), or CRDT-based merging (most efficient for large result sets, most complex). The choice affects bandwidth, client complexity, and perceived latency.

3. **Naming.** "ReactiveBase" is a working name. It clearly communicates the value proposition but may be too similar to "Firebase" (potential confusion) or too generic. The final name should be distinctive, available as npm packages and .com domain, and evocative of reactivity and reliability.

4. **Schema migration strategy for production.** How should schema changes be handled in production environments with active subscriptions? A column rename or type change could break active queries. Options: versioned schemas with graceful migration, blue-green deployment support, or "pause subscriptions during migration" with automatic reconnection.

5. **Conflict resolution for concurrent mutations.** Serializable transactions handle database-level conflicts, but what about application-level conflicts? Example: two users simultaneously editing the same task's title. Options: last-write-wins (simple), client-side conflict resolution callbacks, or server-side merge functions. This decision affects the framework's suitability for collaborative editing use cases.

6. **Pricing for the cloud tier.** Usage-based pricing for a reactive backend is non-obvious. Charge per query execution? Per active subscription? Per mutation? Per WebSocket connection-minute? The pricing model needs to be predictable for customers and aligned with value delivery.

7. **Relation to FlowForge.** If both ReactiveBase and FlowForge (the job orchestration product) are pursued, should FlowForge become a module within ReactiveBase (the "actions" layer), or remain a standalone product? Combining them strengthens both but increases scope. Keeping them separate allows independent adoption but fragments the ecosystem.