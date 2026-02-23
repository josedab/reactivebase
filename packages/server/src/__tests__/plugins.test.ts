import { describe, it, expect, vi } from "vitest"
import { definePlugin, PluginRegistry, type PluginContext } from "../plugins/plugins.js"

function createMockContext(): PluginContext & {
  middlewares: unknown[]
  authProviders: unknown[]
  functions: Record<string, unknown>
  webhooks: unknown[]
} {
  const ctx = {
    middlewares: [] as unknown[],
    authProviders: [] as unknown[],
    functions: {} as Record<string, unknown>,
    webhooks: [] as unknown[],
    config: {},
    useMiddleware(mw: unknown) {
      ctx.middlewares.push(mw)
    },
    useAuth(provider: unknown) {
      ctx.authProviders.push(provider)
    },
    useFunctions(fns: Record<string, unknown>) {
      Object.assign(ctx.functions, fns)
    },
    useWebhook(wh: unknown) {
      ctx.webhooks.push(wh)
    },
  }
  return ctx
}

describe("definePlugin", () => {
  it("creates a plugin definition", () => {
    const plugin = definePlugin({
      name: "test-plugin",
      version: "1.0.0",
      description: "A test plugin",
    })

    expect(plugin.name).toBe("test-plugin")
    expect(plugin.version).toBe("1.0.0")
  })
})

describe("PluginRegistry", () => {
  it("installs and retrieves plugins", async () => {
    const registry = new PluginRegistry()
    const ctx = createMockContext()

    const plugin = definePlugin({ name: "test" })
    await registry.install(plugin, ctx)

    expect(registry.get("test")).toBeDefined()
    expect(registry.size).toBe(1)
  })

  it("prevents duplicate plugin installation", async () => {
    const registry = new PluginRegistry()
    const ctx = createMockContext()

    const plugin = definePlugin({ name: "test" })
    await registry.install(plugin, ctx)

    await expect(registry.install(plugin, ctx)).rejects.toThrow("already installed")
  })

  it("registers middleware from plugin", async () => {
    const registry = new PluginRegistry()
    const ctx = createMockContext()

    const plugin = definePlugin({
      name: "logging",
      middleware: [{ name: "logger", before: () => {} }],
    })

    await registry.install(plugin, ctx)
    expect(ctx.middlewares).toHaveLength(1)
  })

  it("registers auth providers from plugin", async () => {
    const registry = new PluginRegistry()
    const ctx = createMockContext()

    const plugin = definePlugin({
      name: "auth-plugin",
      authProviders: [{ verify: async () => ({ userId: "u1", claims: {} }) }],
    })

    await registry.install(plugin, ctx)
    expect(ctx.authProviders).toHaveLength(1)
  })

  it("registers webhooks from plugin", async () => {
    const registry = new PluginRegistry()
    const ctx = createMockContext()

    const plugin = definePlugin({
      name: "stripe-test",
      webhooks: [
        {
          name: "stripe",
          handler: async () => ({}),
        },
      ],
    })

    await registry.install(plugin, ctx)
    expect(ctx.webhooks).toHaveLength(1)
  })

  it("runs setup function", async () => {
    const registry = new PluginRegistry()
    const ctx = createMockContext()
    const setupCalled = vi.fn()

    const plugin = definePlugin({
      name: "custom",
      setup: setupCalled,
    })

    await registry.install(plugin, ctx)
    expect(setupCalled).toHaveBeenCalledWith(ctx)
  })

  it("runs lifecycle hooks", async () => {
    const registry = new PluginRegistry()
    const ctx = createMockContext()
    const started = vi.fn()
    const stopped = vi.fn()

    await registry.install(
      definePlugin({
        name: "lifecycle",
        onStart: started,
        onStop: stopped,
      }),
      ctx,
    )

    await registry.onStart()
    expect(started).toHaveBeenCalled()

    await registry.onStop()
    expect(stopped).toHaveBeenCalled()
  })

  it("lists installed plugins", async () => {
    const registry = new PluginRegistry()
    const ctx = createMockContext()

    await registry.install(definePlugin({ name: "a", version: "1.0" }), ctx)
    await registry.install(definePlugin({ name: "b", version: "2.0" }), ctx)

    const list = registry.list()
    expect(list).toHaveLength(2)
    expect(list[0].name).toBe("a")
    expect(list[1].name).toBe("b")
  })
})
