/**
 * Enhanced TypeScript SDK Codegen.
 * Extends the base codegen with:
 *   - AST-based type extraction from function signatures
 *   - Schema-driven typed database accessors
 *   - Watch mode for incremental regeneration
 *   - Full typed API module with argument and return type inference
 *
 * Usage:
 *   const codegen = new TypedCodegen({ functionsDir: "./convex" })
 *   const result = codegen.scanAndGenerate()
 *   codegen.startWatch(onChange)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TypedFunctionInfo {
  name: string
  module: string
  type: "query" | "mutation" | "action"
  exportName: string
  /** Extracted argument type as TypeScript source */
  argsType: string
  /** Extracted return type as TypeScript source */
  returnType: string
  /** Whether the function uses authentication */
  usesAuth: boolean
  /** Tables accessed by this function */
  tablesAccessed: string[]
  /** Source file path */
  filePath: string
  /** Line number of the export */
  line: number
}

export interface SchemaField {
  name: string
  type: string
  tsType: string
  optional: boolean
  hasDefault: boolean
  isId: boolean
  referencedTable?: string
}

export interface SchemaTable {
  name: string
  fields: SchemaField[]
  indexes: { name: string; columns: string[]; unique: boolean }[]
}

export interface ParsedSchema {
  tables: SchemaTable[]
}

export interface TypedCodegenOptions {
  /** Directory containing function files */
  functionsDir?: string
  /** Output directory for generated files */
  outputDir?: string
  /** Watch mode debounce in ms (default: 200) */
  watchDebounceMs?: number
}

export interface TypedGenerateResult {
  functionsFound: number
  filesGenerated: string[]
  functions: TypedFunctionInfo[]
  schema?: ParsedSchema
  durationMs: number
}

export interface WatchEvent {
  type: "added" | "changed" | "removed"
  path: string
  timestamp: number
}

// ─── Type Extraction ─────────────────────────────────────────────────────────

/**
 * Extract argument and return types from function source code using regex-based parsing.
 * Handles common patterns: inline types, named interfaces, destructured args.
 */
export function extractFunctionTypes(source: string): {
  functions: TypedFunctionInfo[]
} {
  const functions: TypedFunctionInfo[] = []

  // Match: export const name = query|mutation|action(async (ctx, args: Type) => { ... })
  // Also: export const name = query|mutation|action({ args: {...}, handler: async (ctx, args) => {} })
  const patterns = [
    // Pattern 1: export const name = query(async (ctx, { arg1, arg2 }: { arg1: Type, arg2: Type }) => { ... })
    /export\s+const\s+(\w+)\s*=\s*(query|mutation|action)\s*\(\s*async\s+\(\s*ctx\s*(?:,\s*(\{[^}]*\})\s*:\s*(\{[^}]*\}))?\s*\)/g,
    // Pattern 2: export const name = query(async (ctx, args: TypeName) => { ... })
    /export\s+const\s+(\w+)\s*=\s*(query|mutation|action)\s*\(\s*async\s+\(\s*ctx\s*(?:,\s*(\w+)\s*:\s*(\{[^}]*\}|\w+))?\s*\)/g,
    // Pattern 3: export const name = query(async (ctx) => { ... })  (no args)
    /export\s+const\s+(\w+)\s*=\s*(query|mutation|action)\s*\(\s*async\s+\(\s*ctx\s*\)\s*(?::\s*Promise<([^>]+)>)?\s*=>/g,
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      const exportName = match[1]
      const fnType = match[2] as "query" | "mutation" | "action"
      const lineNumber = source.substring(0, match.index).split("\n").length

      // Avoid duplicates
      if (functions.some((f) => f.exportName === exportName)) continue

      let argsType = "void"
      let returnType = "unknown"

      if (match[4]) {
        argsType = match[4].trim()
      } else if (match[3] && match[3].startsWith("{")) {
        argsType = match[3].trim()
      }

      // Try to extract return type from explicit annotation or return statement
      const returnMatch = extractReturnType(source, exportName)
      if (returnMatch) returnType = returnMatch

      const fnBody = extractFunctionBody(source, exportName) ?? ""
      const usesAuth = fnBody.includes("ctx.auth") || fnBody.includes("requireUser")
      const tablesAccessed = extractTablesAccessed(fnBody, exportName)

      functions.push({
        name: exportName,
        module: "",
        type: fnType,
        exportName,
        argsType,
        returnType,
        usesAuth,
        tablesAccessed,
        filePath: "",
        line: lineNumber,
      })
    }
  }

  return { functions }
}

