import { describe, it, expect, beforeEach } from "vitest"
import {
  TenantConnectionRouter,
  buildSetTenantContextSQL,
  buildCreateRlsPolicySQL,
  buildEnableRlsSQL,
} from "../tenancy/tenant-routing.js"

describe("buildSetTenantContextSQL", () => {
  it("generates SET context SQL with tenant ID", () => {
    const sql = buildSetTenantContextSQL("acme")
    expect(sql).toContain("SET app.current_tenant = 'acme'")
  })

  it("uses the specified column in the comment", () => {
    const sql = buildSetTenantContextSQL("acme", "org_id")
    expect(sql).toContain('column "org_id"')
  })

  it("escapes single quotes in tenant ID", () => {
    const sql = buildSetTenantContextSQL("it's-a-test")
    expect(sql).toContain("it''s-a-test")
    expect(sql).not.toContain("it's-a-test")
  })
})

describe("buildCreateRlsPolicySQL", () => {
  it("generates RLS policy SQL for a table", () => {
    const sql = buildCreateRlsPolicySQL("orders")
    expect(sql).toContain('CREATE POLICY tenant_isolation_orders ON "orders"')
    expect(sql).toContain("current_setting('app.current_tenant')")
    expect(sql).toContain('"tenant_id"')
  })

  it("uses custom column name", () => {
    const sql = buildCreateRlsPolicySQL("orders", "org_id")
    expect(sql).toContain('"org_id"')
  })

  it("sanitizes table name", () => {
    const sql = buildCreateRlsPolicySQL("drop; --")
    expect(sql).toContain("tenant_isolation_drop")
    expect(sql).not.toContain('"drop; --"')
  })
})

describe("buildEnableRlsSQL", () => {
  it("generates ALTER TABLE SQL to enable RLS", () => {
    const sql = buildEnableRlsSQL("orders")
    expect(sql).toContain('ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY')
  })

  it("sanitizes table name", () => {
    const sql = buildEnableRlsSQL("bad; table")
    expect(sql).toContain('"bad__table"')
  })
})

describe("TenantConnectionRouter", () => {
  let router: TenantConnectionRouter

  describe("row-level mode", () => {
    beforeEach(() => {
      router = new TenantConnectionRouter({ mode: "row", column: "tenant_id" })
    })

    it("creates a connection for a tenant", async () => {
      const conn = await router.getConnection("acme")
      expect(conn.tenantId).toBe("acme")
      expect(conn.mode).toBe("row")
      expect(conn.inUse).toBe(true)
      expect(conn.contextSQL).toContain("SET app.current_tenant = 'acme'")
    })

    it("reuses idle connections from the pool", async () => {
      const conn1 = await router.getConnection("acme")
      const id1 = conn1.connectionId
      conn1.release()
      expect(conn1.inUse).toBe(false)

      const conn2 = await router.getConnection("acme")
      expect(conn2.connectionId).toBe(id1)
    })

    it("creates separate connections for different tenants", async () => {
      const conn1 = await router.getConnection("acme")
      const conn2 = await router.getConnection("beta")
      expect(conn1.connectionId).not.toBe(conn2.connectionId)
      expect(conn1.tenantId).toBe("acme")
      expect(conn2.tenantId).toBe("beta")
    })

    it("throws when pool is exhausted", async () => {
      const smallRouter = new TenantConnectionRouter({
        mode: "row",
        maxPoolSize: 2,
      })

      await smallRouter.getConnection("acme")
      await smallRouter.getConnection("acme")
      await expect(smallRouter.getConnection("acme")).rejects.toThrow("Connection pool exhausted")
    })
  })

  describe("schema mode", () => {
    beforeEach(() => {
      router = new TenantConnectionRouter({ mode: "schema" })
    })

    it("sets search_path for schema-per-tenant", async () => {
      const conn = await router.getConnection("acme")
      expect(conn.mode).toBe("schema")
      expect(conn.contextSQL).toContain("SET search_path")
      expect(conn.contextSQL).toContain("tenant_acme")
    })

    it("sanitizes tenant ID in schema name", async () => {
      const conn = await router.getConnection("bad; --name")
      expect(conn.contextSQL).toContain("tenant_bad____name")
      expect(conn.contextSQL).not.toContain('"tenant_bad; --name"')
    })
  })

  describe("pool management", () => {
    beforeEach(() => {
      router = new TenantConnectionRouter({ mode: "row" })
    })

    it("returns pool stats", async () => {
      await router.getConnection("acme")
      const conn2 = await router.getConnection("acme")
      conn2.release()

      const stats = router.getPoolStats("acme")
      expect(stats).toHaveLength(1)
      expect(stats[0].tenantId).toBe("acme")
      expect(stats[0].totalConnections).toBe(2)
      expect(stats[0].activeConnections).toBe(1)
      expect(stats[0].idleConnections).toBe(1)
    })

    it("returns stats for all tenants", async () => {
      await router.getConnection("acme")
      await router.getConnection("beta")
      const stats = router.getPoolStats()
      expect(stats).toHaveLength(2)
    })

    it("returns empty stats for unknown tenant", () => {
      const stats = router.getPoolStats("unknown")
      expect(stats).toHaveLength(0)
    })

    it("lists active tenants", async () => {
      await router.getConnection("acme")
      await router.getConnection("beta")
      const active = router.listActiveTenants()
      expect(active).toContain("acme")
      expect(active).toContain("beta")
      expect(active).toHaveLength(2)
    })

    it("closes a tenant pool", async () => {
      await router.getConnection("acme")
      await router.getConnection("beta")

      await router.closeTenant("acme")

      expect(router.listActiveTenants()).toEqual(["beta"])
      expect(router.getPoolStats("acme")).toHaveLength(0)
    })

    it("closes all tenant pools", async () => {
      await router.getConnection("acme")
      await router.getConnection("beta")

      await router.closeAll()

      expect(router.listActiveTenants()).toHaveLength(0)
    })

    it("closeTenant on unknown tenant is a no-op", async () => {
      await expect(router.closeTenant("unknown")).resolves.toBeUndefined()
    })
  })
})
