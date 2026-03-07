/**
 * Granular permissions system for ReactiveBase.
 * Provides declarative access control at the function level,
 * with optional field-level and resource-scoped restrictions.
 *
 * Usage:
 *   query(handler, { access: "authenticated" })
 *   mutation(handler, { access: roles("admin", "editor") })
 *   query(handler, { access: allow((ctx) => ctx.auth.hasClaim("org")) })
 *   query(handler, { access: fields({ exclude: ["ssn", "salary"] }) })
 *   query(handler, { access: resource("document", (ctx, id) => isOwner(ctx, id)) })
 */

import type { AuthContext } from "../auth/index.js"
import { AuthenticationError, AuthorizationError } from "../auth/index.js"

export type AccessRule = "public" | "authenticated" | RoleRule | CustomRule | FieldRule | ResourceRule | ComposedRule

export interface RoleRule {
  _type: "roles"
  roles: string[]
}

export interface CustomRule {
  _type: "custom"
  check: (auth: AuthContext) => boolean | Promise<boolean>
  label?: string
}

export interface FieldRule {
  _type: "fields"
  /** Fields to include (whitelist). If set, only these fields are returned. */
  include?: string[]
  /** Fields to exclude (blacklist). Removed from results. */
  exclude?: string[]
  /** Per-role field visibility overrides. */
  roleOverrides?: Record<string, { include?: string[]; exclude?: string[] }>
}

export interface ResourceRule {
  _type: "resource"
  /** Resource type name (e.g., "document", "project") */
  resourceType: string
  /** Check if the authenticated user can access this specific resource */
  check: (auth: AuthContext, resourceId: string) => boolean | Promise<boolean>
}

export interface ComposedRule {
  _type: "composed"
  /** Logical operator for combining rules */
  operator: "and" | "or"
  rules: AccessRule[]
}

/**
 * Require one of the specified roles.
 */
export function roles(...requiredRoles: string[]): RoleRule {
  return { _type: "roles", roles: requiredRoles }
}

/**
 * Custom access predicate.
 */
export function allow(check: (auth: AuthContext) => boolean | Promise<boolean>, label?: string): CustomRule {
  return { _type: "custom", check, label }
}

/**
 * Field-level access control. Restricts which fields are visible in query results.
 *
 * @example
 * // Hide sensitive fields from non-admin users
 * query(handler, { access: fields({ exclude: ["ssn", "salary"] }) })
 *
 * @example
 * // Different field visibility per role
 * query(handler, {
 *   access: fields({
 *     exclude: ["ssn", "salary"],
 *     roleOverrides: { admin: { exclude: [] } }
 *   })
 * })
 */
export function fields(config: Omit<FieldRule, "_type">): FieldRule {
  if (config.include && config.exclude) {
    throw new Error("Cannot specify both 'include' and 'exclude' in field permissions")
  }
  return { _type: "fields", ...config }
}

/**
 * Resource-scoped access control. Checks if the user can access a specific resource instance.
 *
 * @example
 * query(handler, {
 *   access: resource("document", (auth, docId) => auth.hasClaim(`doc:${docId}`))
 * })
 */
export function resource(
  resourceType: string,
  check: (auth: AuthContext, resourceId: string) => boolean | Promise<boolean>,
): ResourceRule {
  return { _type: "resource", resourceType, check }
}

/**
 * Compose multiple access rules with AND/OR logic.
 *
 * @example
 * // Require authentication AND admin role
 * query(handler, { access: allOf("authenticated", roles("admin")) })
 *
 * @example
 * // Allow admin OR resource owner
 * query(handler, { access: anyOf(roles("admin"), resource("doc", isOwner)) })
 */
export function allOf(...rules: AccessRule[]): ComposedRule {
  return { _type: "composed", operator: "and", rules }
}

export function anyOf(...rules: AccessRule[]): ComposedRule {
  return { _type: "composed", operator: "or", rules }
}

/**
 * Evaluate an access rule against an auth context.
 * Throws AuthenticationError or AuthorizationError on failure.
 */
