import { describe, it, expect, beforeEach } from "vitest"
import { PluginSDK, PluginTestHarness, validateWithJSONSchema } from "../plugins/plugin-sdk-v2.js"
import type { PluginV2Config, PluginHook, HookContext, JSONSchema } from "../plugins/plugin-sdk-v2.js"
import type { PluginV2Definition } from "../plugins/marketplace.js"
import { s3StoragePlugin, posthogPlugin, ALL_BUILTIN_PLUGINS } from "../plugins/builtin-plugins.js"
import { PluginCLI } from "../plugins/plugin-cli.js"

// ─── PluginSDK ───────────────────────────────────────────────────────────────

describe("PluginSDK", () => {
  let sdk: PluginSDK

  beforeEach(() => {
    sdk = new PluginSDK()
  })

  it("creates a plugin definition from config", () => {
    const config: PluginV2Config = {
      name: "test-plugin",
      version: "1.0.0",
      description: "A test plugin",
      author: "Test",
      category: "utilities",
      keywords: ["test"],
    }

    const def = sdk.createPlugin(config)
    expect(def.name).toBe("test-plugin")
    expect(def.version).toBe("1.0.0")
    expect(def.category).toBe("utilities")
    expect(def.author).toBe("Test")
  })

  it("wires onQuery into before-query middleware", () => {
    const config: PluginV2Config = {
      name: "query-plugin",
      version: "1.0.0",
      description: "Query hooks",
      author: "Test",
      category: "utilities",
      onQuery: (ctx) => ({ ...ctx, meta: { ...ctx.meta, queried: true } }),
    }

    const def = sdk.createPlugin(config)
    expect(def.middleware).toBeDefined()
    expect(def.middleware!.some((m) => m.name === "query-plugin-before-query")).toBe(true)
  })

  it("wires onMutation into before-mutation middleware", () => {
    const config: PluginV2Config = {
      name: "mutation-plugin",
      version: "1.0.0",
      description: "Mutation hooks",
      author: "Test",
      category: "utilities",
      onMutation: (ctx) => ({ ...ctx, meta: { ...ctx.meta, mutated: true } }),
    }

    const def = sdk.createPlugin(config)
    expect(def.middleware!.some((m) => m.name === "mutation-plugin-before-mutation")).toBe(true)
  })

  it("wires onRequest into both query and mutation middleware", () => {
    const config: PluginV2Config = {
      name: "request-plugin",
      version: "1.0.0",
      description: "Request hooks",
      author: "Test",
      category: "utilities",
      onRequest: (ctx) => ctx,
    }

    const def = sdk.createPlugin(config)
    expect(def.middleware!.some((m) => m.name === "request-plugin-before-query")).toBe(true)
  })

  it("includes explicit hooks in middleware", () => {
    const hooks: PluginHook[] = [{ type: "on-error", handler: (ctx) => ctx }]

    const config: PluginV2Config = {
      name: "hook-plugin",
      version: "1.0.0",
      description: "Hook plugin",
      author: "Test",
      category: "utilities",
      hooks,
    }

    const def = sdk.createPlugin(config)
    expect(def.middleware!.some((m) => m.phase === "error")).toBe(true)
  })

  it("preserves lifecycle hooks in the definition", () => {
    let installed = false
    let started = false
    let stopped = false

    const config: PluginV2Config = {
      name: "lifecycle-plugin",
      version: "1.0.0",
      description: "Lifecycle test",
      author: "Test",
      category: "utilities",
      onInstall: () => {
        installed = true
      },
      onStart: () => {
        started = true
      },
      onStop: () => {
        stopped = true
      },
    }

    const def = sdk.createPlugin(config)
    expect(def.onInstall).toBeDefined()
    expect(def.onStart).toBeDefined()
    expect(def.onStop).toBeDefined()
  })

  it("supports useMiddleware", () => {
    sdk.useMiddleware({ name: "custom-mw", phase: "before", handler: (ctx) => ctx })

    const def = sdk.createPlugin({
      name: "mw-test",
      version: "1.0.0",
      description: "MW test",
      author: "Test",
      category: "utilities",
    })

    expect(def.middleware!.some((m) => m.name === "custom-mw")).toBe(true)
  })

  it("supports useBeforeQuery and useAfterMutation", () => {
    sdk.useBeforeQuery((ctx) => ({ ...ctx, meta: { before: true } }))
    sdk.useAfterMutation((ctx) => ({ ...ctx, meta: { after: true } }))

    const hooks = sdk.getHooks()
    expect(hooks.some((h) => h.type === "before-query")).toBe(true)
    expect(hooks.some((h) => h.type === "after-mutation")).toBe(true)
  })

  it("supports extendContext", () => {
    const ext = sdk.extendContext("my-plugin", { analytics: "AnalyticsClient" })
    expect(ext.pluginName).toBe("my-plugin")
    expect(ext.types.analytics).toBe("AnalyticsClient")
    expect(sdk.getContextExtensions()).toHaveLength(1)
  })

  it("supports extendSchema", () => {
    const ext = sdk.extendSchema("my-plugin", {
      plugin_events: { id: "text", event_type: "text", payload: "jsonb" },
    })
    expect(ext.pluginName).toBe("my-plugin")
    expect(ext.tables.plugin_events).toBeDefined()
    expect(sdk.getSchemaExtensions()).toHaveLength(1)
  })
})

