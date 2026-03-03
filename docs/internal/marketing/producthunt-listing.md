# ProductHunt Launch Listing

## Tagline (60 chars max)

Convex DX on Postgres — reactive backend framework (MIT)

## Description (260 chars)

ReactiveBase gives you Convex-style developer experience on PostgreSQL you control. Live queries, automatic transactions, AI/vector search, scheduling — 85 modules in one TypeScript framework. MIT licensed, self-hosted.

## Detailed Description

### The Problem

Building real-time SaaS means assembling 5+ tools: ORM, API layer, WebSocket server, cache, job queue. Each with its own config, error handling, and scaling strategy. 1,250+ lines of integration code before writing business logic.

### The Solution

ReactiveBase replaces all of them with three primitives:

- `query()` — reactive reads that auto-update clients
- `mutation()` — transactional writes (SERIALIZABLE, auto-retry)
- `action()` — background jobs + scheduling

### Key Features

🔄 **Reactive Queries** — every query is live, filter-level invalidation
🔒 **Automatic Transactions** — SERIALIZABLE on every mutation
🧠 **AI/Vector Search** — pgvector with reactive subscriptions
🐘 **Postgres-Native** — SQL, JSONB, PostGIS, full control
⏰ **Built-in Scheduler** — cron + job queue, no BullMQ needed
🔌 **Plugin Ecosystem** — Clerk, Stripe, S3, and community plugins

### Tech Specs

- 19,447 LOC TypeScript
- 425 tests
- 30 server modules
- 12 npm packages
- 7 client SDKs (React, Vue, Svelte, Next.js, Edge, Testing, Offline)

### Links

- Website: https://reactivebase.dev
- GitHub: https://github.com/reactivebase/reactivebase
- Live Demo: https://reactivebase-demo.fly.dev
- Playground: https://reactivebase.dev/play
- Docs: https://reactivebase.dev/docs/getting-started

### Categories

- Developer Tools
- Open Source
- Productivity

### Makers

@josedab — Creator

## Launch Day Checklist

- [ ] Schedule for Tuesday 12:01 AM PT (highest PH traffic)
- [ ] Prepare 3-5 screenshots showing: schema, query, React component, dashboard, CLI
- [ ] Record 30-second GIF showing live reactive updates
- [ ] Prepare "first comment" explaining the why behind ReactiveBase
- [ ] Line up 10+ upvotes from developer friends
- [ ] Monitor and respond to all comments for 24 hours
