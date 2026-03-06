/**
 * Tenant-aware connection routing for ReactiveBase.
 * Routes database connections based on tenant isolation mode (row-level or schema-per-tenant).
 * Manages per-tenant connection pools with configurable sizes.
 *
 * Usage:
 *   const router = new TenantConnectionRouter({ mode: "row", column: "tenant_id" })
 *   const conn = await router.getConnection("acme")
 *   conn.release()
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TenantConnectionConfig {
  /** Isolation mode */
  mode: "row" | "schema"
  /** Column name for row-level tenancy (default: "tenant_id") */
  column?: string
  /** Max connections per tenant pool (default: 10) */
  maxPoolSize?: number
  /** Min connections per tenant pool (default: 1) */
  minPoolSize?: number
  /** Idle timeout in ms before closing a tenant connection (default: 30000) */
  idleTimeoutMs?: number
  /** Shared connection string for row-level mode */
  connectionString?: string
}

export interface TenantConnection {
  tenantId: string
  connectionId: string
  mode: "row" | "schema"
  /** SQL that was executed to set the tenant context */
  contextSQL: string
  /** Release this connection back to the pool */
  release(): void
  /** Whether the connection is currently in use */
  inUse: boolean
  createdAt: number
}

export interface TenantPoolStats {
  tenantId: string
  totalConnections: number
  activeConnections: number
  idleConnections: number
  waitingRequests: number
  createdAt: number
  lastUsedAt: number
}

interface TenantPool {
  tenantId: string
  connections: TenantConnection[]
  waitingRequests: number
  createdAt: number
  lastUsedAt: number
}

// ─── SQL Builders ────────────────────────────────────────────────────────────

/**
 * Build SQL to set the tenant context variable for row-level security.
 */
export function buildSetTenantContextSQL(tenantId: string, column: string = "tenant_id"): string {
  const sanitized = tenantId.replace(/'/g, "''")
  const safeColumn = column.replace(/"/g, '""')
  return `SET app.current_tenant = '${sanitized}'; -- context for column "${safeColumn}"`
}

/**
 * Build SQL to create a row-level security policy for a table.
 */
export function buildCreateRlsPolicySQL(table: string, column: string = "tenant_id"): string {
  const sanitizedTable = table.replace(/[^a-zA-Z0-9_]/g, "_")
  const sanitizedColumn = column.replace(/[^a-zA-Z0-9_]/g, "_")
  return `CREATE POLICY tenant_isolation_${sanitizedTable} ON "${sanitizedTable}"
  USING ("${sanitizedColumn}" = current_setting('app.current_tenant')::text)
  WITH CHECK ("${sanitizedColumn}" = current_setting('app.current_tenant')::text);`
}

/**
 * Build SQL to enable row-level security on a table.
 */
export function buildEnableRlsSQL(table: string): string {
  const sanitizedTable = table.replace(/[^a-zA-Z0-9_]/g, "_")
  return `ALTER TABLE "${sanitizedTable}" ENABLE ROW LEVEL SECURITY;`
}

// ─── Connection Router ───────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<TenantConnectionConfig> = {
  mode: "row",
  column: "tenant_id",
  maxPoolSize: 10,
  minPoolSize: 1,
  idleTimeoutMs: 30000,
  connectionString: "postgresql://localhost:5432/reactivebase",
}

export class TenantConnectionRouter {
  private config: Required<TenantConnectionConfig>
  private pools = new Map<string, TenantPool>()
  private connectionCounter = 0

  constructor(config: TenantConnectionConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Get a connection for the given tenant.
   * For row-level: returns a shared pool connection with tenant context SET.
   * For schema-per-tenant: returns a connection with search_path set.
   */
  async getConnection(tenantId: string): Promise<TenantConnection> {
    const pool = this.getOrCreatePool(tenantId)
    pool.lastUsedAt = Date.now()

    // Try to reuse an idle connection
    const idle = pool.connections.find((c) => !c.inUse)
    if (idle) {
      idle.inUse = true
      return idle
    }

    // Create a new connection if under limit
    if (pool.connections.length < this.config.maxPoolSize) {
      const conn = this.createConnection(tenantId)
      pool.connections.push(conn)
      return conn
    }

    // Pool exhausted — wait (in real implementation this would queue)
    pool.waitingRequests++
    throw new Error(`Connection pool exhausted for tenant "${tenantId}" (max: ${this.config.maxPoolSize})`)
  }

  /**
   * Get pool stats for all tenants or a specific tenant.
   */
  getPoolStats(tenantId?: string): TenantPoolStats[] {
    if (tenantId) {
      const pool = this.pools.get(tenantId)
      if (!pool) return []
      return [this.poolToStats(pool)]
    }
    return Array.from(this.pools.values()).map((p) => this.poolToStats(p))
  }

  /**
   * Close all connections for a tenant and remove the pool.
   */
  async closeTenant(tenantId: string): Promise<void> {
    const pool = this.pools.get(tenantId)
    if (!pool) return

    for (const conn of pool.connections) {
      conn.inUse = false
    }
    pool.connections.length = 0
    this.pools.delete(tenantId)
  }

  /**
   * List all tenants with active connection pools.
   */
  listActiveTenants(): string[] {
    return Array.from(this.pools.keys())
  }

  /**
   * Close all tenant pools.
   */
  async closeAll(): Promise<void> {
    for (const tenantId of this.pools.keys()) {
      await this.closeTenant(tenantId)
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private getOrCreatePool(tenantId: string): TenantPool {
    let pool = this.pools.get(tenantId)
    if (!pool) {
      pool = {
        tenantId,
        connections: [],
        waitingRequests: 0,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      }
      this.pools.set(tenantId, pool)
    }
    return pool
  }

  private createConnection(tenantId: string): TenantConnection {
    const id = `conn_${++this.connectionCounter}_${Date.now().toString(36)}`
    const contextSQL =
      this.config.mode === "row"
        ? buildSetTenantContextSQL(tenantId, this.config.column)
        : `SET search_path TO "tenant_${tenantId.replace(/[^a-zA-Z0-9_]/g, "_")}", public;`

    const pool = this.pools.get(tenantId)!

    const conn: TenantConnection = {
      tenantId,
      connectionId: id,
      mode: this.config.mode,
      contextSQL,
      inUse: true,
      createdAt: Date.now(),
      release() {
        conn.inUse = false
        if (pool.waitingRequests > 0) {
          pool.waitingRequests--
        }
      },
    }

    return conn
  }

  private poolToStats(pool: TenantPool): TenantPoolStats {
    const active = pool.connections.filter((c) => c.inUse).length
    return {
      tenantId: pool.tenantId,
      totalConnections: pool.connections.length,
      activeConnections: active,
      idleConnections: pool.connections.length - active,
      waitingRequests: pool.waitingRequests,
      createdAt: pool.createdAt,
      lastUsedAt: pool.lastUsedAt,
    }
  }
}
