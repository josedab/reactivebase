---
sidebar_position: 12
---

# Testing

*Estimated time: 10 minutes*

ReactiveBase provides `@reactivebase/testing` — a lightweight test utilities package with an in-memory mock database and a test server that lets you verify queries, mutations, and actions without a running Postgres instance.

## Setup

Install the testing package alongside your test runner (Vitest recommended):

```bash
npm install --save-dev @reactivebase/testing vitest
```

## Creating a Test Server

`TestServer` is the entry point for all testing. It provides an in-memory environment where you register functions and execute them against a `MockDatabase`.

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { TestServer } from "@reactivebase/testing"
import { query, mutation } from "@reactivebase/server"

const listTasks = query(async (ctx) => {
  return ctx.db.query("tasks").collect()
})

const createTask = mutation(async (ctx, { title }: { title: string }) => {
  return ctx.db.insert("tasks", { title, done: false })
})

describe("tasks", () => {
  let server: TestServer

  beforeEach(() => {
    server = new TestServer()
    server.registerFunctions({ listTasks, createTask })
  })

  it("creates and lists tasks", async () => {
    await server.runMutation(createTask, { title: "Write tests" })
    const result = await server.runQuery(listTasks, {})
    expect(result.data).toHaveLength(1)
    expect(result.data[0].title).toBe("Write tests")
  })
})
```

## Mock Database

`MockDatabase` stores data in memory with full dependency tracking. You can seed it with test data before running queries.

```typescript
const server = new TestServer()
server.registerFunctions({ listTasks })

// Seed test data
server.withSeed({
  tasks: [
    { id: "1", title: "Buy milk", done: false },
    { id: "2", title: "Write docs", done: true },
  ],
})

const result = await server.runQuery(listTasks, {})
expect(result.data).toHaveLength(2)
```

### Tracking Reads and Writes

`MockDatabase` tracks which tables are read and written during function execution — useful for verifying that your functions access only the tables they should.

```typescript
const db = server.getDatabase()
db.getReadLog()   // tables read during last operation
db.getWriteLog()  // tables written during last operation
db.reset()        // clear all data and logs
```

## Testing Mutations

Use `runMutation` to execute mutations and verify side effects. The result includes which tables were modified.

```typescript
it("tracks modified tables", async () => {
  const result = await server.runMutation(createTask, { title: "Test" })
  expect(result.modifiedTables).toContain("tasks")
})
```

### Assertion Helpers

`TestServer` provides built-in assertion methods:

```typescript
// Assert a mutation modifies specific tables
await server.expectMutationToModify(createTask, { title: "Test" }, ["tasks"])

// Assert a query returns expected data
await server.expectQueryToReturn(listTasks, {}, [
  { id: expect.any(String), title: "Test", done: false },
])
```

## Testing Reactive Updates

`snapshotReactiveUpdates` captures the result of a query after each mutation in a sequence — useful for verifying that live queries update correctly.

```typescript
it("reflects mutations in query results", async () => {
  const snapshots = await server.snapshotReactiveUpdates(
    listTasks,
    [
      { fn: createTask, args: { title: "First" } },
      { fn: createTask, args: { title: "Second" } },
    ],
  )

  expect(snapshots[0].data).toHaveLength(1)
  expect(snapshots[1].data).toHaveLength(2)
})
```

## Mocking Auth Context

To test functions that read `ctx.auth`, provide auth context when running functions:

```typescript
const getMyTasks = query(async (ctx) => {
  const userId = ctx.auth.userId
  return ctx.db.query("tasks").filter({ userId }).collect()
})

it("filters by authenticated user", async () => {
  server.registerFunctions({ getMyTasks })
  server.withSeed({
    tasks: [
      { id: "1", title: "Mine", userId: "u1" },
      { id: "2", title: "Theirs", userId: "u2" },
    ],
  })

  const result = await server.runQuery(getMyTasks, {}, {
    auth: { userId: "u1" },
  })
  expect(result.data).toHaveLength(1)
  expect(result.data[0].title).toBe("Mine")
})
```

## Testing Actions

Actions (background tasks with side effects) are tested with `runAction`:

```typescript
const sendReminder = action(async (ctx, { taskId }: { taskId: string }) => {
  const task = await ctx.db.query("tasks").filter({ id: taskId }).first()
  // In production this would send an email
  return { sent: true, to: task.userId }
})

it("runs an action", async () => {
  server.registerFunctions({ sendReminder })
  server.withSeed({
    tasks: [{ id: "t1", title: "Overdue", userId: "u1" }],
  })

  const result = await server.runAction(sendReminder, { taskId: "t1" })
  expect(result.data).toEqual({ sent: true, to: "u1" })
})
```

## Vitest Configuration

Add a test script to your `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

ReactiveBase tests work with the default Vitest configuration. No special setup or global hooks are required since `TestServer` manages its own in-memory state.

## API Summary

| Class / Method | Description |
|----------------|-------------|
| `TestServer` | In-memory test server |
| `server.registerFunctions(fns)` | Register query/mutation/action handlers |
| `server.runQuery(fn, args, ctx?)` | Execute a query |
| `server.runMutation(fn, args, ctx?)` | Execute a mutation |
| `server.runAction(fn, args, ctx?)` | Execute an action |
| `server.withSeed(records)` | Seed the mock database |
| `server.expectMutationToModify(fn, args, tables)` | Assert mutation modifies tables |
| `server.expectQueryToReturn(fn, args, expected)` | Assert query result |
| `server.snapshotReactiveUpdates(query, mutations)` | Capture reactive snapshots |
| `MockDatabase` | In-memory mock database |
| `db.seed(table, rows)` | Seed a table |
| `db.reset()` | Clear all data |
| `db.getReadLog()` | Tables read in last operation |
| `db.getWriteLog()` | Tables written in last operation |

## Next Steps

→ [Reactive Queries](./reactive-queries.md) — Understand how live queries work under the hood
→ [Transactions](./transactions.md) — Learn about automatic serializable transactions
