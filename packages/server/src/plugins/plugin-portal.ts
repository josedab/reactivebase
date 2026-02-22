/**
 * Plugin Developer Portal — Public registry UI, authoring SDK, and
 * compatibility matrix for the ReactiveBase plugin ecosystem.
 *
 * Usage:
 *   const portal = new PluginPortal(marketplace)
 *   const html = portal.generatePortalHTML()
 *   const compat = portal.checkCompatibilityMatrix("0.1.0")
 *   const scaffold = portal.scaffoldPlugin("my-plugin", "auth")
 */

import type { MarketplaceEntry, PluginCategory } from "./marketplace.js"
import { MARKETPLACE_CATALOG } from "./marketplace.js"
import { computePluginQualityScore, generatePluginTemplate, type PluginQualityInfo } from "./first-party-plugins.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PortalPlugin {
  entry: MarketplaceEntry
  qualityScore: number
  badges: string[]
  compatibility: PluginCompatibilityStatus
  installCount: number
}

export interface PluginCompatibilityStatus {
  compatible: boolean
  testedVersions: string[]
  minVersion: string
  issues: string[]
}

export interface CompatibilityMatrix {
  reactivebaseVersion: string
  plugins: Array<{
    name: string
    version: string
    compatible: boolean
    issues: string[]
  }>
  overallCompatible: number
  overallTotal: number
}

export interface PluginScaffold {
  files: Record<string, string>
  commands: string[]
  readme: string
}

export interface PortalStats {
  totalPlugins: number
  firstPartyPlugins: number
  communityPlugins: number
  categoryCounts: Record<string, number>
  avgQualityScore: number
  totalDownloads: number
}

// ─── Plugin Portal ───────────────────────────────────────────────────────────

export class PluginPortal {
  private catalog: MarketplaceEntry[]
  private installCounts = new Map<string, number>()

  constructor(additionalPlugins?: MarketplaceEntry[]) {
    this.catalog = [...MARKETPLACE_CATALOG, ...(additionalPlugins ?? [])]
  }

  // ─── Portal Listing ─────────────────────────────────────────────────────

  listPlugins(options: { category?: PluginCategory; query?: string; sortBy?: "name" | "rating" | "downloads" } = {}): PortalPlugin[] {
    let plugins = this.catalog.map((entry) => this.enrichPlugin(entry))

    if (options.category) {
      plugins = plugins.filter((p) => p.entry.category === options.category)
    }
    if (options.query) {
      const q = options.query.toLowerCase()
      plugins = plugins.filter((p) =>
        p.entry.name.includes(q) ||
        p.entry.description.toLowerCase().includes(q) ||
        p.entry.keywords.some((k) => k.includes(q)),
      )
    }

    switch (options.sortBy) {
      case "rating":
        plugins.sort((a, b) => b.qualityScore - a.qualityScore)
        break
      case "downloads":
        plugins.sort((a, b) => b.installCount - a.installCount)
        break
      default:
        plugins.sort((a, b) => a.entry.name.localeCompare(b.entry.name))
    }

    return plugins
  }

  getPlugin(name: string): PortalPlugin | undefined {
    const entry = this.catalog.find((p) => p.name === name)
    return entry ? this.enrichPlugin(entry) : undefined
  }

  recordInstall(pluginName: string): void {
    this.installCounts.set(pluginName, (this.installCounts.get(pluginName) ?? 0) + 1)
  }

  // ─── Compatibility Matrix ──────────────────────────────────────────────

  checkCompatibilityMatrix(reactivebaseVersion: string): CompatibilityMatrix {
    const results = this.catalog.map((entry) => {
      const compatible = this.checkVersionCompat(entry.version, reactivebaseVersion)
      return {
        name: entry.name,
        version: entry.version,
        compatible,
        issues: compatible ? [] : [`Plugin ${entry.name}@${entry.version} may not be compatible with ReactiveBase ${reactivebaseVersion}`],
      }
    })

    return {
      reactivebaseVersion,
      plugins: results,
      overallCompatible: results.filter((r) => r.compatible).length,
      overallTotal: results.length,
    }
  }

  // ─── Plugin Scaffolding ─────────────────────────────────────────────────

  scaffoldPlugin(name: string, category: PluginCategory): PluginScaffold {
    const template = generatePluginTemplate(name, category)

    return {
      files: template.files,
      commands: [
        `mkdir -p @reactivebase/plugin-${name}/src/__tests__`,
        `cd @reactivebase/plugin-${name}`,
        "npm install",
        "npm run build",
        "npm test",
      ],
      readme: template.files["README.md"] ?? "",
    }
  }

  // ─── Portal HTML ────────────────────────────────────────────────────────

