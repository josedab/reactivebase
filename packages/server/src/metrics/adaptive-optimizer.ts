/**
 * Adaptive Query Optimization for ReactiveBase.
 * Automatically analyzes query patterns and recommends performance improvements.
 *
 * Features:
 *   - Auto-index suggestions based on query patterns
 *   - N+1 query detection with resolution hints
 *   - Subscription re-execution profiling
 *   - Query plan analysis
 *   - JSON report generation for CI integration
 *
 * Usage:
 *   const optimizer = new AdaptiveQueryOptimizer()
 *   optimizer.recordQuery({ name: "tasks.list", tables: ["tasks"], filters: ["status"], durationMs: 120 })
 *   const report = optimizer.generateReport()
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QueryPattern {
  name: string
  tables: string[]
  filters: string[]
  joins: string[]
  durationMs: number
  rowsReturned: number
  timestamp: number
}

export interface SubscriptionProfile {
  name: string
  tables: string[]
  reExecutionCount: number
  avgReExecutionMs: number
  maxReExecutionMs: number
  invalidationCount: number
  falseInvalidations: number
  lastProfiledAt: number
}

export interface IndexSuggestion {
  table: string
  columns: string[]
  type: "btree" | "hash" | "gin" | "gist"
  reason: string
  estimatedImpact: "high" | "medium" | "low"
  createSQL: string
  queryPatterns: string[]
}

export interface NPlusOneIssue {
  parentQuery: string
  childQuery: string
  occurrences: number
  windowMs: number
  resolution: string
  severity: "critical" | "warning" | "info"
}

export interface SubscriptionOptimization {
  subscriptionName: string
  issue: "high_reexecution" | "false_invalidation" | "wide_dependency" | "slow_reexecution"
  detail: string
  recommendation: string
  severity: "critical" | "warning" | "info"
}

export interface OptimizationReport {
  timestamp: number
  analysisWindowMs: number
  queryCount: number
  indexSuggestions: IndexSuggestion[]
  nPlusOneIssues: NPlusOneIssue[]
  subscriptionOptimizations: SubscriptionOptimization[]
  summary: {
    totalIssues: number
    critical: number
    warnings: number
    estimatedImprovementPercent: number
  }
}

export interface AdaptiveOptimizerOptions {
  /** Analysis window in ms (default: 300000 = 5 min) */
  analysisWindowMs?: number
  /** N+1 threshold: repeated child queries (default: 5) */
  nPlusOneThreshold?: number
  /** Slow query threshold in ms (default: 100) */
  slowQueryThresholdMs?: number
  /** High re-execution threshold per minute (default: 50) */
  highReExecutionThreshold?: number
  /** False invalidation rate threshold (0-1, default: 0.3) */
  falseInvalidationThreshold?: number
}

const DEFAULTS: Required<AdaptiveOptimizerOptions> = {
  analysisWindowMs: 300_000,
  nPlusOneThreshold: 5,
  slowQueryThresholdMs: 100,
  highReExecutionThreshold: 50,
  falseInvalidationThreshold: 0.3,
}

// ─── Optimizer ───────────────────────────────────────────────────────────────

export class AdaptiveQueryOptimizer {
  private queryPatterns: QueryPattern[] = []
  private subscriptionProfiles = new Map<string, SubscriptionProfile>()
  private existingIndexes = new Set<string>()
  private options: Required<AdaptiveOptimizerOptions>

  constructor(options: AdaptiveOptimizerOptions = {}) {
    this.options = { ...DEFAULTS, ...options }
  }

  /**
   * Record a query execution for pattern analysis.
   */
  recordQuery(pattern: Omit<QueryPattern, "timestamp">): void {
    this.queryPatterns.push({ ...pattern, timestamp: Date.now() })
    this.pruneOldPatterns()
  }

