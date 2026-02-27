---
sidebar_position: 0
---

# Learning Paths

ReactiveBase has 48 server modules — but you don't need to learn them all at once. Choose the path that matches your goal:

## 🚀 Path 1: Quickstart (5 minutes)

**Goal**: Get a working ReactiveBase app running locally.

1. [Getting Started](../getting-started.md) — Install, scaffold, run
2. [Interactive Playground](../playground.md) — Try in browser without installing

**After this path**: You have a running app with a schema, queries, and mutations.

---

## 🧠 Path 2: Core Concepts (30 minutes)

**Goal**: Understand how ReactiveBase works under the hood.

1. [Core Concepts](../core-concepts.md) — Queries, mutations, actions, reactivity
2. [Schema & Validators](./schema-deep-dive.md) — All 12+ validator types and indexes
3. [Reactive Queries](./reactive-queries.md) — How subscription invalidation works
4. [Transactions](./transactions.md) — Automatic serializable transactions

**After this path**: You understand the reactive pipeline: define → subscribe → mutate → auto-update.

---

## 🏗️ Path 3: Build a SaaS (2 hours)

**Goal**: Build a production multi-tenant SaaS from scratch.

1. Schema design for multi-tenant apps
2. Authentication with JWT providers
3. Role-based access control (RBAC)
4. Tenant isolation (row-level vs schema-per-tenant)
5. Billing integration with Stripe plugin
6. Deploy to production

**Shortcut**: `npx create-reactivebase my-saas --template saas`

**After this path**: You have a deployed multi-tenant SaaS with auth, billing, and RBAC.

---

## 📈 Path 4: Scale to Production (1 hour)

**Goal**: Prepare your ReactiveBase app for production traffic.

1. [Deployment Guide](../deployment.md) — Docker, Fly.io, Railway, Kubernetes
2. [Observability](./observability.md) — Metrics, tracing, Grafana dashboards
3. [Performance](./performance.md) — Subscription sharding, edge caching, IVM
4. [Compliance](./compliance-guide.md) — PII detection, GDPR, SOC 2

**After this path**: You have a production-ready deployment with monitoring and compliance.

---

## 🔌 Path 5: Extend with Plugins & Workflows

**Goal**: Add reusable plugins and orchestrate multi-step processes.

1. [Plugins](./plugins.md) — Define, register, and test plugins
2. [Workflows](./workflows.md) — Multi-step orchestration with retries and compensation

**After this path**: You can extend ReactiveBase with custom integrations and run complex background workflows.

---

## 📚 Reference

- [API Reference](../api-reference.md) — Complete API documentation
- [Comparison: vs Convex](../compare/convex.md)
- [Comparison: vs Supabase](../compare/supabase.md)
- [Comparison: vs Firebase](../compare/firebase.md)
