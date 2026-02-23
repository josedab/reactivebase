/**
 * Configurable conflict resolution for offline-first sync.
 * Provides multiple strategies including 3-way field-level merge,
 * per-table strategy overrides, and a conflict log for debugging.
 *
 * Usage:
 *   const resolver = new ConflictResolver({ defaultStrategy: "field-merge" })
 *   const resolved = resolver.resolve(conflict)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConflictStrategyType = "last-write-wins" | "server-wins" | "client-wins" | "field-merge" | "custom"

export interface Conflict {
  /** The local (client) change */
  localChange: Record<string, unknown>
  /** The remote (server) change */
  remoteChange: Record<string, unknown>
  /** Table or collection name */
  table: string
  /** Row or document ID */
  rowId: string
  /** The resolved value after conflict resolution */
  resolvedValue?: Record<string, unknown>
  /** Which strategy was used to resolve */
  strategy?: ConflictStrategyType
}

export interface ConflictResolutionConfig {
  /** Default strategy for all tables (default: "last-write-wins") */
  defaultStrategy?: ConflictStrategyType
  /** Per-table strategy overrides */
  tableStrategies?: Record<string, ConflictStrategyType>
  /** Custom resolver function (required when strategy is "custom") */
  customResolver?: (conflict: Conflict) => Record<string, unknown>
}

export interface ConflictLogEntry {
  /** When the conflict was resolved */
  timestamp: number
  /** The original conflict */
  conflict: Conflict
  /** The strategy applied */
  strategy: ConflictStrategyType
  /** The resolved value */
  resolvedValue: Record<string, unknown>
}

// ─── Conflict Resolver ───────────────────────────────────────────────────────

export class ConflictResolver {
  private config: Required<Pick<ConflictResolutionConfig, "defaultStrategy">> &
    Omit<ConflictResolutionConfig, "defaultStrategy">
  private log: ConflictLogEntry[] = []

  constructor(config: ConflictResolutionConfig = {}) {
    this.config = {
      defaultStrategy: config.defaultStrategy ?? "last-write-wins",
      tableStrategies: config.tableStrategies,
      customResolver: config.customResolver,
    }
  }

  /**
   * Resolve a conflict using the configured strategy.
   */
  resolve(conflict: Conflict): Conflict {
    const strategy = this.getStrategy(conflict.table)
    let resolvedValue: Record<string, unknown>

    switch (strategy) {
      case "server-wins":
        resolvedValue = { ...conflict.remoteChange }
        break
      case "client-wins":
        resolvedValue = { ...conflict.localChange }
        break
      case "field-merge":
        resolvedValue = this.fieldMerge(conflict.remoteChange, conflict.localChange)
        break
      case "custom":
        if (!this.config.customResolver) {
          // Fall back to last-write-wins if no custom resolver
          resolvedValue = { ...conflict.remoteChange }
        } else {
          resolvedValue = this.config.customResolver(conflict)
        }
        break
      case "last-write-wins":
      default:
        // Remote (server) is assumed to have the later write
        resolvedValue = { ...conflict.remoteChange }
        break
    }

    const resolved: Conflict = {
      ...conflict,
      resolvedValue,
      strategy,
    }

    this.log.push({
      timestamp: Date.now(),
      conflict: resolved,
      strategy,
      resolvedValue,
    })

    return resolved
  }

  /**
   * 3-way merge on per-field basis.
   * If a base version is provided, only fields changed from base are merged.
   * Without a base, fields from both versions are combined (client fields take
   * precedence for fields present in both).
   */
  fieldMerge(
    serverVersion: Record<string, unknown>,
    clientVersion: Record<string, unknown>,
    baseVersion?: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!baseVersion) {
      // Without base, merge all fields; client overrides on conflict
      return { ...serverVersion, ...clientVersion }
    }

    const result: Record<string, unknown> = { ...baseVersion }
    const allKeys = new Set([...Object.keys(serverVersion), ...Object.keys(clientVersion), ...Object.keys(baseVersion)])

    for (const key of allKeys) {
      const baseVal = baseVersion[key]
      const serverVal = serverVersion[key]
      const clientVal = clientVersion[key]

      const serverHasKey = key in serverVersion
      const clientHasKey = key in clientVersion

      const serverChanged = serverHasKey ? !deepEqual(baseVal, serverVal) : false
      const clientChanged = clientHasKey ? !deepEqual(baseVal, clientVal) : false

      if (serverChanged && clientChanged) {
        // Both changed — client wins for the field
        result[key] = clientVal
      } else if (serverChanged) {
        result[key] = serverVal
      } else if (clientChanged) {
        result[key] = clientVal
      }
      // else: neither changed, keep base
    }

    return result
  }

  /**
   * Detect conflicts between local and remote change sets.
   * Returns only mutations that modify the same table + row.
   */
  detectConflicts(
    localChanges: Array<{ table: string; rowId: string; fields: Record<string, unknown> }>,
    remoteChanges: Array<{ table: string; rowId: string; fields: Record<string, unknown> }>,
  ): Conflict[] {
    const remoteMap = new Map<string, { table: string; rowId: string; fields: Record<string, unknown> }>()
    for (const change of remoteChanges) {
      remoteMap.set(`${change.table}:${change.rowId}`, change)
    }

    const conflicts: Conflict[] = []
    for (const local of localChanges) {
      const key = `${local.table}:${local.rowId}`
      const remote = remoteMap.get(key)
      if (remote) {
        conflicts.push({
          localChange: local.fields,
          remoteChange: remote.fields,
          table: local.table,
          rowId: local.rowId,
        })
      }
    }

    return conflicts
  }

  /**
   * Get the conflict log for debugging.
   */
  getConflictLog(): ConflictLogEntry[] {
    return [...this.log]
  }

  /**
   * Clear the conflict log.
   */
  clearConflictLog(): void {
    this.log = []
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private getStrategy(table: string): ConflictStrategyType {
    return this.config.tableStrategies?.[table] ?? this.config.defaultStrategy
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (typeof a !== typeof b) return false
  if (typeof a !== "object") return false

  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj)
  const bKeys = Object.keys(bObj)
  if (aKeys.length !== bKeys.length) return false

  return aKeys.every((key) => deepEqual(aObj[key], bObj[key]))
}
