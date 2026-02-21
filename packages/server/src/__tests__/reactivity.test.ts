import { describe, it, expect } from "vitest"
import { SubscriptionRegistry } from "../reactivity/subscription-registry.js"

describe("subscription registry", () => {
  it("registers and retrieves subscriptions", () => {
    const registry = new SubscriptionRegistry()

    registry.register({
      id: "sub1",
      queryName: "listTasks",
      args: { userId: "u1" },
      connectionId: "conn1",
      dependencies: [{ table: "tasks", filters: { assigneeId: "u1" } }],
      lastResult: [],
      lastResultHash: "abc",
    })

    expect(registry.size).toBe(1)
    expect(registry.get("sub1")).toBeDefined()
    expect(registry.get("sub1")!.queryName).toBe("listTasks")
  })

  it("finds subscriptions by table", () => {
    const registry = new SubscriptionRegistry()

    registry.register({
      id: "sub1",
      queryName: "listTasks",
      args: {},
      connectionId: "conn1",
      dependencies: [{ table: "tasks", filters: {} }],
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

    const taskSubs = registry.getSubscriptionsForTable("tasks")
    expect(taskSubs).toHaveLength(1)
    expect(taskSubs[0].id).toBe("sub1")

    const userSubs = registry.getSubscriptionsForTable("users")
    expect(userSubs).toHaveLength(1)
    expect(userSubs[0].id).toBe("sub2")
  })

  it("removes subscriptions", () => {
    const registry = new SubscriptionRegistry()

    registry.register({
      id: "sub1",
      queryName: "listTasks",
      args: {},
      connectionId: "conn1",
      dependencies: [{ table: "tasks", filters: {} }],
      lastResult: [],
      lastResultHash: "abc",
    })

    registry.remove("sub1")

    expect(registry.size).toBe(0)
    expect(registry.get("sub1")).toBeUndefined()
    expect(registry.getSubscriptionsForTable("tasks")).toHaveLength(0)
  })

  it("removes all subscriptions for a connection", () => {
    const registry = new SubscriptionRegistry()

    registry.register({
      id: "sub1",
      queryName: "q1",
      args: {},
      connectionId: "conn1",
      dependencies: [{ table: "tasks", filters: {} }],
      lastResult: [],
      lastResultHash: "abc",
    })

    registry.register({
      id: "sub2",
      queryName: "q2",
      args: {},
      connectionId: "conn1",
      dependencies: [{ table: "users", filters: {} }],
      lastResult: [],
      lastResultHash: "def",
    })

    registry.register({
      id: "sub3",
      queryName: "q3",
      args: {},
      connectionId: "conn2",
      dependencies: [{ table: "tasks", filters: {} }],
      lastResult: [],
      lastResultHash: "ghi",
    })

    registry.removeConnection("conn1")

    expect(registry.size).toBe(1)
    expect(registry.get("sub3")).toBeDefined()
  })

  it("tracks subscriptions across multiple tables", () => {
    const registry = new SubscriptionRegistry()

    registry.register({
      id: "sub1",
      queryName: "taskWithUser",
      args: {},
      connectionId: "conn1",
      dependencies: [
        { table: "tasks", filters: {} },
        { table: "users", filters: {} },
      ],
      lastResult: [],
      lastResultHash: "abc",
    })

    expect(registry.getSubscriptionsForTable("tasks")).toHaveLength(1)
    expect(registry.getSubscriptionsForTable("users")).toHaveLength(1)
  })
})
