/**
 * Unified REST + GraphQL + WebSocket gateway for ReactiveBase.
 * Routes incoming requests to the appropriate handler based on path and content-type.
 *
 * Routes:
 *   /api/v1/*           → REST API
 *   /api/v1/health      → Health check
 *   /api/docs           → Swagger UI
 *   /api/docs/redoc     → Redoc documentation
 *   /graphql            → GraphQL endpoint
 *   /graphql/playground  → GraphQL Playground
 *   /ws                 → WebSocket
 *
 * Usage:
 *   const gateway = new UnifiedGateway({ functions, ... })
 *   const response = gateway.handleRequest(request)
 */

import { OpenApiGenerator } from "./openapi-generator.js"
import { GraphQLSchemaGenerator } from "./graphql-schema-generator.js"
import type { FunctionDescriptor, OpenApi31Spec } from "./openapi-generator.js"
import type { GeneratedGraphQLResult } from "./graphql-schema-generator.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GatewayRequest {
  method: string
  path: string
  headers: Record<string, string | undefined>
  body?: unknown
  query?: Record<string, string>
}

export interface GatewayResponse {
  status: number
  headers: Record<string, string>
  body: unknown
}

export interface UnifiedGatewayOptions {
  /** Registered function descriptors */
  functions: FunctionDescriptor[]
  /** API title */
  title?: string
  /** API version */
  version?: string
  /** API description */
  description?: string
  /** Server URL */
  serverUrl?: string
  /** REST base path (default: "/api/v1") */
  restBasePath?: string
  /** GraphQL endpoint path (default: "/graphql") */
  graphqlPath?: string
  /** WebSocket path (default: "/ws") */
  wsPath?: string
  /** Enable subscriptions (default: true) */
  subscriptions?: boolean
}

export interface GatewayRouteInfo {
  method: string
  path: string
  transport: "rest" | "graphql" | "websocket" | "docs" | "system"
  description: string
}

export interface GatewayTransportStats {
  rest: number
  graphql: number
  websocket: number
  docs: number
  system: number
  total: number
}

// ─── Gateway ─────────────────────────────────────────────────────────────────

const DEFAULT_GATEWAY_OPTIONS = {
  title: "ReactiveBase API",
  version: "1.0.0",
  description: "Unified ReactiveBase Gateway",
  serverUrl: "http://localhost:4000",
  restBasePath: "/api/v1",
  graphqlPath: "/graphql",
  wsPath: "/ws",
  subscriptions: true,
}

export class UnifiedGateway {
  private options: Required<UnifiedGatewayOptions>
  private openApiGenerator: OpenApiGenerator
  private graphqlGenerator: GraphQLSchemaGenerator
  private cachedSpec: OpenApi31Spec | null = null
  private cachedGraphQL: GeneratedGraphQLResult | null = null
  private stats: GatewayTransportStats = {
    rest: 0,
    graphql: 0,
    websocket: 0,
    docs: 0,
    system: 0,
    total: 0,
  }

  /**
   * @param options - Gateway configuration including functions, paths, and server settings
   */
  constructor(options: UnifiedGatewayOptions) {
    this.options = { ...DEFAULT_GATEWAY_OPTIONS, ...options } as Required<UnifiedGatewayOptions>

    this.openApiGenerator = new OpenApiGenerator({
      title: this.options.title,
      version: this.options.version,
      description: this.options.description,
      serverUrl: this.options.serverUrl,
      basePath: this.options.restBasePath,
    })

    this.graphqlGenerator = new GraphQLSchemaGenerator({
      subscriptions: this.options.subscriptions,
    })
  }

