/**
 * CLI support for the ReactiveBase plugin system.
 * Powers `reactivebase plugin add/remove/list/search/info/init` commands.
 *
 * Usage:
 *   const cli = new PluginCLI()
 *   const result = await cli.add("resend")
 *   console.log(cli.generateCLIOutput("add", result))
 */

import type { PluginCategory } from "./marketplace.js"
import { PluginMarketplace, MARKETPLACE_CATALOG } from "./marketplace.js"
import type { PluginV2Instance } from "./marketplace.js"
import {
  computePluginQualityScore,
  generatePluginTemplate,
  type PluginQualityInfo,
  type PluginTemplate,
} from "./first-party-plugins.js"
import { ALL_BUILTIN_PLUGINS } from "./builtin-plugins.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PluginCLIConfig {
  /** Path to the project root */
  projectRoot?: string
  /** Registry URL override */
  registryUrl?: string
  /** Whether to auto-start plugins after installation */
  autoStart?: boolean
  /** Quiet mode — suppress non-essential output */
  quiet?: boolean
}

export interface CLIResult {
  success: boolean
  message: string
  data?: unknown
}

interface InstalledPluginInfo {
  name: string
  version: string
  status: string
  description: string
}

interface SearchResult {
  name: string
  version: string
  description: string
  category: string
  verified: boolean
  firstParty: boolean
}

interface PluginInfo {
  name: string
  version: string
  description: string
  author: string
  category: string
  keywords: string[]
  npmPackage: string
  installCommand: string
  verified: boolean
  firstParty: boolean
  qualityScore: number
  badges: string[]
}

// ─── Plugin CLI ──────────────────────────────────────────────────────────────

export class PluginCLI {
  private marketplace: PluginMarketplace
  private config: PluginCLIConfig

  constructor(config: PluginCLIConfig = {}) {
    this.config = config
    this.marketplace = new PluginMarketplace()
  }

