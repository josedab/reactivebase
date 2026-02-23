/**
 * GraphQL Federation Gateway for ReactiveBase.
 * Auto-generates a federated GraphQL schema with Apollo Federation v2 directives.
 *
 * Features:
 *   - Type generation from ReactiveBase schema
 *   - Apollo Federation v2 directives (@key, @shareable)
 *   - Reference resolvers for _entities queries
 *   - GraphQL subscriptions mapped to reactive queries
 *   - Relay-style cursor pagination
 */

import type { Schema } from "../schema/index.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FederationOptions {
  /** Enable Apollo Federation v2 directives (default: true) */
  federation?: boolean
  /** Add @shareable to all types (default: false) */
  shareableByDefault?: boolean
  /** Generate subscription types (default: true) */
  subscriptions?: boolean
  /** Enable Relay-style pagination (default: true) */
  relayPagination?: boolean
  /** Custom scalar definitions */
  customScalars?: Record<string, string>
}

export interface FederatedSchema {
  /** Full SDL string */
  sdl: string
  /** Type definitions only (no schema/directives) */
  typeDefs: string
  /** List of entity type names (for _entities resolver) */
  entityTypes: string[]
  /** Subscription type names mapped to query names */
  subscriptionMappings: Record<string, string>
}

export interface SubscriptionMapping {
  subscriptionField: string
  queryName: string
  tableName: string
  description: string
}

// ─── Schema Generator ────────────────────────────────────────────────────────

/**
 * Generate a federated GraphQL schema from a ReactiveBase schema.
 */
