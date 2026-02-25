# @reactivebase/testing

ReactiveBase testing utilities — in-memory server, mock database, and test helpers.

## Installation

```bash
npm install -D @reactivebase/testing
```

## Usage

```ts
import { createTestServer, createMockDatabase } from "@reactivebase/testing"

const db = createMockDatabase()
const server = await createTestServer({ db })

// Run queries against the test server
const tasks = await server.query("listTasks")
```

## Documentation

Full documentation is available at [reactivebase.dev/docs](https://reactivebase.dev/docs).

## License

MIT