  /**
   * Route a request to the appropriate handler based on path and content-type.
   *
   * @param req - The incoming gateway request to route
   * @returns The gateway response from the matched handler
   */
  handleRequest(req: GatewayRequest): GatewayResponse {
    const path = req.path.split("?")[0]
    this.stats.total++

    // Health check
    if (path === `${this.options.restBasePath}/health` && req.method === "GET") {
      this.stats.system++
      return this.handleHealthCheck()
    }

    // Swagger UI
    if (path === "/api/docs" && req.method === "GET") {
      this.stats.docs++
      return this.handleSwaggerUI()
    }

    // Redoc
    if (path === "/api/docs/redoc" && req.method === "GET") {
      this.stats.docs++
      return this.handleRedoc()
    }

    // OpenAPI spec
    if (path === `${this.options.restBasePath}/openapi.json` && req.method === "GET") {
      this.stats.docs++
      return this.handleOpenApiSpec()
    }

    // GraphQL Playground
    if (path === `${this.options.graphqlPath}/playground` && req.method === "GET") {
      this.stats.docs++
      return this.handleGraphQLPlayground()
    }

    // GraphQL endpoint
    if (path === this.options.graphqlPath) {
      this.stats.graphql++
      return this.handleGraphQL(req)
    }

    // WebSocket upgrade path
    if (path === this.options.wsPath) {
      this.stats.websocket++
      return this.handleWebSocket(req)
    }

    // REST API routes
    if (path.startsWith(this.options.restBasePath + "/")) {
      this.stats.rest++
      return this.handleRest(req)
    }

    return this.jsonResponse(404, { error: "Not found", path })
  }

  /**
   * Return all registered routes for debugging.
   *
   * @returns An array of route info objects describing all gateway endpoints
   */
  getRoutes(): GatewayRouteInfo[] {
    const routes: GatewayRouteInfo[] = []

    // System routes
    routes.push(
      { method: "GET", path: `${this.options.restBasePath}/health`, transport: "system", description: "Health check" },
      {
        method: "GET",
        path: `${this.options.restBasePath}/openapi.json`,
        transport: "docs",
        description: "OpenAPI 3.1 spec",
      },
      { method: "GET", path: "/api/docs", transport: "docs", description: "Swagger UI" },
      { method: "GET", path: "/api/docs/redoc", transport: "docs", description: "Redoc documentation" },
      {
        method: "GET",
        path: `${this.options.graphqlPath}/playground`,
        transport: "docs",
        description: "GraphQL Playground",
      },
    )

    // GraphQL
    routes.push({
      method: "POST",
      path: this.options.graphqlPath,
      transport: "graphql",
      description: "GraphQL endpoint",
    })

    // WebSocket
    routes.push({ method: "GET", path: this.options.wsPath, transport: "websocket", description: "WebSocket endpoint" })

    // REST routes from functions
    for (const fn of this.options.functions) {
      const method = fn.type === "query" ? "GET" : "POST"
      routes.push({
        method,
        path: `${this.options.restBasePath}/${fn.name}`,
        transport: "rest",
        description: fn.description ?? `${fn.type}: ${fn.name}`,
      })
    }

    return routes
  }

  /**
   * Return request counts by transport type.
   *
   * @returns A snapshot of request counts grouped by transport type
   */
  getStats(): GatewayTransportStats {
    return { ...this.stats }
  }

  // ─── Handlers ──────────────────────────────────────────────────────────────

  private handleHealthCheck(): GatewayResponse {
    return this.jsonResponse(200, {
      status: "healthy",
      version: this.options.version,
      timestamp: new Date().toISOString(),
      transports: {
        rest: `${this.options.restBasePath}/*`,
        graphql: this.options.graphqlPath,
        websocket: this.options.wsPath,
      },
    })
  }

