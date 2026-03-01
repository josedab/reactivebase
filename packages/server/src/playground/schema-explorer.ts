/**
 * Interactive Schema Playground for ReactiveBase.
 * Provides schema visualization, live query testing, subscription debugging,
 * and auth context switching for developer onboarding and adoption.
 *
 * Usage:
 *   const explorer = new SchemaExplorer()
 *   explorer.loadSchema(schemaDefinition)
 *   const viz = explorer.visualize()
 *   const queryResult = await explorer.testQuery("tasks.list", { status: "active" })
 */

// ─── Schema Visualization ────────────────────────────────────────────────────

export interface SchemaNode {
  name: string
  type: "table" | "view" | "enum"
  columns: ColumnInfo[]
  indexes: IndexInfo[]
  relations: RelationInfo[]
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  defaultValue?: string
  references?: { table: string; column: string }
}

export interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
  type: "btree" | "hash" | "gin" | "gist" | "ivfflat" | "hnsw"
}

export interface RelationInfo {
  name: string
  from: { table: string; column: string }
  to: { table: string; column: string }
  type: "one-to-one" | "one-to-many" | "many-to-many"
}

export interface SchemaVisualization {
  nodes: SchemaNode[]
  edges: Array<{ from: string; to: string; relation: RelationInfo }>
  stats: {
    tableCount: number
    columnCount: number
    indexCount: number
    relationCount: number
  }
  mermaidDiagram: string
}

export interface AuthContextProfile {
  name: string
  userId: string
  claims: Record<string, unknown>
  roles: string[]
}

export interface LiveQueryTest {
  id: string
  functionName: string
  args: unknown
  authContext: AuthContextProfile
  result?: unknown
  error?: string
  durationMs: number
  timestamp: number
}

export interface SubscriptionDebugEntry {
  id: string
  subscriptionName: string
  status: "active" | "paused" | "error" | "closed"
  lastUpdate: unknown
  updateCount: number
  errorCount: number
  createdAt: number
  lastUpdatedAt: number
  latencyMs: number
}

// ─── Schema Explorer ─────────────────────────────────────────────────────────

export interface SchemaDefinitionInput {
  tables: Array<{
    name: string
    columns: ColumnInfo[]
    indexes?: IndexInfo[]
  }>
  relations?: RelationInfo[]
}

export class SchemaExplorer {
  private nodes: SchemaNode[] = []
  private edges: Array<{ from: string; to: string; relation: RelationInfo }> = []

  /**
   * Load a schema definition for visualization.
   */
  loadSchema(schema: SchemaDefinitionInput): void {
    this.nodes = schema.tables.map((t) => ({
      name: t.name,
      type: "table",
      columns: t.columns,
      indexes: t.indexes ?? [],
      relations: [],
    }))

    this.edges = []
    if (schema.relations) {
      for (const rel of schema.relations) {
        this.edges.push({ from: rel.from.table, to: rel.to.table, relation: rel })
        const node = this.nodes.find((n) => n.name === rel.from.table)
        if (node) node.relations.push(rel)
      }
    }

    // Auto-detect relations from foreign key columns
    for (const node of this.nodes) {
      for (const col of node.columns) {
        if (col.references) {
          const existing = this.edges.find((e) => e.from === node.name && e.to === col.references!.table)
          if (!existing) {
            const rel: RelationInfo = {
              name: `${node.name}_${col.name}_fk`,
              from: { table: node.name, column: col.name },
              to: { table: col.references.table, column: col.references.column },
              type: "one-to-many",
            }
            this.edges.push({ from: node.name, to: col.references.table, relation: rel })
            node.relations.push(rel)
          }
        }
      }
    }
  }

  /**
   * Generate schema visualization data including a Mermaid diagram.
   */
  visualize(): SchemaVisualization {
    const mermaidDiagram = this.generateMermaid()
    return {
      nodes: this.nodes,
      edges: this.edges,
      stats: {
        tableCount: this.nodes.length,
        columnCount: this.nodes.reduce((sum, n) => sum + n.columns.length, 0),
        indexCount: this.nodes.reduce((sum, n) => sum + n.indexes.length, 0),
        relationCount: this.edges.length,
      },
      mermaidDiagram,
    }
  }

  /**
   * Get a single table's detailed info.
   */
  getTable(name: string): SchemaNode | undefined {
    return this.nodes.find((n) => n.name === name)
  }