export function generateFederatedSchema(schema: Schema, options: FederationOptions = {}): FederatedSchema {
  const federation = options.federation !== false
  const subscriptions = options.subscriptions !== false
  const relayPagination = options.relayPagination !== false
  const shareableByDefault = options.shareableByDefault ?? false
  const customScalars = options.customScalars ?? {}

  const lines: string[] = []
  const entityTypes: string[] = []
  const subscriptionMappings: Record<string, string> = {}

  // Federation v2 schema extension
  if (federation) {
    lines.push(
      'extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable", "@external"])',
    )
    lines.push("")
  }

  // Custom scalars
  lines.push("scalar DateTime")
  lines.push("scalar JSON")
  for (const [name, description] of Object.entries(customScalars)) {
    lines.push(`"""${description}"""`)
    lines.push(`scalar ${name}`)
  }
  lines.push("")

  // Generate types for each table
  for (const tableName of schema.tableNames) {
    const table = schema.tables[tableName]
    const typeName = pascalCase(tableName)

    entityTypes.push(typeName)

    const directives = [federation ? `@key(fields: "id")` : "", shareableByDefault ? "@shareable" : ""]
      .filter(Boolean)
      .join(" ")

    lines.push(`type ${typeName} ${directives}{`.trim())
    lines.push("  id: ID!")

    for (const [colName, validator] of Object.entries(table.columns)) {
      const gqlType = validatorToGraphQLType(validator)
      lines.push(`  ${colName}: ${gqlType}`)
    }

    lines.push("}")
    lines.push("")

    // Input type
    const inputName = `${typeName}Input`
    lines.push(`input ${inputName} {`)
    for (const [colName, validator] of Object.entries(table.columns)) {
      const gqlType = validatorToGraphQLType(validator).replace("!", "")
      lines.push(`  ${colName}: ${gqlType}`)
    }
    lines.push("}")
    lines.push("")

    // Connection type for Relay pagination
    if (relayPagination) {
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
  }

  // PageInfo for Relay pagination
  if (relayPagination) {
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
  for (const tableName of schema.tableNames) {
    const typeName = pascalCase(tableName)
    const singular = singularize(tableName)

    if (relayPagination) {
      lines.push(
        `  ${tableName}(first: Int, after: String, last: Int, before: String, filter: ${typeName}Input): ${typeName}Connection!`,
      )
    } else {
      lines.push(`  ${tableName}(limit: Int, offset: Int, filter: ${typeName}Input): [${typeName}!]!`)
    }
    lines.push(`  ${singular}(id: ID!): ${typeName}`)
  }

  // Federation _entities resolver
  if (federation) {
    lines.push("  _entities(representations: [_Any!]!): [_Entity]!")
    lines.push("  _service: _Service!")
  }

  lines.push("}")
  lines.push("")

  // Mutation type
  lines.push("type Mutation {")
  for (const tableName of schema.tableNames) {
    const typeName = pascalCase(tableName)
    const inputName = `${typeName}Input`
    lines.push(`  create${typeName}(input: ${inputName}!): ${typeName}!`)
    lines.push(`  update${typeName}(id: ID!, input: ${inputName}!): ${typeName}!`)
    lines.push(`  delete${typeName}(id: ID!): Boolean!`)
  }
  lines.push("}")
  lines.push("")

  // Subscription type
  if (subscriptions) {
    lines.push("type Subscription {")
    for (const tableName of schema.tableNames) {
      const typeName = pascalCase(tableName)
      const subField = `on${typeName}Changed`
      lines.push(`  ${subField}(filter: ${typeName}Input): ${typeName}!`)
      subscriptionMappings[subField] = tableName
    }
    lines.push("}")
    lines.push("")
  }

  // Federation directives
  if (federation) {
    lines.push(`union _Entity = ${entityTypes.join(" | ")}`)
    lines.push("")
    lines.push("scalar _Any")
    lines.push("")
    lines.push("type _Service {")
    lines.push("  sdl: String!")
    lines.push("}")
  }

  const sdl = lines.join("\n")

  return {
    sdl,
    typeDefs: sdl,
    entityTypes,
    subscriptionMappings,
  }
}

/**
 * Generate resolver map skeleton for the federated schema.
 */
export function generateResolverSkeleton(schema: Schema): string {
  const lines: string[] = [
    "// Auto-generated resolver skeleton for ReactiveBase GraphQL Federation",
    "// Implement the resolver functions to connect to your ReactiveBase backend",
    "",
    "export const resolvers = {",
    "  Query: {",
  ]

  for (const tableName of schema.tableNames) {
    const singular = singularize(tableName)
    lines.push(
      `    ${tableName}: async (_parent, args, ctx) => ctx.db.${tableName}.where(args.filter ?? {}).limit(args.first ?? 50),`,
    )
    lines.push(`    ${singular}: async (_parent, { id }, ctx) => ctx.db.${tableName}.get(id),`)
  }

  lines.push("  },")
  lines.push("  Mutation: {")

  for (const tableName of schema.tableNames) {
    const typeName = pascalCase(tableName)
    lines.push(`    create${typeName}: async (_parent, { input }, ctx) => ctx.db.${tableName}.insert(input),`)
    lines.push(`    update${typeName}: async (_parent, { id, input }, ctx) => ctx.db.${tableName}.update(id, input),`)
    lines.push(
      `    delete${typeName}: async (_parent, { id }, ctx) => { await ctx.db.${tableName}.delete(id); return true },`,
    )
  }

  lines.push("  },")
  lines.push("}")

  return lines.join("\n")
}

/**
 * Get subscription mappings from a federated schema.
 */
export function getSubscriptionMappings(schema: Schema): SubscriptionMapping[] {
  const mappings: SubscriptionMapping[] = []

  for (const tableName of schema.tableNames) {
    const typeName = pascalCase(tableName)
    mappings.push({
      subscriptionField: `on${typeName}Changed`,
      queryName: `${tableName}.list`,
      tableName,
      description: `Subscribe to changes on ${tableName}`,
    })
  }

  return mappings
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function validatorToGraphQLType(validator: {
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
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function singularize(str: string): string {
  if (str.endsWith("ies")) return str.slice(0, -3) + "y"
  if (str.endsWith("ses")) return str.slice(0, -2)
  if (str.endsWith("s")) return str.slice(0, -1)
  return str
}
