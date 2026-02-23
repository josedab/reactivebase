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

// ─── Bloom Filter ────────────────────────────────────────────────────────────

/**
 * Simple Bloom filter for memory-efficient set membership testing.
 * Uses multiple hash functions to reduce false positive rate.
 */
export class BloomFilter {
  private bits: Uint8Array
  private hashCount: number
  private size: number
  private insertedCount = 0

  constructor(expectedItems: number, falsePositiveRate: number = 0.01) {
    // Calculate optimal size and hash count
    this.size = Math.max(64, Math.ceil((-expectedItems * Math.log(falsePositiveRate)) / (Math.LN2 * Math.LN2)))
    this.hashCount = Math.max(1, Math.round((this.size / expectedItems) * Math.LN2))
    this.bits = new Uint8Array(Math.ceil(this.size / 8))
  }

  add(value: string): void {
    for (const pos of this.getPositions(value)) {
      this.bits[Math.floor(pos / 8)] |= 1 << (pos % 8)
    }
    this.insertedCount++
  }

  has(value: string): boolean {
    for (const pos of this.getPositions(value)) {
      if (!(this.bits[Math.floor(pos / 8)] & (1 << (pos % 8)))) {
        return false
      }
    }
    return true
  }

  get count(): number {
    return this.insertedCount
  }

  get memoryBytes(): number {
    return this.bits.length
  }

  private getPositions(value: string): number[] {
    const positions: number[] = []
    const h1 = this.fnv1a(value)
    const h2 = this.murmur3Like(value)

    for (let i = 0; i < this.hashCount; i++) {
      positions.push(Math.abs((h1 + i * h2) % this.size))
    }
    return positions
  }

  private fnv1a(str: string): number {
    let hash = 0x811c9dc5
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i)
      hash = (hash * 0x01000193) >>> 0
    }
    return hash
  }

  private murmur3Like(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
    }
    return Math.abs(hash) || 1
  }
}

// ─── Persistence SQL ─────────────────────────────────────────────────────────

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

export function buildDeleteRowTrackingSQL(subscriptionId: string): { sql: string; params: unknown[] } {
  return {
    sql: `DELETE FROM _reactivebase_row_tracking WHERE subscription_id = $1`,
    params: [subscriptionId],
  }
}

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

  constructor(options: RowLevelTrackerOptions = {}) {
    this.options = { ...DEFAULT_ROW_LEVEL_OPTIONS, ...options }
  }

  get subscriptionCount(): number {
    return this.tracking.size
  }

  /**
   * Track the row IDs returned by a query for a subscription.
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
   */
  removeSubscription(subscriptionId: string): void {
    this.tracking.delete(subscriptionId)
  }

  /**
   * Get tracking state for a subscription.
   */
  getTrackingState(subscriptionId: string): Map<string, RowTrackingState> | undefined {
    return this.tracking.get(subscriptionId)
  }

  /**
   * Get statistics about current tracking state.
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