// ─── JSON Schema Validation ──────────────────────────────────────────────────

describe("validateWithJSONSchema", () => {
  const schema: JSONSchema = {
    type: "object",
    properties: {
      apiKey: { type: "string", minLength: 1 },
      port: { type: "number", minimum: 1, maximum: 65535 },
      enabled: { type: "boolean" },
      tags: { type: "array" },
    },
    required: ["apiKey"],
  }

  it("passes valid config", () => {
    const result = validateWithJSONSchema(schema, { apiKey: "abc123", port: 3000, enabled: true })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it("fails on missing required field", () => {
    const result = validateWithJSONSchema(schema, { port: 3000 })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("Missing required field: apiKey")
  })

  it("fails on wrong type", () => {
    const result = validateWithJSONSchema(schema, { apiKey: 123 as unknown as string })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("expected string"))).toBe(true)
  })

  it("fails on number out of range", () => {
    const result = validateWithJSONSchema(schema, { apiKey: "key", port: 99999 })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("maximum"))).toBe(true)
  })

  it("fails on string too short", () => {
    const result = validateWithJSONSchema(schema, { apiKey: "" })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("minimum length"))).toBe(true)
  })
})

// ─── Config Schema Registration ──────────────────────────────────────────────

describe("PluginSDK config validation", () => {
  it("validates config against registered JSON Schema", () => {
    const sdk = new PluginSDK()
    sdk.registerConfigSchema("my-plugin", {
      type: "object",
      properties: {
        apiKey: { type: "string" },
      },
      required: ["apiKey"],
    })

    const valid = sdk.validateConfig("my-plugin", { apiKey: "abc" })
    expect(valid.valid).toBe(true)

    const invalid = sdk.validateConfig("my-plugin", {})
    expect(invalid.valid).toBe(false)
  })

  it("returns valid for unregistered schemas", () => {
    const sdk = new PluginSDK()
    const result = sdk.validateConfig("unknown", { anything: true })
    expect(result.valid).toBe(true)
  })
})

// ─── PluginTestHarness ───────────────────────────────────────────────────────

