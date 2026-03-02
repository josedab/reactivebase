/**
 * Enhanced GraphQL schema generation from ReactiveBase function descriptors.
 * Generates GraphQL SDL with Query, Mutation, and Subscription types,
 * auto-generated input/output types, and developer tooling pages.
 *
 * Usage:
 *   const generator = new GraphQLSchemaGenerator()
 *   const result = generator.generateSchema(functions)
 *   const html = generator.generateGraphQLPlaygroundHTML("/graphql")
 */

import type { FunctionDescriptor, ArgSchema, ReturnSchema } from "./openapi-generator.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GeneratedGraphQLResult {
  sdl: string
  queryFields: string[]
  mutationFields: string[]
  subscriptionFields: string[]
  types: string[]
  inputTypes: string[]
}

export interface GraphQLSchemaGeneratorOptions {
  /** Enable subscriptions for query functions (default: true) */
  subscriptions?: boolean
  /** Custom scalar definitions */
  customScalars?: Record<string, string>
}

export interface IntrospectionResponse {
  data: {
    __schema: {
      queryType: { name: string }
      mutationType: { name: string } | null
      subscriptionType: { name: string } | null
      types: IntrospectionType[]
    }
  }
}

interface IntrospectionType {
  kind: string
  name: string
  fields: IntrospectionField[] | null
  inputFields: IntrospectionInputValue[] | null
}

interface IntrospectionField {
  name: string
  args: IntrospectionInputValue[]
  type: IntrospectionTypeRef
}

interface IntrospectionInputValue {
  name: string
  type: IntrospectionTypeRef
}

interface IntrospectionTypeRef {
  kind: string
  name: string | null
  ofType: IntrospectionTypeRef | null
}

// ─── Type mapping ────────────────────────────────────────────────────────────

const TS_TO_GRAPHQL: Record<string, string> = {
  string: "String",
  number: "Float",
  integer: "Int",
  boolean: "Boolean",
  object: "JSON",
  array: "JSON",
}

function mapTypeToGraphQL(type: string): string {
  return TS_TO_GRAPHQL[type] ?? "String"
}

function argSchemaToGraphQLType(arg: ArgSchema): string {
  if (arg.type === "array") {
    const inner = arg.items?.type ? mapTypeToGraphQL(arg.items.type) : "String"
    return `[${inner}]`
  }
  if (arg.enum) return "String"
  return mapTypeToGraphQL(arg.type)
}

function returnSchemaToGraphQLType(ret: ReturnSchema, typeName: string): string {
  if (ret.type === "array") {
    if (ret.items?.properties) return `[${typeName}Output]`
    const inner = ret.items?.type ? mapTypeToGraphQL(ret.items.type) : "String"
    return `[${inner}]`
  }
  if (ret.type === "object" && ret.properties) return `${typeName}Output`
  return mapTypeToGraphQL(ret.type)
}

// ─── Generator ───────────────────────────────────────────────────────────────

export class GraphQLSchemaGenerator {
  private options: Required<GraphQLSchemaGeneratorOptions>

  /**
   * @param options - Generator options including subscription toggle and custom scalars
   */
  constructor(options: GraphQLSchemaGeneratorOptions = {}) {
    this.options = {
      subscriptions: options.subscriptions !== false,
      customScalars: options.customScalars ?? {},
    }
  }

