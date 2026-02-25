/**
 * Multi-tenant isolation for ReactiveBase.
 * Supports row-level (shared table with tenant column) and schema-per-tenant modes.
 */

import type { AuthContext } from "../auth/index.js"
import type { Middleware, MiddlewareContext } from "../middleware/index.js"

export interface TenancyConfig {
  /** Isolation mode */
  mode: "row" | "schema"
  /** Column name for row-level tenancy (default: "tenantId") */
  column?: string
  /** Claim key in auth context containing the tenant ID (default: "tenantId") */
  claimKey?: string
  /** Tables excluded from tenant filtering */
  excludeTables?: string[]
}

const DEFAULT_CONFIG: Required<TenancyConfig> = {
  mode: "row",
  column: "tenantId",
  claimKey: "tenantId",
  excludeTables: [],
}

/**
 * Extract tenant ID from auth context using configured claim key.
 */
export function getTenantId(auth: AuthContext, claimKey: string): string | null {
  return (auth.claims[claimKey] as string) ?? null
}

/**
 * Create a middleware that auto-injects tenant filtering.
 * For row-level: adds WHERE tenantId = ? to all queries.
 * For schema-level: sets Postgres search_path to the tenant schema.
 */
export function createTenancyMiddleware(config: TenancyConfig): Middleware {
  const opts = { ...DEFAULT_CONFIG, ...config }

  return {
    name: "tenancy",

    before(ctx: MiddlewareContext) {
      const tenantId = getTenantId(ctx.auth, opts.claimKey)

      if (!tenantId && opts.mode === "row") {
        // Store tenantId in middleware state for the database context to use
        ctx.state.set("_tenantId", null)
        ctx.state.set("_tenantColumn", opts.column)
        ctx.state.set("_tenantMode", opts.mode)
        ctx.state.set("_tenantExclude", opts.excludeTables)
        return
      }

      ctx.state.set("_tenantId", tenantId)
      ctx.state.set("_tenantColumn", opts.column)
      ctx.state.set("_tenantMode", opts.mode)
      ctx.state.set("_tenantExclude", opts.excludeTables)
    },
  }
}

/**
 * Build a tenant-filtered WHERE clause for a query.
 */
export function buildTenantFilter(tenantId: string, column: string): { sql: string; param: string } {
  return {
    sql: `"${column}" = `,
    param: tenantId,
  }
}

/**
 * Generate SQL to create a schema for a tenant.
 */
export function generateTenantSchemaSQL(tenantId: string, sourceSchema: string = "public"): string {
  const schemaName = `tenant_${sanitizeTenantId(tenantId)}`
  const safeSource = sanitizeIdentifier(sourceSchema)
  return `
CREATE SCHEMA IF NOT EXISTS "${schemaName}";

-- Clone tables from source schema
DO $$
DECLARE
  tbl RECORD;
BEGIN
  FOR tbl IN
    SELECT tablename FROM pg_tables WHERE schemaname = '${safeSource}'
      AND tablename NOT LIKE '\\_%'
  LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS "${schemaName}".%I (LIKE ${safeSource}.%I INCLUDING ALL)', tbl.tablename, tbl.tablename);
  END LOOP;
END $$;
`
}

/**
 * Generate SQL to set search_path for a tenant.
 */
export function generateSetSchemaSQL(tenantId: string): string {
  const schemaName = `tenant_${sanitizeTenantId(tenantId)}`
  return `SET search_path TO "${schemaName}", public;`
}

/**
 * Generate SQL to drop a tenant schema.
 */
export function generateDropTenantSQL(tenantId: string): string {
  const schemaName = `tenant_${sanitizeTenantId(tenantId)}`
  return `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE;`
}

function sanitizeTenantId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_")
}

function sanitizeIdentifier(id: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) {
    throw new Error(`Invalid SQL identifier: ${id}`)
  }
  return id
}

/**
 * Tenant context for use in server functions.
 */
export interface TenantContext {
  tenantId: string | null
  mode: "row" | "schema"
  column: string
}

/**
 * Extract tenant context from middleware state.
 */
export function getTenantFromState(state: Map<string, unknown>): TenantContext | null {
  const mode = state.get("_tenantMode") as string | undefined
  if (!mode) return null

  return {
    tenantId: state.get("_tenantId") as string | null,
    mode: mode as "row" | "schema",
    column: (state.get("_tenantColumn") as string) ?? "tenantId",
  }
}
