import { describe, it, expect, beforeEach } from "vitest"
import {
  PluginMarketplace,
  PluginMarketplaceError,
  validatePluginConfig,
  MARKETPLACE_CATALOG,
} from "../plugins/marketplace.js"
import type { PluginV2Definition } from "../plugins/marketplace.js"

const testPlugin: PluginV2Definition = {
  name: "test-plugin",
  version: "1.0.0",
  description: "A test plugin",
  author: "Test",
  keywords: ["test"],
  category: "utilities",
}

const pluginWithConfig: PluginV2Definition = {
  name: "configured-plugin",
  version: "1.0.0",
  description: "Plugin with config",
  author: "Test",
  keywords: ["test"],
  category: "utilities",
  configSchema: {
    apiKey: { type: "string", required: true, description: "API Key" },
    maxRetries: { type: "number", required: false, default: 3 },
  },
}

describe("PluginMarketplace", () => {
  let marketplace: PluginMarketplace

  beforeEach(() => {
    marketplace = new PluginMarketplace()
  })

  describe("search", () => {
    it("returns all plugins by default", () => {
      const results = marketplace.search()
      expect(results.length).toBe(MARKETPLACE_CATALOG.length)
    })

    it("searches by query", () => {
      const results = marketplace.search({ query: "auth" })
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(
        results.every(
          (r) => r.name.includes("auth") || r.keywords.includes("auth") || r.description.toLowerCase().includes("auth"),
        ),
      ).toBe(true)
    })

    it("filters by category", () => {
      const results = marketplace.search({ category: "payments" })
      expect(results.every((r) => r.category === "payments")).toBe(true)
    })

    it("filters by verified", () => {
      const results = marketplace.search({ verified: true })
      expect(results.every((r) => r.verified)).toBe(true)
    })

    it("respects limit", () => {
      const results = marketplace.search({ limit: 3 })
      expect(results).toHaveLength(3)
    })
  })

  describe("getCategories", () => {
    it("returns categories with counts", () => {
      const categories = marketplace.getCategories()
      expect(categories.length).toBeGreaterThan(0)
      for (const cat of categories) {
        expect(cat.count).toBeGreaterThan(0)
      }
    })
  })

  describe("installation", () => {
    it("installs a plugin", async () => {
      const instance = await marketplace.install(testPlugin)
      expect(instance.status).toBe("installed")
      expect(marketplace.installedCount).toBe(1)
    })

    it("throws on duplicate install", async () => {
      await marketplace.install(testPlugin)
      await expect(marketplace.install(testPlugin)).rejects.toThrow(PluginMarketplaceError)
    })

    it("validates config on install", async () => {
      await expect(marketplace.install(pluginWithConfig, {})).rejects.toThrow("Missing required config")
    })

    it("accepts valid config", async () => {
      const instance = await marketplace.install(pluginWithConfig, { apiKey: "key-123" })
      expect(instance.config.apiKey).toBe("key-123")
      expect(instance.config.maxRetries).toBe(3) // default
    })

    it("calls onInstall hook", async () => {
      let called = false
      const plugin: PluginV2Definition = {
        ...testPlugin,
        name: "hook-plugin",
        onInstall: () => {
          called = true
        },
      }
      await marketplace.install(plugin)
      expect(called).toBe(true)
    })

    it("checks dependencies", async () => {
      const dependent: PluginV2Definition = {
        ...testPlugin,
        name: "dependent-plugin",
        dependencies: ["missing-plugin"],
      }
      await expect(marketplace.install(dependent)).rejects.toThrow("Missing dependency")
    })
  })

  describe("lifecycle", () => {
    it("starts a plugin", async () => {
      let started = false
      const plugin: PluginV2Definition = {
        ...testPlugin,
        onStart: () => {
          started = true
        },
      }
      await marketplace.install(plugin)
      await marketplace.start("test-plugin")
      expect(started).toBe(true)
      expect(marketplace.getPlugin("test-plugin")!.status).toBe("started")
    })

    it("stops a plugin", async () => {
      let stopped = false
      const plugin: PluginV2Definition = {
        ...testPlugin,
        onStop: () => {
          stopped = true
        },
      }
      await marketplace.install(plugin)
      await marketplace.start("test-plugin")
      await marketplace.stop("test-plugin")
      expect(stopped).toBe(true)
    })

    it("uninstalls a plugin", async () => {
      await marketplace.install(testPlugin)
      await marketplace.uninstall("test-plugin")
      expect(marketplace.isInstalled("test-plugin")).toBe(false)
    })

    it("prevents uninstalling plugin with dependents", async () => {
      await marketplace.install(testPlugin)
      const dependent: PluginV2Definition = {
        ...testPlugin,
        name: "dep-plugin",
        dependencies: ["test-plugin"],
      }
      await marketplace.install(dependent)
      await expect(marketplace.uninstall("test-plugin")).rejects.toThrow("depends on it")
    })
  })

  describe("access", () => {
    it("lists installed plugins", async () => {
      await marketplace.install(testPlugin)
      const installed = marketplace.listInstalled()
      expect(installed).toHaveLength(1)
    })

    it("checks if installed", async () => {
      expect(marketplace.isInstalled("test-plugin")).toBe(false)
      await marketplace.install(testPlugin)
      expect(marketplace.isInstalled("test-plugin")).toBe(true)
    })
  })
})

describe("validatePluginConfig", () => {
  const schema = {
    apiKey: { type: "string" as const, required: true },
    port: { type: "number" as const, required: false, default: 3000 },
    mode: { type: "string" as const, enum: ["dev", "prod"] },
  }

  it("validates valid config", () => {
    const result = validatePluginConfig(schema, { apiKey: "key", mode: "dev" })
    expect(result.valid).toBe(true)
  })

  it("reports missing required fields", () => {
    const result = validatePluginConfig(schema, {})
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("Missing required config: apiKey")
  })

  it("reports type mismatches", () => {
    const result = validatePluginConfig(schema, { apiKey: 123 })
    expect(result.valid).toBe(false)
  })

  it("reports enum violations", () => {
    const result = validatePluginConfig(schema, { apiKey: "key", mode: "test" })
    expect(result.valid).toBe(false)
  })
})

describe("MARKETPLACE_CATALOG", () => {
  it("has 10 first-party plugins", () => {
    expect(MARKETPLACE_CATALOG).toHaveLength(10)
  })

  it("all entries have required fields", () => {
    for (const entry of MARKETPLACE_CATALOG) {
      expect(entry.name).toBeTruthy()
      expect(entry.description).toBeTruthy()
      expect(entry.npmPackage).toBeTruthy()
      expect(entry.category).toBeTruthy()
    }
  })

  it("covers multiple categories", () => {
    const categories = new Set(MARKETPLACE_CATALOG.map((e) => e.category))
    expect(categories.size).toBeGreaterThanOrEqual(5)
  })
})
