/**
 * Automated Performance Advisor for ReactiveBase.
 *
 * Background analyzer that monitors query execution patterns, subscription
 * invalidation frequency, and index usage. Produces actionable recommendations
 * for missing indexes, N+1 queries, hot subscriptions, over-fetching, and
 * unused indexes.
 *
 * Usage:
 *   const advisor = new PerformanceAdvisor()
 *   advisor.recordQuery({ name: "tasks.list", durationMs: 50, tables: ["tasks"] })
 *   advisor.recordInvalidation({ table: "tasks", subscriptionCount: 150 })
 *   const recommendations = advisor.analyze()
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AdvisorOptions {
  /** Analysis window in ms (default: 300000 = 5 min) */
  analysisWindowMs?: number
  /** Hot subscription threshold: invalidations/min (default: 100) */
  hotSubscriptionThreshold?: number
  /** Slow query threshold in ms (default: 100) */
  slowQueryThresholdMs?: number
  /** N+1 detection threshold: repeated queries in window (default: 5) */
  nPlusOneThreshold?: number
  /** Over-fetch ratio threshold (default: 0.8 = >80% unused columns) */
  overFetchThreshold?: number
  /** Unused index period in ms (default: 86400000 = 24h) */
  unusedIndexPeriodMs?: number
}

export interface QueryRecord {
  name: string
  durationMs: number
  tables: string[]
  rowCount?: number
  columnCount?: number
  usedColumns?: number
  timestamp?: number
}

export interface InvalidationRecord {
  table: string
  subscriptionCount: number
  reExecutionTimeMs?: number
  timestamp?: number
}

export interface IndexUsageRecord {
  table: string
  indexName: string
  scans: number
  lastUsed: number | null
}

export type RecommendationType =
  | "missing_index"
  | "n_plus_one"
  | "hot_subscription"
  | "over_fetching"
  | "unused_index"
  | "slow_query"
  | "connection_pool"

export type RecommendationSeverity = "info" | "warning" | "critical"

export interface Recommendation {
  type: RecommendationType
  severity: RecommendationSeverity
  title: string
  description: string
  table?: string
  queryName?: string
  /** Suggested action (SQL, code change, config change) */
  suggestion: string
  /** Estimated impact */
  impact: "high" | "medium" | "low"
  /** Evidence data */
  evidence: Record<string, unknown>
}

export interface AdvisorReport {
  recommendations: Recommendation[]
  analyzedAt: number
  windowMs: number
  stats: {
    totalQueries: number
    totalInvalidations: number
    uniqueQueryNames: number
    tablesAnalyzed: number
  }
}

// ─── SQL Helpers ─────────────────────────────────────────────────────────────

export function buildUnusedIndexesSQL(): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT
      schemaname, relname AS table_name, indexrelname AS index_name,
      idx_scan, idx_tup_read, idx_tup_fetch,
      pg_relation_size(indexrelid) AS index_size
    FROM pg_stat_user_indexes
    WHERE idx_scan = 0
      AND schemaname = 'public'
      AND indexrelname NOT LIKE '%_pkey'
    ORDER BY pg_relation_size(indexrelid) DESC`,
    params: [],
  }
}

export function buildTableSeqScanSQL(): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT
      schemaname, relname AS table_name,
      seq_scan, seq_tup_read, idx_scan,
      CASE WHEN seq_scan + idx_scan > 0
        THEN round(100.0 * seq_scan / (seq_scan + idx_scan), 2)
        ELSE 0
      END AS seq_scan_pct,
      n_live_tup AS row_count
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
      AND n_live_tup > 100
      AND seq_scan > idx_scan
    ORDER BY seq_tup_read DESC
    LIMIT 20`,
    params: [],
  }
}

