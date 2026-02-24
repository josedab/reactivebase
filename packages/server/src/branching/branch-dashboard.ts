/**
 * Visual Branch Management Dashboard for ReactiveBase.
 * Provides a branch tree view, schema diffs, and an HTML dashboard
 * for managing database branches and PR previews.
 *
 * Usage:
 *   const dashboard = new BranchDashboard(branchingInstance)
 *   const tree = dashboard.getBranchTree()
 *   const html = dashboard.generateDashboardHTML()
 */

import type { BranchRecord, BranchDiff, SchemaChange, DataChange } from "./branching.js"
import type { PreviewRecord } from "./github-action.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BranchTreeNode {
  id: string
  name: string
  children: BranchTreeNode[]
  status: BranchRecord["status"]
  createdAt: number
  schemaChanges: number
}

export interface DashboardBranching {
  listBranches(): BranchRecord[]
  getBranch(name: string): BranchRecord | undefined
  diffBranches(source: string, target: string): Promise<BranchDiff>
}

export interface DashboardPreviewSource {
  listPreviews(): PreviewRecord[]
}

// ─── Branch Dashboard ────────────────────────────────────────────────────────

export class BranchDashboard {
  private branching: DashboardBranching
  private previewSource: DashboardPreviewSource | null

  constructor(branching: DashboardBranching, previewSource?: DashboardPreviewSource) {
    this.branching = branching
    this.previewSource = previewSource ?? null
  }

  // ─── Branch Tree ────────────────────────────────────────────────────────

  getBranchTree(): BranchTreeNode[] {
    const branches = this.branching.listBranches()
    const nodeMap = new Map<string, BranchTreeNode>()

    // Create nodes for all branches
    for (const branch of branches) {
      nodeMap.set(branch.name, {
        id: branch.name,
        name: branch.name,
        children: [],
        status: branch.status,
        createdAt: branch.createdAt,
        schemaChanges: 0,
      })
    }

    // Build tree structure
    const roots: BranchTreeNode[] = []
    for (const branch of branches) {
      const node = nodeMap.get(branch.name)!
      const parentNode = nodeMap.get(branch.parentBranch)

      if (!parentNode || branch.name === branch.parentBranch) {
        roots.push(node)
      } else {
        parentNode.children.push(node)
      }
    }

    return roots
  }

  // ─── Branch Diff ────────────────────────────────────────────────────────

  async getBranchDiff(branchId: string): Promise<BranchDiff | null> {
    const branch = this.branching.getBranch(branchId)
    if (!branch) return null

    return this.branching.diffBranches(branchId, branch.parentBranch)
  }

  // ─── HTML Dashboard ────────────────────────────────────────────────────

