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
}

/**
 * Analyze query patterns and generate optimization recommendations including indexes, N+1 detection, and subscription tuning.
 *
 * @param options - Optimize options including project directory, connection string, JSON output, and auto-apply flags
 */
export async function optimize(options: OptimizeOptions): Promise<void> {
  const { AdaptiveQueryOptimizer } = await import("@reactivebase/server/metrics")

  console.log("🔍 Analyzing query patterns...\n")

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
    console.log("  ℹ No metrics data found. Run with `reactivebase dev` first to collect query patterns.\n")
    console.log("  Generating structural analysis from schema...\n")

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
    console.log(optimizer.generateCIReport())
    return
  }

  // Pretty-print report
  console.log("━".repeat(60))
  console.log("  ReactiveBase Query Optimization Report")
  console.log("━".repeat(60))
  console.log()

  // Index suggestions
  if (report.indexSuggestions.length > 0) {
    console.log(`📊 Index Suggestions (${report.indexSuggestions.length})`)
    console.log("─".repeat(40))
    for (const suggestion of report.indexSuggestions) {
      const icon = suggestion.estimatedImpact === "high" ? "🔴" : suggestion.estimatedImpact === "medium" ? "🟡" : "🟢"
      console.log(`  ${icon} ${suggestion.table}.${suggestion.columns.join(", ")}`)
      console.log(`     Impact: ${suggestion.estimatedImpact} | ${suggestion.reason}`)
      console.log(`     SQL: ${suggestion.createSQL}`)
      console.log()
    }
  } else {
    console.log("✅ No index suggestions — queries look well-indexed\n")
  }

  // N+1 issues
  if (report.nPlusOneIssues.length > 0) {
    console.log(`⚠️  N+1 Query Issues (${report.nPlusOneIssues.length})`)
    console.log("─".repeat(40))
    for (const issue of report.nPlusOneIssues) {
      const icon = issue.severity === "critical" ? "🔴" : "🟡"
      console.log(`  ${icon} ${issue.childQuery} (${issue.occurrences}x in ${issue.windowMs}ms)`)
      console.log(`     Parent: ${issue.parentQuery}`)
      console.log(`     Fix: ${issue.resolution}`)
      console.log()
    }
  } else {
    console.log("✅ No N+1 query patterns detected\n")
  }

  // Subscription optimizations
  if (report.subscriptionOptimizations.length > 0) {
    console.log(`📡 Subscription Optimizations (${report.subscriptionOptimizations.length})`)
    console.log("─".repeat(40))
    for (const opt of report.subscriptionOptimizations) {
      const icon = opt.severity === "critical" ? "🔴" : opt.severity === "warning" ? "🟡" : "🔵"
      console.log(`  ${icon} ${opt.subscriptionName} — ${opt.issue}`)
      console.log(`     ${opt.detail}`)
      console.log(`     Recommendation: ${opt.recommendation}`)
      console.log()
    }
  } else {
    console.log("✅ Subscriptions look healthy\n")
  }

  // Summary
  console.log("━".repeat(60))
  console.log(
    `  Summary: ${report.summary.totalIssues} issues ` +
      `(${report.summary.critical} critical, ${report.summary.warnings} warnings)`,
  )
  if (report.summary.estimatedImprovementPercent > 0) {
    console.log(`  Estimated improvement: ~${report.summary.estimatedImprovementPercent}%`)
  }
  console.log("━".repeat(60))

  if (options.apply && report.indexSuggestions.length > 0) {
    console.log("\n🚀 Applying index suggestions...")
    for (const suggestion of report.indexSuggestions) {
      console.log(`  → ${suggestion.createSQL}`)
    }
    console.log("\n  ⚠️  Auto-apply requires a database connection. Use --connection-string to connect.")
  }
}
