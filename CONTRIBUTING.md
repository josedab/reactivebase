# Contributing to ReactiveBase

Thank you for considering contributing to ReactiveBase! This guide will help you get started.

## Development Setup

> **Node.js compatibility:** ReactiveBase requires Node.js ≥ 20. CI tests against Node 20 and 22. The `.nvmrc` pins to `20` as the minimum supported version. If you use `nvm`, run `nvm use` to switch automatically.

```bash
# Clone the repository
git clone https://github.com/reactivebase/reactivebase.git
cd reactivebase

# Install dependencies
npm install

# Build all packages
npm run build

# Run all tests
npm run test

# Run all validations at once (build, typecheck, test, lint, format check)
npm run check
```

## Project Architecture

ReactiveBase is a Turborepo monorepo with 15 packages:

```
packages/
├── server/          ← Core server framework (85+ modules)
│   └── src/
│       ├── schema/          Schema definition, validators, migrations
│       ├── functions/       query(), mutation(), action() primitives
│       ├── query-builder/   Type-safe SQL builder + vector search
│       ├── reactivity/      Subscription registry, invalidation, diffing
│       ├── transaction/     Serializable TX with auto-retry
│       ├── transport/       WebSocket server + protocol
│       ├── auth/            JWT HS256/RS256/JWKS, RLS policies
│       ├── permissions/     Declarative RBAC (roles, allow)
│       ├── tenancy/         Multi-tenant row + schema isolation
│       ├── validation/      Rate limiting + arg validation DSL
│       ├── middleware/      Before/after/error hooks
│       ├── scheduler/       Postgres job queue + cron
│       ├── pubsub/          Redis + in-memory cross-server
│       ├── cdc/             Postgres LISTEN/NOTIFY CDC
│       ├── metrics/         Prometheus + OTEL tracing
│       ├── webhooks/        Inbound HMAC + outbound triggers
│       ├── storage/         S3/Local/Memory file storage
│       ├── presence/        Room-based presence + CRDT ops
│       ├── ai/              OpenAI/Ollama providers + RAG
│       ├── api-gen/         REST + GraphQL auto-generation
│       ├── codegen/         Type-safe API code generator
│       ├── migrate-from/    Prisma + Drizzle converters
│       ├── migrations/      Migration manager + schema diffing
│       ├── dashboard/       Visual schema + metrics dashboard
│       ├── benchmark/       Performance benchmark suite
│       ├── plugins/         Plugin protocol + registry
│       ├── cloud/           Cloud API client
│       ├── embedded/        PGlite adapter
│       ├── types/           End-to-end type inference
│       └── config/          Server configuration
├── client/          ← Framework-agnostic client
├── react/           ← React hooks (useQuery, useMutation, useAction)
├── vue/             ← Vue 3 composables
├── svelte/          ← Svelte stores
├── nextjs/          ← Next.js SSR + streaming
├── edge/            ← Edge runtime adapter
├── testing/         ← TestServer + MockDatabase
├── cli/             ← Dev server, generate, migrate
├── create-reactivebase/ ← Project scaffolding wizard
└── reactivebase/    ← Umbrella re-export
```

## How to Add a Module

1. Create a directory under `packages/server/src/<module-name>/`
2. Create `<module-name>.ts` with implementation
3. Create `index.ts` with exports
4. Add exports to `packages/server/src/index.ts`
5. Create tests in `packages/server/src/__tests__/<module-name>.test.ts`
6. Run `npm run build && npm run test` to verify

## Coding Conventions

- **TypeScript strict mode** — no `any` where avoidable
- **Comments** — only for non-obvious logic, not for self-documenting code
- **Tests** — every module should have tests; use Vitest
- **Exports** — re-export from index.ts, never import from deep paths
- **Naming** — camelCase for functions, PascalCase for classes/types
- **Error handling** — throw typed errors (e.g., `AuthenticationError`, `ValidationError`)

## Pull Request Process

1. Fork the repo and create a branch from `main`
2. Make your changes following the conventions above
3. Add/update tests for your changes
4. Run `npm run check` to validate everything (build, typecheck, test, lint, format)
5. Open a PR with a clear description of what and why
6. Wait for review — maintainers will respond within 48 hours

## Good First Issues