describe("PluginTestHarness", () => {
  let harness: PluginTestHarness

  beforeEach(() => {
    harness = new PluginTestHarness()
  })

  it("installs and starts a plugin", async () => {
    const def: PluginV2Definition = {
      name: "harness-test",
      version: "1.0.0",
      description: "Test",
      author: "Test",
      keywords: [],
      category: "utilities",
      onInstall: (ctx) => ctx.logger.info("installed"),
      onStart: (ctx) => ctx.logger.info("started"),
    }

    const instance = await harness.install(def)
    expect(instance.status).toBe("installed")

    await harness.start("harness-test")
    const started = harness.getPlugin("harness-test")
    expect(started?.status).toBe("started")
  })

  it("stops and uninstalls a plugin", async () => {
    const def: PluginV2Definition = {
      name: "remove-test",
      version: "1.0.0",
      description: "Test",
      author: "Test",
      keywords: [],
      category: "utilities",
    }

    await harness.install(def)
    await harness.start("remove-test")
    await harness.stop("remove-test")
    expect(harness.getPlugin("remove-test")?.status).toBe("stopped")

    await harness.uninstall("remove-test")
    expect(harness.getPlugin("remove-test")).toBeUndefined()
  })

  it("lists installed plugins", async () => {
    await harness.install({
      name: "list-test",
      version: "1.0.0",
      description: "Test",
      author: "Test",
      keywords: [],
      category: "utilities",
    })

    const list = harness.listInstalled()
    expect(list.length).toBe(1)
    expect(list[0].definition.name).toBe("list-test")
  })

  it("creates a mock context", () => {
    const ctx = harness.createMockContext({ key: "value" })
    expect(ctx.config.key).toBe("value")

    ctx.logger.info("test message")
    ctx.registerFunction("myFunc", () => 42)

    const logs = harness.getLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0].message).toBe("test message")

    const fns = harness.getRegisteredFunctions()
    expect(fns.has("myFunc")).toBe(true)
  })

  it("executes hooks in pipeline", async () => {
    const hooks: PluginHook[] = [
      {
        type: "before-query",
        handler: (ctx) => ({ ...ctx, meta: { ...ctx.meta, step1: true } }),
      },
      {
        type: "before-query",
        handler: (ctx) => ({ ...ctx, meta: { ...ctx.meta, step2: true } }),
      },
    ]

    const result = await harness.executeHook(hooks, { table: "users" })
    expect(result.meta?.step1).toBe(true)
    expect(result.meta?.step2).toBe(true)
  })

  it("validates plugin config", () => {
    const def: PluginV2Definition = {
      name: "validate-test",
      version: "1.0.0",
      description: "Test",
      author: "Test",
      keywords: [],
      category: "utilities",
      configSchema: {
        apiKey: { type: "string", required: true },
      },
    }

    expect(harness.validateConfig(def, { apiKey: "abc" }).valid).toBe(true)
    expect(harness.validateConfig(def, {}).valid).toBe(false)
  })

  it("resets state", async () => {
    await harness.install({
      name: "reset-test",
      version: "1.0.0",
      description: "Test",
      author: "Test",
      keywords: [],
      category: "utilities",
    })

    harness.reset()
    expect(harness.listInstalled()).toHaveLength(0)
    expect(harness.getLogs()).toHaveLength(0)
  })
})

// ─── Built-in Plugins ────────────────────────────────────────────────────────

describe("Built-in Plugins", () => {
  it("s3StoragePlugin has correct metadata", () => {
    expect(s3StoragePlugin.name).toBe("s3-storage")
    expect(s3StoragePlugin.category).toBe("storage")
    expect(s3StoragePlugin.configSchema?.bucket.required).toBe(true)
    expect(s3StoragePlugin.configSchema?.accessKeyId.required).toBe(true)
  })

  it("posthogPlugin has correct metadata", () => {
    expect(posthogPlugin.name).toBe("posthog")
    expect(posthogPlugin.category).toBe("analytics")
    expect(posthogPlugin.configSchema?.apiKey.required).toBe(true)
    expect(posthogPlugin.configSchema?.enableFeatureFlags?.default).toBe(true)
  })

  it("ALL_BUILTIN_PLUGINS contains all 5 plugins", () => {
    expect(Object.keys(ALL_BUILTIN_PLUGINS)).toHaveLength(5)
    expect(ALL_BUILTIN_PLUGINS.resend).toBeDefined()
    expect(ALL_BUILTIN_PLUGINS.sentry).toBeDefined()
    expect(ALL_BUILTIN_PLUGINS.vercel).toBeDefined()
    expect(ALL_BUILTIN_PLUGINS["s3-storage"]).toBeDefined()
    expect(ALL_BUILTIN_PLUGINS.posthog).toBeDefined()
  })

  it("s3StoragePlugin installs via test harness", async () => {
    const harness = new PluginTestHarness()
    const instance = await harness.install(s3StoragePlugin, {
      bucket: "test-bucket",
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "secret",
    })
    expect(instance.status).toBe("installed")
    expect(instance.config.region).toBe("us-east-1") // default
  })

  it("posthogPlugin installs via test harness", async () => {
    const harness = new PluginTestHarness()
    const instance = await harness.install(posthogPlugin, {
      apiKey: "phc_test_key",
    })
    expect(instance.status).toBe("installed")
    expect(instance.config.host).toBe("https://app.posthog.com") // default
  })
})

