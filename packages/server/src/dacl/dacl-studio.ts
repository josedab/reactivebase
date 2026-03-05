/**
 * DACL Studio — Visual Policy Editor Dashboard for ReactiveBase.
 *
 * Provides:
 *   - Permission matrix (role × resource × action) visualization
 *   - Policy simulation with step-by-step evaluation trace
 *   - Auto-generated RLS policy viewer
 *   - Visual editor data model for drag-and-drop rule composition
 *   - Self-contained HTML dashboard for /dashboard/access-control
 *
 * Usage:
 *   const studio = new DaclStudio(daclEngine)
 *   const matrix = studio.getPermissionMatrix(roles, tables, actions)
 *   const simulation = await studio.simulate(context)
 *   const html = studio.generateDashboardHTML()
 */

import type { DaclEngine, PolicyCheckContext, PolicyCheckResult, Action } from "./dacl.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PermissionMatrixCell {
  role: string
  resource: string
  action: Action
  effect: "allow" | "deny" | "no-policy"
  policyIds: string[]
  hasCondition: boolean
}

export interface PermissionMatrix {
  roles: string[]
  resources: string[]
  actions: Action[]
  cells: PermissionMatrixCell[]
}

export interface SimulationStep {
  policyId: string
  policyEffect: "allow" | "deny"
  table: string
  action: Action
  rolesRequired: string[]
  hasCondition: boolean
  matched: boolean
  reason: string
}

export interface SimulationResult {
  context: PolicyCheckContext
  result: PolicyCheckResult
  steps: SimulationStep[]
  evaluationTimeMs: number
  resolvedAt: string
}

export interface PolicyEditorNode {
  id: string
  type: "policy" | "condition" | "role-group" | "resource"
  label: string
  data: Record<string, unknown>
  position: { x: number; y: number }
  connections: string[]
}

export interface PolicyEditorState {
  nodes: PolicyEditorNode[]
  selectedNodeId: string | null
  zoom: number
  offset: { x: number; y: number }
}

export interface RlsPolicyView {
  table: string
  policies: Array<{
    name: string
    command: string
    expression: string
    sql: string
  }>
}

// ─── DACL Studio ─────────────────────────────────────────────────────────────

export class DaclStudio {
  private engine: DaclEngine

  constructor(engine: DaclEngine) {
    this.engine = engine
  }

  /**
   * Generate a permission matrix showing role × resource × action coverage.
   */
  getPermissionMatrix(roles: string[], resources: string[], actions: Action[]): PermissionMatrix {
    const policies = this.engine.getPolicies()
    const cells: PermissionMatrixCell[] = []

    for (const role of roles) {
      for (const resource of resources) {
        for (const action of actions) {
          const matching = policies.filter(
            (p) =>
              (p.table === resource || p.table === "*") &&
              (p.action === action || p.action === "*") &&
              (p.roles.length === 0 || p.roles.includes(role)),
          )

          const denyPolicy = matching.find((p) => p.effect === "deny")
          const allowPolicy = matching.find((p) => p.effect === "allow")

          let effect: PermissionMatrixCell["effect"] = "no-policy"
          if (denyPolicy) effect = "deny"
          else if (allowPolicy) effect = "allow"

          cells.push({
            role,
            resource,
            action,
            effect,
            policyIds: matching.map((p) => p.id),
            hasCondition: matching.some((p) => p.condition !== undefined),
          })
        }
      }
    }

    return { roles, resources, actions, cells }
  }

