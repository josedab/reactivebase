# @reactivebase/state

Framework-agnostic reactive state layer for ReactiveBase — syncs server state with any client-side state manager.

## Installation

```bash
npm install @reactivebase/state @reactivebase/client
```

## Usage

```ts
import { ReactiveStore } from "@reactivebase/state"
import { ReactiveBaseClient } from "@reactivebase/client"

const client = new ReactiveBaseClient({ url: "ws://localhost:4000" })
const store = new ReactiveStore(client)

// Reactive query — auto-subscribes to server updates
const tasks = store.query("tasks.list", { status: "active" })
tasks.subscribe((state) => console.log(state.data))

// Derived selector
const count = store.select(tasks, (data) => data.length)

// Mutation with optimistic update
await store.mutate(
  "tasks.complete",
  { id: "1" },
  {
    optimistic: (current) => current.map((t) => (t.id === "1" ? { ...t, done: true } : t)),
  },
)
```

## Adapters

Use the built-in adapters to integrate with your preferred state manager:

- `@reactivebase/state/adapters/zustand` — Zustand
- `@reactivebase/state/adapters/jotai` — Jotai
- `@reactivebase/state/adapters/pinia` — Pinia (Vue)
- `@reactivebase/state/adapters/nanostores` — Nanostores

## Documentation

Full documentation is available at [reactivebase.dev/docs](https://reactivebase.dev/docs).

## License

MIT