// ─── Plugin CLI ──────────────────────────────────────────────────────────────

describe("PluginCLI", () => {
  let cli: PluginCLI

  beforeEach(() => {
    cli = new PluginCLI()
  })

  it("adds a built-in plugin", async () => {
    const result = await cli.add("resend", { apiKey: "test-key" })
    expect(result.success).toBe(true)
    expect(result.message).toContain("resend")
  })

  it("fails to add non-existent plugin", async () => {
    const result = await cli.add("nonexistent-plugin")
    expect(result.success).toBe(false)
    expect(result.message).toContain("not found")
  })

  it("fails to add already installed plugin", async () => {
    await cli.add("sentry", { dsn: "https://test@sentry.io/123" })
    const result = await cli.add("sentry", { dsn: "https://test@sentry.io/123" })
    expect(result.success).toBe(false)
    expect(result.message).toContain("already installed")
  })

  it("removes an installed plugin", async () => {
    const addResult = await cli.add("sentry", { dsn: "https://test@sentry.io/123" })
    expect(addResult.success).toBe(true)
    const result = await cli.remove("sentry")
    expect(result.success).toBe(true)
  })

  it("fails to remove non-installed plugin", async () => {
    const result = await cli.remove("nonexistent")
    expect(result.success).toBe(false)
    expect(result.message).toContain("not installed")
  })

  it("lists installed plugins", async () => {
    await cli.add("resend", { apiKey: "test-key" })
    const result = cli.list()
    expect(result.success).toBe(true)
    expect((result.data as Array<unknown>).length).toBe(1)
  })

  it("lists empty when no plugins installed", () => {
    const result = cli.list()
    expect(result.success).toBe(true)
    expect(result.message).toContain("No plugins installed")
  })

  it("searches the registry", () => {
    const result = cli.search("auth")
    expect(result.success).toBe(true)
    expect((result.data as Array<unknown>).length).toBeGreaterThan(0)
  })

  it("returns empty search for unknown query", () => {
    const result = cli.search("zzz-nonexistent-zzz")
    expect(result.success).toBe(true)
    expect(result.data as Array<unknown>).toHaveLength(0)
  })

  it("shows plugin info with quality score", () => {
    const result = cli.info("stripe")
    expect(result.success).toBe(true)
    const data = result.data as { qualityScore: number; badges: string[] }
    expect(data.qualityScore).toBeGreaterThan(0)
    expect(data.badges).toContain("verified")
  })

  it("fails info for unknown plugin", () => {
    const result = cli.info("nonexistent")
    expect(result.success).toBe(false)
  })

  it("scaffolds a new plugin", () => {
    const result = cli.init("my-analytics", "analytics")
    expect(result.success).toBe(true)
    const data = result.data as { files: string[] }
    expect(data.files).toContain("src/index.ts")
    expect(data.files).toContain("package.json")
  })

  it("generates CLI output for list command", async () => {
    await cli.add("resend", { apiKey: "test-key" })
    const result = cli.list()
    const output = cli.generateCLIOutput("list", result)
    expect(output).toContain("reactivebase plugin list")
    expect(output).toContain("resend")
  })

  it("generates CLI output for info command", () => {
    const result = cli.info("stripe")
    const output = cli.generateCLIOutput("info", result)
    expect(output).toContain("stripe")
    expect(output).toContain("Quality Score")
  })

  it("generates CLI output for search command", () => {
    const result = cli.search("email")
    const output = cli.generateCLIOutput("search", result)
    expect(output).toContain("reactivebase plugin search")
  })

  it("generates CLI output for init command", () => {
    const result = cli.init("test-plugin", "auth")
    const output = cli.generateCLIOutput("init", result)
    expect(output).toContain("Generated files")
  })

  it("supports autoStart config", async () => {
    const autoCli = new PluginCLI({ autoStart: true })
    const result = await autoCli.add("resend", { apiKey: "test-key" })
    expect(result.success).toBe(true)
  })
})
