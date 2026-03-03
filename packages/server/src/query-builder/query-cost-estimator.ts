/**
 * Smart Query Cost Estimator for ReactiveBase.
 *
 * Provides:
 *   - EXPLAIN ANALYZE integration for query cost estimation
 *   - Subscription cost projection (re-execution frequency × query cost)
 *   - Warnings for expensive subscriptions during development
 *   - Top-N expensive queries reporting
 *   - CLI 'reactivebase analyze' command output
 *
 * Usage:
 *   const estimator = new QueryCostEstimator(pool)
 *   const cost = await estimator.estimateQuery("SELECT * FROM tasks WHERE status = $1", ["active"])
 *   const report = estimator.generateReport()
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QueryCost {
  queryName: string
  sql: string
  args?: unknown[]
  planningTimeMs: number
  executionTimeMs: number
  totalCostUnits: number
  rowEstimate: number
  actualRows?: number
  sharedBuffersHit: number
  sharedBuffersRead: number
  indexUsed: boolean
  seqScan: boolean
  warnings: CostWarning[]
  analyzedAt: number
}

export interface CostWarning {
  level: "info" | "warning" | "critical"
  message: string
  suggestion?: string
}

export interface SubscriptionCost {
  queryName: string
  queryCost: QueryCost
  estimatedFrequencyPerMin: number
  costPerMinute: number
  costPerHour: number
  tier: "low" | "medium" | "high" | "critical"
  recommendation?: string
}

export interface CostReport {
  generatedAt: string
  totalQueries: number
  totalSubscriptions: number
  topExpensiveQueries: QueryCost[]
  topExpensiveSubscriptions: SubscriptionCost[]
  warnings: CostWarning[]
  summary: string
}

export interface QueryCostEstimatorOptions {
  /** Cost threshold for warning (default: 1000 cost units) */
  warningThreshold?: number
  /** Cost threshold for critical warning (default: 10000 cost units) */
  criticalThreshold?: number
  /** Subscription frequency estimation multiplier (default: 1 per minute) */
  defaultSubscriptionFrequency?: number
  /** Max queries to track (default: 500) */
  maxTrackedQueries?: number
  /** Enable sequential scan warnings (default: true) */
  warnOnSeqScan?: boolean
}

// ─── Default Configuration ───────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<QueryCostEstimatorOptions> = {
  warningThreshold: 1000,
  criticalThreshold: 10000,
  defaultSubscriptionFrequency: 1,
  maxTrackedQueries: 500,
  warnOnSeqScan: true,
}

// ─── Pool Interface ──────────────────────────────────────────────────────────

export interface CostEstimatorPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>
}

// ─── Query Cost Estimator ────────────────────────────────────────────────────

export class QueryCostEstimator {
  private options: Required<QueryCostEstimatorOptions>
  private pool: CostEstimatorPool | null
  private queryCosts: QueryCost[] = []
  private subscriptionCosts = new Map<string, SubscriptionCost>()
  private queryFrequencies = new Map<string, number>()