  private handleSwaggerUI(): GatewayResponse {
    const spec = this.getOpenApiSpec()
    const html = this.openApiGenerator.generateSwaggerUIHTML(spec)
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: html,
    }
  }

  private handleRedoc(): GatewayResponse {
    const spec = this.getOpenApiSpec()
    const html = this.openApiGenerator.generateRedocHTML(spec)
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: html,
    }
  }

  private handleOpenApiSpec(): GatewayResponse {
    return this.jsonResponse(200, this.getOpenApiSpec())
  }

  private handleGraphQLPlayground(): GatewayResponse {
    const html = this.graphqlGenerator.generateGraphQLPlaygroundHTML(this.options.graphqlPath)
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: html,
    }
  }

  private handleGraphQL(req: GatewayRequest): GatewayResponse {
    if (req.method === "GET") {
      // Introspection via GET
      const graphql = this.getGraphQLSchema()
      return this.jsonResponse(200, { data: { sdl: graphql.sdl } })
    }

    if (req.method !== "POST") {
      return this.jsonResponse(405, { error: "Method not allowed. Use POST for GraphQL queries." })
    }

    const body = req.body as { query?: string; variables?: Record<string, unknown>; operationName?: string } | undefined
    if (!body?.query) {
      return this.jsonResponse(400, { errors: [{ message: "Missing query in request body" }] })
    }

    // Parse and validate the query against the schema
    const graphql = this.getGraphQLSchema()
    const query = body.query.trim()
    let operationType: "query" | "mutation" | "subscription" = "query"
    if (query.startsWith("mutation")) operationType = "mutation"
    else if (query.startsWith("subscription")) operationType = "subscription"

    // Validate field existence
    const fieldMatch = query.match(/\{\s*(\w+)/)
    const rootField = fieldMatch?.[1]

    if (rootField) {
      const validFields =
        operationType === "query"
          ? graphql.queryFields
          : operationType === "mutation"
            ? graphql.mutationFields
            : graphql.subscriptionFields

      if (!validFields.includes(rootField) && rootField !== "__schema" && rootField !== "__type") {
        return this.jsonResponse(400, {
          errors: [{ message: `Unknown ${operationType} field: "${rootField}"` }],
        })
      }
    }

    // Return schema info (actual execution would require a runtime)
    return this.jsonResponse(200, {
      data: null,
      extensions: {
        operationType,
        rootField,
        schema: { queryFields: graphql.queryFields, mutationFields: graphql.mutationFields },
      },
    })
  }

  private handleWebSocket(req: GatewayRequest): GatewayResponse {
    const upgradeHeader = req.headers["upgrade"]?.toLowerCase()
    if (upgradeHeader !== "websocket") {
      return this.jsonResponse(426, {
        error: "Upgrade required",
        message: "WebSocket connection requires Upgrade: websocket header",
      })
    }

    return {
      status: 101,
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
        "content-type": "application/json",
      },
      body: { protocol: "graphql-transport-ws" },
    }
  }

  private handleRest(req: GatewayRequest): GatewayResponse {
    const path = req.path.split("?")[0]
    const fnName = path.replace(this.options.restBasePath + "/", "").split("/")[0]

    const fn = this.options.functions.find((f) => f.name === fnName)
    if (!fn) {
      return this.jsonResponse(404, { error: `Unknown function: ${fnName}` })
    }

    // Validate method matches function type
    const expectedMethod = fn.type === "query" ? "GET" : "POST"
    if (req.method !== expectedMethod) {
      return this.jsonResponse(405, {
        error: `Method not allowed. ${fn.name} is a ${fn.type}, use ${expectedMethod}.`,
      })
    }

    // Return acknowledgment (actual execution would require a runtime)
    return this.jsonResponse(200, {
      data: null,
      function: fn.name,
      type: fn.type,
      args: fn.type === "query" ? (req.query ?? {}) : (req.body ?? {}),
    })
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private getOpenApiSpec(): OpenApi31Spec {
    if (!this.cachedSpec) {
      this.cachedSpec = this.openApiGenerator.generateSpec(this.options.functions)
    }
    return this.cachedSpec
  }

  private getGraphQLSchema(): GeneratedGraphQLResult {
    if (!this.cachedGraphQL) {
      this.cachedGraphQL = this.graphqlGenerator.generateSchema(this.options.functions)
    }
    return this.cachedGraphQL
  }

  private jsonResponse(status: number, body: unknown): GatewayResponse {
    return {
      status,
      headers: { "content-type": "application/json" },
      body,
    }
  }
}
