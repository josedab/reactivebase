# Basic Todo Example

A complete example showing ReactiveBase's core features:

- **Schema definition** with typed columns, indexes, and relations
- **Reactive queries** that auto-update connected clients
- **Mutations** running in serializable Postgres transactions
- **Actions** for background jobs and side effects
- **Middleware** for request logging

## Quick Start

```bash
# Set your Postgres connection string
export DATABASE_URL="postgresql://localhost:5432/todos"

# Install dependencies
npm install

# Start the dev server (generates types + runs server)
npm run dev
```

## Project Structure

```
basic-todo/
├── convex/
│   ├── schema.ts     # Data model: users, tasks, comments
│   └── tasks.ts      # Queries, mutations, and actions
├── server.ts         # Server entry point
└── package.json
```

## Key Concepts Demonstrated

### Reactive Queries
```typescript
// Every client subscribed to this query gets automatic updates
// when any task is created, updated, or deleted.
export const listTasks = query(async (ctx, { userId }) => {
  return ctx.db.tasks
    .where({ assigneeId: userId, done: false })
    .orderBy("priority", "desc")
})
```

### Transactional Mutations
```typescript
// All writes happen in a SERIALIZABLE transaction.
// If any operation fails, everything rolls back.
export const reassignTasks = mutation(async (ctx, { fromId, toId }) => {
  const tasks = await ctx.db.tasks.where({ assigneeId: fromId })
  for (const task of tasks) {
    await ctx.db.tasks.update(task.id, { assigneeId: toId })
  }
})
```

### React Client
```tsx
import { useQuery, useMutation } from "@reactivebase/react"

function TaskList({ userId }) {
  const tasks = useQuery("tasks.listTasks", { userId })
  const complete = useMutation("tasks.completeTask")

  if (tasks === undefined) return <div>Loading...</div>

  return tasks.map(task => (
    <div key={task.id}>
      {task.title}
      <button onClick={() => complete({ taskId: task.id })}>✓</button>
    </div>
  ))
}
```
