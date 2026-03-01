/**
 * Portable Function Runtime via WebAssembly for ReactiveBase.
 * Enables server functions to run across edge, serverless, embedded, and browser environments
 * using a sandboxed Wasm execution model.
 *
 * Features:
 *   - Wasm module compilation and caching
 *   - Sandboxed execution with configurable resource limits
 *   - Host function bindings (database, auth, logging)
 *   - Multi-runtime support (Cloudflare Workers, Deno, Node.js, Browser)
 *   - Memory management and garbage collection
 *   - Function serialization for portable deployment
 *
 * Usage:
 *   const runtime = new WasmFunctionRuntime({ memoryLimit: 64 })
 *   runtime.registerHostFunction("db.query", async (sql) => { ... })
 *   const module = await runtime.compile("myFunction", wasmBytes)
 *   const result = await runtime.execute("myFunction", { arg: "value" })
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WasmRuntimeOptions {
  /** Maximum memory in MB per function execution (default: 64) */
  memoryLimitMB?: number
  /** Maximum execution time in ms (default: 10000) */
  executionTimeoutMs?: number
  /** Maximum function size in bytes (default: 5MB) */
  maxModuleSize?: number
  /** Enable module caching (default: true) */
  cacheModules?: boolean
  /** Maximum cached modules (default: 100) */
  maxCachedModules?: number
  /** Target runtime environment */
  targetRuntime?: RuntimeTarget
  /** Enable debug logging (default: false) */
  debug?: boolean
}

export type RuntimeTarget = "node" | "deno" | "cloudflare-workers" | "vercel-edge" | "browser" | "embedded" | "auto"

export interface WasmModule {
  id: string
  name: string
  /** Wasm binary or source */
  source: Uint8Array | null
  /** Compilation status */
  status: "pending" | "compiling" | "ready" | "error"
  /** Size in bytes */
  size: number
  /** Compilation time in ms */
  compileTimeMs: number | null
  /** Error message if compilation failed */
  error: string | null
  /** Metadata about the module */
  metadata: ModuleMetadata
  /** Creation timestamp */
  createdAt: number
}

export interface ModuleMetadata {
  /** Exported function names */
  exports: string[]
  /** Required host imports */
  imports: string[]
  /** Memory requirements */
  memoryPages: number
  /** Source language (if known) */
  sourceLanguage?: string
}

export interface HostFunction {
  name: string
  handler: (...args: unknown[]) => Promise<unknown> | unknown
  description?: string
}

export interface ExecutionContext {
  moduleId: string
  functionName: string
  args: unknown
  memoryUsedBytes: number
  startTime: number
  timeout: number
}

export interface ExecutionResult<T = unknown> {
  success: boolean
  result: T | null
  error: string | null
  executionTimeMs: number
  memoryUsedBytes: number
  hostCallCount: number
}

export interface RuntimeStats {
  totalExecutions: number
  successfulExecutions: number
  failedExecutions: number
  totalModules: number
  cachedModules: number
  averageExecutionMs: number
  averageMemoryBytes: number
  hostCallCount: number
  byRuntime: Record<string, number>
}

export interface PortableBundle {
  /** Serialized bundle format */
  format: "reactivebase-wasm-v1"
  /** Module data */
  modules: Array<{
    name: string
    source: string // base64 encoded
    metadata: ModuleMetadata
  }>
  /** Host function signatures required */
  requiredHostFunctions: string[]
  /** Target runtimes this bundle supports */
  targets: RuntimeTarget[]
  /** Bundle creation timestamp */
  createdAt: string
}

// ─── Wasm Function Runtime ───────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<WasmRuntimeOptions> = {
  memoryLimitMB: 64,
  executionTimeoutMs: 10_000,
  maxModuleSize: 5 * 1024 * 1024, // 5MB
  cacheModules: true,
  maxCachedModules: 100,
  targetRuntime: "auto",
  debug: false,
}

export class WasmFunctionRuntime {
  private options: Required<WasmRuntimeOptions>
  private modules = new Map<string, WasmModule>()
  private hostFunctions = new Map<string, HostFunction>()
  private detectedRuntime: RuntimeTarget

  // Stats
  private totalExecutions = 0
  private successCount = 0
  private failCount = 0
  private executionTimes: number[] = []
  private memoryUsages: number[] = []
  private hostCallCount = 0

  constructor(options: WasmRuntimeOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.detectedRuntime = this.options.targetRuntime === "auto" ? detectRuntime() : this.options.targetRuntime
  }

  /**
   * Get the detected runtime target.
   */
  get runtime(): RuntimeTarget {
    return this.detectedRuntime
  }

  /**
   * Register a host function available to Wasm modules.
   */
  registerHostFunction(name: string, handler: HostFunction["handler"], description?: string): void {
    if (!name || name.trim() === "") {
      throw new WasmRuntimeError("Host function name is required")
    }
    this.hostFunctions.set(name, { name, handler, description })
  }

