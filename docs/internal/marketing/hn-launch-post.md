# Show HN: ReactiveBase — Convex DX on Postgres (MIT, 19K LOC, 425 tests)

Hi HN, I built ReactiveBase — an open-source reactive backend framework that gives you the Convex developer experience on PostgreSQL you control.

**The problem:** Building real-time SaaS means assembling Prisma + tRPC + Socket.io + BullMQ + Redis — 5 tools, 1000+ lines of glue code, 5 upgrade cycles.

**The solution:** One framework. `query()` for reactive reads, `mutation()` for transactional writes, `action()` for background jobs. Every query is automatically live — clients get updates when data changes. Every mutation runs in a SERIALIZABLE Postgres transaction.

**What's different from Convex?**

- MIT license (Convex uses FSL)
- Your Postgres (SQL, JSONB, PostGIS, pgvector)
- 30 server modules (auth, scheduler, webhooks, storage, presence, multi-tenant, AI/vector, etc.)
- Prisma migration tool: `npx @reactivebase/migrate-from-prisma`

**Quick start:**

```
npx create-reactivebase my-app
cd my-app && npm install && npm run dev
```

**Numbers:** 19,447 LOC TypeScript, 425 tests, 12 npm packages, 30 server modules, 7 client SDKs (React/Vue/Svelte/Next.js/Edge/Testing/Offline), deploy templates for Docker/Fly/Railway/Render.

**Try it:** https://reactivebase-demo.fly.dev
**Docs:** https://reactivebase.dev
**GitHub:** https://github.com/reactivebase/reactivebase
**Playground:** https://reactivebase.dev/play

I'd love feedback on the DX, architecture decisions, and what features matter most. Happy to answer questions about the reactive engine, filter-level invalidation, or the type inference chain.
