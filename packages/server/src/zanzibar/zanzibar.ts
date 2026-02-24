// --------------------------------------------------------------------------
// Declarative Authorization (Google Zanzibar-style)
// Relationship-based access control with reactive permission invalidation
// --------------------------------------------------------------------------

// ── Types ──────────────────────────────────────────────────────────────────

export interface RelationTuple {
  namespace: string
  objectId: string
  relation: string
  subjectNamespace?: string
  subjectId: string
  subjectRelation?: string
}

export interface NamespaceConfig {
  name: string
  relations: Record<string, RelationRule>
}

export interface RelationRule {
  union?: RelationRef[]
  intersection?: RelationRef[]
  exclusion?: { base: RelationRef; subtract: RelationRef }
}

export interface RelationRef {
  this?: true
  computedUserset?: { relation: string }
  tupleToUserset?: { tupleset: { relation: string }; computedUserset: { relation: string } }
}

export interface CheckRequest {
  namespace: string
  objectId: string
  relation: string
  subjectId: string
  subjectNamespace?: string
  contextualTuples?: RelationTuple[]
  trace?: boolean
}

export interface CheckResult {
  allowed: boolean
  resolution?: ResolutionStep[]
  cachedAt?: number
  evaluationTimeMs: number
}

export interface ResolutionStep {
  namespace: string
  objectId: string
  relation: string
  result: boolean
  via?: string
  children?: ResolutionStep[]
}

export interface ExpandResult {
  tree: UsersetTree
}

export interface UsersetTree {
  type: "leaf" | "union" | "intersection" | "exclusion"
  subjects?: string[]
  children?: UsersetTree[]
}

export interface ListObjectsRequest {
  namespace: string
  relation: string
  subjectId: string
  subjectNamespace?: string
  objectType?: string
  limit?: number
}

export interface ZanzibarOptions {
  namespaces: NamespaceConfig[]
  maxDepth?: number
  cacheEnabled?: boolean
  cacheTtlMs?: number
  onPermissionChange?: (tuple: RelationTuple, action: "write" | "delete") => void
}

export interface ZanzibarStats {
  checkCount: number
  cacheHits: number
  cacheMisses: number
  avgEvaluationTimeMs: number
  tupleCount: number
}

// ── Error ──────────────────────────────────────────────────────────────────

export class ZanzibarError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = "ZanzibarError"
  }
}

// ── SQL Builders ───────────────────────────────────────────────────────────

export function buildCreateZanzibarTablesSQL(): string {
  return `
    CREATE TABLE IF NOT EXISTS _rb_zanzibar_tuples (
      namespace TEXT NOT NULL,
      object_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      subject_namespace TEXT NOT NULL DEFAULT '',
      subject_id TEXT NOT NULL,
      subject_relation TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (namespace, object_id, relation, subject_namespace, subject_id, subject_relation)
    );
    CREATE INDEX IF NOT EXISTS idx_zanzibar_subject ON _rb_zanzibar_tuples (subject_namespace, subject_id);
    CREATE INDEX IF NOT EXISTS idx_zanzibar_object ON _rb_zanzibar_tuples (namespace, object_id, relation);

    CREATE TABLE IF NOT EXISTS _rb_zanzibar_changelog (
      id BIGSERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      namespace TEXT NOT NULL,
      object_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_zanzibar_changelog_ts ON _rb_zanzibar_changelog (timestamp);
  `
}

export function buildWriteTupleSQL(): string {
  return `
    INSERT INTO _rb_zanzibar_tuples (namespace, object_id, relation, subject_namespace, subject_id, subject_relation)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT DO NOTHING
  `
}

export function buildDeleteTupleSQL(): string {
  return `
    DELETE FROM _rb_zanzibar_tuples
    WHERE namespace = $1 AND object_id = $2 AND relation = $3 AND subject_id = $4
  `
}

export function buildReadTuplesSQL(): string {
  return `
    SELECT namespace, object_id, relation, subject_namespace, subject_id, subject_relation
    FROM _rb_zanzibar_tuples
    WHERE namespace = $1 AND object_id = $2 AND relation = $3
  `
}

