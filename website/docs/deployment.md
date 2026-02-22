---
sidebar_position: 4
---

# Deployment

## Docker Compose (Recommended for local/staging)

```bash
docker compose -f deploy/docker-compose.yml up -d
```

This starts:
- **Postgres 16** with pgvector extension
- **Redis 7** for multi-server pub/sub
- **ReactiveBase server** on port 4000

## Cloud Platforms

| Platform | Config File | One-liner |
|----------|-------------|-----------|
| **Fly.io** | `deploy/fly.toml` | `fly launch --config deploy/fly.toml` |
| **Railway** | `deploy/railway.json` | `railway up` |
| **Render** | `deploy/render.yaml` | Connect GitHub repo |
| **Docker** | `deploy/Dockerfile` | `docker build -f deploy/Dockerfile .` |

See [deploy/README.md](https://github.com/reactivebase/reactivebase/tree/main/deploy) for detailed instructions.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `REDIS_URL` | No | Redis for multi-server |
| `PORT` | No | Server port (default: 4000) |
| `JWT_SECRET` | No | JWT HS256 secret |

## Endpoints

| Path | Description |
|------|-------------|
| `/` | Health check |
| `/ws` | WebSocket subscriptions |
| `/query` | HTTP query execution (SSR) |
| `/metrics` | Prometheus / JSON metrics |
| `/dashboard` | Visual schema viewer |
| `/api/*` | Auto-generated REST API |
