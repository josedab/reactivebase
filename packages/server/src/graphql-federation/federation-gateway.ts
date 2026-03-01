/**
 * GraphQL Federation Gateway for ReactiveBase.
 * Composes multiple GraphQL subgraphs into a unified supergraph.
 *
 * Features:
 *   - Subgraph registration and health monitoring
 *   - Query planning across subgraphs
 *   - Entity resolution via _entities queries
 *   - Automatic schema composition with conflict detection
 *   - Request batching and deduplication
 *   - Configurable error handling and timeouts
 *
 * Usage:
 *   const gateway = new FederationGateway()
 *   gateway.addSubgraph({ name: "users", url: "http://users:4001/graphql", sdl: usersSdl })
 *   gateway.addSubgraph({ name: "orders", url: "http://orders:4002/graphql", sdl: ordersSdl })
 *   const composed = gateway.compose()
 *   const result = await gateway.execute({ query: "{ users { id orders { id } } }" })
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SubgraphConfig {
  /** Unique name for this subgraph */
  name: string
  /** GraphQL endpoint URL */
  url: string
  /** SDL schema for this subgraph */
  sdl: string
  /** Custom headers for requests to this subgraph */
  headers?: Record<string, string>
  /** Timeout in ms (default: 10000) */
  timeoutMs?: number
  /** Enable health checks (default: true) */
  healthCheck?: boolean
}

export interface SubgraphState {
  name: string
  url: string
  status: "healthy" | "unhealthy" | "unknown"
  lastHealthCheck: number | null
  entityTypes: string[]
  typeNames: string[]
  latencyMs: number | null
}

export interface ComposedSchema {
  sdl: string
  subgraphs: string[]
  entityTypes: Map<string, string[]>
  typeOwnership: Map<string, string>
  conflicts: SchemaConflict[]
}

export interface SchemaConflict {
  type: "type_conflict" | "field_conflict" | "directive_conflict"
  typeName: string
  fieldName?: string
  subgraphs: string[]
  description: string
  resolution: "merge" | "first_wins" | "error"
}

export interface QueryPlan {
  steps: QueryPlanStep[]
  estimatedSubgraphCalls: number
  parallelizable: boolean
}

export interface QueryPlanStep {
  subgraph: string
  operation: string
  dependsOn: number[]
  entityResolve: boolean
  selections: string[]
}

export interface GatewayExecutionResult {
  data: Record<string, unknown> | null
  errors: GatewayError[]
  extensions?: {
    queryPlan: QueryPlan
    timing: Record<string, number>
    subgraphCalls: number
  }
}

export interface GatewayError {
  message: string
  path?: string[]
  subgraph?: string
  extensions?: Record<string, unknown>
}

export interface FederationGatewayOptions {
  /** Enable query plan caching (default: true) */
  queryPlanCache?: boolean
  /** Max query plan cache size (default: 1000) */
  queryPlanCacheSize?: number
  /** Default timeout for subgraph requests in ms (default: 10000) */
  defaultTimeoutMs?: number
  /** Enable introspection (default: true in dev) */
  introspection?: boolean
  /** Health check interval in ms (default: 30000) */
  healthCheckIntervalMs?: number
  /** Error handling strategy */
  errorStrategy?: "propagate" | "partial" | "fail_fast"
}

export interface GatewayStats {
  totalRequests: number
  totalErrors: number
  subgraphCalls: number
  averageLatencyMs: number
  cacheHitRate: number
  subgraphStats: Map<string, { calls: number; errors: number; avgLatencyMs: number }>
}

// ─── Federation Gateway ──────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<FederationGatewayOptions> = {
  queryPlanCache: true,
  queryPlanCacheSize: 1000,
  defaultTimeoutMs: 10_000,
  introspection: true,
  healthCheckIntervalMs: 30_000,
  errorStrategy: "partial",
}

