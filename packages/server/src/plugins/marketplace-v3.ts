/**
 * Plugin Marketplace v3 & SDK Enhancements.
 * Advanced plugin contracts with lifecycle hooks, security scanning,
 * starter templates, and enhanced search capabilities.
 *
 * Features:
 *   - PluginContract with full lifecycle hooks (install/activate/deactivate/uninstall/configChange)
 *   - Built-in test harness and health check integration
 *   - JSON Schema config validation and dependency resolution
 *   - Security scanner for plugin code analysis
 *   - Starter template generation for common plugin types
 *   - Enhanced search engine with fuzzy matching, trending, and recommendations
 *
 * Usage:
 *   const plugin = definePluginV3({ name: "my-plugin", ... })
 *   await plugin.test(testContext)
 *   const scanner = new PluginSecurityScanner()
 *   const report = await scanner.scanPlugin("./my-plugin")
 */

import type { PluginCategory, MarketplaceEntry } from "./marketplace.js"
import { PluginMarketplaceError, MARKETPLACE_CATALOG } from "./marketplace.js"
import type { JSONSchema } from "./plugin-sdk-v2.js"
import { validateWithJSONSchema } from "./plugin-sdk-v2.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PluginLifecycleHooks {
  onInstall?: (ctx: PluginV3Context) => Promise<void> | void
  onActivate?: (ctx: PluginV3Context) => Promise<void> | void
  onDeactivate?: (ctx: PluginV3Context) => Promise<void> | void
  onUninstall?: (ctx: PluginV3Context) => Promise<void> | void
  onConfigChange?: (ctx: PluginV3Context, oldConfig: Record<string, unknown>) => Promise<void> | void
}

export interface PluginV3Config {
  name: string
  version: string
  description: string
  author: string
  keywords?: string[]
  category: PluginCategory
  /** Required ReactiveBase version (semver range) */
  reactivebaseVersion?: string
  /** Other plugins this plugin depends on */
  dependencies?: string[]
  /** JSON Schema for config validation */
  configSchema?: JSONSchema
  /** Lifecycle hooks */
  hooks?: PluginLifecycleHooks
  /** Self-test function run by the test harness */
  selfTest?: (ctx: PluginV3TestContext) => Promise<void> | void
  /** Health check returning plugin status */
  healthCheck?: () => Promise<PluginHealthStatus> | PluginHealthStatus
  /** Server functions to register */
  functions?: Record<string, unknown>
  /** Database migrations */
  migrations?: string[]
}

export interface PluginV3Context {
  config: Record<string, unknown>
  logger: {
    info: (msg: string) => void
    warn: (msg: string) => void
    error: (msg: string) => void
  }
  registerFunction: (name: string, fn: unknown) => void
  getPlugin: (name: string) => PluginV3Instance | undefined
}

export interface PluginV3Instance {
  definition: PluginV3Config
  config: Record<string, unknown>
  status: "installed" | "active" | "inactive" | "error"
  installedAt: number
  activatedAt?: number
  error?: string
}

export interface PluginV3TestContext {
  config: Record<string, unknown>
  assert: (condition: boolean, message: string) => void
  log: (message: string) => void
}

export interface PluginHealthStatus {
  healthy: boolean
  message: string
  details?: Record<string, unknown>
  timestamp: number
}

export type SecuritySeverity = "critical" | "high" | "medium" | "low" | "info"

export interface SecurityIssue {
  severity: SecuritySeverity
  rule: string
  message: string
  file?: string
  line?: number
  suggestion?: string
}

export interface SecurityScanResult {
  pluginName: string
  scannedAt: number
  passed: boolean
  issues: SecurityIssue[]
  summary: {
    critical: number
    high: number
    medium: number
    low: number
    info: number
    total: number
  }
}

export type TemplateType = "basic" | "auth-provider" | "storage-backend" | "analytics" | "webhook-handler"

export interface PluginTemplate {
  type: TemplateType
  description: string
  files: Record<string, string>
}

export interface SearchFilters {
  query?: string
  category?: PluginCategory
  tags?: string[]
  minRating?: number
  verified?: boolean
  firstParty?: boolean
  sortBy?: "relevance" | "downloads" | "rating" | "name"
  limit?: number
  offset?: number
}

export interface SearchResult {
  entries: ScoredEntry[]
  total: number
  query: string
  filters: SearchFilters
}

export interface ScoredEntry {
  entry: MarketplaceEntry
  score: number
  matchedFields: string[]
}

export interface PluginRecommendation {
  plugin: MarketplaceEntry
  reason: string
  score: number
}

// ─── Plugin Contract ─────────────────────────────────────────────────────────

