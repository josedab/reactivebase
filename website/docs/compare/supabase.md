---
sidebar_position: 2
---

# ReactiveBase vs Supabase

Both run on PostgreSQL. The key difference is reactivity model.

| Feature | ReactiveBase | Supabase |
|---------|-------------|----------|
| **Reactivity** | Query-level (filter-aware) | Row-level CDC |
| **Transactions** | Automatic SERIALIZABLE | Manual |
| **Query builder** | Type-safe with relations | PostgREST / SQL |
| **Scheduling** | ✅ Built-in | ❌ Needs pg_cron |
| **Presence** | ✅ Built-in | ❌ Requires Realtime Presence |
| **Middleware** | ✅ Before/after hooks | ❌ |
| **Permissions** | ✅ Declarative RBAC | RLS policies (SQL) |
| **AI/Vector** | ✅ Reactive vector queries | ⚠️ pgvector (no reactive) |
| **File storage** | ✅ S3-compatible | ✅ Built-in |
| **Auth** | JWT/JWKS + custom | ✅ Full auth system |
| **Dashboard** | ✅ Schema visualizer | ✅ Supabase Studio |

### When to choose ReactiveBase

- You need automatic reactive updates (not manual subscriptions)
- You want serializable transactions without writing SQL
- You need a unified framework (not assembling Supabase + tRPC + BullMQ)

### When to choose Supabase

- You need a full platform (auth, storage, edge functions, dashboard)
- You prefer writing raw SQL and managing your own reactivity
- You want the largest Postgres-based community
