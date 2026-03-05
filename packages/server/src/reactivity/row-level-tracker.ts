/**
 * Row-Level Reactive Subscriptions (Level 3).
 * Extends the filter-level invalidation with optional row-level tracking.
 *
 * Features:
 *   - Track exact row IDs returned by queries
 *   - Bloom filter for memory-efficient row set storage
 *   - Precise invalidation: only re-execute when tracked rows change
 *   - Auto-fallback to filter-level when row count exceeds threshold
 *   - Configurable per-query via reactivity option
 *
 * Usage:
 *   const tracker = new RowLevelTracker({ maxRowsPerSubscription: 10000 })
 *   tracker.trackResult(subscriptionId, ["row-1", "row-2", "row-3"])
 *   const shouldInvalidate = tracker.shouldInvalidate(subscriptionId, ["row-2"])
 */

// Re-export BloomFilter and AutoTunedBloomFilter from their own module
export { BloomFilter, AutoTunedBloomFilter } from "./bloom-filter.js"
import { BloomFilter } from "./bloom-filter.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RowLevelTrackerOptions {
  /** Max rows to track per subscription before falling back to filter-level (default: 10000) */
  maxRowsPerSubscription?: number
  /** Bloom filter false positive rate (default: 0.01) */
  bloomFilterFpRate?: number
  /** Enable bloom filters for large row sets (default: true) */
  useBloomFilters?: boolean
  /** Callback when subscription falls back to filter-level */
  onFallback?: (subscriptionId: string, rowCount: number) => void
}

export interface RowTrackingState {
  subscriptionId: string
  /** Tracked row IDs (exact set when small, bloom filter when large) */
  trackedRows: Set<string> | BloomFilter
  /** Whether this subscription is using exact tracking or bloom filter */
  mode: "exact" | "bloom" | "fallback"
  /** Number of rows at last tracking */
  rowCount: number
  /** Timestamp of last tracking */
  lastTrackedAt: number
  /** Table name this tracking belongs to */
  table: string
}

export interface RowInvalidationResult {
  subscriptionId: string
  shouldInvalidate: boolean
  /** Why invalidation was triggered */
  reason: "row-match" | "bloom-possible-match" | "fallback" | "new-row" | "deleted-row"
  /** Rows that matched (if using exact tracking) */
  matchedRows?: string[]
}

export interface RowLevelStats {
  totalSubscriptions: number
  exactTrackingCount: number
  bloomFilterCount: number
  fallbackCount: number
  totalTrackedRows: number
  avgRowsPerSubscription: number
  memoryEstimateBytes: number
}

// ─── Persistence SQL ─────────────────────────────────────────────────────────

/**
 * Generate SQL to create the row tracking table.
 *
 * @returns SQL DDL statement for the row tracking table and index
 */
export function generateRowTrackingTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_row_tracking (
  subscription_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_ids TEXT[] NOT NULL DEFAULT '{}',
  mode TEXT NOT NULL DEFAULT 'exact',
  row_count INTEGER NOT NULL DEFAULT 0,
  tracked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subscription_id, table_name)
);

CREATE INDEX IF NOT EXISTS idx_row_tracking_table
  ON _reactivebase_row_tracking(table_name);
`.trim()
}

/**
 * Build an upsert SQL statement for row tracking data.
 *
 * @param subscriptionId - Subscription identifier
 * @param table - Table name being tracked
 * @param rowIds - Array of tracked row IDs
 * @param mode - Tracking mode (exact, bloom, or fallback)
 * @returns Object containing the SQL string and parameter values
 */
export function buildUpsertRowTrackingSQL(
  subscriptionId: string,
  table: string,
  rowIds: string[],
  mode: string,
): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_row_tracking (subscription_id, table_name, row_ids, mode, row_count)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (subscription_id, table_name) DO UPDATE SET
  row_ids = $3,
  mode = $4,
  row_count = $5,
  tracked_at = NOW()`,
    params: [subscriptionId, table, rowIds, mode, rowIds.length],
  }
}

