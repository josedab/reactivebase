# ReactiveBase

**Convex DX on Postgres.** A TypeScript-native reactive backend framework that provides live queries, automatic transactions, and built-in scheduling on infrastructure you control.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/reactivebase/reactivebase/actions/workflows/ci.yml/badge.svg)](https://github.com/reactivebase/reactivebase/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/reactivebase/reactivebase/branch/main/graph/badge.svg)](https://codecov.io/gh/reactivebase/reactivebase)
[![npm version](https://img.shields.io/npm/v/@reactivebase/server.svg)](https://www.npmjs.com/package/@reactivebase/server)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

📖 **Documentation**: [reactivebase.dev](https://reactivebase.dev) · 💬 **Community**: [Discord](https://discord.gg/reactivebase)

> **~126K LOC · 85 server modules · ~2,488 tests · 15 packages · MIT license**

---

<!-- BENCHMARK_START -->

### Benchmark Results

| Operation                        | Avg Latency | P95 Latency | Throughput     |
| -------------------------------- | ----------- | ----------- | -------------- |
| Simple query                     | 0.8 ms      | 1.4 ms      | 12,500 ops/sec |
| Filtered query (indexed)         | 1.2 ms      | 2.1 ms      | 8,300 ops/sec  |
| Single-row mutation              | 1.5 ms      | 2.8 ms      | 6,600 ops/sec  |
| Subscription update delivery     | 2.3 ms      | 4.1 ms      | 4,300 ops/sec  |
| Invalidation (100 subscriptions) | 3.8 ms      | 6.5 ms      | 2,600 ops/sec  |
| Batch insert (100 rows)          | 12 ms       | 18 ms       | 83 ops/sec     |

> Measured on Node.js 20 / PostgreSQL 16 / Apple M2, single-server. Run `npm run benchmark` to reproduce on your hardware.

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

Expected output:

```
✔ Created project in ./my-app
  ReactiveBase server listening on http://localhost:4000
  Dashboard available at http://localhost:4000/dashboard
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

The React component renders a live-updating task list. Clicking "Done" triggers the mutation, and all subscribed clients see the update automatically — no manual refetch needed.

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

### Complete CLI Reference

| Command                    | Subcommand / Flag | Description                                                      |
| -------------------------- | ----------------- | ---------------------------------------------------------------- |
| `reactivebase dev`         |                   | Start development server with hot reload                         |
| `reactivebase generate`    |                   | Generate TypeScript types from schema                            |
| `reactivebase migrate`     | `--generate`      | Generate migration SQL from schema diff                          |
|                            | `--apply`         | Apply pending migrations                                         |
|                            | `--status`        | Show migration status                                            |
| `reactivebase dacl`        | `list`            | List all declarative access control policies                     |
|                            | `test`            | Run DACL policy tests                                            |
|                            | `generate-rls`    | Generate Postgres RLS from DACL policies                         |
|                            | `coverage`        | Report DACL policy coverage                                      |
| `reactivebase ivm`         | `list`            | List incremental view maintenance views                          |
|                            | `stats`           | Show IVM statistics                                              |
|                            | `analyze`         | Analyze IVM performance                                          |
| `reactivebase auth:debug`  | `--user <id>`     | Debug auth for a specific user                                   |
|                            | `--query <name>`  | Debug auth for a specific query                                  |
|                            | `--table <name>`  | Debug auth for a specific table                                  |
| `reactivebase seed`        | _(default)_       | Run seed file (supports `--profile`, `--env`)                    |
| `reactivebase seed:reset`  |                   | Reset all seeded data                                            |
| `reactivebase seed:status` |                   | Show seed status                                                 |
| `reactivebase deploy`      | _(default)_       | Deploy to Fly.io or Railway (`--provider`, `--region`, `--name`) |
|                            | `--cloud`         | Deploy to ReactiveBase Cloud (`--name`, `--region`, `--plan`)    |
|                            | `--preview`       | Deploy preview environment (`--pr`, `--branch`)                  |
|                            | `--destroy <app>` | Destroy a preview deployment                                     |
|                            | `--logs <app>`    | Tail logs for a deployment                                       |
| `reactivebase functions`   | `list`            | List all registered functions                                    |

Example `reactivebase dev` output:

```
ReactiveBase dev server v0.1.0
  Watching convex/ for changes...
  Server listening on http://localhost:4000
  Dashboard: http://localhost:4000/dashboard
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

### Server Options

| Option                     | Type     | Default     | Description                                                                 |
| -------------------------- | -------- | ----------- | --------------------------------------------------------------------------- |
| `server.port`              | `number` | `4000`      | HTTP/WebSocket server port                                                  |
| `server.hostname`          | `string` | `"0.0.0.0"` | Hostname to bind the server to                                              |
| `server.corsOrigin`        | `string` | —           | Allowed CORS origin(s). `'*'` for any origin, or a specific origin string   |
| `server.dashboardToken`    | `string` | —           | Token for `/dashboard`, `/metrics` access. If unset, disabled in production |
| `server.heartbeatInterval` | `number` | `30000`     | WebSocket heartbeat interval in milliseconds                                |

### CDC (Change Data Capture) Options

| Option                | Type                                       | Default           | Description                          |
| --------------------- | ------------------------------------------ | ----------------- | ------------------------------------ |
| `cdc.mode`            | `"listen-notify" \| "logical-replication"` | `"listen-notify"` | CDC mode for reactivity invalidation |
| `cdc.tables`          | `string[]`                                 | all schema tables | Tables to track for change events    |
| `cdc.batchSize`       | `number`                                   | `100`             | Batch size for WAL event processing  |
| `cdc.flushIntervalMs` | `number`                                   | `10`              | Batch flush interval in milliseconds |

## Configuration Reference

| Variable        | Required | Default       | Description                             |
| --------------- | -------- | ------------- | --------------------------------------- |
| `DATABASE_URL`  | ✅       | —             | PostgreSQL connection string            |
| `PORT`          |          | `4000`        | HTTP/WebSocket server port              |
| `NODE_ENV`      |          | `development` | `development` or `production`           |
| `REDIS_URL`     |          | —             | Redis URL for multi-server pub/sub      |
| `JWT_SECRET`    | In prod  | —             | Secret for HS256 JWT signing            |
| `JWT_ISSUER`    |          | —             | JWT issuer URL for token validation     |
| `JWT_AUDIENCE`  |          | —             | JWT audience value for token validation |
| `LOG_LEVEL`     |          | `info`        | `debug`, `info`, `warn`, `error`        |
| `FLY_API_TOKEN` |          | —             | Fly.io API token for deployment         |

For deployment guides (Docker, Fly.io, Railway, Render, Kubernetes), see [deploy/README.md](deploy/README.md).

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
