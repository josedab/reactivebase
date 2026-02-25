# @reactivebase/graphql

GraphQL subscriptions gateway for ReactiveBase — use Apollo, urql, or any GraphQL client with reactive queries.

## Installation

```bash
npm install @reactivebase/graphql
```

## Usage

```ts
import { createGraphQLGateway } from "@reactivebase/graphql"

const gateway = createGraphQLGateway({
  serverUrl: "ws://localhost:4000",
})
```

## Documentation

Full documentation is available at [reactivebase.dev/docs](https://reactivebase.dev/docs).

## License

MIT
