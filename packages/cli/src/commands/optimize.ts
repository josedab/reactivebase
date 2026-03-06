/**
 * CLI command: reactivebase optimize
 * Analyzes query patterns and generates optimization recommendations.
 *
 * Usage:
 *   reactivebase optimize
 *   reactivebase optimize --json
 *   reactivebase optimize --apply
 */

export interface OptimizeOptions {
  projectDir: string
  connectionString?: string
  json?: boolean
  apply?: boolean
  logLevel?: import("../logger.js").LogLevel
}

/**
 * Analyze query patterns and generate optimization recommendations including indexes, N+1 detection, and subscription tuning.
 *
 * @param options - Optimize options including project directory, connection string, JSON output, and auto-apply flags
 */
export async function optimize(options: OptimizeOptions): Promise<void> {
  const { createCliLogger } = await import("../logger.js")
  const logger = createCliLogger({ level: options.logLevel })
  const { AdaptiveQueryOptimizer } = await import("@reactivebase/server/metrics")

  logger.info("🔍 Analyzing query patterns...\n")

  const optimizer = new AdaptiveQueryOptimizer({
    analysisWindowMs: 600_000,
    slowQueryThresholdMs: 100,
    nPlusOneThreshold: 5,
  })

  // Load query patterns from metrics log if available
  const metricsPath = `${options.projectDir}/.reactivebase/metrics.json`
  try {
    const { readFileSync } = await import("node:fs")
    const data = JSON.parse(readFileSync(metricsPath, "utf-8"))
    if (Array.isArray(data.queryPatterns)) {
      for (const pattern of data.queryPatterns) {
        optimizer.recordQuery(pattern)
      }
    }
    if (Array.isArray(data.subscriptionProfiles)) {
      for (const profile of data.subscriptionProfiles) {
        optimizer.recordSubscriptionReExecution(
          profile.name,
          profile.tables,
          profile.avgReExecutionMs,
          profile.falseInvalidations > 0,
        )
      }
    }
  } catch {
    // No metrics file — generate analysis from schema structure
    logger.info("  ℹ No metrics data found. Run with `reactivebase dev` first to collect query patterns.\n")
    logger.info("  Generating structural analysis from schema...\n")

    // Analyze schema files for potential optimization opportunities
    try {
      const { readdirSync, readFileSync } = await import("node:fs")
      const { join } = await import("node:path")
      const schemaDir = join(options.projectDir, "src", "schema")
      const files = readdirSync(schemaDir).filter((f: string) => f.endsWith(".ts"))
      for (const file of files) {
        const content = readFileSync(join(schemaDir, file), "utf-8")
        // Detect filter patterns from where/filter calls
        const filterMatches = content.matchAll(/\.where\(\{?\s*(\w+)/g)
        for (const match of filterMatches) {
          optimizer.recordQuery({
            name: `schema:${file}`,
            tables: [file.replace(/\.ts$/, "")],
            filters: [match[1]],
            joins: [],
            durationMs: 0,
            rowsReturned: 0,
          })
        }
      }
    } catch {
      // No schema dir
    }
  }

  const report = optimizer.generateReport()

  if (options.json) {
    logger.info(optimizer.generateCIReport())
    return
  }

  // Pretty-print report
  logger.info("━".repeat(60))
  logger.info("  ReactiveBase Query Optimization Report")
  logger.info("━".repeat(60))
  logger.info("")

  // Index suggestions
  if (report.indexSuggestions.length > 0) {
    logger.info(`📊 Index Suggestions (${report.indexSuggestions.length})`)
    logger.info("─".repeat(40))
    for (const suggestion of report.indexSuggestions) {
      const icon = suggestion.estimatedImpact === "high" ? "🔴" : suggestion.estimatedImpact === "medium" ? "🟡" : "🟢"
      logger.info(`  ${icon} ${suggestion.table}.${suggestion.columns.join(", ")}`)
      logger.info(`     Impact: ${suggestion.estimatedImpact} | ${suggestion.reason}`)
      logger.info(`     SQL: ${suggestion.createSQL}`)
      logger.info("")
    }
  } else {
    logger.info("✅ No index suggestions — queries look well-indexed\n")
  }

  // N+1 issues
  if (report.nPlusOneIssues.length > 0) {
    logger.warn(`⚠️  N+1 Query Issues (${report.nPlusOneIssues.length})`)
    logger.info("─".repeat(40))
    for (const issue of report.nPlusOneIssues) {
      const icon = issue.severity === "critical" ? "🔴" : "🟡"
      logger.info(`  ${icon} ${issue.childQuery} (${issue.occurrences}x in ${issue.windowMs}ms)`)
      logger.info(`     Parent: ${issue.parentQuery}`)
      logger.info(`     Fix: ${issue.resolution}`)
      logger.info("")
    }
  } else {
    logger.info("✅ No N+1 query patterns detected\n")
  }

  // Subscription optimizations
  if (report.subscriptionOptimizations.length > 0) {
    logger.info(`📡 Subscription Optimizations (${report.subscriptionOptimizations.length})`)
    logger.info("─".repeat(40))
    for (const opt of report.subscriptionOptimizations) {
      const icon = opt.severity === "critical" ? "🔴" : opt.severity === "warning" ? "🟡" : "🔵"
      logger.info(`  ${icon} ${opt.subscriptionName} — ${opt.issue}`)
      logger.info(`     ${opt.detail}`)
      logger.info(`     Recommendation: ${opt.recommendation}`)
      logger.info("")
    }
  } else {
    logger.info("✅ Subscriptions look healthy\n")
  }

  // Summary
  logger.info("━".repeat(60))
  logger.info(
    `  Summary: ${report.summary.totalIssues} issues ` +
      `(${report.summary.critical} critical, ${report.summary.warnings} warnings)`,
  )
  if (report.summary.estimatedImprovementPercent > 0) {
    logger.info(`  Estimated improvement: ~${report.summary.estimatedImprovementPercent}%`)
  }
  logger.info("━".repeat(60))

  if (options.apply && report.indexSuggestions.length > 0) {
    logger.info("\n🚀 Applying index suggestions...")
    for (const suggestion of report.indexSuggestions) {
      logger.info(`  → ${suggestion.createSQL}`)
    }
    logger.warn("\n  ⚠️  Auto-apply requires a database connection. Use --connection-string to connect.")
  }
}
