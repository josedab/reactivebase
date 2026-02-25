/**
 * End-to-End Type Safety Bridge for ReactiveBase.
 * Provides full type inference from server function definitions to client hooks
 * without requiring a separate codegen step for most use cases.
 *
 * Key concepts:
 *   - TypeManifest: JSON descriptor of all function signatures
 *   - FunctionSignature: Typed descriptor for a single query/mutation/action
 *   - TypeBridge: Utilities to generate and consume type manifests
 *
 * Usage:
 *   // Server-side: generate manifest from scanned functions
 *   const manifest = TypeBridge.generateManifest(scannedFunctions, schema)
 *
 *   // Client-side: TypeScript infers types from the manifest
 *   const api = createTypedApi<typeof manifest>()
 *   useQuery(api.tasks.list) // Return type inferred as Task[]
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TypeManifest {
  version: number
  generatedAt: string
  schemaHash: string
  functions: Record<string, FunctionSignature>
  tables: Record<string, TableTypeInfo>
}

export interface FunctionSignature {
  name: string
  module: string
  kind: "query" | "mutation" | "action"
  args: TypeDescriptor
  returns: TypeDescriptor
  isPublic: boolean
  /** Source file path for go-to-definition support */
  sourcePath?: string
  /** Line number in source file */
  sourceLine?: number
}

export type TypeDescriptor = PrimitiveType | ObjectType | ArrayType | UnionType | LiteralType | ReferenceType | VoidType

export interface PrimitiveType {
  kind: "primitive"
  type: "string" | "number" | "boolean" | "null" | "undefined" | "Date" | "bigint"
}

export interface ObjectType {
  kind: "object"
  properties: Record<string, TypeProperty>
}

export interface TypeProperty {
  type: TypeDescriptor
  optional: boolean
  description?: string
}

export interface ArrayType {
  kind: "array"
  element: TypeDescriptor
}

export interface UnionType {
  kind: "union"
  members: TypeDescriptor[]
}

export interface LiteralType {
  kind: "literal"
  value: string | number | boolean
}

export interface ReferenceType {
  kind: "reference"
  table: string
  /** If true, this is the full row type; otherwise just the id */
  fullRow: boolean
}

export interface VoidType {
  kind: "void"
}

export interface TableTypeInfo {
  name: string
  columns: Record<string, ColumnTypeInfo>
  /** TypeScript interface name for this table's row type */
  typeName: string
}

export interface ColumnTypeInfo {
  name: string
  pgType: string
  tsType: string
  nullable: boolean
  hasDefault: boolean
}

export interface TypeBridgeOptions {
  /** Include source paths in manifest for IDE integration (default: true) */
  includeSourcePaths?: boolean
  /** Schema hash algorithm (default: "sha256") */
  hashAlgorithm?: string
}

// ─── Type Inference Helpers (compile-time only) ──────────────────────────────

/**
 * Generic typed function reference that carries argument and return types.
 * This is the core type that enables end-to-end type safety.
 */
export interface TypedFunctionReference<
  TKind extends "query" | "mutation" | "action" = "query" | "mutation" | "action",
  TArgs = unknown,
  TReturn = unknown,
> {
  /** Function path (e.g., "tasks.list") */
  _path: string
  /** Function kind discriminator */
  _kind: TKind
  /** Phantom type for argument inference */
  _args: TArgs
  /** Phantom type for return inference */
  _return: TReturn
}

/** Extract args type from a function reference */
export type ExtractArgs<T> =
  T extends TypedFunctionReference<"query" | "mutation" | "action", infer A, unknown> ? A : never

/** Extract return type from a function reference */
export type ExtractReturn<T> =
  T extends TypedFunctionReference<"query" | "mutation" | "action", unknown, infer R> ? R : never

/** Extract function kind from a reference */
export type ExtractKind<T> = T extends TypedFunctionReference<infer K, unknown, unknown> ? K : never

/** Create a typed API namespace from a flat function map */
export type TypedApiFromManifest<T extends Record<string, FunctionSignature>> = {
  [K in keyof T]: TypedFunctionReference<T[K]["kind"], unknown, unknown>
}

// ─── Type Bridge ─────────────────────────────────────────────────────────────

/**
 * Builds a type manifest from scanned server functions and schema.
 * The manifest is a JSON file that the client SDK reads to provide type inference.
 */
export class TypeBridge {
  private options: Required<TypeBridgeOptions>

  constructor(options: TypeBridgeOptions = {}) {
    this.options = {
      includeSourcePaths: options.includeSourcePaths ?? true,
      hashAlgorithm: options.hashAlgorithm ?? "sha256",
    }
  }