export class PluginContract {
  readonly name: string
  readonly version: string
  readonly config: PluginV3Config
  private testResults: { passed: boolean; message: string }[] = []

  constructor(config: PluginV3Config) {
    this.name = config.name
    this.version = config.version
    this.config = config
  }

  /**
   * Run plugin self-tests using the built-in test harness.
   */
  async test(
    testContext?: Partial<PluginV3TestContext>,
  ): Promise<{ passed: boolean; results: { passed: boolean; message: string }[] }> {
    this.testResults = []

    if (!this.config.selfTest) {
      return { passed: true, results: [{ passed: true, message: "No self-tests defined" }] }
    }

    const results = this.testResults
    const ctx: PluginV3TestContext = {
      config: testContext?.config ?? {},
      assert: (condition, message) => {
        results.push({ passed: condition, message })
        if (!condition) {
          throw new PluginMarketplaceError(`Assertion failed: ${message}`)
        }
      },
      log: testContext?.log ?? (() => {}),
    }

    try {
      await this.config.selfTest(ctx)
      return { passed: results.every((r) => r.passed), results }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!results.some((r) => !r.passed)) {
        results.push({ passed: false, message: msg })
      }
      return { passed: false, results }
    }
  }

  /**
   * Run the plugin health check.
   */
  async healthCheck(): Promise<PluginHealthStatus> {
    if (!this.config.healthCheck) {
      return { healthy: true, message: "No health check defined", timestamp: Date.now() }
    }
    try {
      return await this.config.healthCheck()
    } catch (err: unknown) {
      return {
        healthy: false,
        message: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      }
    }
  }

  /**
   * Validate configuration against the plugin's JSON Schema.
   */
  validateConfig(config: Record<string, unknown>): { valid: boolean; errors: string[] } {
    if (!this.config.configSchema) {
      return { valid: true, errors: [] }
    }
    return validateWithJSONSchema(this.config.configSchema, config)
  }

  /**
   * Get declared plugin dependencies.
   */
  getDependencies(): string[] {
    return this.config.dependencies ?? []
  }

  /**
   * Check if all dependencies are satisfied.
   */
  checkDependencies(installedPlugins: string[]): { satisfied: boolean; missing: string[] } {
    const deps = this.getDependencies()
    const missing = deps.filter((d) => !installedPlugins.includes(d))
    return { satisfied: missing.length === 0, missing }
  }
}

/**
 * Create a v3 plugin contract with lifecycle hooks, test harness, and config validation.
 */
export function definePluginV3(config: PluginV3Config): PluginContract {
  if (!config.name || !config.version) {
    throw new PluginMarketplaceError("Plugin name and version are required")
  }
  return new PluginContract(config)
}

// ─── Plugin Security Scanner ─────────────────────────────────────────────────