  generatePortalHTML(): string {
    const plugins = this.listPlugins({ sortBy: "rating" })
    const stats = this.getStats()
    const categories = this.getCategories()

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ReactiveBase Plugin Registry</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root { --primary: #58a6ff; --bg: #0d1117; --surface: #161b22; --border: #30363d; --text: #c9d1d9; --muted: #8b949e; }
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); color: var(--text); }
  .header { padding: 24px 48px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
  .header h1 { color: var(--primary); font-size: 20px; }
  .stats-bar { display: flex; gap: 24px; padding: 16px 48px; background: var(--surface); font-size: 13px; color: var(--muted); }
  .stat { display: flex; gap: 6px; } .stat-value { color: var(--primary); font-weight: 600; }
  .main { padding: 24px 48px; display: flex; gap: 24px; }
  .sidebar { width: 200px; flex-shrink: 0; }
  .cat-item { padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 14px; margin-bottom: 4px; }
  .cat-item:hover { background: rgba(88,166,255,0.1); }
  .grid { flex: 1; display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px; }
  .card-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
  .card-name { font-weight: 600; color: var(--primary); font-size: 16px; }
  .card-version { color: var(--muted); font-size: 12px; }
  .card-desc { color: var(--text); font-size: 13px; margin-bottom: 12px; line-height: 1.5; }
  .card-meta { display: flex; gap: 12px; font-size: 12px; color: var(--muted); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; background: rgba(88,166,255,0.15); color: var(--primary); }
  .badge-verified { background: rgba(35,134,54,0.15); color: #3fb950; }
  .install-cmd { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 6px 10px; font-family: monospace; font-size: 12px; margin-top: 12px; }
</style>
</head>
<body>
<div class="header">
  <h1>🔌 ReactiveBase Plugin Registry</h1>
  <span style="color:var(--muted)">v0.1.0 · ${stats.totalPlugins} plugins</span>
</div>
<div class="stats-bar">
  <div class="stat"><span class="stat-value">${stats.totalPlugins}</span> plugins</div>
  <div class="stat"><span class="stat-value">${stats.firstPartyPlugins}</span> first-party</div>
  <div class="stat"><span class="stat-value">${stats.communityPlugins}</span> community</div>
  <div class="stat"><span class="stat-value">${stats.avgQualityScore.toFixed(1)}</span> avg quality</div>
</div>
<div class="main">
  <div class="sidebar">
    <div class="cat-item" style="font-weight:600">All Plugins</div>
    ${categories.map((c) => `<div class="cat-item">${c.category} (${c.count})</div>`).join("\n    ")}
  </div>
  <div class="grid">
    ${plugins.map((p) => `<div class="card">
      <div class="card-header">
        <span class="card-name">${p.entry.name}</span>
        <span class="card-version">v${p.entry.version}</span>
      </div>
      <div class="card-desc">${p.entry.description}</div>
      <div class="card-meta">
        <span class="badge">${p.entry.category}</span>
        ${p.entry.verified ? '<span class="badge badge-verified">✓ verified</span>' : ""}
        ${p.entry.firstParty ? '<span class="badge">first-party</span>' : ""}
        <span>⭐ ${p.qualityScore.toFixed(1)}</span>
      </div>
      <div class="install-cmd">${p.entry.installCommand}</div>
    </div>`).join("\n    ")}
  </div>
</div>
</body>
</html>`
  }

  // ─── Stats ──────────────────────────────────────────────────────────────

  getStats(): PortalStats {
    const cats: Record<string, number> = {}
    let totalScore = 0
    let totalDownloads = 0

    for (const entry of this.catalog) {
      cats[entry.category] = (cats[entry.category] ?? 0) + 1
      totalScore += entry.rating
      totalDownloads += entry.downloads + (this.installCounts.get(entry.name) ?? 0)
    }

    return {
      totalPlugins: this.catalog.length,
      firstPartyPlugins: this.catalog.filter((p) => p.firstParty).length,
      communityPlugins: this.catalog.filter((p) => !p.firstParty).length,
      categoryCounts: cats,
      avgQualityScore: this.catalog.length > 0 ? totalScore / this.catalog.length : 0,
      totalDownloads,
    }
  }

  getCategories(): Array<{ category: string; count: number }> {
    const stats = this.getStats()
    return Object.entries(stats.categoryCounts)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private enrichPlugin(entry: MarketplaceEntry): PortalPlugin {
    const qualityInfo: PluginQualityInfo = {
      hasTests: true,
      testCount: entry.firstParty ? 20 : 5,
      hasReadme: true,
      hasChangelog: entry.firstParty,
      hasTypeDefinitions: true,
      hasExamples: entry.firstParty,
      downloadCount: entry.downloads + (this.installCounts.get(entry.name) ?? 0),
      lastPublishedDaysAgo: 7,
      openIssues: 0,
      closedIssues: 5,
      dependencies: 1,
      hasCICD: entry.firstParty,
      isVerified: entry.verified,
      isFirstParty: entry.firstParty,
    }

    const score = computePluginQualityScore(qualityInfo)

    return {
      entry,
      qualityScore: score.overall,
      badges: score.badges,
      compatibility: {
        compatible: true,
        testedVersions: ["0.1.0"],
        minVersion: "0.1.0",
        issues: [],
      },
      installCount: entry.downloads + (this.installCounts.get(entry.name) ?? 0),
    }
  }

  private checkVersionCompat(pluginVersion: string, rbVersion: string): boolean {
    // Simple major version compatibility check
    const pMajor = parseInt(pluginVersion.split(".")[0], 10)
    const rMajor = parseInt(rbVersion.split(".")[0], 10)
    return pMajor === rMajor
  }
}
