---
sidebar_position: 3
---

# API Reference

## Server Package (`@reactivebase/server`)

### Schema Definition

```typescript
import { defineSchema, defineTable, v } from "@reactivebase/server"
```

| Function | Description |
|----------|-------------|
| `defineSchema(tables)` | Define the data model |
| `defineTable(columns)` | Define a table with typed columns |
| `v.string()` | Text column |
| `v.number()` | Double precision column |
| `v.integer()` | Integer column |
| `v.boolean()` | Boolean column |
| `v.timestamp()` | Timestamptz column |
| `v.json<T>()` | JSONB column |
| `v.enum(...values)` | Text with CHECK constraint |
| `v.id(table)` | Foreign key reference |
| `v.optional(v)` | Nullable column |
| `v.vector(dims)` | pgvector column |
| `v.array(v)` | Postgres array |
| `v.storageId()` | File storage reference |

### Functions

```typescript
import { query, mutation, action } from "@reactivebase/server"
```

| Function | Description |
|----------|-------------|
| `query(handler, opts?)` | Define a reactive query |
| `mutation(handler, opts?)` | Define a transactional mutation |
| `action(handler, opts?)` | Define a background action |

### Server

```typescript
import { createReactiveBaseServer, defineConfig } from "@reactivebase/server"
```

### Auth

```typescript
import { jwtProvider, customProvider, tokenProvider, roles, allow } from "@reactivebase/server"
```

### AI

```typescript
import { openaiProvider, ollamaProvider, mockAiProvider, createAiContext } from "@reactivebase/server"
```

## Client Packages

### React (`@reactivebase/react`)

| Hook | Description |
|------|-------------|
| `useQuery(ref, args)` | Subscribe to a reactive query |
| `useMutation(ref, config?)` | Get a mutation caller with optimistic updates |
| `useAction(ref)` | Get an action caller |

### Vue (`@reactivebase/vue`)

| Composable | Description |
|------------|-------------|
| `useQuery(ref, args)` | Reactive query with `data`, `error`, `isLoading` refs |
| `useMutation(ref)` | Mutation with `mutate`, `isLoading`, `error` |
| `useAction(ref)` | Action with `run`, `isLoading`, `error` |

### Svelte (`@reactivebase/svelte`)

| Function | Description |
|----------|-------------|
| `queryStore(ref, args)` | Readable store with reactive data |
| `createMutation(ref)` | Mutation handle |
| `createAction(ref)` | Action handle |

### Next.js (`@reactivebase/nextjs`)

| Function | Description |
|----------|-------------|
| `preloadQuery(url, name, args)` | SSR query prefetch |
| `usePreloadedQuery(preloaded)` | Hydrate + subscribe |

### Edge (`@reactivebase/edge`)

| Class | Description |
|-------|-------------|
| `EdgeClient` | HTTP-only query prefetching for edge runtimes |

### Testing (`@reactivebase/testing`)

| Class | Description |
|-------|-------------|
| `TestServer` | In-memory test server |
| `MockDatabase` | Mock database for unit tests |
