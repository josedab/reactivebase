# @reactivebase/server

ReactiveBase server framework — queries, mutations, actions, and reactivity on Postgres.

## Installation

```bash
npm install @reactivebase/server
```

## Usage

```ts
import { defineSchema, defineTable, v, query, mutation } from "@reactivebase/server"

const schema = defineSchema({
  tasks: defineTable({
    title: v.string(),
    done: v.boolean({ default: false }),
  }),
})

export const listTasks = query(async (ctx) => {
  return ctx.db.tasks.where({ done: false })
})

export const createTask = mutation(async (ctx, args: { title: string }) => {
  return ctx.db.tasks.insert({ title: args.title, done: false })
})
```

## Documentation

Full documentation is available at [reactivebase.dev/docs](https://reactivebase.dev/docs).

## License

MIT
