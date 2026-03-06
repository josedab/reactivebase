/**
 * Schema-to-GraphQL Compiler for ReactiveBase.
 * Compiles ReactiveBase schema definitions into a fully typed GraphQL schema
 * with per-field reactivity granularity and Relay-compatible pagination.
 *
 * Features:
 *   - Per-field subscription granularity (subscribe to specific columns)
 *   - Automatic schema stitching from multiple schema definitions
 *   - Relay-compatible cursor pagination with opaque cursors
 *   - Custom directive support (@reactive, @computed, @deprecated)
 *   - Schema introspection metadata
 *
 * Usage:
 *   const compiler = new SchemaCompiler({ schemas: [schema1, schema2] })
 *   const compiled = compiler.compile()
 *   console.log(compiled.sdl)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SchemaCompilerOptions {
  /** One or more ReactiveBase schema definitions to stitch together */
  schemas: SchemaInput[]
  /** Custom scalar mappings (validator type → GraphQL scalar) */
  customScalars?: Record<string, CustomScalarDefinition>
  /** Enable per-field reactivity subscriptions (default: true) */
  perFieldReactivity?: boolean
  /** Enable Relay-compatible cursor pagination (default: true) */
  relayPagination?: boolean
  /** Prefix for generated types to avoid collisions (default: none) */
  typePrefix?: string
  /** Include schema directives (default: true) */
  directives?: boolean
}

export interface SchemaInput {
  /** Schema name for stitching context */
  name: string
  tableNames: string[]
  tables: Record<
    string,
    {
      readonly columns: Record<
        string,
        {
          readonly type: string
          readonly isOptional: boolean
          readonly innerValidator?: { readonly type: string }
        }
      >
      readonly relations?: Record<
        string,
        {
          readonly table: string
          readonly type: "one" | "many"
          readonly foreignKey: string
        }
      >
    }
  >
}

export interface CustomScalarDefinition {
  /** GraphQL scalar name */
  name: string
  /** Description for schema documentation */
  description?: string
  /** TypeScript type mapping */
  tsType: string
}

export interface CompiledSchema {
  /** Complete SDL string */
  sdl: string
  /** Per-table type metadata */
  typeMap: Record<string, CompiledType>
  /** Subscription field → reactivity mapping */
  reactivityMap: Record<string, ReactivityMapping>
  /** Source schemas that were stitched */
  sourceSchemas: string[]
  /** Compilation metadata */
  metadata: CompilationMetadata
}

export interface CompiledType {
  name: string
  tableName: string
  sourceSchema: string
  fields: CompiledField[]
  hasRelayCursor: boolean
}

export interface CompiledField {
  name: string
  graphqlType: string
  tsType: string
  isReactive: boolean
  isRelation: boolean
  relatedType?: string
}

export interface ReactivityMapping {
  subscriptionField: string
  tableName: string
  /** Columns that trigger this subscription */
  watchedColumns: string[] | "*"
  granularity: "row" | "field" | "collection"
}

export interface CompilationMetadata {
  totalTypes: number
  totalFields: number
  totalSubscriptions: number
  stitchedSchemas: number
  compiledAt: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("")
}

function singularize(str: string): string {
  if (str.endsWith("ies")) return str.slice(0, -3) + "y"
  if (str.endsWith("ses")) return str.slice(0, -2)
  if (str.endsWith("s")) return str.slice(0, -1)
  return str
}

function validatorToGraphQL(validator: {
  type: string
  isOptional: boolean
  innerValidator?: { type: string }
}): string {
  const actual = validator.type === "optional" && validator.innerValidator ? validator.innerValidator : validator
  const required = !validator.isOptional ? "!" : ""

  switch (actual.type) {
    case "string":
    case "id":
    case "enum":
      return `String${required}`
    case "number":
      return `Float${required}`
    case "integer":
      return `Int${required}`
    case "boolean":
      return `Boolean${required}`
    case "timestamp":
      return `DateTime${required}`
    case "json":
      return `JSON${required}`
    case "vector":
      return `[Float!]${required}`
    case "array":
      return `[String!]${required}`
    case "geometry":
      return `GeoJSON${required}`
    case "timeseries":
      return `DateTime${required}`
    default:
      return `String${required}`
  }
}

function graphqlToTsType(gqlType: string): string {
  const isRequired = gqlType.endsWith("!")
  const base = gqlType.replace(/!/g, "")

  let tsType: string
  if (base.startsWith("[") && base.endsWith("]")) {
    const inner = base.slice(1, -1)
    tsType = `${graphqlToTsType(inner)}[]`
  } else {
    switch (base) {
      case "ID":
      case "String":
      case "DateTime":
        tsType = "string"
        break
      case "Int":
      case "Float":
        tsType = "number"
        break
      case "Boolean":
        tsType = "boolean"
        break
      case "JSON":
      case "GeoJSON":
        tsType = "unknown"
        break
      default:
        tsType = base
    }
  }

  return isRequired ? tsType : `${tsType} | null`
}

