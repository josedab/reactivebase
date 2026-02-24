import { describe, it, expect, beforeEach } from "vitest"
import {
  defineDataSource,
  mergeQueryResults,
  FederationChangeRelay,
  ReplicaRouter,
  type DataSourceConfig,
  type ChangeNotification,
  type FederatedQueryResult,
} from "../multi-db/federation.js"
import { FederationError } from "../multi-db/multi-db.js"

describe("defineDataSource", () => {
  it("creates a federated data source configuration", () => {
    const result = defineDataSource({
      primary: { connectionString: "postgres://localhost/main", default: true },
      analytics: { connectionString: "postgres://localhost/analytics", role: "read-replica" },
    })
    expect(result.federation).toBeDefined()
    expect(result.dataSources.size).toBe(2)
    expect(result.replicaRouter).toBeDefined()
  })

  it("throws on empty schema", () => {
    expect(() => defineDataSource({})).toThrow("At least one data source")
  })

  it("marks read replicas as readOnly automatically", () => {
    const result = defineDataSource({
      primary: { connectionString: "postgres://localhost/main", default: true },
      replica: { connectionString: "postgres://localhost/replica", role: "read-replica" },
    })
    expect(result.federation.isReadOnly("replica")).toBe(true)
  })

  it("marks analytics sources as readOnly automatically", () => {
    const result = defineDataSource({
      primary: { connectionString: "postgres://localhost/main", default: true },
      analytics: { connectionString: "postgres://localhost/analytics", role: "analytics" },
    })
    expect(result.federation.isReadOnly("analytics")).toBe(true)
  })
})

describe("mergeQueryResults", () => {
  it("merges results from multiple sources", () => {
    const results: FederatedQueryResult<Array<{ id: string; name: string }>>[] = [
      { data: [{ id: "1", name: "Alice" }], database: "primary", durationMs: 10 },
      { data: [{ id: "2", name: "Bob" }], database: "replica", durationMs: 5 },
    ]
    const merged = mergeQueryResults(results)
    expect(merged.merged).toHaveLength(2)
    expect(merged.totalDurationMs).toBe(15)
  })

  it("deduplicates by id with source priority", () => {
    const results: FederatedQueryResult<Array<{ id: string; name: string }>>[] = [
      { data: [{ id: "1", name: "Alice-primary" }], database: "primary", durationMs: 10 },
      { data: [{ id: "1", name: "Alice-replica" }], database: "replica", durationMs: 5 },
    ]
    const merged = mergeQueryResults(results, { sourcePriority: ["primary", "replica"] })
    expect(merged.merged).toHaveLength(1)
    expect(merged.merged[0].name).toBe("Alice-primary")
  })

  it("includes items without dedup key", () => {
    const results: FederatedQueryResult<Array<{ name: string }>>[] = [
      { data: [{ name: "Alice" }, { name: "Bob" }], database: "primary", durationMs: 10 },
    ]
    const merged = mergeQueryResults(results, { deduplicateBy: "id" })
    expect(merged.merged).toHaveLength(2)
  })

  it("uses custom dedup key", () => {
    const results: FederatedQueryResult<Array<{ email: string; name: string }>>[] = [
      { data: [{ email: "a@test.com", name: "A1" }], database: "primary", durationMs: 10 },
      { data: [{ email: "a@test.com", name: "A2" }], database: "replica", durationMs: 5 },
    ]
    const merged = mergeQueryResults(results, { deduplicateBy: "email" })
    expect(merged.merged).toHaveLength(1)
  })
})