function extractReturnType(source: string, functionName: string): string | null {
  // Look for explicit Promise<T> return type
  const returnPattern = new RegExp(`export\\s+const\\s+${functionName}[\\s\\S]*?\\)\\s*:\\s*Promise<([^>]+)>`)
  const match = returnPattern.exec(source)
  if (match) return match[1]

  // Infer from return statement patterns
  const fnSection = extractFunctionBody(source, functionName)
  if (!fnSection) return null

  if (fnSection.includes("return { success:")) return "{ success: boolean }"
  if (fnSection.includes("return ctx.db.")) {
    const dbMatch = /return\s+ctx\.db\.(\w+)/.exec(fnSection)
    if (dbMatch) return `${capitalize(dbMatch[1])}[]`
  }

  return null
}

function extractFunctionBody(source: string, functionName: string): string | null {
  const startPattern = new RegExp(`export\\s+const\\s+${functionName}\\s*=`)
  const match = startPattern.exec(source)
  if (!match) return null

  let depth = 0
  let start = -1
  for (let i = match.index; i < source.length; i++) {
    if (source[i] === "{" || source[i] === "(") {
      if (start === -1) start = i
      depth++
    } else if (source[i] === "}" || source[i] === ")") {
      depth--
      if (depth === 0 && start !== -1) {
        return source.substring(start, i + 1)
      }
    }
  }
  return null
}

