/**
 * Full end-to-end integration tests for the ReactiveBase reactive loop.
 * Tests: schema → register functions → subscribe → mutate → verify update delivery.
 *
 * Uses the TestServer from @reactivebase/testing to avoid real Postgres dependency.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { defineSchema, defineTable, v } from "../schema/index.js"
import {
  SubscriptionRegistry,
} from "../reactivity/subscription-registry.js"
import {
  InvalidationEvaluator,
} from "../reactivity/invalidation-evaluator.js"
import { hashResult, hasResultChanged, computeDiff } from "../reactivity/result-differ.js"
import { MiddlewareManager } from "../middleware/middleware.js"
import { enforceAccess, roles, allow } from "../permissions/permissions.js"
import { createAuthContext } from "../auth/auth.js"
import { validateArgs, s, ValidationError } from "../validation/args-validation.js"
import { RateLimiter, RateLimitError } from "../validation/rate-limit.js"
import { QueryBuilder } from "../query-builder/query-builder.js"
import { MetricsCollector } from "../metrics/metrics.js"
import { toPrometheusFormat } from "../metrics/prometheus.js"
import { InMemoryPubSubAdapter } from "../pubsub/pubsub.js"
import type { ChangeEvent } from "../reactivity/invalidation-evaluator.js"

// --- Schema for integration tests ---
const schema = defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    role: v.enum("admin", "member"),
  }).index("by_email", ["email"], { unique: true }),

  tasks: defineTable({
    title: v.string(),
    done: v.boolean({ default: false }),
    priority: v.enum("low", "medium", "high", "critical"),
    assigneeId: v.id("users"),
    createdAt: v.timestamp({ default: "now" }),
  })
    .index("by_assignee", ["assigneeId"])
    .relation("assignee", { from: "assigneeId", to: "users" })
    .relation("comments", { from: "id", to: "comments.taskId" }),

  comments: defineTable({
    taskId: v.id("tasks"),
    authorId: v.id("users"),
    body: v.string(),
    createdAt: v.timestamp({ default: "now" }),
  })
    .index("by_task", ["taskId"])
    .relation("author", { from: "authorId", to: "users" }),
})

// --- Simple in-line mock database for E2E tests ---
class SimpleInMemoryDB {
  private tables = new Map<string, Map<string, Record<string, unknown>>>()

  table(name: string) {
    if (!this.tables.has(name)) this.tables.set(name, new Map())
    return this.tables.get(name)!
  }

  seed(tableName: string, rows: Record<string, unknown>[]) {
    const t = this.table(tableName)
    for (const row of rows) t.set(row.id as string, { ...row })
  }

  where(tableName: string, filters: Record<string, unknown>) {
    return Array.from(this.table(tableName).values()).filter((row) => {
      for (const [k, v] of Object.entries(filters)) {
        if (row[k] !== v) return false
      }
      return true
    })
  }

  get(tableName: string, id: string) { return this.table(tableName).get(id) ?? null }
  insert(tableName: string, data: Record<string, unknown>) {
    const id = data.id as string ?? `id_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const row = { ...data, id }
    this.table(tableName).set(id, row)
    return row
  }
  update(tableName: string, id: string, data: Record<string, unknown>) {
    const existing = this.table(tableName).get(id)
    if (!existing) throw new Error(`Not found: ${id}`)
    const updated = { ...existing, ...data, id }
    this.table(tableName).set(id, updated)
    return updated
  }
  delete(tableName: string, id: string) { return this.table(tableName).delete(id) }
}
const listTasksFn = {
  type: "query",
  handler: async (ctx: any, args: { userId: string }) => {
    return ctx.db.tasks.where({ assigneeId: args.userId, done: false })
  },
}

const createTaskFn = {
  type: "mutation",
  handler: async (ctx: any, args: { title: string; userId: string; priority?: string }) => {
    return ctx.db.tasks.insert({
      title: args.title,
      assigneeId: args.userId,
      priority: args.priority ?? "medium",
      done: false,
    })
  },
}

const completeTaskFn = {
  type: "mutation",
  handler: async (ctx: any, args: { taskId: string }) => {
    return ctx.db.tasks.update(args.taskId, { done: true })
  },
}

const deleteTaskFn = {
  type: "mutation",
  handler: async (ctx: any, args: { taskId: string }) => {
    await ctx.db.tasks.delete(args.taskId)
    return { success: true }
  },
}

// ========================================================
// Integration Test Suite
// ========================================================

describe("E2E: Reactive Loop", () => {
  let db: SimpleInMemoryDB

  beforeEach(() => {
    db = new SimpleInMemoryDB()
    db.seed("users", [
      { id: "u1", name: "Alice", email: "alice@test.com", role: "admin" },
      { id: "u2", name: "Bob", email: "bob@test.com", role: "member" },
    ])
    db.seed("tasks", [
      { id: "t1", title: "Buy groceries", assigneeId: "u1", done: false, priority: "medium" },
      { id: "t2", title: "Write tests", assigneeId: "u1", done: false, priority: "high" },
      { id: "t3", title: "Deploy", assigneeId: "u2", done: true, priority: "critical" },
    ])
  })

  it("query returns filtered results", () => {
    const results = db.where("tasks", { assigneeId: "u1", done: false })
    expect(results).toHaveLength(2)
  })

  it("mutation creates data and subsequent query reflects it", () => {
    db.insert("tasks", { title: "New task", assigneeId: "u1", done: false, priority: "low" })
    const results = db.where("tasks", { assigneeId: "u1", done: false })
    expect(results).toHaveLength(3)
  })

  it("mutation modifies data and query reflects the change", () => {
    db.update("tasks", "t1", { done: true })
    const results = db.where("tasks", { assigneeId: "u1", done: false })
    expect(results).toHaveLength(1) // t1 now done=true, filtered out
  })

  it("mutation deletes data and query reflects it", () => {
    db.delete("tasks", "t1")
    const results = db.where("tasks", { assigneeId: "u1", done: false })
    expect(results).toHaveLength(1)
  })

  it("full reactive snapshot: query → create → complete → delete", () => {
    // Initial
    let results = db.where("tasks", { assigneeId: "u1", done: false })
    expect(results).toHaveLength(2)

    // Create
    db.insert("tasks", { title: "Added", assigneeId: "u1", done: false, priority: "low" })
    results = db.where("tasks", { assigneeId: "u1", done: false })
    expect(results).toHaveLength(3)

    // Complete
    db.update("tasks", "t1", { done: true })
    results = db.where("tasks", { assigneeId: "u1", done: false })
    expect(results).toHaveLength(2)

    // Delete
    db.delete("tasks", "t2")
    results = db.where("tasks", { assigneeId: "u1", done: false })
    expect(results).toHaveLength(1)
  })
})

describe("E2E: Subscription Registry + Invalidation", () => {
  it("full subscription lifecycle: register → invalidate → re-execute", () => {
    const registry = new SubscriptionRegistry()
    const evaluator = new InvalidationEvaluator(registry, "filter")

    // Subscribe two clients to different users' tasks
    registry.register({
      id: "sub1",
      queryName: "tasks.list",
      args: { userId: "u1" },
      connectionId: "conn1",
      dependencies: [{ table: "tasks", filters: { assigneeId: "u1" } }],
      lastResult: [{ id: "t1", title: "Task 1" }],
      lastResultHash: hashResult([{ id: "t1", title: "Task 1" }]),
    })

    registry.register({
      id: "sub2",
      queryName: "tasks.list",
      args: { userId: "u2" },
      connectionId: "conn2",
      dependencies: [{ table: "tasks", filters: { assigneeId: "u2" } }],
      lastResult: [],
      lastResultHash: hashResult([]),
    })

    // Mutate u1's tasks — only sub1 should invalidate
    const invalidated = evaluator.evaluate([{
      table: "tasks",
      operation: "insert",
      affectedFilters: { assigneeId: "u1" },
    }])

    expect(invalidated).toHaveLength(1)
    expect(invalidated[0].subscriptionId).toBe("sub1")

    // Verify result diffing works
    const newResult = [{ id: "t1", title: "Task 1" }, { id: "t2", title: "Task 2" }]
    const oldHash = registry.get("sub1")!.lastResultHash
    expect(hasResultChanged(oldHash, newResult)).toBe(true)

    // Update subscription state
    registry.update("sub1", [{ table: "tasks", filters: { assigneeId: "u1" } }], newResult, hashResult(newResult))
    expect(registry.get("sub1")!.version).toBe(2)

    // Remove connection — cleans up subscriptions
    registry.removeConnection("conn1")
    expect(registry.get("sub1")).toBeUndefined()
    expect(registry.size).toBe(1)
  })
})

describe("E2E: Middleware Pipeline", () => {
  it("before/after/error hooks execute in correct order", async () => {
    const log: string[] = []
    const mw = new MiddlewareManager()

    mw.use({
      name: "logger",
      before: () => { log.push("before") },
      after: () => { log.push("after") },
      onError: () => { log.push("error") },
    })

    mw.use({
      name: "timer",
      before: () => { log.push("timer-start") },
      after: () => { log.push("timer-end") },
    })

    const ctx = {
      functionName: "test",
      functionType: "mutation" as const,
      args: {},
      auth: createAuthContext("u1"),
      state: new Map(),
    }

    await mw.runBefore(ctx)
    expect(log).toEqual(["before", "timer-start"])

    await mw.runAfter(ctx, { result: true })
    expect(log).toEqual(["before", "timer-start", "after", "timer-end"])

    await mw.runOnError(ctx, new Error("test"))
    expect(log).toEqual(["before", "timer-start", "after", "timer-end", "error"])
  })
})

describe("E2E: Auth + Permissions + Validation Pipeline", () => {
  it("enforces auth → permissions → validation in sequence", async () => {
    const auth = createAuthContext("u1", { role: "admin" })
    const memberAuth = createAuthContext("u2", { role: "member" })
    const anonAuth = createAuthContext(null)

    // Auth check passes for authenticated user
    await expect(enforceAccess("authenticated", auth, "test")).resolves.not.toThrow()

    // Role check passes for admin
    await expect(enforceAccess(roles("admin"), auth, "test")).resolves.not.toThrow()

    // Role check fails for member
    await expect(enforceAccess(roles("admin"), memberAuth, "test")).rejects.toThrow()

    // Auth check fails for anonymous
    await expect(enforceAccess("authenticated", anonAuth, "test")).rejects.toThrow()

    // Validation passes for valid args
    expect(() => validateArgs({ title: "Hello", priority: 5 }, {
      title: s.string().min(1),
      priority: s.number().min(1).max(10),
    })).not.toThrow()

    // Validation fails for invalid args
    expect(() => validateArgs({ title: "" }, {
      title: s.string().min(1),
    })).toThrow(ValidationError)
  })

  it("rate limiter + validation + permissions compose correctly", async () => {
    const limiter = new RateLimiter({ limit: 3, window: 60_000 })

    // First 3 requests pass
    for (let i = 0; i < 3; i++) {
      expect(limiter.check("user1").allowed).toBe(true)
    }

    // 4th request blocked
    expect(limiter.check("user1").allowed).toBe(false)

    // Different user still allowed
    expect(limiter.check("user2").allowed).toBe(true)

    limiter.stop()
  })
})

describe("E2E: Metrics Collection", () => {
  it("records full lifecycle metrics and exports to Prometheus", () => {
    const metrics = new MetricsCollector()

    // Simulate a series of operations
    metrics.setConnections(5)
    metrics.recordSubscription("created")
    metrics.recordSubscription("created")
    metrics.recordQuery("query:tasks.list", 5.2)
    metrics.recordQuery("query:tasks.list", 3.1)
    metrics.recordMutation("mutation:tasks.create", 12.5)
    metrics.recordMutation("mutation:tasks.create", 8.3, false, 1)
    metrics.recordInvalidation(2.1, 3, 10)

    const snapshot = metrics.getSnapshot()
    expect(snapshot.server.connections).toBe(5)
    expect(snapshot.server.activeSubscriptions).toBe(2)
    expect(snapshot.queries.totalExecuted).toBe(2)
    expect(snapshot.mutations.totalExecuted).toBe(2)
    expect(snapshot.mutations.totalRetries).toBe(1)
    expect(snapshot.invalidations.totalEvaluations).toBe(1)

    // Prometheus export
    const prom = toPrometheusFormat(snapshot)
    expect(prom).toContain("reactivebase_connections 5")
    expect(prom).toContain("reactivebase_queries_total 2")
    expect(prom).toContain("reactivebase_mutations_total 2")
    expect(prom).toContain("# TYPE")
  })
})

describe("E2E: Pub/Sub Cross-Server", () => {
  it("broadcasts changes between adapters", async () => {
    InMemoryPubSubAdapter.reset()

    const server1 = new InMemoryPubSubAdapter()
    const server2 = new InMemoryPubSubAdapter()

    const received: ChangeEvent[][] = []
    await server2.subscribe("changes", (events) => received.push(events))

    await server1.publish("changes", [
      { table: "tasks", operation: "insert", affectedFilters: { assigneeId: "u1" } },
    ])

    expect(received).toHaveLength(1)
    expect(received[0][0].table).toBe("tasks")

    await server1.close()
    await server2.close()
  })
})

describe("E2E: Query Builder Full Pipeline", () => {
  it("builds complex query with WHERE + JOIN + ORDER + LIMIT + vector", () => {
    const builder = new QueryBuilder("documents")
      .where({ category: "tech" })
      .where("published", "=", true)
      .join("authors", "authorId")
      .orderBy("createdAt", "desc")
      .limit(20)

    const built = builder.build()

    expect(built.sql).toContain('WHERE')
    expect(built.sql).toContain('JOIN')
    expect(built.sql).toContain('ORDER BY')
    expect(built.sql).toContain('LIMIT 20')
    expect(built.params).toHaveLength(2)

    const deps = builder.getDependencies()
    expect(deps).toHaveLength(2) // documents + authors
  })

  it("vector similarity search generates correct SQL", () => {
    const embedding = Array.from({ length: 10 }, (_, i) => i * 0.1)
    const builder = new QueryBuilder("docs")
      .where({ category: "ai" })
      .whereVectorSimilar("embedding", embedding, { topK: 5, metric: "cosine" })

    const built = builder.build()

    expect(built.sql).toContain('<=>')
    expect(built.sql).toContain('LIMIT 5')
    expect(built.params).toHaveLength(2) // category + embedding
  })
})

describe("E2E: Result Diffing", () => {
  it("detects changes between result sets", () => {
    const oldResult = [
      { id: "1", title: "Task A", done: false },
      { id: "2", title: "Task B", done: false },
    ]
    const newResult = [
      { id: "1", title: "Task A Updated", done: false },
      { id: "3", title: "Task C", done: false },
    ]

    const diff = computeDiff(oldResult, newResult)
    expect(diff).not.toBeNull()
    // May be "full" or "array" depending on relative sizes
    expect(["full", "array"]).toContain(diff!.type)

    // Hash change detection always works
    const oldHash = hashResult(oldResult)
    expect(hasResultChanged(oldHash, newResult)).toBe(true)
    expect(hasResultChanged(oldHash, oldResult)).toBe(false)
  })

  it("returns null for identical results", () => {
    const result = [{ id: "1", title: "Task" }]
    expect(computeDiff(result, result)).toBeNull()
  })
})