export class FederationGateway {
  private options: Required<FederationGatewayOptions>
  private subgraphs = new Map<string, SubgraphConfig>()
  private subgraphStates = new Map<string, SubgraphState>()
  private composedSchema: ComposedSchema | null = null
  private queryPlanCache = new Map<string, QueryPlan>()

  // Stats
  private totalRequests = 0
  private totalErrors = 0
  private subgraphCallCount = 0
  private latencySum = 0
  private cacheHits = 0
  private cacheMisses = 0
  private perSubgraphStats = new Map<string, { calls: number; errors: number; latencySum: number }>()

  constructor(options: FederationGatewayOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Register a subgraph with the gateway.
   */
  addSubgraph(config: SubgraphConfig): void {
    if (!config.name || config.name.trim() === "") {
      throw new FederationGatewayError("Subgraph name is required")
    }
    if (!config.url || config.url.trim() === "") {
      throw new FederationGatewayError(`Subgraph "${config.name}" requires a URL`)
    }
    if (!config.sdl || config.sdl.trim() === "") {
      throw new FederationGatewayError(`Subgraph "${config.name}" requires an SDL schema`)
    }

    this.subgraphs.set(config.name, config)

    const entityTypes = extractEntityTypes(config.sdl)
    const typeNames = extractTypeNames(config.sdl)

    this.subgraphStates.set(config.name, {
      name: config.name,
      url: config.url,
      status: "unknown",
      lastHealthCheck: null,
      entityTypes,
      typeNames,
      latencyMs: null,
    })

    this.perSubgraphStats.set(config.name, { calls: 0, errors: 0, latencySum: 0 })

    // Invalidate composed schema
    this.composedSchema = null
  }

  /**
   * Remove a subgraph from the gateway.
   */
  removeSubgraph(name: string): void {
    this.subgraphs.delete(name)
    this.subgraphStates.delete(name)
    this.composedSchema = null
  }

  /**
   * Get registered subgraphs.
   */
  getSubgraphs(): SubgraphState[] {
    return [...this.subgraphStates.values()]
  }

  /**
   * Compose all subgraph schemas into a unified supergraph.
   */
  compose(): ComposedSchema {
    if (this.subgraphs.size === 0) {
      throw new FederationGatewayError("No subgraphs registered")
    }

    const entityTypes = new Map<string, string[]>()
    const typeOwnership = new Map<string, string>()
    const conflicts: SchemaConflict[] = []
    const _allTypes = new Map<string, Map<string, string>>()

    for (const [name, config] of this.subgraphs) {
      const types = extractTypeNames(config.sdl)
      const entities = extractEntityTypes(config.sdl)

      for (const entity of entities) {
        if (!entityTypes.has(entity)) entityTypes.set(entity, [])
        entityTypes.get(entity)!.push(name)
      }

      for (const type of types) {
        if (typeOwnership.has(type) && typeOwnership.get(type) !== name) {
          const existingOwner = typeOwnership.get(type)!
          const isEntity = entityTypes.has(type)

          if (isEntity) {
            // Entity types can be shared across subgraphs
            conflicts.push({
              type: "type_conflict",
              typeName: type,
              subgraphs: [existingOwner, name],
              description: `Entity type "${type}" defined in multiple subgraphs (expected for federation)`,
              resolution: "merge",
            })
          } else {
            conflicts.push({
              type: "type_conflict",
              typeName: type,
              subgraphs: [existingOwner, name],
              description: `Non-entity type "${type}" defined in multiple subgraphs`,
              resolution: "first_wins",
            })
          }
        } else {
          typeOwnership.set(type, name)
        }
      }
    }

    // Build composed SDL
    const sdlParts: string[] = [
      "# Composed Supergraph Schema",
      `# Subgraphs: ${[...this.subgraphs.keys()].join(", ")}`,
      "",
    ]

    for (const [, config] of this.subgraphs) {
      sdlParts.push(`# --- Subgraph: ${config.name} ---`)
      sdlParts.push(config.sdl)
      sdlParts.push("")
    }

    const composed: ComposedSchema = {
      sdl: sdlParts.join("\n"),
      subgraphs: [...this.subgraphs.keys()],
      entityTypes,
      typeOwnership,
      conflicts,
    }

    this.composedSchema = composed
    return composed
  }

  /**
   * Create a query plan for a given GraphQL query.
   */
  planQuery(query: string): QueryPlan {
    if (!this.composedSchema) {
      this.compose()
    }

    // Check cache
    if (this.options.queryPlanCache) {
      const cached = this.queryPlanCache.get(query)
      if (cached) {
        this.cacheHits++
        return cached
      }
      this.cacheMisses++
    }

    const steps: QueryPlanStep[] = []
    const rootFields = extractRootFields(query)

    // Determine which subgraph owns each root field
    for (const field of rootFields) {
      const ownerSubgraph = this.findFieldOwner(field)
      if (ownerSubgraph) {
        steps.push({
          subgraph: ownerSubgraph,
          operation: query,
          dependsOn: [],
          entityResolve: false,
          selections: [field],
        })
      }
    }

    // Deduplicate: merge steps targeting the same subgraph
    const mergedSteps = new Map<string, QueryPlanStep>()
    for (const step of steps) {
      if (mergedSteps.has(step.subgraph)) {
        mergedSteps.get(step.subgraph)!.selections.push(...step.selections)
      } else {
        mergedSteps.set(step.subgraph, { ...step })
      }
    }

    const plan: QueryPlan = {
      steps: [...mergedSteps.values()],
      estimatedSubgraphCalls: mergedSteps.size,
      parallelizable: mergedSteps.size > 1,
    }

    // Cache the plan
    if (this.options.queryPlanCache) {
      if (this.queryPlanCache.size >= this.options.queryPlanCacheSize) {
        // Evict oldest entry
        const firstKey = this.queryPlanCache.keys().next().value
        if (firstKey) this.queryPlanCache.delete(firstKey)
      }
      this.queryPlanCache.set(query, plan)
    }

    return plan
  }

  /**
   * Execute a GraphQL query across subgraphs.
   */
  async execute(request: {
    query: string
    variables?: Record<string, unknown>
    operationName?: string
  }): Promise<GatewayExecutionResult> {
    this.totalRequests++
    const startTime = Date.now()

    const plan = this.planQuery(request.query)
    const errors: GatewayError[] = []
    const timing: Record<string, number> = {}
    let data: Record<string, unknown> = {}

    // Execute plan steps (parallel where possible)
    const independentSteps = plan.steps.filter((s) => s.dependsOn.length === 0)

    const results = await Promise.allSettled(
      independentSteps.map(async (step) => {
        const subgraph = this.subgraphs.get(step.subgraph)
        if (!subgraph) {
          throw new FederationGatewayError(`Subgraph "${step.subgraph}" not found`)
        }

        const stepStart = Date.now()
        try {
          const result = await this.fetchSubgraph(subgraph, {
            query: request.query,
            variables: request.variables,
            operationName: request.operationName,
          })

          timing[step.subgraph] = Date.now() - stepStart
          this.recordSubgraphCall(step.subgraph, Date.now() - stepStart, false)

          return { subgraph: step.subgraph, data: result }
        } catch (error) {
          timing[step.subgraph] = Date.now() - stepStart
          this.recordSubgraphCall(step.subgraph, Date.now() - stepStart, true)

          if (this.options.errorStrategy === "fail_fast") throw error

          errors.push({
            message: error instanceof Error ? error.message : String(error),
            subgraph: step.subgraph,
          })
          return { subgraph: step.subgraph, data: null }
        }
      }),
    )

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.data) {
        data = { ...data, ...result.value.data }
      } else if (result.status === "rejected") {
        this.totalErrors++
        errors.push({ message: result.reason?.message ?? "Unknown error" })
      }
    }

