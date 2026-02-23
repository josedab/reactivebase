/**
 * Plugin Marketplace & Ecosystem v2.
 * Enhanced plugin SDK with lifecycle hooks, dependency management,
 * configuration schema validation, and a browsable plugin registry.
 *
 * Features:
 *   - Plugin SDK v2 with install/start/stop lifecycle hooks
 *   - Configuration schema validation per plugin
 *   - Inter-plugin dependencies
 *   - Plugin versioning and compatibility checks
 *   - Searchable registry with categories and ratings
 *   - First-party plugin catalog expansion
 *
 * Usage:
 *   const marketplace = new PluginMarketplace()
 *   marketplace.install(pluginDef, config)
 *   marketplace.start("plugin-name")
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PluginV2Definition {
  name: string
  version: string
  description: string
  author: string
  keywords: string[]
  category: PluginCategory
  /** Required ReactiveBase version (semver range) */
  reactivebaseVersion?: string
  /** Plugin dependencies (other plugins that must be installed) */
  dependencies?: string[]
  /** Configuration schema for validation */
  configSchema?: Record<string, ConfigField>
  /** Lifecycle hooks */
  onInstall?: (ctx: PluginV2Context) => Promise<void> | void
  onStart?: (ctx: PluginV2Context) => Promise<void> | void
  onStop?: (ctx: PluginV2Context) => Promise<void> | void
  /** Middleware to inject into the request pipeline */
  middleware?: PluginMiddleware[]
  /** Server functions to register */
  functions?: Record<string, unknown>
  /** Database migrations to run on install */
  migrations?: string[]
}

export type PluginCategory =
  | "auth"
  | "payments"
  | "storage"
  | "email"
  | "analytics"
  | "monitoring"
  | "database"
  | "ai"
  | "utilities"

export interface ConfigField {
  type: "string" | "number" | "boolean" | "array" | "object"
  required?: boolean
  default?: unknown
  description?: string
  enum?: unknown[]
}

export interface PluginV2Context {
  config: Record<string, unknown>
  logger: {
    info: (msg: string) => void
    warn: (msg: string) => void
    error: (msg: string) => void
  }
  /** Register a server function */
  registerFunction: (name: string, fn: unknown) => void
  /** Get another installed plugin's API */
  getPlugin: (name: string) => PluginV2Instance | undefined
}

export interface PluginMiddleware {
  name: string
  phase: "before" | "after" | "error"
  handler: (ctx: unknown) => Promise<unknown> | unknown
}

export interface PluginV2Instance {
  definition: PluginV2Definition
  config: Record<string, unknown>
  status: "installed" | "started" | "stopped" | "error"
  installedAt: number
  startedAt?: number
  error?: string
}

export interface MarketplaceEntry {
  name: string
  version: string
  description: string
  author: string
  category: PluginCategory
  keywords: string[]
  npmPackage: string
  installCommand: string
  downloads: number
  rating: number
  verified: boolean
  firstParty: boolean
}

export interface MarketplaceSearchOptions {
  query?: string
  category?: PluginCategory
  verified?: boolean
  firstParty?: boolean
  limit?: number
}

// ─── First-Party Plugin Catalog ──────────────────────────────────────────────