export function buildListObjectsSQL(): string {
  return `
    SELECT DISTINCT object_id
    FROM _rb_zanzibar_tuples
    WHERE namespace = $1 AND relation = $2 AND subject_id = $3
    LIMIT $4
  `
}

export function buildReverseExpandSQL(): string {
  return `
    SELECT namespace, object_id, relation, subject_namespace, subject_id, subject_relation
    FROM _rb_zanzibar_tuples
    WHERE subject_id = $1 AND ($2 = '' OR namespace = $2)
  `
}

export function buildLogChangeSQL(): string {
  return `
    INSERT INTO _rb_zanzibar_changelog (action, namespace, object_id, relation, subject_id)
    VALUES ($1, $2, $3, $4, $5)
  `
}

// ── Permission Cache ───────────────────────────────────────────────────────

interface CachedCheck {
  allowed: boolean
  cachedAt: number
}

class PermissionCache {
  private cache = new Map<string, CachedCheck>()

  constructor(private readonly ttlMs: number) {}

  get(key: string): boolean | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(key)
      return null
    }
    return entry.allowed
  }

  set(key: string, allowed: boolean): void {
    this.cache.set(key, { allowed, cachedAt: Date.now() })
  }

  invalidateByObject(namespace: string, objectId: string): number {
    let count = 0
    const prefix = `${namespace}:${objectId}:`
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key)
        count++
      }
    }
    return count
  }

  invalidateBySubject(subjectId: string): number {
    let count = 0
    for (const key of this.cache.keys()) {
      if (key.includes(`:${subjectId}`)) {
        this.cache.delete(key)
        count++
      }
    }
    return count
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

// ── Zanzibar Engine ────────────────────────────────────────────────────────

export class ZanzibarEngine {
  private readonly namespaces: Map<string, NamespaceConfig>
  private readonly tuples = new Map<string, Set<string>>()
  private readonly cache: PermissionCache | null
  private readonly maxDepth: number
  private readonly onPermissionChange?: (tuple: RelationTuple, action: "write" | "delete") => void
  private stats: ZanzibarStats = {
    checkCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    avgEvaluationTimeMs: 0,
    tupleCount: 0,
  }
  private totalEvalTime = 0

  constructor(options: ZanzibarOptions) {
    this.namespaces = new Map(options.namespaces.map((ns) => [ns.name, ns]))
    this.maxDepth = options.maxDepth ?? 25
    this.onPermissionChange = options.onPermissionChange

    this.cache = options.cacheEnabled !== false ? new PermissionCache(options.cacheTtlMs ?? 5000) : null
  }

  writeTuple(tuple: RelationTuple): void {
    this.validateTuple(tuple)
    const key = this.tupleKey(tuple.namespace, tuple.objectId, tuple.relation)
    if (!this.tuples.has(key)) {
      this.tuples.set(key, new Set())
    }
    const subjectKey = this.subjectKey(tuple)
    this.tuples.get(key)!.add(subjectKey)
    this.stats.tupleCount++

    // Invalidate cache for this object
    this.cache?.invalidateByObject(tuple.namespace, tuple.objectId)
    this.onPermissionChange?.(tuple, "write")
  }

  deleteTuple(tuple: RelationTuple): void {
    const key = this.tupleKey(tuple.namespace, tuple.objectId, tuple.relation)
    const subjects = this.tuples.get(key)
    if (subjects) {
      const subjectKey = this.subjectKey(tuple)
      subjects.delete(subjectKey)
      if (subjects.size === 0) this.tuples.delete(key)
      this.stats.tupleCount = Math.max(0, this.stats.tupleCount - 1)
    }

    this.cache?.invalidateByObject(tuple.namespace, tuple.objectId)
    this.cache?.invalidateBySubject(tuple.subjectId)
    this.onPermissionChange?.(tuple, "delete")
  }

  check(request: CheckRequest): CheckResult {
    const start = Date.now()
    this.stats.checkCount++

    // Check cache
    const cacheKey = `${request.namespace}:${request.objectId}:${request.relation}:${request.subjectId}`
    if (this.cache) {
      const cached = this.cache.get(cacheKey)
      if (cached !== null) {
        this.stats.cacheHits++
        return { allowed: cached, cachedAt: Date.now(), evaluationTimeMs: Date.now() - start }
      }
      this.stats.cacheMisses++
    }

    // Add contextual tuples temporarily
    if (request.contextualTuples) {
      for (const tuple of request.contextualTuples) {
        this.writeTupleInternal(tuple)
      }
    }

    const resolution: ResolutionStep[] = []
    const allowed = this.resolve(
      request.namespace,
      request.objectId,
      request.relation,
      request.subjectId,
      request.subjectNamespace,
      0,
      request.trace ? resolution : undefined,
    )

    // Remove contextual tuples
    if (request.contextualTuples) {
      for (const tuple of request.contextualTuples) {
        this.deleteTupleInternal(tuple)
      }
    }

    this.cache?.set(cacheKey, allowed)

    const evalTime = Date.now() - start
    this.totalEvalTime += evalTime
    this.stats.avgEvaluationTimeMs = this.totalEvalTime / this.stats.checkCount

    return {
      allowed,
      resolution: request.trace ? resolution : undefined,
      evaluationTimeMs: evalTime,
    }
  }

  expand(namespace: string, objectId: string, relation: string): ExpandResult {
    const tree = this.buildUsersetTree(namespace, objectId, relation, 0)
    return { tree }
  }

  listObjects(request: ListObjectsRequest): string[] {
    const limit = request.limit ?? 100
    const results: string[] = []

    for (const [key, subjects] of this.tuples) {
      if (results.length >= limit) break
      const [ns, objectId, relation] = key.split(":")
      if (ns !== request.namespace || relation !== request.relation) continue

      for (const subjectKey of subjects) {
        const [, subjectId] = subjectKey.split(":")
        if (subjectId === request.subjectId) {
          results.push(objectId)
          break
        }
      }
    }

    return results
  }

  getStats(): ZanzibarStats {
    return { ...this.stats }
  }

  clearCache(): void {
    this.cache?.clear()
  }

  // ── Internal Resolution ────────────────────────────────────────────────

  private resolve(
    namespace: string,
    objectId: string,
    relation: string,
    subjectId: string,
    subjectNamespace?: string,
    depth: number = 0,
    trace?: ResolutionStep[],
  ): boolean {
    if (depth > this.maxDepth) {
      throw new ZanzibarError(`Max resolution depth (${this.maxDepth}) exceeded`, "MAX_DEPTH_EXCEEDED")
    }

    // Direct check
    const key = this.tupleKey(namespace, objectId, relation)
    const subjects = this.tuples.get(key)
    if (subjects) {
      const directKey = `${subjectNamespace || ""}:${subjectId}`
      if (subjects.has(directKey)) {
        trace?.push({
          namespace,
          objectId,
          relation,
          result: true,
          via: "direct",
        })
        return true
      }

      // Wildcard check
      if (subjects.has(":*")) {
        trace?.push({ namespace, objectId, relation, result: true, via: "wildcard" })
        return true
      }
    }

    // Check namespace rules for computed usersets
    const nsConfig = this.namespaces.get(namespace)
    if (!nsConfig) return false

    const rule = nsConfig.relations[relation]
    if (!rule) return false

    if (rule.union) {
      for (const ref of rule.union) {
        if (this.resolveRef(ref, namespace, objectId, subjectId, subjectNamespace, depth, trace)) {
          return true
        }
      }
    }

    if (rule.intersection) {
      const allTrue = rule.intersection.every((ref) =>
        this.resolveRef(ref, namespace, objectId, subjectId, subjectNamespace, depth, trace),
      )
      if (allTrue && rule.intersection.length > 0) return true
    }

    if (rule.exclusion) {
      const baseResult = this.resolveRef(
        rule.exclusion.base,
        namespace,
        objectId,
        subjectId,
        subjectNamespace,
        depth,
        trace,
      )
      const subtractResult = this.resolveRef(
        rule.exclusion.subtract,
        namespace,
        objectId,
        subjectId,
        subjectNamespace,
        depth,
        trace,
      )
      if (baseResult && !subtractResult) return true
    }

    trace?.push({ namespace, objectId, relation, result: false })
    return false
  }

  private resolveRef(
    ref: RelationRef,
    namespace: string,
    objectId: string,
    subjectId: string,
    subjectNamespace: string | undefined,
    depth: number,
    trace?: ResolutionStep[],
  ): boolean {
    if (ref.this) {
      return false // Already handled as direct check
    }

    if (ref.computedUserset) {
      return this.resolve(
        namespace,
        objectId,
        ref.computedUserset.relation,
        subjectId,
        subjectNamespace,
        depth + 1,
        trace,
      )
    }

    if (ref.tupleToUserset) {
      // Find all tuples matching the tupleset relation
      const tuplesetKey = this.tupleKey(namespace, objectId, ref.tupleToUserset.tupleset.relation)
      const tuplesetSubjects = this.tuples.get(tuplesetKey)
      if (!tuplesetSubjects) return false

      for (const subjKey of tuplesetSubjects) {
        const [subjNs, subjId] = subjKey.split(":")
        if (
          this.resolve(
            subjNs || namespace,
            subjId,
            ref.tupleToUserset.computedUserset.relation,
            subjectId,
            subjectNamespace,
            depth + 1,
            trace,
          )
        ) {
          return true
        }
      }
    }

    return false
  }

  private buildUsersetTree(namespace: string, objectId: string, relation: string, depth: number): UsersetTree {
    if (depth > this.maxDepth) {
      return { type: "leaf", subjects: [] }
    }

    const key = this.tupleKey(namespace, objectId, relation)
    const subjects = this.tuples.get(key)
    const directSubjects: string[] = []
    if (subjects) {
      for (const subj of subjects) {
        const [, id] = subj.split(":")
        directSubjects.push(id)
      }
    }

    const nsConfig = this.namespaces.get(namespace)
    if (!nsConfig || !nsConfig.relations[relation]) {
      return { type: "leaf", subjects: directSubjects }
    }

    const rule = nsConfig.relations[relation]
    if (rule.union && rule.union.length > 0) {
      const children: UsersetTree[] = [{ type: "leaf", subjects: directSubjects }]
      for (const ref of rule.union) {
        if (ref.computedUserset) {
          children.push(this.buildUsersetTree(namespace, objectId, ref.computedUserset.relation, depth + 1))
        }
      }
      return { type: "union", children }
    }

    return { type: "leaf", subjects: directSubjects }
  }

  private writeTupleInternal(tuple: RelationTuple): void {
    const key = this.tupleKey(tuple.namespace, tuple.objectId, tuple.relation)
    if (!this.tuples.has(key)) this.tuples.set(key, new Set())
    this.tuples.get(key)!.add(this.subjectKey(tuple))
  }

  private deleteTupleInternal(tuple: RelationTuple): void {
    const key = this.tupleKey(tuple.namespace, tuple.objectId, tuple.relation)
    this.tuples.get(key)?.delete(this.subjectKey(tuple))
  }

  private validateTuple(tuple: RelationTuple): void {
    if (!tuple.namespace || !tuple.objectId || !tuple.relation || !tuple.subjectId) {
      throw new ZanzibarError("Invalid tuple: missing required fields", "INVALID_TUPLE")
    }
    const ns = this.namespaces.get(tuple.namespace)
    if (!ns) {
      throw new ZanzibarError(`Unknown namespace: ${tuple.namespace}`, "UNKNOWN_NAMESPACE")
    }
    if (!ns.relations[tuple.relation]) {
      throw new ZanzibarError(`Unknown relation: ${tuple.relation} in namespace ${tuple.namespace}`, "UNKNOWN_RELATION")
    }
  }

  private tupleKey(namespace: string, objectId: string, relation: string): string {
    return `${namespace}:${objectId}:${relation}`
  }

  private subjectKey(tuple: RelationTuple): string {
    return `${tuple.subjectNamespace || ""}:${tuple.subjectId}`
  }
}