/**
 * Build a SQL statement to delete row tracking data for a subscription.
 *
 * @param subscriptionId - Subscription identifier to delete tracking for
 * @returns Object containing the SQL string and parameter values
 */
export function buildDeleteRowTrackingSQL(subscriptionId: string): { sql: string; params: unknown[] } {
  return {
    sql: `DELETE FROM _reactivebase_row_tracking WHERE subscription_id = $1`,
    params: [subscriptionId],
  }
}

/**
 * Build a SQL query to find subscriptions affected by changes to specific rows.
 *
 * @param table - Table name where changes occurred
 * @param rowIds - Array of changed row IDs
 * @returns Object containing the SQL string and parameter values
 */
export function buildGetAffectedSubscriptionsSQL(table: string, rowIds: string[]): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT subscription_id FROM _reactivebase_row_tracking
WHERE table_name = $1 AND (mode = 'fallback' OR row_ids && $2)`,
    params: [table, rowIds],
  }
}

// ─── Row-Level Tracker ───────────────────────────────────────────────────────

const DEFAULT_ROW_LEVEL_OPTIONS: Required<RowLevelTrackerOptions> = {
  maxRowsPerSubscription: 10_000,
  bloomFilterFpRate: 0.01,
  useBloomFilters: true,
  onFallback: () => {},
}

export class RowLevelTracker {
  private options: Required<RowLevelTrackerOptions>
  private tracking = new Map<string, Map<string, RowTrackingState>>()

  /**
   * Create a new RowLevelTracker.
   *
   * @param options - Configuration options for row-level tracking
   */
  constructor(options: RowLevelTrackerOptions = {}) {
    this.options = { ...DEFAULT_ROW_LEVEL_OPTIONS, ...options }
  }

  get subscriptionCount(): number {
    return this.tracking.size
  }

  /**
   * Track the row IDs returned by a query for a subscription.
   *
   * @param subscriptionId - Subscription identifier
   * @param table - Table name to track rows for
   * @param rowIds - Array of primary key values from the query result
   * @returns The resulting tracking state
   */
  trackResult(subscriptionId: string, table: string, rowIds: string[]): RowTrackingState {
    if (!this.tracking.has(subscriptionId)) {
      this.tracking.set(subscriptionId, new Map())
    }

    const tableMap = this.tracking.get(subscriptionId)!
    let mode: RowTrackingState["mode"]
    let trackedRows: Set<string> | BloomFilter

    if (rowIds.length > this.options.maxRowsPerSubscription) {
      // Too many rows — fall back to filter-level
      mode = "fallback"
      trackedRows = new Set<string>()
      this.options.onFallback(subscriptionId, rowIds.length)
    } else if (this.options.useBloomFilters && rowIds.length > this.options.maxRowsPerSubscription / 2) {
      // Large row set — use bloom filter
      mode = "bloom"
      const bloom = new BloomFilter(rowIds.length, this.options.bloomFilterFpRate)
      for (const id of rowIds) bloom.add(id)
      trackedRows = bloom
    } else {
      // Small row set — exact tracking
      mode = "exact"
      trackedRows = new Set(rowIds)
    }

    const state: RowTrackingState = {
      subscriptionId,
      trackedRows,
      mode,
      rowCount: rowIds.length,
      lastTrackedAt: Date.now(),
      table,
    }

    tableMap.set(table, state)
    return state
  }

  /**
   * Check if a subscription should be invalidated based on changed row IDs.
   *
   * @param subscriptionId - Subscription identifier to check
   * @param table - Table where changes occurred
   * @param changedRowIds - Row IDs that were modified
   * @param operation - Type of data change operation
   * @returns Invalidation result with match details
   */
  checkInvalidation(
    subscriptionId: string,
    table: string,
    changedRowIds: string[],
    operation: "insert" | "update" | "delete",
  ): RowInvalidationResult {
    const tableMap = this.tracking.get(subscriptionId)
    if (!tableMap || !tableMap.has(table)) {
      return {
        subscriptionId,
        shouldInvalidate: true,
        reason: "fallback",
      }
    }

    const state = tableMap.get(table)!

    // Fallback mode — always invalidate
    if (state.mode === "fallback") {
      return { subscriptionId, shouldInvalidate: true, reason: "fallback" }
    }

    // New inserts always need re-evaluation (the query might now include them)
    if (operation === "insert") {
      return { subscriptionId, shouldInvalidate: true, reason: "new-row" }
    }

    // Check each changed row against tracked set
    const matchedRows: string[] = []

    if (state.trackedRows instanceof Set) {
      // Exact mode
      for (const rowId of changedRowIds) {
        if (state.trackedRows.has(rowId)) {
          matchedRows.push(rowId)
        }
      }

      if (matchedRows.length > 0) {
        return {
          subscriptionId,
          shouldInvalidate: true,
          reason: operation === "delete" ? "deleted-row" : "row-match",
          matchedRows,
        }
      }

      return { subscriptionId, shouldInvalidate: false, reason: "row-match" }
    }

    // Bloom filter mode
    const bloom = state.trackedRows as BloomFilter
    for (const rowId of changedRowIds) {
      if (bloom.has(rowId)) {
        matchedRows.push(rowId)
      }
    }

    if (matchedRows.length > 0) {
      return {
        subscriptionId,
        shouldInvalidate: true,
        reason: "bloom-possible-match",
        matchedRows,
      }
    }

    return { subscriptionId, shouldInvalidate: false, reason: "bloom-possible-match" }
  }

  /**
   * Evaluate all subscriptions for a table against a set of changes.
   *
   * @param table - Table where changes occurred
   * @param changedRowIds - Row IDs that were modified
   * @param operation - Type of data change operation
   * @returns Array of invalidation results for all affected subscriptions
   */
  evaluateChanges(
    table: string,
    changedRowIds: string[],
    operation: "insert" | "update" | "delete",
  ): RowInvalidationResult[] {
    const results: RowInvalidationResult[] = []

    for (const [subscriptionId, tableMap] of this.tracking) {
      if (tableMap.has(table)) {
        results.push(this.checkInvalidation(subscriptionId, table, changedRowIds, operation))
      }
    }

    return results
  }

  /**
   * Remove tracking for a subscription.
   *
   * @param subscriptionId - Subscription identifier to remove tracking for
   */
  removeSubscription(subscriptionId: string): void {
    this.tracking.delete(subscriptionId)
  }

  /**
   * Get tracking state for a subscription.
   *
   * @param subscriptionId - Subscription identifier
   * @returns Map of table names to tracking states, or undefined if not tracked
   */
  getTrackingState(subscriptionId: string): Map<string, RowTrackingState> | undefined {
    return this.tracking.get(subscriptionId)
  }

  /**
   * Get statistics about current tracking state.
   *
   * @returns Summary statistics including counts, memory usage, and averages
   */
  getStats(): RowLevelStats {
    let exactCount = 0
    let bloomCount = 0
    let fallbackCount = 0
    let totalRows = 0
    let memoryEstimate = 0

    for (const tableMap of this.tracking.values()) {
      for (const state of tableMap.values()) {
        totalRows += state.rowCount
        switch (state.mode) {
          case "exact":
            exactCount++
            memoryEstimate += state.rowCount * 40 // ~40 bytes per Set entry
            break
          case "bloom":
            bloomCount++
            memoryEstimate += (state.trackedRows as BloomFilter).memoryBytes
            break
          case "fallback":
            fallbackCount++
            break
        }
      }
    }

    const totalSubs = this.tracking.size
    return {
      totalSubscriptions: totalSubs,
      exactTrackingCount: exactCount,
      bloomFilterCount: bloomCount,
      fallbackCount,
      totalTrackedRows: totalRows,
      avgRowsPerSubscription: totalSubs > 0 ? totalRows / totalSubs : 0,
      memoryEstimateBytes: memoryEstimate,
    }
  }

  /**
   * Reset all tracking state.
   */
  reset(): void {
    this.tracking.clear()
  }
}

// ─── Auto-Level Types ────────────────────────────────────────────────────────

/** Tracking granularity level */
export type TrackingLevel = 1 | 2 | 3

/** Decision returned by the auto-level tracker */
export interface LevelDecision {
  level: TrackingLevel
  reason: string
}

export interface AutoLevelTrackerOptions {
  /** Row count threshold to enable Level 2 (filter-level) tracking (default: 1000) */
  tableSizeThresholdL2?: number
  /** Row count threshold to enable Level 3 (row-level) tracking (default: 100000) */
  tableSizeThresholdL3?: number
  /** Subscription count per table to prefer Level 3 (default: 10) */
  subscriptionThresholdL3?: number
  /** Options forwarded to the internal RowLevelTracker */
  rowLevelTrackerOptions?: RowLevelTrackerOptions
}

/** Metrics collected per table for adaptive level tuning */
export interface TableInvalidationMetrics {
  table: string
  totalInvalidations: number
  falseInvalidations: number
  avgSubscriptionsInvalidated: number
  lastRowCount: number
  lastSubscriptionCount: number
  sampledAt: number
}

// ─── Auto-Level Tracker ──────────────────────────────────────────────────────

const DEFAULT_AUTO_LEVEL_OPTIONS: Required<Omit<AutoLevelTrackerOptions, "rowLevelTrackerOptions">> = {
  tableSizeThresholdL2: 1_000,
  tableSizeThresholdL3: 100_000,
  subscriptionThresholdL3: 10,
}

/**
 * Automatically selects the optimal tracking level (1/2/3) based on
 * table size and subscription count. Delegates to an internal
 * RowLevelTracker when Level 3 is chosen. Tracks invalidation metrics
 * to adaptively tune levels over time.
 */
export class AutoLevelTracker {
  private options: Required<Omit<AutoLevelTrackerOptions, "rowLevelTrackerOptions">>
  private rowTracker: RowLevelTracker
  private tableMetrics = new Map<string, TableInvalidationMetrics>()
  private levelOverrides = new Map<string, TrackingLevel>()

  /**
   * Create a new AutoLevelTracker.
   *
   * @param options - Configuration options including thresholds and row-level tracker options
   */
  constructor(options: AutoLevelTrackerOptions = {}) {
    const { rowLevelTrackerOptions, ...rest } = options
    this.options = { ...DEFAULT_AUTO_LEVEL_OPTIONS, ...rest }
    this.rowTracker = new RowLevelTracker(rowLevelTrackerOptions)
  }

  /** Access the underlying RowLevelTracker used for Level 3. */
  get tracker(): RowLevelTracker {
    return this.rowTracker
  }

  /**
   * Determine the appropriate tracking level for a table.
   * Uses overrides from adaptive tuning if available.
   *
   * @param table - Table name
   * @param tableRowCount - Approximate number of rows in the table
   * @param subscriptionCount - Number of active subscriptions for this table
   * @returns A decision object with the chosen level and reasoning
   */
  determineLevel(table: string, tableRowCount: number, subscriptionCount: number): LevelDecision {
    // Check for adaptive overrides first
    const override = this.levelOverrides.get(table)
    if (override !== undefined) {
      return { level: override, reason: `adaptive override for ${table} based on invalidation metrics` }
    }

    // Small tables — table-level invalidation is sufficient
    if (tableRowCount < this.options.tableSizeThresholdL2) {
      return {
        level: 1,
        reason: `table ${table} has ${tableRowCount} rows (< L2 threshold ${this.options.tableSizeThresholdL2})`,
      }
    }

    // Large tables with many subscriptions — row-level pays off
    if (
      tableRowCount >= this.options.tableSizeThresholdL3 &&
      subscriptionCount >= this.options.subscriptionThresholdL3
    ) {
      return {
        level: 3,
        reason: `table ${table} has ${tableRowCount} rows (>= L3 threshold) and ${subscriptionCount} subscriptions (>= ${this.options.subscriptionThresholdL3})`,
      }
    }

    // Everything in between — filter-level
    return { level: 2, reason: `table ${table} has ${tableRowCount} rows (>= L2 threshold, below L3 criteria)` }
  }

  /**
   * Record an invalidation event for adaptive tuning.
   *
   * @param table - Table name
   * @param subscriptionsInvalidated - Number of subscriptions invalidated
   * @param wasFalseInvalidation - Whether the invalidation turned out to be unnecessary
   * @param tableRowCount - Current table row count
   * @param subscriptionCount - Current subscription count for this table
   */
  recordInvalidation(
    table: string,
    subscriptionsInvalidated: number,
    wasFalseInvalidation: boolean,
    tableRowCount: number,
    subscriptionCount: number,
  ): void {
    let metrics = this.tableMetrics.get(table)
    if (!metrics) {
      metrics = {
        table,
        totalInvalidations: 0,
        falseInvalidations: 0,
        avgSubscriptionsInvalidated: 0,
        lastRowCount: tableRowCount,
        lastSubscriptionCount: subscriptionCount,
        sampledAt: Date.now(),
      }
      this.tableMetrics.set(table, metrics)
    }

    metrics.totalInvalidations++
    if (wasFalseInvalidation) metrics.falseInvalidations++
    metrics.avgSubscriptionsInvalidated =
      (metrics.avgSubscriptionsInvalidated * (metrics.totalInvalidations - 1) + subscriptionsInvalidated) /
      metrics.totalInvalidations
    metrics.lastRowCount = tableRowCount
    metrics.lastSubscriptionCount = subscriptionCount
    metrics.sampledAt = Date.now()

    // Adaptive level tuning: promote to higher level if false invalidation rate is high
    if (metrics.totalInvalidations >= 50) {
      const falseRate = metrics.falseInvalidations / metrics.totalInvalidations
      const currentLevel = this.determineLevel(table, tableRowCount, subscriptionCount).level

      if (falseRate > 0.3 && currentLevel < 3) {
        this.levelOverrides.set(table, (currentLevel + 1) as TrackingLevel)
      } else if (falseRate < 0.05 && currentLevel > 1) {
        // Demote if false rate is very low — cheaper level is sufficient
        this.levelOverrides.set(table, (currentLevel - 1) as TrackingLevel)
      }
    }
  }

  /** Get invalidation metrics for a specific table */
  getTableMetrics(table: string): TableInvalidationMetrics | undefined {
    return this.tableMetrics.get(table)
  }

  /** Get all table metrics */
  getAllMetrics(): TableInvalidationMetrics[] {
    return [...this.tableMetrics.values()]
  }

  /** Clear any adaptive overrides, returning to heuristic-based level selection */
  clearOverrides(): void {
    this.levelOverrides.clear()
  }

  /**
   * Evaluate changes using the automatically determined level.
   *
   * - Level 1: always invalidate all subscriptions for the table.
   * - Level 2: always invalidate (caller is expected to apply filter logic).
   * - Level 3: delegate to RowLevelTracker for precise row matching.
   *
   * @param table - Table where changes occurred
   * @param changedRowIds - Row IDs that were modified
   * @param operation - Type of data change operation
   * @param tableRowCount - Approximate number of rows in the table
   * @param subscriptionCount - Number of active subscriptions for this table
   * @returns The chosen tracking level and array of invalidation results
   */
  evaluateChangesAutoLevel(
    table: string,
    changedRowIds: string[],
    operation: "insert" | "update" | "delete",
    tableRowCount: number,
    subscriptionCount: number,
  ): { level: TrackingLevel; results: RowInvalidationResult[] } {
    const { level } = this.determineLevel(table, tableRowCount, subscriptionCount)

    if (level === 3) {
      return { level, results: this.rowTracker.evaluateChanges(table, changedRowIds, operation) }
    }

    // For L1/L2 we report all subscriptions as needing invalidation
    const results: RowInvalidationResult[] = this.rowTracker.evaluateChanges(table, changedRowIds, operation)

    // If the row tracker has no subscriptions for this table, return empty
    if (results.length === 0) {
      return { level, results: [] }
    }

    // Override: force invalidation for every subscription at L1/L2
    return {
      level,
      results: results.map((r) => ({
        ...r,
        shouldInvalidate: true,
        reason: "fallback" as const,
      })),
    }
  }

  /**
   * Reset the underlying row-level tracker and all metrics.
   */
  reset(): void {
    this.rowTracker.reset()
    this.tableMetrics.clear()
    this.levelOverrides.clear()
  }
}

// ─── Query Primary Key Capture ───────────────────────────────────────────────

/**
 * Captures primary key values from query result rows and optionally
 * feeds them into a RowLevelTracker for automatic row-level tracking.
 */
export class QueryPrimaryKeyCapture {
  private keysByQuery = new Map<string, Set<string>>()
  private rowTracker: RowLevelTracker | null

  /**
   * Create a new QueryPrimaryKeyCapture.
   *
   * @param rowTracker - Optional RowLevelTracker for automatic tracking integration
   */
  constructor(rowTracker?: RowLevelTracker) {
    this.rowTracker = rowTracker ?? null
  }

  /**
   * Extract primary key values from query result rows.
   *
   * @param queryName - Name of the query to associate keys with
   * @param rows - Result rows to extract keys from
   * @param primaryKeyColumn - Name of the primary key column
   * @returns Set of extracted primary key values
   */
  capturePrimaryKeys(queryName: string, rows: Record<string, unknown>[], primaryKeyColumn: string): Set<string> {
    const keys = new Set<string>()
    for (const row of rows) {
      const value = row[primaryKeyColumn]
      if (value !== undefined && value !== null) {
        keys.add(String(value))
      }
    }
    this.keysByQuery.set(queryName, keys)
    return keys
  }

  /**
   * Get the tracked primary keys for a query.
   *
   * @param queryName - Name of the query
   * @returns Set of tracked primary key values
   */
  getTrackedKeys(queryName: string): Set<string> {
    return this.keysByQuery.get(queryName) ?? new Set()
  }

  /**
   * Clear tracked keys for a query.
   *
   * @param queryName - Name of the query to clear keys for
   */
  clearTrackedKeys(queryName: string): void {
    this.keysByQuery.delete(queryName)
  }

  /**
   * Capture primary keys and automatically track them in the RowLevelTracker.
   *
   * @param subscriptionId - Subscription identifier
   * @param table - Table name
   * @param rows - Result rows to extract keys from
   * @param pkColumn - Primary key column name
   * @returns The tracking state, or null if no RowLevelTracker is configured
   */
  captureAndTrack(
    subscriptionId: string,
    table: string,
    rows: Record<string, unknown>[],
    pkColumn: string,
  ): RowTrackingState | null {
    const keys = this.capturePrimaryKeys(subscriptionId, rows, pkColumn)

    if (!this.rowTracker) {
      return null
    }

    return this.rowTracker.trackResult(subscriptionId, table, [...keys])
  }

  /**
   * Reset all captured keys.
   */
  reset(): void {
    this.keysByQuery.clear()
  }
}

// ─── Table Stats SQL ─────────────────────────────────────────────────────────

/**
 * Build a SQL statement that returns the approximate row count for a table.
 * Uses the pg_class catalog for a fast estimate.
 *
 * @param table - Table name to get stats for
 * @returns Object containing the SQL string and parameter values
 */
export function buildGetTableStatsSQL(table: string): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT reltuples::bigint AS row_count FROM pg_class WHERE relname = $1`,
    params: [table],
  }
}
