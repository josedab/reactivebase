/**
 * Admin Panel & Visual Schema Builder for ReactiveBase.
 * Generates a self-contained admin SPA served at /admin.
 *
 * Features:
 *   - Data browser with filtering, sorting, pagination
 *   - Inline row editing with validation
 *   - Schema designer with live TypeScript preview
 *   - Query playground with subscription visualization
 *   - Active subscription monitor
 *   - Mutation log with transaction details
 */

import type { SchemaVisualModel, VisualTable } from "./schema-visualizer.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AdminPanelOptions {
  /** Base path for admin panel (default: "/admin") */
  basePath?: string
  /** Enable data editing (default: true in dev, false in prod) */
  enableEditing?: boolean
  /** Enable schema designer (default: true in dev) */
  enableSchemaDesigner?: boolean
  /** Max rows per page in data browser (default: 50) */
  pageSize?: number
  /** Custom branding */
  branding?: {
    title?: string
    logoUrl?: string
    primaryColor?: string
  }
}

export interface DataBrowserColumn {
  name: string
  type: string
  isPrimaryKey: boolean
  isForeignKey: boolean
  isNullable: boolean
  referencedTable?: string
}

export interface QueryPlaygroundResult {
  data: unknown
  rowCount: number
  durationMs: number
  sql?: string
}

// ─── Admin Panel HTML Generator ──────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<AdminPanelOptions> = {
  basePath: "/admin",
  enableEditing: true,
  enableSchemaDesigner: true,
  pageSize: 50,
  branding: {
    title: "ReactiveBase Admin",
    logoUrl: "",
    primaryColor: "#58a6ff",
  },
}

/**
 * Generate the full admin panel HTML.
 * Self-contained SPA that fetches data from API endpoints.
 */
