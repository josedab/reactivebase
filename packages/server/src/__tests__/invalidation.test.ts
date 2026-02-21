import { describe, it, expect } from "vitest"
import { InvalidationEvaluator } from "../reactivity/invalidation-evaluator.js"
import { SubscriptionRegistry } from "../reactivity/subscription-registry.js"

describe("invalidation evaluator", () => {
  it("invalidates subscriptions reading from modified table", () => {
    const registry = new SubscriptionRegistry()
    const evaluator = new InvalidationEvaluator(registry)

    registry.register({
      id: "sub1",
      queryName: "listTasks",
      args: {},
      connectionId: "conn1",
      dependencies: [{ table: "tasks", filters: { done: false } }],
      lastResult: [],
      lastResultHash: "abc",
    })

    registry.register({
      id: "sub2",
      queryName: "listUsers",
      args: {},
      connectionId: "conn1",
      dependencies: [{ table: "users", filters: {} }],
      lastResult: [],
      lastResultHash: "def",
    })

    const invalidated = evaluator.evaluate([
      { table: "tasks", operation: "update" },
    ])

    expect(invalidated).toHaveLength(1)
    expect(invalidated[0].subscriptionId).toBe("sub1")
    expect(invalidated[0].queryName).toBe("listTasks")
  })

  it("invalidates multiple subscriptions for the same table", () => {
    const registry = new SubscriptionRegistry()
    const evaluator = new InvalidationEvaluator(registry)

    registry.register({
      id: "sub1",
      queryName: "listTasks",
      args: { userId: "u1" },
      connectionId: "conn1",
      dependencies: [{ table: "tasks", filters: {} }],
      lastResult: [],
      lastResultHash: "abc",
    })

    registry.register({
      id: "sub2",
      queryName: "taskStats",
      args: {},
      connectionId: "conn2",
      dependencies: [{ table: "tasks", filters: {} }],
      lastResult: [],
      lastResultHash: "def",
    })

    const invalidated = evaluator.evaluate([
      { table: "tasks", operation: "insert" },
    ])

    expect(invalidated).toHaveLength(2)
  })

  it("does not duplicate invalidations for same subscription", () => {
    const registry = new SubscriptionRegistry()
    const evaluator = new InvalidationEvaluator(registry)

    registry.register({
      id: "sub1",
      queryName: "listTasks",
      args: {},
      connectionId: "conn1",
      dependencies: [{ table: "tasks", filters: {} }],
      lastResult: [],
      lastResultHash: "abc",
    })

    const invalidated = evaluator.evaluate([
      { table: "tasks", operation: "update" },
      { table: "tasks", operation: "delete" },
    ])

    expect(invalidated).toHaveLength(1)
  })

  it("returns empty for unrelated table changes", () => {
    const registry = new SubscriptionRegistry()
    const evaluator = new InvalidationEvaluator(registry)

    registry.register({
      id: "sub1",
      queryName: "listTasks",
      args: {},
      connectionId: "conn1",
      dependencies: [{ table: "tasks", filters: {} }],
      lastResult: [],
      lastResultHash: "abc",
    })

    const invalidated = evaluator.evaluate([
      { table: "users", operation: "insert" },
    ])

    expect(invalidated).toHaveLength(0)
  })
})

describe("filter-level invalidation", () => {
  it("skips subscriptions when filter does not match", () => {
    const registry = new SubscriptionRegistry()
    const evaluator = new InvalidationEvaluator(registry, "filter")

    registry.register({
      id: "sub1",
      queryName: "listTasks",
      args: { userId: "u1" },
      connectionId: "conn1",
      dependencies: [{ table: "tasks", filters: { assigneeId: "u1" } }],
      lastResult: [],
      lastResultHash: "abc",
    })

    // Change to a different user's tasks should not invalidate
    const invalidated = evaluator.evaluate([{
      table: "tasks",
      operation: "update",
      affectedFilters: { assigneeId: "u2", done: true },
    }])

    expect(invalidated).toHaveLength(0)
  })

  it("invalidates when filter matches", () => {
    const registry = new SubscriptionRegistry()
    const evaluator = new InvalidationEvaluator(registry, "filter")

    registry.register({
      id: "sub1",
      queryName: "listTasks",
      args: { userId: "u1" },
      connectionId: "conn1",
      dependencies: [{ table: "tasks", filters: { assigneeId: "u1" } }],
      lastResult: [],
      lastResultHash: "abc",
    })

    const invalidated = evaluator.evaluate([{
      table: "tasks",
      operation: "insert",
      affectedFilters: { assigneeId: "u1", title: "New task" },
    }])

    expect(invalidated).toHaveLength(1)
  })

  it("invalidates on update when old values matched filter", () => {
    const registry = new SubscriptionRegistry()
    const evaluator = new InvalidationEvaluator(registry, "filter")

    registry.register({
      id: "sub1",
      queryName: "listTasks",
      args: {},
      connectionId: "conn1",
      dependencies: [{ table: "tasks", filters: { assigneeId: "u1" } }],
      lastResult: [],
      lastResultHash: "abc",
    })

    // Task reassigned from u1 to u2 — old values match, new don't
    const invalidated = evaluator.evaluate([{
      table: "tasks",
      operation: "update",
      affectedFilters: { assigneeId: "u2" },
      oldValues: { assigneeId: "u1" },
    }])

    expect(invalidated).toHaveLength(1)
  })

  it("falls back to table-level when no affectedFilters provided", () => {
    const registry = new SubscriptionRegistry()
    const evaluator = new InvalidationEvaluator(registry, "filter")

    registry.register({
      id: "sub1",
      queryName: "listTasks",
      args: {},
      connectionId: "conn1",
      dependencies: [{ table: "tasks", filters: { assigneeId: "u1" } }],
      lastResult: [],
      lastResultHash: "abc",
    })

    const invalidated = evaluator.evaluate([{
      table: "tasks",
      operation: "update",
    }])

    expect(invalidated).toHaveLength(1)
  })

  it("always invalidates subscriptions with empty filters", () => {
    const registry = new SubscriptionRegistry()
    const evaluator = new InvalidationEvaluator(registry, "filter")

    registry.register({
      id: "sub1",
      queryName: "allTasks",
      args: {},
      connectionId: "conn1",
      dependencies: [{ table: "tasks", filters: {} }],
      lastResult: [],
      lastResultHash: "abc",
    })

    const invalidated = evaluator.evaluate([{
      table: "tasks",
      operation: "insert",
      affectedFilters: { assigneeId: "u999" },
    }])

    expect(invalidated).toHaveLength(1)
  })

  it("uses table-level mode when configured", () => {
    const registry = new SubscriptionRegistry()
    const evaluator = new InvalidationEvaluator(registry, "table")

    registry.register({
      id: "sub1",
      queryName: "listTasks",
      args: {},
      connectionId: "conn1",
      dependencies: [{ table: "tasks", filters: { assigneeId: "u1" } }],
      lastResult: [],
      lastResultHash: "abc",
    })

    // Even though filter doesn't match, table-level always invalidates
    const invalidated = evaluator.evaluate([{
      table: "tasks",
      operation: "update",
      affectedFilters: { assigneeId: "u999" },
    }])

    expect(invalidated).toHaveLength(1)
  })
})
