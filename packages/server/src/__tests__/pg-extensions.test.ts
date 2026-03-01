import { describe, it, expect, vi } from "vitest"
import { detectExtensions, ExtensionProvisioner } from "../pg-extensions/pg-extensions.js"
import type { ProvisionerAdapter, SchemaInput } from "../pg-extensions/pg-extensions.js"

describe("detectExtensions", () => {
  it("detects pgvector from vector columns", () => {
    const schema: SchemaInput = {
      columns: [{ table: "documents", name: "embedding", type: "vector(1536)" }],
      indexes: [],
    }

    const result = detectExtensions(schema)
    expect(result.required.some((r) => r.name === "pgvector")).toBe(true)
  })

  it("detects postgis from spatial columns", () => {
    const schema: SchemaInput = {
      columns: [{ table: "locations", name: "coords", type: "geometry" }],
      indexes: [],
    }

    const result = detectExtensions(schema)
    expect(result.required.some((r) => r.name === "postgis")).toBe(true)
  })

  it("detects pg_trgm from gin indexes", () => {
    const schema: SchemaInput = {
      columns: [],
      indexes: [{ table: "users", name: "idx_name_gin", type: "gin", columns: ["name"] }],
    }

    const result = detectExtensions(schema)
    const hasTrgm = result.required.some((r) => r.name === "pg_trgm") ||
                    result.optional.some((r) => r.name === "pg_trgm")
    expect(hasTrgm).toBe(true)
  })

  it("detects pgcrypto from query patterns", () => {
    const schema: SchemaInput = {
      columns: [],
      indexes: [],
      queries: ["SELECT gen_random_uuid()"],
    }

    const result = detectExtensions(schema)
    expect(result.required.some((r) => r.name === "pgcrypto")).toBe(true)
  })

  it("returns empty when no extensions needed", () => {
    const schema: SchemaInput = {
      columns: [{ table: "users", name: "name", type: "text" }],
      indexes: [],
    }

    const result = detectExtensions(schema)
    expect(result.required).toHaveLength(0)
    expect(result.optional).toHaveLength(0)
  })

  it("includes fallback strategies for optional extensions", () => {
    const schema: SchemaInput = {
      columns: [{ table: "users", name: "id", type: "uuid" }],
      indexes: [],
      queries: ["SELECT gen_random_uuid()"],
    }

    const result = detectExtensions(schema)
    const pgcrypto = [...result.required, ...result.optional].find((r) => r.name === "pgcrypto")
    expect(pgcrypto?.fallbackStrategy).toBeDefined()
  })
})

describe("ExtensionProvisioner", () => {
  function createMockAdapter(installed: string[] = [], available: string[] = []): ProvisionerAdapter {
    return {
      queryInstalledExtensions: vi.fn().mockResolvedValue(
        installed.map((name) => ({ name, version: "1.0.0", installed: true, available: true })),
      ),
      queryAvailableExtensions: vi.fn().mockResolvedValue(
        available.map((name) => ({ name, version: "1.0.0", installed: false, available: true })),
      ),
      createExtension: vi.fn().mockResolvedValue(undefined),
    }
  }

  it("skips already installed extensions", async () => {
    const adapter = createMockAdapter(["pgvector"], [])
    const provisioner = new ExtensionProvisioner(adapter)

    const results = await provisioner.provision([
      { name: "pgvector", reason: "vector columns", optional: false },
    ])

    expect(results[0].status).toBe("installed")
    expect(results[0].success).toBe(true)
    expect(adapter.createExtension).not.toHaveBeenCalled()
  })

  it("installs available extensions", async () => {
    const adapter = createMockAdapter([], ["pgvector"])
    const provisioner = new ExtensionProvisioner(adapter)

    const results = await provisioner.provision([
      { name: "pgvector", reason: "vector columns", optional: false },
    ])

    expect(results[0].status).toBe("installed")
    expect(adapter.createExtension).toHaveBeenCalledWith("pgvector")
  })

  it("applies fallback for missing optional extensions", async () => {
    const adapter = createMockAdapter([], [])
    const provisioner = new ExtensionProvisioner(adapter)

    const results = await provisioner.provision([
      { name: "pg_trgm", reason: "fuzzy search", optional: true, fallbackStrategy: "Use LIKE instead" },
    ])

    expect(results[0].status).toBe("fallback")
    expect(results[0].fallbackApplied).toBe("Use LIKE instead")
  })

  it("reports missing required extensions as errors", async () => {
    const adapter = createMockAdapter([], [])
    const provisioner = new ExtensionProvisioner(adapter)

    const results = await provisioner.provision([
      { name: "postgis", reason: "spatial columns", optional: false },
    ])

    expect(results[0].status).toBe("missing")
    expect(results[0].success).toBe(false)
  })

  it("runs doctor check", async () => {
    const adapter = createMockAdapter(["pgvector"], [])
    const provisioner = new ExtensionProvisioner(adapter)

    const report = await provisioner.runDoctorCheck([
      { name: "pgvector", reason: "vector columns", optional: false },
      { name: "postgis", reason: "spatial", optional: false },
    ])

    expect(report.overallHealthy).toBe(false)
    expect(report.extensions).toHaveLength(2)
    expect(report.recommendations.length).toBeGreaterThan(0)
  })
})