export async function enforceAccess(
  rule: AccessRule | undefined,
  auth: AuthContext,
  functionName: string,
): Promise<void> {
  if (rule === undefined || rule === "public") return

  if (rule === "authenticated") {
    if (!auth.userId) {
      throw new AuthenticationError(`Function "${functionName}" requires authentication`)
    }
    return
  }

  if (isRoleRule(rule)) {
    if (!auth.userId) {
      throw new AuthenticationError(`Function "${functionName}" requires authentication`)
    }
    const userRole = auth.claims.role as string | undefined
    if (!userRole || !rule.roles.includes(userRole)) {
      throw new AuthorizationError(`Function "${functionName}" requires one of roles: [${rule.roles.join(", ")}]`)
    }
    return
  }

  if (isCustomRule(rule)) {
    if (!auth.userId) {
      throw new AuthenticationError(`Function "${functionName}" requires authentication`)
    }
    const allowed = await rule.check(auth)
    if (!allowed) {
      throw new AuthorizationError(`Access denied to "${functionName}"${rule.label ? `: ${rule.label}` : ""}`)
    }
    return
  }

  if (isFieldRule(rule)) {
    // Field rules don't block access — they filter results.
    // enforceAccess is a no-op; use applyFieldPermissions for filtering.
    return
  }

  if (isResourceRule(rule)) {
    if (!auth.userId) {
      throw new AuthenticationError(`Function "${functionName}" requires authentication`)
    }
    // Resource rules are evaluated at query time with a specific resourceId.
    // enforceAccess validates auth only; use enforceResourceAccess for resource checks.
    return
  }

  if (isComposedRule(rule)) {
    if (rule.operator === "and") {
      for (const sub of rule.rules) {
        await enforceAccess(sub, auth, functionName)
      }
      return
    }
    // "or" — succeed if any sub-rule passes
    const errors: Error[] = []
    for (const sub of rule.rules) {
      try {
        await enforceAccess(sub, auth, functionName)
        return // first passing rule is enough
      } catch (e) {
        errors.push(e as Error)
      }
    }
    throw new AuthorizationError(
      `Access denied to "${functionName}": none of the ${rule.rules.length} rules passed`,
    )
  }
}

/**
 * Evaluate a resource-scoped access rule for a specific resource instance.
 */
export async function enforceResourceAccess(
  rule: ResourceRule,
  auth: AuthContext,
  resourceId: string,
  functionName: string,
): Promise<void> {
  if (!auth.userId) {
    throw new AuthenticationError(`Function "${functionName}" requires authentication`)
  }
  const allowed = await rule.check(auth, resourceId)
  if (!allowed) {
    throw new AuthorizationError(
      `Access denied to ${rule.resourceType} "${resourceId}" in "${functionName}"`,
    )
  }
}

/**
 * Apply field-level permissions to a result row.
 * Returns a new object with restricted fields removed.
 */
export function applyFieldPermissions<T extends Record<string, unknown>>(
  row: T,
  rule: FieldRule,
  auth: AuthContext,
): Partial<T> {
  const userRole = auth.claims.role as string | undefined
  const override = userRole ? rule.roleOverrides?.[userRole] : undefined

  const effectiveInclude = override?.include ?? rule.include
  const effectiveExclude = override?.exclude ?? rule.exclude

  if (effectiveInclude) {
    const result: Record<string, unknown> = {}
    for (const key of effectiveInclude) {
      if (key in row) result[key] = row[key]
    }
    return result as Partial<T>
  }

  if (effectiveExclude && effectiveExclude.length > 0) {
    const result: Record<string, unknown> = { ...row }
    for (const key of effectiveExclude) {
      delete result[key]
    }
    return result as Partial<T>
  }

  return { ...row }
}

function isRoleRule(rule: AccessRule): rule is RoleRule {
  return typeof rule === "object" && "_type" in rule && rule._type === "roles"
}

function isCustomRule(rule: AccessRule): rule is CustomRule {
  return typeof rule === "object" && "_type" in rule && rule._type === "custom"
}

function isFieldRule(rule: AccessRule): rule is FieldRule {
  return typeof rule === "object" && "_type" in rule && rule._type === "fields"
}

function isResourceRule(rule: AccessRule): rule is ResourceRule {
  return typeof rule === "object" && "_type" in rule && rule._type === "resource"
}

function isComposedRule(rule: AccessRule): rule is ComposedRule {
  return typeof rule === "object" && "_type" in rule && rule._type === "composed"
}
