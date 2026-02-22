# SaaS Analytics Dashboard — ReactiveBase Example

A multi-tenant analytics dashboard with real-time charts.

## Features

- 📊 **Live metrics** — charts update in real-time as events stream in
- 🏢 **Multi-tenant** — each tenant sees only their data
- 📈 **Time-series** — hourly/daily/weekly aggregations via IVM
- 🔔 **Alerts** — threshold-based alerts on any metric
- 💳 **Billing** — usage tracking per tenant with plan enforcement

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

## Schema

- `tenants` — Organizations with plans
- `events` — Raw analytics events (page views, clicks, conversions)
- `metrics` — Pre-computed aggregations (via IVM)
- `alerts` — Threshold alerts per tenant
