/**
 * Type-Safe RPC Code Splitting for ReactiveBase.
 * Enables tree-shaking and lazy loading of server functions to improve
 * bundle sizes and cold start times for serverless deployments.
 *
 * Features:
 *   - Function manifest generation for static analysis
 *   - Lazy function registry with dynamic imports
 *   - Code splitting boundaries for server functions
 *   - Bundle analysis and dependency tracking
 *   - Client-side proxy generation for tree-shaking
 *   - Cold start optimization with pre-warming hints
 *
 * Usage:
 *   const registry = new LazyFunctionRegistry()
 *   registry.register("users.list", () => import("./functions/users.js").then(m => m.listUsers))
 *   const result = await registry.invoke("users.list", { limit: 10 })
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FunctionManifestEntry {
  name: string
  type: "query" | "mutation" | "action"
  module: string
  exportName: string
  /** Estimated bundle size in bytes (if available) */
  bundleSize?: number
  /** Dependencies on other functions */
  dependencies: string[]
  /** Whether this function is frequently invoked (pre-warm candidate) */
  hot?: boolean
}

export interface FunctionManifest {
  version: string
  generated: string
  functions: FunctionManifestEntry[]
  chunks: ChunkDefinition[]
  totalSize: number
}

export interface ChunkDefinition {
  id: string
  name: string
  functions: string[]
  estimatedSize: number
  dependencies: string[]
}

export interface SplitConfig {
  /** Maximum chunk size in bytes (default: 50KB) */
  maxChunkSize?: number
  /** Minimum chunk size in bytes (default: 5KB) */
  minChunkSize?: number
  /** Strategy for grouping functions into chunks */
  strategy?: "by-module" | "by-frequency" | "by-dependency" | "manual"
  /** Functions to pre-warm on cold start */
  preWarm?: string[]
  /** Manual chunk assignments */
  manualChunks?: Record<string, string[]>
}

export interface LazyFunctionOptions {
  /** Timeout for dynamic import in ms (default: 5000) */
  importTimeoutMs?: number
  /** Enable caching of loaded modules (default: true) */
  cacheModules?: boolean
  /** Pre-warm on registration (default: false) */
  eagerLoad?: boolean
}

export type FunctionLoader<T = unknown> = () => Promise<T>

export interface InvokeResult<T = unknown> {
  result: T
  functionName: string
  loadTimeMs: number
  executeTimeMs: number
  cached: boolean
}

export interface RegistryStats {
  totalFunctions: number
  loadedFunctions: number
  pendingFunctions: number
  cacheHitRate: number
  averageLoadTimeMs: number
  averageExecuteTimeMs: number
  coldStartFunctions: string[]
}

// ─── Lazy Function Registry ──────────────────────────────────────────────────

export class LazyFunctionRegistry {
  private loaders = new Map<string, FunctionLoader>()
  private loaded = new Map<string, unknown>()
  private metadata = new Map<string, { type: string; module: string; dependencies: string[] }>()
  private options: Required<LazyFunctionOptions>

  // Stats
  private loadTimes: number[] = []
  private executeTimes: number[] = []
  private cacheHits = 0
  private cacheMisses = 0

  constructor(options: LazyFunctionOptions = {}) {
    this.options = {
      importTimeoutMs: options.importTimeoutMs ?? 5000,
      cacheModules: options.cacheModules !== false,
      eagerLoad: options.eagerLoad ?? false,
    }
  }

  /**
   * Register a lazily-loaded function.
   */
  register(
    name: string,
    loader: FunctionLoader,
    meta?: { type?: string; module?: string; dependencies?: string[] },
  ): void {
    if (!name || name.trim() === "") {
      throw new RpcSplitError("Function name is required")
    }

    this.loaders.set(name, loader)
    this.metadata.set(name, {
      type: meta?.type ?? "query",
      module: meta?.module ?? name.split(".")[0],
      dependencies: meta?.dependencies ?? [],
    })

    if (this.options.eagerLoad) {
      this.load(name).catch(() => {})
    }
  }

