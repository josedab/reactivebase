---
sidebar_position: 14
---

# Multi-Tenancy

*Estimated time: 10 minutes*

ReactiveBase provides multi-tenancy primitives for SaaS applications via the `tenant` export category. You can choose between row-level isolation (shared tables with a `tenant_id` column) and schema-per-tenant isolation (separate Postgres schemas), with built-in Stripe billing integration and a tenant admin dashboard.

## Architecture Comparison

| | Row-Level Isolation | Schema-Per-Tenant |
|---|---|---|
| **How it works** | Shared tables with `tenant_id` column + RLS policies | Separate Postgres schema per tenant |
| **Setup complexity** | Low — add column, enable RLS | Medium — create schema on onboarding |
| **Data isolation** | Logical (enforced by RLS) | Physical (separate schemas) |
| **Cross-tenant queries** | Easy (remove filter) | Requires schema switching |
| **Migration effort** | Single migration for all tenants | Must run migration per schema |
| **Performance** | Good — index on `tenant_id` | Good — smaller tables per tenant |
| **Best for** | Most SaaS apps, startups | Regulated industries, enterprise clients |

## Row-Level Isolation

### 1. Configure Tenancy Middleware

```typescript
import { createTenancyMiddleware, defineConfig } from "@reactivebase/server"

export default defineConfig({
  middleware: [
    createTenancyMiddleware({
      mode: "row",
      tenantIdColumn: "tenant_id",
      tenantClaimKey: "org_id", // JWT claim containing the tenant ID
    }),
  ],
})
```

The middleware automatically injects `WHERE tenant_id = ?` into all queries and sets the tenant context for mutations.

### 2. Extract Tenant ID

```typescript
import { getTenantId } from "@reactivebase/server"

// In a function handler:
const tenantId = getTenantId(ctx.auth, "org_id")
```

### 3. Enable Row-Level Security

Generate and apply RLS policies for your tables:

```typescript
import { buildEnableRlsSQL, buildCreateRlsPolicySQL } from "@reactivebase/server"

// Enable RLS on a table
const enableSQL = buildEnableRlsSQL("tasks")
// => ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

// Create a policy
const policySQL = buildCreateRlsPolicySQL("tasks", {
  column: "tenant_id",
  role: "app_user",
})
// => CREATE POLICY tenant_isolation ON tasks ...
```

## Schema-Per-Tenant Isolation

### 1. Configure Schema Mode

```typescript
createTenancyMiddleware({
  mode: "schema",
  tenantClaimKey: "org_id",
})
```

### 2. Provision Tenant Schemas

```typescript
import { generateTenantSchemaSQL, generateSetSchemaSQL } from "@reactivebase/server"

// Create a new tenant schema
const createSQL = generateTenantSchemaSQL("tenant_acme")
// => CREATE SCHEMA tenant_acme;

// Switch to a tenant's schema
const switchSQL = generateSetSchemaSQL("tenant_acme")
// => SET search_path TO tenant_acme;
```

### 3. Remove a Tenant

```typescript
import { generateDropTenantSQL } from "@reactivebase/server"

const dropSQL = generateDropTenantSQL("tenant_acme")
// => DROP SCHEMA tenant_acme CASCADE;
```

## Per-Tenant Connection Pooling

`TenantConnectionRouter` manages separate connection pools per tenant, preventing noisy-neighbor problems.

```typescript
import { TenantConnectionRouter } from "@reactivebase/server"

const router = new TenantConnectionRouter({
  maxConnectionsPerTenant: 10,
  idleTimeoutMs: 30_000,
})

// Get a connection for a tenant
const conn = await router.getConnection("tenant_acme")

// Monitor pool stats
const stats = router.getPoolStats()
// => Map<tenantId, { active, idle, total }>

// Clean up
await router.closeTenant("tenant_acme")
await router.closeAll()
```

## SaaS Kit

`SaasKit` provides a complete tenant lifecycle: onboarding, plan management, usage tracking, and admin analytics.

### Setup

```typescript
import { SaasKit } from "@reactivebase/server"

const saas = new SaasKit({
  mode: "row",
  plans: "default", // uses DEFAULT_PLANS (Free, Starter, Pro, Enterprise)
})
```

### Default Plans

| Plan | Monthly Price | Users | Storage | API Calls |
|------|--------------|-------|---------|-----------|
| Free | $0 | 5 | 100 MB | 1,000 |
| Starter | $29 | 25 | 1 GB | 10,000 |
| Pro | $99 | 100 | 10 GB | 100,000 |
| Enterprise | $499 | Unlimited | 100 GB | Unlimited |

### Tenant Lifecycle

```typescript
// Onboard a new tenant
const tenant = await saas.onboardTenant({
  name: "Acme Corp",
  plan: "starter",
  adminEmail: "admin@acme.com",
})

// Change plan
await saas.changePlan(tenant.id, "pro")

// Check usage limits
const allowed = await saas.checkPlanLimit(tenant.id, "apiCalls")

// Update usage metrics
await saas.updateUsage(tenant.id, { apiCalls: 1 })

// Admin overview (MRR, ARR, churn, growth)
const overview = await saas.getAdminOverview()
```

## Stripe Billing Integration

```typescript
import { StripeBillingProvider } from "@reactivebase/server"

const billing = new StripeBillingProvider({
  apiKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
})

// Create a customer
const customer = await billing.createCustomer({
  email: "billing@acme.com",
  name: "Acme Corp",
  tenantId: "tenant_acme",
})

// Create a subscription
const sub = await billing.createSubscription({
  customerId: customer.id,
  priceId: "price_pro_monthly",
})

// Report metered usage
await billing.recordUsage({
  subscriptionItemId: sub.itemId,
  quantity: 1500,
})

// Generate checkout session
const checkout = await billing.createCheckoutSession({
  customerId: customer.id,
  priceId: "price_pro_monthly",
  successUrl: "https://app.example.com/success",
  cancelUrl: "https://app.example.com/cancel",
})

// Handle webhooks
app.post("/stripe/webhook", async (req) => {
  await billing.handleWebhook(req.body, req.headers["stripe-signature"])
})
```

## Tenant Admin Dashboard

```typescript
import { TenantAdminDashboard } from "@reactivebase/server"

const dashboard = new TenantAdminDashboard(saas)

// KPI overview
const overview = await dashboard.getOverview()
// => { totalTenants, activeTenants, mrr, arr, churn, growth }

// Search tenants
const results = await dashboard.searchTenants("acme")

// Tenant details
const details = await dashboard.getTenantDetails("tenant_acme")

// Revenue summary
const revenue = await dashboard.getRevenueSummary()

// Generate embeddable HTML dashboard
const html = dashboard.generateAdminHTML()
```

## Next Steps

→ [Field-Level Encryption](./encryption.md) — Encrypt sensitive tenant data at the field level
→ [Observability](./observability.md) — Monitor per-tenant metrics and performance
