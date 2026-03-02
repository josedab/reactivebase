/**
 * Enhanced RPC Type Generation — Zod-like runtime validation that
 * doubles as TypeScript types, plus zero-config function reference
 * generation with full IntelliSense support.
 *
 * Features:
 *   - Runtime validation schemas that infer TypeScript types
 *   - Function reference generation with args/return types
 *   - Validation middleware auto-generation
 *   - Client SDK type generation for multi-language support
 *   - Incremental codegen with file hash tracking
 *
 * Usage:
 *   const rpc = new RpcTypeGenerator()
 *   rpc.addFunction("tasks.list", "query", taskListSchema, taskListReturn)
 *   const output = rpc.generate()
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RpcFunctionDef {
  name: string
  module: string
  exportName: string
  type: "query" | "mutation" | "action"
  argsSchema: RpcSchema | null
  returnSchema: RpcSchema | null
  description?: string
  requiresAuth: boolean
  rateLimit?: number
}

export interface RpcSchema {
  kind: "object" | "string" | "number" | "boolean" | "array" | "enum" | "union" | "optional" | "id" | "date"
  properties?: Record<string, RpcSchema>
  items?: RpcSchema
  values?: string[]
  members?: RpcSchema[]
  inner?: RpcSchema
  required?: boolean
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  pattern?: string
  description?: string
  default?: unknown
}

export interface RpcGenerateOutput {
  apiModule: string
  validationModule: string
  clientTypes: string
  functionCount: number
}

export interface RpcClientSdkConfig {
  language: "typescript" | "python" | "go" | "ruby"
  packageName: string
  serverUrl: string
}

export interface FileHashEntry {
  path: string
  hash: string
  lastModified: number
}

// ─── Schema-to-TypeScript Conversion ─────────────────────────────────────────

/**
 * Convert an RPC schema definition to its TypeScript type representation.
 *
 * @param schema - The RPC schema to convert
 * @returns TypeScript type string corresponding to the schema
 */
export function schemaToTypeScript(schema: RpcSchema): string {
  switch (schema.kind) {
    case "string":
      return "string"
    case "number":
      return "number"
    case "boolean":
      return "boolean"
    case "date":
      return "Date"
    case "id":
      return "string"
    case "array":
      return schema.items ? `${schemaToTypeScript(schema.items)}[]` : "unknown[]"
    case "enum":
      return schema.values?.map((v) => `"${v}"`).join(" | ") ?? "string"
    case "union":
      return schema.members?.map(schemaToTypeScript).join(" | ") ?? "unknown"
    case "optional":
      return schema.inner ? `${schemaToTypeScript(schema.inner)} | undefined` : "unknown | undefined"
    case "object": {
      if (!schema.properties) return "Record<string, unknown>"
      const props = Object.entries(schema.properties).map(([key, val]) => {
        const opt = val.required === false || val.kind === "optional" ? "?" : ""
        const type = val.kind === "optional" && val.inner ? schemaToTypeScript(val.inner) : schemaToTypeScript(val)
        return `${key}${opt}: ${type}`
      })
      return `{ ${props.join("; ")} }`
    }
    default:
      return "unknown"
  }
}

// ─── Schema-to-Validation Code ───────────────────────────────────────────────

/**
 * Generate runtime validation code for an RPC schema.
 *
 * @param schema - The RPC schema to generate validation for
 * @param varName - Variable name to validate against
 * @returns Generated validation code as a string
 */
export function schemaToValidationCode(schema: RpcSchema, varName: string = "value"): string {
  const checks: string[] = []

  switch (schema.kind) {
    case "string":
      checks.push(`if (typeof ${varName} !== "string") throw new ValidationError("Expected string")`)
      if (schema.minLength)
        checks.push(`if (${varName}.length < ${schema.minLength}) throw new ValidationError("String too short")`)
      if (schema.maxLength)
        checks.push(`if (${varName}.length > ${schema.maxLength}) throw new ValidationError("String too long")`)
      if (schema.pattern)
        checks.push(
          `if (!/${schema.pattern}/.test(${varName})) throw new ValidationError("String does not match pattern")`,
        )
      break
    case "number":
      checks.push(
        `if (typeof ${varName} !== "number" || isNaN(${varName})) throw new ValidationError("Expected number")`,
      )
      if (schema.min !== undefined)
        checks.push(`if (${varName} < ${schema.min}) throw new ValidationError("Number too small")`)
      if (schema.max !== undefined)
        checks.push(`if (${varName} > ${schema.max}) throw new ValidationError("Number too large")`)
      break
    case "boolean":
      checks.push(`if (typeof ${varName} !== "boolean") throw new ValidationError("Expected boolean")`)
      break
    case "object":
      checks.push(
        `if (typeof ${varName} !== "object" || ${varName} === null) throw new ValidationError("Expected object")`,
      )
      break
    case "enum":
      if (schema.values) {
        const vals = schema.values.map((v) => `"${v}"`).join(", ")
        checks.push(`if (![${vals}].includes(${varName})) throw new ValidationError("Invalid enum value")`)
      }
      break
  }

  return checks.join("\n  ")
}

