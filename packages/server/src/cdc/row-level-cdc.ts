/**
 * Row-Level CDC Adapter for ReactiveBase.
 * Extends ReactiveCdcAdapter concepts with row-level granularity:
 *   - Tracks individual row changes with primary key identity
 *   - Batches row changes by table
 *   - Computes affected subscriptions at row level (not table level)
 *   - Column-level change detection (only tracks columns that actually changed)
 *
 * Usage:
 *   const adapter = new RowLevelCdcAdapter(processChanges)
 *   adapter.trackChange({ table: "tasks", pk: "t1", operation: "update",
 *     oldValues: { title: "Old" }, newValues: { title: "New" } })
 *   const batch = adapter.flushBatch()
 */

import type { WalChangeEvent, ProcessChangesCallback, CdcAdapterStats } from "./reactive-cdc.js"
import type { ChangeEvent } from "../reactivity/invalidation-evaluator.js"
import { randomUUID } from "node:crypto"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RowChange {
  table: string
  pk: string
  operation: "insert" | "update" | "delete"
  oldValues: Record<string, unknown> | null
  newValues: Record<string, unknown> | null
  /** Columns that actually changed (computed for updates) */
  changedColumns: string[]
  timestamp: number
}

export interface RowLevelBatch {
  table: string
  changes: RowChange[]
}

export interface RowLevelCdcStats extends CdcAdapterStats {
  rowLevelHits: number
  columnLevelPrecision: number
  avgBatchSize: number
  totalBatches: number
}

export interface SubscriptionFilter {
  id: string
  table: string
  columns?: string[]
  predicate?: (row: Record<string, unknown>) => boolean
}

// ─── Row-Level CDC Adapter ───────────────────────────────────────────────────

/**
 * Enhanced CDC adapter with row-level and column-level change tracking.
 * Provides fine-grained invalidation to minimize unnecessary subscription refreshes.
 */
export class RowLevelCdcAdapter {
  private buffer: RowChange[] = []
  private processChanges: ProcessChangesCallback
  private subscriptions: SubscriptionFilter[] = []
  private stats: RowLevelCdcStats = {
    status: "stopped",
    eventsProcessed: 0,
    batchesProcessed: 0,
    lastLsn: null,
    lastEventTimestamp: null,
    avgBatchLatencyMs: 0,
    rowLevelHits: 0,
    tableLevelFallbacks: 0,
    columnLevelPrecision: 0,
    avgBatchSize: 0,
    totalBatches: 0,
    errors: 0,
  }
  private totalBatchLatencyMs = 0
  private columnLevelTotal = 0
  private columnLevelPreciseHits = 0

  constructor(processChanges: ProcessChangesCallback) {
    this.processChanges = processChanges
    this.stats.status = "streaming"
  }

  private generateId(prefix: string): string {
    return `${prefix}_${randomUUID()}`
  }

  // ─── Subscription Management ────────────────────────────────────────────

  /**
   * Register a subscription filter for row-level matching.
   */
  addSubscription(filter: SubscriptionFilter): void {
    this.subscriptions.push(filter)
  }

  /**
   * Remove a subscription filter.
   */
  removeSubscription(id: string): void {
    this.subscriptions = this.subscriptions.filter((s) => s.id !== id)
  }

  // ─── Change Tracking ───────────────────────────────────────────────────

  /**
   * Track a row-level change from a WAL event.
   */
  trackChange(event: {
    table: string
    pk: string
    operation: "insert" | "update" | "delete"
    oldValues?: Record<string, unknown> | null
    newValues?: Record<string, unknown> | null
  }): void {
    const changedColumns = this.detectChangedColumns(event.oldValues ?? null, event.newValues ?? null)

    const change: RowChange = {
      table: event.table,
      pk: event.pk,
      operation: event.operation,
      oldValues: event.oldValues ?? null,
      newValues: event.newValues ?? null,
      changedColumns,
      timestamp: Date.now(),
    }

    this.buffer.push(change)
    this.stats.eventsProcessed++
    this.stats.rowLevelHits++

    if (changedColumns.length > 0) {
      this.columnLevelTotal++
      this.columnLevelPreciseHits++
    } else if (event.operation === "update") {
      this.columnLevelTotal++
    }

    this.updateColumnPrecision()
  }

