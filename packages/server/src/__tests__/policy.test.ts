import { describe, it, expect, beforeEach } from "vitest"
import {
  definePolicy,
  applyFieldPolicies,
  simulatePolicy,
  generatePolicyRlsSQL,
  testPolicies,
  type PolicyConfig,
} from "../authz/policy.js"
import { createAuthContext } from "../auth/auth.js"

describe("definePolicy", () => {
  it("creates a policy config from schema", () => {
    const config = definePolicy({
      tasks: {
        read: { roles: ["admin", "viewer"] },
        write: { roles: ["admin"] },
      },
    })
    expect(config.engine).toBeDefined()
    expect(config.schema.tasks).toBeDefined()
    expect(config.fieldPolicies.size).toBe(0)
  })

  it("creates policies with row-level filters", () => {
    const config = definePolicy({
      tasks: {
        read: {
          filter: (ctx) => ctx.auth.userId === (ctx.row.ownerId as string),
        },
      },
    })
    expect(config.engine.getPolicies()).toHaveLength(1)
  })

  it("creates separate create/update/delete policies from write", () => {
    const config = definePolicy({
      tasks: {
        write: { roles: ["admin"] },
      },
    })
    // write expands to create + update + delete
    const policies = config.engine.getPolicies()
    expect(policies.length).toBe(3)
    expect(policies.map((p) => p.action).sort()).toEqual(["create", "delete", "update"])
  })

  it("allows overriding specific write actions", () => {
    const config = definePolicy({
      tasks: {
        write: { roles: ["admin"] },
        delete: { roles: ["superadmin"] },
      },
    })
    const policies = config.engine.getPolicies()
    const deletePolicy = policies.find((p) => p.action === "delete")
    expect(deletePolicy?.roles).toEqual(["superadmin"])
  })

  it("registers field-level policies", () => {
    const config = definePolicy({
      users: {
        read: {},
        fields: {
          salary: { roles: ["hr", "admin"] },
          ssn: { roles: ["admin"] },
        },
      },
    })
    expect(config.fieldPolicies.has("users")).toBe(true)
    expect(config.fieldPolicies.get("users")?.size).toBe(2)
  })
})

describe("applyFieldPolicies", () => {
  let config: PolicyConfig

  beforeEach(() => {
    config = definePolicy({
      users: {
        read: {},
        fields: {
          salary: { roles: ["hr", "admin"] },
          email: { roles: ["admin", "viewer"] },
        },
      },
    })
  })

  it("redacts fields when user lacks role", () => {
    const auth = createAuthContext("u1", { role: "viewer" })
    const row = { id: "1", name: "Alice", salary: 100000, email: "alice@test.com" }
    const { row: filtered, redacted } = applyFieldPolicies(config, "users", row, auth)
    expect(redacted).toContain("salary")
    expect(filtered.salary).toBeUndefined()
    expect(filtered.email).toBe("alice@test.com")
  })

  it("shows all fields to admin", () => {
    const auth = createAuthContext("u1", { role: "admin" })
    const row = { id: "1", name: "Alice", salary: 100000, email: "alice@test.com" }
    const { redacted } = applyFieldPolicies(config, "users", row, auth)
    expect(redacted).toHaveLength(0)
  })

  it("returns unmodified row for tables without field policies", () => {
    const auth = createAuthContext("u1")
    const row = { id: "1", title: "Test" }
    const { row: filtered, redacted } = applyFieldPolicies(config, "tasks", row, auth)
    expect(filtered).toEqual(row)
    expect(redacted).toHaveLength(0)
  })

  it("supports field-level filter functions", () => {
    const configWithFilter = definePolicy({
      users: {
        read: {},
        fields: {
          phone: {
            filter: (ctx) => ctx.auth.userId === "owner",
          },
        },
      },
    })
    const auth = createAuthContext("other")
    const row = { id: "1", name: "Alice", phone: "555-1234" }
    const { redacted } = applyFieldPolicies(configWithFilter, "users", row, auth)
    expect(redacted).toContain("phone")
  })
})

describe("simulatePolicy", () => {
  it("simulates a permitted action", async () => {
    const config = definePolicy({
      tasks: {
        read: { roles: ["viewer"] },
      },
    })
    const auth = createAuthContext("u1", { role: "viewer" })
    const result = await simulatePolicy(config, {
      auth,
      table: "tasks",
      action: "read",
      row: { id: "1", title: "Test" },
    })
    expect(result.allowed).toBe(true)
    expect(result.evaluationTimeMs).toBeGreaterThanOrEqual(0)
  })

  it("simulates a denied action", async () => {
    const config = definePolicy({
      tasks: {
        read: { roles: ["admin"] },
      },
    })
    const auth = createAuthContext("u1", { role: "viewer" })
    const result = await simulatePolicy(config, {
      auth,
      table: "tasks",
      action: "read",
    })
    expect(result.allowed).toBe(false)
  })

  it("reports redacted fields in simulation", async () => {
    const config = definePolicy({
      users: {
        read: {},
        fields: {
          salary: { roles: ["hr"] },
        },
      },
    })
    const auth = createAuthContext("u1", { role: "viewer" })
    const result = await simulatePolicy(config, {
      auth,
      table: "users",
      action: "read",
      row: { id: "1", name: "Alice", salary: 100000 },
    })
    expect(result.redactedFields).toContain("salary")
    expect(result.visibleFields).toContain("name")
  })
})

describe("generatePolicyRlsSQL", () => {
  it("generates RLS SQL for policies", () => {
    const config = definePolicy({
      tasks: {
        read: { roles: ["admin", "viewer"] },
      },
    })
    const sqls = generatePolicyRlsSQL(config)
    expect(sqls.length).toBeGreaterThan(0)
    expect(sqls.some((s) => s.includes("ENABLE ROW LEVEL SECURITY"))).toBe(true)
    expect(sqls.some((s) => s.includes("CREATE POLICY"))).toBe(true)
  })
})

describe("testPolicies", () => {
  it("runs test cases and returns results", async () => {
    const config = definePolicy({
      tasks: {
        read: { roles: ["viewer", "admin"] },
        write: { roles: ["admin"] },
      },
    })

    const { results, coverage } = await testPolicies(config, [
      {
        name: "viewer can read",
        context: {
          user: { userId: "u1", roles: ["viewer"], attributes: {} },
          row: {},
          action: "read",
          table: "tasks",
        },
        expectedResult: true,
      },
      {
        name: "viewer cannot create",
        context: {
          user: { userId: "u1", roles: ["viewer"], attributes: {} },
          row: {},
          action: "create",
          table: "tasks",
        },
        expectedResult: false,
      },
    ])

    expect(results).toHaveLength(2)
    expect(results[0].passed).toBe(true)
    expect(results[1].passed).toBe(true)
    expect(coverage.coveragePercentage).toBeGreaterThan(0)
  })
})
