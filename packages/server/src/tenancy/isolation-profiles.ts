/**
 * Multi-Tenant Isolation Profiles for ReactiveBase.
 * Pre-built isolation strategies with automatic tenant context injection.
 *
 * Strategies:
 *   - shared-schema: Row-level isolation with tenant column (simplest, shared tables)
 *   - schema-per-tenant: Postgres schema per tenant (medium isolation)
 *   - db-per-tenant: Separate database per tenant (strongest isolation)
 *
 * Usage:
 *   const profile = createIsolationProfile("shared-schema", { column: "org_id" })
 *   const middleware = profile.createMiddleware()
 */

import type { AuthContext } from "../auth/index.js"
import type { Middleware, MiddlewareContext } from "../middleware/index.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export type IsolationStrategy = "shared-schema" | "schema-per-tenant" | "db-per-tenant"

export interface IsolationProfileConfig {
  /** Claim key in auth context containing the tenant ID (default: "tenantId") */
  claimKey?: string
  /** Tables excluded from tenant filtering */
  excludeTables?: string[]
  /** Column name for shared-schema mode (default: "tenant_id") */
  column?: string
  /** Database URL template for db-per-tenant: use {{tenantId}} placeholder */
  databaseUrlTemplate?: string
  /** Max connection pool size per tenant (default: 5) */
  maxPoolSize?: number
  /** Callback when a new tenant is provisioned */
  onProvision?: (tenantId: string) => Promise<void>
  /** Whether to auto-provision on first access (default: false) */
  autoProvision?: boolean
  /** Require tenant context for all requests (default: true) */
  requireTenant?: boolean
}

export interface IsolationProfile {
  strategy: IsolationStrategy
  config: Required<IsolationProfileConfig>
  createMiddleware(): Middleware
  provisionTenant(tenantId: string): Promise<ProvisionResult>
  deprovisionTenant(tenantId: string): Promise<void>
  listTenants(): string[]
  getTenantStatus(tenantId: string): TenantStatus | null
  generateSetupSQL(): string
}

export interface ProvisionResult {
  tenantId: string
  strategy: IsolationStrategy
  provisionedAt: number
  connectionInfo?: { schema?: string; databaseUrl?: string }
}

export interface TenantStatus {
  tenantId: string
  strategy: IsolationStrategy
  provisioned: boolean
  provisionedAt: number
  connectionCount: number
  lastAccessedAt: number
}

// ─── Profile Factory ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<IsolationProfileConfig> = {
  claimKey: "tenantId",
  excludeTables: [],
  column: "tenant_id",
  databaseUrlTemplate: "",
  maxPoolSize: 5,
  onProvision: async () => {},
  autoProvision: false,
  requireTenant: true,
}

export function createIsolationProfile(
  strategy: IsolationStrategy,
  config: IsolationProfileConfig = {},
): IsolationProfile {
  const resolved = { ...DEFAULT_CONFIG, ...config }

  switch (strategy) {
    case "shared-schema":
      return new SharedSchemaProfile(resolved)
    case "schema-per-tenant":
      return new SchemaPerTenantProfile(resolved)
    case "db-per-tenant":
      return new DbPerTenantProfile(resolved)
    default:
      throw new Error(`Unknown isolation strategy: ${strategy}`)
  }
}

// ─── Shared Schema Profile ───────────────────────────────────────────────────

class SharedSchemaProfile implements IsolationProfile {
  readonly strategy = "shared-schema" as const
  private tenants = new Map<string, TenantStatus>()

  constructor(readonly config: Required<IsolationProfileConfig>) {}

  createMiddleware(): Middleware {
    return {
      name: "isolation:shared-schema",
      before: (ctx: MiddlewareContext) => {
        const tenantId = extractTenantId(ctx.auth, this.config.claimKey)

        if (!tenantId && this.config.requireTenant) {
          throw new Error("Tenant context required but not found in auth claims")
        }

        if (tenantId) this.recordAccess(tenantId)

        return {
          state: {
            _tenantId: tenantId,
            _tenantColumn: this.config.column,
            _tenantMode: "row" as const,
            _tenantExclude: this.config.excludeTables,
            _isolationStrategy: this.strategy,
          },
        }
      },
    }
  }