  /**
   * Record a subscription re-execution.
   */
  recordSubscriptionReExecution(
    name: string,
    tables: string[],
    reExecutionMs: number,
    wasFalseInvalidation: boolean,
  ): void {
    let profile = this.subscriptionProfiles.get(name)
    if (!profile) {
      profile = {
        name,
        tables,
        reExecutionCount: 0,
        avgReExecutionMs: 0,
        maxReExecutionMs: 0,
        invalidationCount: 0,
        falseInvalidations: 0,
        lastProfiledAt: Date.now(),
      }
      this.subscriptionProfiles.set(name, profile)
    }

    profile.invalidationCount++
    profile.reExecutionCount++
    profile.avgReExecutionMs =
      (profile.avgReExecutionMs * (profile.reExecutionCount - 1) + reExecutionMs) / profile.reExecutionCount
    profile.maxReExecutionMs = Math.max(profile.maxReExecutionMs, reExecutionMs)
    if (wasFalseInvalidation) profile.falseInvalidations++
    profile.lastProfiledAt = Date.now()
  }

  /**
   * Register an existing index to avoid duplicate suggestions.
   */
  registerExistingIndex(table: string, columns: string[]): void {
    this.existingIndexes.add(`${table}:${columns.sort().join(",")}`)
  }

  /**
   * Generate a full optimization report.
   */
  generateReport(): OptimizationReport {
    const indexSuggestions = this.analyzeIndexes()
    const nPlusOneIssues = this.detectNPlusOne()
    const subscriptionOptimizations = this.analyzeSubscriptions()

    const critical =
      indexSuggestions.filter((s) => s.estimatedImpact === "high").length +
      nPlusOneIssues.filter((n) => n.severity === "critical").length +
      subscriptionOptimizations.filter((s) => s.severity === "critical").length

    const warnings =
      indexSuggestions.filter((s) => s.estimatedImpact === "medium").length +
      nPlusOneIssues.filter((n) => n.severity === "warning").length +
      subscriptionOptimizations.filter((s) => s.severity === "warning").length

    const totalIssues = indexSuggestions.length + nPlusOneIssues.length + subscriptionOptimizations.length

    return {
      timestamp: Date.now(),
      analysisWindowMs: this.options.analysisWindowMs,
      queryCount: this.queryPatterns.length,
      indexSuggestions,
      nPlusOneIssues,
      subscriptionOptimizations,
      summary: {
        totalIssues,
        critical,
        warnings,
        estimatedImprovementPercent: Math.min(critical * 15 + warnings * 5, 80),
      },
    }
  }

  /**
   * Generate JSON output suitable for CI/CD pipelines.
   */
  generateCIReport(): string {
    const report = this.generateReport()
    return JSON.stringify(report, null, 2)
  }

  /**
   * Get subscription profiles for debugging.
   */
  getSubscriptionProfiles(): SubscriptionProfile[] {
    return Array.from(this.subscriptionProfiles.values())
  }

  /**
   * Reset all collected data.
   */
  reset(): void {
    this.queryPatterns = []
    this.subscriptionProfiles.clear()
  }

  // ─── Analysis Methods ──────────────────────────────────────────────────

  private analyzeIndexes(): IndexSuggestion[] {
    const suggestions: IndexSuggestion[] = []
    const filterCounts = new Map<string, { count: number; totalMs: number; patterns: string[] }>()

    for (const pattern of this.queryPatterns) {
      for (const table of pattern.tables) {
        for (const filter of pattern.filters) {
          const key = `${table}:${filter}`
          const entry = filterCounts.get(key) ?? { count: 0, totalMs: 0, patterns: [] }
          entry.count++
          entry.totalMs += pattern.durationMs
          if (!entry.patterns.includes(pattern.name)) entry.patterns.push(pattern.name)
          filterCounts.set(key, entry)
        }
      }
    }

    for (const [key, data] of Array.from(filterCounts.entries())) {
      const [table, column] = key.split(":")
      const indexKey = `${table}:${column}`
      if (this.existingIndexes.has(indexKey)) continue
      if (data.count < 3) continue

      const avgMs = data.totalMs / data.count
      const impact: IndexSuggestion["estimatedImpact"] =
        avgMs > this.options.slowQueryThresholdMs ? "high" : data.count > 10 ? "medium" : "low"

      suggestions.push({
        table,
        columns: [column],
        type: "btree",
        reason: `Column "${column}" filtered ${data.count} times with avg ${avgMs.toFixed(1)}ms`,
        estimatedImpact: impact,
        createSQL: `CREATE INDEX CONCURRENTLY idx_${table}_${column} ON "${table}" ("${column}");`,
        queryPatterns: data.patterns,
      })
    }

    return suggestions.sort((a, b) => impactOrder(a.estimatedImpact) - impactOrder(b.estimatedImpact))
  }

