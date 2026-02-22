/**
 * Declarative Authorization Language for ReactiveBase.
 * Inspired by Google Zanzibar / Oso / AuthZed.
 *
 * Define permissions as relations between entities:
 *   definePermissions({
 *     document: {
 *       relations: { owner: "user", editor: "user", viewer: "user", org: "organization" },
 *       permissions: {
 *         view: ["owner", "editor", "viewer", or("org.member")],
 *         edit: ["owner", "editor"],
 *         delete: ["owner"],
 *       },
 *     },
 *   })
 *
 * Evaluate:
 *   await ctx.auth.can("edit", "document", docId)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PermissionSchema {
  [resourceType: string]: ResourceDefinition
}

export interface ResourceDefinition {
  relations: Record<string, string | string[]>
  permissions: Record<string, PermissionRule[]>
}

export type PermissionRule =
  | string                // Direct relation: "owner"
  | DerivedPermission     // Derived: { from: "org", permission: "admin" }
  | ComputedPermission    // Custom check function

export interface DerivedPermission {
  _type: "derived"
  /** Relation to follow */
  from: string
  /** Permission to check on the target resource */
  permission: string
}

export interface ComputedPermission {
  _type: "computed"
  /** Custom check function */
  check: (ctx: AuthzCheckContext) => boolean | Promise<boolean>
  label?: string
}

export interface AuthzCheckContext {
  userId: string
  resourceType: string
  resourceId: string
  claims: Record<string, unknown>
}

export interface AuthzRelationTuple {
  resourceType: string
  resourceId: string
  relation: string
  subjectType: string
  subjectId: string
}

export interface AuthzEvaluationResult {
  allowed: boolean
  /** Chain of rules evaluated */
  trace: string[]
  /** Time taken in ms */
  durationMs: number
}

export interface AuthzEngineOptions {
  /** Cache TTL in ms (default: 30000) */
  cacheTtl?: number
  /** Max cache entries (default: 10000) */
  maxCacheSize?: number
}

// ─── DSL Helpers ─────────────────────────────────────────────────────────────

/**
 * Create a derived permission rule that follows a relation.
 * Example: or("org.admin") → check if the user is an admin of the org relation
 */
export function derived(path: string): DerivedPermission {
  const parts = path.split(".")
  if (parts.length !== 2) {
    throw new AuthzError(`Invalid derived permission path: "${path}". Expected "relation.permission"`)
  }
  return { _type: "derived", from: parts[0], permission: parts[1] }
}

/**
 * Create a computed permission with a custom check function.
 */
export function computed(
  check: (ctx: AuthzCheckContext) => boolean | Promise<boolean>,
  label?: string,
): ComputedPermission {
  return { _type: "computed", check, label }
}

// ─── Persistence SQL ─────────────────────────────────────────────────────────

export function generateAuthzTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_authz_tuples (
  id SERIAL PRIMARY KEY,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(resource_type, resource_id, relation, subject_type, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_authz_resource
  ON _reactivebase_authz_tuples(resource_type, resource_id);

CREATE INDEX IF NOT EXISTS idx_authz_subject
  ON _reactivebase_authz_tuples(subject_type, subject_id);

CREATE INDEX IF NOT EXISTS idx_authz_lookup
  ON _reactivebase_authz_tuples(resource_type, resource_id, relation);
`.trim()
}

export function buildAddRelationSQL(tuple: AuthzRelationTuple): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_authz_tuples (resource_type, resource_id, relation, subject_type, subject_id)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (resource_type, resource_id, relation, subject_type, subject_id) DO NOTHING`,
    params: [tuple.resourceType, tuple.resourceId, tuple.relation, tuple.subjectType, tuple.subjectId],
  }
}

export function buildRemoveRelationSQL(tuple: AuthzRelationTuple): { sql: string; params: unknown[] } {
  return {
    sql: `DELETE FROM _reactivebase_authz_tuples
WHERE resource_type = $1 AND resource_id = $2 AND relation = $3 AND subject_type = $4 AND subject_id = $5`,
    params: [tuple.resourceType, tuple.resourceId, tuple.relation, tuple.subjectType, tuple.subjectId],
  }
}

export function buildCheckRelationSQL(
  resourceType: string,
  resourceId: string,
  relation: string,
  subjectId: string,
): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT 1 FROM _reactivebase_authz_tuples
WHERE resource_type = $1 AND resource_id = $2 AND relation = $3 AND subject_id = $4
LIMIT 1`,
    params: [resourceType, resourceId, relation, subjectId],
  }
}

export function buildListRelationsSQL(
  resourceType: string,
  resourceId: string,
): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT relation, subject_type, subject_id FROM _reactivebase_authz_tuples
WHERE resource_type = $1 AND resource_id = $2
ORDER BY relation, subject_id`,
    params: [resourceType, resourceId],
  }
}

