/**
 * Subscription Analytics & Cost Attribution.
 *
 * Tracks per-subscription resource usage: re-execution count, CPU time,
 * rows scanned, bytes transferred. Attributes costs to queries, users, tenants.
 * Generates optimization suggestions.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SubscriptionCostRecord {
  subscriptionId: string
  queryName: string
  connectionId: string
  userId?: string
  tenantId?: string
  /** Number of times re-executed due to invalidation */
  reExecutionCount: number
  /** Total CPU time spent on re-executions (ms) */
  totalCpuTimeMs: number
  /** Total rows scanned across all executions */
  totalRowsScanned: number
  /** Total bytes transferred to client */
  totalBytesTransferred: number
  /** Number of invalidations that changed no results (false invalidations) */
  falseInvalidations: number
  /** Query args (for identifying patterns) */
  queryArgs: unknown
  /** Tables this subscription depends on */
  tables: string[]
  /** When the subscription was created */
  createdAt: number
  /** Time alive in seconds */
  aliveSeconds: number
  /** Average re-execution latency */
  avgReExecutionMs: number
  /** Cost score (composite metric) */
  costScore: number
}

export interface CostAttribution {
  /** Cost breakdown by query */
  byQuery: Record<string, QueryCostSummary>
  /** Cost breakdown by user */
  byUser: Record<string, UserCostSummary>
  /** Cost breakdown by tenant */
  byTenant: Record<string, TenantCostSummary>
  /** Most expensive subscriptions */
  topSubscriptions: SubscriptionCostRecord[]
  /** Total cost metrics */
  totals: CostTotals
}

export interface QueryCostSummary {
  queryName: string
  activeSubscriptions: number
  totalReExecutions: number
  totalCpuTimeMs: number
  totalRowsScanned: number
  totalBytesTransferred: number
  avgCostScore: number
}

export interface UserCostSummary {
  userId: string
  activeSubscriptions: number
  totalCpuTimeMs: number
  totalBytesTransferred: number
  avgCostScore: number
}

export interface TenantCostSummary {
  tenantId: string
  activeSubscriptions: number
  totalCpuTimeMs: number
  totalBytesTransferred: number
  avgCostScore: number
}

export interface CostTotals {
  totalSubscriptions: number
  totalReExecutions: number
  totalCpuTimeMs: number
  totalRowsScanned: number
  totalBytesTransferred: number
  totalFalseInvalidations: number
  falseInvalidationRate: number
}

export interface OptimizationSuggestion {
  type: "high_frequency" | "high_cost" | "false_invalidations" | "broad_dependency" | "stale_subscription"
  severity: "low" | "medium" | "high" | "critical"
  subscriptionId: string
  queryName: string
  message: string
  recommendation: string
  estimatedSavings?: string
}

export interface InvalidationTrigger {
  subscriptionId: string
  table: string
  operation: "insert" | "update" | "delete"
  timestamp: number
  resultChanged: boolean
  reExecutionMs: number
}

// ─── Analytics Collector ─────────────────────────────────────────────────────

export interface SubscriptionAnalyticsOptions {
  /** Max subscriptions to track in detail (default: 10000) */
  maxTrackedSubscriptions?: number
  /** How often to compute cost scores (ms, default: 30000) */
  costComputeIntervalMs?: number
  /** Max invalidation triggers to keep per subscription (default: 100) */
  maxTriggersPerSubscription?: number
  /** Top N subscriptions to report (default: 20) */
  topN?: number
}

const DEFAULT_OPTIONS: Required<SubscriptionAnalyticsOptions> = {
  maxTrackedSubscriptions: 10000,
  costComputeIntervalMs: 30_000,
  maxTriggersPerSubscription: 100,
  topN: 20,
}

/**
 * Collects and analyzes subscription-level resource usage.
 */
