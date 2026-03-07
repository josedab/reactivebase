/**
 * Incremental Deployment & Blue-Green Migrations
 *
 * Zero-downtime deployments where old and new server versions run simultaneously
 * with schema version routing. Clients connected to v1 seamlessly transition to
 * v2 subscriptions. Includes canary rollout and automatic rollback on error-rate.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type DeploymentPhase = "idle" | "canary" | "rolling" | "complete" | "rolling_back" | "rolled_back"
export type VersionStatus = "active" | "draining" | "inactive"

export interface ServerVersion {
  readonly version: string
  status: VersionStatus
  connectionCount: number
  subscriptionCount: number
  errorCount: number
  requestCount: number
  registeredAt: Date
}

export type QueryExecutor = (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>

export interface BlueGreenDeploymentConfig {
  canaryPercentage: number
  errorRateThreshold: number
  rolloutStepPercentage: number
  rolloutStepIntervalMs: number
  healthCheckIntervalMs: number
  drainTimeoutMs: number
  minHealthyDuration: number
  db?: QueryExecutor
}

const DEFAULT_DEPLOYMENT_CONFIG: BlueGreenDeploymentConfig = {
  canaryPercentage: 5,
  errorRateThreshold: 0.05, // 5% error rate triggers rollback
  rolloutStepPercentage: 25,
  rolloutStepIntervalMs: 60_000,
  healthCheckIntervalMs: 5_000,
  drainTimeoutMs: 30_000,
  minHealthyDuration: 30_000,
}

export interface VersionRoute {
  connectionId: string
  assignedVersion: string
}

export interface DeploymentState {
  phase: DeploymentPhase
  oldVersion: string | null
  newVersion: string | null
  currentPercentage: number
  startedAt: Date | null
  errors: DeploymentError[]
}

export interface DeploymentError {
  readonly version: string
  readonly error: string
  readonly timestamp: Date
}

export interface RollbackReason {
  readonly trigger: "error_rate" | "manual" | "health_check" | "timeout"
  readonly details: string
  readonly timestamp: Date
}

// ── Schema ───────────────────────────────────────────────────────────────────

export function generateDeploymentTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_deployments (
  id TEXT PRIMARY KEY,
  blue_version TEXT NOT NULL,
  green_version TEXT,
  phase TEXT NOT NULL DEFAULT 'blue_only',
  canary_percent INTEGER NOT NULL DEFAULT 0,
  blue_error_count INTEGER NOT NULL DEFAULT 0,
  green_error_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _reactivebase_subscription_migrations (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  from_version TEXT NOT NULL,
  to_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`.trim()
}

// ── Version Router ───────────────────────────────────────────────────────────

export class VersionRouter {
  private routes = new Map<string, string>()
  private currentPercentage = 0
  private oldVersion: string | null = null
  private newVersion: string | null = null
  private routeCounter = 0

  /**
   * Set the active versions for routing.
   */
  setVersions(oldVersion: string, newVersion: string, newVersionPercentage: number): void {
    this.oldVersion = oldVersion
    this.newVersion = newVersion
    this.currentPercentage = Math.max(0, Math.min(100, newVersionPercentage))
  }

  /**
   * Route a connection to a server version based on canary percentage.
   */
  routeConnection(connectionId: string): string {
    // If already routed, keep sticky routing
    const existing = this.routes.get(connectionId)
    if (existing) return existing

    if (!this.oldVersion || !this.newVersion) {
      return this.oldVersion ?? this.newVersion ?? "unknown"
    }

    // Deterministic routing based on percentage
    this.routeCounter++
    const shouldRouteToNew = this.routeCounter % 100 < this.currentPercentage

    const version = shouldRouteToNew ? this.newVersion : this.oldVersion
    this.routes.set(connectionId, version)
    return version
  }

  /**
   * Remove a connection's routing.
   */
  removeConnection(connectionId: string): void {
    this.routes.delete(connectionId)
  }

  /**
   * Get the count of connections per version.
   */
  getDistribution(): Map<string, number> {
    const dist = new Map<string, number>()
    for (const version of this.routes.values()) {
      dist.set(version, (dist.get(version) ?? 0) + 1)
    }
    return dist
  }

  getCurrentPercentage(): number {
    return this.currentPercentage
  }

  getRouteCount(): number {
    return this.routes.size
  }
}

// ── Subscription Migrator ────────────────────────────────────────────────────

export interface SubscriptionMigration {
  readonly connectionId: string
  readonly subscriptionId: string
  readonly queryName: string
  readonly args: unknown
  fromVersion: string
  toVersion: string
  status: "pending" | "migrating" | "completed" | "failed"
}