export function buildListUserPermissionsSQL(
  subjectId: string,
  resourceType?: string,
): { sql: string; params: unknown[] } {
  if (resourceType) {
    return {
      sql: `SELECT resource_type, resource_id, relation FROM _reactivebase_authz_tuples
WHERE subject_id = $1 AND resource_type = $2
ORDER BY resource_id`,
      params: [subjectId, resourceType],
    }
  }
  return {
    sql: `SELECT resource_type, resource_id, relation FROM _reactivebase_authz_tuples
WHERE subject_id = $1
ORDER BY resource_type, resource_id`,
    params: [subjectId],
  }
}

/**
 * Generate a SQL WHERE clause from a permission check for use in RLS policies.
 */
export function permissionToWhereClause(
  resourceType: string,
  relation: string,
  userIdParam: string = "$1",
): string {
  return `EXISTS (
  SELECT 1 FROM _reactivebase_authz_tuples
  WHERE resource_type = '${resourceType}'
    AND resource_id = id::text
    AND relation = '${relation}'
    AND subject_id = ${userIdParam}
)`
}

// ─── Define Permissions ──────────────────────────────────────────────────────

export interface PermissionConfig {
  schema: PermissionSchema
}

/**
 * Define the permission schema for the application.
 */
export function definePermissions(schema: PermissionSchema): PermissionConfig {
  // Validate schema
  for (const [resourceType, def] of Object.entries(schema)) {
    for (const [permName, rules] of Object.entries(def.permissions)) {
      for (const rule of rules) {
        if (typeof rule === "string") {
          if (!def.relations[rule]) {
            throw new AuthzError(
              `Permission "${permName}" on "${resourceType}" references unknown relation "${rule}"`,
            )
          }
        }
      }
    }
  }

  return { schema }
}

// ─── AuthzEngine ─────────────────────────────────────────────────────────────

const DEFAULT_ENGINE_OPTIONS: Required<AuthzEngineOptions> = {
  cacheTtl: 30_000,
  maxCacheSize: 10_000,
}

export class AuthzEngine {
  private schema: PermissionSchema
  private options: Required<AuthzEngineOptions>
  private relations = new Map<string, Set<string>>()
  private cache = new Map<string, { result: boolean; expiresAt: number }>()

  constructor(config: PermissionConfig, options: AuthzEngineOptions = {}) {
    this.schema = config.schema
    this.options = { ...DEFAULT_ENGINE_OPTIONS, ...options }
  }

  /**
   * Add a relation tuple (e.g., user "u1" is "editor" of document "d1").
   */
  addRelation(tuple: AuthzRelationTuple): void {
    const key = this.tupleKey(tuple)
    const lookupKey = `${tuple.resourceType}:${tuple.resourceId}:${tuple.relation}`

    let subjects = this.relations.get(lookupKey)
    if (!subjects) {
      subjects = new Set()
      this.relations.set(lookupKey, subjects)
    }
    subjects.add(`${tuple.subjectType}:${tuple.subjectId}`)

    this.invalidateCache()
  }

  /**
   * Remove a relation tuple.
   */
  removeRelation(tuple: AuthzRelationTuple): void {
    const lookupKey = `${tuple.resourceType}:${tuple.resourceId}:${tuple.relation}`
    const subjects = this.relations.get(lookupKey)
    if (subjects) {
      subjects.delete(`${tuple.subjectType}:${tuple.subjectId}`)
      if (subjects.size === 0) this.relations.delete(lookupKey)
    }
    this.invalidateCache()
  }

  /**
   * Check if a user has a specific relation to a resource.
   */
  hasRelation(
    resourceType: string,
    resourceId: string,
    relation: string,
    subjectId: string,
  ): boolean {
    const lookupKey = `${resourceType}:${resourceId}:${relation}`
    const subjects = this.relations.get(lookupKey)
    if (!subjects) return false

    // Check for user:subjectId or any subject type
    for (const s of subjects) {
      if (s.endsWith(`:${subjectId}`)) return true
    }
    return false
  }

