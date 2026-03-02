/**
 * Plugin SDK v2 for ReactiveBase.
 * Provides a modern plugin authoring API with typed lifecycle hooks,
 * middleware injection, context/schema extension, config validation,
 * and a test harness for plugin authors.
 *
 * Usage:
 *   const sdk = new PluginSDK()
 *   const plugin = sdk.createPlugin({ name: "my-plugin", ... })
 *   const harness = new PluginTestHarness()
 *   await harness.install(plugin)
 */

import type {
  PluginV2Definition,
  PluginV2Context,
  PluginV2Instance,
  PluginCategory,
  ConfigField,
  PluginMiddleware,
} from "./marketplace.js"
import { validatePluginConfig, PluginMarketplace } from "./marketplace.js"

// ─── Hook Types ──────────────────────────────────────────────────────────────

export type PluginHook =
  | { type: "before-query"; handler: (ctx: HookContext) => Promise<HookContext> | HookContext }
  | { type: "after-query"; handler: (ctx: HookContext) => Promise<HookContext> | HookContext }
  | { type: "before-mutation"; handler: (ctx: HookContext) => Promise<HookContext> | HookContext }
  | { type: "after-mutation"; handler: (ctx: HookContext) => Promise<HookContext> | HookContext }
  | { type: "on-error"; handler: (ctx: HookContext & { error: Error }) => Promise<HookContext> | HookContext }
  | { type: "on-connect"; handler: (ctx: HookContext) => Promise<void> | void }
  | { type: "on-disconnect"; handler: (ctx: HookContext) => Promise<void> | void }

export interface HookContext {
  /** Name of the table or resource being operated on */
  table?: string
  /** Operation payload */
  payload?: unknown
  /** Current user / auth info */
  auth?: { userId?: string; claims?: Record<string, unknown> }
  /** Arbitrary metadata */
  meta?: Record<string, unknown>
}

// ─── Plugin V2 Config ────────────────────────────────────────────────────────

export interface PluginV2Config {
  name: string
  version: string
  description: string
  author: string
  keywords?: string[]
  category: PluginCategory
  reactivebaseVersion?: string
  dependencies?: string[]
  configSchema?: Record<string, ConfigField>
  /** Lifecycle hooks */
  onInstall?: (ctx: PluginV2Context) => Promise<void> | void
  onStart?: (ctx: PluginV2Context) => Promise<void> | void
  onStop?: (ctx: PluginV2Context) => Promise<void> | void
  onRequest?: (ctx: HookContext) => Promise<HookContext> | HookContext
  onMutation?: (ctx: HookContext) => Promise<HookContext> | HookContext
  onQuery?: (ctx: HookContext) => Promise<HookContext> | HookContext
  /** Additional typed hooks */
  hooks?: PluginHook[]
  /** Middleware to inject */
  middleware?: PluginMiddleware[]
  /** Server functions */
  functions?: Record<string, unknown>
  /** Database migrations */
  migrations?: string[]
}

// ─── JSON Schema Validation ──────────────────────────────────────────────────

export interface JSONSchemaProperty {
  type: "string" | "number" | "boolean" | "array" | "object" | "integer"
  description?: string
  default?: unknown
  enum?: unknown[]
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  items?: JSONSchemaProperty
  properties?: Record<string, JSONSchemaProperty>
  required?: string[]
}

export interface JSONSchema {
  type: "object"
  properties: Record<string, JSONSchemaProperty>
  required?: string[]
}

/**
 * Validate data against a JSON Schema definition.
 *
 * @param schema - The JSON Schema to validate against
 * @param data - The data object to validate
 * @returns An object with a valid boolean and an array of error messages
 */
