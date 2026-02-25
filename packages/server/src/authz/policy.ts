/**
 * Declarative Data Access Policies (Policy-as-Code) for ReactiveBase.
 *
 * High-level definePolicy() API that compiles to both Postgres RLS policies
 * and runtime enforcement. Policies reference auth context, tenant, roles,
 * and relationship checks.
 *
 * Usage:
 *   const policies = definePolicy({
 *     tasks: {
 *       read: { filter: (ctx) => ctx.auth.userId === ctx.row.ownerId },
 *       write: { roles: ["admin", "editor"] },
 *       fields: {
 *         salary: { roles: ["admin", "hr"] },
 *       },
 *     },
 *   })
 */

import {
  DaclEngine,
  allow,
  type PolicyCheckContext,
  type PolicyTestCase,
  type PolicyTestResult,
  type PolicyCoverageReport,
  type Action,
} from "../dacl/index.js"
import type { AuthContext } from "../auth/index.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export type PolicyFilter = (ctx: { auth: AuthContext; row: Record<string, unknown>; tenant?: string }) => boolean

export interface FieldPolicy {
  /** Roles allowed to read this field */
  roles?: string[]
  /** Custom filter for field visibility */
  filter?: PolicyFilter
}

export interface TablePolicy {
  /** Row-level read policy */
  read?: { roles?: string[]; filter?: PolicyFilter }
  /** Row-level write (insert/update/delete) policy */
  write?: { roles?: string[]; filter?: PolicyFilter }
  /** Row-level create policy (overrides write for inserts) */
  create?: { roles?: string[]; filter?: PolicyFilter }
  /** Row-level update policy (overrides write for updates) */
  update?: { roles?: string[]; filter?: PolicyFilter }
  /** Row-level delete policy (overrides write for deletes) */
  delete?: { roles?: string[]; filter?: PolicyFilter }
  /** Field-level access policies */
  fields?: Record<string, FieldPolicy>
}

export type PolicySchema = Record<string, TablePolicy>

export interface PolicyConfig {
  schema: PolicySchema
  engine: DaclEngine
  fieldPolicies: Map<string, Map<string, FieldPolicy>>
}

export interface PolicySimulationRequest {
  auth: AuthContext
  table: string
  action: Action
  row?: Record<string, unknown>
  tenant?: string
}

