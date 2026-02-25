# ReactiveBase

**Convex DX on Postgres.** A TypeScript-native reactive backend framework that provides live queries, automatic transactions, and built-in scheduling on infrastructure you control.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/reactivebase/reactivebase/actions/workflows/ci.yml/badge.svg)](https://github.com/reactivebase/reactivebase/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/reactivebase/reactivebase/branch/main/graph/badge.svg)](https://codecov.io/gh/reactivebase/reactivebase)
[![npm version](https://img.shields.io/npm/v/@reactivebase/server.svg)](https://www.npmjs.com/package/@reactivebase/server)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

📖 **Documentation**: [reactivebase.dev](https://reactivebase.dev)

> **65,698 LOC · 48 server modules · 1,515 tests · 15 packages · MIT license**

---

<!-- BENCHMARK_START -->

### Latest Benchmark Results

_Run `npm run benchmark` or see CI workflow for live results._

<!-- BENCHMARK_END -->

---

## Why ReactiveBase?

Modern apps need real-time data, but building it on Postgres means assembling 5+ systems (ORM, API layer, WebSocket server, cache, job queue) and integrating them yourself. Platforms like Convex solve this beautifully — but lock you into proprietary infrastructure.

**ReactiveBase gives you the best of both worlds:**

- 🔄 **Reactive queries** — Every query is live. Subscribed clients get updates automatically when data changes.
- 🔒 **Automatic transactions** — Every mutation runs in a serializable Postgres transaction. No partial writes, ever.
- ⏰ **Built-in scheduling** — Background jobs and cron without separate infrastructure.
- 🐘 **Postgres-native** — Full SQL access, JSONB, PostGIS, full-text search. Your data, your database.
- 🔧 **Self-hosted** — Runs anywhere Postgres runs. No vendor lock-in.

## Quick Start

```bash
npx create-reactivebase my-app
cd my-app
npm install
npm run dev
```

## How It Works

### 1. Define Your Schema

```typescript
// convex/schema.ts
import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  tasks: defineTable({
    title: v.string(),
    done: v.boolean({ default: false }),
    priority: v.enum("low", "medium", "high", "critical"),
    assigneeId: v.id("users"),
    createdAt: v.timestamp({ default: "now" }),
  })
    .index("by_assignee", ["assigneeId"])
    .index("by_priority", ["priority"]),

  users: defineTable({
    name: v.string(),
    email: v.string(),
  }).index("by_email", ["email"], { unique: true }),
})
```

### 2. Write Queries and Mutations

```typescript
// convex/tasks.ts
import { query, mutation } from "@reactivebase/server"

// Reactive query — clients auto-update when data changes
export const listTasks = query(async (ctx, { userId }: { userId: string }) => {
  return ctx.db.tasks.where({ assigneeId: userId, done: false }).orderBy("priority", "desc")
})

// Mutation — runs in a serializable transaction
export const completeTask = mutation(async (ctx, { taskId }: { taskId: string }) => {
  await ctx.db.tasks.update(taskId, { done: true, updatedAt: new Date() })
  return { success: true }
})
```

### 3. Use in React

```tsx
import { useQuery, useMutation } from "@reactivebase/react"
import { api } from "../_generated/api"

function TaskList({ userId }: { userId: string }) {
  const tasks = useQuery(api.tasks.listTasks, { assigneeId: userId })
  const completeTask = useMutation(api.tasks.completeTask)

  if (tasks === undefined) return <div>Loading...</div>

  return (
    <ul>
      {tasks.map((task) => (
        <li key={task.id}>
          {task.title}
          <button onClick={() => completeTask({ taskId: task.id })}>Done</button>
        </li>
      ))}
    </ul>
  )
}
```

## Architecture

```
Client (React/Vue/Svelte)
    │
    │ WebSocket (multiplexed subscriptions)
    ▼
ReactiveBase Server
    ├── Query Router ──────── Reactive query execution + dependency tracking
    ├── Mutation Router ───── Serializable transactions + change detection
    ├── Action Router ─────── Background jobs + scheduling
    └── Reactivity Engine ─── Subscription invalidation + result diffing
         │
         ▼
    PostgreSQL (source of truth) + Redis (optional, multi-server pub/sub)
```

## Packages

| Package                             | Description                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `@reactivebase/server`              | Server framework: queries, mutations, actions, reactivity engine, scheduler  |
| `@reactivebase/client`              | Framework-agnostic client: subscriptions, cache, WebSocket transport         |
| `@reactivebase/react`               | React hooks: `useQuery`, `useMutation`, `useAction`                          |
| `@reactivebase/nextjs`              | Next.js integration: `preloadQuery`, `usePreloadedQuery`, App Router support |
| `@reactivebase/vue`                 | Vue 3 composables: `useQuery`, `useMutation`, `useAction`                    |
| `@reactivebase/svelte`              | Svelte stores: `queryStore`, `createMutation`, `createAction`                |
| `@reactivebase/cli`                 | CLI tooling: `dev`, `generate`, `migrate`                                    |
| `@reactivebase/edge`                | Edge runtime adapter: query prefetching for edge workers                     |
| `@reactivebase/graphql`             | GraphQL subscriptions gateway for Apollo, urql, or any GraphQL client        |
| `@reactivebase/react-native`        | React Native SDK: offline-first reactive queries for mobile                  |
| `@reactivebase/testing`             | Testing utilities: in-memory server, mock database, test helpers             |
| `@reactivebase/migrate-from-prisma` | Migrate your Prisma schema to ReactiveBase with one command                  |
| `reactivebase-vscode`               | VS Code extension: type generation, schema validation, live diagnostics      |
| `reactivebase`                      | Meta package: imports server + client for quick setup                        |
| `create-reactivebase`               | Project scaffolding                                                          |

## Core Concepts

### Queries (Reactive Reads)

Queries are functions that read data. When a client subscribes, the framework tracks which tables the query accesses. When a mutation modifies those tables, the query is automatically re-executed and updated results are pushed to the client.

```typescript
export const taskStats = query(async (ctx, { teamId }: { teamId: string }) => {
  const [total, completed] = await Promise.all([
    ctx.db.tasks.where({ teamId }).count(),
    ctx.db.tasks.where({ teamId, done: true }).count(),
  ])
  return { total, completed, rate: total > 0 ? completed / total : 0 }
})
```

### Mutations (Transactional Writes)

Every mutation runs inside a `SERIALIZABLE` Postgres transaction. If anything fails, everything rolls back. Serialization conflicts are retried automatically (up to 3 times).

```typescript
export const reassignTasks = mutation(async (ctx, { fromId, toId }) => {
  const tasks = await ctx.db.tasks.where({ assigneeId: fromId, done: false })
  for (const task of tasks) {
    await ctx.db.tasks.update(task.id, { assigneeId: toId })
  }
  return { reassigned: tasks.length }
})
```

### Actions (Background Jobs)

Actions run outside transactions for side effects like sending emails or calling APIs.

```typescript
export const sendWelcomeEmail = action(async (ctx, { userId }: { userId: string }) => {
  const user = await ctx.db.users.get(userId)
  if (!user) throw new Error("User not found")
  await emailService.send({ to: user.email, template: "welcome" })
})
```

## Schema Types

| Validator             | Postgres Type      | TypeScript Type  |
| --------------------- | ------------------ | ---------------- |
| `v.string()`          | `text`             | `string`         |
| `v.number()`          | `double precision` | `number`         |
| `v.integer()`         | `integer`          | `number`         |
| `v.boolean()`         | `boolean`          | `boolean`        |
| `v.timestamp()`       | `timestamptz`      | `Date`           |
| `v.json()`            | `jsonb`            | `T`              |
| `v.array(v.string())` | `text[]`           | `string[]`       |
| `v.enum("a", "b")`    | `text + CHECK`     | `"a" \| "b"`     |
| `v.id("table")`       | `text` (FK)        | `string`         |
| `v.optional(v.T())`   | nullable           | `T \| undefined` |
| `v.custom<T>(pgType)` | custom             | `T`              |

## Query Builder

```typescript
// Fluent, type-safe query building
ctx.db.tasks
  .where({ assigneeId: userId })
  .where("priority", "in", ["high", "critical"])
  .where("dueDate", "<", new Date())
  .orderBy("priority", "desc")
  .limit(20)

// Joins
ctx.db.tasks.join("users", "assigneeId").select("tasks.*", "users.name as assigneeName")

// Raw SQL escape hatch
ctx.db.raw<Task[]>(`SELECT * FROM tasks WHERE title ILIKE $1`, ["%bug%"])
```

## CLI

```bash
reactivebase dev              # Start development server
reactivebase generate         # Generate types from schema
reactivebase migrate --generate   # Generate migration SQL
reactivebase migrate --apply      # Apply pending migrations
reactivebase migrate --status     # Show migration status
```

## Configuration

```typescript
// reactivebase.config.ts
import { defineConfig } from "@reactivebase/server"

export default defineConfig({
  database: {
    connectionString: process.env.DATABASE_URL!,
    poolSize: 20,
  },
  server: {
    port: 4000,
  },
  auth: {
    providers: [
      jwtProvider({
        issuer: "https://auth.myapp.com",
        audience: "myapp-api",
      }),
    ],
  },
})
```

## Infrastructure Requirements

**Minimum (single server):**

- PostgreSQL 14+
- Node.js 20+

**Multi-server:**

- Add Redis 7+ for cross-server reactivity via pub/sub

## Comparison

| Feature           | ReactiveBase    | Convex         | Supabase    | Firebase       |
| ----------------- | --------------- | -------------- | ----------- | -------------- |
| Reactive queries  | ✅ Core         | ✅ Core        | ⚠️ Add-on   | ✅ Firestore   |
| Auto transactions | ✅ Serializable | ✅             | ❌ Manual   | ❌ Limited     |
| Background jobs   | ✅ Built-in     | ✅             | ❌ Separate | ✅ Functions   |
| Self-hosted       | ✅ Primary      | ❌             | ✅          | ❌             |
| Postgres          | ✅ Native       | ❌ Proprietary | ✅          | ❌ Proprietary |
| Raw SQL           | ✅              | ❌             | ✅          | ❌             |
| Vendor lock-in    | None            | Total          | Low         | Total          |

## Development

```bash
# Clone and install
git clone https://github.com/reactivebase/reactivebase
cd reactivebase
npm install

# Build all packages
npm run build

# Run tests
npm run test

# Development mode
npm run dev
```

## License

MIT © ReactiveBase Contributors

## Roadmap

See [ROADMAP.md](ROADMAP.md) for planned features and milestones.