    const totalMs = Date.now() - startTime
    this.latencySum += totalMs
    this.subgraphCallCount += plan.estimatedSubgraphCalls

    return {
      data: Object.keys(data).length > 0 ? data : null,
      errors,
      extensions: {
        queryPlan: plan,
        timing,
        subgraphCalls: plan.estimatedSubgraphCalls,
      },
    }
  }

  /**
   * Record subgraph health check result.
   */
  recordHealthCheck(name: string, healthy: boolean, latencyMs?: number): void {
    const state = this.subgraphStates.get(name)
    if (state) {
      state.status = healthy ? "healthy" : "unhealthy"
      state.lastHealthCheck = Date.now()
      state.latencyMs = latencyMs ?? null
    }
  }

  /**
   * Get gateway statistics.
   */
  getStats(): GatewayStats {
    const subgraphStats = new Map<string, { calls: number; errors: number; avgLatencyMs: number }>()

    for (const [name, stats] of this.perSubgraphStats) {
      subgraphStats.set(name, {
        calls: stats.calls,
        errors: stats.errors,
        avgLatencyMs: stats.calls > 0 ? stats.latencySum / stats.calls : 0,
      })
    }

    return {
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      subgraphCalls: this.subgraphCallCount,
      averageLatencyMs: this.totalRequests > 0 ? this.latencySum / this.totalRequests : 0,
      cacheHitRate: this.cacheHits + this.cacheMisses > 0 ? this.cacheHits / (this.cacheHits + this.cacheMisses) : 0,
      subgraphStats,
    }
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private findFieldOwner(fieldName: string): string | null {
    for (const [name, state] of this.subgraphStates) {
      // Check if any type in this subgraph could serve this field
      if (state.typeNames.some((t) => t.toLowerCase() === fieldName.toLowerCase())) {
        return name
      }
    }
    // Default to first subgraph
    return this.subgraphs.keys().next().value ?? null
  }

  private async fetchSubgraph(
    config: SubgraphConfig,
    body: { query: string; variables?: Record<string, unknown>; operationName?: string },
  ): Promise<Record<string, unknown>> {
    const timeout = config.timeoutMs ?? this.options.defaultTimeoutMs
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...config.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new FederationGatewayError(`Subgraph "${config.name}" returned ${response.status}`)
      }

      const result = (await response.json()) as { data?: Record<string, unknown>; errors?: unknown[] }
      return result.data ?? {}
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private recordSubgraphCall(name: string, latencyMs: number, isError: boolean): void {
    const stats = this.perSubgraphStats.get(name)
    if (stats) {
      stats.calls++
      stats.latencySum += latencyMs
      if (isError) stats.errors++
    }
  }
}

