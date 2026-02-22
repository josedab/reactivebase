---
sidebar_position: 1
slug: /getting-started
---

# Getting Started

Get a reactive backend running in under 5 minutes.

## Quick Start

```bash
npx create-reactivebase my-app
cd my-app
npm install
npm run dev
```

## Manual Setup

### 1. Install

```bash
npm install @reactivebase/server @reactivebase/react
```

### 2. Define Your Schema

Create `convex/schema.ts`:

```typescript
import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  tasks: defineTable({
    title: v.string(),
    done: v.boolean({ default: false }),
    priority: v.enum("low", "medium", "high"),
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

### 3. Write Queries and Mutations

Create `convex/tasks.ts`:

```typescript
import { query, mutation } from "@reactivebase/server"

export const listTasks = query(async (ctx, { userId }) => {
  return ctx.db.tasks
    .where({ assigneeId: userId, done: false })
    .orderBy("priority", "desc")
})

export const completeTask = mutation(async (ctx, { taskId }) => {
  await ctx.db.tasks.update(taskId, { done: true })
  return { success: true }
})
```

### 4. Use in React

```tsx
import { useQuery, useMutation } from "@reactivebase/react"

function TaskList({ userId }) {
  const tasks = useQuery("tasks.listTasks", { userId })
  const complete = useMutation("tasks.completeTask")

  if (tasks === undefined) return <div>Loading...</div>

  return (
    <ul>
      {tasks.map(task => (
        <li key={task.id}>
          {task.title}
          <button onClick={() => complete({ taskId: task.id })}>Done</button>
        </li>
      ))}
    </ul>
  )
}
```

## What's Next?

- [Core Concepts](/docs/core-concepts) — Understand queries, mutations, and reactivity
- [API Reference](/docs/api-reference) — Full API documentation
- [Deployment](/docs/deployment) — Deploy to production
