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
