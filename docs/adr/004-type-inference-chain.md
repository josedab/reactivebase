# ADR-004: End-to-End Type Inference Chain

## Status

Accepted

## Context

TypeScript developers expect compile-time type safety from schema definition through to UI components. Convex achieves this via code generation. We need to decide whether to rely on inference, code generation, or both.

## Decision

Use a **hybrid approach**: TypeScript's generic type system for schema-to-server inference, and code generation for server-to-client type bridges.

## Rationale

- **Pure inference** (no codegen): TypeScript can infer row types from `defineSchema` → `InferSchemaTypes` → `InferRow`. This works for server-side code. However, the client cannot infer return types from server functions without generated type stubs.
- **Pure codegen** (no inference): Requires running a generator on every change. Higher friction.
- **Hybrid**: Server types flow via inference (`ctx.db.tasks` is typed). Client types flow via generated `FunctionReference<TArgs, TReturn>` in `_generated/api.ts`. Best of both worlds.

## Implementation

### Inference chain (server-side)

```
defineSchema({ tasks: defineTable({ title: v.string() }) })
  → InferSchemaTypes → { tasks: { id: string; title: string } }
  → TypedDatabaseContext → ctx.db.tasks.where() returns Task[]
```

### Code generation (client bridge)

```
scanFunctions() → generateApiModule()
  → api.tasks.listTasks: FunctionReference<{ userId: string }, Task[]>
  → useQuery(api.tasks.listTasks, args) returns Task[] | undefined
```

### Phantom types

`FunctionReference<TArgs, TReturn>` carries type information via phantom type parameters (`_args` and `_return` fields that exist only at the type level).

## Consequences

- Server code gets full type inference with zero generation step
- Client code requires `reactivebase generate` (run automatically by `reactivebase dev`)
- The `useQuery` hook accepts both `FunctionReference` (typed) and `string` (untyped) for backward compatibility
- Generic depth is manageable: tested with 20+ table schemas without hitting TypeScript limits
