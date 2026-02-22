---
sidebar_position: 5
---

# Interactive Playground

Try ReactiveBase directly in your browser — no installation needed. The playground runs a real Postgres database (PGlite) entirely in your browser via WebAssembly.

## 🚀 Launch Playground

Click to open a fully working ReactiveBase project in StackBlitz:

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/reactivebase/reactivebase/tree/main/examples/basic-todo?file=convex/schema.ts&terminal=dev)

## 📝 Try It Now

### Step 1: Define a Schema

Copy this into `convex/schema.ts` in the playground:

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

### Step 2: Write a Reactive Query

Create `convex/tasks.ts`:

```typescript
import { query, mutation } from "@reactivebase/server"

// This query is REACTIVE — subscribed clients auto-update when data changes
export const listTasks = query(async (ctx, { userId }: { userId: string }) => {
  return ctx.db.tasks
    .where({ assigneeId: userId, done: false })
    .orderBy("priority", "desc")
})

export const taskStats = query(async (ctx) => {
  const [total, completed] = await Promise.all([
    ctx.db.tasks.where({}).count(),
    ctx.db.tasks.where({ done: true }).count(),
  ])
  return { total, completed, rate: total > 0 ? completed / total : 0 }
})
```

### Step 3: Write a Mutation

```typescript
// Every mutation runs in a SERIALIZABLE Postgres transaction
export const createTask = mutation(async (ctx, args: {
  title: string
  priority: "low" | "medium" | "high"
  assigneeId: string
}) => {
  return ctx.db.tasks.insert({
    title: args.title,
    done: false,
    priority: args.priority,
    assigneeId: args.assigneeId,
    createdAt: new Date(),
  })
})

export const completeTask = mutation(async (ctx, { taskId }: { taskId: string }) => {
  await ctx.db.tasks.update(taskId, { done: true })
  return { success: true }
})
```

### Step 4: Use in React

```tsx
import { useQuery, useMutation } from "@reactivebase/react"
import { api } from "../_generated/api"

function TaskList({ userId }: { userId: string }) {
  // This hook auto-updates when tasks change — no manual refetching!
  const tasks = useQuery(api.tasks.listTasks, { userId })
  const createTask = useMutation(api.tasks.createTask)

  if (tasks === undefined) return <div>Loading...</div>

  return (
    <div>
      <button onClick={() => createTask({
        title: "New task",
        priority: "high",
        assigneeId: userId
      })}>
        Add Task
      </button>
      <ul>
        {tasks.map(task => (
          <li key={task.id}>{task.title} ({task.priority})</li>
        ))}
      </ul>
    </div>
  )
}
```

## 🧪 PGlite: In-Browser Postgres

The playground uses [PGlite](https://github.com/electric-sql/pglite) — a full Postgres database compiled to WebAssembly. This means:

- **No server needed** — Postgres runs entirely in your browser
- **Full SQL support** — JSONB, full-text search, arrays, CTEs
- **Instant startup** — No Docker, no cloud, no waiting
- **Real behavior** — Same query execution as production Postgres

ReactiveBase automatically detects PGlite via the `createAutoPool()` function:

```typescript
import { createAutoPool } from "@reactivebase/server"

// Uses DATABASE_URL if set, otherwise falls back to PGlite
const pool = await createAutoPool()
```

## 📚 Guided Tutorials

Work through these progressive tutorials in the playground:

| # | Tutorial | Difficulty | Time |
|---|----------|-----------|------|
| 1 | [Hello ReactiveBase](#step-1-define-a-schema) | Beginner | 5 min |
| 2 | Reactive Queries | Beginner | 10 min |
| 3 | Auth & Permissions | Intermediate | 15 min |
| 4 | Real-Time Dashboard | Intermediate | 20 min |
| 5 | Background Jobs | Advanced | 15 min |

## 🏗️ Start a Real Project

Ready to build? One command to scaffold a full project:

```bash
# Basic project
npx create-reactivebase my-app

# Multi-tenant SaaS template
npx create-reactivebase my-saas --template saas

# Skip wizard, use defaults
npx create-reactivebase my-app --yes
```