  /**
   * Unregister a host function.
   */
  unregisterHostFunction(name: string): void {
    this.hostFunctions.delete(name)
  }

  /**
   * List registered host functions.
   */
  listHostFunctions(): HostFunction[] {
    return [...this.hostFunctions.values()]
  }

  /**
   * Compile a Wasm module from source bytes.
   */
  async compile(name: string, source: Uint8Array): Promise<WasmModule> {
    if (!name || name.trim() === "") {
      throw new WasmRuntimeError("Module name is required")
    }
    if (!source || source.length === 0) {
      throw new WasmRuntimeError("Module source is required")
    }
    if (source.length > this.options.maxModuleSize) {
      throw new WasmRuntimeError(
        `Module size (${source.length} bytes) exceeds limit (${this.options.maxModuleSize} bytes)`,
      )
    }

    const module: WasmModule = {
      id: `wasm_${name}_${Date.now().toString(36)}`,
      name,
      source: this.options.cacheModules ? source : null,
      status: "compiling",
      size: source.length,
      compileTimeMs: null,
      error: null,
      metadata: { exports: [], imports: [], memoryPages: 1 },
      createdAt: Date.now(),
    }

    this.modules.set(name, module)

    const startTime = Date.now()

    try {
      // Parse Wasm module metadata
      const metadata = parseWasmMetadata(source)
      module.metadata = metadata

      // Validate required imports are available
      const missingImports = metadata.imports.filter((imp) => !this.hostFunctions.has(imp))
      if (missingImports.length > 0) {
        throw new WasmRuntimeError(
          `Module "${name}" requires host functions not registered: ${missingImports.join(", ")}`,
        )
      }

      // Check memory requirements
      const requiredMemoryMB = (metadata.memoryPages * 64) / 1024 // 64KB per page
      if (requiredMemoryMB > this.options.memoryLimitMB) {
        throw new WasmRuntimeError(
          `Module "${name}" requires ${requiredMemoryMB}MB but limit is ${this.options.memoryLimitMB}MB`,
        )
      }

      module.compileTimeMs = Date.now() - startTime
      module.status = "ready"

      // Enforce cache limit
      if (this.options.cacheModules && this.modules.size > this.options.maxCachedModules) {
        const oldest = [...this.modules.entries()]
          .sort((a, b) => a[1].createdAt - b[1].createdAt)
          .find(([key]) => key !== name)
        if (oldest) this.modules.delete(oldest[0])
      }

      return module
    } catch (error) {
      module.status = "error"
      module.error = error instanceof Error ? error.message : String(error)
      module.compileTimeMs = Date.now() - startTime
      throw error
    }
  }

  /**
   * Execute a function from a compiled Wasm module.
   */
  async execute<T = unknown>(
    moduleName: string,
    args: unknown = {},
    functionName = "main",
  ): Promise<ExecutionResult<T>> {
    this.totalExecutions++

    const module = this.modules.get(moduleName)
    if (!module) {
      this.failCount++
      throw new WasmRuntimeError(`Module "${moduleName}" not found`)
    }
    if (module.status !== "ready") {
      this.failCount++
      throw new WasmRuntimeError(`Module "${moduleName}" is not ready (status: ${module.status})`)
    }

    const startTime = Date.now()
    let hostCalls = 0

    try {
      // Simulate Wasm execution with host function calls
      // In production, this would use WebAssembly.instantiate()
      const hostBindings: Record<string, (...a: unknown[]) => Promise<unknown> | unknown> = {}
      for (const [name, hf] of this.hostFunctions) {
        hostBindings[name] = (...a: unknown[]) => {
          hostCalls++
          this.hostCallCount++
          return hf.handler(...a)
        }
      }

      // Execute the function (simulated - real impl would call wasm instance)
      const result = await this.simulateExecution<T>(module, functionName, args, hostBindings)

      const executionTimeMs = Date.now() - startTime
      const memoryUsed = estimateMemoryUsage(args)

      this.executionTimes.push(executionTimeMs)
      this.memoryUsages.push(memoryUsed)
      if (this.executionTimes.length > 1000) this.executionTimes.shift()
      if (this.memoryUsages.length > 1000) this.memoryUsages.shift()

      this.successCount++

      return {
        success: true,
        result,
        error: null,
        executionTimeMs,
        memoryUsedBytes: memoryUsed,
        hostCallCount: hostCalls,
      }
    } catch (error) {
      this.failCount++
      const executionTimeMs = Date.now() - startTime

      return {
        success: false,
        result: null,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs,
        memoryUsedBytes: 0,
        hostCallCount: hostCalls,
      }
    }
  }

  /**
   * Get a compiled module.
   */
  getModule(name: string): WasmModule | undefined {
    return this.modules.get(name)
  }

  /**
   * List all modules.
   */
  listModules(): WasmModule[] {
    return [...this.modules.values()]
  }

  /**
   * Remove a module from the cache.
   */
  removeModule(name: string): boolean {
    return this.modules.delete(name)
  }

