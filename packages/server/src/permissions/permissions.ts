/**
 * Granular permissions system for ReactiveBase.
 * Provides declarative access control at the function level.
 *
 * Usage:
 *   query(handler, { access: "authenticated" })
 *   mutation(handler, { access: roles("admin", "editor") })
 *   query(handler, { access: allow((ctx) => ctx.auth.hasClaim("org")) })
 */

import type { AuthContext } from "../auth/index.js"
import { AuthenticationError, AuthorizationError } from "../auth/index.js"

export type AccessRule = "public" | "authenticated" | RoleRule | CustomRule

export interface RoleRule {
  _type: "roles"
  roles: string[]
}

export interface CustomRule {
  _type: "custom"
  check: (auth: AuthContext) => boolean | Promise<boolean>
  label?: string
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
}

function isRoleRule(rule: AccessRule): rule is RoleRule {
  return typeof rule === "object" && "_type" in rule && rule._type === "roles"
}

function isCustomRule(rule: AccessRule): rule is CustomRule {
  return typeof rule === "object" && "_type" in rule && rule._type === "custom"
}
