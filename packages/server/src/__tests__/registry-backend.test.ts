import { describe, it, expect, vi } from "vitest"
import {
  PluginRegistryBackend,
  PluginInstaller,
  PluginRegistryError,
  buildCreatePluginRegistrySQL,
  buildInsertPluginSQL,
  buildSearchPluginsSQL,
} from "../plugins/registry-backend.js"

// ── PluginRegistryBackend ───────────────────────────────────────────────────

describe("PluginRegistryBackend", () => {
  it("constructs with default registry URL", () => {
    const backend = new PluginRegistryBackend()
    expect(backend).toBeTruthy()
  })

  it("verifyPackage identifies first-party plugins", () => {
    const backend = new PluginRegistryBackend()
    const result = backend.verifyPackage("@reactivebase/plugin-auth")
    expect(result.verified).toBe(true)
    expect(result.firstParty).toBe(true)
  })

  it("verifyPackage identifies community plugins", () => {
    const backend = new PluginRegistryBackend()
    const result = backend.verifyPackage("my-custom-plugin")
    expect(result.verified).toBe(false)
    expect(result.firstParty).toBe(false)
  })

  it("verifyPackage identifies reactivebase-plugin- prefix", () => {
    const backend = new PluginRegistryBackend()
    const result = backend.verifyPackage("reactivebase-plugin-analytics")
    expect(result.verified).toBe(true)
    expect(result.firstParty).toBe(true)
  })

  it("checkCompatibility returns compatible for matching versions", () => {
    const backend = new PluginRegistryBackend()
    const result = backend.checkCompatibility("my-plugin", "^1.0.0", "1.2.3")
    expect(result.compatible).toBe(true)
    expect(result.message).toContain("compatible")
  })

  it("checkCompatibility returns incompatible for mismatching major", () => {
    const backend = new PluginRegistryBackend()
    const result = backend.checkCompatibility("my-plugin", "^2.0.0", "1.2.3")
    expect(result.compatible).toBe(false)
    expect(result.message).toContain("requires")
  })

  it("checkCompatibility handles >= range", () => {
    const backend = new PluginRegistryBackend()
    expect(backend.checkCompatibility("p", ">=1.0.0", "2.0.0").compatible).toBe(true)
    expect(backend.checkCompatibility("p", ">=3.0.0", "2.0.0").compatible).toBe(false)
  })

  it("checkCompatibility handles exact version", () => {
    const backend = new PluginRegistryBackend()
    expect(backend.checkCompatibility("p", "1.2.3", "1.2.3").compatible).toBe(true)
    expect(backend.checkCompatibility("p", "1.2.3", "1.2.4").compatible).toBe(true)
    expect(backend.checkCompatibility("p", "1.2.3", "1.3.0").compatible).toBe(false)
  })

  it("search rejects on network error", async () => {
    // Mock fetch to fail
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"))
    const backend = new PluginRegistryBackend()
    await expect(backend.search("test")).rejects.toThrow(PluginRegistryError)
    globalThis.fetch = originalFetch
  })

  it("search handles non-ok response", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    })
    const backend = new PluginRegistryBackend()
    await expect(backend.search("test")).rejects.toThrow(PluginRegistryError)
    globalThis.fetch = originalFetch
  })

  it("search parses successful response", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        objects: [
          {
            package: {
              name: "@reactivebase/plugin-auth",
              version: "1.0.0",
              description: "Auth plugin",
              author: { name: "Test" },
              keywords: ["reactivebase-plugin"],
              links: { homepage: "https://example.com" },
              date: "2024-01-01",
            },
            downloads: { monthly: 1000 },
          },
        ],
      }),
    })

    const backend = new PluginRegistryBackend()
    const results = await backend.search("auth")
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe("@reactivebase/plugin-auth")
    expect(results[0].downloads).toBe(1000)
    globalThis.fetch = originalFetch
  })

  it("getPackageInfo caches results", async () => {
    const originalFetch = globalThis.fetch
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: "test-plugin",
        description: "Test",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { dependencies: {} } },
        author: { name: "Test" },
        time: { "1.0.0": "2024-01-01" },
      }),
    })
    globalThis.fetch = mockFetch

    const backend = new PluginRegistryBackend("https://registry.npmjs.org", 60000)
    await backend.getPackageInfo("test-plugin")
    await backend.getPackageInfo("test-plugin") // cached
    expect(mockFetch).toHaveBeenCalledTimes(1)
    globalThis.fetch = originalFetch
  })

  it("getPackageInfo returns 404 as PluginRegistryError", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    })
    const backend = new PluginRegistryBackend()
    await expect(backend.getPackageInfo("nonexistent")).rejects.toThrow("Package not found")
    globalThis.fetch = originalFetch
  })
})

