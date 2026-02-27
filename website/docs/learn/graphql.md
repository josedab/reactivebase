---
sidebar_position: 10
---

# GraphQL Gateway

*Estimated time: 15 minutes*

ReactiveBase can auto-generate a full GraphQL API — including subscriptions — from your schema definition. The `@reactivebase/graphql` package bridges ReactiveBase's native reactivity with standard GraphQL tooling like Apollo Client and urql.

## Installation

```bash
npm install @reactivebase/graphql
```

## Setup

Create a gateway instance by passing your ReactiveBase schema:

```typescript
import { GraphQLSubscriptionGateway } from "@reactivebase/graphql"
import schema from "./convex/schema.js"

const gateway = new GraphQLSubscriptionGateway({
  schema,
  // Options (all optional):
  subscriptions: true,        // Enable subscription fields (default: true)
  relayPagination: true,      // Relay-style connections (default: true)
  basePath: "/graphql",       // Endpoint path (default: "/graphql")
  introspection: true,        // Schema introspection (default: true in dev)
})
```

## Schema Generation

The gateway automatically generates GraphQL types from your ReactiveBase schema:

```typescript
const generated = gateway.generateSchema()

console.log(generated.sdl)  // Full GraphQL SDL string
```

For each table in your schema, the gateway generates:

| Generated Type | Example (for `tasks` table) |
|---------------|----------------------------|
| Object type | `type Task { id: ID!, title: String!, done: Boolean! }` |
| Input type | `input TaskInput { title: String, done: Boolean }` |
| Where input | `input TaskWhereInput { id: ID, title: String, done: Boolean }` |
| Connection types (Relay) | `type TaskEdge`, `type TaskConnection` |
| Query fields | `tasks(first, after, where)`, `task(id)` |
| Mutation fields | `createTask(input)`, `updateTask(id, input)`, `deleteTask(id)` |
| Subscription fields | `onTaskChanged(where)`, `onTaskList(where, limit)` |

### Type Mapping

ReactiveBase validators map to GraphQL types:

| Validator | GraphQL Type |
|-----------|-------------|
| `v.string()` | `String!` |
| `v.number()` | `Float!` |
| `v.integer()` | `Int!` |
| `v.boolean()` | `Boolean!` |
| `v.timestamp()` | `DateTime!` |
| `v.json()` | `JSON!` |
| `v.id(table)` | `String!` |
| `v.vector(dims)` | `[Float!]!` |
| `v.optional(v)` | Nullable version of inner type |

## Subscriptions

The gateway supports real-time subscriptions using the [graphql-ws](https://github.com/enisdenjo/graphql-ws) protocol.

### Subscription Transport

Handle WebSocket messages with the built-in transport handler:

```typescript
// In your WebSocket handler
ws.on("message", (raw) => {
  const message = JSON.parse(raw)
  const responses = gateway.handleTransportMessage(message)
  for (const response of responses) {
    ws.send(JSON.stringify(response))
  }
})
```

### Pushing Data to Subscriptions

When your ReactivityEngine detects changes, push updates to subscribed clients:

```typescript
// When a table changes, notify all subscriptions watching it
const subscriptionIds = gateway.getSubscriptionsForTable("tasks")
for (const id of subscriptionIds) {
  gateway.pushSubscriptionData(id, updatedData)
}
```

## Client Integration: Apollo Client

The gateway can generate a ready-to-use Apollo Client configuration:

```typescript
const config = gateway.generateApolloClientConfig(
  "wss://api.example.com/graphql",  // WebSocket URL
  "https://api.example.com/graphql"  // HTTP URL (optional, inferred from WS)
)
```

This generates the following setup:

```typescript
import { ApolloClient, InMemoryCache, split, HttpLink } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';

const httpLink = new HttpLink({ uri: 'https://api.example.com/graphql' });

const wsLink = new GraphQLWsLink(
  createClient({ url: 'wss://api.example.com/graphql' })
);

const splitLink = split(
  ({ query }) => {
    const definition = getMainDefinition(query);
    return definition.kind === 'OperationDefinition' && definition.operation === 'subscription';
  },
  wsLink,
  httpLink,
);

export const client = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache(),
});
```

Then use subscriptions in your React components:

```tsx
import { useSubscription, gql } from '@apollo/client';

const ON_TASK_CHANGED = gql`
  subscription OnTaskChanged {
    onTaskChanged {
      id
      title
      done
    }
  }
`;

function TaskUpdates() {
  const { data, loading } = useSubscription(ON_TASK_CHANGED);

  if (loading) return <p>Listening...</p>;
  return <p>Updated: {data.onTaskChanged.title}</p>;
}
```

## Client Integration: urql

Generate an urql client configuration:

```typescript
const config = gateway.generateUrqlClientConfig(
  "wss://api.example.com/graphql",
  "https://api.example.com/graphql"
)
```

This generates:

```typescript
import { createClient, fetchExchange, subscriptionExchange } from 'urql';
import { createClient as createWSClient } from 'graphql-ws';

const wsClient = createWSClient({ url: 'wss://api.example.com/graphql' });

export const client = createClient({
  url: 'https://api.example.com/graphql',
  exchanges: [
    fetchExchange,
    subscriptionExchange({
      forwardSubscription: (request) => ({
        subscribe: (sink) => ({
          unsubscribe: wsClient.subscribe(request, sink),
        }),
      }),
    }),
  ],
});
```

## Relay Pagination

When `relayPagination` is enabled (default), collection queries use Relay-style connections:

```graphql
query {
  tasks(first: 10, after: "cursor123", where: { done: false }) {
    edges {
      cursor
      node {
        id
        title
        done
      }
    }
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
    totalCount
  }
}
```

Disable Relay pagination to use simple list queries instead:

```typescript
const gateway = new GraphQLSubscriptionGateway({
  schema,
  relayPagination: false,
})
```

```graphql
query {
  tasks(limit: 10, offset: 0, where: { done: false }) {
    id
    title
    done
  }
}
```

## TypeScript Code Generation

Generate TypeScript types matching your GraphQL schema:

```typescript
const types = gateway.generateTypeDefinitions()
// Write to a file for type-safe client code
fs.writeFileSync("src/generated/graphql-types.ts", types)
```

## Next Steps

→ [Performance & Scaling](./performance.md) — subscription sharding, edge caching
→ [Reactive Queries](./reactive-queries.md) — deep dive into the reactivity model
