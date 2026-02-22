---
sidebar_position: 2
---

# Core Concepts

ReactiveBase is built on three primitives: **queries**, **mutations**, and **actions**.

## Queries (Reactive Reads)

Every query is live by default. When a client subscribes, the framework tracks which tables the query accesses. When a mutation modifies those tables, the query is automatically re-executed and results are pushed to the client.

```typescript
import { query } from "@reactivebase/server"

export const taskStats = query(async (ctx, { teamId }) => {
  const [total, completed] = await Promise.all([
    ctx.db.tasks.where({ teamId }).count(),
    ctx.db.tasks.where({ teamId, done: true }).count(),
  ])
  return { total, completed, rate: total > 0 ? completed / total : 0 }
})
```

### Filter-Level Invalidation

ReactiveBase tracks not just which tables you read, but which filters you applied. A mutation to `tasks` where `assigneeId = "u2"` will NOT invalidate a subscription reading `tasks` where `assigneeId = "u1"`.

## Mutations (Transactional Writes)

Every mutation runs inside a `SERIALIZABLE` Postgres transaction. If anything fails, everything rolls back. Serialization conflicts are retried automatically.

```typescript
import { mutation } from "@reactivebase/server"

export const reassignTasks = mutation(async (ctx, { fromId, toId }) => {
  const tasks = await ctx.db.tasks.where({ assigneeId: fromId, done: false })
  for (const task of tasks) {
    await ctx.db.tasks.update(task.id, { assigneeId: toId })
  }
  return { reassigned: tasks.length }
})
```

### Access Control

Use declarative permissions:

```typescript
import { mutation, roles } from "@reactivebase/server"

export const deleteUser = mutation(
  async (ctx, { userId }) => {
    await ctx.db.users.delete(userId)
  },
  { access: roles("admin") }
)
```

## Actions (Background Jobs)

Actions run outside transactions for side effects like sending emails or calling APIs.

```typescript
import { action } from "@reactivebase/server"

export const sendWelcomeEmail = action(async (ctx, { userId }) => {
  const user = await ctx.db.users.get(userId)
  await emailService.send({ to: user.email, template: "welcome" })
})
```

## Schema Types

| Validator | Postgres Type | TypeScript Type |
|-----------|---------------|-----------------|
| `v.string()` | `text` | `string` |
| `v.number()` | `double precision` | `number` |
| `v.integer()` | `integer` | `number` |
| `v.boolean()` | `boolean` | `boolean` |
| `v.timestamp()` | `timestamptz` | `Date` |
| `v.json()` | `jsonb` | `T` |
| `v.array(v.string())` | `text[]` | `string[]` |
| `v.enum("a", "b")` | `text + CHECK` | `"a" \| "b"` |
| `v.id("table")` | `text` (FK) | `string` |
| `v.optional(v.T())` | nullable | `T \| undefined` |
| `v.vector(1536)` | `vector(1536)` | `number[]` |
| `v.storageId()` | `text` | `string` |

## Architecture

```
Client (React/Vue/Svelte)
    │ WebSocket
    ▼
ReactiveBase Server
    ├── Query Router ──── Reactive execution + dependency tracking
    ├── Mutation Router ── Serializable transactions + change detection
    ├── Action Router ──── Background jobs + scheduling
    ├── Middleware ──────── Auth, permissions, logging, tenancy
    └── Reactivity Engine ─ Subscription invalidation + result diffing
         │
         ▼
    PostgreSQL + Redis (optional)
```
