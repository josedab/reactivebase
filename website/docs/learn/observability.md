---
sidebar_position: 4
---

# Observability

*Estimated time: 10 minutes*

ReactiveBase includes built-in observability: Prometheus metrics, OpenTelemetry tracing, performance profiling, and Grafana dashboard exports.

## Metrics Endpoint

Every ReactiveBase server exposes `/metrics` in Prometheus exposition format:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: "reactivebase"
    scrape_interval: 15s
    static_configs:
      - targets: ["localhost:4000"]
```

## Grafana Dashboards

Import the pre-built dashboards from `deploy/grafana/`:

| Dashboard | Panels | File |
|-----------|--------|------|
| **Server Observability** | Request rate, query latency (p50/p95/p99), error rate, subscriptions, connections, DB pool, job queue, slow queries | `reactivebase-server-dashboard.json` |
| **Client Connections** | WebSocket states, messages/s, subscription lifecycle, bandwidth | `reactivebase-clients-dashboard.json` |

## Performance Profiler

The `PerformanceProfiler` detects issues automatically:

```typescript
import { PerformanceProfiler } from "@reactivebase/server"

const profiler = new PerformanceProfiler({ slowQueryThresholdMs: 100 })

// Record query executions
profiler.recordQueryExecution("tasks.list", durationMs, ["tasks"])

// Get alerts
const alerts = profiler.getAlerts()
// → [{ type: "slow-query", message: "tasks.list took 250ms" }]
// → [{ type: "n-plus-one", message: "users.get called 15 times in 60s" }]

// Export Grafana dashboard
const json = profiler.exportGrafanaDashboardJSON()
```

## Stress Testing

Validate production readiness with the built-in stress test suite:

```typescript
import { StressTestSuite } from "@reactivebase/server"

const suite = new StressTestSuite({
  subscriptionLevels: [1000, 5000, 10000],
  enableChaos: true,
})

const report = await suite.run()
console.log(suite.formatReport(report))
```

## Next Steps

→ [Performance](./performance.md) — Scaling with subscription sharding and edge caching