  /**
   * Generate GraphQL SDL from function descriptors.
   * Query functions → Query type fields.
   * Mutation functions → Mutation type fields.
   * Subscription-enabled queries → Subscription type fields.
   *
   * @param functions - The array of function descriptors to generate the schema from
   * @returns The generated GraphQL result including SDL, field lists, and type names
   */
  generateSchema(functions: FunctionDescriptor[]): GeneratedGraphQLResult {
    const lines: string[] = []
    const queryFields: string[] = []
    const mutationFields: string[] = []
    const subscriptionFields: string[] = []
    const types: string[] = []
    const inputTypes: string[] = []

    // Scalars
    lines.push("scalar JSON")
    lines.push("scalar DateTime")
    for (const [name, desc] of Object.entries(this.options.customScalars)) {
      lines.push(`"""${desc}"""`)
      lines.push(`scalar ${name}`)
    }
    lines.push("")

    // Generate input/output types per function
    for (const fn of functions) {
      const typeName = pascalCase(fn.name)

      // Input type for args (if any args exist)
      const argEntries = Object.entries(fn.args)
      if (argEntries.length > 0 && fn.type !== "query") {
        const inputName = `${typeName}Input`
        lines.push(`input ${inputName} {`)
        for (const [argName, argSchema] of argEntries) {
          const gqlType = argSchemaToGraphQLType(argSchema)
          const bang = argSchema.required !== false ? "!" : ""
          lines.push(`  ${argName}: ${gqlType}${bang}`)
        }
        lines.push("}")
        lines.push("")
        inputTypes.push(inputName)
      }

      // Output type for complex return types
      const ret = fn.returns
      if (ret.type === "object" && ret.properties) {
        const outputName = `${typeName}Output`
        lines.push(`type ${outputName} {`)
        for (const [propName, propSchema] of Object.entries(ret.properties)) {
          const gqlType = argSchemaToGraphQLType(propSchema)
          lines.push(`  ${propName}: ${gqlType}`)
        }
        lines.push("}")
        lines.push("")
        types.push(outputName)
      }

      // Array of objects output type
      if (ret.type === "array" && ret.items?.properties) {
        const outputName = `${typeName}Output`
        lines.push(`type ${outputName} {`)
        for (const [propName, propSchema] of Object.entries(ret.items.properties)) {
          const gqlType = argSchemaToGraphQLType(propSchema)
          lines.push(`  ${propName}: ${gqlType}`)
        }
        lines.push("}")
        lines.push("")
        types.push(outputName)
      }
    }

    // Query type
    const queryFns = functions.filter((f) => f.type === "query")
    if (queryFns.length > 0) {
      lines.push("type Query {")
      for (const fn of queryFns) {
        const typeName = pascalCase(fn.name)
        const returnType = returnSchemaToGraphQLType(fn.returns, typeName)
        const args = Object.entries(fn.args)
          .map(([name, schema]) => {
            const gqlType = argSchemaToGraphQLType(schema)
            const bang = schema.required !== false ? "!" : ""
            return `${name}: ${gqlType}${bang}`
          })
          .join(", ")

        const argsStr = args ? `(${args})` : ""
        if (fn.description) lines.push(`  """${fn.description}"""`)
        lines.push(`  ${fn.name}${argsStr}: ${returnType}`)
        queryFields.push(fn.name)
      }
      lines.push("}")
      lines.push("")
    }

    // Mutation type
    const mutationFns = functions.filter((f) => f.type === "mutation" || f.type === "action")
    if (mutationFns.length > 0) {
      lines.push("type Mutation {")
      for (const fn of mutationFns) {
        const typeName = pascalCase(fn.name)
        const returnType = returnSchemaToGraphQLType(fn.returns, typeName)
        const inputName = `${typeName}Input`
        const hasArgs = Object.keys(fn.args).length > 0

        const argsStr = hasArgs ? `(input: ${inputName}!)` : ""
        if (fn.description) lines.push(`  """${fn.description}"""`)
        lines.push(`  ${fn.name}${argsStr}: ${returnType}`)
        mutationFields.push(fn.name)
      }
      lines.push("}")
      lines.push("")
    }

    // Subscription type (query functions get subscription counterparts)
    if (this.options.subscriptions && queryFns.length > 0) {
      lines.push("type Subscription {")
      for (const fn of queryFns) {
        const typeName = pascalCase(fn.name)
        const returnType = returnSchemaToGraphQLType(fn.returns, typeName)
        const subName = `on${typeName}Changed`
        const args = Object.entries(fn.args)
          .map(([name, schema]) => {
            const gqlType = argSchemaToGraphQLType(schema)
            return `${name}: ${gqlType}`
          })
          .join(", ")

        const argsStr = args ? `(${args})` : ""
        lines.push(`  ${subName}${argsStr}: ${returnType}`)
        subscriptionFields.push(subName)
      }
      lines.push("}")
      lines.push("")
    }

    return {
      sdl: lines.join("\n"),
      queryFields,
      mutationFields,
      subscriptionFields,
      types,
      inputTypes,
    }
  }

