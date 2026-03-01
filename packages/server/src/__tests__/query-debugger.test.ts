import { describe, it, expect } from "vitest"
import { QueryDebugger } from "../query-debugger/query-debugger.js"

describe("QueryDebugger", () => {
  it("records subscription lifecycle", () => {
    const debugger_ = new QueryDebugger()

    debugger_.recordSubscriptionCreated("sub1", "listTasks", "conn1", [
      { table: "tasks", filters: { status: "active" } },
    ])

    expect(debugger_.getProfiles()).toHaveLength(1)
    expect(debugger_.getProfile("sub1")?.queryName).toBe("listTasks")

    debugger_.recordSubscriptionRemoved("sub1")
    expect(debugger_.getProfiles()).toHaveLength(0)
  })

  it("tracks dependency graph", () => {
    const debugger_ = new QueryDebugger()

    debugger_.recordSubscriptionCreated("sub1", "listTasks", "conn1", [{ table: "tasks" }, { table: "users" }])

    const graph = debugger_.getDependencyGraph()
    expect(graph.get("sub1")).toHaveLength(2)
    expect(graph.get("sub1")![0].sourceTable).toBe("tasks")
  })

  it("records invalidation chains", () => {
    const debugger_ = new QueryDebugger()

    debugger_.recordSubscriptionCreated("sub1", "q1", "conn1", [{ table: "tasks" }])
    debugger_.recordSubscriptionCreated("sub2", "q2", "conn1", [{ table: "tasks" }])

    debugger_.recordInvalidation("tasks", ["sub1", "sub2"])

    const chains = debugger_.getInvalidationChains()
    expect(chains).toHaveLength(1)
    expect(chains[0].affectedSubscriptions).toContain("sub1")
    expect(chains[0].affectedSubscriptions).toContain("sub2")

    const profile = debugger_.getProfile("sub1")
    expect(profile?.invalidationCount).toBe(1)
  })

  it("records re-execution timing", () => {
    const debugger_ = new QueryDebugger()
    debugger_.recordSubscriptionCreated("sub1", "q1", "conn1", [{ table: "tasks" }])

    debugger_.recordReExecution("sub1", 15, true)
    debugger_.recordReExecution("sub1", 25, false)

    const profile = debugger_.getProfile("sub1")
    expect(profile?.reExecutionCount).toBe(2)
    expect(profile?.avgReExecutionMs).toBe(20)
    expect(profile?.resultDiffCount).toBe(1)
  })

  it("provides why-did-re-render trace", () => {
    const debugger_ = new QueryDebugger()
    debugger_.recordSubscriptionCreated("sub1", "listTasks", "conn1", [{ table: "tasks" }])
    debugger_.recordInvalidation("tasks", ["sub1"])
    debugger_.recordReExecution("sub1", 10, true)

    const trace = debugger_.whyDidReRender("sub1")

    expect(trace.queryName).toBe("listTasks")
    expect(trace.recentInvalidations).toHaveLength(1)
    expect(trace.dependencies).toHaveLength(1)
    expect(trace.profile?.reExecutionCount).toBe(1)
  })

  it("emits events to handlers", () => {
    const debugger_ = new QueryDebugger()
    const events: string[] = []

    debugger_.onEvent((e) => events.push(e.type))

    debugger_.recordSubscriptionCreated("sub1", "q1", "conn1", [{ table: "t" }])
    debugger_.recordInvalidation("t", ["sub1"])

    expect(events).toContain("subscription_created")
    expect(events).toContain("invalidation_triggered")
  })

  it("provides dashboard summary", () => {
    const debugger_ = new QueryDebugger()
    debugger_.recordSubscriptionCreated("sub1", "q1", "conn1", [{ table: "t" }])
    debugger_.recordSubscriptionCreated("sub2", "q2", "conn1", [{ table: "t" }])
    debugger_.recordReExecution("sub1", 50, true)
    debugger_.recordReExecution("sub1", 60, true)

    const summary = debugger_.getSummary()
    expect(summary.totalSubscriptions).toBe(2)
    expect(summary.topReExecuted[0].subscriptionId).toBe("sub1")
  })

  it("respects sample rate", () => {
    const debugger_ = new QueryDebugger({ sampleRate: 0 })
    debugger_.recordSubscriptionCreated("sub1", "q1", "conn1", [{ table: "t" }])

    expect(debugger_.getProfiles()).toHaveLength(0)
  })

  it("clears all data", () => {
    const debugger_ = new QueryDebugger()
    debugger_.recordSubscriptionCreated("sub1", "q1", "conn1", [{ table: "t" }])
    debugger_.recordInvalidation("t", ["sub1"])

    debugger_.clear()

    expect(debugger_.getProfiles()).toHaveLength(0)
    expect(debugger_.getEvents()).toHaveLength(0)
    expect(debugger_.getInvalidationChains()).toHaveLength(0)
  })
})
