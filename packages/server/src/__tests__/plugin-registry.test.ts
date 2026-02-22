import { describe, it, expect } from "vitest"
import { PluginRegistryClient, BUILTIN_PLUGINS } from "../plugins/registry.js"

describe("PluginRegistryClient", () => {
  it("lists all built-in plugins", () => {
    const registry = new PluginRegistryClient()
    const plugins = registry.list()
    expect(plugins.length).toBe(BUILTIN_PLUGINS.length)
    expect(plugins.length).toBeGreaterThanOrEqual(5)
  })

  it("searches plugins by name", () => {
    const registry = new PluginRegistryClient()
    const results = registry.search("clerk")
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe("clerk")
  })

  it("searches plugins by keyword", () => {
    const registry = new PluginRegistryClient()
    const results = registry.search("auth")
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  it("searches plugins by description", () => {
    const registry = new PluginRegistryClient()
    const results = registry.search("email")
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0].name).toBe("resend")
  })

  it("gets a specific plugin", () => {
    const registry = new PluginRegistryClient()
    const plugin = registry.get("stripe")
    expect(plugin).toBeDefined()
    expect(plugin!.npmPackage).toBe("@reactivebase/plugin-stripe")
  })

  it("returns undefined for unknown plugins", () => {
    const registry = new PluginRegistryClient()
    expect(registry.get("nonexistent")).toBeUndefined()
  })

  it("generates install commands", () => {
    const registry = new PluginRegistryClient()
    const cmd = registry.getInstallCommand("clerk")
    expect(cmd).toBe("npm install @reactivebase/plugin-clerk")
  })

  it("exports registry as JSON", () => {
    const registry = new PluginRegistryClient()
    const json = registry.toJSON()
    const parsed = JSON.parse(json)
    expect(parsed.plugins.length).toBeGreaterThanOrEqual(5)
    expect(parsed.generatedAt).toBeDefined()
  })

  it("all built-in plugins are verified", () => {
    for (const p of BUILTIN_PLUGINS) {
      expect(p.verified).toBe(true)
      expect(p.npmPackage).toContain("@reactivebase/")
    }
  })
})
