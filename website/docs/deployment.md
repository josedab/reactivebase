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
| `/api/v1/health` | Health check |
| `/ws` | WebSocket subscriptions |
| `/query` | HTTP query execution (SSR) |
| `/metrics` | Prometheus / JSON metrics |
| `/dashboard` | Visual schema viewer |
| `/api/*` | Auto-generated REST API |

## Fly.io (Step-by-Step)

### Prerequisites

- Fly CLI installed: `curl -L https://fly.io/install.sh | sh`
- Fly account: `fly auth signup`

### Steps

1. **Create a Fly app:**
   ```bash
   cd your-reactivebase-project
   fly launch --no-deploy
   ```
   When prompted, choose the `iad` (Ashburn, Virginia) region or your preferred region. The included `deploy/fly.toml` defaults to `iad`.

2. **Create Postgres database:**
   ```bash
   fly postgres create --name my-reactivebase-db --region iad
   fly postgres attach my-reactivebase-db
   ```
   This automatically sets `DATABASE_URL` as a secret on your app.

3. **Create Redis (for pub/sub):**
   ```bash
   fly redis create --name my-reactivebase-redis --region iad
   ```
   Note the Redis URL from the output — you'll need it in the next step.

4. **Set secrets:**
   ```bash
   fly secrets set JWT_SECRET=$(openssl rand -hex 32)
   fly secrets set REDIS_URL=redis://...  # Use URL from step 3
   ```

5. **Copy the fly.toml:**
   ```bash
   cp deploy/fly.toml .
   ```
   Edit the `app` name in `fly.toml` to match the app name from `fly launch`. The config uses `deploy/Dockerfile` as the build target, exposes port 4000 with HTTPS enforcement, and sets connection concurrency limits (soft: 800, hard: 1000).

6. **Deploy:**
   ```bash
   fly deploy
   ```

7. **Verify:**
   ```bash
   fly status
   curl https://my-reactivebase-app.fly.dev/api/v1/health
   ```

### Scaling

```bash
fly scale count 2 --region iad,cdg  # Multi-region (Virginia + Paris)
fly scale vm shared-cpu-2x          # Upgrade VM size
```

The `fly.toml` has `auto_stop_machines = true` and `auto_start_machines = true` with `min_machines_running = 1`, so idle machines scale to zero while keeping at least one warm.

---

## Railway (Step-by-Step)

### Steps

1. **Create a new project:**
   ```bash
   npx @railway/cli login
   npx @railway/cli init
   ```

2. **Add Postgres:**
   - Go to Railway dashboard → **New** → **Database** → **PostgreSQL**
   - Railway automatically sets `DATABASE_URL` for your service

3. **Add Redis (optional, for scaling):**
   - Dashboard → **New** → **Database** → **Redis**
   - Railway automatically sets `REDIS_URL` for your service

4. **Set environment variables:**
   ```bash
   npx @railway/cli variables set JWT_SECRET=$(openssl rand -hex 32)
   ```

5. **Deploy:**
   ```bash
   npx @railway/cli up
   ```
   Railway uses `deploy/railway.json` which builds with the Dockerfile at `deploy/Dockerfile`. It configures a health check on `/` with a 5-second timeout, and the restart policy retries up to 10 times on failure.

6. **Verify:**
   ```bash
   npx @railway/cli logs
   curl https://your-app.up.railway.app/api/v1/health
   ```

### Notes

- The `railway.json` sets `numReplicas: 1` by default. Increase this in the Railway dashboard for horizontal scaling.
- Railway detects the Dockerfile automatically if you place `railway.json` in your project root.

---

## Kubernetes

### Using Helm

1. **Add the Helm chart:**
   ```bash
   helm repo add reactivebase https://charts.reactivebase.dev
   helm repo update
   ```

2. **Create a values file (`values.yaml`):**
   ```yaml
   replicaCount: 2

   image:
     repository: your-registry/reactivebase
     tag: latest

   env:
     DATABASE_URL: postgresql://user:pass@postgres:5432/mydb
     REDIS_URL: redis://redis:6379
     JWT_SECRET: your-secret-here
     PORT: "4000"
     NODE_ENV: production

   resources:
     requests:
       cpu: 250m
       memory: 512Mi
     limits:
       cpu: 1000m
       memory: 1Gi

   ingress:
     enabled: true
     hosts:
       - host: api.example.com
         paths:
           - path: /
             pathType: Prefix

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
     periodSeconds: 10
   ```

3. **Install:**
   ```bash
   helm install my-app reactivebase/reactivebase -f values.yaml
   ```

4. **Verify:**
   ```bash
   kubectl get pods -l app=reactivebase
   kubectl logs -l app=reactivebase --tail=50
   ```

### Manual Deployment (without Helm)

Build and push the Docker image, then create a Deployment:

```bash
docker build -f deploy/Dockerfile -t your-registry/reactivebase:latest .
docker push your-registry/reactivebase:latest
```

The Dockerfile uses a multi-stage build (node:20-slim), exposes port 4000, and includes a built-in health check. It handles `SIGTERM` for graceful shutdown in Kubernetes.

---

## Monitoring

### Health Check Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/health` | Liveness check (200 if server is running) |
| `GET /metrics` | Prometheus / JSON metrics (requires `DASHBOARD_TOKEN`) |
| `GET /dashboard` | Visual schema viewer and admin dashboard (requires `DASHBOARD_TOKEN`) |
| `GET /ws` | WebSocket upgrade endpoint for real-time subscriptions |
| `GET /query` | HTTP query execution (SSR) |
| `GET /api/*` | Auto-generated REST API |

### Grafana Dashboard

Import the included dashboard from `deploy/grafana-dashboard.json`:

```yaml
# Prometheus scrape config
- job_name: reactivebase
  static_configs:
    - targets: ['localhost:4000']
  metrics_path: /metrics
  bearer_token: YOUR_DASHBOARD_TOKEN
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/db`) |
| `REDIS_URL` | No | — | Redis URL for pub/sub (needed for multi-instance scaling) |
| `JWT_SECRET` | Production | — | Secret key for JWT HS256 verification |
| `PORT` | No | `4000` | HTTP server port |
| `NODE_ENV` | No | `production` | Node environment (`production` / `development`) |
| `DASHBOARD_TOKEN` | No | — | Token to access `/dashboard` and `/metrics` endpoints |
| `CORS_ORIGIN` | No | `*` (dev) | Allowed CORS origins |
| `LOG_LEVEL` | No | `info` | Logging level (`debug` / `info` / `warn` / `error`) |

---

## Platform-Specific Guides

For advanced deployment scenarios, see the dedicated guides:

| Guide | Description |
|-------|-------------|
| [Kubernetes (Helm & Operator)](https://github.com/reactivebase/reactivebase/tree/main/deploy/kubernetes/README.md) | Helm chart configuration and Kubernetes operator |
| [Grafana Monitoring](https://github.com/reactivebase/reactivebase/tree/main/deploy/grafana/README.md) | Monitoring dashboards and alerting |
| [Terraform](https://github.com/reactivebase/reactivebase/tree/main/deploy/terraform/README.md) | Infrastructure as code modules |
