import { describe, it, expect, beforeEach } from "vitest"
import { DaclEngine, allow, deny, PolicyBuilder } from "../dacl/dacl.js"
import type { PolicyCheckContext, PolicyTestCase } from "../dacl/dacl.js"

function makeContext(overrides: Partial<PolicyCheckContext> = {}): PolicyCheckContext {
  return {
    user: { userId: "u1", roles: ["developer"], teamId: "t1", attributes: {} },
    row: { teamId: "t1", createdBy: "u1" },
    action: "read",
    table: "tasks",
    ...overrides,
  }
}

describe("DaclEngine", () => {
  let engine: DaclEngine

  beforeEach(() => {
    engine = new DaclEngine()
  })

  describe("policy definition", () => {
    it("defines an allow policy with fluent builder", () => {
      engine.definePolicy(allow("tasks", "read").roles("admin", "developer"))
      expect(engine.getPolicies()).toHaveLength(1)
      expect(engine.getPolicies()[0].effect).toBe("allow")
    })

    it("defines a deny policy", () => {
      engine.definePolicy(deny("tasks", "delete").describe("No deletes allowed"))
      expect(engine.getPolicies()).toHaveLength(1)
      expect(engine.getPolicies()[0].effect).toBe("deny")
    })

    it("replaces policy with same ID", () => {
      engine.definePolicy(allow("tasks", "read").id("p1").roles("admin"))
      engine.definePolicy(allow("tasks", "read").id("p1").roles("developer"))
      expect(engine.getPolicies()).toHaveLength(1)
      expect(engine.getPolicies()[0].roles).toEqual(["developer"])
    })

    it("removes policy by ID", () => {
      engine.definePolicy(allow("tasks", "read").id("p1"))
      expect(engine.removePolicy("p1")).toBe(true)
      expect(engine.getPolicies()).toHaveLength(0)
    })

    it("sorts policies by priority", () => {
      engine.definePolicy(allow("tasks", "read").id("low").priority(1))
      engine.definePolicy(allow("tasks", "read").id("high").priority(10))
      engine.definePolicy(allow("tasks", "read").id("med").priority(5))
      expect(engine.getPolicies().map((p) => p.id)).toEqual(["high", "med", "low"])
    })
  })

  describe("check", () => {
    it("allows when matching allow policy exists", async () => {
      engine.definePolicy(allow("tasks", "read"))
      const result = await engine.check(makeContext())
      expect(result.allowed).toBe(true)
    })

    it("denies by default when no policy matches", async () => {
      const result = await engine.check(makeContext())
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("default deny")
    })

    it("allows by default when configured", async () => {
      engine = new DaclEngine({ defaultEffect: "allow" })
      const result = await engine.check(makeContext())
      expect(result.allowed).toBe(true)
    })

    it("checks role-based access", async () => {
      engine.definePolicy(allow("tasks", "read").roles("admin"))
      const devResult = await engine.check(
        makeContext({ user: { userId: "u1", roles: ["developer"], attributes: {} } }),
      )
      expect(devResult.allowed).toBe(false)

      const adminResult = await engine.check(makeContext({ user: { userId: "u1", roles: ["admin"], attributes: {} } }))
      expect(adminResult.allowed).toBe(true)
    })

    it("evaluates row-level conditions", async () => {
      engine.definePolicy(allow("tasks", "read").where((ctx) => ctx.user.teamId === ctx.row.teamId))

      const sameTeam = await engine.check(
        makeContext({ user: { userId: "u1", roles: [], teamId: "t1", attributes: {} }, row: { teamId: "t1" } }),
      )
      expect(sameTeam.allowed).toBe(true)

      const diffTeam = await engine.check(
        makeContext({ user: { userId: "u1", roles: [], teamId: "t2", attributes: {} }, row: { teamId: "t1" } }),
      )
      expect(diffTeam.allowed).toBe(false)
    })

    it("deny policies override allow", async () => {
      engine.definePolicy(allow("tasks", "read"))
      engine.definePolicy(deny("tasks", "read").roles("banned"))

      const normalResult = await engine.check(makeContext({ user: { userId: "u1", roles: ["user"], attributes: {} } }))
      expect(normalResult.allowed).toBe(true)

      const bannedResult = await engine.check(
        makeContext({ user: { userId: "u1", roles: ["banned"], attributes: {} } }),
      )
      expect(bannedResult.allowed).toBe(false)
    })

    it("wildcard table matches all tables", async () => {
      engine.definePolicy(allow("*", "read"))
      const result = await engine.check(makeContext({ table: "anything" }))
      expect(result.allowed).toBe(true)
    })

    it("wildcard action matches all actions", async () => {
      engine.definePolicy(allow("tasks", "*"))
      const readResult = await engine.check(makeContext({ action: "read" }))
      expect(readResult.allowed).toBe(true)

      const deleteResult = await engine.check(makeContext({ action: "delete" }))
      expect(deleteResult.allowed).toBe(true)
    })

    it("tracks evaluation count", async () => {
      engine.definePolicy(allow("users", "read"))
      engine.definePolicy(allow("tasks", "read"))

      const result = await engine.check(makeContext())
      expect(result.evaluatedPolicies).toBeGreaterThan(0)
    })
  })

  describe("checkSync", () => {
    it("works with synchronous conditions", () => {
      engine.definePolicy(allow("tasks", "read").where((ctx) => ctx.user.userId === "u1"))
      const result = engine.checkSync(makeContext())
      expect(result.allowed).toBe(true)
    })
  })

  describe("runTests", () => {
    it("runs test cases against policies", async () => {
      engine.definePolicy(allow("tasks", "read").roles("admin", "developer"))

      const tests: PolicyTestCase[] = [
        {
          name: "admin can read",
          context: makeContext({ user: { userId: "u1", roles: ["admin"], attributes: {} } }),
          expectedResult: true,
        },
        {
          name: "viewer cannot read",
          context: makeContext({ user: { userId: "u2", roles: ["viewer"], attributes: {} } }),
          expectedResult: false,
        },
      ]

      const results = await engine.runTests(tests)
      expect(results).toHaveLength(2)
      expect(results[0].passed).toBe(true)
      expect(results[1].passed).toBe(true)
    })
  })

  describe("RLS generation", () => {
    it("generates RLS policies", () => {
      engine.definePolicy(allow("tasks", "read").roles("admin").id("p1"))
      const rls = engine.generateRlsPolicies()
      expect(rls).toHaveLength(1)
      expect(rls[0].table).toBe("tasks")
      expect(rls[0].command).toBe("SELECT")
      expect(rls[0].usingExpression).toContain("admin")
    })

    it("generates RLS SQL", () => {
      engine.definePolicy(allow("tasks", "read").id("p1"))
      engine.definePolicy(allow("tasks", "write").id("p2"))
      const sqls = engine.generateRlsSQL()
      expect(sqls.some((s) => s.includes("ENABLE ROW LEVEL SECURITY"))).toBe(true)
      expect(sqls.some((s) => s.includes("CREATE POLICY"))).toBe(true)
    })

    it("skips wildcard tables for RLS", () => {
      engine.definePolicy(allow("*", "read").id("p1"))
      const rls = engine.generateRlsPolicies()
      expect(rls).toHaveLength(0)
    })
  })

  describe("audit log", () => {
    it("logs when audit is enabled", async () => {
      engine = new DaclEngine({ enableAudit: true })
      engine.definePolicy(allow("tasks", "read"))

      await engine.check(makeContext())
      expect(engine.getAuditLog()).toHaveLength(1)
      expect(engine.getAuditLog()[0].allowed).toBe(true)
    })

    it("does not log when audit is disabled", async () => {
      engine.definePolicy(allow("tasks", "read"))
      await engine.check(makeContext())
      expect(engine.getAuditLog()).toHaveLength(0)
    })

    it("clears audit log", async () => {
      engine = new DaclEngine({ enableAudit: true })
      engine.definePolicy(allow("tasks", "read"))
      await engine.check(makeContext())
      engine.clearAuditLog()
      expect(engine.getAuditLog()).toHaveLength(0)
    })
  })

  describe("coverage report", () => {
    it("calculates policy coverage", () => {
      engine.definePolicy(allow("tasks", "read"))
      engine.definePolicy(allow("tasks", "write"))

      const report = engine.getCoverage(["tasks", "users"], ["read", "write", "delete"])
      expect(report.totalCombinations).toBe(6)
      expect(report.coveredCombinations).toBe(2)
      expect(report.coveragePercentage).toBeCloseTo(33.33, 0)
    })
  })
})
