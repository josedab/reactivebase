# ADR-005: CDC Strategy — LISTEN/NOTIFY vs Logical Replication

## Status

Accepted

## Context

ReactiveBase needs to detect data changes in PostgreSQL to trigger reactive subscription invalidation. Two primary mechanisms are available:

1. **LISTEN/NOTIFY** — Application-level triggers fire `pg_notify()` on INSERT/UPDATE/DELETE. The server receives change events on a persistent connection.
2. **Logical replication** — PostgreSQL's built-in WAL-based change data capture streams row-level changes via replication slots, providing a reliable, ordered change stream.

Each has significant trade-offs in complexity, reliability, and deployment requirements.

## Decision

We support **both strategies** with LISTEN/NOTIFY as the default and logical replication as an opt-in upgrade for high-throughput deployments.

- **LISTEN/NOTIFY** (`cdc.mode: "listen-notify"`) is the default. It works on all PostgreSQL hosting providers (including those that disallow replication slots), requires no special configuration, and is simple to reason about.
- **Logical replication** (`cdc.mode: "logical-replication"`) is available for production workloads where ordering guarantees, WAL-based durability, and higher throughput are required. It requires `wal_level = logical` and a replication slot.

The CDC module (`packages/server/src/cdc/`) abstracts both behind a unified `ChangeEvent` interface, so the reactivity engine and subscription invalidation logic are strategy-agnostic.

## Consequences

### Positive

- Zero-config default — LISTEN/NOTIFY works on every Postgres deployment out of the box
- Logical replication provides WAL-level durability and strict ordering for production
- Unified ChangeEvent interface keeps the reactivity engine decoupled from the CDC strategy

### Negative

- LISTEN/NOTIFY events can be lost if the listening connection drops or the notification queue overflows (8 GB limit)
- Logical replication requires server-level configuration (`wal_level = logical`) and consumes a replication slot
- Supporting two strategies increases testing surface