export interface PolicySimulationResult {
  allowed: boolean
  visibleFields: string[]
  redactedFields: string[]
  matchedPolicy: string | null
  evaluationTimeMs: number
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Define data access policies declaratively.
 * Compiles to both Postgres RLS and runtime enforcement.
 */
export function definePolicy(schema: PolicySchema): PolicyConfig {
  const engine = new DaclEngine({ defaultEffect: "deny" })
  const fieldPolicies = new Map<string, Map<string, FieldPolicy>>()

  for (const [table, tablePolicy] of Object.entries(schema)) {
    // Row-level policies
    const actions: Array<[Action, { roles?: string[]; filter?: PolicyFilter } | undefined]> = [
      ["read", tablePolicy.read],
      ["create", tablePolicy.create ?? tablePolicy.write],
      ["update", tablePolicy.update ?? tablePolicy.write],
      ["delete", tablePolicy.delete ?? tablePolicy.write],
    ]

    for (const [action, config] of actions) {
      if (!config) continue

      const builder = allow(table, action).id(`${table}_${action}`)

      if (config.roles && config.roles.length > 0) {
        builder.roles(...config.roles)
      }

      if (config.filter) {
        const filterFn = config.filter
        builder.where((ctx: PolicyCheckContext) => {
          const authCtx: AuthContext = {
            userId: ctx.user.userId,
            claims: ctx.user.attributes,
            requireUser() {
              if (!ctx.user.userId) throw new Error("Authentication required")
              return ctx.user.userId
            },
            requireRole(role: string) {
              if (!ctx.user.roles.includes(role)) throw new Error(`Required role: ${role}`)
            },
            hasClaim(key: string) {
              return key in ctx.user.attributes
            },
          }
          return filterFn({ auth: authCtx, row: ctx.row, tenant: ctx.user.orgId })
        })
      }

      builder.describe(`${table} ${action} policy`)
      engine.definePolicy(builder)
    }

    // Field-level policies
    if (tablePolicy.fields) {
      const tableFields = new Map<string, FieldPolicy>()
      for (const [field, fieldPolicy] of Object.entries(tablePolicy.fields)) {
        tableFields.set(field, fieldPolicy)
      }
      fieldPolicies.set(table, tableFields)
    }
  }

  return { schema, engine, fieldPolicies }
}

/**
 * Generate Postgres RLS SQL from policy config.
 */
export function generatePolicyRlsSQL(config: PolicyConfig): string[] {
  return config.engine.generateRlsSQL()
}

/**
 * Filter row fields based on field-level policies.
 * Redacts fields the user is not allowed to see.
 */
export function applyFieldPolicies(
  config: PolicyConfig,
  table: string,
  row: Record<string, unknown>,
  auth: AuthContext,
): { row: Record<string, unknown>; redacted: string[] } {
  const tableFields = config.fieldPolicies.get(table)
  if (!tableFields) return { row, redacted: [] }

  const filtered = { ...row }
  const redacted: string[] = []

  for (const [field, policy] of tableFields) {
    if (!(field in filtered)) continue

    let allowed = true

    if (policy.roles && policy.roles.length > 0) {
      const userRole = (auth.claims.role as string) ?? ""
      const userRoles = Array.isArray(auth.claims.roles) ? (auth.claims.roles as string[]) : [userRole]
      allowed = policy.roles.some((r) => userRoles.includes(r))
    }

    if (allowed && policy.filter) {
      allowed = policy.filter({ auth, row, tenant: auth.claims.orgId as string | undefined })
    }

    if (!allowed) {
      delete filtered[field]
      redacted.push(field)
    }
  }

  return { row: filtered, redacted }
}

/**
 * Simulate a policy check and return detailed results.
 * Used by `reactivebase policy:test` CLI for policy testing.
 */
export async function simulatePolicy(
  config: PolicyConfig,
  request: PolicySimulationRequest,
): Promise<PolicySimulationResult> {
  const startTime = Date.now()

  const checkCtx: PolicyCheckContext = {
    user: {
      userId: request.auth.userId ?? "",
      roles: extractRoles(request.auth),
      teamId: request.auth.claims.teamId as string | undefined,
      orgId: request.tenant ?? (request.auth.claims.orgId as string | undefined),
      attributes: request.auth.claims,
    },
    row: request.row ?? {},
    action: request.action,
    table: request.table,
  }

  const result = await config.engine.check(checkCtx)

  // Determine field visibility
  const allFields = Object.keys(request.row ?? {})
  const { redacted } = request.row
    ? applyFieldPolicies(config, request.table, request.row, request.auth)
    : { redacted: [] as string[] }

  return {
    allowed: result.allowed,
    visibleFields: allFields.filter((f) => !redacted.includes(f)),
    redactedFields: redacted,
    matchedPolicy: result.matchedPolicy,
    evaluationTimeMs: Date.now() - startTime,
  }
}

/**
 * Run policy test cases and return a coverage report.
 */
export async function testPolicies(
  config: PolicyConfig,
  testCases: PolicyTestCase[],
): Promise<{ results: PolicyTestResult[]; coverage: PolicyCoverageReport }> {
  const results = await config.engine.runTests(testCases)
  const tables = [...new Set(testCases.map((tc) => tc.context.table))]
  const actions: Action[] = ["read", "create", "update", "delete"]
  const coverage = config.engine.getCoverage(tables, actions)
  return { results, coverage }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractRoles(auth: AuthContext): string[] {
  const role = auth.claims.role as string | undefined
  const roles = auth.claims.roles as string[] | undefined
  if (roles && Array.isArray(roles)) return roles
  if (role) return [role]
  return []
}
