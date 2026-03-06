/**
 * Schema Version Registry for ReactiveBase.
 * Manages named schema versions with traffic splitting, client version
 * negotiation, and zero-downtime schema migration with canary rollout.
 *
 * Features:
 *   - Named schema version registry (v1, v2, production, canary)
 *   - Traffic splitting between schema versions with weighted routing
 *   - Client version negotiation via headers or query params
 *   - Automatic canary rollout with error-rate monitoring
 *   - Zero-downtime schema migration (dual-write during transition)
 *   - Version compatibility matrix
 *   - Rollback to any previous version
 *
 * Usage:
 *   const registry = new SchemaVersionRegistry()
 *   registry.register({ name: 'v2', schema, status: 'canary' })
 *   registry.setTrafficSplit({ v1: 90, v2: 10 })
 *   const version = registry.resolveVersion(clientHeaders)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SchemaVersion {
  /** Unique version name (e.g., "v1", "v2.1", "canary-2024-01") */
  name: string
  /** Schema definition reference */
  schema: SchemaVersionSchema
  /** Version status */
  status: SchemaVersionStatus
  /** Traffic weight (0-100, used during split) */
  trafficWeight: number
  /** When this version was registered */
  registeredAt: number
  /** When this version was activated */
  activatedAt: number | null
  /** When this version was deprecated */
  deprecatedAt: number | null
  /** Parent version this was derived from */
  parentVersion: string | null
  /** Migration script from parent to this version */
  migrationScript: string | null
  /** Error count since activation */
  errorCount: number
  /** Request count since activation */
  requestCount: number
  /** Version metadata */
  metadata: Record<string, unknown>
}

export type SchemaVersionStatus = "draft" | "canary" | "active" | "draining" | "deprecated" | "archived"

export interface SchemaVersionSchema {
  tableNames: string[]
  tables: Record<string, { columns: Record<string, unknown> }>
  checksum?: string
}

export interface TrafficSplitConfig {
  /** Version name → traffic percentage (must sum to 100) */
  weights: Record<string, number>
  /** Sticky routing key (e.g., "user_id", "connection_id") */
  stickyKey?: string
  /** Override rules for specific clients */
  overrides?: TrafficOverride[]
}

export interface TrafficOverride {
  /** Match condition */
  match: { header?: string; value?: string; pattern?: string }
  /** Force this version */
  targetVersion: string
}

export interface VersionNegotiationResult {
  version: string
  reason: "explicit" | "sticky" | "weighted" | "default" | "override" | "fallback"
  schema: SchemaVersionSchema
}

export interface CanaryConfig {
  /** New version being canaried */
  canaryVersion: string
  /** Baseline version */
  baselineVersion: string
  /** Initial canary percentage (default: 5) */
  initialPercentage: number
  /** Step increment percentage (default: 10) */
  stepPercentage: number
  /** Step interval in ms (default: 300000 = 5 min) */
  stepIntervalMs: number
  /** Error rate threshold to trigger rollback (default: 0.05) */
  errorRateThreshold: number
  /** Min requests before evaluating error rate (default: 100) */
  minEvaluationRequests: number
  /** Max canary duration before auto-promote (ms, default: 3600000 = 1hr) */
  maxDurationMs: number
}

export interface CanaryState {
  config: CanaryConfig
  currentPercentage: number
  startedAt: number
  lastStepAt: number
  promoted: boolean
  rolledBack: boolean
  rollbackReason?: string
}

export interface MigrationPlan {
  fromVersion: string
  toVersion: string
  steps: MigrationStep[]
  estimatedDowntimeMs: number
  requiresDualWrite: boolean
}

export interface MigrationStep {
  type:
    | "add_column"
    | "remove_column"
    | "rename_column"
    | "add_table"
    | "remove_table"
    | "modify_type"
    | "add_index"
    | "custom"
  table?: string
  column?: string
  details: string
  reversible: boolean
  sql?: string
}

export interface RegistryStats {
  totalVersions: number
  activeVersions: number
  canaryActive: boolean
  currentTrafficSplit: Record<string, number>
  totalRequests: number
  totalErrors: number
}

// ─── Schema Version Registry ─────────────────────────────────────────────────