  /**
   * Generate an HTML page serving a GraphQL playground (GraphiQL-style).
   *
   * @param endpoint - The GraphQL endpoint URL to connect the playground to
   * @returns An HTML string containing a self-contained GraphiQL playground page
   */
  generateGraphQLPlaygroundHTML(endpoint: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>GraphQL Playground - ReactiveBase</title>
  <style>
    body { height: 100%; margin: 0; width: 100%; overflow: hidden; }
    #graphiql { height: 100vh; }
  </style>
  <link rel="stylesheet" href="https://unpkg.com/graphiql/graphiql.min.css" />
</head>
<body>
  <div id="graphiql"></div>
  <script crossorigin src="https://unpkg.com/react/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom/umd/react-dom.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/graphiql/graphiql.min.js"></script>
  <script>
    const fetcher = GraphiQL.createFetcher({ url: '${endpoint}' });
    ReactDOM.render(
      React.createElement(GraphiQL, { fetcher }),
      document.getElementById('graphiql')
    );
  </script>
</body>
</html>`
  }

  /**
   * Generate a basic introspection response for the given functions.
   *
   * @param functions - The array of function descriptors to build the introspection from
   * @returns A GraphQL introspection response object
   */
  generateIntrospectionResponse(functions: FunctionDescriptor[]): IntrospectionResponse {
    const schema = this.generateSchema(functions)
    const types: IntrospectionType[] = []

    // Built-in scalars
    for (const scalar of ["String", "Int", "Float", "Boolean", "ID", "JSON", "DateTime"]) {
      types.push({ kind: "SCALAR", name: scalar, fields: null, inputFields: null })
    }

    // Query type
    if (schema.queryFields.length > 0) {
      types.push({
        kind: "OBJECT",
        name: "Query",
        fields: schema.queryFields.map((name) => {
          const fn = functions.find((f) => f.name === name)!
          return {
            name,
            args: Object.entries(fn.args).map(([argName, argSchema]) => ({
              name: argName,
              type: makeTypeRef(argSchemaToGraphQLType(argSchema), argSchema.required !== false),
            })),
            type: makeTypeRef(returnSchemaToGraphQLType(fn.returns, pascalCase(fn.name)), false),
          }
        }),
        inputFields: null,
      })
    }

    // Mutation type
    if (schema.mutationFields.length > 0) {
      types.push({
        kind: "OBJECT",
        name: "Mutation",
        fields: schema.mutationFields.map((name) => {
          const fn = functions.find((f) => f.name === name)!
          return {
            name,
            args:
              Object.keys(fn.args).length > 0
                ? [{ name: "input", type: makeTypeRef(`${pascalCase(fn.name)}Input`, true) }]
                : [],
            type: makeTypeRef(returnSchemaToGraphQLType(fn.returns, pascalCase(fn.name)), false),
          }
        }),
        inputFields: null,
      })
    }

    // Subscription type
    if (schema.subscriptionFields.length > 0) {
      types.push({
        kind: "OBJECT",
        name: "Subscription",
        fields: schema.subscriptionFields.map((name) => ({
          name,
          args: [],
          type: makeTypeRef("String", false),
        })),
        inputFields: null,
      })
    }

    return {
      data: {
        __schema: {
          queryType: { name: "Query" },
          mutationType: schema.mutationFields.length > 0 ? { name: "Mutation" } : null,
          subscriptionType: schema.subscriptionFields.length > 0 ? { name: "Subscription" } : null,
          types,
        },
      },
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pascalCase(str: string): string {
  return str
    .split(/[-_.]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("")
}

function makeTypeRef(typeName: string, nonNull: boolean): IntrospectionTypeRef {
  // Handle list types
  if (typeName.startsWith("[") && typeName.endsWith("]")) {
    const inner = typeName.slice(1, -1)
    return {
      kind: "LIST",
      name: null,
      ofType: { kind: "SCALAR", name: inner, ofType: null },
    }
  }

  const ref: IntrospectionTypeRef = { kind: "SCALAR", name: typeName, ofType: null }
  if (nonNull) {
    return { kind: "NON_NULL", name: null, ofType: ref }
  }
  return ref
}
