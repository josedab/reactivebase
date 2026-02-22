# Enterprise Pilot Program — Outreach Templates

## Cold Email Template

**Subject:** Free 90-day pilot: reactive backend for [Company] — MIT licensed

**Body:**

Hi [Name],

I noticed [Company] is building [specific real-time feature / using Prisma+tRPC / evaluating backend frameworks]. I'd like to offer you a free 90-day pilot of ReactiveBase — an open-source reactive backend framework that replaces Prisma + tRPC + Socket.io + BullMQ with one TypeScript framework on Postgres.

**What ReactiveBase provides:**
- Every query is automatically live (no WebSocket setup)
- Every mutation runs in a SERIALIZABLE Postgres transaction
- Built-in: auth (JWT/JWKS), multi-tenancy, rate limiting, scheduling, file storage, AI/vector search
- MIT licensed, self-hosted on your Postgres

**The pilot includes:**
- Dedicated support channel (Slack or Discord)
- Architecture review for your use case
- Help with migration from your current stack
- Published case study (with your approval)

**No cost, no commitment.** We're looking for 3 early adopters to validate the framework in production and provide feedback.

Interested in a 15-minute demo? Here's a live example: https://reactivebase-demo.fly.dev

Best,
[Your name]

---

## Follow-up Email (if no response after 5 days)

**Subject:** Re: Free 90-day pilot: reactive backend for [Company]

Hi [Name],

Quick follow-up — wanted to share a concrete comparison:

**Before (5 tools, ~1,250 lines of glue):**
Prisma + tRPC + Socket.io + BullMQ + Redis

**After (1 framework, ~20 lines):**
```typescript
export const listTasks = query(async (ctx, { userId }) =>
  ctx.db.tasks.where({ assigneeId: userId, done: false })
)
```

Every client subscribed to this query gets automatic updates when any task changes. No manual WebSocket setup, no cache invalidation, no subscription management.

Happy to do a live demo anytime: [calendar link]

Best,
[Your name]

---

## Target Company Criteria

1. Using TypeScript + React/Next.js
2. Has real-time features (dashboards, collaboration, notifications)
3. Currently using Prisma, Drizzle, or tRPC
4. 10-100 engineers (large enough to validate, small enough to move fast)
5. B2B SaaS (multi-tenancy is a differentiator)

## Where to Find Targets

- Companies hiring for "real-time" or "WebSocket" on job boards
- GitHub repos using Prisma + tRPC + Socket.io together
- Hacker News "Who is hiring" threads mentioning TypeScript + Postgres
- Discord communities: Prisma, tRPC, Convex (users evaluating alternatives)