export class SubscriptionMigrator {
  private migrations: SubscriptionMigration[] = []
  private migratedCount = 0
  private failedCount = 0

  /**
   * Queue subscriptions for migration from old to new version.
   */
  queueMigration(
    connectionId: string,
    subscriptions: Array<{ subscriptionId: string; queryName: string; args: unknown }>,
    fromVersion: string,
    toVersion: string,
  ): void {
    for (const sub of subscriptions) {
      this.migrations.push({
        connectionId,
        subscriptionId: sub.subscriptionId,
        queryName: sub.queryName,
        args: sub.args,
        fromVersion,
        toVersion,
        status: "pending",
      })
    }
  }

  /**
   * Process pending migrations in batches.
   */
  async processBatch(
    batchSize: number,
    migrateFn?: (migration: SubscriptionMigration) => Promise<boolean>,
  ): Promise<{ migrated: number; failed: number }> {
    const defaultMigrateFn = async (migration: SubscriptionMigration): Promise<boolean> => {
      // Default: mark as migrated. Real apps override this.
      migration.status = "completed"
      return true
    }
    const fn = migrateFn ?? defaultMigrateFn
    const pending = this.migrations.filter((m) => m.status === "pending").slice(0, batchSize)
    let migrated = 0
    let failed = 0

    for (const migration of pending) {
      migration.status = "migrating"
      try {
        const success = await fn(migration)
        if (success) {
          migration.status = "completed"
          migrated++
          this.migratedCount++
        } else {
          migration.status = "failed"
          failed++
          this.failedCount++
        }
      } catch {
        migration.status = "failed"
        failed++
        this.failedCount++
      }
    }

    return { migrated, failed }
  }

  getPendingCount(): number {
    return this.migrations.filter((m) => m.status === "pending").length
  }

  getStats(): { total: number; pending: number; migrated: number; failed: number } {
    return {
      total: this.migrations.length,
      pending: this.getPendingCount(),
      migrated: this.migratedCount,
      failed: this.failedCount,
    }
  }
}

// ── Deployment Coordinator ───────────────────────────────────────────────────

export type DeploymentEventHandler = (event: {
  type: "phase_changed" | "rollback_triggered" | "deployment_complete" | "error"
  data: Record<string, unknown>
}) => void

export class DeploymentCoordinator {
  private versions = new Map<string, ServerVersion>()
  private router: VersionRouter
  private migrator: SubscriptionMigrator
  private state: DeploymentState
  private config: BlueGreenDeploymentConfig
  private handlers = new Set<DeploymentEventHandler>()
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private db?: QueryExecutor
  private deploymentId: string