Look for issues labeled `good first issue` on GitHub. These are typically:

- Adding a new validator type to `v.*`
- Adding a test for an existing module
- Improving error messages
- Documentation improvements
- Adding a new example app

For deeper contributor guidance, see [docs/ONBOARDING.md](docs/ONBOARDING.md).

## Documentation Site

The documentation site is built with [Docusaurus](https://docusaurus.io/) and lives in the `website/` directory.

```bash
# Start the docs site locally
cd website
npm install
npm start
```

This opens the site at `http://localhost:3000`. Changes to docs files are hot-reloaded.

## Running Examples

The `examples/` directory contains 5 example apps demonstrating different features:

| Example                | Complexity   | Features                                          |
| ---------------------- | ------------ | ------------------------------------------------- |
| `basic-todo`           | Beginner     | Queries, mutations, actions, middleware           |
| `collaborative-board`  | Intermediate | Real-time collaboration, presence, rate limiting  |
| `collaborative-editor` | Advanced     | CRDT integration, shared cursors, offline editing |
| `project-manager`      | Advanced     | RBAC, Kanban boards, row-level security           |
| `saas-dashboard`       | Advanced     | Multi-tenant isolation, live metrics              |

To run an example locally:

```bash
cd examples/basic-todo
cp .env.example .env    # Set your DATABASE_URL
npm install
npm run dev
```

All examples require PostgreSQL 14+ and a configured `DATABASE_URL`. See each example's `.env.example` for details.

## Build Pipeline

ReactiveBase uses [Turborepo](https://turbo.build/) to orchestrate builds across packages. Understanding the task dependency graph helps when debugging build issues or running selective builds.

### Task Dependencies

| Task            | Depends On                   | Cached             | Outputs        |
| --------------- | ---------------------------- | ------------------ | -------------- |
| `build`         | `^build` (upstream packages) | ✅                 | `dist/**`      |
| `test`          | `build` (same package)       | ✅                 | —              |
| `test:coverage` | `build` (same package)       | ✅                 | `coverage/**`  |
| `typecheck`     | `^build` (upstream packages) | ✅                 | —              |
| `lint`          | —                            | ✅ (scoped inputs) | —              |
| `dev`           | —                            | ❌                 | — (persistent) |
| `test:watch`    | —                            | ❌                 | — (persistent) |
| `benchmark`     | `build`                      | ❌                 | —              |
| `clean`         | —                            | ❌                 | —              |

**Key relationships:**

- `^build` means "build all upstream dependency packages first" — ensures `@reactivebase/react` builds after `@reactivebase/client` and `@reactivebase/server`.
- `test` depends on `build` within the same package, so tests always run against fresh build output.
- `lint` only processes `src/**/*.ts`, `src/**/*.tsx`, and `eslint.config.js` — changes to test files won't invalidate the lint cache.

### Caching Behavior

Turbo caches task outputs by default. Tasks marked `"cache": false` always re-run:

- **`dev`**, **`test:watch`**: Persistent long-running processes — never cached.
- **`benchmark`**, **`clean`**: Side-effectful tasks — never cached.

To force a clean build (bypass all caches):

```bash
npx turbo clean
npm run build
```

### Running Specific Packages

```bash
# Build only the server package and its dependencies
npx turbo run build --filter=@reactivebase/server

# Test only React hooks (builds server + client first)
npx turbo run test --filter=@reactivebase/react

# Build everything except the VS Code extension
npx turbo run build --filter='!@reactivebase/vscode-extension'
```

## Testing

```bash
# Run all tests
npm run test

# Run tests for a specific package (convenience scripts)
npm run test:server
npm run test:client
npm run test:react

# Run tests for any package using turbo filter
npx turbo run test --filter=@reactivebase/server
npx turbo run test --filter=@reactivebase/vue

# Run a specific test file
cd packages/server && npx vitest run src/__tests__/schema.test.ts

# Watch mode
cd packages/server && npx vitest watch

# Run a specific test file from the repo root
npm run test:file -- packages/server/src/__tests__/schema.test.ts

# Run tests with coverage
npm run test:coverage
```

## Troubleshooting

### Benchmarks

ReactiveBase includes a benchmark suite that measures query, mutation, and subscription performance.

```bash
# Run all benchmarks
npm run benchmark
```

The CI benchmark workflow runs on every push to `main` and automatically updates the performance badge in the README. When contributing performance-sensitive changes, run benchmarks locally before and after your change to compare results.

### `npm run typecheck` fails on `@reactivebase/edge`

The edge package has test files that reference types not compatible with its `tsconfig.json`. This is a known issue.

**Workaround:** Run typecheck excluding the edge package:

```bash
npx turbo run typecheck --filter='!@reactivebase/edge'
```

### `npm run lint` fails on `@reactivebase/testing`

The testing package has 8 known ESLint errors (unused variables and missing return types in test helpers).

**Workaround:** Run lint excluding the testing package:

```bash
npx turbo run lint --filter='!@reactivebase/testing'
```

### `npm run format:check` shows warnings

If `format:check` reports unformatted files, run the formatter to auto-fix them:

```bash
npm run format
```

Then verify with `npm run format:check`.

### `npm run typecheck` fails on `create-reactivebase`

If you see TS2339 errors in `create-reactivebase`, ensure the destructuring in `src/index.ts` matches the return type of `generateDependencies()` (should use `dependencies`/`devDependencies`, not prefixed with underscores).

### Turbo cache issues

If you see stale build artifacts or unexplained failures after switching branches:

```bash
npx turbo clean
npm run build
```

### Port conflicts on `npm run dev`

If port 4000 is already in use, either stop the other process or set a different port in `reactivebase.config.ts`:

```ts
export default defineConfig({
  server: { port: 4001 },
})
```

### Node version mismatch

ReactiveBase requires Node.js ≥ 20. Check your version:

```bash
node --version
```

If you use `nvm`, the repo includes `.nvmrc`:

```bash
nvm use
```

### Workspace linking issues

If packages can't resolve each other after a fresh clone:

```bash
rm -rf node_modules packages/*/node_modules
npm install
npm run build
```

## Questions?

## Release Process

### How Releases Work

ReactiveBase uses **tag-based releases**. When a Git tag matching `v*` (e.g., `v0.2.0`) is pushed, the CI pipeline automatically publishes all packages.

### CI vs Manual Publishing

| Method             | File                            | When to use                                         |
| ------------------ | ------------------------------- | --------------------------------------------------- |
| **CI (automated)** | `.github/workflows/release.yml` | Standard releases — triggered by pushing a `v*` tag |
| **Manual**         | `scripts/publish.sh`            | Emergency hotfixes or when CI is unavailable        |

Both publish the same 14 packages to npm in dependency order.

### NPM_TOKEN GitHub Secret

The `NPM_TOKEN` secret is an npm access token with publish permissions for the `@reactivebase` scope. It is configured as a GitHub repository secret and used by the `release.yml` workflow via `NODE_AUTH_TOKEN`.

To rotate the token:

1. Generate a new token at [npmjs.com/settings/tokens](https://www.npmjs.com/settings/tokens)
2. Update the `NPM_TOKEN` secret in GitHub repository settings → Secrets and variables → Actions

### Version Bumping

1. Update the `version` field in all `packages/*/package.json` files to the new version
2. Update cross-package dependency versions if needed
3. Commit the version bump
4. Create and push the tag: `git tag v0.2.0 && git push origin v0.2.0`

### Publish Order

Packages are published in dependency order to ensure downstream packages can resolve their dependencies:

1. `@reactivebase/server` (core — no internal deps)
2. `@reactivebase/client` (depends on server types)
3. `@reactivebase/react`, `vue`, `svelte` (depend on client)
4. `@reactivebase/nextjs`, `edge` (depend on client + server)
5. `@reactivebase/testing`, `cli` (depend on server)
6. `@reactivebase/reactivebase` (umbrella re-export)
7. `create-reactivebase`, `migrate-from-prisma` (standalone tools)
8. `@reactivebase/graphql`, `react-native` (framework extensions)

> **Note:** The VS Code extension (`packages/vscode-extension`) is published separately to the VS Code Marketplace, not npm.

- Open a GitHub Discussion for questions
- Join our Discord server for real-time chat
- Check the [documentation site](https://reactivebase.dev) for guides

Thank you for contributing! 🚀
