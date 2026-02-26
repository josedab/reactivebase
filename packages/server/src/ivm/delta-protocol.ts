/**
 * Client Delta Patch Protocol for ReactiveBase IVM.
 * Encodes/decodes view deltas into compact patches for WebSocket transport.
 * Supports patch accumulation and merging for efficient batched delivery.
 *
 * Usage:
 *   const encoder = new DeltaPatchEncoder()
 *   const bytes = encoder.encode(patch)
 *   const decoder = new DeltaPatchDecoder()
 *   const decoded = decoder.decode(bytes)
 */

import type { Row } from "./ivm.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DeltaPatch {
  viewId: string
  sequence: number
  inserts: Row[]
  deletes: Row[]
  updates: Array<{ old: Row; new: Row }>
  checksum: number
}

export interface DeltaPatchStats {
  totalEncoded: number
  totalDecoded: number
  totalBytesEncoded: number
  totalBytesDecoded: number
  avgPatchSizeBytes: number
}

// ─── Checksum ────────────────────────────────────────────────────────────────

/**
 * Compute a simple FNV-1a hash checksum for integrity verification.
 */
export function computeChecksum(data: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash
}

// ─── Encoder ─────────────────────────────────────────────────────────────────

/**
 * Encodes DeltaPatch objects to compact Uint8Array for WebSocket transport.
 */
export class DeltaPatchEncoder {
  private stats: DeltaPatchStats = {
    totalEncoded: 0,
    totalDecoded: 0,
    totalBytesEncoded: 0,
    totalBytesDecoded: 0,
    avgPatchSizeBytes: 0,
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  /**
   * Encode a DeltaPatch to a Uint8Array.
   */
  encode(patch: DeltaPatch): Uint8Array {
    const payload = JSON.stringify({
      v: patch.viewId,
      s: patch.sequence,
      i: patch.inserts,
      d: patch.deletes,
      u: patch.updates,
      c: patch.checksum,
    })
    const bytes = new TextEncoder().encode(payload)

    this.stats.totalEncoded++
    this.stats.totalBytesEncoded += bytes.length
    this.stats.avgPatchSizeBytes = Math.round(this.stats.totalBytesEncoded / this.stats.totalEncoded)

    return bytes
  }

  getStats(): DeltaPatchStats {
    return { ...this.stats }
  }
}

// ─── Decoder ─────────────────────────────────────────────────────────────────

/**
 * Decodes Uint8Array data back into DeltaPatch objects.
 */
export class DeltaPatchDecoder {
  private stats: DeltaPatchStats = {
    totalEncoded: 0,
    totalDecoded: 0,
    totalBytesEncoded: 0,
    totalBytesDecoded: 0,
    avgPatchSizeBytes: 0,
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  /**
   * Decode a Uint8Array back to a DeltaPatch.
   */
  decode(data: Uint8Array): DeltaPatch {
    const payload = new TextDecoder().decode(data)
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(payload)
    } catch {
      throw new Error("Failed to decode delta patch: invalid JSON")
    }

    this.stats.totalDecoded++
    this.stats.totalBytesDecoded += data.length
    this.stats.avgPatchSizeBytes = Math.round(this.stats.totalBytesDecoded / this.stats.totalDecoded)

    return {
      viewId: parsed.v as string,
      sequence: parsed.s as number,
      inserts: parsed.i as Row[],
      deletes: parsed.d as Row[],
      updates: parsed.u as Array<{ old: Row; new: Row }>,
      checksum: parsed.c as number,
    }
  }

  getStats(): DeltaPatchStats {
    return { ...this.stats }
  }
}

// ─── Convenience Functions ───────────────────────────────────────────────────

const _sharedEncoder = new DeltaPatchEncoder()
const _sharedDecoder = new DeltaPatchDecoder()

/**
 * Encode a DeltaPatch to a Uint8Array (convenience function).
 */
export function encodeDeltaPatch(patch: DeltaPatch): Uint8Array {
  return _sharedEncoder.encode(patch)
}

/**
 * Decode a Uint8Array back to a DeltaPatch (convenience function).
 */
export function decodeDeltaPatch(data: Uint8Array): DeltaPatch {
  return _sharedDecoder.decode(data)
}

// ─── Patch Accumulator ───────────────────────────────────────────────────────

/**
 * Accumulates multiple DeltaPatch objects and merges them into a single compact patch.
 * Useful for batching rapid changes before sending to clients.
 */
export class PatchAccumulator {
  private patches = new Map<string, DeltaPatch[]>()

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  /**
   * Add a patch to the accumulator.
   */
  add(patch: DeltaPatch): void {
    const existing = this.patches.get(patch.viewId) ?? []
    existing.push(patch)
    this.patches.set(patch.viewId, existing)
  }

  /**
   * Merge all accumulated patches for a given view into a single patch.
   * Inserts that are later deleted cancel out. Updates are collapsed.
   */
  merge(viewId: string): DeltaPatch | null {
    const patches = this.patches.get(viewId)
    if (!patches || patches.length === 0) return null

    const mergedInserts: Row[] = []
    const mergedDeletes: Row[] = []
    const mergedUpdates: Array<{ old: Row; new: Row }> = []

    for (const patch of patches) {
      mergedInserts.push(...patch.inserts)
      mergedDeletes.push(...patch.deletes)
      mergedUpdates.push(...patch.updates)
    }

    // Cancel out insert+delete pairs by row identity (JSON stringified)
    const insertKeys = new Map<string, Row>()
    for (const row of mergedInserts) {
      insertKeys.set(JSON.stringify(row), row)
    }

    const finalDeletes: Row[] = []
    for (const row of mergedDeletes) {
      const key = JSON.stringify(row)
      if (insertKeys.has(key)) {
        insertKeys.delete(key)
      } else {
        finalDeletes.push(row)
      }
    }

    // Collapse sequential updates on the same row
    const updateMap = new Map<string, { old: Row; new: Row }>()
    for (const upd of mergedUpdates) {
      const key = JSON.stringify(upd.old)
      const existing = updateMap.get(key)
      if (existing) {
        existing.new = upd.new
      } else {
        updateMap.set(key, { ...upd })
      }
    }

    const finalInserts = [...insertKeys.values()]
    const finalUpdates = [...updateMap.values()]
    const maxSeq = Math.max(...patches.map((p) => p.sequence))

    const content = JSON.stringify({ i: finalInserts, d: finalDeletes, u: finalUpdates })
    const checksum = computeChecksum(content)

    return {
      viewId,
      sequence: maxSeq,
      inserts: finalInserts,
      deletes: finalDeletes,
      updates: finalUpdates,
      checksum,
    }
  }

  /**
   * Merge all accumulated patches across all views.
   */
  mergeAll(): DeltaPatch[] {
    const results: DeltaPatch[] = []
    for (const viewId of this.patches.keys()) {
      const merged = this.merge(viewId)
      if (merged) results.push(merged)
    }
    return results
  }

  /**
   * Clear all accumulated patches.
   */
  clear(): void {
    this.patches.clear()
  }

  /**
   * Get the number of accumulated views.
   */
  get size(): number {
    return this.patches.size
  }
}