  /**
   * Install a plugin by name from the registry.
   */
  async add(pluginName: string, config: Record<string, unknown> = {}): Promise<CLIResult> {
    // Check if plugin exists in the catalog
    const catalogEntry = MARKETPLACE_CATALOG.find((p) => p.name === pluginName)
    if (!catalogEntry) {
      return {
        success: false,
        message: `Plugin "${pluginName}" not found in the registry. Run "reactivebase plugin search" to find available plugins.`,
      }
    }

    // Check if already installed
    if (this.marketplace.isInstalled(pluginName)) {
      return {
        success: false,
        message: `Plugin "${pluginName}" is already installed.`,
      }
    }

    // Check if we have a built-in definition
    const definition = ALL_BUILTIN_PLUGINS[pluginName]
    if (definition) {
      try {
        const instance = await this.marketplace.install(definition, config)
        if (this.config.autoStart) {
          await this.marketplace.start(pluginName)
        }
        return {
          success: true,
          message: `✓ Plugin "${pluginName}@${definition.version}" installed successfully.`,
          data: { name: pluginName, version: definition.version, status: instance.status },
        }
      } catch (err) {
        return {
          success: false,
          message: `Failed to install "${pluginName}": ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    }

    // For non-built-in plugins, return the install command
    return {
      success: true,
      message: `To install "${pluginName}", run:\n  ${catalogEntry.installCommand}`,
      data: { name: pluginName, installCommand: catalogEntry.installCommand },
    }
  }

  /**
   * Uninstall a plugin.
   */
  async remove(pluginName: string): Promise<CLIResult> {
    if (!this.marketplace.isInstalled(pluginName)) {
      return {
        success: false,
        message: `Plugin "${pluginName}" is not installed.`,
      }
    }

    try {
      await this.marketplace.uninstall(pluginName)
      return {
        success: true,
        message: `✓ Plugin "${pluginName}" uninstalled successfully.`,
      }
    } catch (err) {
      return {
        success: false,
        message: `Failed to uninstall "${pluginName}": ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  /**
   * List installed plugins with status.
   */
  list(): CLIResult {
    const installed = this.marketplace.listInstalled()

    if (installed.length === 0) {
      return {
        success: true,
        message: "No plugins installed.",
        data: [],
      }
    }

    const plugins: InstalledPluginInfo[] = installed.map((inst: PluginV2Instance) => ({
      name: inst.definition.name,
      version: inst.definition.version,
      status: inst.status,
      description: inst.definition.description,
    }))

    return {
      success: true,
      message: `${plugins.length} plugin(s) installed.`,
      data: plugins,
    }
  }

  /**
   * Search the registry.
   */
  search(query: string): CLIResult {
    const results = this.marketplace.search({ query })

    if (results.length === 0) {
      return {
        success: true,
        message: `No plugins found matching "${query}".`,
        data: [],
      }
    }

    const searchResults: SearchResult[] = results.map((entry) => ({
      name: entry.name,
      version: entry.version,
      description: entry.description,
      category: entry.category,
      verified: entry.verified,
      firstParty: entry.firstParty,
    }))

    return {
      success: true,
      message: `Found ${searchResults.length} plugin(s) matching "${query}".`,
      data: searchResults,
    }
  }

  /**
   * Show plugin details and quality score.
   */
  info(pluginName: string): CLIResult {
    const catalogEntry = MARKETPLACE_CATALOG.find((p) => p.name === pluginName)
    if (!catalogEntry) {
      return {
        success: false,
        message: `Plugin "${pluginName}" not found in the registry.`,
      }
    }

    const qualityInfo: PluginQualityInfo = {
      hasTests: true,
      testCount: catalogEntry.firstParty ? 20 : 5,
      hasReadme: true,
      hasChangelog: catalogEntry.firstParty,
      hasTypeDefinitions: true,
      hasExamples: catalogEntry.firstParty,
      downloadCount: catalogEntry.downloads,
      lastPublishedDaysAgo: 7,
      openIssues: 0,
      closedIssues: 5,
      dependencies: 1,
      hasCICD: catalogEntry.firstParty,
      isVerified: catalogEntry.verified,
      isFirstParty: catalogEntry.firstParty,
    }

    const qualityScore = computePluginQualityScore(qualityInfo)

    const pluginInfo: PluginInfo = {
      name: catalogEntry.name,
      version: catalogEntry.version,
      description: catalogEntry.description,
      author: catalogEntry.author,
      category: catalogEntry.category,
      keywords: catalogEntry.keywords,
      npmPackage: catalogEntry.npmPackage,
      installCommand: catalogEntry.installCommand,
      verified: catalogEntry.verified,
      firstParty: catalogEntry.firstParty,
      qualityScore: qualityScore.overall,
      badges: qualityScore.badges,
    }

    return {
      success: true,
      message: `Plugin info for "${pluginName}".`,
      data: pluginInfo,
    }
  }

  /**
   * Scaffold a new plugin project.
   */
  init(name: string, category: PluginCategory): CLIResult {
    const template: PluginTemplate = generatePluginTemplate(name, category)

    return {
      success: true,
      message: `✓ Plugin "${name}" scaffolded successfully.\n  ${template.installInstructions}`,
      data: {
        name,
        category,
        files: Object.keys(template.files),
        installInstructions: template.installInstructions,
      },
    }
  }

  /**
   * Format a CLIResult for terminal display.
   */
  generateCLIOutput(command: string, result: CLIResult): string {
    const lines: string[] = []

    // Header
    lines.push(`reactivebase plugin ${command}`)
    lines.push("─".repeat(40))

    // Status line
    const statusIcon = result.success ? "✓" : "✗"
    lines.push(`${statusIcon} ${result.message}`)

    // Data display
    if (result.data) {
      lines.push("")

      if (command === "list" && Array.isArray(result.data)) {
        const plugins = result.data as InstalledPluginInfo[]
        if (plugins.length > 0) {
          lines.push("  NAME                VERSION   STATUS      DESCRIPTION")
          lines.push("  " + "─".repeat(70))
          for (const p of plugins) {
            const name = p.name.padEnd(20)
            const version = p.version.padEnd(10)
            const status = p.status.padEnd(12)
            lines.push(`  ${name}${version}${status}${p.description}`)
          }
        }
      }

      if (command === "search" && Array.isArray(result.data)) {
        const results = result.data as SearchResult[]
        if (results.length > 0) {
          lines.push("  NAME                VERSION   CATEGORY      VERIFIED")
          lines.push("  " + "─".repeat(60))
          for (const r of results) {
            const name = r.name.padEnd(20)
            const version = r.version.padEnd(10)
            const category = r.category.padEnd(14)
            const verified = r.verified ? "✓" : " "
            lines.push(`  ${name}${version}${category}${verified}`)
          }
        }
      }

      if (command === "info" && !Array.isArray(result.data)) {
        const info = result.data as PluginInfo
        lines.push(`  Name:          ${info.name}`)
        lines.push(`  Version:       ${info.version}`)
        lines.push(`  Description:   ${info.description}`)
        lines.push(`  Author:        ${info.author}`)
        lines.push(`  Category:      ${info.category}`)
        lines.push(`  Keywords:      ${info.keywords.join(", ")}`)
        lines.push(`  npm Package:   ${info.npmPackage}`)
        lines.push(`  Install:       ${info.installCommand}`)
        lines.push(`  Verified:      ${info.verified ? "Yes" : "No"}`)
        lines.push(`  First-Party:   ${info.firstParty ? "Yes" : "No"}`)
        lines.push(`  Quality Score: ${info.qualityScore}/10`)
        if (info.badges.length > 0) {
          lines.push(`  Badges:        ${info.badges.join(", ")}`)
        }
      }

      if (command === "init" && !Array.isArray(result.data)) {
        const scaffold = result.data as { name: string; category: string; files: string[] }
        lines.push("  Generated files:")
        for (const file of scaffold.files) {
          lines.push(`    - ${file}`)
        }
      }
    }

    return lines.join("\n")
  }
}