// ─── Compiler ────────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<SchemaCompilerOptions, "schemas">> = {
  customScalars: {},
  perFieldReactivity: true,
  relayPagination: true,
  typePrefix: "",
  directives: true,
}

export class SchemaCompiler {
  private options: Required<Omit<SchemaCompilerOptions, "schemas">>
  private schemas: SchemaInput[]
  private compiledCache: CompiledSchema | null = null

  constructor(options: SchemaCompilerOptions) {
    if (!options.schemas || options.schemas.length === 0) {
      throw new SchemaCompilerError("At least one schema is required")
    }
    this.schemas = options.schemas
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Compile all schemas into a unified GraphQL schema with stitching.
   */
  compile(): CompiledSchema {
    if (this.compiledCache) return this.compiledCache

    const lines: string[] = []
    const typeMap: Record<string, CompiledType> = {}
    const reactivityMap: Record<string, ReactivityMapping> = {}
    let totalFields = 0
    let totalSubscriptions = 0

    const queryFields: string[] = []
    const mutationFields: string[] = []
    const subscriptionFields: string[] = []

    // Directives
    if (this.options.directives) {
      lines.push("directive @reactive(fields: [String!]) on FIELD_DEFINITION")
      lines.push("directive @computed on FIELD_DEFINITION")
      lines.push("")
    }

    // Scalars
    lines.push("scalar DateTime")
    lines.push("scalar JSON")
    lines.push("scalar GeoJSON")
    for (const [, scalar] of Object.entries(this.options.customScalars)) {
      if (scalar.description) lines.push(`"""${scalar.description}"""`)
      lines.push(`scalar ${scalar.name}`)
    }
    lines.push("")

    // Deduplicate tables across schemas (last wins for stitching)
    const tableRegistry = new Map<string, { schema: SchemaInput; tableName: string }>()
    for (const schema of this.schemas) {
      for (const tableName of schema.tableNames) {
        tableRegistry.set(tableName, { schema, tableName })
      }
    }

    // Generate types for each table
    for (const [tableName, { schema }] of tableRegistry) {
      const table = schema.tables[tableName]
      if (!table) continue

      const prefix = this.options.typePrefix
      const typeName = `${prefix}${pascalCase(tableName)}`
      const compiledFields: CompiledField[] = []

      // Object type
      lines.push(`type ${typeName} {`)
      lines.push("  id: ID!")
      compiledFields.push({ name: "id", graphqlType: "ID!", tsType: "string", isReactive: false, isRelation: false })

      for (const [colName, validator] of Object.entries(table.columns)) {
        const gqlType = validatorToGraphQL(validator)
        const directive = this.options.perFieldReactivity ? " @reactive" : ""
        lines.push(`  ${colName}: ${gqlType}${directive}`)
        compiledFields.push({
          name: colName,
          graphqlType: gqlType,
          tsType: graphqlToTsType(gqlType),
          isReactive: this.options.perFieldReactivity,
          isRelation: false,
        })
        totalFields++
      }

      // Relation fields
      if (table.relations) {
        for (const [relName, rel] of Object.entries(table.relations)) {
          const relTypeName = `${prefix}${pascalCase(rel.table)}`
          const gqlType = rel.type === "many" ? `[${relTypeName}!]!` : relTypeName
          lines.push(`  ${relName}: ${gqlType}`)
          compiledFields.push({
            name: relName,
            graphqlType: gqlType,
            tsType: graphqlToTsType(gqlType),
            isReactive: false,
            isRelation: true,
            relatedType: relTypeName,
          })
        }
      }

      lines.push("}")
      lines.push("")

      // Input type
      lines.push(`input ${typeName}Input {`)
      for (const [colName, validator] of Object.entries(table.columns)) {
        const gqlType = validatorToGraphQL(validator).replace("!", "")
        lines.push(`  ${colName}: ${gqlType}`)
      }
      lines.push("}")
      lines.push("")

      // Where input
      const whereType = `${typeName}WhereInput`
      lines.push(`input ${whereType} {`)
      lines.push("  id: ID")
      for (const [colName, validator] of Object.entries(table.columns)) {
        const gqlType = validatorToGraphQL(validator).replace("!", "")
        lines.push(`  ${colName}: ${gqlType}`)
      }
      lines.push("}")
      lines.push("")

      // Relay pagination types
      if (this.options.relayPagination) {
        lines.push(`type ${typeName}Edge {`)
        lines.push(`  cursor: String!`)
        lines.push(`  node: ${typeName}!`)
        lines.push("}")
        lines.push("")

        lines.push(`type ${typeName}Connection {`)
        lines.push(`  edges: [${typeName}Edge!]!`)
        lines.push(`  pageInfo: PageInfo!`)
        lines.push(`  totalCount: Int!`)
        lines.push("}")
        lines.push("")
      }

      // Query fields
      if (this.options.relayPagination) {
        queryFields.push(
          `  ${tableName}(first: Int, after: String, last: Int, before: String, where: ${whereType}): ${typeName}Connection!`,
        )
      } else {
        queryFields.push(`  ${tableName}(limit: Int, offset: Int, where: ${whereType}): [${typeName}!]!`)
      }
      queryFields.push(`  ${singularize(tableName)}(id: ID!): ${typeName}`)

      // Mutations
      mutationFields.push(`  create${typeName}(input: ${typeName}Input!): ${typeName}!`)
      mutationFields.push(`  update${typeName}(id: ID!, input: ${typeName}Input!): ${typeName}!`)
      mutationFields.push(`  delete${typeName}(id: ID!): Boolean!`)

      // Subscriptions — row-level
      const rowSubField = `on${typeName}Changed`
      subscriptionFields.push(`  """Subscribe to changes on ${tableName}"""`)
      subscriptionFields.push(`  ${rowSubField}(where: ${whereType}): ${typeName}!`)
      reactivityMap[rowSubField] = {
        subscriptionField: rowSubField,
        tableName,
        watchedColumns: "*",
        granularity: "row",
      }
      totalSubscriptions++

      // Subscriptions — collection-level
      const collSubField = `on${typeName}List`
      subscriptionFields.push(`  """Subscribe to the full ${tableName} collection"""`)
      subscriptionFields.push(`  ${collSubField}(where: ${whereType}, limit: Int): [${typeName}!]!`)
      reactivityMap[collSubField] = {
        subscriptionField: collSubField,
        tableName,
        watchedColumns: "*",
        granularity: "collection",
      }
      totalSubscriptions++

      // Per-field subscriptions
      if (this.options.perFieldReactivity) {
        const fieldSubField = `on${typeName}FieldChanged`
        subscriptionFields.push(`  """Subscribe to specific field changes on ${tableName}"""`)
        subscriptionFields.push(`  ${fieldSubField}(id: ID!, fields: [String!]!): ${typeName}!`)
        reactivityMap[fieldSubField] = {
          subscriptionField: fieldSubField,
          tableName,
          watchedColumns: Object.keys(table.columns),
          granularity: "field",
        }
        totalSubscriptions++
      }

      typeMap[typeName] = {
        name: typeName,
        tableName,
        sourceSchema: schema.name,
        fields: compiledFields,
        hasRelayCursor: this.options.relayPagination,
      }
    }

    // PageInfo type (Relay)
    if (this.options.relayPagination) {
      lines.push("type PageInfo {")
      lines.push("  hasNextPage: Boolean!")
      lines.push("  hasPreviousPage: Boolean!")
      lines.push("  startCursor: String")
      lines.push("  endCursor: String")
      lines.push("}")
      lines.push("")
    }

    // Root types
    lines.push("type Query {")
    lines.push(queryFields.join("\n"))
    lines.push("}")
    lines.push("")

    lines.push("type Mutation {")
    lines.push(mutationFields.join("\n"))
    lines.push("}")
    lines.push("")

    if (subscriptionFields.length > 0) {
      lines.push("type Subscription {")
      lines.push(subscriptionFields.join("\n"))
      lines.push("}")
      lines.push("")
    }

    const compiled: CompiledSchema = {
      sdl: lines.join("\n"),
      typeMap,
      reactivityMap,
      sourceSchemas: this.schemas.map((s) => s.name),
      metadata: {
        totalTypes: Object.keys(typeMap).length,
        totalFields,
        totalSubscriptions,
        stitchedSchemas: this.schemas.length,
        compiledAt: Date.now(),
      },
    }

    this.compiledCache = compiled
    return compiled
  }

  /**
   * Generate TypeScript type definitions from the compiled schema.
   */
  generateTypeDefinitions(): string {
    const compiled = this.compile()
    const lines: string[] = ["// Auto-generated by @reactivebase/graphql SchemaCompiler", "// Do not edit manually", ""]

    for (const [, type] of Object.entries(compiled.typeMap)) {
      lines.push(`export interface ${type.name} {`)
      for (const field of type.fields) {
        if (!field.isRelation) {
          lines.push(`  ${field.name}: ${field.tsType};`)
        }
      }
      lines.push("}")
      lines.push("")

      lines.push(`export interface ${type.name}Input {`)
      for (const field of type.fields) {
        if (field.name !== "id" && !field.isRelation) {
          lines.push(`  ${field.name}?: ${field.tsType.replace(" | null", "")};`)
        }
      }
      lines.push("}")
      lines.push("")
    }

    return lines.join("\n")
  }

  /** Invalidate the compiled cache to recompile on next access. */
  invalidate(): void {
    this.compiledCache = null
  }
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class SchemaCompilerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SchemaCompilerError"
  }
}
