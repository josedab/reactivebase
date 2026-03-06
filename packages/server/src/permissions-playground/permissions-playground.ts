/**
 * Reactive Permissions Playground for ReactiveBase.
 * Interactive tool for designing, testing, and debugging DACL/Zanzibar
 * access control policies with visual exploration.
 *
 * Features:
 *   - Permission graph model (users, roles, resources, relationships)
 *   - "What can user X access?" query explorer
 *   - Policy diff viewer between configurations
 *   - Dry-run simulator showing which rows a user would see
 *   - Batch permission testing with coverage reporting
 *   - Visual graph data export (for D3.js rendering)
 *
 * Usage:
 *   const playground = new PermissionsPlayground()
 *   playground.addUser({ id: 'u1', roles: ['editor'], attributes: { teamId: 't1' } })
 *   playground.addResource('tasks', [{ id: '1', teamId: 't1' }, { id: '2', teamId: 't2' }])
 *   playground.addPolicy({ table: 'tasks', action: 'read', effect: 'allow', roles: ['editor'] })
 *   const result = playground.explore('u1', 'tasks', 'read')
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlaygroundUser {
  id: string
  roles: string[]
  teamId?: string
  orgId?: string
  attributes: Record<string, unknown>
}

export interface PlaygroundResource {
  table: string
  rows: PlaygroundRow[]
}

export interface PlaygroundRow {
  id: string
  [key: string]: unknown
}

export interface PlaygroundPolicy {
  id: string
  table: string
  action: PlaygroundAction
  effect: "allow" | "deny"
  roles: string[]
  condition?: (ctx: PlaygroundCheckContext) => boolean
  description?: string
  priority: number
}

export type PlaygroundAction = "read" | "write" | "create" | "update" | "delete" | "*"

export interface PlaygroundCheckContext {
  user: PlaygroundUser
  row: Record<string, unknown>
  action: PlaygroundAction
  table: string
}

export interface AccessExplorerResult {
  userId: string
  table: string
  action: PlaygroundAction
  accessibleRows: PlaygroundRow[]
  deniedRows: PlaygroundRow[]
  totalRows: number
  accessPercentage: number
  evaluationDetails: RowEvaluation[]
}

export interface RowEvaluation {
  rowId: string
  allowed: boolean
  matchedPolicyId: string | null
  matchedPolicyEffect: "allow" | "deny" | null
  evaluatedPolicies: string[]
  reason: string
}

export interface PolicyDiff {
  added: PlaygroundPolicy[]
  removed: PlaygroundPolicy[]
  modified: Array<{
    policyId: string
    before: PlaygroundPolicy
    after: PlaygroundPolicy
    changes: string[]
  }>
  accessImpact: AccessImpact[]
}

export interface AccessImpact {
  userId: string
  table: string
  action: PlaygroundAction
  beforeCount: number
  afterCount: number
  gained: string[]
  lost: string[]
}

export interface PermissionGraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface GraphNode {
  id: string
  type: "user" | "role" | "resource" | "table" | "policy"
  label: string
  metadata?: Record<string, unknown>
}

export interface GraphEdge {
  source: string
  target: string
  type: "has_role" | "accesses" | "applies_to" | "contains" | "denied"
  label: string
  metadata?: Record<string, unknown>
}

export interface BatchTestResult {
  total: number
  passed: number
  failed: number
  coverage: PolicyCoverage
  results: SingleTestResult[]
}

export interface SingleTestResult {
  userId: string
  table: string
  action: PlaygroundAction
  rowId: string
  expected: boolean
  actual: boolean
  passed: boolean
  matchedPolicy: string | null
}

export interface PolicyCoverage {
  totalPolicies: number
  exercisedPolicies: number
  coveragePercentage: number
  uncoveredPolicies: string[]
}

export interface DryRunResult {
  userId: string
  tables: Record<string, DryRunTableResult>
  summary: string
}

export interface DryRunTableResult {
  action: PlaygroundAction
  totalRows: number
  visibleRows: number
  rows: Array<{ id: string; visible: boolean; reason: string }>
}

// ─── Implementation ──────────────────────────────────────────────────────────

export class PermissionsPlayground {
  private users = new Map<string, PlaygroundUser>()
  private resources = new Map<string, PlaygroundResource>()
  private policies: PlaygroundPolicy[] = []
  private policyCounter = 0

  /**
   * Add a user to the playground.
   */
  addUser(user: PlaygroundUser): void {
    this.users.set(user.id, user)
  }

  /**
   * Remove a user.
   */
  removeUser(userId: string): void {
    this.users.delete(userId)
  }

  /**
   * Add resource rows to a table.
   */
  addResource(table: string, rows: PlaygroundRow[]): void {
    const existing = this.resources.get(table)
    if (existing) {
      existing.rows.push(...rows)
    } else {
      this.resources.set(table, { table, rows: [...rows] })
    }
  }

  /**
   * Add a policy to the playground.
   */
  addPolicy(policy: Omit<PlaygroundPolicy, "id"> & { id?: string }): PlaygroundPolicy {
    const fullPolicy: PlaygroundPolicy = {
      ...policy,
      id: policy.id ?? `policy-${++this.policyCounter}`,
      priority: policy.priority ?? 0,
    }
    this.policies.push(fullPolicy)
    this.policies.sort((a, b) => b.priority - a.priority)
    return fullPolicy
  }

  /**
   * Remove a policy.
   */
  removePolicy(policyId: string): boolean {
    const idx = this.policies.findIndex((p) => p.id === policyId)
    if (idx === -1) return false
    this.policies.splice(idx, 1)
    return true
  }

  /**
   * Explore what a user can access on a table for a given action.
   */
  explore(userId: string, table: string, action: PlaygroundAction): AccessExplorerResult {
    const user = this.users.get(userId)
    if (!user) throw new PermissionsPlaygroundError(`User "${userId}" not found`)

    const resource = this.resources.get(table)
    if (!resource) throw new PermissionsPlaygroundError(`Table "${table}" not found`)

    const accessibleRows: PlaygroundRow[] = []
    const deniedRows: PlaygroundRow[] = []
    const evaluationDetails: RowEvaluation[] = []

    for (const row of resource.rows) {
      const evaluation = this.evaluateRow(user, table, action, row)
      evaluationDetails.push(evaluation)

      if (evaluation.allowed) {
        accessibleRows.push(row)
      } else {
        deniedRows.push(row)
      }
    }

    return {
      userId,
      table,
      action,
      accessibleRows,
      deniedRows,
      totalRows: resource.rows.length,
      accessPercentage: resource.rows.length > 0 ? (accessibleRows.length / resource.rows.length) * 100 : 0,
      evaluationDetails,
    }
  }

  /**
   * Dry-run: show exactly what a user would see across all tables.
   */
  dryRun(userId: string, action: PlaygroundAction = "read"): DryRunResult {
    const user = this.users.get(userId)
    if (!user) throw new PermissionsPlaygroundError(`User "${userId}" not found`)

    const tables: Record<string, DryRunTableResult> = {}
    let totalVisible = 0
    let totalRows = 0

    for (const [tableName, resource] of this.resources) {
      const rows: DryRunTableResult["rows"] = []

      for (const row of resource.rows) {
        const evaluation = this.evaluateRow(user, tableName, action, row)
        rows.push({ id: row.id, visible: evaluation.allowed, reason: evaluation.reason })
        if (evaluation.allowed) totalVisible++
        totalRows++
      }

      tables[tableName] = {
        action,
        totalRows: resource.rows.length,
        visibleRows: rows.filter((r) => r.visible).length,
        rows,
      }
    }

    return {
      userId,
      tables,
      summary: `User "${userId}" can ${action} ${totalVisible}/${totalRows} rows across ${Object.keys(tables).length} tables`,
    }
  }

  /**
   * Compare two policy configurations and show the access impact.
   */
  diffPolicies(beforePolicies: PlaygroundPolicy[], afterPolicies: PlaygroundPolicy[]): PolicyDiff {
    const beforeIds = new Set(beforePolicies.map((p) => p.id))
    const afterIds = new Set(afterPolicies.map((p) => p.id))

    const added = afterPolicies.filter((p) => !beforeIds.has(p.id))
    const removed = beforePolicies.filter((p) => !afterIds.has(p.id))
    const modified: PolicyDiff["modified"] = []

    for (const after of afterPolicies) {
      const before = beforePolicies.find((p) => p.id === after.id)
      if (before) {
        const changes: string[] = []
        if (before.effect !== after.effect) changes.push(`effect: ${before.effect} → ${after.effect}`)
        if (before.action !== after.action) changes.push(`action: ${before.action} → ${after.action}`)
        if (JSON.stringify(before.roles) !== JSON.stringify(after.roles)) changes.push(`roles changed`)
        if (changes.length > 0) {
          modified.push({ policyId: after.id, before, after, changes })
        }
      }
    }

    // Calculate access impact by evaluating before/after
    const accessImpact: AccessImpact[] = []
    const originalPolicies = [...this.policies]

    for (const [userId, user] of this.users) {
      for (const [table, resource] of this.resources) {
        for (const act of ["read", "write", "create", "update", "delete"] as PlaygroundAction[]) {
          this.policies = [...beforePolicies]
          const beforeAccess = resource.rows.filter((row) => this.evaluateRow(user, table, act, row).allowed)

          this.policies = [...afterPolicies]
          const afterAccess = resource.rows.filter((row) => this.evaluateRow(user, table, act, row).allowed)

          if (beforeAccess.length !== afterAccess.length) {
            const bIds = new Set(beforeAccess.map((r) => r.id))
            const aIds = new Set(afterAccess.map((r) => r.id))

            accessImpact.push({
              userId,
              table,
              action: act,
              beforeCount: beforeAccess.length,
              afterCount: afterAccess.length,
              gained: [...aIds].filter((id) => !bIds.has(id)),
              lost: [...bIds].filter((id) => !aIds.has(id)),
            })
          }
        }
      }
    }

    this.policies = originalPolicies
    return { added, removed, modified, accessImpact }
  }

  /**
   * Run batch permission tests.
   */
  runTests(
    tests: Array<{ userId: string; table: string; action: PlaygroundAction; rowId: string; expected: boolean }>,
  ): BatchTestResult {
    const results: SingleTestResult[] = []
    const exercisedPolicies = new Set<string>()

    for (const test of tests) {
      const user = this.users.get(test.userId)
      const resource = this.resources.get(test.table)

      if (!user || !resource) {
        results.push({ ...test, actual: false, passed: !test.expected, matchedPolicy: null })
        continue
      }

      const row = resource.rows.find((r) => r.id === test.rowId)
      if (!row) {
        results.push({ ...test, actual: false, passed: !test.expected, matchedPolicy: null })
        continue
      }

      const evaluation = this.evaluateRow(user, test.table, test.action, row)
      if (evaluation.matchedPolicyId) exercisedPolicies.add(evaluation.matchedPolicyId)

      results.push({
        ...test,
        actual: evaluation.allowed,
        passed: evaluation.allowed === test.expected,
        matchedPolicy: evaluation.matchedPolicyId,
      })
    }

    return {
      total: tests.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      coverage: {
        totalPolicies: this.policies.length,
        exercisedPolicies: exercisedPolicies.size,
        coveragePercentage: this.policies.length > 0 ? (exercisedPolicies.size / this.policies.length) * 100 : 100,
        uncoveredPolicies: this.policies.filter((p) => !exercisedPolicies.has(p.id)).map((p) => p.id),
      },
      results,
    }
  }

  /**
   * Generate graph data for D3.js visualization.
   */
  generateGraphData(): PermissionGraphData {
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    const addedNodes = new Set<string>()

    const addNode = (node: GraphNode) => {
      if (!addedNodes.has(node.id)) {
        nodes.push(node)
        addedNodes.add(node.id)
      }
    }

    for (const [, user] of this.users) {
      addNode({ id: `user:${user.id}`, type: "user", label: user.id, metadata: { roles: user.roles } })
      for (const role of user.roles) {
        addNode({ id: `role:${role}`, type: "role", label: role })
        edges.push({ source: `user:${user.id}`, target: `role:${role}`, type: "has_role", label: "has role" })
      }
    }

    for (const [tableName, resource] of this.resources) {
      addNode({
        id: `table:${tableName}`,
        type: "table",
        label: tableName,
        metadata: { rowCount: resource.rows.length },
      })
    }

    for (const policy of this.policies) {
      addNode({
        id: `policy:${policy.id}`,
        type: "policy",
        label: `${policy.effect} ${policy.action} on ${policy.table}`,
        metadata: { effect: policy.effect, action: policy.action },
      })
      edges.push({
        source: `policy:${policy.id}`,
        target: `table:${policy.table}`,
        type: "applies_to",
        label: `${policy.effect}s ${policy.action}`,
      })
      for (const role of policy.roles) {
        addNode({ id: `role:${role}`, type: "role", label: role })
        edges.push({
          source: `role:${role}`,
          target: `policy:${policy.id}`,
          type: policy.effect === "allow" ? "accesses" : "denied",
          label: policy.effect,
        })
      }
    }

    return { nodes, edges }
  }

  /**
   * Get current playground state summary.
   */
  getSummary(): { users: number; tables: number; totalRows: number; policies: number } {
    let totalRows = 0
    for (const r of this.resources.values()) totalRows += r.rows.length
    return { users: this.users.size, tables: this.resources.size, totalRows, policies: this.policies.length }
  }

  /**
   * Reset playground state.
   */
  reset(): void {
    this.users.clear()
    this.resources.clear()
    this.policies = []
    this.policyCounter = 0
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private evaluateRow(
    user: PlaygroundUser,
    table: string,
    action: PlaygroundAction,
    row: PlaygroundRow,
  ): RowEvaluation {
    const applicablePolicies = this.policies.filter(
      (p) => (p.table === table || p.table === "*") && (p.action === action || p.action === "*"),
    )

    const evaluatedPolicies: string[] = []

    for (const policy of applicablePolicies) {
      evaluatedPolicies.push(policy.id)

      if (policy.roles.length > 0 && !policy.roles.some((r) => user.roles.includes(r))) continue

      if (policy.condition) {
        const ctx: PlaygroundCheckContext = { user, row, action, table }
        try {
          if (!policy.condition(ctx)) continue
        } catch {
          continue
        }
      }

      return {
        rowId: row.id,
        allowed: policy.effect === "allow",
        matchedPolicyId: policy.id,
        matchedPolicyEffect: policy.effect,
        evaluatedPolicies,
        reason: `Matched policy "${policy.id}" (${policy.effect} ${policy.action} on ${policy.table})`,
      }
    }

    return {
      rowId: row.id,
      allowed: false,
      matchedPolicyId: null,
      matchedPolicyEffect: null,
      evaluatedPolicies,
      reason: "No matching policy found — default deny",
    }
  }
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class PermissionsPlaygroundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PermissionsPlaygroundError"
  }
}