  constructor(pool?: CostEstimatorPool, options: QueryCostEstimatorOptions = {}) {
    this.pool = pool ?? null
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Estimate the cost of a query using EXPLAIN ANALYZE.
   */
  async estimateQuery(queryName: string, sql: string, args?: unknown[]): Promise<QueryCost> {
    const warnings: CostWarning[] = []
    let cost: QueryCost

    if (this.pool) {
      try {
        const explainSQL = `EXPLAIN (ANALYZE, FORMAT JSON, BUFFERS) ${sql}`
        const { rows } = await this.pool.query(explainSQL, args)
        const plan = (rows[0] as Record<string, unknown>)?.["QUERY PLAN"] as ExplainPlan[] | undefined
        const topPlan = plan?.[0]

        const planningTime = topPlan?.["Planning Time"] ?? 0
        const executionTime = topPlan?.["Execution Time"] ?? 0
        const planNode = topPlan?.Plan
        const totalCost = planNode?.["Total Cost"] ?? 0
        const rowEstimate = planNode?.["Plan Rows"] ?? 0
        const actualRows = planNode?.["Actual Rows"]
        const sharedHit = planNode?.["Shared Hit Blocks"] ?? 0
        const sharedRead = planNode?.["Shared Read Blocks"] ?? 0
        const nodeType = planNode?.["Node Type"] ?? ""
        const isSeqScan = nodeType === "Seq Scan" || String(nodeType).includes("Seq Scan")
        const indexUsed = String(nodeType).includes("Index")

        cost = {
          queryName,
          sql,
          args,
          planningTimeMs: planningTime,
          executionTimeMs: executionTime,
          totalCostUnits: totalCost,
          rowEstimate,
          actualRows,
          sharedBuffersHit: sharedHit,
          sharedBuffersRead: sharedRead,
          indexUsed,
          seqScan: isSeqScan,
          warnings: [],
          analyzedAt: Date.now(),
        }
      } catch {
        cost = createFallbackCost(queryName, sql, args)
      }
    } else {
      cost = createFallbackCost(queryName, sql, args)
    }

    // Generate warnings
    if (cost.totalCostUnits >= this.options.criticalThreshold) {
      warnings.push({
        level: "critical",
        message: `Query cost (${cost.totalCostUnits.toFixed(0)}) exceeds critical threshold (${this.options.criticalThreshold})`,
        suggestion: "Add indexes, limit results, or optimize the query plan",
      })
    } else if (cost.totalCostUnits >= this.options.warningThreshold) {
      warnings.push({
        level: "warning",
        message: `Query cost (${cost.totalCostUnits.toFixed(0)}) exceeds warning threshold (${this.options.warningThreshold})`,
        suggestion: "Consider adding indexes or reducing result set size",
      })
    }

    if (cost.seqScan && this.options.warnOnSeqScan) {
      warnings.push({
        level: "warning",
        message: "Sequential scan detected — query is not using any index",
        suggestion: "Add an index on the filtered/sorted columns",
      })
    }

    if (cost.rowEstimate > 10000) {
      warnings.push({
        level: "info",
        message: `Large result set estimated: ~${cost.rowEstimate} rows`,
        suggestion: "Add pagination or more restrictive filters",
      })
    }

    cost.warnings = warnings

    // Track
    this.queryCosts.push(cost)
    if (this.queryCosts.length > this.options.maxTrackedQueries) {
      this.queryCosts.shift()
    }

    return cost
  }

  /**
   * Record a query execution for frequency tracking.
   */
  recordExecution(queryName: string): void {
    const count = this.queryFrequencies.get(queryName) ?? 0
    this.queryFrequencies.set(queryName, count + 1)
  }

  /**
   * Estimate the cost of a subscription (frequency × query cost).
   */
  estimateSubscriptionCost(
    queryName: string,
    queryCost: QueryCost,
    estimatedFrequencyPerMin?: number,
  ): SubscriptionCost {
    const frequency = estimatedFrequencyPerMin ?? this.options.defaultSubscriptionFrequency
    const costPerMinute = queryCost.executionTimeMs * frequency
    const costPerHour = costPerMinute * 60

    let tier: SubscriptionCost["tier"] = "low"
    let recommendation: string | undefined

    if (costPerHour > 60000) {
      tier = "critical"
      recommendation =
        "This subscription will consume >1 minute of query time per hour. Consider caching or reducing frequency."
    } else if (costPerHour > 10000) {
      tier = "high"
      recommendation = "Consider batching updates or adding materialized views."
    } else if (costPerHour > 1000) {
      tier = "medium"
    }

    const subCost: SubscriptionCost = {
      queryName,
      queryCost,
      estimatedFrequencyPerMin: frequency,
      costPerMinute,
      costPerHour,
      tier,
      recommendation,
    }

    this.subscriptionCosts.set(queryName, subCost)
    return subCost
  }

  /**
   * Get the top N most expensive queries.
   */
  getTopExpensiveQueries(limit: number = 10): QueryCost[] {
    return [...this.queryCosts].sort((a, b) => b.totalCostUnits - a.totalCostUnits).slice(0, limit)
  }

  /**
   * Get the top N most expensive subscriptions.
   */
  getTopExpensiveSubscriptions(limit: number = 10): SubscriptionCost[] {
    return [...this.subscriptionCosts.values()].sort((a, b) => b.costPerHour - a.costPerHour).slice(0, limit)
  }

  /**
   * Generate a full cost report.
   */
  generateReport(limit: number = 10): CostReport {
    const topQueries = this.getTopExpensiveQueries(limit)
    const topSubscriptions = this.getTopExpensiveSubscriptions(limit)
    const allWarnings = this.queryCosts.flatMap((q) => q.warnings)

    const criticalCount = allWarnings.filter((w) => w.level === "critical").length
    const warningCount = allWarnings.filter((w) => w.level === "warning").length

    let summary: string
    if (criticalCount > 0) {
      summary = `❌ ${criticalCount} critical issue(s) found. ${warningCount} warnings. Review and optimize before production.`
    } else if (warningCount > 0) {
      summary = `⚠️ ${warningCount} warning(s) found. Consider optimization for better performance.`
    } else {
      summary = `✅ All queries within acceptable cost thresholds.`
    }

    return {
      generatedAt: new Date().toISOString(),
      totalQueries: this.queryCosts.length,
      totalSubscriptions: this.subscriptionCosts.size,
      topExpensiveQueries: topQueries,
      topExpensiveSubscriptions: topSubscriptions,
      warnings: allWarnings,
      summary,
    }
  }

  /**
   * Format a report for CLI output.
   */
  formatCLIReport(report?: CostReport): string {
    const r = report ?? this.generateReport()
    const lines: string[] = []

    lines.push("📊 ReactiveBase Query Cost Analysis")
    lines.push("═".repeat(60))
    lines.push(`  Analyzed: ${r.totalQueries} queries, ${r.totalSubscriptions} subscriptions`)
    lines.push("")

    if (r.topExpensiveQueries.length > 0) {
      lines.push("  Top Expensive Queries:")
      lines.push("  " + "─".repeat(56))
      for (const q of r.topExpensiveQueries.slice(0, 10)) {
        const icon = q.warnings.some((w) => w.level === "critical") ? "🔴" : q.warnings.length > 0 ? "🟡" : "🟢"
        lines.push(
          `  ${icon} ${q.queryName} — ${q.totalCostUnits.toFixed(0)} cost, ${q.executionTimeMs.toFixed(1)}ms, ~${q.rowEstimate} rows${q.seqScan ? " [SEQ SCAN]" : ""}`,
        )
        for (const w of q.warnings) {
          lines.push(`     ${w.level === "critical" ? "🔴" : "🟡"} ${w.message}`)
          if (w.suggestion) lines.push(`       💡 ${w.suggestion}`)
        }
      }
      lines.push("")
    }

    if (r.topExpensiveSubscriptions.length > 0) {
      lines.push("  Top Expensive Subscriptions:")
      lines.push("  " + "─".repeat(56))
      for (const s of r.topExpensiveSubscriptions.slice(0, 10)) {
        const tierIcon = s.tier === "critical" ? "🔴" : s.tier === "high" ? "🟠" : s.tier === "medium" ? "🟡" : "🟢"
        lines.push(
          `  ${tierIcon} ${s.queryName} — ${s.costPerHour.toFixed(0)}ms/hour (${s.estimatedFrequencyPerMin}/min × ${s.queryCost.executionTimeMs.toFixed(1)}ms)`,
        )
        if (s.recommendation) {
          lines.push(`       💡 ${s.recommendation}`)
        }
      }
      lines.push("")
    }

    lines.push("═".repeat(60))
    lines.push(r.summary)

    return lines.join("\n")
  }
}

// ─── Internal Types ──────────────────────────────────────────────────────────

interface ExplainPlan {
  Plan?: {
    "Node Type"?: string
    "Total Cost"?: number
    "Plan Rows"?: number
    "Actual Rows"?: number
    "Shared Hit Blocks"?: number
    "Shared Read Blocks"?: number
  }
  "Planning Time"?: number
  "Execution Time"?: number
}

function createFallbackCost(queryName: string, sql: string, args?: unknown[]): QueryCost {
  // Heuristic cost estimation when EXPLAIN is not available
  const hasWhere = /WHERE/i.test(sql)
  const hasLimit = /LIMIT/i.test(sql)
  const hasJoin = /JOIN/i.test(sql)
  const hasSubquery = /\(SELECT/i.test(sql)

  let estimatedCost = 100
  if (!hasWhere) estimatedCost *= 10
  if (!hasLimit) estimatedCost *= 2
  if (hasJoin) estimatedCost *= 3
  if (hasSubquery) estimatedCost *= 5

  return {
    queryName,
    sql,
    args,
    planningTimeMs: 0,
    executionTimeMs: 0,
    totalCostUnits: estimatedCost,
    rowEstimate: hasLimit ? 100 : 1000,
    sharedBuffersHit: 0,
    sharedBuffersRead: 0,
    indexUsed: hasWhere,
    seqScan: !hasWhere,
    warnings: [],
    analyzedAt: Date.now(),
  }
}