  async provisionTenant(tenantId: string): Promise<ProvisionResult> {
    this.tenants.set(tenantId, {
      tenantId,
      strategy: this.strategy,
      provisioned: true,
      provisionedAt: Date.now(),
      connectionCount: 0,
      lastAccessedAt: Date.now(),
    })
    await this.config.onProvision(tenantId)
    return { tenantId, strategy: this.strategy, provisionedAt: Date.now() }
  }

  async deprovisionTenant(tenantId: string): Promise<void> {
    this.tenants.delete(tenantId)
  }

  listTenants(): string[] {
    return Array.from(this.tenants.keys())
  }

  getTenantStatus(tenantId: string): TenantStatus | null {
    return this.tenants.get(tenantId) ?? null
  }

  generateSetupSQL(): string {
    return `-- Shared Schema: Add tenant column to all tables
-- Run for each table:
-- ALTER TABLE "your_table" ADD COLUMN IF NOT EXISTS "${this.config.column}" TEXT NOT NULL;
-- CREATE INDEX IF NOT EXISTS idx_your_table_tenant ON "your_table" ("${this.config.column}");
-- Enable RLS:
-- ALTER TABLE "your_table" ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY tenant_isolation ON "your_table" USING ("${this.config.column}" = current_setting('app.tenant_id'));
`
  }

  private recordAccess(tenantId: string): void {
    const status = this.tenants.get(tenantId)
    if (status) {
      status.connectionCount++
      status.lastAccessedAt = Date.now()
    }
  }
}

// ─── Schema Per Tenant Profile ───────────────────────────────────────────────

class SchemaPerTenantProfile implements IsolationProfile {
  readonly strategy = "schema-per-tenant" as const
  private tenants = new Map<string, TenantStatus>()

  constructor(readonly config: Required<IsolationProfileConfig>) {}

  createMiddleware(): Middleware {
    return {
      name: "isolation:schema-per-tenant",
      before: (ctx: MiddlewareContext) => {
        const tenantId = extractTenantId(ctx.auth, this.config.claimKey)

        if (!tenantId && this.config.requireTenant) {
          throw new Error("Tenant context required but not found in auth claims")
        }

        const stateUpdates: Record<string, unknown> = {
          _tenantId: tenantId,
          _tenantMode: "schema" as const,
          _tenantExclude: this.config.excludeTables,
          _isolationStrategy: this.strategy,
        }

        if (tenantId) {
          const schemaName = `tenant_${sanitize(tenantId)}`
          stateUpdates._tenantSchema = schemaName
          stateUpdates._searchPath = `"${schemaName}", public`
          this.recordAccess(tenantId)
        }

        return { state: stateUpdates }
      },
    }
  }

  async provisionTenant(tenantId: string): Promise<ProvisionResult> {
    const schemaName = `tenant_${sanitize(tenantId)}`
    this.tenants.set(tenantId, {
      tenantId,
      strategy: this.strategy,
      provisioned: true,
      provisionedAt: Date.now(),
      connectionCount: 0,
      lastAccessedAt: Date.now(),
    })
    await this.config.onProvision(tenantId)
    return {
      tenantId,
      strategy: this.strategy,
      provisionedAt: Date.now(),
      connectionInfo: { schema: schemaName },
    }
  }

  async deprovisionTenant(tenantId: string): Promise<void> {
    this.tenants.delete(tenantId)
  }

  listTenants(): string[] {
    return Array.from(this.tenants.keys())
  }

  getTenantStatus(tenantId: string): TenantStatus | null {
    return this.tenants.get(tenantId) ?? null
  }

