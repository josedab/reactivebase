/**
 * CLI command: `reactivebase add <plugin>`.
 * Resolves a plugin from the registry, checks compatibility,
 * installs via npm, configures, and generates TypeScript types.
 *
 * Usage:
 *   reactivebase add @reactivebase/plugin-clerk
 *   reactivebase add @reactivebase/plugin-stripe --version 0.2.0
 *   reactivebase add @reactivebase/plugin-resend --skip-types --dry-run
 */

import { execSync } from "child_process"
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs"
import { join } from "path"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PluginAddOptions {
  version?: string
  config?: string
  skipTypes?: boolean
  dryRun?: boolean
  projectDir?: string
}

export interface PluginAddResult {
  success: boolean
  pluginName: string
  version: string
  steps: { name: string; status: "done" | "skipped" | "failed"; message: string }[]
  durationMs: number
}

// Known first-party plugins (mirrors MARKETPLACE_CATALOG in server)
const KNOWN_PLUGINS: Record<string, { npmPackage: string; version: string; category: string }> = {
  clerk: { npmPackage: "@reactivebase/plugin-clerk", version: "0.1.0", category: "auth" },
  auth0: { npmPackage: "@reactivebase/plugin-auth0", version: "0.1.0", category: "auth" },
  stripe: { npmPackage: "@reactivebase/plugin-stripe", version: "0.1.0", category: "payments" },
  paddle: { npmPackage: "@reactivebase/plugin-paddle", version: "0.1.0", category: "payments" },
  "r2-storage": { npmPackage: "@reactivebase/plugin-r2", version: "0.1.0", category: "storage" },
  resend: { npmPackage: "@reactivebase/plugin-resend", version: "0.1.0", category: "email" },
  sendgrid: { npmPackage: "@reactivebase/plugin-sendgrid", version: "0.1.0", category: "email" },
  posthog: { npmPackage: "@reactivebase/plugin-posthog", version: "0.1.0", category: "analytics" },
  sentry: { npmPackage: "@reactivebase/plugin-sentry", version: "0.1.0", category: "monitoring" },
  openai: { npmPackage: "@reactivebase/plugin-openai", version: "0.1.0", category: "ai" },
}

// ─── Plugin Add Command ──────────────────────────────────────────────────────

export class PluginAddCommand {
  private projectDir: string

  constructor(projectDir = process.cwd()) {
    this.projectDir = projectDir
  }

