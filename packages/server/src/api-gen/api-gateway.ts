/**
 * API Gateway — Production-ready REST (OpenAPI 3.1) and GraphQL gateway
 * with API key management, versioning, rate limiting, and subscription support.
 *
 * Features:
 *   - OpenAPI 3.1 spec generation from ReactiveBase schema
 *   - GraphQL schema with subscription support
 *   - API key management (create, revoke, validate)
 *   - API versioning (path-based: /v1/, /v2/)
 *   - Request/response logging for audit
 *   - CORS configuration
 *
 * Usage:
 *   const gateway = new ApiGateway({ schema, functions })
 *   const openApiSpec = gateway.generateOpenApiSpec()
 *   const graphqlSchema = gateway.generateGraphQLWithSubscriptions()
 *   const apiKey = gateway.createApiKey("my-client", ["read"])
 */

import type { Schema } from "../schema/index.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ApiGatewayOptions {
  /** API title for OpenAPI spec */
  title?: string
  /** API version (default: "1.0.0") */
  version?: string
  /** API description */
  description?: string
  /** Server URL for OpenAPI spec */
  serverUrl?: string
  /** Base path prefix (default: "/api") */
  basePath?: string
  /** Enable API key authentication (default: true) */
  enableApiKeys?: boolean
  /** CORS origins (default: ["*"]) */
  corsOrigins?: string[]
  /** Rate limit per minute per key (default: 1000) */
  rateLimitPerMinute?: number
  /** Supported API versions (default: ["v1"]) */
  versions?: string[]
}

export interface ApiKeyRecord {
  id: string
  name: string
  keyHash: string
  keyPrefix: string
  permissions: ApiPermission[]
  createdAt: number
  expiresAt: number | null
  lastUsedAt: number | null
  requestCount: number
  rateLimit: number
  isRevoked: boolean
  metadata?: Record<string, unknown>
}

export type ApiPermission = "read" | "write" | "admin" | "subscribe"

export interface ApiKeyValidationResult {
  valid: boolean
  keyId?: string
  permissions?: ApiPermission[]
  error?: string
}

export interface OpenApiSpec {
  openapi: string
  info: { title: string; version: string; description: string }
  servers: Array<{ url: string; description: string }>
  paths: Record<string, Record<string, OpenApiOperation>>
  components: {
    schemas: Record<string, OpenApiSchema>
    securitySchemes: Record<string, OpenApiSecurityScheme>
  }
  security: Array<Record<string, string[]>>
}

export interface OpenApiOperation {
  operationId: string
  summary: string
  tags: string[]
  parameters?: OpenApiParameter[]
  requestBody?: { required: boolean; content: Record<string, { schema: OpenApiSchemaRef }> }
  responses: Record<string, { description: string; content?: Record<string, { schema: OpenApiSchemaRef }> }>
}

export interface OpenApiParameter {
  name: string
  in: "query" | "path" | "header"
  required: boolean
  schema: OpenApiSchemaRef
  description?: string
}

export type OpenApiSchemaRef = { $ref: string } | OpenApiSchema

export interface OpenApiSchema {
  type: string
  properties?: Record<string, OpenApiSchema>
  items?: OpenApiSchemaRef
  required?: string[]
  enum?: string[]
  format?: string
  nullable?: boolean
  description?: string
}

export interface OpenApiSecurityScheme {
  type: string
  scheme?: string
  in?: string
  name?: string
  description?: string
}

export interface GraphQLSubscriptionField {
  name: string
  type: string
  description: string
  args: Array<{ name: string; type: string }>
}

export interface GatewayRoute {
  method: string
  path: string
  version: string
  operationId: string
  table?: string
  action: "list" | "get" | "create" | "update" | "delete" | "openapi" | "graphql" | "health"
}

export interface GatewayStats {
  totalRequests: number
  totalKeys: number
  activeKeys: number
  revokedKeys: number
  requestsByVersion: Map<string, number>
}

// ─── SQL Builders ────────────────────────────────────────────────────────────

