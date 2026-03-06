# ADR-008: Subscription Sharding Approach

## Status

Accepted

## Context

As the number of active subscriptions grows, a single ReactiveBase server instance becomes a bottleneck for invalidation evaluation. With 100K+ active subscriptions, iterating through all subscriptions for every mutation is not viable. Additionally, multi-server deployments need to route invalidation events to the correct server instance.

## Decision

We implement subscription sharding in `packages/server/src/reactivity/`:

- **Table-based sharding** — subscriptions are grouped by their dependency tables. When a mutation affects table X, only subscriptions in the shard for table X are evaluated, not the entire subscription set.
- **Consistent hashing** — in multi-server deployments, subscriptions are assigned to server instances using consistent hashing on the subscription key (`queryName:argsHash`). The pub/sub layer (Redis or in-memory) routes invalidation events to the owning server.
- **Shard rebalancing** — when servers join or leave the cluster, subscriptions are rebalanced using virtual nodes to minimize migration. Affected subscriptions are re-established on the new owning server.
- **Fanout limits** — a configurable `maxFanout` per mutation caps the number of subscriptions evaluated per change event, preventing pathological cases from blocking the event loop.

## Consequences

### Positive

- Table-based sharding reduces invalidation evaluation from O(all subscriptions) to O(subscriptions on affected table)
- Consistent hashing enables horizontal scaling — each server only evaluates its owned subscriptions
- Virtual nodes provide smooth rebalancing with minimal subscription migration during scaling events

### Negative

- Cross-table queries (joins) must register dependencies on all involved tables, increasing shard fanout
- Consistent hashing adds complexity to the subscription lifecycle (assign, migrate, destroy)
- Network partitions can cause temporary over-invalidation until the cluster stabilizes
