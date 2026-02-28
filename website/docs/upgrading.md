---
sidebar_position: 10
---

# Upgrading ReactiveBase

This guide documents breaking changes, migration steps, and deprecated API replacements for each ReactiveBase version. Check the section for your current and target versions and apply changes in order.

## Upgrade Checklist

For any version upgrade:

1. Read the relevant section below for breaking changes
2. Update your `package.json` dependencies
3. Run `npm install`
4. Apply any required code changes
5. Run `npx reactivebase generate` to regenerate types
6. Run your test suite to verify

## 0.1.x → 0.2.0 (Upcoming)

> **Status:** Pre-release. APIs may still change before 1.0.

### Breaking Changes

| Change | Migration |
|--------|-----------|
| `defineConfig()` now requires `database.url` instead of `databaseUrl` | Move `databaseUrl` into `database: { url: "..." }` |
| `query()` handler receives `ctx` as first argument only | Remove destructured `{ db, auth }` — use `ctx.db`, `ctx.auth` instead |
| `v.id(table)` now requires table reference, not string | Replace `v.id("users")` with `v.id(users)` (table object) |

### New Required Config

```typescript
// Before (0.1.x)
export default defineConfig({
  databaseUrl: process.env.DATABASE_URL,
})

// After (0.2.0)
export default defineConfig({
  database: {
    url: process.env.DATABASE_URL,
  },
})
```

### Deprecated APIs

| Deprecated | Replacement | Removal |
|------------|-------------|---------|
| `createServer(schema)` | `createReactiveBaseServer({ schema })` | 0.3.0 |
| `v.text()` | `v.string()` | 0.3.0 |
| `mutation(handler, { transactional: true })` | `mutation(handler)` (all mutations are transactional by default) | 0.3.0 |

### New Features

- Field-level encryption (`EncryptionEngine`) — see [Encryption Guide](./learn/encryption.md)
- Database branching (`DatabaseBranching`) — see [Branching Guide](./learn/branching.md)
- CRDT collaboration hooks (`useCollabText`, `useCollabList`, etc.) — see [CRDT Guide](./learn/crdt.md)

## 0.0.x → 0.1.0

### Breaking Changes

| Change | Migration |
|--------|-----------|
| Package renamed from `reactivebase` to `@reactivebase/server` | Update all imports |
| Client package split into framework-specific packages | Replace `@reactivebase/client` imports with `@reactivebase/react`, `@reactivebase/vue`, or `@reactivebase/svelte` |
| `defineSchema` requires `defineTable` wrappers | Wrap table definitions in `defineTable({...})` |

### Migration Steps

```typescript
// Before (0.0.x)
import { defineSchema, query } from "reactivebase"

// After (0.1.0)
import { defineSchema, defineTable, query } from "@reactivebase/server"
```

```typescript
// Before (0.0.x)
import { useQuery } from "@reactivebase/client"

// After (0.1.0)
import { useQuery } from "@reactivebase/react" // or /vue or /svelte
```

## General Guidelines

### Checking Your Current Version

```bash
npx reactivebase --version
# or
cat node_modules/@reactivebase/server/package.json | grep version
```

### Pinning Versions

Until ReactiveBase reaches 1.0, pin exact versions in `package.json` to avoid unexpected breaking changes:

```json
{
  "dependencies": {
    "@reactivebase/server": "0.1.5",
    "@reactivebase/react": "0.1.5"
  }
}
```

### Reporting Issues

If you encounter problems during an upgrade, [open an issue](https://github.com/reactivebase/reactivebase/issues) with:
- Your previous and target versions
- The error message or unexpected behavior
- A minimal reproduction if possible

## Future Versions

This document will be updated with each release. Subscribe to [GitHub releases](https://github.com/reactivebase/reactivebase/releases) to be notified of new versions.
