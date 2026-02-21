/**
 * Plugin system for ReactiveBase.
 * Provides a standardized API for extending the framework with
 * auth providers, webhooks, storage backends, and middleware.
 */

import type { Middleware } from "../middleware/index.js"
import type { AuthProvider } from "../auth/index.js"
import type { RegisteredFunction } from "../functions/index.js"
import type { WebhookDefinition } from "../webhooks/index.js"
import type { StorageBackend } from "../storage/index.js"

export interface PluginDefinition {
  /** Unique plugin name */
  name: string
  /** Plugin version */
  version?: string
  /** Description */
  description?: string

  /** Middleware to register */
  middleware?: Middleware[]
  /** Auth providers to register */
  authProviders?: AuthProvider[]
  /** Server functions to register */
  functions?: Record<string, RegisteredFunction>
  /** Webhook handlers to register */
  webhooks?: WebhookDefinition[]
  /** Storage backend to use */
  storageBackend?: StorageBackend

  /** Called when the plugin is installed */
  setup?: (context: PluginContext) => Promise<void> | void
  /** Called when the server starts */
  onStart?: () => Promise<void> | void
  /** Called when the server stops */
  onStop?: () => Promise<void> | void
}

export interface PluginContext {
  /** Register a middleware */
  useMiddleware(middleware: Middleware): void
  /** Register an auth provider */
  useAuth(provider: AuthProvider): void
  /** Register server functions */
  useFunctions(functions: Record<string, RegisteredFunction>): void
  /** Register webhooks */
  useWebhook(webhook: WebhookDefinition): void
  /** Access server config */
  config: Record<string, unknown>
}

/**
 * Define a ReactiveBase plugin.
 */
export function definePlugin(definition: PluginDefinition): PluginDefinition {
  return definition
}

/**
 * Plugin registry — manages installed plugins.
 */
export class PluginRegistry {
  private plugins = new Map<string, PluginDefinition>()
  private startHooks: Array<() => Promise<void> | void> = []
  private stopHooks: Array<() => Promise<void> | void> = []

  /**
   * Install a plugin.
   */
  async install(plugin: PluginDefinition, context: PluginContext): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already installed`)
    }

    // Register middleware
    if (plugin.middleware) {
      for (const mw of plugin.middleware) context.useMiddleware(mw)
    }

    // Register auth providers
    if (plugin.authProviders) {
      for (const provider of plugin.authProviders) context.useAuth(provider)
    }

    // Register functions
    if (plugin.functions) {
      context.useFunctions(plugin.functions)
    }

    // Register webhooks
    if (plugin.webhooks) {
      for (const webhook of plugin.webhooks) context.useWebhook(webhook)
    }

    // Run setup
    if (plugin.setup) {
      await plugin.setup(context)
    }

    // Track lifecycle hooks
    if (plugin.onStart) this.startHooks.push(plugin.onStart)
    if (plugin.onStop) this.stopHooks.push(plugin.onStop)

    this.plugins.set(plugin.name, plugin)
  }

  /**
   * Get an installed plugin.
   */
  get(name: string): PluginDefinition | undefined {
    return this.plugins.get(name)
  }

  /**
   * Run all plugin start hooks.
   */
  async onStart(): Promise<void> {
    for (const hook of this.startHooks) await hook()
  }

  /**
   * Run all plugin stop hooks.
   */
  async onStop(): Promise<void> {
    for (const hook of this.stopHooks) await hook()
  }

  /**
   * List installed plugins.
   */
  list(): Array<{ name: string; version?: string; description?: string }> {
    return Array.from(this.plugins.values()).map((p) => ({
      name: p.name,
      version: p.version,
      description: p.description,
    }))
  }

  get size(): number {
    return this.plugins.size
  }
}

// --- First-party Plugin Templates ---

/**
 * Create a Clerk auth plugin.
 */
export function clerkPlugin(options: { secretKey: string; publishableKey?: string }): PluginDefinition {
  return definePlugin({
    name: "clerk",
    version: "0.1.0",
    description: "Clerk authentication for ReactiveBase",
    authProviders: [
      {
        name: "clerk",
        async verify(token: string) {
          const response = await fetch("https://api.clerk.com/v1/tokens/verify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${options.secretKey}`,
            },
            body: JSON.stringify({ token }),
          })

          if (!response.ok) throw new Error("Clerk token verification failed")
          const data = (await response.json()) as { sub: string; [k: string]: unknown }
          return { userId: data.sub, claims: data }
        },
      },
    ],
  })
}

/**
 * Create a Stripe webhook plugin.
 */
export function stripePlugin(options: {
  webhookSecret: string
  onEvent?: (event: { type: string; data: unknown }) => Promise<string[]>
}): PluginDefinition {
  return definePlugin({
    name: "stripe",
    version: "0.1.0",
    description: "Stripe webhook integration for ReactiveBase",
    webhooks: [
      {
        name: "stripe",
        secret: options.webhookSecret,
        signatureHeader: "stripe-signature",
        async handler(payload) {
          const event = payload as { type: string; data: unknown }
          const tables = options.onEvent
            ? await options.onEvent(event)
            : []
          return { invalidateTables: tables }
        },
      },
    ],
  })
}

/**
 * Plugin manifest format for plugin discovery/registry.
 */
export interface PluginManifest {
  name: string
  version: string
  description: string
  author?: string
  homepage?: string
  repository?: string
  keywords?: string[]
  peerDependencies?: Record<string, string>
}