  private detectNPlusOne(): NPlusOneIssue[] {
    const issues: NPlusOneIssue[] = []
    const windowMs = 500
    const queryWindows = new Map<string, Array<{ name: string; timestamp: number }>>()

    const sorted = [...this.queryPatterns].sort((a, b) => a.timestamp - b.timestamp)
    for (let i = 0; i < sorted.length; i++) {
      const query = sorted[i]
      const windowKey = `${query.name}`
      if (!queryWindows.has(windowKey)) {
        queryWindows.set(windowKey, [])
      }
      const window = queryWindows.get(windowKey)!
      // Remove old entries outside window
      while (window.length > 0 && query.timestamp - window[0].timestamp > windowMs) {
        window.shift()
      }
      window.push({ name: query.name, timestamp: query.timestamp })

      if (window.length >= this.options.nPlusOneThreshold) {
        // Find the parent query
        const parentCandidates = sorted.filter(
          (p) => p.name !== query.name && p.timestamp >= query.timestamp - windowMs && p.timestamp <= query.timestamp,
        )

        const parentQuery = parentCandidates.length > 0 ? parentCandidates[0].name : "unknown"
        const existing = issues.find((i) => i.childQuery === query.name)
        if (!existing) {
          issues.push({
            parentQuery,
            childQuery: query.name,
            occurrences: window.length,
            windowMs,
            resolution: `Use a join or include() to fetch "${query.name}" data in the parent query`,
            severity: window.length >= this.options.nPlusOneThreshold * 2 ? "critical" : "warning",
          })
        }
      }
    }

    return issues
  }

  private analyzeSubscriptions(): SubscriptionOptimization[] {
    const optimizations: SubscriptionOptimization[] = []

    for (const profile of Array.from(this.subscriptionProfiles.values())) {
      if (profile.avgReExecutionMs > this.options.slowQueryThresholdMs) {
        optimizations.push({
          subscriptionName: profile.name,
          issue: "slow_reexecution",
          detail: `Avg re-execution: ${profile.avgReExecutionMs.toFixed(1)}ms (max: ${profile.maxReExecutionMs.toFixed(1)}ms)`,
          recommendation: "Add indexes on filtered columns or simplify the query",
          severity: profile.avgReExecutionMs > this.options.slowQueryThresholdMs * 3 ? "critical" : "warning",
        })
      }

      const falseRate = profile.invalidationCount > 0 ? profile.falseInvalidations / profile.invalidationCount : 0
      if (falseRate > this.options.falseInvalidationThreshold && profile.invalidationCount >= 10) {
        optimizations.push({
          subscriptionName: profile.name,
          issue: "false_invalidation",
          detail: `${(falseRate * 100).toFixed(0)}% false invalidation rate (${profile.falseInvalidations}/${profile.invalidationCount})`,
          recommendation: "Use row-level tracking or more specific filters to reduce unnecessary re-executions",
          severity: falseRate > 0.6 ? "critical" : "warning",
        })
      }

      if (profile.tables.length > 3) {
        optimizations.push({
          subscriptionName: profile.name,
          issue: "wide_dependency",
          detail: `Depends on ${profile.tables.length} tables: ${profile.tables.join(", ")}`,
          recommendation: "Split into multiple focused subscriptions to reduce invalidation scope",
          severity: "info",
        })
      }

      const reExPerMin = profile.reExecutionCount / (Math.max(Date.now() - profile.lastProfiledAt, 60_000) / 60_000)
      if (reExPerMin > this.options.highReExecutionThreshold) {
        optimizations.push({
          subscriptionName: profile.name,
          issue: "high_reexecution",
          detail: `${reExPerMin.toFixed(0)} re-executions/min`,
          recommendation: "Consider debouncing or using incremental view maintenance",
          severity: reExPerMin > this.options.highReExecutionThreshold * 2 ? "critical" : "warning",
        })
      }
    }

    return optimizations
  }

  private pruneOldPatterns(): void {
    const cutoff = Date.now() - this.options.analysisWindowMs
    this.queryPatterns = this.queryPatterns.filter((p) => p.timestamp >= cutoff)
  }
}

function impactOrder(impact: IndexSuggestion["estimatedImpact"]): number {
  return impact === "high" ? 0 : impact === "medium" ? 1 : 2
}