  /**
   * Simulate a policy check with step-by-step evaluation trace.
   */
  async simulate(context: PolicyCheckContext): Promise<SimulationResult> {
    const start = Date.now()
    const policies = this.engine.getPolicies()
    const steps: SimulationStep[] = []

    // Evaluate each applicable policy in order
    const applicable = policies.filter(
      (p) => (p.table === context.table || p.table === "*") && (p.action === context.action || p.action === "*"),
    )

    for (const policy of applicable) {
      const roleMatch = policy.roles.length === 0 || policy.roles.some((r) => context.user.roles.includes(r))

      let conditionMatch = true
      if (policy.condition && roleMatch) {
        try {
          conditionMatch = await policy.condition(context)
        } catch {
          conditionMatch = false
        }
      }

      const matched = roleMatch && conditionMatch

      let reason: string
      if (!roleMatch) {
        reason = `Role mismatch: user has [${context.user.roles.join(", ")}], policy requires [${policy.roles.join(", ")}]`
      } else if (!conditionMatch) {
        reason = "Row-level condition evaluated to false"
      } else {
        reason = `${policy.effect === "allow" ? "Granted" : "Denied"} by policy`
      }

      steps.push({
        policyId: policy.id,
        policyEffect: policy.effect,
        table: policy.table,
        action: policy.action,
        rolesRequired: policy.roles,
        hasCondition: policy.condition !== undefined,
        matched,
        reason,
      })
    }

    const result = await this.engine.check(context)

    return {
      context,
      result,
      steps,
      evaluationTimeMs: Date.now() - start,
      resolvedAt: new Date().toISOString(),
    }
  }

  /**
   * Get RLS policy views grouped by table.
   */
  getRlsPolicyViews(): RlsPolicyView[] {
    const rlsPolicies = this.engine.generateRlsPolicies()
    const rlsSQL = this.engine.generateRlsSQL()
    const byTable = new Map<string, RlsPolicyView>()

    for (const rls of rlsPolicies) {
      if (!byTable.has(rls.table)) {
        byTable.set(rls.table, { table: rls.table, policies: [] })
      }
      const sql =
        rlsSQL.find((s) => s.includes(`"${rls.name}"`)) ??
        `CREATE POLICY "${rls.name}" ON "${rls.table}" FOR ${rls.command} USING (${rls.usingExpression});`

      byTable.get(rls.table)!.policies.push({
        name: rls.name,
        command: rls.command,
        expression: rls.usingExpression,
        sql,
      })
    }

    return [...byTable.values()]
  }

  /**
   * Convert policies to visual editor nodes for drag-and-drop composition.
   */
  getEditorNodes(): PolicyEditorNode[] {
    const policies = this.engine.getPolicies()
    const nodes: PolicyEditorNode[] = []
    let y = 50

    for (const policy of policies) {
      const policyNode: PolicyEditorNode = {
        id: policy.id,
        type: "policy",
        label: `${policy.effect.toUpperCase()}: ${policy.table}.${policy.action}`,
        data: {
          effect: policy.effect,
          table: policy.table,
          action: policy.action,
          description: policy.description,
          priority: policy.priority,
        },
        position: { x: 300, y },
        connections: [],
      }

      if (policy.roles.length > 0) {
        const roleNodeId = `${policy.id}_roles`
        nodes.push({
          id: roleNodeId,
          type: "role-group",
          label: `Roles: ${policy.roles.join(", ")}`,
          data: { roles: policy.roles },
          position: { x: 50, y },
          connections: [policy.id],
        })
        policyNode.connections.push(roleNodeId)
      }

      if (policy.condition) {
        const condNodeId = `${policy.id}_cond`
        nodes.push({
          id: condNodeId,
          type: "condition",
          label: "Row-level condition",
          data: { hasCondition: true },
          position: { x: 550, y },
          connections: [policy.id],
        })
        policyNode.connections.push(condNodeId)
      }

      nodes.push(policyNode)
      y += 100
    }

    return nodes
  }

