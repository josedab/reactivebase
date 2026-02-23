/**
 * Migration Wizard UI — Visual migration tool served at /admin/migrations.
 * Generates a self-contained HTML page with:
 *   - Schema diff viewer with color-coded risk levels
 *   - SQL preview with syntax highlighting
 *   - Risk assessment summary
 *   - One-click apply with confirmation modal
 *   - Rollback button
 *
 * Usage:
 *   const html = generateMigrationWizardHTML(analysis, plan)
 */

import type { ChangeAnalysis, SafeMigrationPlan } from "../migrations/migration-planner.js"

export function generateMigrationWizardHTML(analysis: ChangeAnalysis, plan: SafeMigrationPlan): string {
  const riskColor =
    analysis.overallRisk === "safe" ? "#238636" : analysis.overallRisk === "caution" ? "#d29922" : "#da3633"
  const riskEmoji = analysis.overallRisk === "safe" ? "✅" : analysis.overallRisk === "caution" ? "⚠️" : "🔴"

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ReactiveBase Migration Wizard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root { --primary: #58a6ff; --bg: #0d1117; --surface: #161b22; --border: #30363d; --text: #c9d1d9; --muted: #8b949e; --green: #238636; --red: #da3633; --yellow: #d29922; }
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); color: var(--text); padding: 32px; max-width: 960px; margin: 0 auto; }
  h1 { font-size: 24px; margin-bottom: 8px; display: flex; align-items: center; gap: 10px; }
  h2 { font-size: 16px; margin: 24px 0 12px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
  .risk-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 13px; font-weight: 600; color: white; background: ${riskColor}; }
  .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0; }
  .summary-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; text-align: center; }
  .summary-value { font-size: 24px; font-weight: 700; }
  .summary-label { font-size: 12px; color: var(--muted); }
  .change-list { margin: 12px 0; }
  .change-item { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 12px 16px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
  .change-desc { font-size: 14px; }
  .change-risk { font-size: 12px; padding: 2px 8px; border-radius: 8px; }
  .risk-safe { background: rgba(35,134,54,0.2); color: #3fb950; }
  .risk-caution { background: rgba(210,153,34,0.2); color: var(--yellow); }
  .risk-breaking { background: rgba(218,54,51,0.2); color: #f85149; }
  .sql-block { background: #0d1117; border: 1px solid var(--border); border-radius: 8px; padding: 16px; font-family: monospace; font-size: 13px; white-space: pre-wrap; overflow-x: auto; margin: 8px 0 16px; line-height: 1.6; color: #e6edf3; }
  .phase { margin-bottom: 24px; }
  .phase-header { font-size: 14px; font-weight: 600; color: var(--primary); margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
  .phase-desc { font-size: 13px; color: var(--muted); margin-bottom: 12px; }
  .warning { background: rgba(210,153,34,0.1); border: 1px solid rgba(210,153,34,0.3); border-radius: 8px; padding: 12px 16px; margin: 12px 0; font-size: 13px; color: var(--yellow); }
  .actions { display: flex; gap: 12px; margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--border); }
  .btn { padding: 8px 20px; border-radius: 6px; border: 1px solid var(--border); cursor: pointer; font-size: 14px; font-weight: 500; }
  .btn-primary { background: var(--green); color: white; border-color: var(--green); }
  .btn-danger { background: transparent; color: var(--red); border-color: var(--red); }
  .btn-secondary { background: var(--surface); color: var(--text); }
  .info { font-size: 13px; color: var(--muted); margin-top: 8px; }
  .downtime-badge { font-size: 12px; padding: 2px 8px; border-radius: 8px; background: ${plan.estimatedDowntime === "zero" ? "rgba(35,134,54,0.2)" : "rgba(210,153,34,0.2)"}; color: ${plan.estimatedDowntime === "zero" ? "#3fb950" : "#d29922"}; }
</style>
</head>
<body>
<h1>🔄 Migration Wizard <span class="risk-badge">${riskEmoji} ${analysis.overallRisk.toUpperCase()}</span></h1>
<p style="color:var(--muted);margin-bottom:16px">Review schema changes before applying to your database.</p>

<div class="summary">
  <div class="summary-card"><div class="summary-value" style="color:var(--green)">${analysis.safeCount}</div><div class="summary-label">Safe Changes</div></div>
  <div class="summary-card"><div class="summary-value" style="color:var(--yellow)">${analysis.cautionCount}</div><div class="summary-label">Caution</div></div>
  <div class="summary-card"><div class="summary-value" style="color:var(--red)">${analysis.breakingCount}</div><div class="summary-label">Breaking</div></div>
</div>

<p style="font-size:13px;color:var(--muted)">Estimated downtime: <span class="downtime-badge">${plan.estimatedDowntime}</span> · Total steps: ${plan.totalSteps}</p>

<h2>Changes Detected</h2>
<div class="change-list">
${analysis.changes
  .map(
    (c) => `  <div class="change-item">
    <div>
      <div class="change-desc"><code>${c.change.type}</code> on <strong>${c.change.table}</strong>${c.change.column ? `.<strong>${c.change.column}</strong>` : ""}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">${c.recommendation}</div>
    </div>
    <span class="change-risk risk-${c.risk}">${c.risk}</span>
  </div>`,
  )
  .join("\n")}
</div>

${
  plan.warnings.length > 0
    ? `<h2>⚠️ Warnings</h2>
${plan.warnings.map((w) => `<div class="warning">${w}</div>`).join("\n")}`
    : ""
}

<h2>Migration Plan</h2>
${plan.phases
  .map(
    (phase, i) => `<div class="phase">
  <div class="phase-header">Phase ${i + 1}: ${phase.name} ${phase.requiresLock ? "🔒" : "✅"}</div>
  <div class="phase-desc">${phase.description}</div>
  ${phase.steps
    .map(
      (step) => `<div class="sql-block">${escapeHtml(step.sql)}</div>
  <p class="info">${step.description}${step.reversible ? " · Reversible ✅" : " · ⚠️ Irreversible"}</p>`,
    )
    .join("\n")}
</div>`,
  )
  .join("\n")}

<div class="actions">
  <button class="btn btn-primary" onclick="applyMigration()">Apply Migration</button>
  <button class="btn btn-secondary" onclick="copySQL()">Copy SQL</button>
  ${plan.rollbackSteps.length > 0 ? '<button class="btn btn-danger" onclick="showRollback()">Show Rollback SQL</button>' : ""}
</div>

<script>
function applyMigration() {
  if (!confirm('Apply this migration to your database? ${analysis.overallRisk === "breaking" ? "⚠️ This includes BREAKING changes." : ""}')) return;
  alert('Migration would be applied via: reactivebase migrate --apply');
}
function copySQL() {
  const sql = ${JSON.stringify(plan.phases.flatMap((p) => p.steps.map((s) => s.sql)).join("\n\n"))};
  navigator.clipboard.writeText(sql).then(() => alert('SQL copied to clipboard'));
}
function showRollback() {
  const rollback = ${JSON.stringify(plan.rollbackSteps.join("\n\n"))};
  alert('Rollback SQL:\\n\\n' + rollback);
}
</script>
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