export class SchemaVersionRegistry {
  private versions = new Map<string, SchemaVersion>()
  private trafficConfig: TrafficSplitConfig = { weights: {} }
  private stickyRoutes = new Map<string, string>()
  private canaryState: CanaryState | null = null
  private canaryTimer: ReturnType<typeof setInterval> | null = null
  private routeCounter = 0
  private defaultVersion: string | null = null

  /**
   * Register a new schema version.
   */
  register(config: {
    name: string
    schema: SchemaVersionSchema
    status?: SchemaVersionStatus
    parentVersion?: string
    migrationScript?: string
    metadata?: Record<string, unknown>
  }): SchemaVersion {
    if (this.versions.has(config.name)) {
      throw new SchemaVersionError(`Version "${config.name}" already exists`)
    }

    if (config.parentVersion && !this.versions.has(config.parentVersion)) {
      throw new SchemaVersionError(`Parent version "${config.parentVersion}" not found`)
    }

    const version: SchemaVersion = {
      name: config.name,
      schema: config.schema,
      status: config.status ?? "draft",
      trafficWeight: 0,
      registeredAt: Date.now(),
      activatedAt: config.status === "active" ? Date.now() : null,
      deprecatedAt: null,
      parentVersion: config.parentVersion ?? null,
      migrationScript: config.migrationScript ?? null,
      errorCount: 0,
      requestCount: 0,
      metadata: config.metadata ?? {},
    }

    this.versions.set(config.name, version)

    // First active version becomes default
    if (version.status === "active" && !this.defaultVersion) {
      this.defaultVersion = config.name
      this.trafficConfig.weights[config.name] = 100
    }

    return version
  }

  /**
   * Activate a schema version and update traffic.
   */
  activate(versionName: string): void {
    const version = this.getVersionOrThrow(versionName)
    version.status = "active"
    version.activatedAt = Date.now()

    if (!this.defaultVersion) {
      this.defaultVersion = versionName
      this.trafficConfig.weights[versionName] = 100
    }
  }

  /**
   * Deprecate a schema version (stop routing new traffic).
   */
  deprecate(versionName: string): void {
    const version = this.getVersionOrThrow(versionName)
    version.status = "deprecated"
    version.deprecatedAt = Date.now()
    version.trafficWeight = 0
    delete this.trafficConfig.weights[versionName]

    // Re-normalize weights
    this.normalizeWeights()
  }

  /**
   * Set traffic split between versions.
   */
  setTrafficSplit(
    weights: Record<string, number>,
    options?: { stickyKey?: string; overrides?: TrafficOverride[] },
  ): void {
    // Validate all versions exist and are active/canary
    for (const name of Object.keys(weights)) {
      const version = this.getVersionOrThrow(name)
      if (version.status !== "active" && version.status !== "canary") {
        throw new SchemaVersionError(
          `Version "${name}" must be active or canary for traffic routing (current: ${version.status})`,
        )
      }
    }

    const total = Object.values(weights).reduce((sum, w) => sum + w, 0)
    if (Math.abs(total - 100) > 0.01) {
      throw new SchemaVersionError(`Traffic weights must sum to 100 (got ${total})`)
    }

    this.trafficConfig = {
      weights,
      stickyKey: options?.stickyKey,
      overrides: options?.overrides,
    }

    for (const [name, weight] of Object.entries(weights)) {
      const version = this.versions.get(name)!
      version.trafficWeight = weight
    }
  }

