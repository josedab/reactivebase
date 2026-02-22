import { describe, it, expect, beforeEach } from "vitest"
import {
  DatabaseFederation,
  FederationError,
  buildHealthCheckSQL,
  buildPoolStatsSQL,
  buildDatabaseInfoSQL,
} from "../multi-db/multi-db.js"

describe("DatabaseFederation", () => {
  let federation: DatabaseFederation

  beforeEach(() => {
    federation = new DatabaseFederation({
      databases: {
        primary: { connectionString: "postgres://localhost/primary", default: true, poolSize: 20 },
        analytics: { connectionString: "postgres://localhost/analytics", readOnly: true },
        legacy: { connectionString: "postgres://localhost/legacy" },
      },
    })
  })

  describe("configuration", () => {
    it("registers databases", () => {
      expect(federation.databaseCount).toBe(3)
      expect(federation.listDatabases()).toEqual(["primary", "analytics", "legacy"])
    })

    it("sets default database", () => {
      expect(federation.defaultDatabase).toBe("primary")
    })

    it("throws on multiple defaults", () => {
      expect(() => new DatabaseFederation({
        databases: {
          a: { connectionString: "x", default: true },
          b: { connectionString: "y", default: true },
        },
      })).toThrow(FederationError)
    })

    it("auto-selects first as default when none specified", () => {
      const fed = new DatabaseFederation({
        databases: {
          db1: { connectionString: "x" },
          db2: { connectionString: "y" },
        },
      })
      expect(fed.defaultDatabase).toBe("db1")
    })

    it("gets database config", () => {
      const config = federation.getConfig("primary")
      expect(config?.poolSize).toBe(20)
    })

    it("checks read-only status", () => {
      expect(federation.isReadOnly("analytics")).toBe(true)
      expect(federation.isReadOnly("primary")).toBe(false)
    })
  })

  describe("table routing", () => {
    it("routes tables to specific databases", () => {
      federation.routeTable("events", "analytics")
      federation.routeTable("legacy_users", "legacy")

      expect(federation.resolveDatabase("events")).toBe("analytics")
      expect(federation.resolveDatabase("legacy_users")).toBe("legacy")
    })

    it("falls back to default database", () => {
      expect(federation.resolveDatabase("tasks")).toBe("primary")
    })

    it("throws on routing to non-existent database", () => {
      expect(() => federation.routeTable("t", "nonexistent")).toThrow(FederationError)
    })

    it("builds routed queries", () => {
      federation.routeTable("events", "analytics")

      const query = federation.buildRoutedQuery("events", "SELECT * FROM events WHERE id = $1", ["e1"])
      expect(query.database).toBe("analytics")
      expect(query.table).toBe("events")
      expect(query.params).toEqual(["e1"])
    })

    it("returns routing map", () => {
      federation.routeTable("events", "analytics")
      federation.routeTable("logs", "analytics")

      const map = federation.getRoutingMap()
      expect(map.events).toBe("analytics")
      expect(map.logs).toBe("analytics")
    })
  })

  describe("health monitoring", () => {
    it("returns health status for all databases", () => {
      const health = federation.getHealth()
      expect(health).toHaveLength(3)
      expect(health[0].status).toBe("disconnected")
    })

    it("gets health for specific database", () => {
      const health = federation.getDatabaseHealth("primary")
      expect(health?.name).toBe("primary")
      expect(health?.poolSize).toBe(20)
    })

    it("updates health status", () => {
      federation.updateHealth("primary", {
        status: "connected",
        latencyMs: 5,
        activeConnections: 3,
        idleConnections: 17,
      })

      const health = federation.getDatabaseHealth("primary")
      expect(health?.status).toBe("connected")
      expect(health?.latencyMs).toBe(5)
    })
  })

  describe("cleanup", () => {
    it("destroys all resources", () => {
      federation.destroy()
      expect(federation.databaseCount).toBe(0)
    })
  })
})

describe("Multi-DB SQL helpers", () => {
  it("builds health check SQL", () => {
    const { sql } = buildHealthCheckSQL()
    expect(sql).toContain("SELECT 1")
  })

  it("builds pool stats SQL", () => {
    const { sql } = buildPoolStatsSQL()
    expect(sql).toContain("pg_stat_activity")
  })

  it("builds database info SQL", () => {
    const { sql } = buildDatabaseInfoSQL()
    expect(sql).toContain("current_database()")
    expect(sql).toContain("pg_database_size")
  })
})
