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

| Variable       | Required | Default     | Description                        |
| -------------- | -------- | ----------- | ---------------------------------- |
| `DATABASE_URL` | Yes      | -           | Postgres connection string         |
| `REDIS_URL`    | No       | -           | Redis URL for multi-server pub/sub |
| `PORT`         | No       | 4000        | HTTP/WebSocket server port         |
| `JWT_SECRET`   | No       | -           | Secret for JWT HS256 verification  |
| `NODE_ENV`     | No       | development | Set to `production` for production |

## Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Configure `DATABASE_URL` with SSL (`?sslmode=require`)
- [ ] Set `JWT_SECRET` or configure auth provider
- [ ] Enable HTTPS (handled by platform load balancer)
- [ ] Set up database backups
- [ ] Configure monitoring (Prometheus scrape from `/metrics`)
- [ ] Set resource limits (CPU, memory)
- [ ] Enable health checks
- [ ] Configure graceful shutdown (see below)

## Graceful Shutdown

ReactiveBase handles `SIGTERM` and `SIGINT` signals automatically:

1. Stops accepting new connections
2. Closes the HTTP server (drains in-flight requests)
3. Stops CDC buffering (if using logical replication)
4. Closes WebSocket transport and active subscriptions
5. Releases the database connection pool

### Docker

The default Docker image uses `node` as PID 1, which correctly receives
`SIGTERM` from `docker stop`. The default stop timeout is 10 seconds.

```bash
# Give the container time to drain connections (30s)
docker stop --time 30 my-container
```

To increase the default stop timeout in `docker-compose.yml`:

```yaml
services:
  reactivebase:
    # ...
    stop_grace_period: 30s
```

### Kubernetes

The Helm chart configures graceful shutdown out of the box. For manual
deployments, add these settings to your Pod spec:

```yaml
spec:
  terminationGracePeriodSeconds: 30
  containers:
    - name: reactivebase
      lifecycle:
        preStop:
          exec:
            # Brief pause to allow load balancer to deregister the pod
            command: ["sh", "-c", "sleep 5"]
      livenessProbe:
        httpGet:
          path: /api/v1/health
          port: 4000
        initialDelaySeconds: 10
        periodSeconds: 15
      readinessProbe:
        httpGet:
          path: /api/v1/health
          port: 4000
        initialDelaySeconds: 5
        periodSeconds: 5
```

**How it works during a rolling update:**

1. Kubernetes sends `SIGTERM` to the pod
2. The `preStop` hook sleeps 5 seconds, allowing the Service to remove the pod
   from its endpoints (prevents new traffic during shutdown)
3. ReactiveBase begins graceful shutdown — drains connections and releases resources
4. After `terminationGracePeriodSeconds` (30s), Kubernetes sends `SIGKILL` if
   the process is still running

### Health Check Endpoint

The `/api/v1/health` path returns server health information, suitable for
both liveness and readiness probes:

```json
{
  "status": "healthy",
  "version": "0.1.0",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "transports": {
    "rest": "/api/v1/*",
    "graphql": "/graphql",
    "websocket": "/ws"
  }
}
```

## Platform-Specific Guides

| Guide                                | Description                                      |
| ------------------------------------ | ------------------------------------------------ |
| [Kubernetes](./kubernetes/README.md) | Helm chart configuration and Kubernetes operator |
| [Grafana](./grafana/README.md)       | Monitoring dashboards and alerting               |
| [Terraform](./terraform/README.md)   | Infrastructure as code modules                   |