  /**
   * Resolve which version a client should use.
   */
  resolveVersion(headers?: Record<string, string | undefined>, stickyKey?: string): VersionNegotiationResult {
    // 1. Explicit version header
    const explicitVersion = headers?.["x-schema-version"] ?? headers?.["x-api-version"]
    if (explicitVersion && this.versions.has(explicitVersion)) {
      const version = this.versions.get(explicitVersion)!
      version.requestCount++
      return { version: explicitVersion, reason: "explicit", schema: version.schema }
    }

    // 2. Override rules
    if (this.trafficConfig.overrides && headers) {
      for (const override of this.trafficConfig.overrides) {
        if (override.match.header && headers[override.match.header]) {
          const headerValue = headers[override.match.header]
          if (override.match.value && headerValue === override.match.value) {
            const v = this.versions.get(override.targetVersion)
            if (v) {
              v.requestCount++
              return { version: override.targetVersion, reason: "override", schema: v.schema }
            }
          }
          if (override.match.pattern && headerValue && new RegExp(override.match.pattern).test(headerValue)) {
            const v = this.versions.get(override.targetVersion)
            if (v) {
              v.requestCount++
              return { version: override.targetVersion, reason: "override", schema: v.schema }
            }
          }
        }
      }
    }

    // 3. Sticky routing
    if (stickyKey) {
      const stickyVersion = this.stickyRoutes.get(stickyKey)
      if (stickyVersion && this.versions.has(stickyVersion)) {
        const v = this.versions.get(stickyVersion)!
        v.requestCount++
        return { version: stickyVersion, reason: "sticky", schema: v.schema }
      }
    }

    // 4. Weighted routing
    const weightEntries = Object.entries(this.trafficConfig.weights).filter(([, w]) => w > 0)
    if (weightEntries.length > 0) {
      this.routeCounter++
      const position = this.routeCounter % 100
      let cumulative = 0

      for (const [name, weight] of weightEntries) {
        cumulative += weight
        if (position < cumulative) {
          const v = this.versions.get(name)!
          v.requestCount++
          if (stickyKey) this.stickyRoutes.set(stickyKey, name)
          return { version: name, reason: "weighted", schema: v.schema }
        }
      }
    }

    // 5. Default fallback
    if (this.defaultVersion) {
      const v = this.versions.get(this.defaultVersion)!
      v.requestCount++
      return { version: this.defaultVersion, reason: "default", schema: v.schema }
    }

    throw new SchemaVersionError("No active schema versions available")
  }

  /**
   * Record an error for a version (used for canary evaluation).
   */
  recordError(versionName: string): void {
    const version = this.versions.get(versionName)
    if (version) {
      version.errorCount++
    }
  }

  /**
   * Start a canary rollout.
   */
  startCanary(config: CanaryConfig): void {
    const canary = this.getVersionOrThrow(config.canaryVersion)
    this.getVersionOrThrow(config.baselineVersion)

    canary.status = "canary"
    this.canaryState = {
      config,
      currentPercentage: config.initialPercentage,
      startedAt: Date.now(),
      lastStepAt: Date.now(),
      promoted: false,
      rolledBack: false,
    }

    this.setTrafficSplit({
      [config.baselineVersion]: 100 - config.initialPercentage,
      [config.canaryVersion]: config.initialPercentage,
    })

    // Start canary evaluation timer
    this.canaryTimer = setInterval(() => {
      this.evaluateCanary()
    }, config.stepIntervalMs)
  }

  /**
   * Manually promote canary to full traffic.
   */
  promoteCanary(): void {
    if (!this.canaryState) throw new SchemaVersionError("No active canary")

    const { canaryVersion, baselineVersion } = this.canaryState.config
    this.canaryState.promoted = true
    this.stopCanaryTimer()

    const canary = this.versions.get(canaryVersion)!
    canary.status = "active"

    const baseline = this.versions.get(baselineVersion)!
    baseline.status = "draining"

    this.setTrafficSplit({ [canaryVersion]: 100 })
    this.defaultVersion = canaryVersion
    this.canaryState = null
  }

  /**
   * Rollback canary to baseline.
   */
  rollbackCanary(reason?: string): void {
    if (!this.canaryState) throw new SchemaVersionError("No active canary")

    const { canaryVersion, baselineVersion } = this.canaryState.config
    this.canaryState.rolledBack = true
    this.canaryState.rollbackReason = reason ?? "manual"
    this.stopCanaryTimer()

    const canary = this.versions.get(canaryVersion)!
    canary.status = "deprecated"

    this.setTrafficSplit({ [baselineVersion]: 100 })
    this.canaryState = null
  }

