---
sidebar_position: 7
---

# Enterprise

ReactiveBase is designed for production workloads from day one.

## Enterprise Features

### Security & Compliance

| Feature | Status | Description |
|---------|--------|-------------|
| **JWT Auth (RS256/JWKS)** | ✅ Built-in | Industry-standard asymmetric key verification with auto-caching JWKS |
| **Role-Based Access Control** | ✅ Built-in | Declarative `roles()` and `allow()` on every function |
| **Row-Level Security** | ✅ Built-in | `defineRlsPolicy()` enforced at the database query level |
| **Rate Limiting** | ✅ Built-in | Per-client sliding window with configurable limits |
| **Argument Validation** | ✅ Built-in | Schema-based validation DSL, enforced before handler execution |
| **SQL Injection Prevention** | ✅ Built-in | All queries use parameterized SQL |
| **HTTPS/WSS** | ✅ Via proxy | Reverse proxy (nginx/Cloudflare) handles TLS |

### Multi-Tenancy

| Mode | Description |
|------|-------------|
| **Row-Level** | Shared tables with auto-injected `tenantId` filter on every query |
| **Schema-Per-Tenant** | Separate Postgres schema per tenant, switched via `SET search_path` |

```typescript
import { createTenancyMiddleware } from "@reactivebase/server"

server.use(createTenancyMiddleware({
  mode: "row",
  column: "organizationId",
  claimKey: "orgId",
}))
```

### Observability

| Tool | Integration |
|------|-------------|
| **Prometheus** | `/metrics` endpoint in Prometheus exposition format |
| **OpenTelemetry** | Trace spans for every query/mutation/action |
| **Dashboard** | Built-in `/dashboard` with live metrics, schema viewer, subscription monitor |
| **Structured Logging** | JSON log output with `ctx.log.info/warn/error` |

### Scalability

| Feature | Description |
|---------|-------------|
| **Horizontal Scaling** | Stateless servers with Redis pub/sub for cross-server invalidation |
| **Connection Pooling** | Configurable Postgres pool size |
| **Filter-Level Invalidation** | Only affected subscriptions re-execute (not all table subscribers) |
| **Binary Protocol** | Optional binary WebSocket framing for reduced bandwidth |
| **50K+ Subscriptions** | Verified via load tests at under 2KB memory per subscription |

### Change Data Capture

Detect external database changes (direct SQL, data pipelines, other services):

```typescript
import { CdcListener } from "@reactivebase/server"

const cdc = new CdcListener({ channel: "reactivebase_changes" })
cdc.onChanges(async (events) => {
  await engine.processChanges(events)
})
await cdc.start(pgClient)
```

## Enterprise Support

### Pilot Program

We offer a free 90-day enterprise pilot that includes:

- Dedicated Slack/Discord support channel
- Architecture review for your use case
- Custom plugin development guidance
- Published case study (with your approval)

**Contact:** enterprise@reactivebase.dev

### Support Tiers

| Tier | Price | SLA | Includes |
|------|-------|-----|----------|
| Community | Free | Best effort | GitHub issues, Discord |
| Pro | 500/mo | 48h response | Email support, priority fixes |
| Enterprise | Custom | 4h response | Dedicated engineer, custom development, SLA |

## Self-Hosted vs Cloud

| | Self-Hosted (MIT) | ReactiveBase Cloud |
|---|---|---|
| **Price** | Free | From free tier |
| **Infrastructure** | You manage | We manage |
| **Data location** | Your choice | US/EU/APAC regions |
| **Customization** | Full source access | Configuration-based |
| **Support** | Community + paid tiers | Included |

ReactiveBase is MIT-licensed. Self-hosting is always free, with no feature restrictions.
