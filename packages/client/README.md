# @reactivebase/client

Framework-agnostic ReactiveBase client SDK — subscriptions, cache, and transport.

## Installation

```bash
npm install @reactivebase/client
```

## Usage

```ts
import { ReactiveBaseClient } from "@reactivebase/client"

const client = new ReactiveBaseClient({
  url: "ws://localhost:4000",
})

// Subscribe to a reactive query
const unsubscribe = client.subscribe("listTasks", {}, (tasks) => {
  console.info("Tasks updated:", tasks)
})
```

## Documentation

Full documentation is available at [reactivebase.dev/docs](https://reactivebase.dev/docs).

## License

MIT
