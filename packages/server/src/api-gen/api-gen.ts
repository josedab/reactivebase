/**
 * REST API auto-generation from ReactiveBase schema.
 * Generates CRUD endpoints for tables in the schema.
 *
 * Routes:
 *   GET    /api/:table           → list (with query params as filters)
 *   GET    /api/:table/:id       → get by id
 *   POST   /api/:table           → insert
 *   PATCH  /api/:table/:id       → update
 *   DELETE /api/:table/:id       → delete
 */

import type { IncomingMessage, ServerResponse } from "node:http"
import type { Schema } from "../schema/index.js"

export interface RestApiOptions {
  /** Base path prefix (default: "/api") */
  basePath?: string
  /** Tables to expose (default: all) */
  tables?: string[]
  /** Whether to require authentication (default: true) */
  requireAuth?: boolean
}

export interface RestRoute {
  method: string
  path: string
  table: string
  action: "list" | "get" | "create" | "update" | "delete"
}

/**
 * Generate REST route definitions from a schema.
 */
export function generateRestRoutes(
  schema: Schema,
  options: RestApiOptions = {},
): RestRoute[] {
  const basePath = options.basePath ?? "/api"
  const tables = options.tables ?? schema.tableNames

  const routes: RestRoute[] = []

  for (const table of tables) {
    if (!schema.tableNames.includes(table)) continue

    routes.push(
      { method: "GET", path: `${basePath}/${table}`, table, action: "list" },
      { method: "GET", path: `${basePath}/${table}/:id`, table, action: "get" },
      { method: "POST", path: `${basePath}/${table}`, table, action: "create" },
      { method: "PATCH", path: `${basePath}/${table}/:id`, table, action: "update" },
      { method: "DELETE", path: `${basePath}/${table}/:id`, table, action: "delete" },
    )
  }

  return routes
}

/**
 * Match an incoming request to a REST route.
 */
export function matchRoute(
  method: string,
  url: string,
  routes: RestRoute[],
): { route: RestRoute; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue

    const routeParts = route.path.split("/")
    const urlParts = url.split("?")[0].split("/")

    if (routeParts.length !== urlParts.length) continue

    const params: Record<string, string> = {}
    let match = true

    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(":")) {
        params[routeParts[i].substring(1)] = urlParts[i]
      } else if (routeParts[i] !== urlParts[i]) {
        match = false
        break
      }
    }

    if (match) return { route, params }
  }

  return null
}

/**
 * Parse query string parameters into filters.
 */
export function parseQueryFilters(url: string): Record<string, string> {
  const queryString = url.split("?")[1]
  if (!queryString) return {}

  const filters: Record<string, string> = {}
  for (const pair of queryString.split("&")) {
    const [key, value] = pair.split("=")
    if (key && value) {
      filters[decodeURIComponent(key)] = decodeURIComponent(value)
    }
  }
  return filters
}

/**
 * Generate a GraphQL schema definition from a ReactiveBase schema.
 */
export function generateGraphQLSchema(schema: Schema): string {
  const lines: string[] = []

  // Generate types for each table
  for (const tableName of schema.tableNames) {
    const table = schema.tables[tableName]
    const typeName = pascalCase(tableName)

    lines.push(`type ${typeName} {`)
    lines.push("  id: ID!")

    for (const [colName, validator] of Object.entries(table.columns)) {
      const gqlType = validatorToGraphQL(validator)
      lines.push(`  ${colName}: ${gqlType}`)
    }

    lines.push("}")
    lines.push("")
  }

  // Generate Query type
  lines.push("type Query {")
  for (const tableName of schema.tableNames) {
    const typeName = pascalCase(tableName)
    lines.push(`  ${tableName}(id: ID): [${typeName}!]!`)
    lines.push(`  ${singularize(tableName)}(id: ID!): ${typeName}`)
  }
  lines.push("}")
  lines.push("")

  // Generate Mutation type
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

  // Generate Input types
  for (const tableName of schema.tableNames) {
    const table = schema.tables[tableName]
    const inputName = `${pascalCase(tableName)}Input`

    lines.push(`input ${inputName} {`)
    for (const [colName, validator] of Object.entries(table.columns)) {
      const gqlType = validatorToGraphQL(validator).replace("!", "")
      lines.push(`  ${colName}: ${gqlType}`)
    }
    lines.push("}")
    lines.push("")
  }

  return lines.join("\n")
}

function validatorToGraphQL(validator: { type: string; isOptional: boolean; innerValidator?: { type: string } }): string {
  const actual = validator.type === "optional" && validator.innerValidator
    ? validator.innerValidator
    : validator
  const required = !validator.isOptional ? "!" : ""

  switch (actual.type) {
    case "string": case "id": case "enum": return `String${required}`
    case "number": return `Float${required}`
    case "integer": return `Int${required}`
    case "boolean": return `Boolean${required}`
    case "timestamp": return `String${required}`
    case "json": return `JSON${required}`
    case "vector": return `[Float!]${required}`
    default: return `String${required}`
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
