# ReactiveBase Grafana Dashboards

Pre-built Grafana dashboards for monitoring ReactiveBase in production.

## Quick Import

### Option 1: Grafana UI Import

1. Open Grafana → Dashboards → Import
2. Upload `reactivebase-server-dashboard.json`
3. Select your Prometheus data source
4. Click Import

Repeat for `reactivebase-clients-dashboard.json`.

### Option 2: Provisioning (Recommended for Production)

```bash
# Copy dashboards to Grafana's dashboard directory
cp deploy/grafana/*.json /var/lib/grafana/dashboards/reactivebase/

# Copy provisioning config
cp deploy/grafana/provisioning.yaml /etc/grafana/provisioning/dashboards/reactivebase.yaml

# Restart Grafana
systemctl restart grafana-server
```

### Option 3: Docker Compose

```yaml
services:
  grafana:
    image: grafana/grafana:11
    volumes:
      - ./deploy/grafana/provisioning.yaml:/etc/grafana/provisioning/dashboards/reactivebase.yaml
      - ./deploy/grafana:/var/lib/grafana/dashboards/reactivebase
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    ports:
      - "3000:3000"
```

## Dashboards

### Server Observability (`reactivebase-server-dashboard.json`)

| Section | Panels |
|---------|--------|
| **Overview** | Request Rate, Query Latency (p50/p95/p99), Error Rate |
| **Stats** | Active Subscriptions, WebSocket Connections, Uptime, Pending Jobs, Memory, CPU |
| **Reactivity** | Invalidation Rate, Subscription Fanout |
| **Database** | Connection Pool (active/idle/waiting), Transaction Performance |
| **Scheduler** | Job Queue, Job Duration |
| **Slow Queries** | Top 10 Slowest Queries table |

### Client Connections (`reactivebase-clients-dashboard.json`)

| Section | Panels |
|---------|--------|
| **Connections** | WebSocket state, Messages/s |
| **Subscriptions** | Lifecycle, Subscriptions per Connection |
| **Performance** | Update Push Latency, Bandwidth |

## Prerequisites

- Prometheus scraping ReactiveBase's `/metrics` endpoint
- Add this to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: "reactivebase"
    scrape_interval: 15s
    static_configs:
      - targets: ["reactivebase:4000"]
```

## Metrics Reference

| Metric | Type | Description |
|--------|------|-------------|
| `reactivebase_queries_total` | Counter | Total query executions |
| `reactivebase_mutations_total` | Counter | Total mutation executions |
| `reactivebase_errors_total` | Counter | Total errors |
| `reactivebase_query_duration_seconds` | Histogram | Query execution time |
| `reactivebase_subscriptions_active` | Gauge | Current active subscriptions |
| `reactivebase_connections_active` | Gauge | Current WebSocket connections |
| `reactivebase_invalidations_total` | Counter | Total subscription invalidations |
| `reactivebase_pg_pool_active` | Gauge | Active database connections |
| `reactivebase_scheduler_pending_jobs` | Gauge | Pending scheduled jobs |
