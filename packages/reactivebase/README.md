# reactivebase

Reactive backend framework — Convex DX on Postgres. This is the umbrella package that re-exports all core ReactiveBase modules.

## Installation

```bash
npm install reactivebase
```

## Usage

```ts
import { defineSchema, defineTable, v, query, mutation } from "reactivebase"

const schema = defineSchema({
  tasks: defineTable({
    title: v.string(),
    done: v.boolean({ default: false }),
  }),
})
```

## Documentation

Full documentation is available at [reactivebase.dev/docs](https://reactivebase.dev/docs).

## License

MIT