  /**
   * Generate the DACL Studio dashboard HTML.
   */
  generateDashboardHTML(
    roles: string[] = [],
    tables: string[] = [],
    actions: Action[] = ["read", "write", "create", "update", "delete"],
  ): string {
    const policies = this.engine.getPolicies()
    const rlsViews = this.getRlsPolicyViews()

    // Auto-detect roles and tables from policies if not provided
    if (roles.length === 0) {
      const roleSet = new Set<string>()
      for (const p of policies) p.roles.forEach((r) => roleSet.add(r))
      if (roleSet.size === 0) roleSet.add("*")
      roles = [...roleSet]
    }
    if (tables.length === 0) {
      const tableSet = new Set<string>()
      for (const p of policies) if (p.table !== "*") tableSet.add(p.table)
      tables = [...tableSet]
    }

    const matrix = this.getPermissionMatrix(roles, tables, actions)

    const matrixRows = tables
      .map((table) => {
        const cells = actions
          .map((action) => {
            const roleCells = roles
              .map((role) => {
                const cell = matrix.cells.find((c) => c.role === role && c.resource === table && c.action === action)
                const cls = cell?.effect === "allow" ? "allow" : cell?.effect === "deny" ? "deny" : "none"
                const icon = cell?.effect === "allow" ? "✅" : cell?.effect === "deny" ? "🚫" : "—"
                const cond = cell?.hasCondition ? " 🔒" : ""
                return `<td class="cell-${cls}" title="${table}.${action} for ${role}">${icon}${cond}</td>`
              })
              .join("")
            return roleCells
          })
          .join("")
        return `<tr><td class="resource-cell">${esc(table)}</td>${cells}</tr>`
      })
      .join("\n")

    const roleHeaders = roles.map((r) => `<th class="role-header">${esc(r)}</th>`).join("")
    const roleHeadersRepeated = actions.map(() => roleHeaders).join("")
    const actionGroupHeaders = actions
      .map((a) => `<th colspan="${roles.length}" class="action-header">${a}</th>`)
      .join("")

    const policyRows = policies
      .map(
        (p) => `<tr>
          <td>${esc(p.id)}</td>
          <td><span class="badge-${p.effect}">${p.effect}</span></td>
          <td>${esc(p.table)}</td>
          <td>${p.action}</td>
          <td>${p.roles.length > 0 ? p.roles.map((r) => esc(r)).join(", ") : "<em>all</em>"}</td>
          <td>${p.condition ? "✅" : "—"}</td>
          <td>${p.priority}</td>
          <td>${esc(p.description ?? "")}</td>
        </tr>`,
      )
      .join("\n")

    const rlsRows = rlsViews
      .flatMap((view) =>
        view.policies.map(
          (p) => `<tr>
            <td>${esc(view.table)}</td>
            <td>${esc(p.name)}</td>
            <td>${p.command}</td>
            <td><code>${esc(p.expression)}</code></td>
          </tr>`,
        ),
      )
      .join("\n")

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ReactiveBase — DACL Studio</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; padding: 24px; }
    h1 { font-size: 24px; margin-bottom: 8px; color: #f0f6fc; }
    h2 { font-size: 18px; margin: 24px 0 12px; color: #f0f6fc; }
    .subtitle { color: #8b949e; margin-bottom: 24px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 24px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #21262d; }
    th { color: #8b949e; font-weight: 600; }
    .action-header { text-align: center; border-bottom: 2px solid #30363d; text-transform: uppercase; font-size: 11px; }
    .role-header { text-align: center; font-size: 11px; }
    .resource-cell { font-weight: 600; color: #58a6ff; }
    .cell-allow { text-align: center; background: rgba(35, 134, 54, 0.15); }
    .cell-deny { text-align: center; background: rgba(218, 54, 51, 0.15); }
    .cell-none { text-align: center; color: #484f58; }
    .badge-allow { padding: 2px 8px; border-radius: 12px; font-size: 11px; background: #238636; color: #fff; }
    .badge-deny { padding: 2px 8px; border-radius: 12px; font-size: 11px; background: #da3633; color: #fff; }
    code { font-family: 'SF Mono', monospace; font-size: 12px; background: #0d1117; padding: 2px 6px; border-radius: 4px; }
    .tabs { display: flex; gap: 0; margin-bottom: 24px; border-bottom: 1px solid #30363d; }
    .tab { padding: 8px 16px; cursor: pointer; color: #8b949e; border-bottom: 2px solid transparent; }
    .tab.active { color: #f0f6fc; border-bottom-color: #58a6ff; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .sim-form { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .sim-form input, .sim-form select { padding: 6px 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; }
    .sim-form button { padding: 6px 16px; background: #238636; border: none; border-radius: 6px; color: #fff; cursor: pointer; }
    .grid-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px; text-align: center; }
    .stat-card .label { font-size: 11px; color: #8b949e; text-transform: uppercase; }
    .stat-card .value { font-size: 24px; font-weight: 700; color: #f0f6fc; }
  </style>
</head>
<body>
  <h1>🛡️ DACL Studio</h1>
  <p class="subtitle">Declarative Access Control — ${policies.length} policies across ${tables.length} resources</p>

  <div class="grid-stats">
    <div class="stat-card"><div class="label">Policies</div><div class="value">${policies.length}</div></div>
    <div class="stat-card"><div class="label">Resources</div><div class="value">${tables.length}</div></div>
    <div class="stat-card"><div class="label">Roles</div><div class="value">${roles.length}</div></div>
    <div class="stat-card"><div class="label">RLS Policies</div><div class="value">${rlsViews.reduce((s, v) => s + v.policies.length, 0)}</div></div>
  </div>

  <div class="tabs">
    <div class="tab active" onclick="switchTab('matrix')">Permission Matrix</div>
    <div class="tab" onclick="switchTab('policies')">All Policies</div>
    <div class="tab" onclick="switchTab('simulate')">Simulate</div>
    <div class="tab" onclick="switchTab('rls')">RLS Viewer</div>
  </div>

  <div id="tab-matrix" class="tab-content active">
    <div class="card">
      <table>
        <thead>
          <tr><th>Resource</th>${actionGroupHeaders}</tr>
          <tr><th></th>${roleHeadersRepeated}</tr>
        </thead>
        <tbody>${matrixRows}</tbody>
      </table>
    </div>
  </div>

  <div id="tab-policies" class="tab-content">
    <div class="card">
      <table>
        <thead><tr><th>ID</th><th>Effect</th><th>Resource</th><th>Action</th><th>Roles</th><th>Condition</th><th>Priority</th><th>Description</th></tr></thead>
        <tbody>${policyRows || '<tr><td colspan="8" style="text-align:center;color:#484f58">No policies defined</td></tr>'}</tbody>
      </table>
    </div>
  </div>

  <div id="tab-simulate" class="tab-content">
    <div class="card">
      <h2>Policy Simulation</h2>
      <p style="color:#8b949e;margin-bottom:16px">Test access control decisions with step-by-step evaluation trace.</p>
      <div class="sim-form">
        <input id="sim-user" placeholder="User ID" value="user_1" />
        <input id="sim-roles" placeholder="Roles (comma-separated)" value="${roles[0] ?? "user"}" />
        <select id="sim-table">${tables.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}</select>
        <select id="sim-action">${actions.map((a) => `<option value="${a}">${a}</option>`).join("")}</select>
        <button onclick="runSimulation()">Simulate</button>
      </div>
      <div id="sim-result" style="color:#8b949e;font-style:italic">Run a simulation to see evaluation trace.</div>
    </div>
  </div>

  <div id="tab-rls" class="tab-content">
    <div class="card">
      <table>
        <thead><tr><th>Table</th><th>Policy Name</th><th>Command</th><th>USING Expression</th></tr></thead>
        <tbody>${rlsRows || '<tr><td colspan="4" style="text-align:center;color:#484f58">No RLS policies generated</td></tr>'}</tbody>
      </table>
    </div>
  </div>

  <script>
    function switchTab(name) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
      document.getElementById('tab-' + name).classList.add('active');
      event.target.classList.add('active');
    }
    function runSimulation() {
      var user = document.getElementById('sim-user').value;
      var roles = document.getElementById('sim-roles').value.split(',').map(s => s.trim());
      var table = document.getElementById('sim-table').value;
      var action = document.getElementById('sim-action').value;
      function escapeForHtml(str) {
        return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      }
      document.getElementById('sim-result').innerHTML =
        '<p>Simulating: Can <strong>' + escapeForHtml(user) + '</strong> (' + escapeForHtml(roles.join(', ')) + ') perform <strong>' + escapeForHtml(action) + '</strong> on <strong>' + escapeForHtml(table) + '</strong>?</p>' +
        '<p style="margin-top:8px">⚡ Simulation requires server-side evaluation. Use <code>reactivebase dacl test</code> CLI or the studio API for full trace.</p>';
    }
  </script>
</body>
</html>`
  }
}

function esc(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
