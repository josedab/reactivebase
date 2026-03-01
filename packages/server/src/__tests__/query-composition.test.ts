import { describe, it, expect } from "vitest"
import { ReactiveQueryDAG } from "../query-composition/query-composition.js"

describe("ReactiveQueryDAG", () => {
  it("adds source nodes", () => {
    const dag = new ReactiveQueryDAG()
    const source = dag.addSource("listUsers", {})

    expect(source.id).toBeDefined()
    expect(source.queryName).toBe("listUsers")
    expect(dag.nodeCount).toBe(1)
  })

  it("creates derived queries from sources", () => {
    const dag = new ReactiveQueryDAG()
    const src = dag.addSource("listUsers", {})
    const derived = dag.deriveQuery([src.id], (users) => (users as unknown[]).length)

    expect(derived.id).toBeDefined()
    expect(derived.sourceIds).toContain(src.id)
    expect(dag.nodeCount).toBe(2)
  })

  it("propagates source updates to derived nodes", () => {
    const dag = new ReactiveQueryDAG()
    const src = dag.addSource<number[]>("getNumbers", {})
    const derived = dag.deriveQuery([src.id], (nums) => {
      const arr = nums as number[]
      return arr.reduce((a, b) => a + b, 0)
    })

    dag.updateSource(src.id, [1, 2, 3], 1)

    expect(derived.currentValue).toBe(6)
    expect(derived.version).toBe(1)
  })

  it("combines multiple sources", () => {
    const dag = new ReactiveQueryDAG()
    const users = dag.addSource("getUsers", {})
    const posts = dag.addSource("getPosts", {})

    const combined = dag.combineQueries([users.id, posts.id], (u, p) => ({ users: u, posts: p }))

    dag.updateSource(users.id, [{ name: "Alice" }], 1)
    dag.updateSource(posts.id, [{ title: "Hello" }], 1)

    expect(combined.currentValue).toEqual({
      users: [{ name: "Alice" }],
      posts: [{ title: "Hello" }],
    })
  })

  it("transforms a single source", () => {
    const dag = new ReactiveQueryDAG()
    const src = dag.addSource<string[]>("getNames", {})
    const upper = dag.transformQuery<string[], string[]>(src.id, (names) => names.map((n) => n.toUpperCase()))

    dag.updateSource(src.id, ["alice", "bob"], 1)
    expect(upper.currentValue).toEqual(["ALICE", "BOB"])
  })

  it("notifies change listeners", () => {
    const dag = new ReactiveQueryDAG()
    const src = dag.addSource("q", {})
    const changes: string[] = []

    dag.onChange((nodeId) => changes.push(nodeId))
    dag.updateSource(src.id, "value", 1)

    expect(changes).toContain(src.id)
  })

  it("disposes nodes and their dependents", () => {
    const dag = new ReactiveQueryDAG()
    const src = dag.addSource("q", {})
    dag.deriveQuery([src.id], (v) => v)

    expect(dag.nodeCount).toBe(2)
    dag.dispose(src.id)
    expect(dag.nodeCount).toBe(0)
  })

  it("rejects unknown source IDs", () => {
    const dag = new ReactiveQueryDAG()
    expect(() => dag.deriveQuery(["nonexistent"], (v) => v)).toThrow('Unknown source node: "nonexistent"')
  })

  it("enforces DAG depth limit", () => {
    const dag = new ReactiveQueryDAG({ maxDAGDepth: 2 })
    const s = dag.addSource("q", {})
    const d1 = dag.deriveQuery([s.id], (v) => v)
    const d2 = dag.deriveQuery([d1.id], (v) => v)

    expect(() => dag.deriveQuery([d2.id], (v) => v)).toThrow("DAG depth limit exceeded")
  })

  it("returns topological order", () => {
    const dag = new ReactiveQueryDAG()
    const s1 = dag.addSource("a", {})
    const s2 = dag.addSource("b", {})
    const d = dag.deriveQuery([s1.id, s2.id], (a, b) => [a, b])

    const order = dag.getTopologicalOrder()
    const s1Idx = order.indexOf(s1.id)
    const s2Idx = order.indexOf(s2.id)
    const dIdx = order.indexOf(d.id)

    expect(s1Idx).toBeLessThan(dIdx)
    expect(s2Idx).toBeLessThan(dIdx)
  })
})