export function buildIndexSuggestionsSQL(tableName: string): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT
      attname AS column_name,
      n_distinct,
      correlation
    FROM pg_stats
    WHERE schemaname = 'public'
      AND tablename = $1
      AND n_distinct > 10
    ORDER BY n_distinct DESC`,
    params: [tableName],
  }
}

// ─── Performance Advisor Engine ──────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<AdvisorOptions> = {
  analysisWindowMs: 300_000,
  hotSubscriptionThreshold: 100,
  slowQueryThresholdMs: 100,
  nPlusOneThreshold: 5,
  overFetchThreshold: 0.8,
  unusedIndexPeriodMs: 86_400_000,
}

export class PerformanceAdvisor {
  private options: Required<AdvisorOptions>
  private queryRecords: QueryRecord[] = []
  private invalidationRecords: InvalidationRecord[] = []
  private indexUsageRecords: IndexUsageRecord[] = []
  private maxRecords = 10_000

  constructor(options: AdvisorOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /** Record a query execution for analysis. */
  recordQuery(record: QueryRecord): void {
    this.queryRecords.push({
      ...record,
      timestamp: record.timestamp ?? Date.now(),
    })
    this.trimRecords()
  }

  /** Record a subscription invalidation event. */
  recordInvalidation(record: InvalidationRecord): void {
    this.invalidationRecords.push({
      ...record,
      timestamp: record.timestamp ?? Date.now(),
    })
    this.trimRecords()
  }

  /** Record index usage statistics. */
  recordIndexUsage(records: IndexUsageRecord[]): void {
    this.indexUsageRecords = records
  }

  /**
   * Analyze collected data and produce actionable recommendations.
   */
  analyze(): AdvisorReport {
    const now = Date.now()
    const windowStart = now - this.options.analysisWindowMs

    const recentQueries = this.queryRecords.filter((q) => (q.timestamp ?? 0) >= windowStart)
    const recentInvalidations = this.invalidationRecords.filter((i) => (i.timestamp ?? 0) >= windowStart)

    const recommendations: Recommendation[] = []

    // 1. Detect slow queries
    this.detectSlowQueries(recentQueries, recommendations)

    // 2. Detect N+1 patterns
    this.detectNPlusOne(recentQueries, recommendations)

    // 3. Detect hot subscriptions (>threshold invalidations/min)
    this.detectHotSubscriptions(recentInvalidations, recommendations)

    // 4. Detect over-fetching
    this.detectOverFetching(recentQueries, recommendations)

    // 5. Detect missing indexes (high seq scan tables)
    this.detectMissingIndexes(recentQueries, recommendations)

    // 6. Detect unused indexes
    this.detectUnusedIndexes(recommendations)

    // Sort by severity
    const severityOrder = { critical: 0, warning: 1, info: 2 }
    recommendations.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

    const uniqueQueryNames = new Set(recentQueries.map((q) => q.name))
    const tablesAnalyzed = new Set([
      ...recentQueries.flatMap((q) => q.tables),
      ...recentInvalidations.map((i) => i.table),
    ])

    return {
      recommendations,
      analyzedAt: now,
      windowMs: this.options.analysisWindowMs,
      stats: {
        totalQueries: recentQueries.length,
        totalInvalidations: recentInvalidations.length,
        uniqueQueryNames: uniqueQueryNames.size,
        tablesAnalyzed: tablesAnalyzed.size,
      },
    }
  }

  /**
   * Generate a CLI-friendly text report.
   */
  formatReport(report: AdvisorReport): string {
    const lines: string[] = [
      "═══════════════════════════════════════════════════════",
      "  ReactiveBase Performance Advisor Report",
      "═══════════════════════════════════════════════════════",
      "",
      `  Analyzed: ${report.stats.totalQueries} queries, ${report.stats.totalInvalidations} invalidations`,
      `  Tables: ${report.stats.tablesAnalyzed} | Unique queries: ${report.stats.uniqueQueryNames}`,
      `  Window: ${Math.round(report.windowMs / 1000)}s`,
      "",
    ]

    if (report.recommendations.length === 0) {
      lines.push("  ✅ No issues detected. Your setup looks healthy!")
    } else {
      lines.push(`  Found ${report.recommendations.length} recommendation(s):`)
      lines.push("")

      for (const rec of report.recommendations) {
        const icon = rec.severity === "critical" ? "🔴" : rec.severity === "warning" ? "🟡" : "🔵"
        lines.push(`  ${icon} [${rec.severity.toUpperCase()}] ${rec.title}`)
        lines.push(`     ${rec.description}`)
        lines.push(`     💡 ${rec.suggestion}`)
        lines.push(`     Impact: ${rec.impact}`)
        lines.push("")
      }
    }

    lines.push("═══════════════════════════════════════════════════════")
    return lines.join("\n")
  }

  /** Clear all recorded data. */
  reset(): void {
    this.queryRecords = []
    this.invalidationRecords = []
    this.indexUsageRecords = []
  }

  // ─── Detection Methods ─────────────────────────────────────────────

  private detectSlowQueries(queries: QueryRecord[], recommendations: Recommendation[]): void {
    const threshold = this.options.slowQueryThresholdMs
    const slowByName = new Map<string, { count: number; avgMs: number; maxMs: number; tables: string[] }>()

    for (const q of queries) {
      if (q.durationMs < threshold) continue
      const entry = slowByName.get(q.name) ?? { count: 0, avgMs: 0, maxMs: 0, tables: q.tables }
      entry.count++
      entry.avgMs = (entry.avgMs * (entry.count - 1) + q.durationMs) / entry.count
      entry.maxMs = Math.max(entry.maxMs, q.durationMs)
      slowByName.set(q.name, entry)
    }

    for (const [name, stats] of slowByName) {
      if (stats.count < 3) continue
      recommendations.push({
        type: "slow_query",
        severity: stats.maxMs > threshold * 5 ? "critical" : "warning",
        title: `Slow query: ${name}`,
        description: `"${name}" averaged ${Math.round(stats.avgMs)}ms over ${stats.count} executions (max: ${stats.maxMs}ms)`,
        queryName: name,
        suggestion: `Add an index on ${stats.tables.join(", ")} or optimize the query logic`,
        impact: stats.count > 10 ? "high" : "medium",
        evidence: { avgMs: stats.avgMs, maxMs: stats.maxMs, count: stats.count },
      })
    }
  }

  private detectNPlusOne(queries: QueryRecord[], recommendations: Recommendation[]): void {
    const windowMs = 100
    const threshold = this.options.nPlusOneThreshold
    const sorted = [...queries].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))

    for (let i = 0; i < sorted.length; i++) {
      let count = 1
      const baseQuery = sorted[i]

      for (let j = i + 1; j < sorted.length; j++) {
        if ((sorted[j].timestamp ?? 0) - (baseQuery.timestamp ?? 0) > windowMs) break
        if (sorted[j].name === baseQuery.name) count++
      }

      if (count >= threshold) {
        recommendations.push({
          type: "n_plus_one",
          severity: count >= threshold * 2 ? "critical" : "warning",
          title: `N+1 query pattern: ${baseQuery.name}`,
          description: `"${baseQuery.name}" executed ${count} times within ${windowMs}ms — likely an N+1 pattern`,
          queryName: baseQuery.name,
          suggestion: `Use .include() to eager-load related data, or batch queries with DataLoader pattern`,
          impact: "high",
          evidence: { occurrences: count, windowMs },
        })
        break
      }
    }
  }

  private detectHotSubscriptions(invalidations: InvalidationRecord[], recommendations: Recommendation[]): void {
    const threshold = this.options.hotSubscriptionThreshold
    const windowMs = this.options.analysisWindowMs
    const windowMinutes = windowMs / 60_000

    const byTable = new Map<string, { totalSubs: number; count: number }>()

    for (const inv of invalidations) {
      const entry = byTable.get(inv.table) ?? { totalSubs: 0, count: 0 }
      entry.totalSubs += inv.subscriptionCount
      entry.count++
      byTable.set(inv.table, entry)
    }

    for (const [table, stats] of byTable) {
      const ratePerMin = stats.count / Math.max(windowMinutes, 1)
      const avgSubs = Math.round(stats.totalSubs / stats.count)

      if (ratePerMin >= threshold) {
        recommendations.push({
          type: "hot_subscription",
          severity: ratePerMin >= threshold * 3 ? "critical" : "warning",
          title: `Hot subscriptions on "${table}"`,
          description: `"${table}" triggers ~${Math.round(ratePerMin)} invalidations/min affecting avg ${avgSubs} subscriptions`,
          table,
          suggestion: `Consider row-level tracking, aggregation caching, or debouncing writes to "${table}"`,
          impact: avgSubs > 50 ? "high" : "medium",
          evidence: { ratePerMin: Math.round(ratePerMin), avgSubscriptions: avgSubs, totalInvalidations: stats.count },
        })
      }
    }
  }

  private detectOverFetching(queries: QueryRecord[], recommendations: Recommendation[]): void {
    const threshold = this.options.overFetchThreshold

    const byName = new Map<string, { totalColumns: number; usedColumns: number; count: number }>()

    for (const q of queries) {
      if (!q.columnCount || !q.usedColumns) continue
      const entry = byName.get(q.name) ?? { totalColumns: 0, usedColumns: 0, count: 0 }
      entry.totalColumns += q.columnCount
      entry.usedColumns += q.usedColumns
      entry.count++
      byName.set(q.name, entry)
    }

    for (const [name, stats] of byName) {
      const avgTotal = stats.totalColumns / stats.count
      const avgUsed = stats.usedColumns / stats.count
      const unusedRatio = 1 - avgUsed / avgTotal

      if (unusedRatio >= threshold && avgTotal > 5) {
        recommendations.push({
          type: "over_fetching",
          severity: "info",
          title: `Over-fetching in "${name}"`,
          description: `"${name}" fetches avg ${Math.round(avgTotal)} columns but only uses ${Math.round(avgUsed)} (${Math.round(unusedRatio * 100)}% unused)`,
          queryName: name,
          suggestion: `Use .select() to fetch only needed columns`,
          impact: "low",
          evidence: {
            avgColumns: Math.round(avgTotal),
            avgUsed: Math.round(avgUsed),
            unusedPct: Math.round(unusedRatio * 100),
          },
        })
      }
    }
  }

  private detectMissingIndexes(queries: QueryRecord[], recommendations: Recommendation[]): void {
    // Detect tables that appear in many slow queries
    const tableSlowCount = new Map<string, number>()

    for (const q of queries) {
      if (q.durationMs < this.options.slowQueryThresholdMs) continue
      for (const table of q.tables) {
        tableSlowCount.set(table, (tableSlowCount.get(table) ?? 0) + 1)
      }
    }

    for (const [table, count] of tableSlowCount) {
      if (count >= 5) {
        recommendations.push({
          type: "missing_index",
          severity: count >= 20 ? "critical" : "warning",
          title: `Potential missing index on "${table}"`,
          description: `"${table}" appears in ${count} slow queries — likely needs an index`,
          table,
          suggestion: `Run EXPLAIN ANALYZE on slow queries targeting "${table}" and add appropriate indexes`,
          impact: "high",
          evidence: { slowQueryCount: count },
        })
      }
    }
  }

  private detectUnusedIndexes(recommendations: Recommendation[]): void {
    for (const idx of this.indexUsageRecords) {
      if (idx.scans === 0) {
        recommendations.push({
          type: "unused_index",
          severity: "info",
          title: `Unused index: ${idx.indexName}`,
          description: `Index "${idx.indexName}" on "${idx.table}" has 0 scans`,
          table: idx.table,
          suggestion: `Consider dropping unused index: DROP INDEX "${idx.indexName}";`,
          impact: "low",
          evidence: { indexName: idx.indexName, scans: 0 },
        })
      }
    }
  }

  private trimRecords(): void {
    if (this.queryRecords.length > this.maxRecords) {
      this.queryRecords = this.queryRecords.slice(-this.maxRecords)
    }
    if (this.invalidationRecords.length > this.maxRecords) {
      this.invalidationRecords = this.invalidationRecords.slice(-this.maxRecords)
    }
  }
}
