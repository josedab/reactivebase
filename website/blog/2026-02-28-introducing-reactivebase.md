---
slug: introducing-reactivebase
title: "Introducing ReactiveBase: A Reactive Backend Framework for Postgres"
authors: [josedab]
tags: [announcement, reactivebase, open-source]
---

# Introducing ReactiveBase

ReactiveBase is an open-source reactive backend framework built on Postgres. It replaces the typical stack of ORM + API layer + real-time transport + job queue + cache with a single, cohesive framework.

<!--truncate-->

## Why ReactiveBase?

Building a modern real-time application today means assembling 5+ tools: Prisma for data access, tRPC for the API layer, Socket.io for real-time, BullMQ for background jobs, and Redis for caching. That's **~1,250 lines of integration glue** before any business logic.

ReactiveBase collapses this into two primitives: `query()` and `mutation()`. Every query is automatically reactive — clients subscribed to a query receive updates when a mutation affects their result set, with no WebSocket setup required.

## Key Features

- **Reactive queries** — every query is live by default, with filter-level invalidation
- **Type-safe from schema to UI** — define your schema once, get end-to-end TypeScript types
- **Built-in scheduling** — Postgres-backed job queue with cron support
- **Multi-database support** — Postgres, MySQL 8+, SQLite via a unified adapter
- **AI & vector search** — pgvector integration with OpenAI/Ollama providers
- **Framework bindings** — React, Vue, Svelte, Next.js, React Native, and a framework-agnostic state layer

## Quick Start

```bash
npx create-reactivebase my-app
cd my-app
npm install
npm run dev
```

Define your schema:

```typescript
import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  tasks: defineTable({
    title: v.string(),
    done: v.boolean({ default: false }),
    assigneeId: v.id("users"),
  }),
})
```

Write a reactive query:

```typescript
import { query, mutation } from "@reactivebase/server"

export const list = query(async (ctx, { userId }) =>
  ctx.db.tasks.where({ assigneeId: userId, done: false })
)

export const create = mutation(async (ctx, { title, userId }) =>
  ctx.db.tasks.insert({ title, assigneeId: userId })
)
```

Use it in React:

```tsx
import { useQuery, useMutation } from "@reactivebase/react"

function TaskList() {
  const tasks = useQuery("list")
  const createTask = useMutation("create")

  return (
    <ul>
      {tasks?.map((t) => <li key={t.id}>{t.title}</li>)}
    </ul>
  )
}
```

## What's Next

We're actively working on CRDT-based collaboration, event sourcing, GraphQL federation, and edge runtime optimizations. Check the [roadmap](https://reactivebase.dev/docs/roadmap) and join us on [GitHub](https://github.com/reactivebase/reactivebase).

ReactiveBase is MIT licensed. Contributions welcome!