export function validateWithJSONSchema(
  schema: JSONSchema,
  data: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Check required fields
  if (schema.required) {
    for (const key of schema.required) {
      if (data[key] === undefined || data[key] === null) {
        errors.push(`Missing required field: ${key}`)
      }
    }
  }

  // Validate each property
  for (const [key, prop] of Object.entries(schema.properties)) {
    const value = data[key]
    if (value === undefined) continue

    const actualType = Array.isArray(value) ? "array" : typeof value
    const expectedType = prop.type === "integer" ? "number" : prop.type
    if (actualType !== expectedType) {
      errors.push(`Field "${key}": expected ${prop.type}, got ${actualType}`)
      continue
    }

    if (prop.enum && !prop.enum.includes(value)) {
      errors.push(`Field "${key}": must be one of [${prop.enum.join(", ")}]`)
    }

    if (prop.type === "string" && typeof value === "string") {
      if (prop.minLength !== undefined && value.length < prop.minLength) {
        errors.push(`Field "${key}": minimum length is ${prop.minLength}`)
      }
      if (prop.maxLength !== undefined && value.length > prop.maxLength) {
        errors.push(`Field "${key}": maximum length is ${prop.maxLength}`)
      }
    }

    if ((prop.type === "number" || prop.type === "integer") && typeof value === "number") {
      if (prop.minimum !== undefined && value < prop.minimum) {
        errors.push(`Field "${key}": minimum value is ${prop.minimum}`)
      }
      if (prop.maximum !== undefined && value > prop.maximum) {
        errors.push(`Field "${key}": maximum value is ${prop.maximum}`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

// ─── Context & Schema Extension ──────────────────────────────────────────────

export interface ContextExtension {
  pluginName: string
  types: Record<string, string>
}

export interface SchemaExtension {
  pluginName: string
  tables: Record<string, Record<string, string>>
}

// ─── Plugin SDK v2 ───────────────────────────────────────────────────────────

export class PluginSDK {
  private hooks: PluginHook[] = []
  private middlewares: PluginMiddleware[] = []
  private beforeQueryHandlers: Array<(ctx: HookContext) => Promise<HookContext> | HookContext> = []
  private afterMutationHandlers: Array<(ctx: HookContext) => Promise<HookContext> | HookContext> = []
  private contextExtensions: ContextExtension[] = []
  private schemaExtensions: SchemaExtension[] = []
  private jsonSchemas = new Map<string, JSONSchema>()

  /**
   * Create a plugin from a PluginV2Config, converting it to a PluginV2Definition
   * with all hooks, middleware, and extensions wired up.
   *
   * @param config - The plugin configuration to build from
   * @returns A fully wired PluginV2Definition ready for installation
   */
  createPlugin(config: PluginV2Config): PluginV2Definition {
    // Reset internal state for a fresh plugin build
    this.hooks = config.hooks ? [...config.hooks] : []
    this.middlewares = [...this.middlewares, ...(config.middleware ?? [])]
    this.beforeQueryHandlers = []
    this.afterMutationHandlers = []

    // Register lifecycle-based hooks as typed PluginHooks
    if (config.onRequest) {
      const handler = config.onRequest
      this.hooks.push({ type: "before-query", handler })
      this.hooks.push({ type: "before-mutation", handler })
    }
    if (config.onQuery) {
      this.hooks.push({ type: "before-query", handler: config.onQuery })
    }
    if (config.onMutation) {
      this.hooks.push({ type: "before-mutation", handler: config.onMutation })
    }

    // Build combined middleware from hooks
    const allMiddleware = this.buildMiddleware(config.name)

    const definition: PluginV2Definition = {
      name: config.name,
      version: config.version,
      description: config.description,
      author: config.author,
      keywords: config.keywords ?? [],
      category: config.category,
      reactivebaseVersion: config.reactivebaseVersion,
      dependencies: config.dependencies,
      configSchema: config.configSchema,
      middleware: allMiddleware,
      functions: config.functions,
      migrations: config.migrations,
      onInstall: config.onInstall,
      onStart: config.onStart,
      onStop: config.onStop,
    }

    return definition
  }

  /**
   * Register a middleware to be included in the next createPlugin call.
   *
   * @param mw - The middleware to register
   */
  useMiddleware(mw: PluginMiddleware): void {
    this.middlewares.push(mw)
  }

  /**
   * Register a before-query handler.
   *
   * @param fn - The hook function to run before each query
   */
  useBeforeQuery(fn: (ctx: HookContext) => Promise<HookContext> | HookContext): void {
    this.beforeQueryHandlers.push(fn)
    this.hooks.push({ type: "before-query", handler: fn })
  }

  /**
   * Register an after-mutation handler.
   *
   * @param fn - The hook function to run after each mutation
   */
  useAfterMutation(fn: (ctx: HookContext) => Promise<HookContext> | HookContext): void {
    this.afterMutationHandlers.push(fn)
    this.hooks.push({ type: "after-mutation", handler: fn })
  }

  /**
   * Declare additional types to be merged into the plugin context.
   *
   * @param pluginName - The name of the plugin declaring the extension
   * @param types - A map of type names to their type definitions
   * @returns The registered context extension
   */
  extendContext(pluginName: string, types: Record<string, string>): ContextExtension {
    const ext: ContextExtension = { pluginName, types }
    this.contextExtensions.push(ext)
    return ext
  }

  /**
   * Declare additional tables/columns to be added to the schema.
   *
   * @param pluginName - The name of the plugin declaring the extension
   * @param tables - A map of table names to their column definitions
   * @returns The registered schema extension
   */
  extendSchema(pluginName: string, tables: Record<string, Record<string, string>>): SchemaExtension {
    const ext: SchemaExtension = { pluginName, tables }
    this.schemaExtensions.push(ext)
    return ext
  }

  /**
   * Register a JSON Schema for validating a plugin's configuration.
   *
   * @param pluginName - The name of the plugin to register the schema for
   * @param schema - The JSON Schema describing the plugin's configuration
   */
  registerConfigSchema(pluginName: string, schema: JSONSchema): void {
    this.jsonSchemas.set(pluginName, schema)
  }

  /**
   * Validate config against a registered JSON Schema.
   *
   * @param pluginName - The name of the plugin whose schema to validate against
   * @param config - The configuration object to validate
   * @returns An object with a valid boolean and an array of error messages
   */
  validateConfig(pluginName: string, config: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const schema = this.jsonSchemas.get(pluginName)
    if (!schema) {
      return { valid: true, errors: [] }
    }
    return validateWithJSONSchema(schema, config)
  }

  /**
   * Get all registered hooks.
   *
   * @returns A copy of all registered plugin hooks
   */
  getHooks(): PluginHook[] {
    return [...this.hooks]
  }

  /**
   * Get all context extensions.
   *
   * @returns A copy of all registered context extensions
   */
  getContextExtensions(): ContextExtension[] {
    return [...this.contextExtensions]
  }

  /**
   * Get all schema extensions.
   *
   * @returns A copy of all registered schema extensions
   */
  getSchemaExtensions(): SchemaExtension[] {
    return [...this.schemaExtensions]
  }

  private buildMiddleware(pluginName: string): PluginMiddleware[] {
    const result: PluginMiddleware[] = [...this.middlewares]

    // Convert before-query hooks to "before" phase middleware
    const beforeQueryHooks = this.hooks.filter((h) => h.type === "before-query")
    if (beforeQueryHooks.length > 0) {
      result.push({
        name: `${pluginName}-before-query`,
        phase: "before",
        handler: async (ctx: unknown) => {
          let current = ctx as HookContext
          for (const hook of beforeQueryHooks) {
            current = await hook.handler(current)
          }
          return current
        },
      })
    }

    // Convert before-mutation hooks to "before" phase middleware
    const beforeMutationHooks = this.hooks.filter((h) => h.type === "before-mutation")
    if (beforeMutationHooks.length > 0) {
      result.push({
        name: `${pluginName}-before-mutation`,
        phase: "before",
        handler: async (ctx: unknown) => {
          let current = ctx as HookContext
          for (const hook of beforeMutationHooks) {
            current = await hook.handler(current)
          }
          return current
        },
      })
    }

    // Convert after-mutation hooks to "after" phase middleware
    const afterMutationHooks = this.hooks.filter((h) => h.type === "after-mutation")
    if (afterMutationHooks.length > 0) {
      result.push({
        name: `${pluginName}-after-mutation`,
        phase: "after",
        handler: async (ctx: unknown) => {
          let current = ctx as HookContext
          for (const hook of afterMutationHooks) {
            current = await hook.handler(current)
          }
          return current
        },
      })
    }

    // Convert on-error hooks to "error" phase middleware
    const errorHooks = this.hooks.filter((h) => h.type === "on-error")
    if (errorHooks.length > 0) {
      result.push({
        name: `${pluginName}-on-error`,
        phase: "error",
        handler: async (ctx: unknown) => {
          let current = ctx as HookContext & { error: Error }
          for (const hook of errorHooks) {
            if (hook.type === "on-error") {
              current = (await hook.handler(current)) as HookContext & { error: Error }
            }
          }
          return current
        },
      })
    }

    return result
  }
}

// ─── Plugin Test Harness ─────────────────────────────────────────────────────

export class PluginTestHarness {
  private marketplace: PluginMarketplace
  private logs: { plugin: string; level: string; message: string }[] = []
  private registeredFunctions = new Map<string, unknown>()

  constructor() {
    this.marketplace = new PluginMarketplace()
  }

  /**
   * Install a plugin definition into the test harness.
   *
   * @param definition - The plugin definition to install
   * @param config - Optional configuration to pass to the plugin
   * @returns The installed plugin instance
   */
  async install(definition: PluginV2Definition, config: Record<string, unknown> = {}): Promise<PluginV2Instance> {
    return this.marketplace.install(definition, config)
  }

  /**
   * Start a plugin in the test harness.
   *
   * @param pluginName - The name of the plugin to start
   */
  async start(pluginName: string): Promise<void> {
    return this.marketplace.start(pluginName)
  }

  /**
   * Stop a plugin in the test harness.
   *
   * @param pluginName - The name of the plugin to stop
   */
  async stop(pluginName: string): Promise<void> {
    return this.marketplace.stop(pluginName)
  }

  /**
   * Uninstall a plugin from the test harness.
   *
   * @param pluginName - The name of the plugin to uninstall
   */
  async uninstall(pluginName: string): Promise<void> {
    return this.marketplace.uninstall(pluginName)
  }

  /**
   * Get an installed plugin instance.
   *
   * @param name - The unique name of the plugin to retrieve
   * @returns The plugin instance if found, or undefined
   */
  getPlugin(name: string): PluginV2Instance | undefined {
    return this.marketplace.getPlugin(name)
  }

  /**
   * List all installed plugins.
   *
   * @returns An array of all installed plugin instances
   */
  listInstalled(): PluginV2Instance[] {
    return this.marketplace.listInstalled()
  }

  /**
   * Create a mock PluginV2Context for testing lifecycle hooks directly.
   *
   * @param config - Optional configuration to include in the mock context
   * @returns A mock PluginV2Context with logging and function registration capabilities
   */
  createMockContext(config: Record<string, unknown> = {}): PluginV2Context {
    return {
      config,
      logger: {
        info: (msg) => this.logs.push({ plugin: "test", level: "info", message: msg }),
        warn: (msg) => this.logs.push({ plugin: "test", level: "warn", message: msg }),
        error: (msg) => this.logs.push({ plugin: "test", level: "error", message: msg }),
      },
      registerFunction: (name, fn) => {
        this.registeredFunctions.set(name, fn)
      },
      getPlugin: (name) => this.marketplace.getPlugin(name),
    }
  }

  /**
   * Get all logs captured during the test.
   *
   * @returns A copy of all log entries captured during the test
   */
  getLogs(): { plugin: string; level: string; message: string }[] {
    return [...this.logs]
  }

  /**
   * Get registered functions.
   *
   * @returns A copy of the map of registered function names to their implementations
   */
  getRegisteredFunctions(): Map<string, unknown> {
    return new Map(this.registeredFunctions)
  }

  /**
   * Simulate a hook execution pipeline.
   *
   * @param hooks - The array of plugin hooks to execute in sequence
   * @param initialCtx - The initial hook context to pass through the pipeline
   * @returns The final hook context after all hooks have been applied
   */
  async executeHook(hooks: PluginHook[], initialCtx: HookContext): Promise<HookContext> {
    let ctx = { ...initialCtx }
    for (const hook of hooks) {
      if (hook.type === "on-connect" || hook.type === "on-disconnect") {
        await hook.handler(ctx)
      } else if (hook.type === "on-error") {
        ctx = await hook.handler({ ...ctx, error: new Error("test") })
      } else {
        ctx = await hook.handler(ctx)
      }
    }
    return ctx
  }

  /**
   * Validate plugin config against its schema.
   *
   * @param definition - The plugin definition containing the config schema
   * @param config - The configuration object to validate
   * @returns An object with a valid boolean and an array of error messages
   */
  validateConfig(
    definition: PluginV2Definition,
    config: Record<string, unknown>,
  ): { valid: boolean; errors: string[] } {
    if (!definition.configSchema) {
      return { valid: true, errors: [] }
    }
    return validatePluginConfig(definition.configSchema, config)
  }

  /**
   * Reset the harness state.
   */
  reset(): void {
    this.marketplace = new PluginMarketplace()
    this.logs = []
    this.registeredFunctions.clear()
  }
}