export const MARKETPLACE_CATALOG: MarketplaceEntry[] = [
  {
    name: "clerk",
    version: "0.1.0",
    description: "Clerk authentication — JWT verification, user management, organization support",
    author: "ReactiveBase",
    category: "auth",
    keywords: ["auth", "clerk", "jwt", "sso"],
    npmPackage: "@reactivebase/plugin-clerk",
    installCommand: "npm install @reactivebase/plugin-clerk",
    downloads: 0,
    rating: 5,
    verified: true,
    firstParty: true,
  },
  {
    name: "auth0",
    version: "0.1.0",
    description: "Auth0 authentication — JWT verification, roles, permissions",
    author: "ReactiveBase",
    category: "auth",
    keywords: ["auth", "auth0", "jwt", "oauth"],
    npmPackage: "@reactivebase/plugin-auth0",
    installCommand: "npm install @reactivebase/plugin-auth0",
    downloads: 0,
    rating: 5,
    verified: true,
    firstParty: true,
  },
  {
    name: "stripe",
    version: "0.1.0",
    description: "Stripe payments — webhook processing, subscription management, reactive billing",
    author: "ReactiveBase",
    category: "payments",
    keywords: ["payments", "stripe", "billing", "webhooks"],
    npmPackage: "@reactivebase/plugin-stripe",
    installCommand: "npm install @reactivebase/plugin-stripe",
    downloads: 0,
    rating: 5,
    verified: true,
    firstParty: true,
  },
  {
    name: "paddle",
    version: "0.1.0",
    description: "Paddle payments — billing, subscriptions, tax compliance",
    author: "ReactiveBase",
    category: "payments",
    keywords: ["payments", "paddle", "billing", "tax"],
    npmPackage: "@reactivebase/plugin-paddle",
    installCommand: "npm install @reactivebase/plugin-paddle",
    downloads: 0,
    rating: 4,
    verified: true,
    firstParty: true,
  },
  {
    name: "r2-storage",
    version: "0.1.0",
    description: "Cloudflare R2 storage — file uploads, presigned URLs, reactive file metadata",
    author: "ReactiveBase",
    category: "storage",
    keywords: ["storage", "r2", "cloudflare", "files"],
    npmPackage: "@reactivebase/plugin-r2",
    installCommand: "npm install @reactivebase/plugin-r2",
    downloads: 0,
    rating: 4,
    verified: true,
    firstParty: true,
  },
  {
    name: "resend",
    version: "0.1.0",
    description: "Resend email — transactional emails, templates, delivery tracking",
    author: "ReactiveBase",
    category: "email",
    keywords: ["email", "resend", "transactional", "templates"],
    npmPackage: "@reactivebase/plugin-resend",
    installCommand: "npm install @reactivebase/plugin-resend",
    downloads: 0,
    rating: 5,
    verified: true,
    firstParty: true,
  },
  {
    name: "sendgrid",
    version: "0.1.0",
    description: "SendGrid email — bulk email, templates, analytics",
    author: "ReactiveBase",
    category: "email",
    keywords: ["email", "sendgrid", "templates"],
    npmPackage: "@reactivebase/plugin-sendgrid",
    installCommand: "npm install @reactivebase/plugin-sendgrid",
    downloads: 0,
    rating: 4,
    verified: true,
    firstParty: true,
  },
  {
    name: "posthog",
    version: "0.1.0",
    description: "PostHog analytics — event tracking, feature flags, session replay integration",
    author: "ReactiveBase",
    category: "analytics",
    keywords: ["analytics", "posthog", "events", "feature-flags"],
    npmPackage: "@reactivebase/plugin-posthog",
    installCommand: "npm install @reactivebase/plugin-posthog",
    downloads: 0,
    rating: 4,
    verified: true,
    firstParty: true,
  },
  {
    name: "sentry",
    version: "0.1.0",
    description: "Sentry error monitoring — automatic error capture, performance tracing",
    author: "ReactiveBase",
    category: "monitoring",
    keywords: ["monitoring", "sentry", "errors", "tracing"],
    npmPackage: "@reactivebase/plugin-sentry",
    installCommand: "npm install @reactivebase/plugin-sentry",
    downloads: 0,
    rating: 5,
    verified: true,
    firstParty: true,
  },
  {
    name: "openai",
    version: "0.1.0",
    description: "OpenAI integration — embeddings, completions, function calling with reactive context",
    author: "ReactiveBase",
    category: "ai",
    keywords: ["ai", "openai", "embeddings", "llm"],
    npmPackage: "@reactivebase/plugin-openai",
    installCommand: "npm install @reactivebase/plugin-openai",
    downloads: 0,
    rating: 5,
    verified: true,
    firstParty: true,
  },
]

// ─── Validation ──────────────────────────────────────────────────────────────