// ── PluginInstaller ─────────────────────────────────────────────────────────

describe("PluginInstaller", () => {
  it("dry run returns success without installing", async () => {
    const installer = new PluginInstaller("/tmp/test-project")
    const result = await installer.installPlugin("@reactivebase/plugin-auth", { dryRun: true })
    expect(result.success).toBe(true)
    expect(result.message).toContain("dry-run")
  })

  it("dry run includes version when specified", async () => {
    const installer = new PluginInstaller("/tmp/test-project")
    const result = await installer.installPlugin("test-plugin", {
      dryRun: true,
      version: "2.0.0",
    })
    expect(result.message).toContain("2.0.0")
  })
})

// ── SQL Builders ──────────────────────────────────────────────────────────

describe("SQL builders", () => {
  it("buildCreatePluginRegistrySQL creates expected tables", () => {
    const sql = buildCreatePluginRegistrySQL()
    expect(sql).toContain("plugin_registry")
    expect(sql).toContain("plugin_versions")
    expect(sql).toContain("CREATE INDEX")
  })

  it("buildInsertPluginSQL generates INSERT with params", () => {
    const entry = {
      name: "test-plugin",
      version: "1.0.0",
      description: "Test",
      author: "Author",
      category: "auth" as const,
      keywords: ["auth", "jwt"],
      npmPackage: "test-plugin",
      downloads: 100,
      rating: 4.5,
      verified: true,
      firstParty: false,
      installCommand: "npx reactivebase add test-plugin",
    }
    const result = buildInsertPluginSQL(entry)
    expect(result.sql).toContain("INSERT OR REPLACE INTO plugin_registry")
    expect(result.params).toHaveLength(11)
    expect(result.params[0]).toBe("test-plugin")
  })

  it("buildSearchPluginsSQL generates query without filters", () => {
    const result = buildSearchPluginsSQL()
    expect(result.sql).toContain("SELECT * FROM plugin_registry")
    expect(result.sql).toContain("ORDER BY downloads DESC")
    expect(result.params).toHaveLength(0)
  })

  it("buildSearchPluginsSQL generates query with search term", () => {
    const result = buildSearchPluginsSQL("auth")
    expect(result.sql).toContain("LIKE")
    expect(result.params).toContain("%auth%")
  })

  it("buildSearchPluginsSQL generates query with category filter", () => {
    const result = buildSearchPluginsSQL(undefined, "auth")
    expect(result.sql).toContain("category =")
    expect(result.params).toContain("auth")
  })

  it("buildSearchPluginsSQL combines search and category", () => {
    const result = buildSearchPluginsSQL("jwt", "auth")
    expect(result.sql).toContain("LIKE")
    expect(result.sql).toContain("category =")
    expect(result.params).toHaveLength(2)
  })
})

// ── PluginRegistryError ─────────────────────────────────────────────────────

describe("PluginRegistryError", () => {
  it("has correct name", () => {
    const err = new PluginRegistryError("test error")
    expect(err.name).toBe("PluginRegistryError")
    expect(err).toBeInstanceOf(Error)
  })
})
