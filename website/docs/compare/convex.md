---
sidebar_position: 1
---

# ReactiveBase vs Convex

Both provide reactive queries and automatic transactions. Here's how they differ:

| Feature | ReactiveBase | Convex |
|---------|-------------|--------|
| **License** | MIT | FSL (→ Apache after 2yr) |
| **Database** | PostgreSQL (yours) | Proprietary document store |
| **Self-hosted** | ✅ Full control | ⚠️ Limited (FSL restrictions) |
| **SQL access** | ✅ Full SQL, JSONB, PostGIS | ❌ No SQL |
| **Vector/AI** | ✅ pgvector built-in | ❌ Not available |
| **File storage** | ✅ S3/Local | ✅ Built-in |
| **Scheduling** | ✅ Postgres-backed | ✅ Built-in |
| **Presence** | ✅ Room-based | ✅ Built-in |
| **Webhooks** | ✅ In + Out | ❌ |
| **Migration tools** | ✅ From Prisma/Drizzle | ❌ |
| **Testing** | ✅ MockDatabase, TestServer | ❌ |
| **Framework SDKs** | React, Vue, Svelte, Next.js | React, Vue, Svelte |
| **Observability** | ✅ Prometheus, OTEL | ❌ |
| **Multi-tenant** | ✅ Row + Schema | ❌ |

### When to choose ReactiveBase

- You need Postgres: SQL, joins, JSONB, full-text search, PostGIS
- You need AI/vector search with reactive updates
- You want MIT license with zero commercial restrictions
- You have existing Postgres infrastructure
- You need to migrate from Prisma, Drizzle, or tRPC

### When to choose Convex

- You want a fully managed service with zero ops
- You don't need SQL or Postgres-specific features
- You prefer a document database model