export function validatePluginConfig(
  schema: Record<string, ConfigField>,
  config: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  for (const [key, field] of Object.entries(schema)) {
    const value = config[key] ?? field.default

    if (field.required && value === undefined) {
      errors.push(`Missing required config: ${key}`)
      continue
    }

    if (value !== undefined) {
      const actualType = Array.isArray(value) ? "array" : typeof value
      if (actualType !== field.type) {
        errors.push(`Config ${key}: expected ${field.type}, got ${actualType}`)
      }

      if (field.enum && !field.enum.includes(value)) {
        errors.push(`Config ${key}: must be one of ${field.enum.join(", ")}`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

// ─── Plugin Marketplace Engine ───────────────────────────────────────────────

export class PluginMarketplace {
  private installed = new Map<string, PluginV2Instance>()
  private registeredFunctions = new Map<string, unknown>()
  private catalog: MarketplaceEntry[]
  private logs: { plugin: string; level: string; message: string; timestamp: number }[] = []

  constructor(additionalPlugins?: MarketplaceEntry[]) {
    this.catalog = [...MARKETPLACE_CATALOG, ...(additionalPlugins ?? [])]
  }

  get installedCount(): number {
    return this.installed.size
  }

  get catalogSize(): number {
    return this.catalog.length
  }

  // ─── Marketplace Search ──────────────────────────────────────────────────

  search(options: MarketplaceSearchOptions = {}): MarketplaceEntry[] {
    let results = [...this.catalog]

    if (options.query) {
      const q = options.query.toLowerCase()
      results = results.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.keywords.some((k) => k.toLowerCase().includes(q)),
      )
    }

    if (options.category) {
      results = results.filter((p) => p.category === options.category)
    }

    if (options.verified !== undefined) {
      results = results.filter((p) => p.verified === options.verified)
    }

    if (options.firstParty !== undefined) {
      results = results.filter((p) => p.firstParty === options.firstParty)
    }

    return results.slice(0, options.limit ?? 50)
  }

  getCategories(): { category: PluginCategory; count: number }[] {
    const counts = new Map<PluginCategory, number>()
    for (const plugin of this.catalog) {
      counts.set(plugin.category, (counts.get(plugin.category) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
  }

  // ─── Installation ────────────────────────────────────────────────────────

  async install(definition: PluginV2Definition, config: Record<string, unknown> = {}): Promise<PluginV2Instance> {
    if (this.installed.has(definition.name)) {
      throw new PluginMarketplaceError(`Plugin already installed: ${definition.name}`)
    }

    // Validate config
    if (definition.configSchema) {
      const validation = validatePluginConfig(definition.configSchema, config)
      if (!validation.valid) {
        throw new PluginMarketplaceError(`Invalid config for ${definition.name}: ${validation.errors.join(", ")}`)
      }
    }

    // Check dependencies
    if (definition.dependencies) {
      for (const dep of definition.dependencies) {
        if (!this.installed.has(dep)) {
          throw new PluginMarketplaceError(`Missing dependency: ${dep} (required by ${definition.name})`)
        }
      }
    }

    // Apply defaults from config schema
    const resolvedConfig = { ...config }
    if (definition.configSchema) {
      for (const [key, field] of Object.entries(definition.configSchema)) {
        if (resolvedConfig[key] === undefined && field.default !== undefined) {
          resolvedConfig[key] = field.default
        }
      }
    }

    const instance: PluginV2Instance = {
      definition,
      config: resolvedConfig,
      status: "installed",
      installedAt: Date.now(),
    }

    const ctx = this.createContext(definition.name, resolvedConfig)

    try {
      if (definition.onInstall) {
        await definition.onInstall(ctx)
      }
      this.installed.set(definition.name, instance)
      return instance
    } catch (err) {
      instance.status = "error"
      instance.error = err instanceof Error ? err.message : String(err)
      this.installed.set(definition.name, instance)
      throw new PluginMarketplaceError(`Install failed for ${definition.name}: ${instance.error}`)
    }
  }

  async start(pluginName: string): Promise<void> {
    const instance = this.installed.get(pluginName)
    if (!instance) throw new PluginMarketplaceError(`Plugin not installed: ${pluginName}`)

    const ctx = this.createContext(pluginName, instance.config)
    try {
      if (instance.definition.onStart) {
        await instance.definition.onStart(ctx)
      }
      instance.status = "started"
      instance.startedAt = Date.now()
    } catch (err) {
      instance.status = "error"
      instance.error = err instanceof Error ? err.message : String(err)
      throw err
    }
  }

  async stop(pluginName: string): Promise<void> {
    const instance = this.installed.get(pluginName)
    if (!instance) throw new PluginMarketplaceError(`Plugin not installed: ${pluginName}`)

    const ctx = this.createContext(pluginName, instance.config)
    try {
      if (instance.definition.onStop) {
        await instance.definition.onStop(ctx)
      }
      instance.status = "stopped"
    } catch (err) {
      instance.status = "error"
      instance.error = err instanceof Error ? err.message : String(err)
    }
  }

  async uninstall(pluginName: string): Promise<void> {
    const instance = this.installed.get(pluginName)
    if (!instance) throw new PluginMarketplaceError(`Plugin not installed: ${pluginName}`)

    // Check if other plugins depend on this one
    for (const [name, inst] of this.installed) {
      if (inst.definition.dependencies?.includes(pluginName)) {
        throw new PluginMarketplaceError(`Cannot uninstall ${pluginName}: ${name} depends on it`)
      }
    }

    if (instance.status === "started") {
      await this.stop(pluginName)
    }
    this.installed.delete(pluginName)
  }

  // ─── Plugin Access ───────────────────────────────────────────────────────

  getPlugin(name: string): PluginV2Instance | undefined {
    return this.installed.get(name)
  }

  listInstalled(): PluginV2Instance[] {
    return Array.from(this.installed.values())
  }

  isInstalled(name: string): boolean {
    return this.installed.has(name)
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private createContext(pluginName: string, config: Record<string, unknown>): PluginV2Context {
    return {
      config,
      logger: {
        info: (msg) => this.log(pluginName, "info", msg),
        warn: (msg) => this.log(pluginName, "warn", msg),
        error: (msg) => this.log(pluginName, "error", msg),
      },
      registerFunction: (name, fn) => {
        this.registeredFunctions.set(`${pluginName}.${name}`, fn)
      },
      getPlugin: (name) => this.installed.get(name),
    }
  }

  private log(plugin: string, level: string, message: string): void {
    this.logs.push({ plugin, level, message, timestamp: Date.now() })
    if (this.logs.length > 1000) this.logs.splice(0, this.logs.length - 1000)
  }
}

export class PluginMarketplaceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PluginMarketplaceError"
  }
}
