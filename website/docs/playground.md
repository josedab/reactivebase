---
sidebar_position: 5
---

# Interactive Playground

Try ReactiveBase directly in your browser — no installation needed.

## Live Code Editor

Click "Open in StackBlitz" to launch a fully working ReactiveBase project with PGlite (in-browser Postgres):

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/reactivebase/reactivebase/tree/main/examples/basic-todo?file=convex/schema.ts&terminal=dev)

## Quick Examples

### 1. Define a Schema

```typescript
import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  tasks: defineTable({
    title: v.string(),
    done: v.boolean({ default: false }),
    priority: v.enum("low", "medium", "high"),
    assigneeId: v.id("users"),
  })
    .index("by_assignee", ["assigneeId"]),

  users: defineTable({
    name: v.string(),
    email: v.string(),
  }),
})
```

### 2. Write a Reactive Query

```typescript
import { query } from "@reactivebase/server"

// This query is live — clients auto-update when tasks change
export const listTasks = query(async (ctx, { userId }) => {
  return ctx.db.tasks
    .where({ assigneeId: userId, done: false })
    .orderBy("priority", "desc")
})
```

### 3. Write a Mutation

```typescript
import { mutation, roles } from "@reactivebase/server"

// Runs in a SERIALIZABLE transaction, requires authentication
export const createTask = mutation(
  async (ctx, { title, userId }) => {
    return ctx.db.tasks.insert({
      title,
      assigneeId: userId,
      priority: "medium",
    })
  },
  { access: "authenticated" }
)
```

### 4. Use in React

```tsx
import { useQuery, useMutation } from "@reactivebase/react"

function TaskList({ userId }) {
  // Reactive — re-renders when data changes on the server
  const tasks = useQuery("tasks.listTasks", { userId })
  const createTask = useMutation("tasks.createTask")

  if (tasks === undefined) return <div>Loading...</div>

  return (
    <div>
      <button onClick={() => createTask({ title: "New task", userId })}>
        Add Task
      </button>
      {tasks.map(task => (
        <div key={task.id}>{task.title}</div>
      ))}
    </div>
  )
}
```

### 5. AI / Vector Search

```typescript
import { defineTable, v, query } from "@reactivebase/server"

// Schema with vector column
const documents = defineTable({
  content: v.string(),
  embedding: v.vector(1536),
}).vectorIndex("embedding_idx", "embedding", { metric: "cosine" })

// Reactive semantic search
export const searchDocs = query(async (ctx, { query }) => {
  return ctx.db.documents
    .whereVectorSimilar("embedding", queryEmbedding, { topK: 10 })
})
```

## Template Projects

| Template | Description | Launch |
|----------|-------------|--------|
| **Todo App** | Basic CRUD with reactive queries | [Open →](https://stackblitz.com/github/reactivebase/reactivebase/tree/main/examples/basic-todo) |
| **Collaborative Board** | Kanban board with presence & AI | [Open →](https://stackblitz.com/github/reactivebase/reactivebase/tree/main/examples/collaborative-board) |

## Local Playground

To run ReactiveBase locally with zero setup:

```bash
npx create-reactivebase my-playground
cd my-playground
npm install
npm run dev
```

This uses PGlite (WebAssembly Postgres) — no database installation needed.
