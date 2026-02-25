/**
 * Full observability dashboard HTML generator.
 * Produces a self-contained SPA that fetches live metrics
 * from the /metrics and /dashboard/schema.json endpoints.
 */

import type { SchemaVisualModel } from "./schema-visualizer.js"

/**
 * Generate the full observability dashboard HTML with live metrics.
 */
export function generateFullDashboardHTML(model: SchemaVisualModel): string {
  const modelJson = JSON.stringify(model, null, 2)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ReactiveBase Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; }
  .header { padding: 16px 24px; border-bottom: 1px solid #30363d; display: flex; align-items: center; gap: 12px; }
  .header h1 { font-size: 18px; font-weight: 600; }
  .badge { background: #238636; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; }
  .tabs { display: flex; border-bottom: 1px solid #30363d; padding: 0 24px; }
  .tab { padding: 12px 16px; cursor: pointer; border-bottom: 2px solid transparent; font-size: 14px; color: #8b949e; }
  .tab.active { border-bottom-color: #58a6ff; color: #c9d1d9; }
  .tab:hover { color: #c9d1d9; }
  .panel { display: none; padding: 24px; }
  .panel.active { display: block; }
  .metrics-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .metric-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
  .metric-value { font-size: 28px; font-weight: 700; color: #58a6ff; }
  .metric-label { font-size: 12px; color: #8b949e; margin-top: 4px; }
  .metric-sub { font-size: 11px; color: #6e7681; margin-top: 2px; }
  .canvas { display: flex; flex-wrap: wrap; gap: 24px; }
  .table-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; min-width: 260px; }
  .table-header { padding: 12px 16px; border-bottom: 1px solid #30363d; font-weight: 600; font-size: 14px; color: #58a6ff; }
  .column { padding: 6px 16px; font-size: 13px; display: flex; justify-content: space-between; border-bottom: 1px solid #21262d; }
  .column:last-child { border-bottom: none; }
  .column .name { color: #c9d1d9; }
  .column .type { color: #8b949e; font-family: monospace; font-size: 12px; }
  .column .pk { color: #f0883e; font-size: 10px; margin-right: 4px; }
  .column .fk { color: #a371f7; font-size: 10px; margin-right: 4px; }
  .column .opt { color: #8b949e; }
  .indexes { padding: 8px 16px; border-top: 1px solid #30363d; }
  .idx { font-size: 11px; color: #8b949e; padding: 2px 0; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
  .status-dot.green { background: #238636; }
  .status-dot.yellow { background: #d29922; }
  .status-dot.red { background: #da3633; }
  .log-entry { font-family: monospace; font-size: 12px; padding: 4px 16px; border-bottom: 1px solid #21262d; }
  .relations { padding: 16px 24px; }
  .relation { font-size: 13px; color: #8b949e; padding: 4px 0; }
  .relation .arrow { color: #58a6ff; }
  #refresh-indicator { font-size: 11px; color: #6e7681; margin-left: auto; }
</style>
</head>
<body>
<div class="header">
  <h1>⚡ ReactiveBase</h1>
  <span class="badge">${model.tables.length} tables</span>
  <span class="badge">${model.relations.length} relations</span>
  <span id="refresh-indicator">Loading metrics...</span>
</div>

<div class="tabs">
  <div class="tab active" onclick="showTab('metrics')">Metrics</div>
  <div class="tab" onclick="showTab('schema')">Schema</div>
  <div class="tab" onclick="showTab('subscriptions')">Subscriptions</div>
</div>

<!-- Metrics Panel -->
<div id="metrics" class="panel active">
  <div class="metrics-grid" id="metrics-grid"></div>
  <h3 style="margin: 16px 0 8px; font-size: 14px;">Per-Function Performance</h3>
  <div id="function-metrics" style="font-family: monospace; font-size: 12px;"></div>
</div>

<!-- Schema Panel -->
<div id="schema" class="panel">
  <div class="canvas">
${model.tables
  .map(
    (t) => `
    <div class="table-card">
      <div class="table-header">${t.name}</div>
      ${t.columns
        .map(
          (c) => `
      <div class="column">
        <span class="name">${c.isId ? '<span class="pk">PK</span>' : ""}${c.referencedTable ? '<span class="fk">FK</span>' : ""}${c.name}${c.isOptional ? '<span class="opt">?</span>' : ""}</span>
        <span class="type">${c.pgType}</span>
      </div>`,
        )
        .join("")}
      ${t.indexes.length > 0 ? `<div class="indexes">${t.indexes.map((idx) => `<div class="idx">${idx.unique ? "UNIQUE " : ""}INDEX ${idx.name} (${idx.columns.join(", ")})${idx.type ? " USING " + idx.type : ""}</div>`).join("")}</div>` : ""}
    </div>`,
  )
  .join("")}
  </div>
  ${
    model.relations.length > 0
      ? `
  <div class="relations">
    <h3 style="margin-bottom: 8px; font-size: 14px;">Relations</h3>
    ${model.relations.map((r) => `<div class="relation"><span class="arrow">${r.type === "has_many" ? "⇉" : "→"}</span> ${r.fromTable}.${r.fromColumn} → ${r.toTable}.${r.toColumn} <em>(${r.name})</em></div>`).join("")}
  </div>`
      : ""
  }
</div>

<!-- Subscriptions Panel -->
<div id="subscriptions" class="panel">
  <div id="sub-list" style="font-family: monospace; font-size: 12px;">
    <p style="color: #8b949e;">Live subscription data refreshes every 5 seconds.</p>
  </div>
</div>

<script>
const schema = ${modelJson};

function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function showTab(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById(name).classList.add('active');
  event.target.classList.add('active');
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n * 100) / 100);
}

async function refreshMetrics() {
  try {
    const res = await fetch('/metrics', { headers: { Accept: 'application/json' } });
    const m = await res.json();

    document.getElementById('metrics-grid').innerHTML = [
      metric('Connections', m.server.connections, 'Active WebSocket connections'),
      metric('Subscriptions', m.server.activeSubscriptions, 'Active reactive subscriptions'),
      metric('Queries', m.queries.totalExecuted, 'Avg: ' + m.queries.avgLatencyMs.toFixed(1) + 'ms | P99: ' + m.queries.p99LatencyMs.toFixed(1) + 'ms'),
      metric('Mutations', m.mutations.totalExecuted, 'Avg: ' + m.mutations.avgLatencyMs.toFixed(1) + 'ms | Retries: ' + m.mutations.totalRetries),
      metric('Invalidations', m.invalidations.totalInvalidated, 'Evaluations: ' + m.invalidations.totalEvaluations + ' | Skipped: ' + m.invalidations.totalSkipped),
      metric('Pending Jobs', m.server.pendingJobs, 'Scheduler queue depth'),
      metric('Uptime', formatNumber(m.uptime / 1000) + 's', 'Server uptime'),
      metric('Errors', m.queries.totalErrors + m.mutations.totalErrors, 'Query: ' + m.queries.totalErrors + ' | Mutation: ' + m.mutations.totalErrors),
    ].join('');

    // Per-function metrics
    const fns = [...Object.entries(m.queries.byFunction || {}), ...Object.entries(m.mutations.byFunction || {})];
    document.getElementById('function-metrics').innerHTML = fns.length > 0
      ? fns.map(([name, fm]) => '<div class="log-entry">' + escapeHtml(name) + ' — ' + fm.calls + ' calls, avg ' + fm.avgLatencyMs.toFixed(1) + 'ms</div>').join('')
      : '<p style="color: #6e7681; padding: 16px;">No function calls recorded yet.</p>';

    document.getElementById('refresh-indicator').textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch (e: unknown) {
    document.getElementById('refresh-indicator').textContent = 'Failed to fetch metrics';
  }
}

function metric(label, value, sub) {
  return '<div class="metric-card"><div class="metric-value">' + formatNumber(value) + '</div><div class="metric-label">' + label + '</div><div class="metric-sub">' + (sub || '') + '</div></div>';
}

refreshMetrics();
setInterval(refreshMetrics, 5000);
</script>
</body>
</html>`
}