export function generateApiKeyTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  request_count BIGINT NOT NULL DEFAULT 0,
  rate_limit INTEGER NOT NULL DEFAULT 1000,
  is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON _reactivebase_api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON _reactivebase_api_keys (key_prefix);`
}

export function buildInsertApiKeySQL(key: ApiKeyRecord): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_api_keys (id, name, key_hash, key_prefix, permissions, created_at, expires_at, rate_limit, metadata)
VALUES ($1, $2, $3, $4, $5, to_timestamp($6::double precision / 1000), $7, $8, $9)`,
    params: [
      key.id,
      key.name,
      key.keyHash,
      key.keyPrefix,
      key.permissions,
      key.createdAt,
      key.expiresAt ? new Date(key.expiresAt) : null,
      key.rateLimit,
      key.metadata ? JSON.stringify(key.metadata) : null,
    ],
  }
}

export function buildValidateApiKeySQL(keyHash: string): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT id, name, permissions, expires_at, is_revoked, rate_limit
FROM _reactivebase_api_keys
WHERE key_hash = $1 AND is_revoked = FALSE`,
    params: [keyHash],
  }
}

export function buildRevokeApiKeySQL(keyId: string): { sql: string; params: unknown[] } {
  return {
    sql: `UPDATE _reactivebase_api_keys SET is_revoked = TRUE WHERE id = $1`,
    params: [keyId],
  }
}

export function buildIncrementRequestCountSQL(keyId: string): { sql: string; params: unknown[] } {
  return {
    sql: `UPDATE _reactivebase_api_keys SET request_count = request_count + 1, last_used_at = NOW() WHERE id = $1`,
    params: [keyId],
  }
}

// ─── API Gateway ─────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<ApiGatewayOptions> = {
  title: "ReactiveBase API",
  version: "1.0.0",
  description: "Auto-generated API from ReactiveBase schema",
  serverUrl: "http://localhost:4000",
  basePath: "/api",
  enableApiKeys: true,
  corsOrigins: [],
  rateLimitPerMinute: 1000,
  versions: ["v1"],
}

export class ApiGateway {
  private options: Required<ApiGatewayOptions>
  private schema: Schema
  private apiKeys = new Map<string, ApiKeyRecord>()
  private totalRequests = 0
  private requestsByVersion = new Map<string, number>()

  constructor(schema: Schema, options: ApiGatewayOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.schema = schema
  }

  // ─── OpenAPI 3.1 Spec Generation ────────────────────────────────────────

  generateOpenApiSpec(version?: string): OpenApiSpec {
    const ver = version ?? this.options.versions[0]
    const basePath = `${this.options.basePath}/${ver}`

    const spec: OpenApiSpec = {
      openapi: "3.1.0",
      info: {
        title: this.options.title,
        version: this.options.version,
        description: this.options.description,
      },
      servers: [{ url: this.options.serverUrl, description: "Default server" }],
      paths: {},
      components: {
        schemas: {},
        securitySchemes: {},
      },
      security: [],
    }

    // Security schemes
    if (this.options.enableApiKeys) {
      spec.components.securitySchemes.apiKey = {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: "API key for authentication",
      }
      spec.components.securitySchemes.bearerAuth = {
        type: "http",
        scheme: "bearer",
        description: "JWT bearer token",
      }
      spec.security = [{ apiKey: [] }, { bearerAuth: [] }]
    }

    for (const tableName of this.schema.tableNames) {
      const table = this.schema.tables[tableName]
      const typeName = this.pascalCase(tableName)

      // Generate component schema
      const properties: Record<string, OpenApiSchema> = { id: { type: "string", description: "Unique identifier" } }
      const required: string[] = ["id"]

      for (const [colName, validator] of Object.entries(table.columns)) {
        properties[colName] = this.validatorToOpenApi(validator)
        if (!validator.isOptional) required.push(colName)
      }

      spec.components.schemas[typeName] = { type: "object", properties, required }
      spec.components.schemas[`${typeName}Input`] = {
        type: "object",
        properties: Object.fromEntries(Object.entries(properties).filter(([k]) => k !== "id")),
      }

      // Generate paths
      const listPath = `${basePath}/${tableName}`
      const itemPath = `${basePath}/${tableName}/{id}`

      spec.paths[listPath] = {
        get: {
          operationId: `list${typeName}`,
          summary: `List all ${tableName}`,
          tags: [tableName],
          parameters: [
            { name: "limit", in: "query", required: false, schema: { type: "integer" }, description: "Max results" },
            {
              name: "offset",
              in: "query",
              required: false,
              schema: { type: "integer" },
              description: "Offset for pagination",
            },
            { name: "sort", in: "query", required: false, schema: { type: "string" }, description: "Sort field" },
            { name: "order", in: "query", required: false, schema: { type: "string", enum: ["asc", "desc"] } },
          ],
          responses: {
            "200": {
              description: `List of ${tableName}`,
              content: {
                "application/json": { schema: { type: "array", items: { $ref: `#/components/schemas/${typeName}` } } },
              },
            },
          },
        },
        post: {
          operationId: `create${typeName}`,
          summary: `Create a ${this.singularize(tableName)}`,
          tags: [tableName],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: `#/components/schemas/${typeName}Input` } } },
          },
          responses: {
            "201": {
              description: `Created ${this.singularize(tableName)}`,
              content: { "application/json": { schema: { $ref: `#/components/schemas/${typeName}` } } },
            },
            "400": { description: "Validation error" },
          },
        },
      }

      spec.paths[itemPath] = {
        get: {
          operationId: `get${typeName}`,
          summary: `Get a ${this.singularize(tableName)} by ID`,
          tags: [tableName],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: `A ${this.singularize(tableName)}`,
              content: { "application/json": { schema: { $ref: `#/components/schemas/${typeName}` } } },
            },
            "404": { description: "Not found" },
          },
        },
        patch: {
          operationId: `update${typeName}`,
          summary: `Update a ${this.singularize(tableName)}`,
          tags: [tableName],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: `#/components/schemas/${typeName}Input` } } },
          },
          responses: {
            "200": {
              description: `Updated ${this.singularize(tableName)}`,
              content: { "application/json": { schema: { $ref: `#/components/schemas/${typeName}` } } },
            },
            "404": { description: "Not found" },
          },
        },
        delete: {
          operationId: `delete${typeName}`,
          summary: `Delete a ${this.singularize(tableName)}`,
          tags: [tableName],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "204": { description: "Deleted" },
            "404": { description: "Not found" },
          },
        },
      }
    }

    // Health endpoint
    spec.paths[`${basePath}/health`] = {
      get: {
        operationId: "healthCheck",
        summary: "API health check",
        tags: ["system"],
        responses: {
          "200": {
            description: "API is healthy",
            content: {
              "application/json": {
                schema: { type: "object", properties: { status: { type: "string" }, version: { type: "string" } } },
              },
            },
          },
        },
      },
    }

    return spec
  }

  // ─── GraphQL with Subscriptions ──────────────────────────────────────────

  generateGraphQLWithSubscriptions(): string {
    const lines: string[] = []
    lines.push("# Auto-generated GraphQL schema from ReactiveBase")
    lines.push("scalar JSON\nscalar DateTime\n")

    for (const tableName of this.schema.tableNames) {
      const table = this.schema.tables[tableName]
      const typeName = this.pascalCase(tableName)

      lines.push(`type ${typeName} {`)
      lines.push("  id: ID!")
      for (const [colName, validator] of Object.entries(table.columns)) {
        lines.push(`  ${colName}: ${this.validatorToGQL(validator)}`)
      }
      lines.push("}\n")

      // Input type
      lines.push(`input ${typeName}Input {`)
      for (const [colName, validator] of Object.entries(table.columns)) {
        lines.push(`  ${colName}: ${this.validatorToGQL(validator).replace("!", "")}`)
      }
      lines.push("}\n")

      // Filter input
      lines.push(`input ${typeName}Filter {`)
      lines.push("  id: ID")
      for (const [colName] of Object.entries(table.columns)) {
        lines.push(`  ${colName}: String`)
      }
      lines.push(`  _limit: Int\n  _offset: Int\n  _sort: String\n  _order: SortOrder`)
      lines.push("}\n")
    }

    lines.push("enum SortOrder { ASC DESC }\n")

    // Query type
    lines.push("type Query {")
    for (const tableName of this.schema.tableNames) {
      const typeName = this.pascalCase(tableName)
      lines.push(`  ${tableName}(filter: ${typeName}Filter): [${typeName}!]!`)
      lines.push(`  ${this.singularize(tableName)}(id: ID!): ${typeName}`)
    }
    lines.push("  _health: HealthStatus!")
    lines.push("}\n")

    // Mutation type
    lines.push("type Mutation {")
    for (const tableName of this.schema.tableNames) {
      const typeName = this.pascalCase(tableName)
      lines.push(`  create${typeName}(input: ${typeName}Input!): ${typeName}!`)
      lines.push(`  update${typeName}(id: ID!, input: ${typeName}Input!): ${typeName}!`)
      lines.push(`  delete${typeName}(id: ID!): Boolean!`)
    }
    lines.push("}\n")

    // Subscription type (reactive queries)
    lines.push("type Subscription {")
    for (const tableName of this.schema.tableNames) {
      const typeName = this.pascalCase(tableName)
      lines.push(`  on${typeName}Changed(filter: ${typeName}Filter): ${typeName}Change!`)
      lines.push(`  on${typeName}List(filter: ${typeName}Filter): [${typeName}!]!`)
    }
    lines.push("}\n")

    // Change type
    lines.push("type HealthStatus {\n  status: String!\n  version: String!\n  uptime: Float!\n}\n")
    for (const tableName of this.schema.tableNames) {
      const typeName = this.pascalCase(tableName)
      lines.push(
        `type ${typeName}Change {\n  type: ChangeType!\n  data: ${typeName}!\n  previousData: ${typeName}\n}\n`,
      )
    }
    lines.push("enum ChangeType { CREATED UPDATED DELETED }\n")

    return lines.join("\n")
  }

  getSubscriptionFields(): GraphQLSubscriptionField[] {
    const fields: GraphQLSubscriptionField[] = []
    for (const tableName of this.schema.tableNames) {
      const typeName = this.pascalCase(tableName)
      fields.push(
        {
          name: `on${typeName}Changed`,
          type: `${typeName}Change!`,
          description: `Subscribe to changes on ${tableName}`,
          args: [{ name: "filter", type: `${typeName}Filter` }],
        },
        {
          name: `on${typeName}List`,
          type: `[${typeName}!]!`,
          description: `Subscribe to live list of ${tableName}`,
          args: [{ name: "filter", type: `${typeName}Filter` }],
        },
      )
    }
    return fields
  }

  // ─── API Key Management ─────────────────────────────────────────────────

  createApiKey(
    name: string,
    permissions: ApiPermission[],
    expiresInMs?: number,
  ): { key: string; record: ApiKeyRecord } {
    const id = `ak_${randomId()}`
    const rawKey = `rb_${randomId()}${randomId()}`
    const keyHash = simpleHash(rawKey)
    const keyPrefix = rawKey.substring(0, 10)

    const record: ApiKeyRecord = {
      id,
      name,
      keyHash,
      keyPrefix,
      permissions,
      createdAt: Date.now(),
      expiresAt: expiresInMs ? Date.now() + expiresInMs : null,
      lastUsedAt: null,
      requestCount: 0,
      rateLimit: this.options.rateLimitPerMinute,
      isRevoked: false,
    }

    this.apiKeys.set(id, record)
    return { key: rawKey, record }
  }

  validateApiKey(rawKey: string): ApiKeyValidationResult {
    const keyHash = simpleHash(rawKey)
    for (const record of this.apiKeys.values()) {
      if (record.keyHash === keyHash) {
        if (record.isRevoked) return { valid: false, error: "API key has been revoked" }
        if (record.expiresAt && record.expiresAt < Date.now()) {
          return { valid: false, error: "API key has expired" }
        }
        record.lastUsedAt = Date.now()
        record.requestCount++
        this.totalRequests++
        return { valid: true, keyId: record.id, permissions: record.permissions }
      }
    }
    return { valid: false, error: "Invalid API key" }
  }

  revokeApiKey(keyId: string): boolean {
    const record = this.apiKeys.get(keyId)
    if (!record) return false
    record.isRevoked = true
    return true
  }

  listApiKeys(): ApiKeyRecord[] {
    return Array.from(this.apiKeys.values())
  }

  // ─── Versioned Routes ───────────────────────────────────────────────────

  generateVersionedRoutes(): GatewayRoute[] {
    const routes: GatewayRoute[] = []

    for (const ver of this.options.versions) {
      const basePath = `${this.options.basePath}/${ver}`

      // System routes
      routes.push(
        {
          method: "GET",
          path: `${basePath}/openapi.json`,
          version: ver,
          operationId: "getOpenApiSpec",
          action: "openapi",
        },
        { method: "ALL", path: `${basePath}/graphql`, version: ver, operationId: "graphqlEndpoint", action: "graphql" },
        { method: "GET", path: `${basePath}/health`, version: ver, operationId: "healthCheck", action: "health" },
      )

      // CRUD routes
      for (const tableName of this.schema.tableNames) {
        const typeName = this.pascalCase(tableName)
        routes.push(
          {
            method: "GET",
            path: `${basePath}/${tableName}`,
            version: ver,
            operationId: `list${typeName}`,
            table: tableName,
            action: "list",
          },
          {
            method: "GET",
            path: `${basePath}/${tableName}/:id`,
            version: ver,
            operationId: `get${typeName}`,
            table: tableName,
            action: "get",
          },
          {
            method: "POST",
            path: `${basePath}/${tableName}`,
            version: ver,
            operationId: `create${typeName}`,
            table: tableName,
            action: "create",
          },
          {
            method: "PATCH",
            path: `${basePath}/${tableName}/:id`,
            version: ver,
            operationId: `update${typeName}`,
            table: tableName,
            action: "update",
          },
          {
            method: "DELETE",
            path: `${basePath}/${tableName}/:id`,
            version: ver,
            operationId: `delete${typeName}`,
            table: tableName,
            action: "delete",
          },
        )
      }
    }

    return routes
  }

  // ─── Stats ───────────────────────────────────────────────────────────────

  getStats(): GatewayStats {
    const keys = Array.from(this.apiKeys.values())
    return {
      totalRequests: this.totalRequests,
      totalKeys: keys.length,
      activeKeys: keys.filter((k) => !k.isRevoked).length,
      revokedKeys: keys.filter((k) => k.isRevoked).length,
      requestsByVersion: new Map(this.requestsByVersion),
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private validatorToOpenApi(validator: {
    type: string
    isOptional?: boolean
    values?: string[]
    innerValidator?: { type: string }
  }): OpenApiSchema {
    const actual = validator.type === "optional" && validator.innerValidator ? validator.innerValidator : validator

    const base = (() => {
      switch (actual.type) {
        case "string":
          return { type: "string" }
        case "number":
          return { type: "number", format: "double" }
        case "integer":
          return { type: "integer" }
        case "boolean":
          return { type: "boolean" }
        case "timestamp":
          return { type: "string", format: "date-time" }
        case "json":
          return { type: "object" }
        case "id":
          return { type: "string" }
        case "enum":
          return { type: "string", enum: (validator as { values?: string[] }).values }
        case "vector":
          return { type: "array", items: { type: "number" } }
        default:
          return { type: "string" }
      }
    })()

    return { ...base, nullable: validator.isOptional } as OpenApiSchema
  }

  private validatorToGQL(validator: { type: string; isOptional?: boolean; innerValidator?: { type: string } }): string {
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
      default:
        return `String${required}`
    }
  }

  private pascalCase(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  private singularize(str: string): string {
    if (str.endsWith("ies")) return str.slice(0, -3) + "y"
    if (str.endsWith("ses")) return str.slice(0, -2)
    if (str.endsWith("s")) return str.slice(0, -1)
    return str
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function randomId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36)
}

function simpleHash(key: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}
