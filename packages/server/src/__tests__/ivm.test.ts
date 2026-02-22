import { describe, it, expect, beforeEach } from "vitest"
import {
  IncrementalViewMaintainer,
  extractDependencies,
  isIvmEligible,
  evaluatePredicate,
} from "../ivm/ivm.js"
import type { QueryAstNode, Row, FilterPredicate } from "../ivm/ivm.js"

describe("IVM Utilities", () => {
  describe("extractDependencies", () => {
    it("extracts table from scan node", () => {
      expect(extractDependencies({ type: "scan", table: "tasks" })).toEqual(["tasks"])
    })

    it("extracts tables from join", () => {
      const node: QueryAstNode = {
        type: "join",
        joinType: "inner",
        left: { type: "scan", table: "tasks" },
        right: { type: "scan", table: "users" },
        leftKey: "assigneeId",
        rightKey: "id",
      }
      const deps = extractDependencies(node)
      expect(deps).toContain("tasks")
      expect(deps).toContain("users")
    })

    it("extracts through nested filters", () => {
      const node: QueryAstNode = {
        type: "filter",
        source: { type: "scan", table: "tasks" },
        predicate: { field: "done", operator: "=", value: false },
      }
      expect(extractDependencies(node)).toEqual(["tasks"])
    })
  })

  describe("isIvmEligible", () => {
    it("scan is eligible", () => {
      expect(isIvmEligible({ type: "scan", table: "tasks" })).toBe(true)
    })

    it("filter is eligible", () => {
      expect(isIvmEligible({
        type: "filter",
        source: { type: "scan", table: "tasks" },
        predicate: { field: "done", operator: "=", value: false },
      })).toBe(true)
    })

    it("aggregate is eligible", () => {
      expect(isIvmEligible({
        type: "aggregate",
        source: { type: "scan", table: "tasks" },
        groupBy: ["priority"],
        aggregations: [{ fn: "count", field: "*", alias: "count" }],
      })).toBe(true)
    })

    it("limit is NOT eligible", () => {
      expect(isIvmEligible({
        type: "limit",
        source: { type: "scan", table: "tasks" },
        limit: 10,
      })).toBe(false)
    })

    it("join is eligible", () => {
      expect(isIvmEligible({
        type: "join",
        joinType: "inner",
        left: { type: "scan", table: "tasks" },
        right: { type: "scan", table: "users" },
        leftKey: "assigneeId",
        rightKey: "id",
      })).toBe(true)
    })
  })

  describe("evaluatePredicate", () => {
    const row: Row = { id: "1", done: false, priority: "high", count: 5 }

    it("evaluates equality", () => {
      expect(evaluatePredicate({ field: "done", operator: "=", value: false }, row)).toBe(true)
      expect(evaluatePredicate({ field: "done", operator: "=", value: true }, row)).toBe(false)
    })

    it("evaluates inequality", () => {
      expect(evaluatePredicate({ field: "priority", operator: "!=", value: "low" }, row)).toBe(true)
    })

    it("evaluates comparisons", () => {
      expect(evaluatePredicate({ field: "count", operator: ">", value: 3 }, row)).toBe(true)
      expect(evaluatePredicate({ field: "count", operator: "<", value: 3 }, row)).toBe(false)
      expect(evaluatePredicate({ field: "count", operator: ">=", value: 5 }, row)).toBe(true)
      expect(evaluatePredicate({ field: "count", operator: "<=", value: 5 }, row)).toBe(true)
    })

    it("evaluates in/not_in", () => {
      expect(evaluatePredicate({ field: "priority", operator: "in", value: ["high", "critical"] }, row)).toBe(true)
      expect(evaluatePredicate({ field: "priority", operator: "not_in", value: ["low"] }, row)).toBe(true)
    })
  })
})

