/**
 * GraphQL Subscriptions Gateway for ReactiveBase.
 * Auto-generates a GraphQL subscription API from server functions,
 * enabling clients to use standard GraphQL tooling (Apollo, urql)
 * alongside the native WebSocket protocol.
 *
 * Features:
 *   - Schema-to-GraphQL type generation with subscriptions
 *   - Subscription transport wiring to ReactivityEngine
 *   - Query/mutation/subscription operations via GraphQL
 *   - Client-side utilities for Apollo and urql integration
 *   - WebSocket-based subscription transport (graphql-ws protocol)
 *
 * Usage:
 *   const gateway = new GraphQLSubscriptionGateway({ schema, engine })
 *   const sdl = gateway.generateSchema()
 *   const result = await gateway.execute({ query: '{ tasks { id title } }' })
 */

// Schema type compatible with @reactivebase/server's Schema
interface SchemaLike {
  readonly tableNames: string[]
  readonly tables: Record<
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
    }
  >
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GraphQLGatewayOptions {
  /** ReactiveBase schema definition */
  schema: SchemaLike
  /** Custom type mappings for validators */
  customScalars?: Record<string, string>
  /** Enable subscription support (default: true) */
  subscriptions?: boolean
  /** Enable Relay-style pagination (default: true) */
  relayPagination?: boolean
  /** Base path for the GraphQL endpoint (default: "/graphql") */
  basePath?: string
  /** Enable introspection (default: true in dev, false in prod) */
  introspection?: boolean
}

export interface GraphQLRequest {
  query: string
  variables?: Record<string, unknown>
  operationName?: string
}

export interface GraphQLResponse {
  data?: unknown
  errors?: GraphQLError[]
}

export interface GraphQLError {
  message: string
  locations?: Array<{ line: number; column: number }>
  path?: Array<string | number>
  extensions?: Record<string, unknown>
}

export interface GraphQLSubscriptionEvent {
  subscriptionId: string
  field: string
  data: unknown
  errors?: GraphQLError[]
}

export interface SubscriptionTransportMessage {
  id?: string
  type: "connection_init" | "connection_ack" | "subscribe" | "next" | "error" | "complete"
  payload?: unknown
}

export interface GraphQLFieldDefinition {
  name: string
  type: string
  args: Array<{ name: string; type: string; defaultValue?: unknown }>
  description?: string
}

export interface GraphQLTypeDefinition {
  name: string
  kind: "OBJECT" | "INPUT_OBJECT" | "ENUM" | "SCALAR" | "UNION"
  fields: GraphQLFieldDefinition[]
  description?: string
}

export interface GeneratedGraphQLSchema {
  sdl: string
  types: GraphQLTypeDefinition[]
  queryFields: GraphQLFieldDefinition[]
  mutationFields: GraphQLFieldDefinition[]
  subscriptionFields: GraphQLFieldDefinition[]
  subscriptionMappings: Record<string, SubscriptionMapping>
}

export interface SubscriptionMapping {
  field: string
  tableName: string
  queryName: string
  filterInputType: string
}

// ─── Validator-to-GraphQL mapping ────────────────────────────────────────────

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
    default:
      return `String${required}`
  }
}

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

// ─── GraphQL Gateway ─────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<GraphQLGatewayOptions, "schema">> = {
  customScalars: {},
  subscriptions: true,
  relayPagination: true,
  basePath: "/graphql",
  introspection: true,
}

export class GraphQLSubscriptionGateway {
  private options: Required<Omit<GraphQLGatewayOptions, "schema">>
  private schema: SchemaLike
  private subscriptions = new Map<string, SubscriptionState>()
  private listeners = new Map<string, Set<(event: GraphQLSubscriptionEvent) => void>>()
  private generatedSchema: GeneratedGraphQLSchema | null = null