  constructor(config: Partial<BlueGreenDeploymentConfig> = {}) {
    this.config = { ...DEFAULT_DEPLOYMENT_CONFIG, ...config }
    this.db = this.config.db
    this.deploymentId = `deploy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.router = new VersionRouter()
    this.migrator = new SubscriptionMigrator()
    this.state = {
      phase: "idle",
      oldVersion: null,
      newVersion: null,
      currentPercentage: 0,
      startedAt: null,
      errors: [],
    }
  }

  /**
   * Register a server version.
   */
  registerVersion(version: string): void {
    this.versions.set(version, {
      version,
      status: "active",
      connectionCount: 0,
      subscriptionCount: 0,
      errorCount: 0,
      requestCount: 0,
      registeredAt: new Date(),
    })
  }

  /**
   * Start a canary deployment from old to new version.
   */
  startCanaryDeployment(oldVersion: string, newVersion: string): void {
    if (!this.versions.has(oldVersion)) throw new Error(`Unknown version: ${oldVersion}`)
    if (!this.versions.has(newVersion)) throw new Error(`Unknown version: ${newVersion}`)
    if (this.state.phase !== "idle") throw new Error(`Deployment already in progress: ${this.state.phase}`)

    this.state = {
      phase: "canary",
      oldVersion,
      newVersion,
      currentPercentage: this.config.canaryPercentage,
      startedAt: new Date(),
      errors: [],
    }

    this.router.setVersions(oldVersion, newVersion, this.config.canaryPercentage)

    this.emit({ type: "phase_changed", data: { phase: "canary", percentage: this.config.canaryPercentage } })

    this.persistState()
  }

  /**
   * Advance the deployment to the next rollout step.
   */
  advanceRollout(): void {
    if (this.state.phase !== "canary" && this.state.phase !== "rolling") return

    this.state.currentPercentage = Math.min(100, this.state.currentPercentage + this.config.rolloutStepPercentage)
    this.state.phase = this.state.currentPercentage >= 100 ? "complete" : "rolling"

    if (this.state.oldVersion && this.state.newVersion) {
      this.router.setVersions(this.state.oldVersion, this.state.newVersion, this.state.currentPercentage)
    }

    if (this.state.phase === "complete") {
      // Mark old version as draining
      const old = this.versions.get(this.state.oldVersion!)
      if (old) old.status = "draining"

      this.emit({ type: "deployment_complete", data: { version: this.state.newVersion } })
    } else {
      this.emit({ type: "phase_changed", data: { phase: "rolling", percentage: this.state.currentPercentage } })
    }

    this.persistState()
  }

  /**
   * Record an error for a version to track error rates.
   */
  recordError(version: string, error: string): void {
    const v = this.versions.get(version)
    if (v) {
      v.errorCount++
      this.state.errors.push({ version, error, timestamp: new Date() })
    }

    // Check if error rate threshold exceeded for new version
    if (version === this.state.newVersion && v) {
      v.requestCount = Math.max(v.requestCount, 1)
      const errorRate = v.errorCount / v.requestCount
      if (errorRate > this.config.errorRateThreshold && v.requestCount >= 10) {
        this.triggerRollback({
          trigger: "error_rate",
          details: `Error rate ${(errorRate * 100).toFixed(1)}% exceeds threshold ${(this.config.errorRateThreshold * 100).toFixed(1)}%`,
          timestamp: new Date(),
        })
      }
    }
  }

  /**
   * Record a successful request for a version.
   */
  recordRequest(version: string): void {
    const v = this.versions.get(version)
    if (v) v.requestCount++
  }

  /**
   * Trigger a rollback to the old version.
   */
  triggerRollback(reason: RollbackReason): void {
    if (this.state.phase === "idle" || this.state.phase === "rolled_back") return

    this.state.phase = "rolling_back"

    if (this.state.oldVersion && this.state.newVersion) {
      this.router.setVersions(this.state.oldVersion, this.state.newVersion, 0)
    }

    // Mark new version as draining
    if (this.state.newVersion) {
      const newV = this.versions.get(this.state.newVersion)
      if (newV) newV.status = "draining"
    }

    this.state.phase = "rolled_back"
    this.state.currentPercentage = 0

    this.emit({
      type: "rollback_triggered",
      data: { reason: reason.trigger, details: reason.details },
    })

    this.persistState()
  }

  /**
   * Route a connection to the appropriate version.
   */
  routeConnection(connectionId: string): string {
    return this.router.routeConnection(connectionId)
  }

  getState(): Readonly<DeploymentState> {
    return { ...this.state }
  }

  getVersions(): ServerVersion[] {
    return Array.from(this.versions.values())
  }

  getRouter(): VersionRouter {
    return this.router
  }

  getMigrator(): SubscriptionMigrator {
    return this.migrator
  }

  onEvent(handler: DeploymentEventHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  /**
   * Initialize deployment tracking tables. Call once at startup.
   */
  async initTables(): Promise<void> {
    if (!this.db) return
    const statements = generateDeploymentTableSQL()
      .split(";")
      .filter((s) => s.trim())
    for (const stmt of statements) {
      await this.db(stmt, [])
    }
  }

  /**
   * Recover deployment state from the database.
   */
  async recoverState(): Promise<void> {
    if (!this.db) return
    const result = await this.db("SELECT * FROM _reactivebase_deployments WHERE id = $1", [this.deploymentId])
    if (result.rows.length > 0) {
      const row = result.rows[0]
      this.state.phase = row.phase as DeploymentPhase
      this.state.oldVersion = (row.blue_version as string) ?? null
      this.state.newVersion = (row.green_version as string) ?? null
      this.state.currentPercentage = (row.canary_percent as number) ?? 0
    }
  }

  private persistState(): void {
    if (!this.db) return
    this.db(
      `INSERT INTO _reactivebase_deployments (id, blue_version, green_version, phase, canary_percent) 
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET 
         green_version = $3, phase = $4, canary_percent = $5, updated_at = NOW()`,
      [this.deploymentId, this.state.oldVersion, this.state.newVersion, this.state.phase, this.state.currentPercentage],
    ).catch((err: unknown) => {
      if (process.env.NODE_ENV !== "production") {
        console.debug("[ReactiveBase] DB persistence error:", err instanceof Error ? err.message : err)
      }
    })
  }

  private emit(event: Parameters<DeploymentEventHandler>[0]): void {
    for (const handler of this.handlers) {
      handler(event)
    }
  }
}