describe("IncrementalViewMaintainer", () => {
  let ivm: IncrementalViewMaintainer

  beforeEach(() => {
    ivm = new IncrementalViewMaintainer()
  })

  describe("registration", () => {
    it("registers a view with dependencies", () => {
      const view = ivm.register({
        viewId: "v1",
        queryAst: { type: "scan", table: "tasks" },
        currentResult: [{ id: "1", title: "Test" }],
      })
      expect(view.dependencies).toEqual(["tasks"])
      expect(view.ivmEligible).toBe(true)
    })

    it("tracks table dependencies", () => {
      ivm.register({
        viewId: "v1",
        queryAst: { type: "scan", table: "tasks" },
        currentResult: [],
      })
      expect(ivm.getViewsForTable("tasks")).toEqual(["v1"])
    })

    it("unregisters a view", () => {
      ivm.register({ viewId: "v1", queryAst: { type: "scan", table: "tasks" }, currentResult: [] })
      ivm.unregister("v1")
      expect(ivm.getViewsForTable("tasks")).toEqual([])
      expect(ivm.getStats().totalViews).toBe(0)
    })
  })

  describe("delta computation", () => {
    it("computes insert delta for scan", () => {
      ivm.register({
        viewId: "v1",
        queryAst: { type: "scan", table: "tasks" },
        currentResult: [{ id: "1" }],
      })

      const deltas = ivm.applyChange({
        table: "tasks",
        type: "insert",
        newRow: { id: "2", title: "New" },
      })

      expect(deltas).toHaveLength(1)
      expect(deltas[0].inserts).toHaveLength(1)
      expect(deltas[0].inserts[0].id).toBe("2")
      expect(deltas[0].requiresFullRefresh).toBe(false)
    })

    it("computes delete delta for scan", () => {
      ivm.register({
        viewId: "v1",
        queryAst: { type: "scan", table: "tasks" },
        currentResult: [{ id: "1" }, { id: "2" }],
      })

      const deltas = ivm.applyChange({
        table: "tasks",
        type: "delete",
        oldRow: { id: "1" },
      })

      expect(deltas[0].deletes).toHaveLength(1)
    })

    it("computes filter delta — insert matching predicate", () => {
      ivm.register({
        viewId: "v1",
        queryAst: {
          type: "filter",
          source: { type: "scan", table: "tasks" },
          predicate: { field: "done", operator: "=", value: false },
        },
        currentResult: [],
      })

      const deltas = ivm.applyChange({
        table: "tasks",
        type: "insert",
        newRow: { id: "1", done: false },
      })

      expect(deltas[0].inserts).toHaveLength(1)
    })

    it("skips filter delta — insert NOT matching predicate", () => {
      ivm.register({
        viewId: "v1",
        queryAst: {
          type: "filter",
          source: { type: "scan", table: "tasks" },
          predicate: { field: "done", operator: "=", value: false },
        },
        currentResult: [],
      })

      const deltas = ivm.applyChange({
        table: "tasks",
        type: "insert",
        newRow: { id: "1", done: true },
      })

      expect(deltas[0].inserts).toHaveLength(0)
    })

    it("handles update that changes predicate match", () => {
      ivm.register({
        viewId: "v1",
        queryAst: {
          type: "filter",
          source: { type: "scan", table: "tasks" },
          predicate: { field: "done", operator: "=", value: false },
        },
        currentResult: [{ id: "1", done: false }],
      })

      const deltas = ivm.applyChange({
        table: "tasks",
        type: "update",
        oldRow: { id: "1", done: false },
        newRow: { id: "1", done: true },
      })

      // Row no longer matches filter → should be deleted from view
      expect(deltas[0].deletes).toHaveLength(1)
      expect(deltas[0].inserts).toHaveLength(0)
    })

    it("ignores changes to unrelated tables", () => {
      ivm.register({
        viewId: "v1",
        queryAst: { type: "scan", table: "tasks" },
        currentResult: [],
      })

      const deltas = ivm.applyChange({
        table: "users",
        type: "insert",
        newRow: { id: "u1" },
      })

      expect(deltas).toHaveLength(0)
    })

    it("returns requiresFullRefresh for limit queries", () => {
      ivm.register({
        viewId: "v1",
        queryAst: {
          type: "limit",
          source: { type: "scan", table: "tasks" },
          limit: 10,
        },
        currentResult: [],
      })

      const deltas = ivm.applyChange({
        table: "tasks",
        type: "insert",
        newRow: { id: "1" },
      })

      expect(deltas[0].requiresFullRefresh).toBe(true)
    })

    it("applies delta to cached result", () => {
      ivm.register({
        viewId: "v1",
        queryAst: { type: "scan", table: "tasks" },
        currentResult: [{ id: "1" }],
      })

      ivm.applyChange({ table: "tasks", type: "insert", newRow: { id: "2" } })
      expect(ivm.getResult("v1")).toHaveLength(2)
    })
  })

  describe("stats", () => {
    it("tracks stats", () => {
      ivm.register({
        viewId: "v1",
        queryAst: { type: "scan", table: "tasks" },
        currentResult: [],
      })

      ivm.applyChange({ table: "tasks", type: "insert", newRow: { id: "1" } })

      const stats = ivm.getStats()
      expect(stats.totalViews).toBe(1)
      expect(stats.ivmEligibleViews).toBe(1)
      expect(stats.deltaApplied).toBe(1)
    })
  })
})