  /**
   * Check if a user has a specific permission on a resource.
   */
  async check(
    permission: string,
    resourceType: string,
    resourceId: string,
    userId: string,
    claims: Record<string, unknown> = {},
  ): Promise<AuthzEvaluationResult> {
    const startTime = Date.now()
    const trace: string[] = []

    // Check cache
    const cacheKey = `${permission}:${resourceType}:${resourceId}:${userId}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return { allowed: cached.result, trace: ["cache-hit"], durationMs: Date.now() - startTime }
    }

    const resourceDef = this.schema[resourceType]
    if (!resourceDef) {
      trace.push(`unknown resource type: ${resourceType}`)
      return { allowed: false, trace, durationMs: Date.now() - startTime }
    }

    const rules = resourceDef.permissions[permission]
    if (!rules) {
      trace.push(`unknown permission: ${permission}`)
      return { allowed: false, trace, durationMs: Date.now() - startTime }
    }

    const ctx: AuthzCheckContext = { userId, resourceType, resourceId, claims }

    for (const rule of rules) {
      if (typeof rule === "string") {
        // Direct relation check
        trace.push(`check relation: ${rule}`)
        if (this.hasRelation(resourceType, resourceId, rule, userId)) {
          this.cacheResult(cacheKey, true)
          return { allowed: true, trace, durationMs: Date.now() - startTime }
        }
      } else if (isDerivedPermission(rule)) {
        // Follow a relation and check permission on target
        trace.push(`derived: ${rule.from}.${rule.permission}`)
        const targetIds = this.getRelationTargets(resourceType, resourceId, rule.from)
        for (const targetId of targetIds) {
          const targetType = resourceDef.relations[rule.from]
          const targetResourceType = Array.isArray(targetType) ? targetType[0] : targetType
          const subResult = await this.check(rule.permission, targetResourceType, targetId, userId, claims)
          if (subResult.allowed) {
            trace.push(...subResult.trace.map((t) => `  → ${t}`))
            this.cacheResult(cacheKey, true)
            return { allowed: true, trace, durationMs: Date.now() - startTime }
          }
        }
      } else if (isComputedPermission(rule)) {
        trace.push(`computed: ${rule.label ?? "custom"}`)
        const result = await rule.check(ctx)
        if (result) {
          this.cacheResult(cacheKey, true)
          return { allowed: true, trace, durationMs: Date.now() - startTime }
        }
      }
    }

    this.cacheResult(cacheKey, false)
    return { allowed: false, trace, durationMs: Date.now() - startTime }
  }

  /**
   * List all relations for a resource.
   */
  listRelations(resourceType: string, resourceId: string): AuthzRelationTuple[] {
    const tuples: AuthzRelationTuple[] = []
    const prefix = `${resourceType}:${resourceId}:`

    for (const [key, subjects] of this.relations) {
      if (key.startsWith(prefix)) {
        const relation = key.substring(prefix.length)
        for (const subject of subjects) {
          const [subjectType, subjectId] = subject.split(":")
          tuples.push({ resourceType, resourceId, relation, subjectType, subjectId })
        }
      }
    }

    return tuples
  }

  /**
   * List all resources a user has a specific relation to.
   */
  listUserResources(userId: string, resourceType: string, relation: string): string[] {
    const resourceIds: string[] = []

    for (const [key, subjects] of this.relations) {
      if (!key.startsWith(`${resourceType}:`)) continue
      const parts = key.split(":")
      if (parts[2] !== relation) continue

      for (const subject of subjects) {
        if (subject.endsWith(`:${userId}`)) {
          resourceIds.push(parts[1])
          break
        }
      }
    }

    return resourceIds
  }

  /**
   * Clear the permission evaluation cache.
   */
  clearCache(): void {
    this.cache.clear()
  }

  get relationCount(): number {
    let count = 0
    for (const subjects of this.relations.values()) {
      count += subjects.size
    }
    return count
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private getRelationTargets(
    resourceType: string,
    resourceId: string,
    relation: string,
  ): string[] {
    const lookupKey = `${resourceType}:${resourceId}:${relation}`
    const subjects = this.relations.get(lookupKey)
    if (!subjects) return []

    return [...subjects].map((s) => s.split(":")[1])
  }

  private tupleKey(tuple: AuthzRelationTuple): string {
    return `${tuple.resourceType}:${tuple.resourceId}:${tuple.relation}:${tuple.subjectType}:${tuple.subjectId}`
  }

  private cacheResult(key: string, result: boolean): void {
    if (this.cache.size >= this.options.maxCacheSize) {
      // Evict oldest entries
      const toDelete = Math.floor(this.options.maxCacheSize * 0.1)
      const keys = this.cache.keys()
      for (let i = 0; i < toDelete; i++) {
        const next = keys.next()
        if (next.done) break
        this.cache.delete(next.value)
      }
    }

    this.cache.set(key, { result, expiresAt: Date.now() + this.options.cacheTtl })
  }

  private invalidateCache(): void {
    this.cache.clear()
  }
}

// ─── Type Guards ─────────────────────────────────────────────────────────────

function isDerivedPermission(rule: PermissionRule): rule is DerivedPermission {
  return typeof rule === "object" && "_type" in rule && rule._type === "derived"
}

function isComputedPermission(rule: PermissionRule): rule is ComputedPermission {
  return typeof rule === "object" && "_type" in rule && rule._type === "computed"
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class AuthzError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AuthzError"
  }
}
