---
title: "From Prisma + tRPC + BullMQ to ReactiveBase: 5 Tools → 1 Framework"
published: false
description: "Replace your assembled backend stack with one reactive framework on Postgres"
tags: typescript, postgres, react, webdev
cover_image: ""
canonical_url: https://reactivebase.dev/blog/from-prisma-trpc-to-reactivebase
---

# From Prisma + tRPC + BullMQ to ReactiveBase

Building a real-time SaaS app today means assembling at least 5 tools:

| Concern | Tool | Glue Code |
|---------|------|-----------|
| ORM | Prisma | ~200 lines |
| API | tRPC | ~300 lines |
| Real-time | Socket.io | ~400 lines |
| Jobs | BullMQ | ~200 lines |
| Cache | Redis | ~150 lines |

**1,250 lines of integration before any business logic.**

ReactiveBase replaces all five. Here's what it looks like:

## Before (Prisma + tRPC)

```typescript
// prisma/schema.prisma — 20 lines
// server/trpc.ts — 50 lines
// server/websocket.ts — 100 lines
// server/bullmq.ts — 80 lines
// server/cache.ts — 60 lines
// Total: 310+ lines across 5 files
```

## After (ReactiveBase)

```typescript
// convex/schema.ts
import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  tasks: defineTable({
    title: v.string(),
    done: v.boolean({ default: false }),
    assigneeId: v.id("users"),
  }),
})

// convex/tasks.ts
import { query, mutation } from "@reactivebase/server"

export const list = query(async (ctx, { userId }) =>
  ctx.db.tasks.where({ assigneeId: userId, done: false })
)

export const create = mutation(async (ctx, { title, userId }) =>
  ctx.db.tasks.insert({ title, assigneeId: userId })
)
// Total: 20 lines across 2 files
```

## Migrate in one command

```bash
npx @reactivebase/migrate-from-prisma
```

Reads your `prisma/schema.prisma`, generates ReactiveBase schema.

## What you get

- **Reactive queries** — every query is live, no WebSocket setup
- **Automatic transactions** — SERIALIZABLE, with retry
- **Built-in scheduling** — no BullMQ needed
- **Filter-level invalidation** — only affected subscriptions update
- **AI/vector search** — pgvector built-in
- **MIT license** — no vendor lock-in

## Try it

```bash
npx create-reactivebase my-app
cd my-app && npm install && npm run dev
```

- [Docs](https://reactivebase.dev)
- [Playground](https://reactivebase.dev/play)
- [GitHub](https://github.com/reactivebase/reactivebase)

---

*ReactiveBase is open source (MIT). 19,447 LOC, 425 tests, 30 server modules.*
