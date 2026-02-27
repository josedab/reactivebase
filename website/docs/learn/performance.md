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

## Change Data Capture (CDC)

ReactiveBase uses Change Data Capture to detect database mutations and invalidate reactive subscriptions. Configure CDC mode via `defineConfig()`:

```typescript
import { defineConfig } from "@reactivebase/server"

export default defineConfig({
  database: { connectionString: process.env.DATABASE_URL! },
  cdc: {
    mode: "listen-notify",    // or "logical-replication"
    tables: ["tasks", "users"], // Default: all schema tables
    batchSize: 100,            // WAL event batch size (default: 100)
    flushIntervalMs: 10,       // Batch flush interval in ms (default: 10)
  },
})
```

### CDC Modes

| Mode | How It Works | Pros | Cons |
|------|-------------|------|------|
| `listen-notify` (default) | Uses Postgres `LISTEN`/`NOTIFY` channels. Triggers fire `pg_notify()` on row changes. | Zero setup — works with any Postgres. Low overhead for moderate write volumes. | Notification payload limited to 8KB. Missed if no listener is connected. |
| `logical-replication` | Streams the Postgres Write-Ahead Log (WAL) via a replication slot. | Complete change history — no missed events. Full row data. Efficient for high write throughput. | Requires Postgres config changes. Replication slots consume disk if consumer falls behind. |

### Postgres Prerequisites for Logical Replication

If you choose `logical-replication` mode, configure Postgres:

1. **Set WAL level** in `postgresql.conf`:

   ```ini
   wal_level = logical
   max_replication_slots = 4   # At least 1 per ReactiveBase instance
   max_wal_senders = 4
   ```

2. **Restart Postgres** for the changes to take effect.

3. **Grant replication privileges** to the database user:

   ```sql
   ALTER ROLE myuser REPLICATION;
   ```

4. **Verify** the configuration:

   ```sql
   SHOW wal_level;  -- Should return "logical"
   ```

### When to Use Each Mode

- **`listen-notify`**: Development, staging, low-to-medium write volumes (< 1K writes/sec). No Postgres configuration required.
- **`logical-replication`**: Production with high write volumes, multi-server deployments where every instance must see every change, or when you need guaranteed delivery of change events.

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mode` | `"listen-notify"` \| `"logical-replication"` | `"listen-notify"` | CDC strategy |
| `tables` | `string[]` | All schema tables | Tables to track for changes |
| `batchSize` | `number` | `100` | Number of WAL events to process per batch (logical-replication only) |
| `flushIntervalMs` | `number` | `10` | Maximum time in ms to buffer events before flushing (logical-replication only) |

## Kubernetes Scaling

Deploy with auto-scaling based on subscription count:

```bash
helm install my-app ./deploy/kubernetes/helm/reactivebase \
  --set autoscaling.enabled=true \
  --set autoscaling.maxReplicas=10
```

## Next Steps

→ [Compliance](./compliance-guide.md) — PII detection, GDPR, SOC 2