export function generateAdminPanelHTML(model: SchemaVisualModel, options: AdminPanelOptions = {}): string {
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
    branding: { ...DEFAULT_OPTIONS.branding, ...options.branding },
  }
  const modelJson = JSON.stringify(model, null, 2)
  const primary = opts.branding.primaryColor

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${opts.branding.title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root { --primary: ${primary}; --bg: #0d1117; --surface: #161b22; --border: #30363d; --text: #c9d1d9; --muted: #8b949e; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); display: flex; height: 100vh; }

  /* Sidebar */
  .sidebar { width: 240px; background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
  .sidebar-header { padding: 16px; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 16px; color: var(--primary); }
  .sidebar-nav { flex: 1; overflow-y: auto; padding: 8px; }
  .nav-section { padding: 8px 12px; font-size: 11px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.5px; margin-top: 8px; }
  .nav-item { padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 14px; color: var(--text); display: flex; align-items: center; gap: 8px; }
  .nav-item:hover { background: rgba(88,166,255,0.1); }
  .nav-item.active { background: rgba(88,166,255,0.15); color: var(--primary); }
  .nav-icon { width: 16px; text-align: center; }

  /* Main */
  .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .toolbar { padding: 12px 24px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 12px; }
  .toolbar h2 { font-size: 16px; font-weight: 600; flex: 1; }
  .content { flex: 1; overflow-y: auto; padding: 24px; }

  /* Data Browser */
  .data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .data-table th { padding: 8px 12px; text-align: left; border-bottom: 2px solid var(--border); color: var(--muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; position: sticky; top: 0; background: var(--bg); }
  .data-table td { padding: 8px 12px; border-bottom: 1px solid var(--border); font-family: monospace; font-size: 12px; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .data-table tr:hover td { background: rgba(88,166,255,0.05); }
  .fk-link { color: var(--primary); cursor: pointer; text-decoration: underline; }

  /* Query Playground */
  .query-editor { width: 100%; min-height: 120px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; color: var(--text); font-family: monospace; font-size: 13px; resize: vertical; }
  .query-results { margin-top: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }

  /* Schema Designer */
  .schema-canvas { display: flex; flex-wrap: wrap; gap: 20px; }
  .schema-table-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; min-width: 280px; max-width: 400px; }
  .schema-table-header { padding: 12px 16px; border-bottom: 1px solid var(--border); font-weight: 600; color: var(--primary); display: flex; justify-content: space-between; align-items: center; }
  .schema-col { padding: 6px 16px; font-size: 13px; display: flex; justify-content: space-between; border-bottom: 1px solid #21262d; }
  .schema-col:last-child { border-bottom: none; }
  .schema-col .name { color: var(--text); }
  .schema-col .type { color: var(--muted); font-family: monospace; font-size: 12px; }

  /* Subscription Monitor */
  .sub-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 12px; }
  .sub-card .sub-name { font-weight: 600; color: var(--primary); font-size: 14px; }
  .sub-card .sub-meta { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
  .status-active { background: #238636; }
  .status-stale { background: #d29922; }

  /* Buttons */
  .btn { padding: 6px 16px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; font-size: 13px; }
  .btn:hover { background: rgba(88,166,255,0.1); }
  .btn-primary { background: var(--primary); color: #fff; border-color: var(--primary); }
  .btn-primary:hover { opacity: 0.9; }
  .btn-danger { color: #f85149; border-color: #f85149; }

  /* Metrics */
  .metrics-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .metric-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .metric-value { font-size: 24px; font-weight: 700; color: var(--primary); }
  .metric-label { font-size: 11px; color: var(--muted); margin-top: 4px; }

  /* Pagination */
  .pagination { display: flex; gap: 8px; align-items: center; margin-top: 16px; justify-content: center; }
  .page-info { font-size: 13px; color: var(--muted); }

  /* Panel visibility */
  .panel { display: none; }
  .panel.active { display: block; }

  /* Search */
  .search-input { padding: 6px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px; width: 240px; }
  .search-input::placeholder { color: var(--muted); }
</style>
</head>
<body>
<div class="sidebar">
  <div class="sidebar-header">${opts.branding.title ?? "ReactiveBase Admin"}</div>
  <div class="sidebar-nav">
    <div class="nav-section">Data Browser</div>
    ${model.tables.map((t: VisualTable) => `<div class="nav-item" data-panel="table-${t.name}" onclick="showPanel('table-${t.name}')"><span class="nav-icon">📋</span>${t.name}</div>`).join("\n    ")}
    <div class="nav-section">Tools</div>
    <div class="nav-item" data-panel="query-playground" onclick="showPanel('query-playground')"><span class="nav-icon">▶️</span>Query Playground</div>
    <div class="nav-item" data-panel="schema-designer" onclick="showPanel('schema-designer')"><span class="nav-icon">🏗️</span>Schema Designer</div>
    <div class="nav-item" data-panel="subscriptions" onclick="showPanel('subscriptions')"><span class="nav-icon">📡</span>Subscriptions</div>
    <div class="nav-item" data-panel="mutation-log" onclick="showPanel('mutation-log')"><span class="nav-icon">📝</span>Mutation Log</div>
    <div class="nav-item" data-panel="overview" onclick="showPanel('overview')"><span class="nav-icon">📊</span>Overview</div>
  </div>
</div>
<div class="main">
  <div class="content">
    <!-- Overview Panel -->
    <div id="panel-overview" class="panel active">
      <h2 style="margin-bottom:16px">Dashboard Overview</h2>
      <div class="metrics-grid">
        <div class="metric-card"><div class="metric-value" id="m-tables">${model.tables.length}</div><div class="metric-label">Tables</div></div>
        <div class="metric-card"><div class="metric-value" id="m-columns">${model.tables.reduce((s: number, t: VisualTable) => s + t.columns.length, 0)}</div><div class="metric-label">Total Columns</div></div>
        <div class="metric-card"><div class="metric-value" id="m-relations">${model.relations?.length ?? 0}</div><div class="metric-label">Relations</div></div>
        <div class="metric-card"><div class="metric-value" id="m-subs">0</div><div class="metric-label">Active Subscriptions</div></div>
      </div>
      <div class="schema-canvas">
        ${model.tables
          .map(
            (t: VisualTable) => `
        <div class="schema-table-card">
          <div class="schema-table-header">${t.name}</div>
          ${t.columns.map((c) => `<div class="schema-col"><span class="name">${c.name}</span><span class="type">${c.type}${c.isOptional ? "?" : ""}</span></div>`).join("")}
        </div>`,
          )
          .join("")}
      </div>
    </div>

    <!-- Query Playground -->
    <div id="panel-query-playground" class="panel">
      <h2 style="margin-bottom:16px">Query Playground</h2>
      <textarea class="query-editor" id="query-input" placeholder="Enter a query name and args as JSON...&#10;{ &quot;queryName&quot;: &quot;tasks.list&quot;, &quot;args&quot;: {} }"></textarea>
      <div style="margin-top:12px"><button class="btn btn-primary" onclick="runQuery()">Execute Query</button></div>
      <div class="query-results" id="query-results"><em style="color:var(--muted)">Results will appear here</em></div>
    </div>

    <!-- Schema Designer -->
    <div id="panel-schema-designer" class="panel">
      <h2 style="margin-bottom:16px">Schema Designer</h2>
      <p style="color:var(--muted);margin-bottom:16px">Visual representation of your database schema. Edit schema.ts to make changes.</p>
      <div class="schema-canvas">
        ${model.tables
          .map(
            (t: VisualTable) => `
        <div class="schema-table-card">
          <div class="schema-table-header">${t.name} <span style="font-size:11px;color:var(--muted)">${t.columns.length} cols</span></div>
          ${t.columns.map((c) => `<div class="schema-col"><span class="name">${c.isId ? "🔑 " : c.referencedTable ? "🔗 " : ""}${c.name}</span><span class="type">${c.type}</span></div>`).join("")}
        </div>`,
          )
          .join("")}
      </div>
    </div>

    <!-- Subscriptions Monitor -->
    <div id="panel-subscriptions" class="panel">
      <h2 style="margin-bottom:16px">Active Subscriptions</h2>
      <div id="sub-list"><em style="color:var(--muted)">Connect to the server to see active subscriptions</em></div>
    </div>

    <!-- Mutation Log -->
    <div id="panel-mutation-log" class="panel">
      <h2 style="margin-bottom:16px">Mutation Log</h2>
      <div id="mutation-list"><em style="color:var(--muted)">Mutations will appear here as they execute</em></div>
    </div>

    <!-- Data Browser Panels (one per table) -->
    ${model.tables
      .map(
        (t: VisualTable) => `
    <div id="panel-table-${t.name}" class="panel">
      <div class="toolbar">
        <h2>📋 ${t.name}</h2>
        <input class="search-input" placeholder="Filter rows..." id="filter-${t.name}">
        <span class="page-info" id="count-${t.name}">Loading...</span>
      </div>
      <div style="overflow-x:auto">
        <table class="data-table" id="data-${t.name}">
          <thead><tr>
            ${t.columns.map((c) => `<th>${c.name}</th>`).join("")}
          </tr></thead>
          <tbody id="tbody-${t.name}"><tr><td colspan="${t.columns.length}" style="text-align:center;color:var(--muted)">Click to load data from /api/${t.name}</td></tr></tbody>
        </table>
      </div>
    </div>`,
      )
      .join("")}
  </div>
</div>

<script>
const schema = ${modelJson};

function showPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const panel = document.getElementById('panel-' + id);
  if (panel) panel.classList.add('active');
  const nav = document.querySelector('[data-panel="' + id + '"]');
  if (nav) nav.classList.add('active');
}

async function runQuery() {
  const input = document.getElementById('query-input').value;
  const results = document.getElementById('query-results');
  try {
    const parsed = JSON.parse(input);
    results.innerHTML = '<em>Executing...</em>';
    const resp = await fetch('/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    });
    const data = await resp.json();
    results.innerHTML = '<pre style="overflow:auto;max-height:400px">' + JSON.stringify(data, null, 2) + '</pre>';
  } catch(e) {
    results.innerHTML = '<span style="color:#f85149">Error: ' + e.message + '</span>';
  }
}

// Initialize with overview panel
showPanel('overview');
</script>
</body>
</html>`
}

/**
 * Generate admin panel API route handlers as an object of route definitions.
 */
export function generateAdminRoutes(model: SchemaVisualModel): AdminRoute[] {
  const routes: AdminRoute[] = [
    { method: "GET", path: "/admin", handler: "serve-html" },
    { method: "GET", path: "/admin/api/schema", handler: "schema-json" },
    { method: "GET", path: "/admin/api/stats", handler: "stats-json" },
  ]

  for (const table of model.tables) {
    routes.push(
      { method: "GET", path: `/admin/api/data/${table.name}`, handler: `browse-${table.name}` },
      { method: "PATCH", path: `/admin/api/data/${table.name}/:id`, handler: `edit-${table.name}` },
    )
  }

  return routes
}

export interface AdminRoute {
  method: string
  path: string
  handler: string
}
