# Contributor Onboarding Guide

Welcome! This guide helps you make your first contribution to ReactiveBase.

## Architecture Overview (5 min read)

```
packages/
├── server/          ← Core server framework (48 modules, ~50K LOC)
│   └── src/
│       ├── schema/          Schema definition, validators
│       ├── functions/       query(), mutation(), action()
│       ├── reactivity/      Subscription engine, invalidation, edge cache
│       ├── transport/       WebSocket server
│       ├── auth/            JWT, RLS, RBAC, Zanzibar
│       ├── scaling/         Subscription sharding, cluster mgmt
│       ├── cdc/             Change data capture (LISTEN/NOTIFY + WAL)
│       ├── metrics/         Prometheus, OTEL, performance profiler
│       ├── migrations/      Schema diffing, zero-downtime planner
│       ├── plugins/         Marketplace, portal, first-party plugins
│       ├── collaboration/   Yjs protocol, document collaboration
│       ├── encryption/      Field-level encryption, compliance
│       └── ...              40+ more modules
├── client/          ← Framework-agnostic client (8 modules)
├── react/           ← React hooks
├── vue/             ← Vue composables
├── svelte/          ← Svelte stores
├── nextjs/          ← Next.js SSR
├── cli/             ← CLI with dev/generate/migrate/deploy
├── vscode-extension/← VS Code integration
└── testing/         ← Test utilities
```

## How to Add a Module

1. Create `packages/server/src/<module>/` directory
2. Create `<module>.ts` with implementation
3. Create `index.ts` barrel with exports
4. Add exports to `packages/server/src/index.ts`
5. Create `packages/server/src/__tests__/<module>.test.ts`
6. Run `npm run build && npm run test`

## Coding Conventions

- **TypeScript strict mode** — no `any`
- **Comments** — only for non-obvious logic
- **Tests** — Vitest, factory helpers, no external mocks
- **Exports** — re-export from index.ts, never import deep paths
- **Classes** — constructor with options pattern, private with `private` keyword
- **Errors** — typed errors (e.g., `PluginMarketplaceError`)

## Good First Issues

These issues are designed for first-time contributors:

### Easy (< 1 hour)
- [ ] Add a new validator type (e.g., `v.url()`, `v.uuid()`)
- [ ] Improve error messages in schema validation
- [ ] Add JSDoc comments to public API functions
- [ ] Fix typos in documentation

### Medium (1-3 hours)
- [ ] Add a new first-party plugin (e.g., Twilio SMS)
- [ ] Add pagination support to Admin Studio data browser
- [ ] Add a new interactive tutorial to TutorialManager
- [ ] Add a new Grafana dashboard panel

### Advanced (3-8 hours)
- [ ] Add cursor-based pagination to the query builder
- [ ] Implement Redis Cluster support in PubSubAdapter
- [ ] Add WebSocket compression (permessage-deflate)
- [ ] Add rate limiting per API key in the gateway

## Running Tests

```bash
# All tests
npm run test

# Specific package
cd packages/server && npx vitest run

# Specific test file
cd packages/server && npx vitest run src/__tests__/schema.test.ts

# Watch mode
cd packages/server && npx vitest watch
```

## Pull Request Checklist

- [ ] Tests pass: `npm run build && npm run test`
- [ ] New features have tests
- [ ] Exports added to relevant `index.ts` files
- [ ] No console.log in production code
- [ ] PR description explains what and why

## Questions?

- Open a GitHub Discussion
- Join our Discord server
- Check the [documentation](https://reactivebase.dev/docs)
