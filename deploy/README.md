# ReactiveBase Deployment Guide

## Quick Start with Docker Compose

```bash
# Start Postgres + Redis + ReactiveBase
docker compose -f deploy/docker-compose.yml up -d

# Check health
curl http://localhost:4000/

# View metrics
curl http://localhost:4000/metrics

# View schema dashboard
open http://localhost:4000/dashboard
```

## Platform-Specific Deployment

### Fly.io

```bash
# Install Fly CLI: https://fly.io/docs/hands-on/install-flyctl/

# Launch app
fly launch --config deploy/fly.toml

# Create Postgres database
fly postgres create --name my-reactivebase-db
fly postgres attach my-reactivebase-db

# Set secrets
fly secrets set JWT_SECRET=your-secret-here

# Deploy
fly deploy
```

### Railway

```bash
# Install Railway CLI: https://docs.railway.app/develop/cli

# Initialize project
railway init

# Add Postgres plugin from Railway dashboard
# Set DATABASE_URL automatically

# Deploy
railway up
```

### Render

```bash
# Push to GitHub, then:
# 1. Connect your repo in the Render dashboard
# 2. Render auto-detects deploy/render.yaml
# 3. Database is provisioned automatically
```

### Manual Docker

```bash
# Build the image
docker build -f deploy/Dockerfile -t reactivebase .

# Run with external Postgres
docker run -d \
  -e DATABASE_URL=postgresql://user:pass@host:5432/db \
  -e PORT=4000 \
  -p 4000:4000 \
  reactivebase
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | Postgres connection string |
| `REDIS_URL` | No | - | Redis URL for multi-server pub/sub |
| `PORT` | No | 4000 | HTTP/WebSocket server port |
| `JWT_SECRET` | No | - | Secret for JWT HS256 verification |
| `NODE_ENV` | No | development | Set to `production` for production |

## Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Configure `DATABASE_URL` with SSL (`?sslmode=require`)
- [ ] Set `JWT_SECRET` or configure auth provider
- [ ] Enable HTTPS (handled by platform load balancer)
- [ ] Set up database backups
- [ ] Configure monitoring (Prometheus scrape from `/metrics`)
- [ ] Set resource limits (CPU, memory)
- [ ] Enable health checks