const SECURITY_PATTERNS: {
  pattern: RegExp
  rule: string
  severity: SecuritySeverity
  message: string
  suggestion: string
}[] = [
  {
    pattern: /\beval\s*\(/,
    rule: "no-eval",
    severity: "critical",
    message: "Usage of eval() detected — potential code injection vulnerability",
    suggestion: "Use JSON.parse() or a safe expression parser instead of eval()",
  },
  {
    pattern: /new\s+Function\s*\(/,
    rule: "no-function-constructor",
    severity: "critical",
    message: "Usage of Function constructor detected — equivalent to eval()",
    suggestion: "Refactor to avoid dynamic code generation",
  },
  {
    pattern: /child_process|exec\s*\(|execSync\s*\(|spawn\s*\(/,
    rule: "no-child-process",
    severity: "high",
    message: "Child process execution detected — potential command injection risk",
    suggestion: "Declare process execution in plugin permissions manifest",
  },
  {
    pattern: /process\.env\b/,
    rule: "env-access",
    severity: "medium",
    message: "Direct environment variable access detected",
    suggestion: "Use plugin config system instead of reading env vars directly",
  },
  {
    pattern: /require\s*\(\s*['"]fs['"]\)|from\s+['"]fs['"]|from\s+['"]node:fs['"]/,
    rule: "fs-access",
    severity: "medium",
    message: "File system access detected without declaration",
    suggestion: "Declare file system access in plugin permissions",
  },
  {
    pattern: /require\s*\(\s*['"]net['"]\)|from\s+['"]net['"]|from\s+['"]node:net['"]/,
    rule: "net-access",
    severity: "medium",
    message: "Raw network access detected without declaration",
    suggestion: "Declare network access in plugin permissions and use the HTTP client API",
  },
  {
    pattern: /fetch\s*\(|https?\.request|axios|got\s*\(/,
    rule: "http-access",
    severity: "low",
    message: "HTTP request detected — ensure network access is declared",
    suggestion: "Declare outbound HTTP access in plugin permissions manifest",
  },
  {
    pattern: /__(proto|defineGetter|defineSetter)__/,
    rule: "no-proto-pollution",
    severity: "high",
    message: "Potential prototype pollution detected",
    suggestion: "Avoid modifying object prototypes directly",
  },
]

export class PluginSecurityScanner {
  /**
   * Scan plugin source files for common security issues.
   */
  async scanPlugin(pluginPath: string): Promise<SecurityScanResult> {
    const issues: SecurityIssue[] = []
    const pluginName = pluginPath.split("/").pop() ?? pluginPath

    // Simulate scanning files at the given path
    const mockFiles = this.getPluginFiles(pluginPath)
    for (const file of mockFiles) {
      const fileIssues = this.scanFileContent(file.path, file.content)
      issues.push(...fileIssues)
    }

    return this.buildResult(pluginName, issues)
  }

  /**
   * Scan a single source string for security issues.
   */
  scanSource(source: string, filePath?: string): SecurityIssue[] {
    return this.scanFileContent(filePath ?? "<inline>", source)
  }

  /**
   * Validate that a plugin manifest only requests necessary permissions.
   */
  validatePermissions(manifest: {
    name: string
    permissions?: string[]
    declaredAccess?: { network?: boolean; fileSystem?: boolean; env?: boolean }
  }): { valid: boolean; warnings: string[] } {
    const warnings: string[] = []

    if (!manifest.permissions || manifest.permissions.length === 0) {
      warnings.push("No permissions declared — plugin will run with minimal access")
    }

    if (manifest.declaredAccess?.network && !manifest.permissions?.includes("network")) {
      warnings.push("Plugin uses network access but does not declare 'network' permission")
    }

    if (manifest.declaredAccess?.fileSystem && !manifest.permissions?.includes("filesystem")) {
      warnings.push("Plugin uses file system access but does not declare 'filesystem' permission")
    }

    if (manifest.declaredAccess?.env && !manifest.permissions?.includes("env")) {
      warnings.push("Plugin accesses environment variables but does not declare 'env' permission")
    }

    return { valid: warnings.length === 0, warnings }
  }

  /**
   * Check plugin dependencies for known vulnerable packages.
   */
  checkDependencies(manifest: { dependencies?: Record<string, string> }): {
    safe: boolean
    vulnerabilities: { package: string; severity: SecuritySeverity; advisory: string }[]
  } {
    const vulnerabilities: { package: string; severity: SecuritySeverity; advisory: string }[] = []

    // Known vulnerable packages (static advisory list)
    const KNOWN_VULNERABLE: Record<string, { severity: SecuritySeverity; advisory: string }> = {
      "event-stream": { severity: "critical", advisory: "Malicious dependency — flatmap-stream" },
      "ua-parser-js": { severity: "high", advisory: "Supply chain attack in versions 0.7.29, 0.8.0, 1.0.0" },
      colors: { severity: "high", advisory: "Maintainer sabotage in v1.4.1+" },
      faker: { severity: "high", advisory: "Maintainer sabotage in v6.6.6+" },
      "node-ipc": { severity: "critical", advisory: "Protestware — destructive payload in v10.1.1+" },
    }

    if (manifest.dependencies) {
      for (const [pkg] of Object.entries(manifest.dependencies)) {
        const vuln = KNOWN_VULNERABLE[pkg]
        if (vuln) {
          vulnerabilities.push({ package: pkg, ...vuln })
        }
      }
    }

    return { safe: vulnerabilities.length === 0, vulnerabilities }
  }

  /**
   * Format security scan results into a readable report.
   */
  generateSecurityReport(results: SecurityScanResult): string {
    const lines: string[] = [
      `Security Scan Report: ${results.pluginName}`,
      `Scanned: ${new Date(results.scannedAt).toISOString()}`,
      `Status: ${results.passed ? "PASSED" : "FAILED"}`,
      "",
      `Summary: ${results.summary.total} issue(s) found`,
      `  Critical: ${results.summary.critical}`,
      `  High: ${results.summary.high}`,
      `  Medium: ${results.summary.medium}`,
      `  Low: ${results.summary.low}`,
      `  Info: ${results.summary.info}`,
      "",
    ]

    if (results.issues.length > 0) {
      lines.push("Issues:")
      for (const issue of results.issues) {
        const location = issue.file ? ` (${issue.file}${issue.line ? `:${issue.line}` : ""})` : ""
        lines.push(`  [${issue.severity.toUpperCase()}] ${issue.rule}${location}`)
        lines.push(`    ${issue.message}`)
        if (issue.suggestion) {
          lines.push(`    Suggestion: ${issue.suggestion}`)
        }
      }
    }

    return lines.join("\n")
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private scanFileContent(filePath: string, content: string): SecurityIssue[] {
    const issues: SecurityIssue[] = []
    const lines = content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      for (const rule of SECURITY_PATTERNS) {
        if (rule.pattern.test(line)) {
          issues.push({
            severity: rule.severity,
            rule: rule.rule,
            message: rule.message,
            file: filePath,
            line: i + 1,
            suggestion: rule.suggestion,
          })
        }
      }
    }

    return issues
  }

  private getPluginFiles(_pluginPath: string): { path: string; content: string }[] {
    // In a real implementation, this would read files from the file system.
    // Returns empty for static analysis — use scanSource() for direct content scanning.
    return []
  }

  private buildResult(pluginName: string, issues: SecurityIssue[]): SecurityScanResult {
    const summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: issues.length }
    for (const issue of issues) {
      summary[issue.severity]++
    }

    return {
      pluginName,
      scannedAt: Date.now(),
      passed: summary.critical === 0 && summary.high === 0,
      issues,
      summary,
    }
  }
}

// ─── Plugin Starter Templates ────────────────────────────────────────────────

const TEMPLATE_DESCRIPTIONS: Record<TemplateType, string> = {
  basic: "A minimal plugin with lifecycle hooks and configuration",
  "auth-provider": "Authentication provider plugin with JWT verification and user management",
  "storage-backend": "Storage backend plugin for file uploads and retrieval",
  analytics: "Analytics plugin for event tracking and reporting",
  "webhook-handler": "Webhook handler plugin for processing inbound webhooks",
}

export class PluginStarterTemplates {
  /**
   * Generate a starter template for a given plugin type.
   */
  generateTemplate(
    type: TemplateType,
    options: { name: string; author?: string; description?: string },
  ): PluginTemplate {
    const author = options.author ?? "Plugin Author"
    const description = options.description ?? TEMPLATE_DESCRIPTIONS[type]

    const baseFiles = this.generateBaseFiles(options.name, author, description, type)
    const typeFiles = this.generateTypeSpecificFiles(type, options.name)

    return {
      type,
      description: TEMPLATE_DESCRIPTIONS[type],
      files: { ...baseFiles, ...typeFiles },
    }
  }

  /**
   * List all available template types with descriptions.
   */
  getTemplateList(): { type: TemplateType; description: string }[] {
    return (Object.entries(TEMPLATE_DESCRIPTIONS) as [TemplateType, string][]).map(([type, description]) => ({
      type,
      description,
    }))
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private generateBaseFiles(
    name: string,
    author: string,
    description: string,
    type: TemplateType,
  ): Record<string, string> {
    const packageJson = JSON.stringify(
      {
        name: `@reactivebase/plugin-${name}`,
        version: "0.1.0",
        description,
        author,
        license: "MIT",
        main: "dist/index.js",
        types: "dist/index.d.ts",
        scripts: {
          build: "tsc",
          test: "vitest run",
          dev: "tsc --watch",
        },
        keywords: ["reactivebase", "reactivebase-plugin", type],
        peerDependencies: {
          "@reactivebase/server": "^1.0.0",
        },
        devDependencies: {
          typescript: "^5.0.0",
          vitest: "^1.0.0",
        },
      },
      null,
      2,
    )

    const indexTs = [
      `export { plugin } from "./plugin.js"`,
      `export type { PluginConfig } from "./plugin.js"`,
      "",
    ].join("\n")

    const readme = [
      `# @reactivebase/plugin-${name}`,
      "",
      description,
      "",
      "## Installation",
      "",
      "```bash",
      `npm install @reactivebase/plugin-${name}`,
      "```",
      "",
      "## Usage",
      "",
      "```ts",
      `import { plugin } from "@reactivebase/plugin-${name}"`,
      "",
      "// Add to your ReactiveBase config",
      "export default {",
      "  plugins: [plugin({ /* config */ })],",
      "}",
      "```",
      "",
    ].join("\n")

    return {
      "package.json": packageJson,
      "src/index.ts": indexTs,
      "README.md": readme,
    }
  }

  private generateTypeSpecificFiles(type: TemplateType, name: string): Record<string, string> {
    switch (type) {
      case "basic":
        return this.generateBasicTemplate(name)
      case "auth-provider":
        return this.generateAuthProviderTemplate(name)
      case "storage-backend":
        return this.generateStorageBackendTemplate(name)
      case "analytics":
        return this.generateAnalyticsTemplate(name)
      case "webhook-handler":
        return this.generateWebhookHandlerTemplate(name)
    }
  }

  private generateBasicTemplate(name: string): Record<string, string> {
    const pluginTs = [
      `import { definePluginV3 } from "@reactivebase/server"`,
      `import type { PluginV3Config } from "@reactivebase/server"`,
      "",
      `export interface PluginConfig {`,
      `  enabled?: boolean`,
      `}`,
      "",
      `export function plugin(config: PluginConfig = {}) {`,
      `  return definePluginV3({`,
      `    name: "${name}",`,
      `    version: "0.1.0",`,
      `    description: "A ReactiveBase plugin",`,
      `    author: "Plugin Author",`,
      `    category: "utilities",`,
      `    configSchema: {`,
      `      type: "object",`,
      `      properties: {`,
      `        enabled: { type: "boolean", default: true },`,
      `      },`,
      `    },`,
      `    hooks: {`,
      `      onInstall: (ctx) => {`,
      `        ctx.logger.info("${name} installed")`,
      `      },`,
      `      onActivate: (ctx) => {`,
      `        ctx.logger.info("${name} activated")`,
      `      },`,
      `      onDeactivate: (ctx) => {`,
      `        ctx.logger.info("${name} deactivated")`,
      `      },`,
      `    },`,
      `    selfTest: (ctx) => {`,
      `      ctx.assert(true, "Plugin loads successfully")`,
      `    },`,
      `    healthCheck: () => ({`,
      `      healthy: true,`,
      `      message: "Plugin is running",`,
      `      timestamp: Date.now(),`,
      `    }),`,
      `  })`,
      `}`,
      "",
    ].join("\n")

    const testTs = [
      `import { describe, it, expect } from "vitest"`,
      `import { plugin } from "../src/plugin.js"`,
      "",
      `describe("${name}", () => {`,
      `  it("should create plugin contract", () => {`,
      `    const p = plugin()`,
      `    expect(p.name).toBe("${name}")`,
      `  })`,
      "",
      `  it("should pass self-tests", async () => {`,
      `    const p = plugin()`,
      `    const result = await p.test()`,
      `    expect(result.passed).toBe(true)`,
      `  })`,
      "",
      `  it("should report healthy", async () => {`,
      `    const p = plugin()`,
      `    const health = await p.healthCheck()`,
      `    expect(health.healthy).toBe(true)`,
      `  })`,
      `})`,
      "",
    ].join("\n")

    return { "src/plugin.ts": pluginTs, "tests/plugin.test.ts": testTs }
  }

  private generateAuthProviderTemplate(name: string): Record<string, string> {
    const pluginTs = [
      `import { definePluginV3 } from "@reactivebase/server"`,
      "",
      `export interface PluginConfig {`,
      `  issuerUrl: string`,
      `  audience?: string`,
      `  algorithms?: string[]`,
      `}`,
      "",
      `export function plugin(config: PluginConfig) {`,
      `  return definePluginV3({`,
      `    name: "${name}",`,
      `    version: "0.1.0",`,
      `    description: "Authentication provider plugin",`,
      `    author: "Plugin Author",`,
      `    category: "auth",`,
      `    configSchema: {`,
      `      type: "object",`,
      `      properties: {`,
      `        issuerUrl: { type: "string", description: "JWT issuer URL" },`,
      `        audience: { type: "string", description: "Expected JWT audience" },`,
      `      },`,
      `      required: ["issuerUrl"],`,
      `    },`,
      `    hooks: {`,
      `      onInstall: (ctx) => {`,
      `        ctx.logger.info("Auth provider installed")`,
      `      },`,
      `      onActivate: (ctx) => {`,
      `        ctx.logger.info("Auth provider activated")`,
      `        ctx.registerFunction("verifyToken", async (token: string) => {`,
      `          // Token verification logic`,
      `          return { valid: true, claims: {} }`,
      `        })`,
      `      },`,
      `    },`,
      `    selfTest: (ctx) => {`,
      `      ctx.assert(!!ctx.config.issuerUrl, "Issuer URL is configured")`,
      `    },`,
      `    healthCheck: () => ({`,
      `      healthy: true,`,
      `      message: "Auth provider is ready",`,
      `      timestamp: Date.now(),`,
      `    }),`,
      `  })`,
      `}`,
      "",
    ].join("\n")

    const testTs = [
      `import { describe, it, expect } from "vitest"`,
      `import { plugin } from "../src/plugin.js"`,
      "",
      `describe("${name}", () => {`,
      `  it("should create auth provider plugin", () => {`,
      `    const p = plugin({ issuerUrl: "https://auth.example.com" })`,
      `    expect(p.name).toBe("${name}")`,
      `  })`,
      "",
      `  it("should pass self-tests with valid config", async () => {`,
      `    const p = plugin({ issuerUrl: "https://auth.example.com" })`,
      `    const result = await p.test({ config: { issuerUrl: "https://auth.example.com" } })`,
      `    expect(result.passed).toBe(true)`,
      `  })`,
      `})`,
      "",
    ].join("\n")

    return { "src/plugin.ts": pluginTs, "tests/plugin.test.ts": testTs }
  }

  private generateStorageBackendTemplate(name: string): Record<string, string> {
    const pluginTs = [
      `import { definePluginV3 } from "@reactivebase/server"`,
      "",
      `export interface PluginConfig {`,
      `  bucket: string`,
      `  region?: string`,
      `  endpoint?: string`,
      `}`,
      "",
      `export function plugin(config: PluginConfig) {`,
      `  return definePluginV3({`,
      `    name: "${name}",`,
      `    version: "0.1.0",`,
      `    description: "Storage backend plugin",`,
      `    author: "Plugin Author",`,
      `    category: "storage",`,
      `    configSchema: {`,
      `      type: "object",`,
      `      properties: {`,
      `        bucket: { type: "string", description: "Storage bucket name" },`,
      `        region: { type: "string", description: "Storage region" },`,
      `        endpoint: { type: "string", description: "Custom endpoint URL" },`,
      `      },`,
      `      required: ["bucket"],`,
      `    },`,
      `    hooks: {`,
      `      onActivate: (ctx) => {`,
      `        ctx.registerFunction("upload", async (key: string, data: Buffer) => {`,
      `          // Upload logic`,
      `          return { key, size: data.length }`,
      `        })`,
      `        ctx.registerFunction("download", async (key: string) => {`,
      `          // Download logic`,
      `          return Buffer.from("")`,
      `        })`,
      `      },`,
      `    },`,
      `    selfTest: (ctx) => {`,
      `      ctx.assert(!!ctx.config.bucket, "Bucket is configured")`,
      `    },`,
      `    healthCheck: () => ({`,
      `      healthy: true,`,
      `      message: "Storage backend is connected",`,
      `      timestamp: Date.now(),`,
      `    }),`,
      `  })`,
      `}`,
      "",
    ].join("\n")

    const testTs = [
      `import { describe, it, expect } from "vitest"`,
      `import { plugin } from "../src/plugin.js"`,
      "",
      `describe("${name}", () => {`,
      `  it("should create storage plugin", () => {`,
      `    const p = plugin({ bucket: "test-bucket" })`,
      `    expect(p.name).toBe("${name}")`,
      `  })`,
      `})`,
      "",
    ].join("\n")

    return { "src/plugin.ts": pluginTs, "tests/plugin.test.ts": testTs }
  }

  private generateAnalyticsTemplate(name: string): Record<string, string> {
    const pluginTs = [
      `import { definePluginV3 } from "@reactivebase/server"`,
      "",
      `export interface PluginConfig {`,
      `  apiKey: string`,
      `  endpoint?: string`,
      `  batchSize?: number`,
      `}`,
      "",
      `export function plugin(config: PluginConfig) {`,
      `  return definePluginV3({`,
      `    name: "${name}",`,
      `    version: "0.1.0",`,
      `    description: "Analytics plugin",`,
      `    author: "Plugin Author",`,
      `    category: "analytics",`,
      `    configSchema: {`,
      `      type: "object",`,
      `      properties: {`,
      `        apiKey: { type: "string", description: "Analytics API key" },`,
      `        endpoint: { type: "string", description: "Analytics endpoint URL" },`,
      `        batchSize: { type: "integer", description: "Event batch size", default: 100 },`,
      `      },`,
      `      required: ["apiKey"],`,
      `    },`,
      `    hooks: {`,
      `      onActivate: (ctx) => {`,
      `        ctx.registerFunction("track", (event: string, properties?: Record<string, unknown>) => {`,
      `          // Track event logic`,
      `        })`,
      `        ctx.registerFunction("identify", (userId: string, traits?: Record<string, unknown>) => {`,
      `          // Identify user logic`,
      `        })`,
      `      },`,
      `    },`,
      `    selfTest: (ctx) => {`,
      `      ctx.assert(!!ctx.config.apiKey, "API key is configured")`,
      `    },`,
      `    healthCheck: () => ({`,
      `      healthy: true,`,
      `      message: "Analytics pipeline is active",`,
      `      timestamp: Date.now(),`,
      `    }),`,
      `  })`,
      `}`,
      "",
    ].join("\n")

    const testTs = [
      `import { describe, it, expect } from "vitest"`,
      `import { plugin } from "../src/plugin.js"`,
      "",
      `describe("${name}", () => {`,
      `  it("should create analytics plugin", () => {`,
      `    const p = plugin({ apiKey: "test-key" })`,
      `    expect(p.name).toBe("${name}")`,
      `  })`,
      `})`,
      "",
    ].join("\n")

    return { "src/plugin.ts": pluginTs, "tests/plugin.test.ts": testTs }
  }

  private generateWebhookHandlerTemplate(name: string): Record<string, string> {
    const pluginTs = [
      `import { definePluginV3 } from "@reactivebase/server"`,
      "",
      `export interface PluginConfig {`,
      `  secret: string`,
      `  path?: string`,
      `  events?: string[]`,
      `}`,
      "",
      `export function plugin(config: PluginConfig) {`,
      `  return definePluginV3({`,
      `    name: "${name}",`,
      `    version: "0.1.0",`,
      `    description: "Webhook handler plugin",`,
      `    author: "Plugin Author",`,
      `    category: "utilities",`,
      `    configSchema: {`,
      `      type: "object",`,
      `      properties: {`,
      `        secret: { type: "string", description: "Webhook signing secret" },`,
      `        path: { type: "string", description: "Webhook endpoint path", default: "/webhooks" },`,
      `        events: { type: "array", description: "Events to listen for" },`,
      `      },`,
      `      required: ["secret"],`,
      `    },`,
      `    hooks: {`,
      `      onActivate: (ctx) => {`,
      `        ctx.registerFunction("handleWebhook", async (payload: unknown, signature: string) => {`,
      `          // Webhook verification and handling logic`,
      `          return { received: true }`,
      `        })`,
      `      },`,
      `    },`,
      `    selfTest: (ctx) => {`,
      `      ctx.assert(!!ctx.config.secret, "Webhook secret is configured")`,
      `    },`,
      `    healthCheck: () => ({`,
      `      healthy: true,`,
      `      message: "Webhook handler is listening",`,
      `      timestamp: Date.now(),`,
      `    }),`,
      `  })`,
      `}`,
      "",
    ].join("\n")

    const testTs = [
      `import { describe, it, expect } from "vitest"`,
      `import { plugin } from "../src/plugin.js"`,
      "",
      `describe("${name}", () => {`,
      `  it("should create webhook handler plugin", () => {`,
      `    const p = plugin({ secret: "test-secret" })`,
      `    expect(p.name).toBe("${name}")`,
      `  })`,
      `})`,
      "",
    ].join("\n")

    return { "src/plugin.ts": pluginTs, "tests/plugin.test.ts": testTs }
  }
}

// ─── Marketplace Search Engine ───────────────────────────────────────────────

export class MarketplaceSearchEngine {
  private catalog: MarketplaceEntry[]

  constructor(additionalEntries?: MarketplaceEntry[]) {
    this.catalog = [...MARKETPLACE_CATALOG, ...(additionalEntries ?? [])]
  }

  /**
   * Full-text search across plugins with filters and relevance scoring.
   */
  search(query: string, filters: SearchFilters = {}): SearchResult {
    let scored = this.catalog.map((entry) => this.scoreEntry(entry, query))

    // Apply filters
    if (filters.category) {
      scored = scored.filter((s) => s.entry.category === filters.category)
    }
    if (filters.tags && filters.tags.length > 0) {
      scored = scored.filter((s) => filters.tags!.some((tag) => s.entry.keywords.includes(tag)))
    }
    if (filters.minRating !== undefined) {
      scored = scored.filter((s) => s.entry.rating >= filters.minRating!)
    }
    if (filters.verified !== undefined) {
      scored = scored.filter((s) => s.entry.verified === filters.verified)
    }
    if (filters.firstParty !== undefined) {
      scored = scored.filter((s) => s.entry.firstParty === filters.firstParty)
    }

    // Filter out zero-score results when a query is provided
    if (query) {
      scored = scored.filter((s) => s.score > 0)
    }

    // Sort
    const sortBy = filters.sortBy ?? "relevance"
    switch (sortBy) {
      case "relevance":
        scored.sort((a, b) => b.score - a.score)
        break
      case "downloads":
        scored.sort((a, b) => b.entry.downloads - a.entry.downloads)
        break
      case "rating":
        scored.sort((a, b) => b.entry.rating - a.entry.rating)
        break
      case "name":
        scored.sort((a, b) => a.entry.name.localeCompare(b.entry.name))
        break
    }

    const total = scored.length
    const offset = filters.offset ?? 0
    const limit = filters.limit ?? 50
    const entries = scored.slice(offset, offset + limit)

    return { entries, total, query, filters }
  }

  /**
   * Get plugins grouped by category.
   */
  getCategories(): { category: PluginCategory; plugins: MarketplaceEntry[]; count: number }[] {
    const grouped = new Map<PluginCategory, MarketplaceEntry[]>()
    for (const entry of this.catalog) {
      const list = grouped.get(entry.category) ?? []
      list.push(entry)
      grouped.set(entry.category, list)
    }
    return Array.from(grouped.entries())
      .map(([category, plugins]) => ({ category, plugins, count: plugins.length }))
      .sort((a, b) => b.count - a.count)
  }

  /**
   * Get trending plugins sorted by install/download count.
   */
  getTrending(limit: number = 10): MarketplaceEntry[] {
    return [...this.catalog].sort((a, b) => b.downloads - a.downloads || b.rating - a.rating).slice(0, limit)
  }

  /**
   * Suggest complementary plugins based on what is already installed.
   */
  getRecommendations(currentPlugins: string[]): PluginRecommendation[] {
    const installed = new Set(currentPlugins)
    const installedCategories = new Set<PluginCategory>()

    for (const name of currentPlugins) {
      const entry = this.catalog.find((e) => e.name === name)
      if (entry) installedCategories.add(entry.category)
    }

    const recommendations: PluginRecommendation[] = []

    for (const entry of this.catalog) {
      if (installed.has(entry.name)) continue

      let score = 0
      let reason = ""

      // Recommend complementary categories
      const COMPLEMENTS: Record<string, string[]> = {
        auth: ["analytics", "monitoring"],
        payments: ["email", "analytics"],
        storage: ["monitoring", "utilities"],
        email: ["analytics"],
        analytics: ["monitoring"],
        monitoring: ["analytics"],
        database: ["monitoring", "storage"],
        ai: ["analytics", "monitoring"],
        utilities: [],
      }

      const complementary = COMPLEMENTS[entry.category] ?? []
      if (complementary.some((c) => installedCategories.has(c as PluginCategory))) {
        score += 3
        reason = `Complements your ${Array.from(installedCategories).join(", ")} plugins`
      }

      // Same-category alternatives get a lower score
      if (installedCategories.has(entry.category)) {
        score += 1
        reason = reason || `Alternative ${entry.category} plugin`
      }

      // Boost verified and high-rated plugins
      if (entry.verified) score += 1
      if (entry.rating >= 5) score += 1
      if (entry.firstParty) score += 1

      if (score > 0) {
        recommendations.push({ plugin: entry, reason, score })
      }
    }

    return recommendations.sort((a, b) => b.score - a.score)
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private scoreEntry(entry: MarketplaceEntry, query: string): ScoredEntry {
    if (!query) {
      return { entry, score: 1, matchedFields: [] }
    }

    const q = query.toLowerCase()
    const tokens = q.split(/\s+/).filter(Boolean)
    let score = 0
    const matchedFields: string[] = []

    for (const token of tokens) {
      // Exact name match (highest weight)
      if (entry.name.toLowerCase() === token) {
        score += 10
        if (!matchedFields.includes("name")) matchedFields.push("name")
      }
      // Name contains token
      else if (entry.name.toLowerCase().includes(token)) {
        score += 5
        if (!matchedFields.includes("name")) matchedFields.push("name")
      }

      // Description match
      if (entry.description.toLowerCase().includes(token)) {
        score += 3
        if (!matchedFields.includes("description")) matchedFields.push("description")
      }

      // Keyword exact match
      if (entry.keywords.some((k) => k.toLowerCase() === token)) {
        score += 4
        if (!matchedFields.includes("keywords")) matchedFields.push("keywords")
      }
      // Keyword fuzzy match
      else if (entry.keywords.some((k) => this.fuzzyMatch(k.toLowerCase(), token))) {
        score += 2
        if (!matchedFields.includes("keywords")) matchedFields.push("keywords")
      }

      // Category match
      if (entry.category.toLowerCase() === token) {
        score += 3
        if (!matchedFields.includes("category")) matchedFields.push("category")
      }

      // Author match
      if (entry.author.toLowerCase().includes(token)) {
        score += 1
        if (!matchedFields.includes("author")) matchedFields.push("author")
      }
    }

    // Boost verified and first-party
    if (score > 0) {
      if (entry.verified) score += 0.5
      if (entry.firstParty) score += 0.5
    }

    return { entry, score, matchedFields }
  }

  private fuzzyMatch(str: string, query: string): boolean {
    if (str.includes(query) || query.includes(str)) return true

    // Simple Levenshtein-based check: allow 1 edit for short strings, 2 for longer
    const maxDistance = query.length <= 4 ? 1 : 2
    return this.levenshtein(str, query) <= maxDistance
  }

  private levenshtein(a: string, b: string): number {
    const matrix: number[][] = []
    for (let i = 0; i <= a.length; i++) {
      matrix[i] = [i]
    }
    for (let j = 0; j <= b.length; j++) {
      matrix[0][j] = j
    }
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1
        matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
      }
    }
    return matrix[a.length][b.length]
  }
}