  /**
   * Find tables related to a given table.
   */
  getRelatedTables(tableName: string): string[] {
    const related = new Set<string>()
    for (const edge of this.edges) {
      if (edge.from === tableName) related.add(edge.to)
      if (edge.to === tableName) related.add(edge.from)
    }
    return Array.from(related)
  }

  /**
   * Search schema for tables/columns matching a query.
   */
  search(query: string): Array<{ table: string; column?: string; match: "table" | "column" }> {
    const q = query.toLowerCase()
    const results: Array<{ table: string; column?: string; match: "table" | "column" }> = []

    for (const node of this.nodes) {
      if (node.name.toLowerCase().includes(q)) {
        results.push({ table: node.name, match: "table" })
      }
      for (const col of node.columns) {
        if (col.name.toLowerCase().includes(q)) {
          results.push({ table: node.name, column: col.name, match: "column" })
        }
      }
    }
    return results
  }

  private generateMermaid(): string {
    const lines: string[] = ["erDiagram"]

    for (const node of this.nodes) {
      lines.push(`    ${node.name} {`)
      for (const col of node.columns) {
        const pk = col.primaryKey ? "PK" : ""
        const fk = col.references ? "FK" : ""
        const marker = [pk, fk].filter(Boolean).join(",")
        lines.push(`        ${col.type} ${col.name}${marker ? ` ${marker}` : ""}`)
      }
      lines.push("    }")
    }

    for (const edge of this.edges) {
      const relType = edge.relation.type === "one-to-many" ? "||--o{" : "||--||"
      lines.push(`    ${edge.from} ${relType} ${edge.to} : "${edge.relation.name}"`)
    }

    return lines.join("\n")
  }
}

// ─── Auth Context Switcher ───────────────────────────────────────────────────

const BUILT_IN_PROFILES: AuthContextProfile[] = [
  { name: "Anonymous", userId: "", claims: {}, roles: [] },
  { name: "Admin", userId: "admin-001", claims: { role: "admin" }, roles: ["admin"] },
  { name: "User", userId: "user-001", claims: { role: "user" }, roles: ["user"] },
  { name: "Service Account", userId: "svc-001", claims: { role: "service", internal: true }, roles: ["service"] },
]

export class AuthContextSwitcher {
  private profiles = new Map<string, AuthContextProfile>()
  private activeProfile: AuthContextProfile

  constructor() {
    for (const profile of BUILT_IN_PROFILES) {
      this.profiles.set(profile.name, profile)
    }
    this.activeProfile = BUILT_IN_PROFILES[0]
  }

  /**
   * Add a custom auth profile.
   */
  addProfile(profile: AuthContextProfile): void {
    this.profiles.set(profile.name, profile)
  }

  /**
   * Remove a profile by name.
   */
  removeProfile(name: string): boolean {
    if (BUILT_IN_PROFILES.some((p) => p.name === name)) return false
    return this.profiles.delete(name)
  }

  /**
   * Switch to a named auth profile.
   */
  switchTo(name: string): AuthContextProfile | null {
    const profile = this.profiles.get(name)
    if (!profile) return null
    this.activeProfile = profile
    return profile
  }

  /**
   * Get the active auth profile.
   */
  getActive(): AuthContextProfile {
    return this.activeProfile
  }

  /**
   * List all available profiles.
   */
  listProfiles(): AuthContextProfile[] {
    return Array.from(this.profiles.values())
  }
}

// ─── Live Query Tester ───────────────────────────────────────────────────────

export class LiveQueryTester {
  private history: LiveQueryTest[] = []
  private maxHistory: number

  constructor(maxHistory: number = 100) {
    this.maxHistory = maxHistory
  }

  /**
   * Record a query test execution.
   */
  recordTest(
    functionName: string,
    args: unknown,
    authContext: AuthContextProfile,
    result?: unknown,
    error?: string,
    durationMs: number = 0,
  ): LiveQueryTest {
    const entry: LiveQueryTest = {
      id: `qt_${Date.now()}_${crypto.randomUUID()}`,
      functionName,
      args,
      authContext,
      result,
      error,
      durationMs,
      timestamp: Date.now(),
    }

    this.history.push(entry)
    if (this.history.length > this.maxHistory) {
      this.history.shift()
    }

    return entry
  }

  /**
   * Get test history.
   */
  getHistory(limit?: number): LiveQueryTest[] {
    const items = [...this.history].reverse()
    return limit ? items.slice(0, limit) : items
  }

  /**
   * Get history for a specific function.
   */
  getByFunction(functionName: string): LiveQueryTest[] {
    return this.history.filter((t) => t.functionName === functionName).reverse()
  }