describe("FederationChangeRelay", () => {
  let relay: FederationChangeRelay

  beforeEach(() => {
    relay = new FederationChangeRelay()
  })

  it("emits to source-specific handlers", async () => {
    const received: ChangeNotification[] = []
    relay.onSourceChange("primary", (n) => {
      received.push(n)
    })

    await relay.emit({
      source: "primary",
      table: "tasks",
      operation: "insert",
      timestamp: Date.now(),
    })
    expect(received).toHaveLength(1)
    expect(received[0].table).toBe("tasks")
  })

  it("does not emit to wrong source handler", async () => {
    const received: ChangeNotification[] = []
    relay.onSourceChange("primary", (n) => {
      received.push(n)
    })

    await relay.emit({
      source: "replica",
      table: "tasks",
      operation: "insert",
      timestamp: Date.now(),
    })
    expect(received).toHaveLength(0)
  })

  it("emits to global handlers", async () => {
    const received: ChangeNotification[] = []
    relay.onAnyChange((n) => {
      received.push(n)
    })

    await relay.emit({ source: "primary", table: "tasks", operation: "insert", timestamp: Date.now() })
    await relay.emit({ source: "replica", table: "users", operation: "update", timestamp: Date.now() })
    expect(received).toHaveLength(2)
  })

  it("supports unsubscribe", async () => {
    const received: ChangeNotification[] = []
    const unsub = relay.onSourceChange("primary", (n) => {
      received.push(n)
    })

    await relay.emit({ source: "primary", table: "tasks", operation: "insert", timestamp: Date.now() })
    unsub()
    await relay.emit({ source: "primary", table: "tasks", operation: "insert", timestamp: Date.now() })
    expect(received).toHaveLength(1)
  })

  it("clears all handlers", async () => {
    relay.onAnyChange(() => {})
    relay.onSourceChange("primary", () => {})
    relay.clear()
    // Should not throw
    await relay.emit({ source: "primary", table: "tasks", operation: "insert", timestamp: Date.now() })
  })
})

describe("ReplicaRouter", () => {
  it("routes reads to primary when no replicas", () => {
    const ds = new Map<string, DataSourceConfig>([
      ["primary", { connectionString: "pg://main", default: true, role: "primary" }],
    ])
    const router = new ReplicaRouter(ds)
    expect(router.routeRead()).toBe("primary")
  })

  it("routes writes to primary", () => {
    const ds = new Map<string, DataSourceConfig>([
      ["primary", { connectionString: "pg://main", default: true, role: "primary" }],
      ["replica", { connectionString: "pg://replica", role: "read-replica" }],
    ])
    const router = new ReplicaRouter(ds)
    expect(router.routeWrite()).toBe("primary")
  })

  it("routes to replica when primary subscription count exceeds threshold", () => {
    const ds = new Map<string, DataSourceConfig>([
      ["primary", { connectionString: "pg://main", default: true, role: "primary", subscriptionThreshold: 10 }],
      ["replica1", { connectionString: "pg://replica1", role: "read-replica" }],
    ])
    const router = new ReplicaRouter(ds)

    router.updateSubscriptionCount("primary", 15)
    expect(router.routeRead()).toBe("replica1")
  })

  it("routes to least-loaded replica", () => {
    const ds = new Map<string, DataSourceConfig>([
      ["primary", { connectionString: "pg://main", default: true, role: "primary", subscriptionThreshold: 10 }],
      ["replica1", { connectionString: "pg://replica1", role: "read-replica" }],
      ["replica2", { connectionString: "pg://replica2", role: "read-replica" }],
    ])
    const router = new ReplicaRouter(ds)

    router.updateSubscriptionCount("primary", 15)
    router.updateSubscriptionCount("replica1", 50)
    router.updateSubscriptionCount("replica2", 10)

    expect(router.routeRead()).toBe("replica2")
  })

  it("increments and decrements subscription counts", () => {
    const ds = new Map<string, DataSourceConfig>([
      ["primary", { connectionString: "pg://main", default: true, role: "primary" }],
    ])
    const router = new ReplicaRouter(ds)

    router.incrementSubscriptions("primary")
    router.incrementSubscriptions("primary")
    router.decrementSubscriptions("primary")

    const stats = router.getStats()
    expect(stats.primary.subscriptions).toBe(1)
  })

  it("does not decrement below zero", () => {
    const ds = new Map<string, DataSourceConfig>([
      ["primary", { connectionString: "pg://main", default: true, role: "primary" }],
    ])
    const router = new ReplicaRouter(ds)
    router.decrementSubscriptions("primary")
    expect(router.getStats().primary.subscriptions).toBe(0)
  })
})
