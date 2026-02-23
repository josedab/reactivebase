/**
 * Declarative Access Control Language (DACL) for ReactiveBase.
 * Domain-specific language for access control that compiles to both
 * Postgres RLS policies and server-side middleware.
 *
 * Usage:
 *   const dacl = new DaclEngine()
 *   dacl.definePolicy(
 *     allow("tasks", "read").where((ctx) => ctx.user.teamId === ctx.row.teamId)
 *   )
 *   dacl.definePolicy(
 *     allow("tasks", "write").roles("admin", "editor")
 *   )
 *   const result = await dacl.check({ userId: "u1", action: "read", resource: "tasks", row: { teamId: "t1" } })
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type Action = "read" | "write" | "create" | "update" | "delete" | "*"

export interface PolicyDefinition {
  id: string
  table: string
  action: Action
  effect: "allow" | "deny"
  /** Required roles (if any — empty means all roles) */
  roles: string[]
  /** Row-level condition function */
  condition?: PolicyCondition
  /** Human-readable description */
  description?: string
  /** Priority (higher = evaluated first, default: 0) */
  priority: number
}

export type PolicyCondition = (ctx: PolicyCheckContext) => boolean | Promise<boolean>

export interface PolicyCheckContext {
  user: {
    userId: string
    roles: string[]
    teamId?: string
    orgId?: string
    attributes: Record<string, unknown>
  }
  row: Record<string, unknown>
  action: Action
  table: string
}

export interface PolicyCheckResult {
  allowed: boolean
  matchedPolicy: string | null
  reason: string
  evaluatedPolicies: number
  evaluationTimeMs: number
}

export interface PolicyTestCase {
  name: string
  context: PolicyCheckContext
  expectedResult: boolean
}

export interface PolicyTestResult {
  name: string
  passed: boolean
  expected: boolean
  actual: boolean
  matchedPolicy: string | null
  error?: string
}

export interface PolicyAuditEntry {
  timestamp: number
  userId: string
  action: Action
  table: string
  allowed: boolean
  policyId: string | null
  reason: string
}

export interface RlsPolicy {
  table: string
  name: string
  command: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL"
  usingExpression: string
  withCheckExpression?: string
}

// ─── Policy Builder (Fluent API) ─────────────────────────────────────────────

let policyIdCounter = 0

/**
 * Start building an ALLOW policy.
 */
export function allow(table: string, action: Action): PolicyBuilder {
  return new PolicyBuilder(table, action, "allow")
}

/**
 * Start building a DENY policy.
 */
export function deny(table: string, action: Action): PolicyBuilder {
  return new PolicyBuilder(table, action, "deny")
}

export class PolicyBuilder {
  private definition: PolicyDefinition

  constructor(table: string, action: Action, effect: "allow" | "deny") {
    this.definition = {
      id: `policy_${++policyIdCounter}`,
      table,
      action,
      effect,
      roles: [],
      priority: 0,
    }
  }

  /** Restrict this policy to specific roles. */
  roles(...roles: string[]): this {
    this.definition.roles = roles
    return this
  }

  /** Add a row-level condition. */
  where(condition: PolicyCondition): this {
    this.definition.condition = condition
    return this
  }

  /** Set a human-readable description. */
  describe(description: string): this {
    this.definition.description = description
    return this
  }

  /** Set policy priority (higher = evaluated first). */
  priority(p: number): this {
    this.definition.priority = p
    return this
  }

  /** Set a custom policy ID. */
  id(id: string): this {
    this.definition.id = id
    return this
  }

  /** Build the policy definition. */
  build(): PolicyDefinition {
    return { ...this.definition }
  }
}

// ─── DACL Engine ─────────────────────────────────────────────────────────────

export interface DaclEngineOptions {
  /** Default effect when no policy matches (default: "deny") */
  defaultEffect?: "allow" | "deny"
  /** Enable audit logging (default: false) */
  enableAudit?: boolean
  /** Max audit log entries (default: 10000) */
  maxAuditEntries?: number
}

const DEFAULT_OPTIONS: Required<DaclEngineOptions> = {
  defaultEffect: "deny",
  enableAudit: false,
  maxAuditEntries: 10_000,
}

/**
 * Core DACL engine that evaluates access control policies.
 * Supports deny-by-default with priority-based evaluation.
 */
export class DaclEngine {
  private policies: PolicyDefinition[] = []
  private auditLog: PolicyAuditEntry[] = []
  private options: Required<DaclEngineOptions>