// ─── RPC Type Generator ──────────────────────────────────────────────────────

export class RpcTypeGenerator {
  private functions = new Map<string, RpcFunctionDef>()
  private fileHashes = new Map<string, FileHashEntry>()

  /**
   * Register a function definition with the generator.
   *
   * @param def - The RPC function definition to add
   */
  addFunction(def: RpcFunctionDef): void {
    this.functions.set(def.name, def)
  }

  /**
   * Remove a function definition by name.
   *
   * @param name - The name of the function to remove
   */
  removeFunction(name: string): void {
    this.functions.delete(name)
  }

  /**
   * Get all registered function definitions.
   *
   * @returns Array of all registered RPC function definitions
   */
  getFunctions(): RpcFunctionDef[] {
    return Array.from(this.functions.values())
  }

  /**
   * Get a function definition by name.
   *
   * @param name - The name of the function to retrieve
   * @returns The function definition, or undefined if not found
   */
  getFunction(name: string): RpcFunctionDef | undefined {
    return this.functions.get(name)
  }

  // ─── Code Generation ────────────────────────────────────────────────────

  /**
   * Run full code generation for all registered functions.
   *
   * @returns Generated output containing API module, validation module, client types, and function count
   */
  generate(): RpcGenerateOutput {
    const apiModule = this.generateApiModule()
    const validationModule = this.generateValidationModule()
    const clientTypes = this.generateClientTypes()

    return {
      apiModule,
      validationModule,
      clientTypes,
      functionCount: this.functions.size,
    }
  }

  /**
   * Generate the typed API module with function references.
   *
   * @returns Generated TypeScript source for the API module
   */
  generateApiModule(): string {
    const lines: string[] = [
      "/* eslint-disable */",
      "/* Auto-generated by ReactiveBase RPC. Do not edit. */",
      "",
      "export interface FunctionReference<TArgs = unknown, TReturn = unknown> {",
      "  readonly _name: string",
      '  readonly _type: "query" | "mutation" | "action"',
      "  readonly _args: TArgs",
      "  readonly _return: TReturn",
      "}",
      "",
      "function ref<TArgs = unknown, TReturn = unknown>(",
      '  name: string, type: "query" | "mutation" | "action"',
      "): FunctionReference<TArgs, TReturn> {",
      "  return { _name: name, _type: type } as FunctionReference<TArgs, TReturn>",
      "}",
      "",
      "export type InferArgs<T> = T extends FunctionReference<infer A, unknown> ? A : never",
      "export type InferReturn<T> = T extends FunctionReference<unknown, infer R> ? R : never",
      "",
    ]

    // Group by module
    const byModule = new Map<string, RpcFunctionDef[]>()
    for (const fn of this.functions.values()) {
      if (!byModule.has(fn.module)) byModule.set(fn.module, [])
      byModule.get(fn.module)!.push(fn)
    }

    // Generate arg/return types
    for (const fn of this.functions.values()) {
      const argsType = fn.argsSchema ? schemaToTypeScript(fn.argsSchema) : "void"
      const returnType = fn.returnSchema ? schemaToTypeScript(fn.returnSchema) : "unknown"
      const safeName = fn.name.replace(/\./g, "_")
      lines.push(`export type ${safeName}_Args = ${argsType}`)
      lines.push(`export type ${safeName}_Return = ${returnType}`)
      lines.push("")
    }

    // Generate api object
    lines.push("export const api = {")
    for (const [moduleName, fns] of byModule) {
      lines.push(`  ${moduleName}: {`)
      for (const fn of fns) {
        const safeName = fn.name.replace(/\./g, "_")
        lines.push(`    ${fn.exportName}: ref<${safeName}_Args, ${safeName}_Return>("${fn.name}", "${fn.type}"),`)
      }
      lines.push("  },")
    }
    lines.push("} as const")
    lines.push("")
    lines.push("export type Api = typeof api")
    lines.push("")

    return lines.join("\n")
  }

  /**
   * Generate validation middleware for all registered functions.
   *
   * @returns Generated TypeScript source for the validation module
   */
  generateValidationModule(): string {
    const lines: string[] = [
      "/* eslint-disable */",
      "/* Auto-generated validation middleware. Do not edit. */",
      "",
      "export class ValidationError extends Error {",
      '  constructor(message: string) { super(message); this.name = "ValidationError" }',
      "}",
      "",
    ]

    for (const fn of this.functions.values()) {
      if (!fn.argsSchema) continue

      const safeName = fn.name.replace(/\./g, "_")
      lines.push(`export function validate_${safeName}(value: unknown): void {`)
      lines.push(`  ${schemaToValidationCode(fn.argsSchema)}`)
      lines.push("}")
      lines.push("")
    }

    // Generate validation map
    lines.push("export const validators: Record<string, (value: unknown) => void> = {")
    for (const fn of this.functions.values()) {
      if (!fn.argsSchema) continue
      const safeName = fn.name.replace(/\./g, "_")
      lines.push(`  "${fn.name}": validate_${safeName},`)
    }
    lines.push("}")
    lines.push("")

    return lines.join("\n")
  }