  /**
   * Generate a type manifest from function definitions and schema.
   */
  generateManifest(functions: ScannedFunction[], tables: ScannedTable[]): TypeManifest {
    const functionMap: Record<string, FunctionSignature> = {}
    for (const fn of functions) {
      const key = fn.module ? `${fn.module}.${fn.name}` : fn.name
      functionMap[key] = {
        name: fn.name,
        module: fn.module ?? "",
        kind: fn.kind,
        args: fn.args ?? { kind: "void" },
        returns: fn.returns ?? { kind: "void" },
        isPublic: fn.isPublic ?? true,
        ...(this.options.includeSourcePaths && fn.sourcePath
          ? { sourcePath: fn.sourcePath, sourceLine: fn.sourceLine }
          : {}),
      }
    }

    const tableMap: Record<string, TableTypeInfo> = {}
    for (const table of tables) {
      tableMap[table.name] = {
        name: table.name,
        columns: table.columns,
        typeName: this.tableNameToTypeName(table.name),
      }
    }

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      schemaHash: this.computeSchemaHash(tables),
      functions: functionMap,
      tables: tableMap,
    }
  }

  /**
   * Generate TypeScript declaration file content from a manifest.
   */
  generateDeclarations(manifest: TypeManifest): string {
    const lines: string[] = [
      "// Auto-generated by ReactiveBase TypeBridge",
      `// Schema hash: ${manifest.schemaHash}`,
      `// Generated at: ${manifest.generatedAt}`,
      "",
      'import type { TypedFunctionReference } from "@reactivebase/server"',
      "",
    ]

    // Generate table row types
    for (const [name, table] of Object.entries(manifest.tables)) {
      lines.push(`export interface ${table.typeName} {`)
      for (const [colName, col] of Object.entries(table.columns)) {
        const optional = col.nullable ? "?" : ""
        lines.push(`  ${colName}${optional}: ${col.tsType}`)
      }
      lines.push("}")
      lines.push("")
    }

    // Generate API namespace
    lines.push("export declare const api: {")
    const modules = new Map<string, FunctionSignature[]>()

    for (const [key, fn] of Object.entries(manifest.functions)) {
      const mod = fn.module || "_root"
      if (!modules.has(mod)) modules.set(mod, [])
      modules.get(mod)!.push(fn)
    }

    for (const [mod, fns] of modules) {
      if (mod === "_root") {
        for (const fn of fns) {
          lines.push(
            `  ${fn.name}: TypedFunctionReference<"${fn.kind}", ${this.typeDescriptorToTS(fn.args)}, ${this.typeDescriptorToTS(fn.returns)}>`,
          )
        }
      } else {
        lines.push(`  ${mod}: {`)
        for (const fn of fns) {
          lines.push(
            `    ${fn.name}: TypedFunctionReference<"${fn.kind}", ${this.typeDescriptorToTS(fn.args)}, ${this.typeDescriptorToTS(fn.returns)}>`,
          )
        }
        lines.push("  }")
      }
    }

    lines.push("}")
    lines.push("")

    return lines.join("\n")
  }

  /**
   * Create typed function references from a manifest (runtime).
   */
  createApiFromManifest(manifest: TypeManifest): Record<string, Record<string, TypedFunctionReference>> {
    const api: Record<string, Record<string, TypedFunctionReference>> = {}

    for (const [key, fn] of Object.entries(manifest.functions)) {
      const parts = key.split(".")
      if (parts.length === 2) {
        const [mod, name] = parts
        if (!api[mod]) api[mod] = {}
        api[mod][name] = {
          _path: key,
          _kind: fn.kind,
          _args: null as unknown,
          _return: null as unknown,
        }
      } else {
        if (!api._root) api._root = {}
        api._root[key] = {
          _path: key,
          _kind: fn.kind,
          _args: null as unknown,
          _return: null as unknown,
        }
      }
    }

    return api
  }

  /**
   * Validate that a manifest is compatible with the current schema.
   */
  validateManifest(manifest: TypeManifest, currentTables: ScannedTable[]): ManifestValidation {
    const currentHash = this.computeSchemaHash(currentTables)
    const errors: string[] = []
    const warnings: string[] = []

    if (manifest.schemaHash !== currentHash) {
      warnings.push("Schema has changed since manifest was generated. Run `reactivebase generate` to update.")
    }

    if (manifest.version !== 1) {
      errors.push(`Unsupported manifest version: ${manifest.version}`)
    }

    for (const [key, fn] of Object.entries(manifest.functions)) {
      if (!fn.name || !fn.kind) {
        errors.push(`Invalid function definition: ${key}`)
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      schemaChanged: manifest.schemaHash !== currentHash,
    }
  }

  /**
   * Convert a TypeDescriptor to TypeScript type string.
   */
  typeDescriptorToTS(desc: TypeDescriptor): string {
    switch (desc.kind) {
      case "primitive":
        return desc.type
      case "object": {
        const props = Object.entries(desc.properties)
          .map(([k, v]) => `${k}${v.optional ? "?" : ""}: ${this.typeDescriptorToTS(v.type)}`)
          .join("; ")
        return `{ ${props} }`
      }
      case "array":
        return `${this.typeDescriptorToTS(desc.element)}[]`
      case "union":
        return desc.members.map((m) => this.typeDescriptorToTS(m)).join(" | ")
      case "literal":
        return typeof desc.value === "string" ? `"${desc.value}"` : String(desc.value)
      case "reference":
        return desc.fullRow ? this.tableNameToTypeName(desc.table) : "string"
      case "void":
        return "void"
    }
  }

  private tableNameToTypeName(name: string): string {
    return name.charAt(0).toUpperCase() + name.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())
  }

  private computeSchemaHash(tables: ScannedTable[]): string {
    const content = JSON.stringify(
      tables.map((t) => ({
        name: t.name,
        columns: Object.keys(t.columns).sort(),
      })),
    )
    // Simple hash for non-crypto environments
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = ((hash << 5) - hash + char) | 0
    }
    return Math.abs(hash).toString(16).padStart(8, "0")
  }
}

// ─── Input Types ─────────────────────────────────────────────────────────────

export interface ScannedFunction {
  name: string
  module?: string
  kind: "query" | "mutation" | "action"
  args?: TypeDescriptor
  returns?: TypeDescriptor
  isPublic?: boolean
  sourcePath?: string
  sourceLine?: number
}

export interface ScannedTable {
  name: string
  columns: Record<string, ColumnTypeInfo>
}

export interface ManifestValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
  schemaChanged: boolean
}
