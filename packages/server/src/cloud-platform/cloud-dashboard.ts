/**
 * Cloud Dashboard — Self-contained web dashboard for managing
 * ReactiveBase Cloud projects, environments, and deployments.
 *
 * Generates a single-page HTML app served at /cloud that provides:
 *   - Project list with status indicators
 *   - Environment management (create, promote, destroy)
 *   - Deployment log viewer
 *   - Usage metrics and billing overview
 *   - API key management
 *
 * Usage:
 *   const html = generateCloudDashboardHTML(projects, environments)
 */

export interface CloudDashboardData {
  projects: Array<{ id: string; name: string; plan: string; status: string; region: string; envCount: number }>
  environments: Array<{
    id: string
    projectId: string
    name: string
    status: string
    url: string | null
    isProduction: boolean
  }>
  deployments: Array<{ id: string; envId: string; status: string; ref: string | null; startedAt: string }>
  usage?: { functionInvocations: number; storageMb: number; bandwidthMb: number; connections: number }
}

export function generateCloudDashboardHTML(data: CloudDashboardData): string {
  const projectsJson = JSON.stringify(data.projects)
  const envsJson = JSON.stringify(data.environments)
  const deploymentsJson = JSON.stringify(data.deployments)
  const usageJson = JSON.stringify(
    data.usage ?? { functionInvocations: 0, storageMb: 0, bandwidthMb: 0, connections: 0 },
  )

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ReactiveBase Cloud</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root { --primary: #58a6ff; --bg: #0d1117; --surface: #161b22; --border: #30363d; --text: #c9d1d9; --muted: #8b949e; --green: #238636; --red: #da3633; --yellow: #d29922; }
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); color: var(--text); }
  .header { padding: 16px 32px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
  .header h1 { color: var(--primary); font-size: 18px; display: flex; align-items: center; gap: 8px; }
  .main { max-width: 1200px; margin: 0 auto; padding: 24px 32px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px; }
  .stat-value { font-size: 28px; font-weight: 700; color: var(--primary); }
  .stat-label { font-size: 12px; color: var(--muted); margin-top: 4px; }
  h2 { font-size: 16px; margin-bottom: 16px; color: var(--text); }
  .project-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 12px; }
  .project-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .project-name { font-weight: 600; font-size: 15px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; }
  .badge-active { background: rgba(35,134,54,0.2); color: #3fb950; }
  .badge-plan { background: rgba(88,166,255,0.15); color: var(--primary); }
  .badge-prod { background: rgba(210,153,34,0.15); color: var(--yellow); }
  .project-meta { font-size: 12px; color: var(--muted); display: flex; gap: 16px; }
  .env-list { margin-top: 12px; }
  .env-item { padding: 8px 12px; border-left: 3px solid var(--border); margin-bottom: 4px; font-size: 13px; display: flex; justify-content: space-between; }
  .env-item.prod { border-left-color: var(--yellow); }
  .env-url { color: var(--primary); text-decoration: none; font-size: 12px; }
  .deploy-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  .deploy-table th { text-align: left; padding: 8px; border-bottom: 1px solid var(--border); color: var(--muted); font-size: 11px; text-transform: uppercase; }
  .deploy-table td { padding: 8px; border-bottom: 1px solid #21262d; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
  .status-active { background: var(--green); }
  .status-failed { background: var(--red); }
  .status-building { background: var(--yellow); }
</style>
</head>
<body>
<div class="header">
  <h1>☁️ ReactiveBase Cloud</h1>
  <span style="color:var(--muted);font-size:13px">${data.projects.length} projects</span>
</div>
<div class="main">
  <div class="grid">
    <div class="stat-card"><div class="stat-value">${data.projects.length}</div><div class="stat-label">Projects</div></div>
    <div class="stat-card"><div class="stat-value">${data.environments.length}</div><div class="stat-label">Environments</div></div>
    <div class="stat-card"><div class="stat-value">${data.deployments.length}</div><div class="stat-label">Deployments</div></div>
    <div class="stat-card"><div class="stat-value">${(data.usage?.functionInvocations ?? 0).toLocaleString()}</div><div class="stat-label">Invocations</div></div>
  </div>

  <h2>Projects</h2>
  ${data.projects
    .map((p) => {
      const envs = data.environments.filter((e) => e.projectId === p.id)
      const deps = data.deployments.filter((d) => envs.some((e) => e.id === d.envId))
      return `<div class="project-card">
    <div class="project-header">
      <span class="project-name">${p.name}</span>
      <span><span class="badge badge-active">${p.status}</span> <span class="badge badge-plan">${p.plan}</span></span>
    </div>
    <div class="project-meta">
      <span>🌍 ${p.region}</span>
      <span>📦 ${envs.length} environments</span>
      <span>🚀 ${deps.length} deployments</span>
    </div>
    <div class="env-list">
      ${envs
        .map(
          (e) => `<div class="env-item${e.isProduction ? " prod" : ""}">
        <span>${e.isProduction ? "🔒" : "🔧"} ${e.name} <span class="badge badge-active">${e.status}</span></span>
        ${e.url ? `<a href="${e.url}" class="env-url" target="_blank">${e.url}</a>` : ""}
      </div>`,
        )
        .join("")}
    </div>
  </div>`
    })
    .join("")}

  ${
    data.deployments.length > 0
      ? `<h2>Recent Deployments</h2>
  <table class="deploy-table">
    <thead><tr><th>Status</th><th>Environment</th><th>Ref</th><th>Started</th></tr></thead>
    <tbody>
    ${data.deployments
      .slice(0, 10)
      .map((d) => {
        const env = data.environments.find((e) => e.id === d.envId)
        const statusClass =
          d.status === "active" ? "status-active" : d.status === "failed" ? "status-failed" : "status-building"
        return `<tr>
        <td><span class="status-dot ${statusClass}"></span>${d.status}</td>
        <td>${env?.name ?? d.envId}</td>
        <td>${d.ref ?? "—"}</td>
        <td>${d.startedAt}</td>
      </tr>`
      })
      .join("")}
    </tbody>
  </table>`
      : ""
  }
</div>
<script>
const projects = ${projectsJson};
const environments = ${envsJson};
const deployments = ${deploymentsJson};
const usage = ${usageJson};
</script>
</body>
</html>`
}