export class SubscriptionAnalytics {
  private records = new Map<string, SubscriptionCostRecord>()
  private triggers = new Map<string, InvalidationTrigger[]>()
  private options: Required<SubscriptionAnalyticsOptions>
  private computeTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: SubscriptionAnalyticsOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }

    this.computeTimer = setInterval(() => this.recomputeCostScores(), this.options.costComputeIntervalMs)
  }

  /**
   * Register a new subscription for tracking.
   */
  trackSubscription(
    subscriptionId: string,
    queryName: string,
    connectionId: string,
    queryArgs: unknown,
    tables: string[],
    userId?: string,
    tenantId?: string,
  ): void {
    if (this.records.size >= this.options.maxTrackedSubscriptions) {
      // Evict the lowest cost subscription
      this.evictLowestCost()
    }

    this.records.set(subscriptionId, {
      subscriptionId,
      queryName,
      connectionId,
      userId,
      tenantId,
      reExecutionCount: 0,
      totalCpuTimeMs: 0,
      totalRowsScanned: 0,
      totalBytesTransferred: 0,
      falseInvalidations: 0,
      queryArgs,
      tables,
      createdAt: Date.now(),
      aliveSeconds: 0,
      avgReExecutionMs: 0,
      costScore: 0,
    })
  }

  /**
   * Record a re-execution event for a subscription.
   */
  recordReExecution(
    subscriptionId: string,
    cpuTimeMs: number,
    rowsScanned: number,
    bytesTransferred: number,
    resultChanged: boolean,
    table?: string,
    operation?: "insert" | "update" | "delete",
  ): void {
    const record = this.records.get(subscriptionId)
    if (!record) return

    record.reExecutionCount++
    record.totalCpuTimeMs += cpuTimeMs
    record.totalRowsScanned += rowsScanned
    record.totalBytesTransferred += bytesTransferred
    record.avgReExecutionMs = record.totalCpuTimeMs / record.reExecutionCount

    if (!resultChanged) {
      record.falseInvalidations++
    }

    // Track trigger
    if (table) {
      let triggerList = this.triggers.get(subscriptionId)
      if (!triggerList) {
        triggerList = []
        this.triggers.set(subscriptionId, triggerList)
      }

      triggerList.push({
        subscriptionId,
        table: table,
        operation: operation ?? "update",
        timestamp: Date.now(),
        resultChanged,
        reExecutionMs: cpuTimeMs,
      })

      // Cap trigger history
      if (triggerList.length > this.options.maxTriggersPerSubscription) {
        triggerList.shift()
      }
    }
  }

  /**
   * Remove a subscription from tracking.
   */
  removeSubscription(subscriptionId: string): void {
    this.records.delete(subscriptionId)
    this.triggers.delete(subscriptionId)
  }

  /**
   * Get full cost attribution breakdown.
   */
  getCostAttribution(): CostAttribution {
    const byQuery: Record<string, QueryCostSummary> = {}
    const byUser: Record<string, UserCostSummary> = {}
    const byTenant: Record<string, TenantCostSummary> = {}

    const totals: CostTotals = {
      totalSubscriptions: this.records.size,
      totalReExecutions: 0,
      totalCpuTimeMs: 0,
      totalRowsScanned: 0,
      totalBytesTransferred: 0,
      totalFalseInvalidations: 0,
      falseInvalidationRate: 0,
    }

    for (const record of this.records.values()) {
      // Update alive time
      record.aliveSeconds = (Date.now() - record.createdAt) / 1000

      // Totals
      totals.totalReExecutions += record.reExecutionCount
      totals.totalCpuTimeMs += record.totalCpuTimeMs
      totals.totalRowsScanned += record.totalRowsScanned
      totals.totalBytesTransferred += record.totalBytesTransferred
      totals.totalFalseInvalidations += record.falseInvalidations

      // By query
      if (!byQuery[record.queryName]) {
        byQuery[record.queryName] = {
          queryName: record.queryName,
          activeSubscriptions: 0,
          totalReExecutions: 0,
          totalCpuTimeMs: 0,
          totalRowsScanned: 0,
          totalBytesTransferred: 0,
          avgCostScore: 0,
        }
      }
      const q = byQuery[record.queryName]
      q.activeSubscriptions++
      q.totalReExecutions += record.reExecutionCount
      q.totalCpuTimeMs += record.totalCpuTimeMs
      q.totalRowsScanned += record.totalRowsScanned
      q.totalBytesTransferred += record.totalBytesTransferred

      // By user
      if (record.userId) {
        if (!byUser[record.userId]) {
          byUser[record.userId] = {
            userId: record.userId,
            activeSubscriptions: 0,
            totalCpuTimeMs: 0,
            totalBytesTransferred: 0,
            avgCostScore: 0,
          }
        }
        const u = byUser[record.userId]
        u.activeSubscriptions++
        u.totalCpuTimeMs += record.totalCpuTimeMs
        u.totalBytesTransferred += record.totalBytesTransferred
      }

      // By tenant
      if (record.tenantId) {
        if (!byTenant[record.tenantId]) {
          byTenant[record.tenantId] = {
            tenantId: record.tenantId,
            activeSubscriptions: 0,
            totalCpuTimeMs: 0,
            totalBytesTransferred: 0,
            avgCostScore: 0,
          }
        }
        const t = byTenant[record.tenantId]
        t.activeSubscriptions++
        t.totalCpuTimeMs += record.totalCpuTimeMs
        t.totalBytesTransferred += record.totalBytesTransferred
      }
    }

    totals.falseInvalidationRate =
      totals.totalReExecutions > 0 ? totals.totalFalseInvalidations / totals.totalReExecutions : 0

    // Compute average cost scores per grouping
    for (const q of Object.values(byQuery)) {
      q.avgCostScore = q.activeSubscriptions > 0 ? q.totalCpuTimeMs / q.activeSubscriptions : 0
    }
    for (const u of Object.values(byUser)) {
      u.avgCostScore = u.activeSubscriptions > 0 ? u.totalCpuTimeMs / u.activeSubscriptions : 0
    }
    for (const t of Object.values(byTenant)) {
      t.avgCostScore = t.activeSubscriptions > 0 ? t.totalCpuTimeMs / t.activeSubscriptions : 0
    }

    // Top subscriptions by cost
    const allRecords = Array.from(this.records.values())
    allRecords.sort((a, b) => b.costScore - a.costScore)
    const topSubscriptions = allRecords.slice(0, this.options.topN)

    return { byQuery, byUser, byTenant, topSubscriptions, totals }
  }

  /**
   * Get invalidation triggers for a specific subscription.
   */
  getInvalidationTriggers(subscriptionId: string): InvalidationTrigger[] {
    return this.triggers.get(subscriptionId) ?? []
  }

  /**
   * Generate optimization suggestions based on current data.
   */
  generateSuggestions(): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = []

    for (const record of this.records.values()) {
      // High re-execution frequency
      const reExecsPerMinute = record.aliveSeconds > 0 ? (record.reExecutionCount / record.aliveSeconds) * 60 : 0

      if (reExecsPerMinute > 10) {
        suggestions.push({
          type: "high_frequency",
          severity: reExecsPerMinute > 60 ? "critical" : "high",
          subscriptionId: record.subscriptionId,
          queryName: record.queryName,
          message: `Subscription re-executes ${reExecsPerMinute.toFixed(1)} times/minute`,
          recommendation:
            "Consider adding more specific WHERE filters, using row-level tracking (L3), or debouncing invalidations.",
          estimatedSavings: `~${Math.floor(record.totalCpuTimeMs * 0.5)}ms CPU saved with row-level tracking`,
        })
      }

      // High false invalidation rate
      if (record.reExecutionCount > 10) {
        const falseRate = record.falseInvalidations / record.reExecutionCount
        if (falseRate > 0.5) {
          suggestions.push({
            type: "false_invalidations",
            severity: falseRate > 0.8 ? "high" : "medium",
            subscriptionId: record.subscriptionId,
            queryName: record.queryName,
            message: `${(falseRate * 100).toFixed(0)}% of re-executions produce unchanged results`,
            recommendation: "Enable row-level tracking (L3 invalidation) or add filter-level dependency tracking.",
            estimatedSavings: `~${Math.floor(record.falseInvalidations * record.avgReExecutionMs)}ms CPU saved`,
          })
        }
      }

      // Broad table dependencies
      if (record.tables.length > 3) {
        suggestions.push({
          type: "broad_dependency",
          severity: "medium",
          subscriptionId: record.subscriptionId,
          queryName: record.queryName,
          message: `Subscription depends on ${record.tables.length} tables: ${record.tables.join(", ")}`,
          recommendation: "Split into multiple focused subscriptions to reduce invalidation scope.",
        })
      }

      // High total cost
      if (record.costScore > 1000) {
        suggestions.push({
          type: "high_cost",
          severity: record.costScore > 5000 ? "critical" : "high",
          subscriptionId: record.subscriptionId,
          queryName: record.queryName,
          message: `High cost score: ${record.costScore.toFixed(0)} (CPU: ${record.totalCpuTimeMs.toFixed(0)}ms, rows: ${record.totalRowsScanned})`,
          recommendation: "Add indexes, limit result set size, or cache frequently-accessed data.",
        })
      }

      // Stale subscriptions (alive > 1 hour with 0 re-executions)
      if (record.aliveSeconds > 3600 && record.reExecutionCount === 0) {
        suggestions.push({
          type: "stale_subscription",
          severity: "low",
          subscriptionId: record.subscriptionId,
          queryName: record.queryName,
          message: `Subscription alive for ${Math.floor(record.aliveSeconds / 60)} minutes with no re-executions`,
          recommendation: "Check if client is still connected. Consider implementing subscription TTL.",
        })
      }
    }

    // Sort by severity
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
    suggestions.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

    return suggestions
  }

  /**
   * Format analytics for dashboard display.
   */
  formatLeaderboard(): string {
    const attribution = this.getCostAttribution()
    const lines: string[] = []

    lines.push("╔══════════════════════════════════════════════════╗")
    lines.push("║    Most Expensive Subscriptions Leaderboard      ║")
    lines.push("╚══════════════════════════════════════════════════╝")
    lines.push("")

    if (attribution.topSubscriptions.length === 0) {
      lines.push("  No active subscriptions.")
      return lines.join("\n")
    }

    lines.push("  #  Query                    Re-Execs  CPU(ms)  Rows     Cost")
    lines.push("  ─────────────────────────────────────────────────────────────")

    for (let i = 0; i < attribution.topSubscriptions.length; i++) {
      const sub = attribution.topSubscriptions[i]
      const rank = String(i + 1).padStart(2)
      const query = sub.queryName.padEnd(24).substring(0, 24)
      const reExec = String(sub.reExecutionCount).padStart(8)
      const cpu = String(Math.round(sub.totalCpuTimeMs)).padStart(8)
      const rows = String(sub.totalRowsScanned).padStart(8)
      const cost = String(Math.round(sub.costScore)).padStart(6)
      lines.push(`  ${rank} ${query} ${reExec} ${cpu} ${rows} ${cost}`)
    }

    lines.push("")
    lines.push(`  Total subscriptions: ${attribution.totals.totalSubscriptions}`)
    lines.push(`  Total re-executions: ${attribution.totals.totalReExecutions}`)
    lines.push(`  False invalidation rate: ${(attribution.totals.falseInvalidationRate * 100).toFixed(1)}%`)

    return lines.join("\n")
  }

  /**
   * Stop analytics collection.
   */
  stop(): void {
    if (this.computeTimer) {
      clearInterval(this.computeTimer)
      this.computeTimer = null
    }
  }

  private recomputeCostScores(): void {
    for (const record of this.records.values()) {
      record.aliveSeconds = (Date.now() - record.createdAt) / 1000

      // Cost score: weighted combination of CPU time, rows scanned, and re-execution frequency
      const frequencyWeight = record.aliveSeconds > 0 ? (record.reExecutionCount / record.aliveSeconds) * 60 : 0
      record.costScore =
        record.totalCpuTimeMs * 0.4 + record.totalRowsScanned * 0.001 * 0.3 + frequencyWeight * 100 * 0.3
    }
  }

  private evictLowestCost(): void {
    let lowestId: string | null = null
    let lowestCost = Infinity

    for (const [id, record] of this.records) {
      if (record.costScore < lowestCost) {
        lowestCost = record.costScore
        lowestId = id
      }
    }

    if (lowestId) {
      this.records.delete(lowestId)
      this.triggers.delete(lowestId)
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createSubscriptionAnalytics(options?: SubscriptionAnalyticsOptions): SubscriptionAnalytics {
  return new SubscriptionAnalytics(options)
}
