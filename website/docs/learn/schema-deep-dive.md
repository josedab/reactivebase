---
sidebar_position: 1
---

# Schema Deep Dive

*Estimated time: 10 minutes*

ReactiveBase schemas are the single source of truth for your data model. They generate Postgres DDL, TypeScript types, and query builder types from one definition.

## Validator Types

| Validator | Postgres Type | TypeScript Type | Example |
|-----------|---------------|-----------------|---------|
| `v.string()` | `text` | `string` | `name: v.string()` |
| `v.number()` | `double precision` | `number` | `price: v.number()` |
| `v.integer()` | `integer` | `number` | `count: v.integer()` |
| `v.boolean()` | `boolean` | `boolean` | `done: v.boolean()` |
| `v.timestamp()` | `timestamptz` | `Date` | `createdAt: v.timestamp({ default: "now" })` |
| `v.json()` | `jsonb` | `T` | `metadata: v.json()` |
| `v.array(v.T())` | `T[]` | `T[]` | `tags: v.array(v.string())` |
| `v.enum("a","b")` | `text + CHECK` | `"a" \| "b"` | `status: v.enum("active", "archived")` |
| `v.id("table")` | `text (FK)` | `string` | `userId: v.id("users")` |
| `v.optional(v.T())` | nullable | `T \| undefined` | `bio: v.optional(v.string())` |
| `v.vector(dims)` | `vector(N)` | `number[]` | `embedding: v.vector(1536)` |
| `v.custom<T>(pg)` | custom | `T` | `geo: v.custom<Point>("point")` |

## Indexes

```typescript
defineTable({ ... })
  .index("by_email", ["email"], { unique: true })
  .index("by_status_date", ["status", "createdAt"])
```

## Relations

```typescript
defineTable({ ... })
  .relation("author", { from: "authorId", to: "users" })
  .relation("comments", { from: "id", to: "comments.postId" })
```

## Migrations

Schema changes auto-generate SQL migrations:

```bash
reactivebase migrate --generate   # Diff schema → SQL
reactivebase migrate --apply      # Run pending migrations
reactivebase migrate --status     # Show migration state
```

## Next Steps

→ [Reactive Queries](./reactive-queries.md) — How queries track dependencies and auto-update
