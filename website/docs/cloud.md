---
sidebar_position: 6
---

# ReactiveBase Cloud

Deploy reactive backends in seconds. No infrastructure to manage.

## Pricing

| Feature | Free | Pro ($29/mo) | Team ($99/mo) | Enterprise |
|---------|------|-------------|---------------|------------|
| Projects | 1 | 5 | 20 | Unlimited |
| Active subscriptions | 1,000 | 50,000 | 500,000 | Custom |
| Database storage | 1 GB | 10 GB | 100 GB | Custom |
| Bandwidth | 5 GB | 100 GB | 1 TB | Custom |
| Custom domains | ❌ | ✅ | ✅ | ✅ |
| Dashboard access | ✅ | ✅ | ✅ | ✅ |
| Prometheus metrics | ❌ | ✅ | ✅ | ✅ |
| Priority support | ❌ | ❌ | ✅ | ✅ |
| SLA | ❌ | 99.9% | 99.95% | 99.99% |

## Quick Deploy

```bash
# Login to ReactiveBase Cloud
npx reactivebase login

# Deploy your project
npx reactivebase deploy --cloud
```

## How It Works

1. **You write code** — schema, queries, mutations, actions
2. **We run it** — managed Postgres + ReactiveBase server
3. **You connect** — WebSocket URL for your client app

```
Your React/Vue/Svelte app
         │
         │ WebSocket (wss://your-app.reactivebase.dev/ws)
         ▼
ReactiveBase Cloud
    ├── Your functions (queries, mutations, actions)
    ├── Managed PostgreSQL (with pgvector)
    ├── Redis (for multi-server pub/sub)
    └── Automatic scaling + monitoring
```

## Regions

| Region | Location |
|--------|----------|
| `us-east-1` | Virginia, USA |
| `eu-west-1` | Ireland, EU |
| `ap-southeast-1` | Singapore, APAC |

## Self-Hosted Alternative

ReactiveBase is MIT-licensed. You can always self-host:

- **Docker Compose** — [deploy/docker-compose.yml](/docs/deployment)
- **Fly.io** — `fly launch --config deploy/fly.toml`
- **Railway** — `railway up`
- **Any Docker host** — `docker build -f deploy/Dockerfile .`

The cloud offering is for teams who want zero-ops convenience.