  /**
   * Generate client-side type definitions.
   *
   * @returns Generated TypeScript source for client type definitions
   */
  generateClientTypes(): string {
    const lines: string[] = [
      "/* eslint-disable */",
      "/* Client-side type definitions. Do not edit. */",
      "",
      'import type { FunctionReference } from "./api.js"',
      "",
      "export interface ReactiveBaseClient {",
    ]

    // Generate query/mutation/action methods
    lines.push("  query<TArgs, TReturn>(ref: FunctionReference<TArgs, TReturn>, args: TArgs): Promise<TReturn>")
    lines.push("  mutation<TArgs, TReturn>(ref: FunctionReference<TArgs, TReturn>, args: TArgs): Promise<TReturn>")
    lines.push("  action<TArgs, TReturn>(ref: FunctionReference<TArgs, TReturn>, args: TArgs): Promise<TReturn>")
    lines.push(
      "  subscribe<TArgs, TReturn>(ref: FunctionReference<TArgs, TReturn>, args: TArgs, callback: (result: TReturn) => void): () => void",
    )
    lines.push("}")
    lines.push("")

    return lines.join("\n")
  }

  // ─── Incremental Tracking ───────────────────────────────────────────────

  /**
   * Check whether a file has changed based on its hash.
   *
   * @param path - File path to check
   * @param hash - Current hash of the file
   * @returns True if the file is new or its hash differs from the tracked value
   */
  hasFileChanged(path: string, hash: string): boolean {
    const entry = this.fileHashes.get(path)
    if (!entry) return true
    return entry.hash !== hash
  }

  /**
   * Update the stored hash for a file.
   *
   * @param path - File path to update
   * @param hash - New hash value to store
   */
  updateFileHash(path: string, hash: string): void {
    this.fileHashes.set(path, { path, hash, lastModified: Date.now() })
  }

  /**
   * Remove the stored hash for a file.
   *
   * @param path - File path to stop tracking
   */
  removeFileHash(path: string): void {
    this.fileHashes.delete(path)
  }

  /**
   * Get all tracked file hash entries.
   *
   * @returns Array of file hash entries currently being tracked
   */
  getTrackedFiles(): FileHashEntry[] {
    return Array.from(this.fileHashes.values())
  }

  // ─── Multi-Language SDK Generation ──────────────────────────────────────

  /**
   * Generate a client SDK stub for the specified language.
   *
   * @param config - SDK configuration including target language, package name, and server URL
   * @returns Generated SDK source code for the target language
   */
  generateSdkStub(config: RpcClientSdkConfig): string {
    switch (config.language) {
      case "python":
        return this.generatePythonSdk(config)
      case "go":
        return this.generateGoSdk(config)
      default:
        return this.generateApiModule()
    }
  }

  private generatePythonSdk(config: RpcClientSdkConfig): string {
    const lines: string[] = [
      `# Auto-generated ReactiveBase SDK for Python`,
      `# Package: ${config.packageName}`,
      "",
      "from typing import Any, Optional, List",
      "import httpx",
      "",
      `class ReactiveBaseClient:`,
      `    def __init__(self, url: str = "${config.serverUrl}"):`,
      `        self.url = url`,
      `        self.client = httpx.Client(base_url=url)`,
      "",
    ]

    for (const fn of this.functions.values()) {
      const pyName = fn.exportName.replace(/([A-Z])/g, "_$1").toLowerCase()
      lines.push(`    def ${fn.module}_${pyName}(self, **kwargs) -> Any:`)
      lines.push(
        `        return self.client.post("/api/v1/${fn.type}", json={"name": "${fn.name}", "args": kwargs}).json()`,
      )
      lines.push("")
    }

    return lines.join("\n")
  }

  private generateGoSdk(config: RpcClientSdkConfig): string {
    const lines: string[] = [
      `// Auto-generated ReactiveBase SDK for Go`,
      `// Package: ${config.packageName}`,
      "",
      `package ${config.packageName}`,
      "",
      `import "net/http"`,
      "",
      `type Client struct {`,
      `    BaseURL string`,
      `    HTTP    *http.Client`,
      `}`,
      "",
      `func NewClient(baseURL string) *Client {`,
      `    return &Client{BaseURL: baseURL, HTTP: http.DefaultClient}`,
      `}`,
      "",
    ]

    return lines.join("\n")
  }
}
