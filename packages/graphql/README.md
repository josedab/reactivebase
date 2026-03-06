# @reactivebase/graphql

GraphQL subscriptions gateway for ReactiveBase — auto-generates a GraphQL schema from your server functions, enabling clients to use standard GraphQL tooling (Apollo, urql) alongside the native WebSocket protocol.

## Features

- **Auto-generated schema** — generates GraphQL types, queries, mutations, and subscriptions from your ReactiveBase schema
- **Subscription transport** — wires GraphQL subscriptions to ReactiveBase's reactivity engine via the `graphql-ws` protocol
- **Relay pagination** — optional Relay-style cursor-based pagination
- **Custom scalars** — map ReactiveBase validators to custom GraphQL scalar types

## Installation

```bash
npm install @reactivebase/graphql
```

## Usage

### Basic Setup

```ts
import { GraphQLSubscriptionGateway } from "@reactivebase/graphql"

const gateway = new GraphQLSubscriptionGateway({
  schema: mySchema,
  subscriptions: true,
  relayPagination: true,
  basePath: "/graphql",
})

// Generate the SDL string
const sdl = gateway.generateSchema()

// Execute a GraphQL operation
const result = await gateway.execute({
  query: "{ tasks { id title done } }",
})
```

### Subscriptions

```ts
// Subscribe to reactive query updates via GraphQL
const handle = gateway.subscribe({
  query: "subscription { onTaskCreated { id title } }",
})

handle.on("data", (event) => {
  console.log("New task:", event.data)
})
```

### Configuration Options

| Option            | Type                     | Default      | Description                              |
| ----------------- | ------------------------ | ------------ | ---------------------------------------- |
| `schema`          | `SchemaLike`             | _required_   | ReactiveBase schema definition           |
| `customScalars`   | `Record<string, string>` | `{}`         | Custom validator-to-scalar type mappings |
| `subscriptions`   | `boolean`                | `true`       | Enable GraphQL subscription support      |
| `relayPagination` | `boolean`                | `true`       | Enable Relay-style cursor pagination     |
| `basePath`        | `string`                 | `"/graphql"` | Base path for the GraphQL HTTP endpoint  |

## Documentation

Full documentation is available at [reactivebase.dev/docs](https://reactivebase.dev/docs).

## License

MIT
