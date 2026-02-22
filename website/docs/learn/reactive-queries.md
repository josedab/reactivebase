---
sidebar_position: 2
---

# Reactive Queries

*Estimated time: 10 minutes*

Every query in ReactiveBase is **live by default**. When a mutation changes data that a query depends on, all subscribed clients receive updated results automatically.

## How It Works

```
Client subscribes to query("tasks.list", { userId: "u1" })
          │
          ▼
ReactivityEngine tracks: this subscription depends on table "tasks"
where assigneeId = "u1"
          │
          ▼
Another client runs mutation: tasks.insert({ assigneeId: "u1", ... })
          │
          ▼
ReactivityEngine detects: table "tasks" was modified
   → evaluates which subscriptions are affected (filter-level matching)
   → re-executes the query
   → diffs results (only sends if data actually changed)
   → pushes update to client via WebSocket
```

## Invalidation Levels

ReactiveBase uses 3 levels of invalidation precision:

| Level | Precision | Performance | How |
|-------|-----------|-------------|-----|
| **Table-level** | Low | Fast | Any write to table X invalidates all subs on X |
| **Filter-level** | Medium | Medium | Matches mutation row values against subscription WHERE filters |
| **Row-level** | High | Slower | Tracks exact row IDs per subscription via Bloom filters |

## Writing Reactive Queries

```typescript
// Every query automatically tracks its table dependencies
export const myTasks = query(async (ctx, { userId }: { userId: string }) => {
  return ctx.db.tasks
    .where({ assigneeId: userId, done: false })
    .orderBy("priority", "desc")
})
```

When any client calls a mutation that inserts/updates/deletes from the `tasks` table, `myTasks` re-executes and pushes new results.

## Result Diffing

ReactiveBase hashes query results and only pushes updates when data actually changes. This prevents unnecessary re-renders on the client.

## Edge Prefetch Cache

For latency-critical applications, the `EdgePrefetchCache` serves cached results in <10ms, then upgrades to live WebSocket:

```typescript
const cache = new EdgePrefetchCache({ ttlMs: 30000 })
cache.set("tasks.list", { userId: "u1" }, results, ["tasks"])

// On mutation: cache auto-invalidates via pub/sub
cache.handleMutation(["tasks"])
```

## Next Steps

→ [Transactions](./transactions.md) — How mutations run in serializable transactions