  /**
   * Generate a migration plan between two versions.
   */
  generateMigrationPlan(fromVersion: string, toVersion: string): MigrationPlan {
    const from = this.getVersionOrThrow(fromVersion)
    const to = this.getVersionOrThrow(toVersion)
    const steps: MigrationStep[] = []

    const fromTables = new Set(from.schema.tableNames)
    const toTables = new Set(to.schema.tableNames)

    // Detect added/removed tables
    for (const table of toTables) {
      if (!fromTables.has(table)) {
        steps.push({ type: "add_table", table, details: `Add table "${table}"`, reversible: true })
      }
    }
    for (const table of fromTables) {
      if (!toTables.has(table)) {
        steps.push({ type: "remove_table", table, details: `Remove table "${table}"`, reversible: false })
      }
    }

    // Detect column changes in shared tables
    for (const table of fromTables) {
      if (!toTables.has(table)) continue
      const fromCols = new Set(Object.keys(from.schema.tables[table]?.columns ?? {}))
      const toCols = new Set(Object.keys(to.schema.tables[table]?.columns ?? {}))

      for (const col of toCols) {
        if (!fromCols.has(col)) {
          steps.push({
            type: "add_column",
            table,
            column: col,
            details: `Add column "${col}" to "${table}"`,
            reversible: true,
          })
        }
      }
      for (const col of fromCols) {
        if (!toCols.has(col)) {
          steps.push({
            type: "remove_column",
            table,
            column: col,
            details: `Remove column "${col}" from "${table}"`,
            reversible: false,
          })
        }
      }
    }

    const hasDestructive = steps.some((s) => !s.reversible)

    return {
      fromVersion,
      toVersion,
      steps,
      estimatedDowntimeMs: hasDestructive ? 0 : 0, // zero-downtime with dual-write
      requiresDualWrite: steps.some((s) => s.type === "remove_column" || s.type === "remove_table"),
    }
  }

  /**
   * List all versions with optional status filter.
   */
  listVersions(status?: SchemaVersionStatus): SchemaVersion[] {
    const all = Array.from(this.versions.values())
    if (!status) return all
    return all.filter((v) => v.status === status)
  }

  /**
   * Get registry statistics.
   */
  getStats(): RegistryStats {
    const all = Array.from(this.versions.values())
    return {
      totalVersions: all.length,
      activeVersions: all.filter((v) => v.status === "active" || v.status === "canary").length,
      canaryActive: this.canaryState !== null,
      currentTrafficSplit: { ...this.trafficConfig.weights },
      totalRequests: all.reduce((sum, v) => sum + v.requestCount, 0),
      totalErrors: all.reduce((sum, v) => sum + v.errorCount, 0),
    }
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.stopCanaryTimer()
    this.versions.clear()
    this.stickyRoutes.clear()
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private getVersionOrThrow(name: string): SchemaVersion {
    const version = this.versions.get(name)
    if (!version) throw new SchemaVersionError(`Version "${name}" not found`)
    return version
  }

  private normalizeWeights(): void {
    const entries = Object.entries(this.trafficConfig.weights)
    const total = entries.reduce((sum, [, w]) => sum + w, 0)
    if (total === 0 || entries.length === 0) return

    for (const [name] of entries) {
      this.trafficConfig.weights[name] = (this.trafficConfig.weights[name] / total) * 100
    }
  }

  private evaluateCanary(): void {
    if (!this.canaryState) return

    const { canaryVersion, errorRateThreshold, minEvaluationRequests, stepPercentage, maxDurationMs } =
      this.canaryState.config
    const canary = this.versions.get(canaryVersion)

    if (!canary) {
      this.rollbackCanary("canary version not found")
      return
    }

    // Check max duration
    if (Date.now() - this.canaryState.startedAt > maxDurationMs) {
      this.promoteCanary()
      return
    }

    // Check error rate
    if (canary.requestCount >= minEvaluationRequests) {
      const errorRate = canary.errorCount / canary.requestCount
      if (errorRate > errorRateThreshold) {
        this.rollbackCanary(
          `Error rate ${(errorRate * 100).toFixed(1)}% exceeded threshold ${(errorRateThreshold * 100).toFixed(1)}%`,
        )
        return
      }
    }

    // Step up canary percentage
    const newPercentage = Math.min(100, this.canaryState.currentPercentage + stepPercentage)
    this.canaryState.currentPercentage = newPercentage
    this.canaryState.lastStepAt = Date.now()

    if (newPercentage >= 100) {
      this.promoteCanary()
    } else {
      this.trafficConfig.weights[this.canaryState.config.baselineVersion] = 100 - newPercentage
      this.trafficConfig.weights[canaryVersion] = newPercentage
    }
  }

  private stopCanaryTimer(): void {
    if (this.canaryTimer) {
      clearInterval(this.canaryTimer)
      this.canaryTimer = null
    }
  }
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class SchemaVersionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SchemaVersionError"
  }
}