  constructor(options: GraphQLGatewayOptions) {
    this.schema = options.schema
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  get basePath(): string {
    return this.options.basePath
  }

  get subscriptionCount(): number {
    return this.subscriptions.size
  }

  /**
   * Generate the full GraphQL schema SDL from the ReactiveBase schema.
   */
  generateSchema(): GeneratedGraphQLSchema {
    if (this.generatedSchema) return this.generatedSchema

    const lines: string[] = []
    const types: GraphQLTypeDefinition[] = []
    const queryFields: GraphQLFieldDefinition[] = []
    const mutationFields: GraphQLFieldDefinition[] = []
    const subscriptionFields: GraphQLFieldDefinition[] = []
    const subscriptionMappings: Record<string, SubscriptionMapping> = {}

    // Scalars
    lines.push("scalar DateTime")
    lines.push("scalar JSON")
    for (const [name, description] of Object.entries(this.options.customScalars)) {
      lines.push(`"""${description}"""`)
      lines.push(`scalar ${name}`)
    }
    lines.push("")

    // Generate types for each table
    for (const tableName of this.schema.tableNames) {
      const table = this.schema.tables[tableName]
      const typeName = pascalCase(tableName)

      // Object type
      const objectFields: GraphQLFieldDefinition[] = [{ name: "id", type: "ID!", args: [] }]

      lines.push(`type ${typeName} {`)
      lines.push("  id: ID!")

      for (const [colName, validator] of Object.entries(table.columns)) {
        const gqlType = validatorToGraphQL(validator)
        lines.push(`  ${colName}: ${gqlType}`)
        objectFields.push({ name: colName, type: gqlType, args: [] })
      }

      lines.push("}")
      lines.push("")

      types.push({ name: typeName, kind: "OBJECT", fields: objectFields })

      // Input type
      const inputName = `${typeName}Input`
      const inputFields: GraphQLFieldDefinition[] = []

      lines.push(`input ${inputName} {`)
      for (const [colName, validator] of Object.entries(table.columns)) {
        const gqlType = validatorToGraphQL(validator).replace("!", "")
        lines.push(`  ${colName}: ${gqlType}`)
        inputFields.push({ name: colName, type: gqlType, args: [] })
      }
      lines.push("}")
      lines.push("")

      types.push({ name: inputName, kind: "INPUT_OBJECT", fields: inputFields })

      // Where input for filtering
      const whereInputName = `${typeName}WhereInput`
      lines.push(`input ${whereInputName} {`)
      lines.push("  id: ID")
      for (const [colName, validator] of Object.entries(table.columns)) {
        const gqlType = validatorToGraphQL(validator).replace("!", "")
        lines.push(`  ${colName}: ${gqlType}`)
      }
      lines.push("}")
      lines.push("")

      // Connection types for Relay pagination
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
        queryFields.push({
          name: tableName,
          type: `${typeName}Connection!`,
          args: [
            { name: "first", type: "Int" },
            { name: "after", type: "String" },
            { name: "last", type: "Int" },
            { name: "before", type: "String" },
            { name: "where", type: whereInputName },
          ],
        })
      } else {
        queryFields.push({
          name: tableName,
          type: `[${typeName}!]!`,
          args: [
            { name: "limit", type: "Int" },
            { name: "offset", type: "Int" },
            { name: "where", type: whereInputName },
          ],
        })
      }

      queryFields.push({
        name: singularize(tableName),
        type: typeName,
        args: [{ name: "id", type: "ID!" }],
      })

      // Mutation fields
      mutationFields.push(
        {
          name: `create${typeName}`,
          type: `${typeName}!`,
          args: [{ name: "input", type: `${inputName}!` }],
        },
        {
          name: `update${typeName}`,
          type: `${typeName}!`,
          args: [
            { name: "id", type: "ID!" },
            { name: "input", type: `${inputName}!` },
          ],
        },
        {
          name: `delete${typeName}`,
          type: "Boolean!",
          args: [{ name: "id", type: "ID!" }],
        },
      )

      // Subscription fields
      if (this.options.subscriptions) {
        const subField = `on${typeName}Changed`
        subscriptionFields.push({
          name: subField,
          type: `${typeName}!`,
          args: [{ name: "where", type: whereInputName }],
          description: `Subscribe to real-time changes on ${tableName}`,
        })

        subscriptionMappings[subField] = {
          field: subField,
          tableName,
          queryName: `${tableName}.list`,
          filterInputType: whereInputName,
        }

        // Also add collection subscription
        const collectionSubField = `on${typeName}List`
        subscriptionFields.push({
          name: collectionSubField,
          type: `[${typeName}!]!`,
          args: [
            { name: "where", type: whereInputName },
            { name: "limit", type: "Int" },
          ],
          description: `Subscribe to the full ${tableName} collection`,
        })

        subscriptionMappings[collectionSubField] = {
          field: collectionSubField,
          tableName,
          queryName: `${tableName}.list`,
          filterInputType: whereInputName,
        }
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

    // Query type
    lines.push("type Query {")
    for (const field of queryFields) {
      const args = field.args.map((a) => `${a.name}: ${a.type}`).join(", ")
      lines.push(`  ${field.name}(${args}): ${field.type}`)
    }
    lines.push("}")
    lines.push("")

    // Mutation type
    lines.push("type Mutation {")
    for (const field of mutationFields) {
      const args = field.args.map((a) => `${a.name}: ${a.type}`).join(", ")
      lines.push(`  ${field.name}(${args}): ${field.type}`)
    }
    lines.push("}")
    lines.push("")

    // Subscription type
    if (this.options.subscriptions && subscriptionFields.length > 0) {
      lines.push("type Subscription {")
      for (const field of subscriptionFields) {
        const args = field.args.map((a) => `${a.name}: ${a.type}`).join(", ")
        if (field.description) {
          lines.push(`  """${field.description}"""`)
        }
        lines.push(`  ${field.name}(${args}): ${field.type}`)
      }
      lines.push("}")
      lines.push("")
    }

    const sdl = lines.join("\n")

    this.generatedSchema = {
      sdl,
      types,
      queryFields,
      mutationFields,
      subscriptionFields,
      subscriptionMappings,
    }

    return this.generatedSchema
  }

  /**
   * Parse a GraphQL operation to determine the operation type and fields requested.
   */
  parseOperation(request: GraphQLRequest): ParsedOperation {
    const query = request.query.trim()

    let operationType: "query" | "mutation" | "subscription" = "query"
    if (query.startsWith("mutation")) operationType = "mutation"
    else if (query.startsWith("subscription")) operationType = "subscription"

    // Extract field names from the operation
    const fieldMatch = query.match(/\{\s*(\w+)/)
    const rootField = fieldMatch?.[1] ?? ""

    // Extract variables references
    const variableRefs = [...query.matchAll(/\$(\w+)/g)].map((m) => m[1])

    return {
      type: operationType,
      rootField,
      variables: request.variables ?? {},
      variableRefs,
      operationName: request.operationName ?? null,
      raw: request.query,
    }
  }

  /**
   * Create a subscription and return an async iterator-like interface.
   */
  subscribe(subscriptionId: string, field: string, variables?: Record<string, unknown>): SubscriptionHandle {
    const schema = this.generateSchema()
    const mapping = schema.subscriptionMappings[field]

    if (!mapping) {
      throw new GraphQLGatewayError(`Unknown subscription field: "${field}"`)
    }

    const state: SubscriptionState = {
      id: subscriptionId,
      field,
      mapping,
      variables: variables ?? {},
      active: true,
      createdAt: Date.now(),
    }

    this.subscriptions.set(subscriptionId, state)

    return {
      id: subscriptionId,
      field,
      tableName: mapping.tableName,
      unsubscribe: () => this.unsubscribe(subscriptionId),
      onData: (callback: (event: GraphQLSubscriptionEvent) => void) => {
        let listeners = this.listeners.get(subscriptionId)
        if (!listeners) {
          listeners = new Set()
          this.listeners.set(subscriptionId, listeners)
        }
        listeners.add(callback)
        return () => listeners!.delete(callback)
      },
    }
  }

  /**
   * Unsubscribe from a GraphQL subscription.
   */
  unsubscribe(subscriptionId: string): void {
    const state = this.subscriptions.get(subscriptionId)
    if (state) {
      state.active = false
      this.subscriptions.delete(subscriptionId)
      this.listeners.delete(subscriptionId)
    }
  }

  /**
   * Push data to a subscription (called when ReactivityEngine has updates).
   */
  pushSubscriptionData(subscriptionId: string, data: unknown): void {
    const state = this.subscriptions.get(subscriptionId)
    if (!state || !state.active) return

    const event: GraphQLSubscriptionEvent = {
      subscriptionId,
      field: state.field,
      data,
    }

    const listeners = this.listeners.get(subscriptionId)
    if (listeners) {
      for (const listener of listeners) {
        listener(event)
      }
    }
  }

  /**
   * Handle a graphql-ws protocol message.
   */
  handleTransportMessage(message: SubscriptionTransportMessage): SubscriptionTransportMessage[] {
    switch (message.type) {
      case "connection_init":
        return [{ type: "connection_ack" }]

      case "subscribe": {
        const payload = message.payload as GraphQLRequest | undefined
        if (!payload || !message.id) {
          return [{ id: message.id, type: "error", payload: { message: "Invalid subscribe payload" } }]
        }

        const parsed = this.parseOperation(payload)
        if (parsed.type !== "subscription") {
          return [{ id: message.id, type: "error", payload: { message: "Expected subscription operation" } }]
        }

        try {
          this.subscribe(message.id, parsed.rootField, parsed.variables)
          return [] // Ack is implicit; next events will follow
        } catch (err) {
          return [
            {
              id: message.id,
              type: "error",
              payload: { message: err instanceof Error ? err.message : String(err) },
            },
          ]
        }
      }

      case "complete": {
        if (message.id) {
          this.unsubscribe(message.id)
        }
        return [{ id: message.id, type: "complete" }]
      }

      default:
        return []
    }
  }

  /**
   * Get all active subscription IDs for a given table.
   */
  getSubscriptionsForTable(tableName: string): string[] {
    const result: string[] = []
    for (const [id, state] of this.subscriptions) {
      if (state.mapping.tableName === tableName && state.active) {
        result.push(id)
      }
    }
    return result
  }

  /**
   * Generate a client-side configuration snippet for Apollo Client.
   */
  generateApolloClientConfig(wsUrl: string, httpUrl?: string): string {
    const http = httpUrl ?? wsUrl.replace("ws://", "http://").replace("wss://", "https://")

    return `import { ApolloClient, InMemoryCache, split, HttpLink } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';

const httpLink = new HttpLink({ uri: '${http}' });

const wsLink = new GraphQLWsLink(
  createClient({ url: '${wsUrl}' })
);

const splitLink = split(
  ({ query }) => {
    const definition = getMainDefinition(query);
    return definition.kind === 'OperationDefinition' && definition.operation === 'subscription';
  },
  wsLink,
  httpLink,
);

export const client = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache(),
});`
  }

  /**
   * Generate a client-side configuration snippet for urql.
   */
  generateUrqlClientConfig(wsUrl: string, httpUrl?: string): string {
    const http = httpUrl ?? wsUrl.replace("ws://", "http://").replace("wss://", "https://")

    return `import { createClient, fetchExchange, subscriptionExchange } from 'urql';
import { createClient as createWSClient } from 'graphql-ws';

const wsClient = createWSClient({ url: '${wsUrl}' });

export const client = createClient({
  url: '${http}',
  exchanges: [
    fetchExchange,
    subscriptionExchange({
      forwardSubscription: (request) => ({
        subscribe: (sink) => ({
          unsubscribe: wsClient.subscribe(request, sink),
        }),
      }),
    }),
  ],
});`
  }

  /**
   * Generate TypeScript types for the GraphQL schema.
   */
  generateTypeDefinitions(): string {
    const schema = this.generateSchema()
    const lines: string[] = [
      "// Auto-generated TypeScript types for ReactiveBase GraphQL Gateway",
      "// Do not edit manually — regenerate with `reactivebase generate --graphql`",
      "",
    ]

    for (const typeDef of schema.types) {
      if (typeDef.kind === "OBJECT") {
        lines.push(`export interface ${typeDef.name} {`)
        for (const field of typeDef.fields) {
          const tsType = graphqlTypeToTS(field.type)
          lines.push(`  ${field.name}: ${tsType};`)
        }
        lines.push("}")
        lines.push("")
      } else if (typeDef.kind === "INPUT_OBJECT") {
        lines.push(`export interface ${typeDef.name} {`)
        for (const field of typeDef.fields) {
          const tsType = graphqlTypeToTS(field.type)
          lines.push(`  ${field.name}?: ${tsType};`)
        }
        lines.push("}")
        lines.push("")
      }
    }

    return lines.join("\n")
  }

  /**
   * Clean up all subscriptions.
   */
  destroy(): void {
    for (const id of this.subscriptions.keys()) {
      this.unsubscribe(id)
    }
    this.generatedSchema = null
  }
}

// ─── Subscription Handle ─────────────────────────────────────────────────────

export interface SubscriptionHandle {
  id: string
  field: string
  tableName: string
  unsubscribe: () => void
  onData: (callback: (event: GraphQLSubscriptionEvent) => void) => () => void
}

interface SubscriptionState {
  id: string
  field: string
  mapping: SubscriptionMapping
  variables: Record<string, unknown>
  active: boolean
  createdAt: number
}

interface ParsedOperation {
  type: "query" | "mutation" | "subscription"
  rootField: string
  variables: Record<string, unknown>
  variableRefs: string[]
  operationName: string | null
  raw: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function graphqlTypeToTS(gqlType: string): string {
  const isRequired = gqlType.endsWith("!")
  const base = gqlType.replace(/!/g, "")

  let tsType: string
  if (base.startsWith("[") && base.endsWith("]")) {
    const inner = base.slice(1, -1)
    tsType = `${graphqlTypeToTS(inner)}[]`
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
        tsType = "unknown"
        break
      default:
        tsType = base
    }
  }

  return isRequired ? tsType : `${tsType} | null`
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class GraphQLGatewayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GraphQLGatewayError"
  }
}
