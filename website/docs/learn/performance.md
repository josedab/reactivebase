---
sidebar_position: 5
---

# Performance & Scaling

*Estimated time: 10 minutes*

ReactiveBase scales from a single server to a distributed cluster. This guide covers the scaling primitives.

## Subscription Sharding

For 10K+ concurrent subscriptions, distribute across multiple nodes:

```typescript
import { SubscriptionShardManager } from "@reactivebase/server"

const shardManager = new SubscriptionShardManager({
  nodeId: "server-1",
  totalShards: 256,  // Power of 2
})

// Add cluster nodes
shardManager.addNode("server-2", "10.0.0.2", 4000)
shardManager.addNode("server-3", "10.0.0.3", 4000)

// Check if this node owns a subscription
if (shardManager.isLocal(subscriptionKey)) {
  // Handle locally
} else {
  // Route to owning node
}

// Automatic rebalancing on node add/remove
await shardManager.executeMigrations()
```

## Edge Prefetch Cache

Serve query results from CDN edge in <10ms:

```typescript
import { EdgePrefetchCache } from "@reactivebase/server"

const cache = new EdgePrefetchCache({ ttlMs: 30000, maxEntries: 10000 })

// Cache results with table dependency tracking
cache.set("tasks.list", args, results, ["tasks"])

// Auto-invalidate when mutations occur
cache.handleMutation(["tasks"])  // Removes all entries depending on "tasks"
```

## Incremental View Maintenance (IVM)

For complex aggregation queries, IVM computes deltas instead of re-executing:

```typescript
import { IncrementalViewMaintainer } from "@reactivebase/server"

const ivm = new IncrementalViewMaintainer()
ivm.register({ viewId: "task-stats", queryAst: scanNode, ... })

// On mutation: compute delta (O(1)) instead of full query (O(n))
const deltas = ivm.applyChange({ table: "tasks", operation: "insert", row: newRow })
```

## Real-Time Analytics

Pre-aggregate metrics with reactive subscriptions:

```typescript
import { AnalyticsEngine } from "@reactivebase/server"

const analytics = new AnalyticsEngine()
analytics.defineMetric({ name: "daily_signups", table: "users", aggregation: "count", timeBucket: "day" })

// Incremental updates on every mutation
analytics.applyChange({ table: "users", operation: "insert" })

// Subscribe to live updates
analytics.subscribe("daily_signups", (result) => {
  updateDashboard(result.value)
})
```

## Kubernetes Scaling

Deploy with auto-scaling based on subscription count:

```bash
helm install my-app ./deploy/kubernetes/helm/reactivebase \
  --set autoscaling.enabled=true \
  --set autoscaling.maxReplicas=10
```

## Next Steps

→ [Compliance](./compliance-guide.md) — PII detection, GDPR, SOC 2