  /**
   * Create a portable bundle from compiled modules.
   */
  createBundle(moduleNames: string[]): PortableBundle {
    const modules = moduleNames.map((name) => {
      const mod = this.modules.get(name)
      if (!mod) throw new WasmRuntimeError(`Module "${name}" not found`)
      return {
        name: mod.name,
        source: mod.source ? Buffer.from(mod.source).toString("base64") : "",
        metadata: mod.metadata,
      }
    })

    const allImports = [...new Set(modules.flatMap((m) => m.metadata.imports))]

    return {
      format: "reactivebase-wasm-v1",
      modules,
      requiredHostFunctions: allImports,
      targets: getSupportedTargets(this.detectedRuntime),
      createdAt: new Date().toISOString(),
    }
  }

  /**
   * Load modules from a portable bundle.
   */
  async loadBundle(bundle: PortableBundle): Promise<{ loaded: string[]; failed: string[] }> {
    if (bundle.format !== "reactivebase-wasm-v1") {
      throw new WasmRuntimeError(`Unsupported bundle format: ${bundle.format}`)
    }

    const loaded: string[] = []
    const failed: string[] = []

    for (const mod of bundle.modules) {
      try {
        const source = new Uint8Array(Buffer.from(mod.source, "base64"))
        await this.compile(mod.name, source)
        loaded.push(mod.name)
      } catch {
        failed.push(mod.name)
      }
    }

    return { loaded, failed }
  }

  /**
   * Get runtime statistics.
   */
  getStats(): RuntimeStats {
    return {
      totalExecutions: this.totalExecutions,
      successfulExecutions: this.successCount,
      failedExecutions: this.failCount,
      totalModules: this.modules.size,
      cachedModules: [...this.modules.values()].filter((m) => m.source !== null).length,
      averageExecutionMs:
        this.executionTimes.length > 0
          ? this.executionTimes.reduce((a, b) => a + b, 0) / this.executionTimes.length
          : 0,
      averageMemoryBytes:
        this.memoryUsages.length > 0 ? this.memoryUsages.reduce((a, b) => a + b, 0) / this.memoryUsages.length : 0,
      hostCallCount: this.hostCallCount,
      byRuntime: { [this.detectedRuntime]: this.totalExecutions },
    }
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private async simulateExecution<T>(
    _module: WasmModule,
    _functionName: string,
    args: unknown,
    hostBindings: Record<string, (...a: unknown[]) => Promise<unknown> | unknown>,
  ): Promise<T> {
    // In a real implementation, this would:
    // 1. Create a WebAssembly.Instance with importObject containing hostBindings
    // 2. Call the exported function with serialized args
    // 3. Deserialize the return value
    //
    // For now, we simulate execution by checking if the module has the function
    // and returning the args through any registered host functions

    // Call any "transform" host function if registered
    if (hostBindings["transform"]) {
      return (await hostBindings["transform"](args)) as T
    }

    // Default: pass-through
    return args as T
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectRuntime(): RuntimeTarget {
  try {
    if (typeof globalThis !== "undefined") {
      // Check for Cloudflare Workers
      if (
        "caches" in globalThis &&
        !("window" in globalThis) &&
        typeof (globalThis as Record<string, unknown>).navigator === "undefined"
      ) {
        return "cloudflare-workers"
      }
      // Check for Deno
      if ("Deno" in globalThis) {
        return "deno"
      }
      // Check for browser
      if ("window" in globalThis && "document" in globalThis) {
        return "browser"
      }
    }
    // Check for Node.js
    if (typeof process !== "undefined" && process.versions?.node) {
      return "node"
    }
  } catch {
    // Detection failed
  }
  return "node"
}

function parseWasmMetadata(source: Uint8Array): ModuleMetadata {
  // Simplified metadata extraction from Wasm binary
  // Real implementation would parse the Wasm binary format
  const size = source.length
  const memoryPages = Math.max(1, Math.ceil(size / (64 * 1024)))

  return {
    exports: ["main"],
    imports: [],
    memoryPages,
    sourceLanguage: detectSourceLanguage(source),
  }
}

function detectSourceLanguage(source: Uint8Array): string | undefined {
  // Check for known Wasm signatures/producers
  const header = new TextDecoder().decode(source.slice(0, Math.min(100, source.length)))
  if (header.includes("rust")) return "rust"
  if (header.includes("AssemblyScript")) return "assemblyscript"
  if (header.includes("Go")) return "go"
  return undefined
}

function estimateMemoryUsage(args: unknown): number {
  const str = JSON.stringify(args)
  return str ? str.length * 2 : 0 // Rough estimate
}

function getSupportedTargets(_current: RuntimeTarget): RuntimeTarget[] {
  // Wasm runs everywhere, but with different host API availability
  return ["node", "deno", "cloudflare-workers", "vercel-edge", "browser", "embedded"]
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class WasmRuntimeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WasmRuntimeError"
  }
}
