# Contributing to ReactiveBase

Thank you for considering contributing to ReactiveBase! This guide will help you get started.

## Development Setup

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
```

## Project Architecture

ReactiveBase is a Turborepo monorepo with 15 packages:

```
packages/
├── server/          ← Core server framework (30 modules)
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
4. Run `npm run build && npm run test` (must pass)
5. Open a PR with a clear description of what and why
6. Wait for review — maintainers will respond within 48 hours

## Good First Issues

Look for issues labeled `good first issue` on GitHub. These are typically:

- Adding a new validator type to `v.*`
- Adding a test for an existing module
- Improving error messages
- Documentation improvements
- Adding a new example app

## Testing

```bash
# Run all tests
npm run test

# Run tests for a specific package
cd packages/server && npx vitest run

# Run a specific test file
cd packages/server && npx vitest run src/__tests__/schema.test.ts

# Watch mode
cd packages/server && npx vitest watch
```

## Questions?

- Open a GitHub Discussion for questions
- Join our Discord server for real-time chat
- Check the [documentation site](https://reactivebase.dev) for guides

Thank you for contributing! 🚀
