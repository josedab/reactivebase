# SaaS Analytics Dashboard — ReactiveBase Example

A multi-tenant analytics dashboard with real-time charts.

## Features

- 📊 **Live metrics** — charts update in real-time as events stream in
- 🏢 **Multi-tenant** — each tenant sees only their data
- 📈 **Time-series** — hourly/daily/weekly aggregations via IVM
- 🔔 **Alerts** — threshold-based alerts on any metric
- 💳 **Billing** — usage tracking per tenant with plan enforcement

## Prerequisites

- Node.js ≥ 20 (see `.nvmrc`)
- PostgreSQL 14+

## Quick Start

```bash
# Set your Postgres connection string
cp .env.example .env   # Edit DATABASE_URL in .env

# Install dependencies and start
npm install
npm run dev
```

## Project Structure

```
saas-dashboard/
├── convex/
│   └── ...            # Schema, queries, mutations
├── .env.example       # Environment variable template
├── package.json
└── tsconfig.json
```

## Schema

- `tenants` — Organizations with plans
- `events` — Raw analytics events (page views, clicks, conversions)
- `metrics` — Pre-computed aggregations (via IVM)
- `alerts` — Threshold alerts per tenant
