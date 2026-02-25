# Roadmap

This document outlines the planned development direction for ReactiveBase. It is a living document and will be updated as priorities evolve.

> **Want to help?** Look for issues labeled [`good first issue`](https://github.com/reactivebase/reactivebase/labels/good%20first%20issue) or [`help wanted`](https://github.com/reactivebase/reactivebase/labels/help%20wanted) on GitHub.

## In Progress

- **Stabilize core APIs** — finalize the public API surface for `@reactivebase/server`, `@reactivebase/client`, and framework SDKs before 1.0
- **Improve test coverage** — expand integration and edge-case tests across all packages
- **Documentation site** — fill in missing guides, add more examples, and improve API reference docs

## Planned

### Short-Term

- End-to-end type safety improvements across client/server boundary
- CLI improvements: better error messages, interactive migration diffs
- Performance benchmarking and optimization for high-subscription workloads
- Expanded deployment guides (AWS, GCP, Azure)

### Medium-Term

- GraphQL subscriptions gateway GA
- React Native offline-first improvements
- Plugin ecosystem expansion (more first-party plugins)
- Visual schema designer improvements
- Improved migration tooling for Drizzle and other ORMs

### Long-Term

- Managed cloud offering (ReactiveBase Cloud)
- Multi-region replication
- Edge compute integration
- Collaborative real-time editing primitives

## Completed

- ✅ Core reactive query engine
- ✅ Automatic serializable transactions
- ✅ JWT authentication (HS256, RS256, JWKS)
- ✅ React, Vue, Svelte, Next.js SDKs
- ✅ CLI tooling (dev, generate, migrate)
- ✅ Plugin system and registry
- ✅ File storage (S3, local, in-memory)
- ✅ Job scheduler with cron support
- ✅ Docusaurus documentation site

## Feedback

Have ideas or feature requests? [Open a discussion](https://github.com/reactivebase/reactivebase/discussions) or join our [Discord](https://discord.gg/reactivebase).
