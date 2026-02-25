/**
 * Multi-Database Federation for ReactiveBase.
 * Supports multiple named database connections with independent schemas,
 * migrations, and connection pools.
 *
 * Usage:
 *   const federation = new DatabaseFederation({
 *     databases: {
 *       primary: { connectionString: process.env.PRIMARY_DB_URL, default: true },
 *       analytics: { connectionString: process.env.ANALYTICS_DB_URL },
 *       legacy: { connectionString: process.env.LEGACY_DB_URL, readOnly: true },
 *     },
 *   })
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DatabaseConfig {
  connectionString: string
  /** Pool size (default: 10) */
  poolSize?: number
  /** Whether this is the default database (default: false) */
  default?: boolean
  /** Read-only mode (default: false) */
  readOnly?: boolean
  /** Connection label for logging */
  label?: string
  /** SSL mode */
  ssl?: boolean | "require" | "prefer"
}

export interface FederationConfig {
  databases: Record<string, DatabaseConfig>
}

export interface DatabaseInfo {
  name: string
  config: DatabaseConfig
  status: "connected" | "disconnected" | "error"
  latencyMs: number
  poolSize: number
  activeConnections: number
  idleConnections: number
  lastHealthCheck: number
  error?: string
}

export interface CrossDatabaseQuery {
  database: string
  table: string
  query: string
  params: unknown[]
}

export interface FederatedQueryResult<T = unknown> {
  data: T
  database: string
  durationMs: number
}

// ─── SQL Helpers ─────────────────────────────────────────────────────────────

export function buildHealthCheckSQL(): { sql: string; params: unknown[] } {
  return { sql: "SELECT 1 AS health", params: [] }
}

export function buildPoolStatsSQL(): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT
      count(*) FILTER (WHERE state = 'active') AS active,
      count(*) FILTER (WHERE state = 'idle') AS idle,
      count(*) AS total
    FROM pg_stat_activity
    WHERE datname = current_database()`,
    params: [],
  }
}

export function buildDatabaseInfoSQL(): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT
      current_database() AS name,
      pg_size_pretty(pg_database_size(current_database())) AS size,
      (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') AS table_count`,
    params: [],
  }
}

// ─── DatabaseFederation ──────────────────────────────────────────────────────

const DEFAULT_POOL_SIZE = 10

export class DatabaseFederation {
  private databases = new Map<string, DatabaseConfig>()
  private healthStatus = new Map<string, DatabaseInfo>()
  private defaultDb: string | null = null
  private tableRoutingMap = new Map<string, string>()
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: FederationConfig) {
    for (const [name, dbConfig] of Object.entries(config.databases)) {
      this.databases.set(name, dbConfig)
      this.healthStatus.set(name, {
        name,
        config: dbConfig,
        status: "disconnected",
        latencyMs: 0,
        poolSize: dbConfig.poolSize ?? DEFAULT_POOL_SIZE,
        activeConnections: 0,
        idleConnections: 0,
        lastHealthCheck: 0,
      })

      if (dbConfig.default) {
        if (this.defaultDb) {
          throw new FederationError("Only one database can be marked as default")
        }
        this.defaultDb = name
      }
    }

    // If no default specified, use the first one
    if (!this.defaultDb && this.databases.size > 0) {
      this.defaultDb = [...this.databases.keys()][0]
    }
  }

  /**
   * Get the default database name.
   */
  get defaultDatabase(): string | null {
    return this.defaultDb
  }

  /**
   * Get the configuration for a named database.
   */
  getConfig(name: string): DatabaseConfig | undefined {
    return this.databases.get(name)
  }

  /**
   * Register a table-to-database routing rule.
   */
  routeTable(tableName: string, databaseName: string): void {
    if (!this.databases.has(databaseName)) {
      throw new FederationError(`Database "${databaseName}" not registered`)
    }
    this.tableRoutingMap.set(tableName, databaseName)
  }

  /**
   * Resolve which database a table belongs to.
   */
  resolveDatabase(tableName: string): string {
    const routed = this.tableRoutingMap.get(tableName)
    if (routed) return routed
    if (this.defaultDb) return this.defaultDb
    throw new FederationError(`No database found for table "${tableName}" and no default set`)
  }

  /**
   * Build a query routed to the correct database.
   */
  buildRoutedQuery(tableName: string, sql: string, params: unknown[] = []): CrossDatabaseQuery {
    return {
      database: this.resolveDatabase(tableName),
      table: tableName,
      query: sql,
      params,
    }
  }

  /**
   * Check if a database is read-only.
   */
  isReadOnly(name: string): boolean {
    return this.databases.get(name)?.readOnly ?? false
  }

  /**
   * Get health status for all databases.
   */
  getHealth(): DatabaseInfo[] {
    return [...this.healthStatus.values()]
  }

  /**
   * Get health status for a specific database.
   */
  getDatabaseHealth(name: string): DatabaseInfo | undefined {
    return this.healthStatus.get(name)
  }

  /**
   * Update health status for a database (called after health check).
   */
  updateHealth(name: string, update: Partial<DatabaseInfo>): void {
    const current = this.healthStatus.get(name)
    if (current) {
      Object.assign(current, update, { lastHealthCheck: Date.now() })
    }
  }

  /**
   * Start periodic health checks.
   */
  startHealthChecks(
    checkFn: (name: string, config: DatabaseConfig) => Promise<{ latencyMs: number; active: number; idle: number }>,
    intervalMs: number = 30_000,
  ): void {
    if (this.healthCheckTimer) return

    const runChecks = async () => {
      for (const [name, config] of this.databases) {
        try {
          const result = await checkFn(name, config)
          this.updateHealth(name, {
            status: "connected",
            latencyMs: result.latencyMs,
            activeConnections: result.active,
            idleConnections: result.idle,
            error: undefined,
          })
        } catch (error: unknown) {
          this.updateHealth(name, {
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    runChecks()
    this.healthCheckTimer = setInterval(runChecks, intervalMs)
  }

  /**
   * Stop health checks.
   */
  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  /**
   * List all database names.
   */
  listDatabases(): string[] {
    return [...this.databases.keys()]
  }

  /**
   * Get table routing map.
   */
  getRoutingMap(): Record<string, string> {
    const map: Record<string, string> = {}
    for (const [table, db] of this.tableRoutingMap) {
      map[table] = db
    }
    return map
  }

  get databaseCount(): number {
    return this.databases.size
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.stopHealthChecks()
    this.databases.clear()
    this.healthStatus.clear()
    this.tableRoutingMap.clear()
  }
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class FederationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FederationError"
  }
}
