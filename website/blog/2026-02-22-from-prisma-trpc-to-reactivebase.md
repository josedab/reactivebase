---
slug: from-prisma-trpc-to-reactivebase
title: "From Prisma + tRPC + BullMQ to ReactiveBase: 5 Tools → 1 Framework"
authors: [josedab]
tags: [migration, prisma, trpc, tutorial]
---

# From Prisma + tRPC + BullMQ to ReactiveBase: 5 Tools → 1 Framework

Building a real-time SaaS application today typically means assembling at least 5 separate tools:

| Concern | Typical Stack | Lines of Glue Code |
|---------|--------------|-------------------|
| ORM | Prisma | ~200 (schema + client setup) |
| API Layer | tRPC | ~300 (router + procedures) |
| Real-time | Socket.io / ws | ~400 (server + client setup) |
| Job Queue | BullMQ | ~200 (workers + queue config) |
| Cache | Redis manual | ~150 (invalidation logic) |

**Total: ~1,250 lines of integration code** before you write any business logic.

ReactiveBase replaces all five with a single framework. Here's what the migration looks like.

<!--truncate-->

## Before: The Assembled Stack

```typescript
// prisma/schema.prisma
model Task {
  id        String   @id @default(cuid())
  title     String
  done      Boolean  @default(false)
  assigneeId String
  assignee  User     @relation(fields: [assigneeId], references: [id])
}

// server/trpc.ts
export const taskRouter = router({
  list: publicProcedure
    .input(z.object({ userId: z.string() }))
    .query(({ input }) => prisma.task.findMany({
      where: { assigneeId: input.userId, done: false }
    })),
  create: publicProcedure
    .input(z.object({ title: z.string(), userId: z.string() }))
    .mutation(({ input }) => prisma.task.create({ data: input })),
})

// server/websocket.ts — manual WebSocket server for real-time
// server/bullmq.ts — separate job queue for background work
// server/cache.ts — Redis cache invalidation
```

## After: ReactiveBase

```typescript
// convex/schema.ts
import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  tasks: defineTable({
    title: v.string(),
    done: v.boolean({ default: false }),
    assigneeId: v.id("users"),
  }).index("by_assignee", ["assigneeId"]),
})

// convex/tasks.ts
import { query, mutation } from "@reactivebase/server"

export const list = query(async (ctx, { userId }) => {
  return ctx.db.tasks
    .where({ assigneeId: userId, done: false })
    .orderBy("priority", "desc")
})

export const create = mutation(async (ctx, { title, userId }) => {
  return ctx.db.tasks.insert({ title, assigneeId: userId })
})
```

**That's it.** No WebSocket setup. No cache invalidation. No job queue config. The query is automatically reactive — clients subscribed to `list` get updates when `create` runs.

## Migrate in One Command

```bash
npx @reactivebase/migrate-from-prisma
```

This reads your `prisma/schema.prisma` and generates the equivalent ReactiveBase schema.

## What You Get

| Feature | Before (5 tools) | After (ReactiveBase) |
|---------|-----------------|---------------------|
| Data access | Prisma | `ctx.db.tasks.where()` |
| API layer | tRPC router | `query()` / `mutation()` |
| Real-time | Manual WebSocket | Automatic (every query is live) |
| Background jobs | BullMQ | `action()` + built-in scheduler |
| Cache | Manual Redis | Automatic (filter-level invalidation) |
| Transactions | Manual `$transaction` | Automatic SERIALIZABLE |
| Type safety | Prisma + zod + tRPC | End-to-end from schema |

## Try It

```bash
npx create-reactivebase my-app
cd my-app
npm install
npm run dev
```

Or visit the [playground](https://reactivebase.dev/play) to try in your browser.