  /**
   * Track a WAL change event (compatible with ReactiveCdcAdapter).
   */
  trackWalChange(event: WalChangeEvent): void {
    this.trackChange({
      table: event.table,
      pk: event.rowId ?? this.generateId("row"),
      operation: event.operation,
      oldValues: event.oldValues,
      newValues: event.newValues,
    })
    this.stats.lastLsn = event.lsn
    this.stats.lastEventTimestamp = event.timestamp
  }

  // ─── Batch Processing ──────────────────────────────────────────────────

  /**
   * Get current buffered changes grouped by table.
   */
  getBatches(): RowLevelBatch[] {
    const tableMap = new Map<string, RowChange[]>()
    for (const change of this.buffer) {
      const existing = tableMap.get(change.table) ?? []
      existing.push(change)
      tableMap.set(change.table, existing)
    }
    return Array.from(tableMap.entries()).map(([table, changes]) => ({ table, changes }))
  }

  /**
   * Flush buffered changes, compute affected subscriptions, and forward to pipeline.
   */
  async flush(): Promise<RowLevelBatch[]> {
    if (this.buffer.length === 0) return []

    const batchStart = performance.now()
    const batches = this.getBatches()
    const _changes = this.buffer.splice(0)

    // Convert to ChangeEvents and forward
    const tables: string[] = []
    const events: ChangeEvent[] = []

    for (const batch of batches) {
      tables.push(batch.table)
      for (const change of batch.changes) {
        events.push({
          table: change.table,
          operation: change.operation,
          affectedFilters: change.newValues ?? undefined,
          oldValues: change.oldValues ?? undefined,
        })
      }
    }

    await this.processChanges(tables, events)

    // Update stats
    const batchLatency = performance.now() - batchStart
    this.stats.batchesProcessed++
    this.stats.totalBatches++
    this.totalBatchLatencyMs += batchLatency
    this.stats.avgBatchLatencyMs = Math.round((this.totalBatchLatencyMs / this.stats.batchesProcessed) * 100) / 100
    this.stats.avgBatchSize = Math.round((this.stats.eventsProcessed / this.stats.totalBatches) * 100) / 100

    return batches
  }

  // ─── Affected Subscriptions ────────────────────────────────────────────

  /**
   * Compute which subscriptions are affected by a row change.
   * Uses column-level precision to avoid false invalidations.
   */
  computeAffectedSubscriptions(change: RowChange): string[] {
    const affected: string[] = []

    for (const sub of this.subscriptions) {
      if (sub.table !== change.table) continue

      // Column-level check: if subscription specifies columns, only match if changed columns overlap
      if (sub.columns && sub.columns.length > 0 && change.changedColumns.length > 0) {
        const hasOverlap = change.changedColumns.some((col) => sub.columns!.includes(col))
        if (!hasOverlap) continue
      }

      // Predicate check
      if (sub.predicate) {
        const values = change.newValues ?? change.oldValues
        if (values && !sub.predicate(values)) continue
      }

      affected.push(sub.id)
    }

    return affected
  }

  // ─── Stats ─────────────────────────────────────────────────────────────

  getStats(): RowLevelCdcStats {
    return { ...this.stats }
  }

  resetStats(): void {
    this.stats = {
      status: this.stats.status,
      eventsProcessed: 0,
      batchesProcessed: 0,
      lastLsn: null,
      lastEventTimestamp: null,
      avgBatchLatencyMs: 0,
      rowLevelHits: 0,
      tableLevelFallbacks: 0,
      columnLevelPrecision: 0,
      avgBatchSize: 0,
      totalBatches: 0,
      errors: 0,
    }
    this.totalBatchLatencyMs = 0
    this.columnLevelTotal = 0
    this.columnLevelPreciseHits = 0
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  /**
   * Detect which columns actually changed between old and new values.
   */
  private detectChangedColumns(
    oldValues: Record<string, unknown> | null,
    newValues: Record<string, unknown> | null,
  ): string[] {
    if (!oldValues || !newValues) return []

    const changed: string[] = []
    const allKeys = new Set([...Object.keys(oldValues), ...Object.keys(newValues)])

    for (const key of allKeys) {
      if (oldValues[key] !== newValues[key]) {
        changed.push(key)
      }
    }

    return changed
  }

  private updateColumnPrecision(): void {
    this.stats.columnLevelPrecision =
      this.columnLevelTotal > 0 ? Math.round((this.columnLevelPreciseHits / this.columnLevelTotal) * 100) / 100 : 0
  }
}