  /**
   * Clear test history.
   */
  clear(): void {
    this.history = []
  }
}

// ─── Subscription Debugger ───────────────────────────────────────────────────

export class SubscriptionDebugger {
  private subscriptions = new Map<string, SubscriptionDebugEntry>()

  /**
   * Track a new subscription.
   */
  track(id: string, name: string): void {
    this.subscriptions.set(id, {
      id,
      subscriptionName: name,
      status: "active",
      lastUpdate: null,
      updateCount: 0,
      errorCount: 0,
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
      latencyMs: 0,
    })
  }

  /**
   * Record a subscription update.
   */
  recordUpdate(id: string, data: unknown, latencyMs: number): void {
    const entry = this.subscriptions.get(id)
    if (!entry) return
    entry.lastUpdate = data
    entry.updateCount++
    entry.lastUpdatedAt = Date.now()
    entry.latencyMs = latencyMs
  }

  /**
   * Record a subscription error.
   */
  recordError(id: string): void {
    const entry = this.subscriptions.get(id)
    if (!entry) return
    entry.errorCount++
    entry.status = "error"
  }

  /**
   * Set subscription status.
   */
  setStatus(id: string, status: SubscriptionDebugEntry["status"]): void {
    const entry = this.subscriptions.get(id)
    if (entry) entry.status = status
  }

  /**
   * Remove a tracked subscription.
   */
  untrack(id: string): void {
    this.subscriptions.delete(id)
  }

  /**
   * Get all tracked subscriptions.
   */
  getAll(): SubscriptionDebugEntry[] {
    return Array.from(this.subscriptions.values())
  }

  /**
   * Get active subscriptions only.
   */
  getActive(): SubscriptionDebugEntry[] {
    return Array.from(this.subscriptions.values()).filter((s) => s.status === "active")
  }

  /**
   * Get subscription stats summary.
   */
  getStats(): {
    total: number
    active: number
    errored: number
    totalUpdates: number
    avgLatencyMs: number
  } {
    const all = Array.from(this.subscriptions.values())
    const totalUpdates = all.reduce((s, e) => s + e.updateCount, 0)
    const totalLatency = all.reduce((s, e) => s + e.latencyMs * e.updateCount, 0)

    return {
      total: all.length,
      active: all.filter((s) => s.status === "active").length,
      errored: all.filter((s) => s.status === "error").length,
      totalUpdates,
      avgLatencyMs: totalUpdates > 0 ? totalLatency / totalUpdates : 0,
    }
  }
}

// ─── HTML Generator ──────────────────────────────────────────────────────────

export interface SchemaPlaygroundHTMLOptions {
  title?: string
  theme?: "light" | "dark"
  schemaData?: SchemaVisualization
  enableQueryTester?: boolean
  enableSubscriptionDebugger?: boolean
  enableAuthSwitcher?: boolean
}