  generateSetupSQL(): string {
    return `-- Schema Per Tenant: Create schema for each tenant
-- For each tenant:
--   CREATE SCHEMA IF NOT EXISTS "tenant_{tenantId}";
--   Clone tables from public schema into tenant schema
-- See generateTenantSchemaSQL() for full implementation
`
  }

  private recordAccess(tenantId: string): void {
    const status = this.tenants.get(tenantId)
    if (status) {
      status.connectionCount++
      status.lastAccessedAt = Date.now()
    }
  }
}

// ─── DB Per Tenant Profile ───────────────────────────────────────────────────

class DbPerTenantProfile implements IsolationProfile {
  readonly strategy = "db-per-tenant" as const
  private tenants = new Map<string, TenantStatus>()
  private connectionUrls = new Map<string, string>()

  constructor(readonly config: Required<IsolationProfileConfig>) {
    if (!config.databaseUrlTemplate) {
      // Allow default template
      this.config = { ...config, databaseUrlTemplate: config.databaseUrlTemplate || "" }
    }
  }

  createMiddleware(): Middleware {
    return {
      name: "isolation:db-per-tenant",
      before: (ctx: MiddlewareContext) => {
        const tenantId = extractTenantId(ctx.auth, this.config.claimKey)

        if (!tenantId && this.config.requireTenant) {
          throw new Error("Tenant context required but not found in auth claims")
        }

        const stateUpdates: Record<string, unknown> = {
          _tenantId: tenantId,
          _tenantMode: "database" as const,
          _isolationStrategy: this.strategy,
        }

        if (tenantId) {
          const dbUrl = this.getTenantDatabaseUrl(tenantId)
          stateUpdates._tenantDatabaseUrl = dbUrl
          this.recordAccess(tenantId)
        }

        return { state: stateUpdates }
      },
    }
  }

  async provisionTenant(tenantId: string): Promise<ProvisionResult> {
    const dbUrl = this.getTenantDatabaseUrl(tenantId)
    this.connectionUrls.set(tenantId, dbUrl)
    this.tenants.set(tenantId, {
      tenantId,
      strategy: this.strategy,
      provisioned: true,
      provisionedAt: Date.now(),
      connectionCount: 0,
      lastAccessedAt: Date.now(),
    })
    await this.config.onProvision(tenantId)
    return {
      tenantId,
      strategy: this.strategy,
      provisionedAt: Date.now(),
      connectionInfo: { databaseUrl: dbUrl },
    }
  }

  async deprovisionTenant(tenantId: string): Promise<void> {
    this.tenants.delete(tenantId)
    this.connectionUrls.delete(tenantId)
  }

  listTenants(): string[] {
    return Array.from(this.tenants.keys())
  }

  getTenantStatus(tenantId: string): TenantStatus | null {
    return this.tenants.get(tenantId) ?? null
  }

  generateSetupSQL(): string {
    return `-- DB Per Tenant: Create separate database for each tenant
-- For each tenant:
--   CREATE DATABASE "reactivebase_tenant_{tenantId}";
-- Then run migrations on each tenant database
-- Template URL: ${this.config.databaseUrlTemplate || "(not configured)"}
`
  }

  /**
   * Get the database URL for a specific tenant.
   */
  getTenantDatabaseUrl(tenantId: string): string {
    const cached = this.connectionUrls.get(tenantId)
    if (cached) return cached

    if (this.config.databaseUrlTemplate) {
      return this.config.databaseUrlTemplate.replace(/\{\{tenantId\}\}/g, sanitize(tenantId))
    }

    return `postgresql://localhost:5432/reactivebase_tenant_${sanitize(tenantId)}`
  }

  private recordAccess(tenantId: string): void {
    const status = this.tenants.get(tenantId)
    if (status) {
      status.connectionCount++
      status.lastAccessedAt = Date.now()
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractTenantId(auth: AuthContext, claimKey: string): string | null {
  return (auth.claims[claimKey] as string) ?? null
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_")
}