  /**
   * Main entry point — resolve, check compat, install, configure, generate types.
   */
  async execute(pluginName: string, options: PluginAddOptions = {}): Promise<PluginAddResult> {
    const startTime = Date.now()
    const steps: PluginAddResult["steps"] = []

    console.log(`\n  Adding plugin: ${pluginName}`)
    console.log("  " + "─".repeat(40))

    // Step 1: Resolve from registry
    console.log("  ◦ Resolving package...")
    let resolvedName = pluginName
    let resolvedVersion = options.version ?? "latest"

    try {
      const known = KNOWN_PLUGINS[pluginName]
      if (known) {
        resolvedName = known.npmPackage
        resolvedVersion = options.version ?? known.version
        steps.push({ name: "resolve", status: "done", message: `Resolved ${pluginName} → ${resolvedName}@${resolvedVersion}` })
        console.log(`  ✓ Resolved: ${resolvedName}@${resolvedVersion}`)
      } else if (pluginName.startsWith("@reactivebase/plugin-") || pluginName.startsWith("reactivebase-plugin-")) {
        // Treat as npm package name directly
        steps.push({ name: "resolve", status: "done", message: `Using npm package: ${resolvedName}@${resolvedVersion}` })
        console.log(`  ✓ Package: ${resolvedName}@${resolvedVersion}`)
      } else {
        // Try npm registry lookup
        const url = `https://registry.npmjs.org/${encodeURIComponent(pluginName)}`
        const response = await fetch(url)
        if (response.ok) {
          const data = (await response.json()) as { "dist-tags"?: { latest?: string } }
          resolvedVersion = options.version ?? data["dist-tags"]?.latest ?? "latest"
          steps.push({ name: "resolve", status: "done", message: `Found ${resolvedName}@${resolvedVersion} on npm` })
          console.log(`  ✓ Found: ${resolvedName}@${resolvedVersion}`)
        } else {
          throw new Error(`Package "${pluginName}" not found on npm`)
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      steps.push({ name: "resolve", status: "failed", message: msg })
      console.log(`  ✗ Resolution failed: ${msg}`)
      return { success: false, pluginName, version: resolvedVersion, steps, durationMs: Date.now() - startTime }
    }

    // Step 2: Check compatibility
    console.log("  ◦ Checking compatibility...")
    const firstPartyPrefixes = ["@reactivebase/plugin-", "reactivebase-plugin-"]
    const isFirstParty = firstPartyPrefixes.some((prefix) => resolvedName.startsWith(prefix))
    if (isFirstParty) {
      console.log("  ✓ First-party ReactiveBase plugin")
      steps.push({ name: "compatibility", status: "done", message: "First-party ReactiveBase plugin" })
    } else {
      console.log("  ⚠ Community plugin — not verified")
      steps.push({ name: "compatibility", status: "done", message: "Community plugin — not verified" })
    }

    // Step 3: npm install
    const dir = options.projectDir ?? this.projectDir
    if (options.dryRun) {
      console.log(`  ◦ [dry-run] Would run: npm install ${resolvedName}@${resolvedVersion}`)
      steps.push({ name: "install", status: "skipped", message: "Dry run — skipped npm install" })
    } else {
      console.log("  ◦ Installing package...")
      try {
        const versionSpec = options.version ? `${resolvedName}@${options.version}` : resolvedName
        execSync(`npm install ${versionSpec}`, { cwd: dir, stdio: "pipe" })

        // Resolve installed version
        resolvedVersion = this._resolveInstalledVersion(resolvedName, dir)
        steps.push({ name: "install", status: "done", message: `✓ Installed ${resolvedName}@${resolvedVersion}` })
        console.log(`  ✓ Installed ${resolvedName}@${resolvedVersion}`)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        steps.push({ name: "install", status: "failed", message: msg })
        console.log(`  ✗ Install failed: ${msg}`)
        return { success: false, pluginName: resolvedName, version: resolvedVersion, steps, durationMs: Date.now() - startTime }
      }
    }

    // Step 4: Configure
    if (options.config) {
      console.log("  ◦ Writing configuration...")
      try {
        const parsedConfig = JSON.parse(options.config) as Record<string, unknown>
        const configPath = this._writeConfig(resolvedName, parsedConfig, dir)
        steps.push({ name: "configure", status: "done", message: `Config written to ${configPath}` })
        console.log(`  ✓ Config: ${configPath}`)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        steps.push({ name: "configure", status: "failed", message: msg })
        console.log(`  ✗ Configuration failed: ${msg}`)
      }
    } else {
      steps.push({ name: "configure", status: "skipped", message: "No config provided" })
    }

    // Step 5: Generate types
    if (options.skipTypes || options.dryRun) {
      steps.push({ name: "types", status: "skipped", message: options.dryRun ? "Dry run" : "Skipped via --skip-types" })
      if (!options.dryRun) console.log("  ◦ Type generation skipped")
    } else {
      console.log("  ◦ Generating types...")
      try {
        const typesPath = this._generateTypes(resolvedName, dir)
        steps.push({ name: "types", status: "done", message: `Types written to ${typesPath}` })
        console.log(`  ✓ Types: ${typesPath}`)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        steps.push({ name: "types", status: "failed", message: msg })
        console.log(`  ✗ Type generation failed: ${msg}`)
      }
    }

    // Summary
    const success = steps.every((s) => s.status !== "failed")
    const durationMs = Date.now() - startTime

    console.log("")
    if (success) {
      console.log(`  ✓ Plugin ${resolvedName}@${resolvedVersion} added successfully (${durationMs}ms)`)
    } else {
      console.log(`  ✗ Plugin add completed with errors (${durationMs}ms)`)
    }
    console.log("")

    return { success, pluginName: resolvedName, version: resolvedVersion, steps, durationMs }
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private _resolveInstalledVersion(name: string, projectDir: string): string {
    try {
      const pkgPath = join(projectDir, "node_modules", name, "package.json")
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string }
      return pkg.version
    } catch {
      return "unknown"
    }
  }

  private _writeConfig(name: string, config: Record<string, unknown>, projectDir: string): string {
    const configDir = join(projectDir, ".reactivebase", "plugins")
    mkdirSync(configDir, { recursive: true })

    const safeName = name.replace(/[@/]/g, "-").replace(/^-/, "")
    const configPath = join(configDir, `${safeName}.json`)
    writeFileSync(configPath, JSON.stringify({ plugin: name, config }, null, 2), "utf-8")
    return configPath
  }

  private _generateTypes(name: string, projectDir: string): string {
    const typesDir = join(projectDir, ".reactivebase", "types")
    mkdirSync(typesDir, { recursive: true })

    const safeName = name.replace(/[@/]/g, "-").replace(/^-/, "")
    const typesPath = join(typesDir, `${safeName}.d.ts`)

    const content = [
      `// Auto-generated types for ${name}`,
      `// Do not edit manually — regenerate with: reactivebase add ${name}`,
      "",
      `declare module "${name}" {`,
      `  export interface PluginConfig {`,
      `    [key: string]: unknown`,
      `  }`,
      ``,
      `  export function register(config: PluginConfig): void`,
      `}`,
      "",
    ].join("\n")

    writeFileSync(typesPath, content, "utf-8")
    return typesPath
  }
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

export async function pluginAdd(args: string[]): Promise<void> {
  const pluginName = args[0]
  if (!pluginName) {
    console.error("Usage: reactivebase add <plugin> [--version X] [--config JSON] [--skip-types] [--dry-run]")
    process.exit(1)
  }

  const options: PluginAddOptions = {
    version: getAddFlag(args, "--version"),
    config: getAddFlag(args, "--config"),
    skipTypes: args.includes("--skip-types"),
    dryRun: args.includes("--dry-run"),
    projectDir: process.cwd(),
  }

  const command = new PluginAddCommand(options.projectDir)
  const result = await command.execute(pluginName, options)

  if (!result.success) {
    process.exit(1)
  }
}

function getAddFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1]
  }
  return undefined
}
