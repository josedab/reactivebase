/**
 * End-to-end IVM Pipeline for ReactiveBase.
 * Connects CDC → IncrementalViewMaintainer → DeltaPatchEncoder to deliver
 * incremental view updates from database changes to client patches.
 *
 * Usage:
 *   const pipeline = new IvmPipeline()
 *   pipeline.registerView({ viewId: "v1", queryAst: ..., currentResult: [...] })
 *   const patches = pipeline.processChange({ table: "tasks", type: "insert", newRow: {...} })
 *   // patches = [Uint8Array, ...]  ready for WebSocket delivery
 */

import { IncrementalViewMaintainer } from "./ivm.js"
import type { DataChange, Row, QueryAstNode, ViewDelta, IvmStats } from "./ivm.js"
import { DeltaPatchEncoder, computeChecksum } from "./delta-protocol.js"
import type { DeltaPatch } from "./delta-protocol.js"
import { randomUUID } from "node:crypto"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PipelineStats {
  deltaApplied: number
  fullRefreshes: number
  avgComputationTimeMs: number
  totalChangesProcessed: number
  /** Ratio of delta-applied to full-refresh — target is ≥10x */
  efficiencyRatio: number
  totalPatchBytes: number
}

export interface PipelineResult {
  viewId: string
  delta: ViewDelta
  encoded: Uint8Array | null
  patch: DeltaPatch | null
  usedDelta: boolean
}

// ─── IVM Pipeline ────────────────────────────────────────────────────────────

/**
 * Orchestrates the full CDC → IVM → Delta Protocol pipeline.
 * Accepts data changes, computes incremental deltas, and encodes them
 * as compact patches ready for WebSocket transport.
 */
export class IvmPipeline {
  private ivm = new IncrementalViewMaintainer()
  private encoder = new DeltaPatchEncoder()
  private sequenceCounters = new Map<string, number>()
  private stats: PipelineStats = {
    deltaApplied: 0,
    fullRefreshes: 0,
    avgComputationTimeMs: 0,
    totalChangesProcessed: 0,
    efficiencyRatio: 0,
    totalPatchBytes: 0,
  }
  private totalComputationTimeMs = 0

  private generateId(prefix: string): string {
    return `${prefix}_${randomUUID()}`
  }

  // ─── View Management ───────────────────────────────────────────────────

  /**
   * Register a view for incremental maintenance in the pipeline.
   */
  registerView(config: { viewId: string; queryAst: QueryAstNode; currentResult: Row[] }): void {
    this.ivm.register(config)
    this.sequenceCounters.set(config.viewId, 0)
  }

  /**
   * Unregister a view from the pipeline.
   */
  unregisterView(viewId: string): void {
    this.ivm.unregister(viewId)
    this.sequenceCounters.delete(viewId)
  }

  // ─── Change Processing ─────────────────────────────────────────────────

  /**
   * Process a data change through the full pipeline.
   * Returns encoded patches for all affected views.
   */
  processChange(change: DataChange): PipelineResult[] {
    const start = performance.now()
    const deltas = this.ivm.applyChange(change)
    const results: PipelineResult[] = []

    for (const delta of deltas) {
      if (delta.requiresFullRefresh) {
        this.stats.fullRefreshes++
        results.push({
          viewId: delta.viewId,
          delta,
          encoded: null,
          patch: null,
          usedDelta: false,
        })
        continue
      }

      // Increment sequence number
      const seq = (this.sequenceCounters.get(delta.viewId) ?? 0) + 1
      this.sequenceCounters.set(delta.viewId, seq)

      // Build patch
      const content = JSON.stringify({
        i: delta.inserts,
        d: delta.deletes,
        u: delta.updates,
      })
      const checksum = computeChecksum(content)

      const patch: DeltaPatch = {
        viewId: delta.viewId,
        sequence: seq,
        inserts: delta.inserts,
        deletes: delta.deletes,
        updates: delta.updates,
        checksum,
      }

      // Encode
      const encoded = this.encoder.encode(patch)

      this.stats.deltaApplied++
      this.stats.totalPatchBytes += encoded.length

      results.push({
        viewId: delta.viewId,
        delta,
        encoded,
        patch,
        usedDelta: true,
      })
    }

    // Update stats
    const elapsed = performance.now() - start
    this.stats.totalChangesProcessed++
    this.totalComputationTimeMs += elapsed
    this.stats.avgComputationTimeMs =
      Math.round((this.totalComputationTimeMs / this.stats.totalChangesProcessed) * 100) / 100
    this.updateEfficiencyRatio()

    return results
  }

  /**
   * Process multiple changes in batch.
   */
  processBatch(changes: DataChange[]): PipelineResult[] {
    const results: PipelineResult[] = []
    for (const change of changes) {
      results.push(...this.processChange(change))
    }
    return results
  }

  // ─── Metrics ───────────────────────────────────────────────────────────

  /**
   * Get pipeline efficiency metrics.
   * The efficiencyRatio shows delta-applied vs full-refresh ratio — target is ≥10x.
   */
  getEfficiencyMetrics(): PipelineStats {
    return { ...this.stats }
  }

  /**
   * Get IVM-level stats from the underlying IncrementalViewMaintainer.
   */
  getIvmStats(): IvmStats {
    return this.ivm.getStats()
  }

  /**
   * Get the current cached result for a view.
   */
  getViewResult(viewId: string): Row[] | undefined {
    return this.ivm.getResult(viewId)
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private updateEfficiencyRatio(): void {
    const total = this.stats.deltaApplied + this.stats.fullRefreshes
    this.stats.efficiencyRatio =
      total > 0 ? Math.round((this.stats.deltaApplied / Math.max(this.stats.fullRefreshes, 1)) * 100) / 100 : 0
  }
}