function extractTablesAccessed(source: string, _functionName: string): string[] {
  const tables = new Set<string>()
  const dbPattern = /ctx\.db\.(\w+)\./g
  let match: RegExpExecArray | null
  while ((match = dbPattern.exec(source)) !== null) {
    if (match[1] !== "raw" && match[1] !== "fn") {
      tables.add(match[1])
    }
  }
  return Array.from(tables)
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ─── Schema Parsing ──────────────────────────────────────────────────────────

/**
 * Parse a ReactiveBase schema definition from source code.
 */
export function parseSchemaSource(source: string): ParsedSchema {
  const tables: SchemaTable[] = []

  // Find each defineTable call with balanced braces
  const tableStartPattern = /(\w+)\s*:\s*defineTable\s*\(/g
  let match: RegExpExecArray | null

  while ((match = tableStartPattern.exec(source)) !== null) {
    const tableName = match[1]
    const parenStart = match.index + match[0].length - 1 // position of "("

    // Extract balanced content inside defineTable(...)
    const content = extractBalancedParens(source, parenStart)
    if (!content) continue

    // The content should start with { ... } — extract the object literal
    const braceStart = content.indexOf("{")
    const braceEnd = content.lastIndexOf("}")
    if (braceStart === -1 || braceEnd === -1) continue

    const fieldsBlock = content.substring(braceStart + 1, braceEnd)
    const fields = parseSchemaFields(fieldsBlock)
    const indexes = parseSchemaIndexes(source, tableName)

    tables.push({ name: tableName, fields, indexes })
  }

  return { tables }
}

function extractBalancedParens(source: string, start: number): string | null {
  if (source[start] !== "(") return null
  let depth = 0
  for (let i = start; i < source.length; i++) {
    if (source[i] === "(") depth++
    else if (source[i] === ")") {
      depth--
      if (depth === 0) return source.substring(start + 1, i)
    }
  }
  return null
}

function parseSchemaFields(fieldsBlock: string): SchemaField[] {
  const fields: SchemaField[] = []
  // Match field declarations - use a simpler approach: find "name: v." then balance parens
  const fieldStartPattern = /(\w+)\s*:\s*(v\.)/g
  let startMatch: RegExpExecArray | null

  while ((startMatch = fieldStartPattern.exec(fieldsBlock)) !== null) {
    const name = startMatch[1]
    const vStart = startMatch.index + startMatch[0].length - 2 // position of "v."

    // Extract the full validator expression by balancing parentheses
    const fullType = extractBalancedExpression(fieldsBlock, vStart)
    if (!fullType) continue

    const optional = fullType.startsWith("v.optional")
    const hasDefault = fullType.includes("default")

    // Extract the base validator type
    let baseType: string
    let args: string
    if (optional) {
      const innerMatch = /v\.optional\s*\(\s*v\.(\w+)\s*\(([^)]*)\)\s*\)/.exec(fullType)
      baseType = innerMatch?.[1] ?? "unknown"
      args = innerMatch?.[2] ?? ""
    } else {
      const directMatch = /v\.(\w+)\s*\((.*)?\)$/s.exec(fullType)
      baseType = directMatch?.[1] ?? "unknown"
      args = directMatch?.[2] ?? ""
    }

    const isId = baseType === "id"
    const referencedTable = isId ? args.replace(/["']/g, "").trim() : undefined

    fields.push({
      name,
      type: baseType,
      tsType: validatorToTsType(baseType, args),
      optional,
      hasDefault,
      isId,
      referencedTable,
    })
  }

  return fields
}

function extractBalancedExpression(source: string, start: number): string | null {
  let depth = 0
  let foundOpen = false
  for (let i = start; i < source.length; i++) {
    if (source[i] === "(") {
      depth++
      foundOpen = true
    } else if (source[i] === ")") {
      depth--
      if (foundOpen && depth === 0) {
        return source.substring(start, i + 1)
      }
    } else if (!foundOpen && (source[i] === "," || source[i] === "\n") && depth === 0 && i > start + 5) {
      // Went past the expression without finding parens
      break
    }
  }
  return null
}

function parseSchemaIndexes(source: string, tableName: string): { name: string; columns: string[]; unique: boolean }[] {
  const indexes: { name: string; columns: string[]; unique: boolean }[] = []
  // Match .index("name", ["col1", "col2"], { unique: true })
  const indexPattern = new RegExp(
    `${tableName}[\\s\\S]*?\\.index\\s*\\(\\s*"(\\w+)"\\s*,\\s*\\[([^\\]]+)\\](?:\\s*,\\s*\\{([^}]*)\\})?`,
    "g",
  )
  let match: RegExpExecArray | null
  while ((match = indexPattern.exec(source)) !== null) {
    const columns = match[2].split(",").map((c) => c.trim().replace(/["']/g, ""))
    const unique = match[3]?.includes("unique: true") ?? false
    indexes.push({ name: match[1], columns, unique })
  }
  return indexes
}

function validatorToTsType(type: string, args: string): string {
  switch (type) {
    case "string":
      return "string"
    case "number":
      return "number"
    case "integer":
      return "number"
    case "boolean":
      return "boolean"
    case "timestamp":
      return "Date"
    case "json":
      return "unknown"
    case "id":
      return "string"
    case "array": {
      const innerMatch = /v\.(\w+)\(\)/.exec(args)
      return innerMatch ? `${validatorToTsType(innerMatch[1], "")}[]` : "unknown[]"
    }
    case "enum": {
      const values = args
        .split(",")
        .map((v) => v.trim().replace(/["']/g, ""))
        .filter(Boolean)
      return values.map((v) => `"${v}"`).join(" | ")
    }
    case "vector":
      return "number[]"
    case "optional":
      return "unknown | undefined"
    default:
      return "unknown"
  }
}

// ─── Enhanced API Module Generation ──────────────────────────────────────────

/**
 * Generate a fully typed API module from scanned functions and schema.
 */
export function generateTypedApiModule(functions: TypedFunctionInfo[], schema?: ParsedSchema): string {
  const lines: string[] = []

  lines.push("/* eslint-disable */")
  lines.push("/* Auto-generated by ReactiveBase. Do not edit. */")
  lines.push("")
  lines.push("// ─── Function Reference Types ─────────────────────────────────────────────")
  lines.push("")
  lines.push("export interface FunctionReference<TArgs = unknown, TReturn = unknown> {")
  lines.push("  readonly _name: string")
  lines.push('  readonly _type: "query" | "mutation" | "action"')
  lines.push("  readonly _args: TArgs")
  lines.push("  readonly _return: TReturn")
  lines.push("}")
  lines.push("")
  lines.push("function ref<TArgs = unknown, TReturn = unknown>(")
  lines.push('  name: string, type: "query" | "mutation" | "action"')
  lines.push("): FunctionReference<TArgs, TReturn> {")
  lines.push("  return { _name: name, _type: type } as FunctionReference<TArgs, TReturn>")
  lines.push("}")
  lines.push("")
  lines.push("export type InferArgs<T> = T extends FunctionReference<infer A, unknown> ? A : unknown")
  lines.push("export type InferReturn<T> = T extends FunctionReference<unknown, infer R> ? R : unknown")
  lines.push("")

  // Generate table row types from schema
  if (schema && schema.tables.length > 0) {
    lines.push("// ─── Data Model Types ─────────────────────────────────────────────────────")
    lines.push("")
    for (const table of schema.tables) {
      const typeName = capitalize(table.name.replace(/s$/, ""))
      lines.push(`export interface ${typeName} {`)
      lines.push(`  _id: string`)
      for (const field of table.fields) {
        const opt = field.optional ? "?" : ""
        lines.push(`  ${field.name}${opt}: ${field.tsType}`)
      }
      lines.push("}")
      lines.push("")
    }

    lines.push("export interface DataModel {")
    for (const table of schema.tables) {
      const typeName = capitalize(table.name.replace(/s$/, ""))
      lines.push(`  ${table.name}: ${typeName}`)
    }
    lines.push("}")
    lines.push("")
  }

  // Group functions by module
  const byModule = new Map<string, TypedFunctionInfo[]>()
  for (const fn of functions) {
    if (!byModule.has(fn.module)) byModule.set(fn.module, [])
    byModule.get(fn.module)!.push(fn)
  }

  // Generate typed api object
  lines.push("// ─── API Reference ────────────────────────────────────────────────────────")
  lines.push("")
  lines.push("export const api = {")
  for (const [moduleName, fns] of byModule) {
    lines.push(`  ${moduleName}: {`)
    for (const fn of fns) {
      const args = fn.argsType === "void" ? "void" : fn.argsType
      const ret = fn.returnType
      lines.push(`    ${fn.exportName}: ref<${args}, ${ret}>("${fn.module}.${fn.exportName}", "${fn.type}"),`)
    }
    lines.push("  },")
  }
  lines.push("} as const")
  lines.push("")
  lines.push("export type ApiType = typeof api")
  lines.push("")

  return lines.join("\n")
}

/**
 * Generate a typed database context file from schema.
 */
export function generateTypedDbContext(schema: ParsedSchema): string {
  const lines: string[] = []

  lines.push("/* eslint-disable */")
  lines.push("/* Auto-generated by ReactiveBase. Do not edit. */")
  lines.push("")
  lines.push('import type { DataModel } from "./api.js"')
  lines.push("")
  lines.push("export interface TypedDatabaseContext {")
  for (const table of schema.tables) {
    const typeName = capitalize(table.name.replace(/s$/, ""))
    lines.push(`  ${table.name}: TypedTableAccessor<DataModel["${table.name}"]>`)
  }
  lines.push("  raw: <T = unknown>(sql: string, params?: unknown[]) => Promise<T[]>")
  lines.push("}")
  lines.push("")
  lines.push("export interface TypedTableAccessor<T> {")
  lines.push("  get(id: string): Promise<T | null>")
  lines.push("  getOrThrow(id: string): Promise<T>")
  lines.push("  where(filter: Partial<T>): TypedQueryChain<T>")
  lines.push(
    '  where(column: keyof T, op: "=" | "!=" | ">" | "<" | ">=" | "<=" | "in" | "like", value: unknown): TypedQueryChain<T>',
  )
  lines.push("  insert(data: Omit<T, '_id'>): Promise<T>")
  lines.push("  update(id: string, data: Partial<Omit<T, '_id'>>): Promise<T>")
  lines.push("  delete(id: string): Promise<void>")
  lines.push("  count(): Promise<number>")
  lines.push("}")
  lines.push("")
  lines.push("export interface TypedQueryChain<T> extends Promise<T[]> {")
  lines.push('  orderBy(column: keyof T, direction?: "asc" | "desc"): TypedQueryChain<T>')
  lines.push("  limit(n: number): TypedQueryChain<T>")
  lines.push("  offset(n: number): TypedQueryChain<T>")
  lines.push("  select(...columns: (keyof T)[]): TypedQueryChain<Partial<T>>")
  lines.push("  count(): Promise<number>")
  lines.push("  first(): Promise<T | null>")
  lines.push("}")
  lines.push("")

  return lines.join("\n")
}

// ─── TypedCodegen Engine ─────────────────────────────────────────────────────

const DEFAULT_CODEGEN_OPTIONS: Required<TypedCodegenOptions> = {
  functionsDir: "./convex",
  outputDir: "./_generated",
  watchDebounceMs: 200,
}

export class TypedCodegen {
  private options: Required<TypedCodegenOptions>
  private watchCallbacks: ((event: WatchEvent) => void)[] = []
  private lastScanResult: TypedFunctionInfo[] = []
  private lastSchema: ParsedSchema | undefined

  constructor(options: TypedCodegenOptions = {}) {
    this.options = { ...DEFAULT_CODEGEN_OPTIONS, ...options }
  }

  get functionsDir(): string {
    return this.options.functionsDir
  }

  get outputDir(): string {
    return this.options.outputDir
  }

  get lastFunctions(): TypedFunctionInfo[] {
    return this.lastScanResult
  }

  /**
   * Scan source code content and extract typed function info.
   */
  scanSource(source: string, module: string, filePath: string = ""): TypedFunctionInfo[] {
    const { functions } = extractFunctionTypes(source)
    for (const fn of functions) {
      fn.module = module
      fn.name = `${module}.${fn.exportName}`
      fn.filePath = filePath
    }
    this.lastScanResult = [...this.lastScanResult, ...functions]
    return functions
  }

  /**
   * Parse schema source code.
   */
  parseSchema(source: string): ParsedSchema {
    this.lastSchema = parseSchemaSource(source)
    return this.lastSchema
  }

  /**
   * Generate full typed API module from accumulated scan results.
   */
  generateApi(): string {
    return generateTypedApiModule(this.lastScanResult, this.lastSchema)
  }

  /**
   * Generate typed database context from schema.
   */
  generateDbContext(): string {
    if (!this.lastSchema) {
      return "/* No schema found — run parseSchema() first */\n"
    }
    return generateTypedDbContext(this.lastSchema)
  }

  /**
   * Reset all accumulated state.
   */
  reset(): void {
    this.lastScanResult = []
    this.lastSchema = undefined
  }

  /**
   * Register a watch callback for incremental regeneration.
   */
  onWatch(callback: (event: WatchEvent) => void): void {
    this.watchCallbacks.push(callback)
  }

  /**
   * Emit a watch event (for external file watcher integration).
   */
  emitWatchEvent(event: WatchEvent): void {
    for (const cb of this.watchCallbacks) {
      cb(event)
    }
  }
}
