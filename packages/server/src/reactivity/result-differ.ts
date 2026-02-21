/**
 * Result differ - compares query results to determine if an update should be sent.
 * Uses JSON deep equality + hashing to avoid unnecessary re-renders.
 */

import { createHash } from "node:crypto"

/**
 * Compute a hash of a query result for fast equality checking.
 */
export function hashResult(result: unknown): string {
  const json = JSON.stringify(result, replacer)
  return createHash("sha256").update(json).digest("hex").substring(0, 16)
}

/**
 * Compare two results and return true if they are different.
 */
export function hasResultChanged(oldHash: string, newResult: unknown): boolean {
  const newHash = hashResult(newResult)
  return oldHash !== newHash
}

/**
 * Compute a minimal diff between old and new array results.
 * Returns the diff or null if results are identical.
 */
export function computeDiff(
  oldResult: unknown,
  newResult: unknown,
): ResultDiff | null {
  const oldHash = hashResult(oldResult)
  const newHash = hashResult(newResult)

  if (oldHash === newHash) return null

  // For array results, compute added/removed/modified
  if (Array.isArray(oldResult) && Array.isArray(newResult)) {
    return computeArrayDiff(oldResult, newResult)
  }

  // For non-array results, just return the full new result
  return { type: "full", data: newResult }
}

export interface ResultDiff {
  type: "full" | "array"
  data?: unknown
  added?: unknown[]
  removed?: string[]
  modified?: Array<{ id: string; changes: Record<string, unknown> }>
}

function computeArrayDiff(
  oldArray: Record<string, unknown>[],
  newArray: Record<string, unknown>[],
): ResultDiff {
  const oldMap = new Map(oldArray.map((item) => [item.id as string, item]))
  const newMap = new Map(newArray.map((item) => [item.id as string, item]))

  const added: unknown[] = []
  const removed: string[] = []
  const modified: Array<{ id: string; changes: Record<string, unknown> }> = []

  // Find added and modified
  for (const [id, newItem] of newMap) {
    const oldItem = oldMap.get(id)
    if (!oldItem) {
      added.push(newItem)
    } else if (JSON.stringify(oldItem) !== JSON.stringify(newItem)) {
      const changes: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(newItem)) {
        if (JSON.stringify(oldItem[key]) !== JSON.stringify(value)) {
          changes[key] = value
        }
      }
      if (Object.keys(changes).length > 0) {
        modified.push({ id, changes })
      }
    }
  }

  // Find removed
  for (const id of oldMap.keys()) {
    if (!newMap.has(id)) {
      removed.push(id)
    }
  }

  // If diff is larger than full result, just send full
  const diffSize = JSON.stringify({ added, removed, modified }).length
  const fullSize = JSON.stringify(newArray).length

  if (diffSize > fullSize * 0.8) {
    return { type: "full", data: newArray }
  }

  return { type: "array", added, removed, modified }
}

/**
 * JSON replacer that handles Date objects.
 */
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString()
  }
  return value
}