  async generateDashboardHTML(): Promise<string> {
    const tree = this.getBranchTree()
    const branches = this.branching.listBranches()
    const previews = this.previewSource?.listPreviews() ?? []

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ReactiveBase Branch Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; padding: 24px; }
    h1 { font-size: 24px; margin-bottom: 8px; color: #f0f6fc; }
    h2 { font-size: 18px; margin: 24px 0 12px; color: #f0f6fc; }
    .subtitle { color: #8b949e; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
    .card h3 { font-size: 14px; color: #8b949e; text-transform: uppercase; margin-bottom: 12px; }
    .tree-node { padding: 4px 0 4px 16px; border-left: 2px solid #30363d; }
    .tree-node .branch-name { font-weight: 600; color: #58a6ff; cursor: pointer; }
    .tree-node .branch-status { font-size: 12px; margin-left: 8px; padding: 2px 8px; border-radius: 12px; }
    .status-active { background: #238636; color: #fff; }
    .status-creating { background: #9e6a03; color: #fff; }
    .status-merged { background: #8957e5; color: #fff; }
    .status-deleted { background: #da3633; color: #fff; }
    .status-merging { background: #9e6a03; color: #fff; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #21262d; font-size: 14px; }
    th { color: #8b949e; font-weight: 600; }
    .actions { display: flex; gap: 8px; }
    .btn { padding: 4px 12px; border-radius: 6px; border: 1px solid #30363d; background: #21262d; color: #c9d1d9; cursor: pointer; font-size: 12px; }
    .btn:hover { background: #30363d; }
    .btn-danger { border-color: #da3633; color: #f85149; }
    .btn-danger:hover { background: #da3633; color: #fff; }
    .btn-primary { border-color: #238636; color: #3fb950; }
    .btn-primary:hover { background: #238636; color: #fff; }
    .diff-section { margin-top: 12px; }
    .diff-add { color: #3fb950; }
    .diff-remove { color: #f85149; }
    .diff-modify { color: #d29922; }
    .preview-badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; background: #1f6feb; color: #fff; }
    .empty { color: #484f58; font-style: italic; padding: 12px 0; }
  </style>
</head>
<body>
  <h1>🔀 ReactiveBase Branch Dashboard</h1>
  <p class="subtitle">${branches.length} branch${branches.length !== 1 ? "es" : ""} · ${previews.length} active preview${previews.length !== 1 ? "s" : ""}</p>

  <div class="grid">
    <div class="card">
      <h3>Branch Tree</h3>
${tree.length > 0 ? renderTreeHTML(tree, 3) : '      <p class="empty">No branches found.</p>'}
    </div>

    <div class="card">
      <h3>Active PR Previews</h3>
${previews.length > 0 ? renderPreviewsHTML(previews, 3) : '      <p class="empty">No active previews.</p>'}
    </div>
  </div>

  <h2>All Branches</h2>
  <div class="card">
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Parent</th>
          <th>Strategy</th>
          <th>Status</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
${branches.map((b) => renderBranchRowHTML(b)).join("\n")}
      </tbody>
    </table>
  </div>

  <div id="diff-viewer">
    <h2>Schema Diff Viewer</h2>
    <div class="card">
      <p class="empty">Select a branch to view schema differences.</p>
    </div>
  </div>

  <script>
    function mergeBranch(name) { if (confirm('Merge branch "' + name + '" into main?')) { alert('Merge requested for: ' + name); } }
    function deleteBranch(name) { if (confirm('Delete branch "' + name + '"?')) { alert('Delete requested for: ' + name); } }
  </script>
</body>
</html>`
  }
}

// ─── HTML Renderers ──────────────────────────────────────────────────────────

function renderTreeHTML(nodes: BranchTreeNode[], indent: number): string {
  const pad = " ".repeat(indent * 2)
  return nodes
    .map((node) => {
      const childrenHTML = node.children.length > 0 ? "\n" + renderTreeHTML(node.children, indent + 1) : ""
      return `${pad}<div class="tree-node">
${pad}  <span class="branch-name">${escapeHtml(node.name)}</span>
${pad}  <span class="branch-status status-${node.status}">${node.status}</span>
${pad}  ${node.schemaChanges > 0 ? `<span class="diff-modify">(${node.schemaChanges} change${node.schemaChanges !== 1 ? "s" : ""})</span>` : ""}${childrenHTML}
${pad}</div>`
    })
    .join("\n")
}

function renderPreviewsHTML(previews: PreviewRecord[], indent: number): string {
  const pad = " ".repeat(indent * 2)
  return `${pad}<table>
${pad}  <thead><tr><th>PR</th><th>Branch</th><th>Status</th><th>URL</th></tr></thead>
${pad}  <tbody>
${previews
  .map(
    (p) =>
      `${pad}    <tr><td>#${p.prNumber}</td><td>${escapeHtml(p.branch)}</td><td><span class="preview-badge">${p.status}</span></td><td>${p.previewUrl ? `<a href="${escapeHtml(p.previewUrl)}">${escapeHtml(p.previewUrl)}</a>` : "—"}</td></tr>`,
  )
  .join("\n")}
${pad}  </tbody>
${pad}</table>`
}

function renderBranchRowHTML(branch: BranchRecord): string {
  const date = new Date(branch.createdAt).toISOString().split("T")[0]
  const isDefault = branch.name === branch.parentBranch
  const actions = isDefault
    ? "—"
    : `<div class="actions"><button class="btn btn-primary" onclick="mergeBranch('${escapeHtml(branch.name)}')">Merge</button><button class="btn btn-danger" onclick="deleteBranch('${escapeHtml(branch.name)}')">Delete</button></div>`

  return `        <tr>
          <td>${escapeHtml(branch.name)}${branch.prNumber ? ` <span class="preview-badge">PR #${branch.prNumber}</span>` : ""}</td>
          <td>${escapeHtml(branch.parentBranch)}</td>
          <td>${escapeHtml(branch.strategy)}</td>
          <td><span class="branch-status status-${branch.status}">${branch.status}</span></td>
          <td>${date}</td>
          <td>${actions}</td>
        </tr>`
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