export function generateSchemaPlaygroundHTML(options: SchemaPlaygroundHTMLOptions = {}): string {
  const title = options.title ?? "ReactiveBase Schema Playground"
  const theme = options.theme ?? "dark"
  const schemaJson = options.schemaData ? JSON.stringify(options.schemaData) : "null"

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root { --bg: #1e1e2e; --surface: #2a2a3e; --text: #cdd6f4; --accent: #89b4fa; --border: #45475a; }
    [data-theme="light"] { --bg: #ffffff; --surface: #f5f5f5; --text: #1e1e2e; --accent: #1e66f5; --border: #ddd; }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); display: grid; grid-template-columns: 280px 1fr 320px; grid-template-rows: 48px 1fr; height: 100vh; }
    header { grid-column: 1 / -1; background: var(--surface); border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 16px; gap: 16px; }
    header h1 { font-size: 16px; font-weight: 600; }
    .sidebar { background: var(--surface); border-right: 1px solid var(--border); overflow-y: auto; padding: 12px; }
    .main { padding: 16px; overflow-y: auto; }
    .panel { background: var(--surface); border-left: 1px solid var(--border); overflow-y: auto; padding: 12px; }
    .table-card { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px; margin-bottom: 8px; cursor: pointer; }
    .table-card:hover { border-color: var(--accent); }
    .table-card h3 { font-size: 13px; color: var(--accent); margin-bottom: 4px; }
    .table-card .cols { font-size: 11px; opacity: 0.7; }
    .tab-bar { display: flex; gap: 2px; margin-bottom: 12px; }
    .tab { padding: 6px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; cursor: pointer; font-size: 12px; }
    .tab.active { background: var(--accent); color: var(--bg); border-color: var(--accent); }
    .query-input { width: 100%; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px; padding: 10px; font-family: monospace; font-size: 13px; min-height: 120px; resize: vertical; }
    .btn { background: var(--accent); color: var(--bg); border: none; border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 12px; font-weight: 600; }
    .result-pane { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 10px; margin-top: 8px; font-family: monospace; font-size: 12px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; }
    .auth-profile { padding: 6px 10px; border: 1px solid var(--border); border-radius: 4px; margin-bottom: 4px; cursor: pointer; font-size: 12px; }
    .auth-profile.active { border-color: var(--accent); background: rgba(137,180,250,0.1); }
    .sub-entry { padding: 6px; border-bottom: 1px solid var(--border); font-size: 11px; }
    .status-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 4px; }
    .status-dot.active { background: #a6e3a1; }
    .status-dot.error { background: #f38ba8; }
    .mermaid-container { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 16px; margin-top: 12px; overflow: auto; }
  </style>
</head>
<body>
  <header>
    <h1>📊 ${title}</h1>
    <div class="tab-bar">
      <div class="tab active" onclick="switchTab('schema')">Schema</div>
      <div class="tab" onclick="switchTab('query')">Query Tester</div>
      <div class="tab" onclick="switchTab('subscriptions')">Subscriptions</div>
    </div>
  </header>
  <div class="sidebar" id="sidebar">
    <h3 style="font-size:12px;margin-bottom:8px;opacity:0.7">TABLES</h3>
    <div id="table-list"></div>
    <h3 style="font-size:12px;margin:12px 0 8px;opacity:0.7">AUTH CONTEXT</h3>
    <div id="auth-profiles"></div>
  </div>
  <div class="main" id="main-content">
    <div id="schema-view"><div class="mermaid-container" id="mermaid-output"></div></div>
    <div id="query-view" style="display:none">
      <textarea class="query-input" id="query-input" placeholder="Enter function name and args as JSON..."></textarea>
      <div style="margin-top:8px"><button class="btn" onclick="runQuery()">▶ Run Query</button></div>
      <div class="result-pane" id="query-result">Results will appear here...</div>
    </div>
    <div id="sub-view" style="display:none">
      <div id="sub-list"><p style="opacity:0.5;font-size:13px">No active subscriptions</p></div>
    </div>
  </div>
  <div class="panel" id="detail-panel">
    <h3 style="font-size:12px;margin-bottom:8px;opacity:0.7">DETAILS</h3>
    <div id="detail-content"><p style="opacity:0.5;font-size:13px">Select a table to view details</p></div>
  </div>
  <script>
    const schemaData = ${schemaJson};
    let activeTab = 'schema';
    function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function switchTab(tab) {
      activeTab = tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById('schema-view').style.display = tab === 'schema' ? '' : 'none';
      document.getElementById('query-view').style.display = tab === 'query' ? '' : 'none';
      document.getElementById('sub-view').style.display = tab === 'subscriptions' ? '' : 'none';
    }
    function runQuery() {
      document.getElementById('query-result').textContent = 'Executing...\\n(Connect to a ReactiveBase server for live results)';
    }
    if (schemaData) {
      const list = document.getElementById('table-list');
      schemaData.nodes.forEach(n => {
        const card = document.createElement('div');
        card.className = 'table-card';
        card.innerHTML = '<h3>' + escapeHtml(n.name) + '</h3><div class="cols">' + n.columns.length + ' columns, ' + n.indexes.length + ' indexes</div>';
        card.onclick = () => showTableDetail(n);
        list.appendChild(card);
      });
      document.getElementById('mermaid-output').textContent = schemaData.mermaidDiagram;
    }
    function showTableDetail(node) {
      const detail = document.getElementById('detail-content');
      let html = '<h3 style="color:var(--accent);margin-bottom:8px">' + escapeHtml(node.name) + '</h3>';
      html += '<div style="font-size:12px">';
      node.columns.forEach(c => {
        html += '<div style="padding:3px 0;border-bottom:1px solid var(--border)">';
        html += '<strong>' + escapeHtml(c.name) + '</strong> <span style="opacity:0.6">' + escapeHtml(c.type) + '</span>';
        if (c.primaryKey) html += ' <span style="color:#a6e3a1">PK</span>';
        if (c.references) html += ' <span style="color:#fab387">FK→' + escapeHtml(c.references.table) + '</span>';
        html += '</div>';
      });
      html += '</div>';
      detail.innerHTML = html;
    }
  </script>
</body>
</html>`
}