  constructor(options: DaclEngineOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Define a policy using the fluent builder.
   */
  definePolicy(builder: PolicyBuilder | PolicyDefinition): void {
    const definition = builder instanceof PolicyBuilder ? builder.build() : builder

    // Check for duplicate IDs
    const existing = this.policies.findIndex((p) => p.id === definition.id)
    if (existing >= 0) {
      this.policies[existing] = definition
    } else {
      this.policies.push(definition)
    }

    // Keep sorted by priority (descending)
    this.policies.sort((a, b) => b.priority - a.priority)
  }

  /**
   * Remove a policy by ID.
   */
  removePolicy(policyId: string): boolean {
    const idx = this.policies.findIndex((p) => p.id === policyId)
    if (idx >= 0) {
      this.policies.splice(idx, 1)
      return true
    }
    return false
  }

  /**
   * Check if an action is allowed for the given context.
   * Evaluates policies in priority order. First matching DENY wins over ALLOW.
   */
  async check(context: PolicyCheckContext): Promise<PolicyCheckResult> {
    const start = Date.now()
    let evaluatedCount = 0

    // Find applicable policies for this table and action
    const applicable = this.policies.filter(
      (p) => (p.table === context.table || p.table === "*") && (p.action === context.action || p.action === "*"),
    )

    // Check DENY policies first (in priority order)
    for (const policy of applicable.filter((p) => p.effect === "deny")) {
      evaluatedCount++
      const matches = await this.evaluatePolicy(policy, context)
      if (matches) {
        const result: PolicyCheckResult = {
          allowed: false,
          matchedPolicy: policy.id,
          reason: policy.description ?? `Denied by policy ${policy.id}`,
          evaluatedPolicies: evaluatedCount,
          evaluationTimeMs: Date.now() - start,
        }
        this.audit(context, result)
        return result
      }
    }

    // Check ALLOW policies
    for (const policy of applicable.filter((p) => p.effect === "allow")) {
      evaluatedCount++
      const matches = await this.evaluatePolicy(policy, context)
      if (matches) {
        const result: PolicyCheckResult = {
          allowed: true,
          matchedPolicy: policy.id,
          reason: policy.description ?? `Allowed by policy ${policy.id}`,
          evaluatedPolicies: evaluatedCount,
          evaluationTimeMs: Date.now() - start,
        }
        this.audit(context, result)
        return result
      }
    }

    // No policy matched — use default
    const result: PolicyCheckResult = {
      allowed: this.options.defaultEffect === "allow",
      matchedPolicy: null,
      reason: `No matching policy — default ${this.options.defaultEffect}`,
      evaluatedPolicies: evaluatedCount,
      evaluationTimeMs: Date.now() - start,
    }
    this.audit(context, result)
    return result
  }

  /**
   * Check access synchronously (only works if no async conditions).
   */
  checkSync(context: PolicyCheckContext): PolicyCheckResult {
    const start = Date.now()
    let evaluatedCount = 0

    const applicable = this.policies.filter(
      (p) => (p.table === context.table || p.table === "*") && (p.action === context.action || p.action === "*"),
    )

    for (const policy of applicable.filter((p) => p.effect === "deny")) {
      evaluatedCount++
      if (this.evaluatePolicySync(policy, context)) {
        return {
          allowed: false,
          matchedPolicy: policy.id,
          reason: policy.description ?? `Denied by policy ${policy.id}`,
          evaluatedPolicies: evaluatedCount,
          evaluationTimeMs: Date.now() - start,
        }
      }
    }

    for (const policy of applicable.filter((p) => p.effect === "allow")) {
      evaluatedCount++
      if (this.evaluatePolicySync(policy, context)) {
        return {
          allowed: true,
          matchedPolicy: policy.id,
          reason: policy.description ?? `Allowed by policy ${policy.id}`,
          evaluatedPolicies: evaluatedCount,
          evaluationTimeMs: Date.now() - start,
        }
      }
    }

    return {
      allowed: this.options.defaultEffect === "allow",
      matchedPolicy: null,
      reason: `No matching policy — default ${this.options.defaultEffect}`,
      evaluatedPolicies: evaluatedCount,
      evaluationTimeMs: Date.now() - start,
    }
  }

  /**
   * Run a set of test cases against the current policies.
   */
  async runTests(testCases: PolicyTestCase[]): Promise<PolicyTestResult[]> {
    const results: PolicyTestResult[] = []
    for (const tc of testCases) {
      try {
        const result = await this.check(tc.context)
        results.push({
          name: tc.name,
          passed: result.allowed === tc.expectedResult,
          expected: tc.expectedResult,
          actual: result.allowed,
          matchedPolicy: result.matchedPolicy,
        })
      } catch (error) {
        results.push({
          name: tc.name,
          passed: false,
          expected: tc.expectedResult,
          actual: false,
          matchedPolicy: null,
          error: String(error),
        })
      }
    }
    return results
  }

  /**
   * Generate Postgres RLS SQL from current policies.
   * Note: Only policies without custom conditions can be compiled to RLS.
   */
  generateRlsPolicies(): RlsPolicy[] {
    const rlsPolicies: RlsPolicy[] = []

    for (const policy of this.policies) {
      if (policy.table === "*") continue // Can't create RLS for wildcard tables

      const command = this.actionToRlsCommand(policy.action)
      const roleCheck =
        policy.roles.length > 0
          ? `current_setting('app.user_role') IN (${policy.roles.map((r) => `'${r}'`).join(", ")})`
          : "true"

      const using = policy.effect === "allow" ? roleCheck : `NOT (${roleCheck})`

      rlsPolicies.push({
        table: policy.table,
        name: `rls_${policy.id}`,
        command,
        usingExpression: using,
      })
    }

    return rlsPolicies
  }

  /**
   * Generate SQL statements for all RLS policies.
   */
  generateRlsSQL(): string[] {
    const sqls: string[] = []
    const tables = new Set(this.policies.map((p) => p.table).filter((t) => t !== "*"))

    // Enable RLS on tables
    for (const table of tables) {
      sqls.push(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`)
    }

    // Create policies
    for (const rls of this.generateRlsPolicies()) {
      sqls.push(`CREATE POLICY "${rls.name}" ON "${rls.table}" FOR ${rls.command} USING (${rls.usingExpression});`)
    }

    return sqls
  }

  /**
   * Get all defined policies.
   */
  getPolicies(): PolicyDefinition[] {
    return [...this.policies]
  }

  /**
   * Get audit log entries.
   */
  getAuditLog(limit?: number): PolicyAuditEntry[] {
    return this.auditLog.slice(0, limit ?? this.options.maxAuditEntries)
  }

  /**
   * Clear audit log.
   */
  clearAuditLog(): void {
    this.auditLog = []
  }

  /**
   * Get policy coverage report.
   */
  getCoverage(tables: string[], actions: Action[]): PolicyCoverageReport {
    const coverage: PolicyCoverageItem[] = []
    let coveredCount = 0

    for (const table of tables) {
      for (const action of actions) {
        const matching = this.policies.filter(
          (p) => (p.table === table || p.table === "*") && (p.action === action || p.action === "*"),
        )
        const isCovered = matching.length > 0
        if (isCovered) coveredCount++

        coverage.push({
          table,
          action,
          covered: isCovered,
          policyCount: matching.length,
          policyIds: matching.map((p) => p.id),
        })
      }
    }

    const total = tables.length * actions.length
    return {
      coverage,
      totalCombinations: total,
      coveredCombinations: coveredCount,
      coveragePercentage: total > 0 ? (coveredCount / total) * 100 : 0,
    }
  }

  // ─── Private ───────────────────────────────────────────────────────────

  private async evaluatePolicy(policy: PolicyDefinition, context: PolicyCheckContext): Promise<boolean> {
    // Check roles
    if (policy.roles.length > 0) {
      const hasRole = policy.roles.some((r) => context.user.roles.includes(r))
      if (!hasRole) return false
    }

    // Check condition
    if (policy.condition) {
      return await policy.condition(context)
    }

    return true
  }

  private evaluatePolicySync(policy: PolicyDefinition, context: PolicyCheckContext): boolean {
    if (policy.roles.length > 0) {
      const hasRole = policy.roles.some((r) => context.user.roles.includes(r))
      if (!hasRole) return false
    }

    if (policy.condition) {
      const result = policy.condition(context)
      if (result instanceof Promise) {
        throw new Error(`Async condition in policy ${policy.id} — use check() instead of checkSync()`)
      }
      return result
    }

    return true
  }

  private actionToRlsCommand(action: Action): RlsPolicy["command"] {
    switch (action) {
      case "read":
        return "SELECT"
      case "create":
        return "INSERT"
      case "update":
        return "UPDATE"
      case "delete":
        return "DELETE"
      case "write":
        return "ALL"
      case "*":
        return "ALL"
    }
  }

  private audit(context: PolicyCheckContext, result: PolicyCheckResult): void {
    if (!this.options.enableAudit) return

    this.auditLog.unshift({
      timestamp: Date.now(),
      userId: context.user.userId,
      action: context.action,
      table: context.table,
      allowed: result.allowed,
      policyId: result.matchedPolicy,
      reason: result.reason,
    })

    if (this.auditLog.length > this.options.maxAuditEntries) {
      this.auditLog.pop()
    }
  }
}

// ─── Supplementary Types ─────────────────────────────────────────────────────

export interface PolicyCoverageItem {
  table: string
  action: Action
  covered: boolean
  policyCount: number
  policyIds: string[]
}

export interface PolicyCoverageReport {
  coverage: PolicyCoverageItem[]
  totalCombinations: number
  coveredCombinations: number
  coveragePercentage: number
}