  /**
   * Check if a function is registered.
   */
  has(name: string): boolean {
    return this.loaders.has(name)
  }

  /**
   * Check if a function is already loaded.
   */
  isLoaded(name: string): boolean {
    return this.loaded.has(name)
  }

  /**
   * Load a function (resolve the dynamic import).
   */
  async load(name: string): Promise<unknown> {
    // Check cache
    if (this.options.cacheModules && this.loaded.has(name)) {
      this.cacheHits++
      return this.loaded.get(name)
    }
    this.cacheMisses++

    const loader = this.loaders.get(name)
    if (!loader) {
      throw new RpcSplitError(`Function "${name}" is not registered`)
    }

    const startTime = Date.now()

    try {
      const fn = await withTimeout(loader(), this.options.importTimeoutMs)
      const loadTime = Date.now() - startTime
      this.loadTimes.push(loadTime)
      if (this.loadTimes.length > 1000) this.loadTimes.shift()

      if (this.options.cacheModules) {
        this.loaded.set(name, fn)
      }

      return fn
    } catch (error) {
      throw new RpcSplitError(
        `Failed to load function "${name}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Invoke a lazily-loaded function.
   */
  async invoke<T = unknown>(name: string, ...args: unknown[]): Promise<InvokeResult<T>> {
    const cached = this.loaded.has(name)
    const loadStart = Date.now()

    const fn = await this.load(name)
    const loadTimeMs = Date.now() - loadStart

    if (typeof fn !== "function") {
      throw new RpcSplitError(`Loaded value for "${name}" is not a function`)
    }

    const execStart = Date.now()
    const result = await (fn as (...a: unknown[]) => Promise<T>)(...args)
    const executeTimeMs = Date.now() - execStart

    this.executeTimes.push(executeTimeMs)
    if (this.executeTimes.length > 1000) this.executeTimes.shift()

    return { result, functionName: name, loadTimeMs, executeTimeMs, cached }
  }

  /**
   * Pre-warm specified functions by loading them into cache.
   */
  async preWarm(names: string[]): Promise<{ loaded: string[]; failed: string[] }> {
    const loaded: string[] = []
    const failed: string[] = []

    await Promise.allSettled(
      names.map(async (name) => {
        try {
          await this.load(name)
          loaded.push(name)
        } catch {
          failed.push(name)
        }
      }),
    )

    return { loaded, failed }
  }

  /**
   * Evict a function from the cache.
   */
  evict(name: string): boolean {
    return this.loaded.delete(name)
  }

  /**
   * Clear the entire loaded function cache.
   */
  clearCache(): void {
    this.loaded.clear()
  }

  /**
   * List all registered function names.
   */
  listFunctions(): string[] {
    return [...this.loaders.keys()]
  }

  /**
   * Get registry statistics.
   */
  getStats(): RegistryStats {
    const total = this.loaders.size
    const loadedCount = this.loaded.size
    const avgLoadMs = this.loadTimes.length > 0 ? this.loadTimes.reduce((a, b) => a + b, 0) / this.loadTimes.length : 0
    const avgExecMs =
      this.executeTimes.length > 0 ? this.executeTimes.reduce((a, b) => a + b, 0) / this.executeTimes.length : 0

    const coldStart = [...this.loaders.keys()].filter((n) => !this.loaded.has(n))

    return {
      totalFunctions: total,
      loadedFunctions: loadedCount,
      pendingFunctions: total - loadedCount,
      cacheHitRate: this.cacheHits + this.cacheMisses > 0 ? this.cacheHits / (this.cacheHits + this.cacheMisses) : 0,
      averageLoadTimeMs: avgLoadMs,
      averageExecuteTimeMs: avgExecMs,
      coldStartFunctions: coldStart,
    }
  }
}

// ─── Manifest Generator ──────────────────────────────────────────────────────

/**
 * Generate a function manifest from registered functions.
 */
export function generateFunctionManifest(
  functions: FunctionManifestEntry[],
  splitConfig: SplitConfig = {},
): FunctionManifest {
  const chunks = computeChunks(functions, splitConfig)

  return {
    version: "1.0",
    generated: new Date().toISOString(),
    functions,
    chunks,
    totalSize: functions.reduce((sum, f) => sum + (f.bundleSize ?? 0), 0),
  }
}

/**
 * Compute optimal chunk assignments for code splitting.
 */
export function computeChunks(functions: FunctionManifestEntry[], config: SplitConfig = {}): ChunkDefinition[] {
  const strategy = config.strategy ?? "by-module"
  const _maxSize = config.maxChunkSize ?? 50_000
  const chunks: ChunkDefinition[] = []

  if (strategy === "manual" && config.manualChunks) {
    for (const [chunkName, fnNames] of Object.entries(config.manualChunks)) {
      const fns = functions.filter((f) => fnNames.includes(f.name))
      chunks.push({
        id: `chunk-${chunkName}`,
        name: chunkName,
        functions: fns.map((f) => f.name),
        estimatedSize: fns.reduce((sum, f) => sum + (f.bundleSize ?? 0), 0),
        dependencies: [...new Set(fns.flatMap((f) => f.dependencies))],
      })
    }
    return chunks
  }

  if (strategy === "by-module") {
    const byModule = new Map<string, FunctionManifestEntry[]>()
    for (const fn of functions) {
      const module = fn.module
      if (!byModule.has(module)) byModule.set(module, [])
      byModule.get(module)!.push(fn)
    }

    for (const [module, fns] of byModule) {
      chunks.push({
        id: `chunk-${module}`,
        name: module,
        functions: fns.map((f) => f.name),
        estimatedSize: fns.reduce((sum, f) => sum + (f.bundleSize ?? 0), 0),
        dependencies: [...new Set(fns.flatMap((f) => f.dependencies))],
      })
    }
    return chunks
  }

  if (strategy === "by-frequency") {
    const hot = functions.filter((f) => f.hot)
    const cold = functions.filter((f) => !f.hot)

    if (hot.length > 0) {
      chunks.push({
        id: "chunk-hot",
        name: "hot",
        functions: hot.map((f) => f.name),
        estimatedSize: hot.reduce((sum, f) => sum + (f.bundleSize ?? 0), 0),
        dependencies: [...new Set(hot.flatMap((f) => f.dependencies))],
      })
    }
    if (cold.length > 0) {
      chunks.push({
        id: "chunk-cold",
        name: "cold",
        functions: cold.map((f) => f.name),
        estimatedSize: cold.reduce((sum, f) => sum + (f.bundleSize ?? 0), 0),
        dependencies: [...new Set(cold.flatMap((f) => f.dependencies))],
      })
    }
    return chunks
  }

  // Default: one chunk per function (maximum splitting)
  for (const fn of functions) {
    chunks.push({
      id: `chunk-${fn.name.replace(/\./g, "-")}`,
      name: fn.name,
      functions: [fn.name],
      estimatedSize: fn.bundleSize ?? 0,
      dependencies: fn.dependencies,
    })
  }

  return chunks
}

/**
 * Generate a client-side proxy module for tree-shaking.
 */
export function generateClientProxy(manifest: FunctionManifest): string {
  const lines: string[] = [
    "// Auto-generated RPC client proxy - enables tree-shaking of server functions",
    "// Do not edit manually - regenerate with `reactivebase codegen:rpc`",
    "",
    'import { createRpcClient } from "@reactivebase/client"',
    "",
    "const rpc = createRpcClient()",
    "",
  ]

  for (const fn of manifest.functions) {
    const safeName = fn.name.replace(/\./g, "_")
    const fnType = fn.type === "query" ? "query" : fn.type === "mutation" ? "mutation" : "action"

    lines.push(`/** ${fn.type}: ${fn.name} (module: ${fn.module}) */`)
    lines.push(`export const ${safeName} = rpc.${fnType}("${fn.name}")`)
    lines.push("")
  }

  return lines.join("\n")
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RpcSplitError(`Import timed out after ${timeoutMs}ms`)), timeoutMs)
    promise.then(
      (val) => {
        clearTimeout(timer)
        resolve(val)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class RpcSplitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RpcSplitError"
  }
}
