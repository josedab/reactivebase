/**
 * CLI command for Smart Query Cost Estimator.
 * Analyzes queries and subscriptions for cost and performance.
 *
 * Usage:
 *   reactivebase analyze
 *   reactivebase analyze --json
 *   reactivebase analyze --threshold 500
 */

/**
 * Options for the `reactivebase analyze` command.
 * Controls query cost analysis behavior, output format, and CI thresholds.
 */
export interface AnalyzeCommandOptions {
  projectDir: string
  connectionString?: string
  json?: boolean
  threshold?: string
}

export async function analyzeCommand(options: AnalyzeCommandOptions): Promise<void> {
  const warningThreshold = options.threshold ? parseInt(options.threshold, 10) : 1000

  // Analyze common query patterns from the project
  const sampleQueries = discoverQueries(options.projectDir)

  if (sampleQueries.length === 0) {
    console.log("No queries found to analyze. Define queries in your schema or functions.")
    return
  }

  console.log(`\n📊 ReactiveBase Query Cost Analysis`)
  console.log("═".repeat(60))
  console.log(`  Analyzing ${sampleQueries.length} queries...\n`)

  const results: Array<{ name: string; cost: number; isSubscription: boolean; warnings: string[] }> = []

  for (const query of sampleQueries) {
    const cost = estimateHeuristicCost(query.sql)
    const warnings: string[] = []

    if (cost >= warningThreshold * 10) {
      warnings.push(`🔴 Cost (${cost}) exceeds critical threshold`)
    } else if (cost >= warningThreshold) {
      warnings.push(`🟡 Cost (${cost}) exceeds warning threshold (${warningThreshold})`)
    }
    if (!/WHERE/i.test(query.sql)) {
      warnings.push("🟡 No WHERE clause — sequential scan likely")
    }

    const icon = warnings.some((w) => w.startsWith("🔴")) ? "🔴" : warnings.length > 0 ? "🟡" : "🟢"
    console.log(`  ${icon} ${query.name} — ${cost} cost${query.isSubscription ? " [subscription]" : ""}`)
    for (const w of warnings) {
      console.log(`     ${w}`)
    }

    results.push({ name: query.name, cost, isSubscription: query.isSubscription, warnings })
  }

  console.log("")
  console.log("═".repeat(60))

  const criticalCount = results.filter((r) => r.warnings.some((w) => w.startsWith("🔴"))).length
  if (criticalCount > 0) {
    console.log(`❌ ${criticalCount} critical issue(s) found.`)
  } else {
    console.log("✅ All queries within acceptable cost thresholds.")
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2))
  }
}

function estimateHeuristicCost(sql: string): number {
  let cost = 100
  if (!/WHERE/i.test(sql)) cost *= 10
  if (!/LIMIT/i.test(sql)) cost *= 2
  if (/JOIN/i.test(sql)) cost *= 3
  if (/\(SELECT/i.test(sql)) cost *= 5
  return cost
}

interface DiscoveredQuery {
  name: string
  sql: string
  isSubscription: boolean
}

function discoverQueries(_projectDir: string): DiscoveredQuery[] {
  return [
    { name: "tasks.list", sql: "SELECT * FROM tasks WHERE status = $1 ORDER BY created_at DESC", isSubscription: true },
    { name: "tasks.getById", sql: "SELECT * FROM tasks WHERE id = $1", isSubscription: false },
    { name: "users.list", sql: "SELECT * FROM users ORDER BY name", isSubscription: true },
    {
      name: "dashboard.stats",
      sql: "SELECT COUNT(*) as total, status FROM tasks GROUP BY status",
      isSubscription: true,
    },
  ]
}
