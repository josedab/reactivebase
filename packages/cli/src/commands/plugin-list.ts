/**
 * CLI command: `reactivebase plugin list`.
 * Lists all installed ReactiveBase plugins with their versions and status.
 *
 * Usage:
 *   reactivebase plugin list
 *   reactivebase plugin list --available
 */

import { readFileSync, existsSync } from "fs"
import { join } from "path"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PluginListOptions {
  /** Show available (not yet installed) plugins */
  available?: boolean
  projectDir?: string
}

/** Metadata for a single ReactiveBase plugin. */
export interface PluginInfo {
  /** Short plugin name (e.g. "clerk", "stripe") */
  name: string
  /** Full npm package name (e.g. "@reactivebase/plugin-clerk") */
  npmPackage: string
  /** Installed or latest available version */
  version: string
  /** Plugin category (e.g. "auth", "payments", "storage") */
  category: string
  /** Whether the plugin is installed in the current project */
  installed: boolean
  /** Human-readable plugin description */
  description: string
}

/** Result returned by the `plugin list` command. */
export interface PluginListResult {
  /** Array of discovered plugins */
  plugins: PluginInfo[]
  /** Number of currently installed plugins */
  installedCount: number
  /** Number of plugins available but not installed */
  availableCount: number
}

// ─── Available Plugin Registry ───────────────────────────────────────────────

const AVAILABLE_PLUGINS: Omit<PluginInfo, "installed" | "version">[] = [
  { name: "clerk", npmPackage: "@reactivebase/plugin-clerk", category: "auth", description: "Clerk authentication" },
  { name: "auth0", npmPackage: "@reactivebase/plugin-auth0", category: "auth", description: "Auth0 authentication" },
  { name: "stripe", npmPackage: "@reactivebase/plugin-stripe", category: "payments", description: "Stripe billing" },
  { name: "resend", npmPackage: "@reactivebase/plugin-resend", category: "email", description: "Resend email" },
  { name: "s3-storage", npmPackage: "@reactivebase/plugin-s3", category: "storage", description: "S3 file storage" },
  {
    name: "postgis",
    npmPackage: "@reactivebase/plugin-postgis",
    category: "database",
    description: "PostGIS geospatial",
  },
  {
    name: "full-text-search",
    npmPackage: "@reactivebase/plugin-fts",
    category: "database",
    description: "Full-text search",
  },
  {
    name: "rate-limiting",
    npmPackage: "@reactivebase/plugin-ratelimit",
    category: "utilities",
    description: "Rate limiting",
  },
  {
    name: "audit-logging",
    npmPackage: "@reactivebase/plugin-audit",
    category: "monitoring",
    description: "Audit trail",
  },
  {
    name: "data-seeding",
    npmPackage: "@reactivebase/plugin-seed",
    category: "utilities",
    description: "Test data generation",
  },
  {
    name: "webhooks",
    npmPackage: "@reactivebase/plugin-webhooks",
    category: "utilities",
    description: "Outbound webhooks",
  },
  {
    name: "sentry",
    npmPackage: "@reactivebase/plugin-sentry",
    category: "monitoring",
    description: "Sentry error tracking",
  },
  {
    name: "posthog",
    npmPackage: "@reactivebase/plugin-posthog",
    category: "analytics",
    description: "PostHog analytics",
  },
]

// ─── Command ─────────────────────────────────────────────────────────────────

/**
 * List installed and available plugins.
 *
 * @param options - List options
 * @returns Plugin list result
 */
export async function pluginList(options: PluginListOptions = {}): Promise<PluginListResult> {
  const projectDir = options.projectDir ?? process.cwd()

  // Read installed packages
  const installedPackages = new Set<string>()
  const installedVersions = new Map<string, string>()
  const packageJsonPath = join(projectDir, "package.json")

  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"))
      const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies }
      for (const [pkg, version] of Object.entries(allDeps)) {
        if (pkg.startsWith("@reactivebase/plugin-") || pkg.startsWith("reactivebase-plugin-")) {
          installedPackages.add(pkg)
          installedVersions.set(pkg, String(version))
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  const plugins: PluginInfo[] = AVAILABLE_PLUGINS.map((p) => ({
    ...p,
    installed: installedPackages.has(p.npmPackage),
    version: installedVersions.get(p.npmPackage) ?? "latest",
  }))

  if (!options.available) {
    // Show only installed
    const installed = plugins.filter((p) => p.installed)
    return {
      plugins: installed,
      installedCount: installed.length,
      availableCount: plugins.length - installed.length,
    }
  }

  return {
    plugins,
    installedCount: plugins.filter((p) => p.installed).length,
    availableCount: plugins.filter((p) => !p.installed).length,
  }
}
