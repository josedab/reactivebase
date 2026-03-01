import { describe, it, expect } from "vitest"
import {
  createTenancyMiddleware,
  getTenantId,
  buildTenantFilter,
  generateTenantSchemaSQL,
  generateSetSchemaSQL,
  generateDropTenantSQL,
  getTenantFromState,
} from "../tenancy/tenancy.js"
import { createAuthContext } from "../auth/auth.js"

describe("getTenantId", () => {
  it("extracts tenant ID from auth claims", () => {
    const auth = createAuthContext("u1", { tenantId: "t1" })
    expect(getTenantId(auth, "tenantId")).toBe("t1")
  })

  it("returns null when claim is missing", () => {
    const auth = createAuthContext("u1", {})
    expect(getTenantId(auth, "tenantId")).toBeNull()
  })
})

describe("createTenancyMiddleware", () => {
  it("creates middleware that sets tenant state", () => {
    const mw = createTenancyMiddleware({ mode: "row", column: "orgId", claimKey: "orgId" })
    expect(mw.name).toBe("tenancy")

    const ctx = {
      functionName: "test",
      functionType: "query" as const,
      args: {},
      auth: createAuthContext("u1", { orgId: "org-123" }),
      state: Object.freeze({}),
    }

    const result = mw.before!(ctx)

    expect(result).toBeDefined()
    expect(result!.state!._tenantId).toBe("org-123")
    expect(result!.state!._tenantColumn).toBe("orgId")
    expect(result!.state!._tenantMode).toBe("row")
  })

  it("handles missing tenant ID gracefully", () => {
    const mw = createTenancyMiddleware({ mode: "row" })
    const ctx = {
      functionName: "test",
      functionType: "query" as const,
      args: {},
      auth: createAuthContext("u1", {}),
      state: Object.freeze({}),
    }

    const result = mw.before!(ctx)
    expect(result).toBeDefined()
    expect(result!.state!._tenantId).toBeNull()
  })
})

describe("buildTenantFilter", () => {
  it("builds WHERE clause for tenant column", () => {
    const { sql, param } = buildTenantFilter("t1", "tenantId")
    expect(sql).toContain('"tenantId"')
    expect(param).toBe("t1")
  })
})

describe("generateTenantSchemaSQL", () => {
  it("generates CREATE SCHEMA SQL", () => {
    const sql = generateTenantSchemaSQL("acme-corp")
    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS "tenant_acme_corp"')
  })

  it("sanitizes tenant ID for SQL safety", () => {
    const sql = generateTenantSchemaSQL("drop; --")
    expect(sql).toContain("tenant_drop")
    // Dangerous characters should be stripped from the schema name
    expect(sql).not.toContain('"tenant_drop; --"')
  })
})

describe("generateSetSchemaSQL", () => {
  it("generates SET search_path SQL", () => {
    const sql = generateSetSchemaSQL("acme")
    expect(sql).toContain("SET search_path")
    expect(sql).toContain("tenant_acme")
  })
})

describe("generateDropTenantSQL", () => {
  it("generates DROP SCHEMA SQL", () => {
    const sql = generateDropTenantSQL("acme")
    expect(sql).toContain('DROP SCHEMA IF EXISTS "tenant_acme" CASCADE')
  })
})

describe("getTenantFromState", () => {
  it("extracts tenant context from middleware state", () => {
    const state: Readonly<Record<string, unknown>> = Object.freeze({
      _tenantId: "t1",
      _tenantColumn: "orgId",
      _tenantMode: "row",
    })

    const tenant = getTenantFromState(state)
    expect(tenant).not.toBeNull()
    expect(tenant!.tenantId).toBe("t1")
    expect(tenant!.mode).toBe("row")
    expect(tenant!.column).toBe("orgId")
  })

  it("returns null when no tenancy configured", () => {
    const state: Readonly<Record<string, unknown>> = Object.freeze({})
    expect(getTenantFromState(state)).toBeNull()
  })
})
