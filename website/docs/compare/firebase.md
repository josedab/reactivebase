---
sidebar_position: 3
---

# ReactiveBase vs Firebase

Both provide real-time subscriptions. Fundamental differences in data model and control.

| Feature | ReactiveBase | Firebase |
|---------|-------------|----------|
| **Database** | PostgreSQL (relational) | Firestore (NoSQL document) |
| **Queries** | SQL, joins, aggregations | Limited (no joins) |
| **Transactions** | SERIALIZABLE auto | Limited batched writes |
| **Self-hosted** | ✅ Anywhere | ❌ Google Cloud only |
| **Open source** | ✅ MIT | ❌ Proprietary |
| **Vector/AI** | ✅ pgvector | ❌ |
| **Pricing** | Self-hosted (free) | Usage-based (can be expensive) |
| **Vendor lock-in** | None | Total |

### When to choose ReactiveBase

- You need relational data with joins and aggregations
- You want to self-host on your own infrastructure
- You need SQL access for analytics and reporting
- Vendor lock-in is unacceptable

### When to choose Firebase

- You're building a mobile-first prototype
- You want zero-ops managed infrastructure
- You're already in the Google Cloud ecosystem