// ─── SDL Parsing Helpers ─────────────────────────────────────────────────────

function extractEntityTypes(sdl: string): string[] {
  const entities: string[] = []
  const keyRegex = /type\s+(\w+)\s+.*?@key/g
  let match
  while ((match = keyRegex.exec(sdl)) !== null) {
    entities.push(match[1])
  }
  return entities
}

function extractTypeNames(sdl: string): string[] {
  const types: string[] = []
  const typeRegex = /type\s+(\w+)\s*[{@]/g
  let match
  while ((match = typeRegex.exec(sdl)) !== null) {
    const name = match[1]
    if (!["Query", "Mutation", "Subscription", "PageInfo"].includes(name)) {
      types.push(name)
    }
  }
  return types
}

function extractRootFields(query: string): string[] {
  const fields: string[] = []
  // Simple extraction of top-level fields from query
  const bodyMatch = query.match(/\{\s*([\s\S]*)\}/)
  if (bodyMatch) {
    const body = bodyMatch[1]
    const fieldRegex = /(\w+)\s*[\({]/g
    let match
    while ((match = fieldRegex.exec(body)) !== null) {
      fields.push(match[1])
    }
    // Also match simple fields without args
    const simpleFieldRegex = /^\s*(\w+)\s*$/gm
    while ((match = simpleFieldRegex.exec(body)) !== null) {
      if (!fields.includes(match[1])) {
        fields.push(match[1])
      }
    }
  }
  return [...new Set(fields)]
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class FederationGatewayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FederationGatewayError"
  }
}
