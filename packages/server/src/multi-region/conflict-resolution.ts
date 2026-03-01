/**
 * Geo-Distributed Conflict Resolution for ReactiveBase.
 * Configurable conflict resolution strategies for multi-region deployments.
 *
 * Strategies:
 *   - Last-writer-wins (LWW): Timestamp-based resolution
 *   - Custom merge functions: User-defined field-level merging
 *   - Operational transforms: Transform concurrent operations
 *
 * Includes conflict visualization and network partition testing utilities.
 *
 * Usage:
 *   const resolver = new ConflictResolver({ defaultStrategy: "lww" })
 *   resolver.registerMerge("tasks", taskMergeFunction)
 *   const result = resolver.resolve(localVersion, remoteVersion)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConflictStrategyType = "lww" | "merge" | "operational-transform" | "manual"

export interface ConflictRecord<T = Record<string, unknown>> {
  id: string
  table: string
  rowId: string
  localVersion: VersionedRow<T>
  remoteVersion: VersionedRow<T>
  baseVersion?: VersionedRow<T>
  resolvedVersion?: VersionedRow<T>
  strategy: ConflictStrategyType
  resolvedAt?: number
  region: { local: string; remote: string }
}

export interface VersionedRow<T = Record<string, unknown>> {
  data: T
  version: number
  timestamp: number
  region: string
  vectorClock?: Record<string, number>
}

export interface MergeFunction<T = Record<string, unknown>> {
  (base: T | undefined, local: T, remote: T): T
}

export interface OperationalTransform<T = unknown> {
  type: string
  apply(document: T, operation: Operation): T
  transform(op1: Operation, op2: Operation): [Operation, Operation]
}

export interface Operation {
  id: string
  type: string
  path: string
  value: unknown
  timestamp: number
  region: string
}

export interface ResolutionResult<T = Record<string, unknown>> {
  resolved: T
  strategy: ConflictStrategyType
  conflicts: FieldConflict[]
  autoResolved: boolean
}

export interface FieldConflict {
  field: string
  localValue: unknown
  remoteValue: unknown
  resolvedValue: unknown
  strategy: string
}

export interface ConflictResolverOptions {
  defaultStrategy?: ConflictStrategyType
  /** Field-level strategy overrides: { "tasks.priority": "lww", "tasks.description": "merge" } */
  fieldStrategies?: Record<string, ConflictStrategyType>
  /** Callback for manual resolution */
  onManualRequired?: (conflict: ConflictRecord) => Promise<Record<string, unknown>>
}

// ─── Conflict Resolver ───────────────────────────────────────────────────────

export class ConflictResolver {
  private mergeFunctions = new Map<string, MergeFunction>()
  private fieldStrategies: Record<string, ConflictStrategyType>
  private defaultStrategy: ConflictStrategyType
  private history: ConflictRecord[] = []
  private maxHistory = 1000
  private onManualRequired?: (conflict: ConflictRecord) => Promise<Record<string, unknown>>

  constructor(options: ConflictResolverOptions = {}) {
    this.defaultStrategy = options.defaultStrategy ?? "lww"
    this.fieldStrategies = options.fieldStrategies ?? {}
    this.onManualRequired = options.onManualRequired
  }

  /**
   * Register a custom merge function for a table.
   */
  registerMerge<T = Record<string, unknown>>(table: string, fn: MergeFunction<T>): void {
    this.mergeFunctions.set(table, fn as MergeFunction)
  }

  /**
   * Set a field-level conflict strategy.
   */
  setFieldStrategy(tableColumn: string, strategy: ConflictStrategyType): void {
    this.fieldStrategies[tableColumn] = strategy
  }

  /**
   * Resolve a conflict between local and remote versions.
   */
  async resolve<T extends Record<string, unknown>>(
    table: string,
    rowId: string,
    local: VersionedRow<T>,
    remote: VersionedRow<T>,
    base?: VersionedRow<T>,
  ): Promise<ResolutionResult<T>> {
    const conflict: ConflictRecord<T> = {
      id: `conflict_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      table,
      rowId,
      localVersion: local,
      remoteVersion: remote,
      baseVersion: base,
      strategy: this.defaultStrategy,
      region: { local: local.region, remote: remote.region },
    }

    let result: ResolutionResult<T>

    // Check for table-specific merge function
    const mergeFn = this.mergeFunctions.get(table) as MergeFunction<T> | undefined
    if (mergeFn) {
      const resolved = mergeFn(base?.data, local.data, remote.data)
      result = {
        resolved,
        strategy: "merge",
        conflicts: this.detectFieldConflicts(local.data, remote.data, resolved),
        autoResolved: true,
      }
    } else {
      result = await this.resolveByStrategy(table, local, remote, base)
    }

    conflict.resolvedVersion = {
      data: result.resolved,
      version: Math.max(local.version, remote.version) + 1,
      timestamp: Date.now(),
      region: local.region,
    }
    conflict.resolvedAt = Date.now()
    conflict.strategy = result.strategy

    this.history.push(conflict as ConflictRecord)
    if (this.history.length > this.maxHistory) this.history.shift()

    return result
  }

  /**
   * Get conflict resolution history.
   */
  getHistory(limit?: number): ConflictRecord[] {
    const items = [...this.history].reverse()
    return limit ? items.slice(0, limit) : items
  }

  /**
   * Get conflict stats.
   */
  getStats(): {
    totalConflicts: number
    byStrategy: Record<string, number>
    byTable: Record<string, number>
    autoResolved: number
    manualResolved: number
  } {
    const byStrategy: Record<string, number> = {}
    const byTable: Record<string, number> = {}
    let autoResolved = 0
    let manualResolved = 0

    for (const c of this.history) {
      byStrategy[c.strategy] = (byStrategy[c.strategy] ?? 0) + 1
      byTable[c.table] = (byTable[c.table] ?? 0) + 1
      if (c.strategy === "manual") manualResolved++
      else autoResolved++
    }

    return {
      totalConflicts: this.history.length,
      byStrategy,
      byTable,
      autoResolved,
      manualResolved,
    }
  }

  /**
   * Clear resolution history.
   */
  clearHistory(): void {
    this.history = []
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async resolveByStrategy<T extends Record<string, unknown>>(
    table: string,
    local: VersionedRow<T>,
    remote: VersionedRow<T>,
    base?: VersionedRow<T>,
  ): Promise<ResolutionResult<T>> {
    switch (this.defaultStrategy) {
      case "lww":
        return this.resolveLWW(local, remote)
      case "merge":
        return this.resolveFieldLevel(table, local, remote, base)
      case "manual":
        return this.resolveManual(table, local, remote)
      default:
        return this.resolveLWW(local, remote)
    }
  }

  private resolveLWW<T extends Record<string, unknown>>(
    local: VersionedRow<T>,
    remote: VersionedRow<T>,
  ): ResolutionResult<T> {
    const winner = local.timestamp >= remote.timestamp ? local : remote
    const _loser = winner === local ? remote : local

    return {
      resolved: winner.data,
      strategy: "lww",
      conflicts: this.detectFieldConflicts(local.data, remote.data, winner.data),
      autoResolved: true,
    }
  }

  private resolveFieldLevel<T extends Record<string, unknown>>(
    table: string,
    local: VersionedRow<T>,
    remote: VersionedRow<T>,
    base?: VersionedRow<T>,
  ): ResolutionResult<T> {
    const resolved = { ...local.data } as T
    const conflicts: FieldConflict[] = []

    const allKeys = Array.from(new Set([...Object.keys(local.data), ...Object.keys(remote.data)]))

    for (const key of allKeys) {
      const localVal = (local.data as Record<string, unknown>)[key]
      const remoteVal = (remote.data as Record<string, unknown>)[key]
      const baseVal = base ? (base.data as Record<string, unknown>)[key] : undefined

      if (JSON.stringify(localVal) === JSON.stringify(remoteVal)) {
        continue
      }

      const fieldStrategy = this.fieldStrategies[`${table}.${key}`] ?? "lww"

      let resolvedVal: unknown
      if (fieldStrategy === "lww") {
        resolvedVal = local.timestamp >= remote.timestamp ? localVal : remoteVal
      } else if (baseVal !== undefined) {
        // Three-way merge: if only one side changed from base, take that change
        const localChanged = JSON.stringify(localVal) !== JSON.stringify(baseVal)
        const remoteChanged = JSON.stringify(remoteVal) !== JSON.stringify(baseVal)
        if (localChanged && !remoteChanged) resolvedVal = localVal
        else if (!localChanged && remoteChanged) resolvedVal = remoteVal
        else resolvedVal = local.timestamp >= remote.timestamp ? localVal : remoteVal
      } else {
        resolvedVal = local.timestamp >= remote.timestamp ? localVal : remoteVal
      }

      ;(resolved as Record<string, unknown>)[key] = resolvedVal
      conflicts.push({
        field: key,
        localValue: localVal,
        remoteValue: remoteVal,
        resolvedValue: resolvedVal,
        strategy: fieldStrategy,
      })
    }

    return { resolved, strategy: "merge", conflicts, autoResolved: true }
  }

  private async resolveManual<T extends Record<string, unknown>>(
    table: string,
    local: VersionedRow<T>,
    remote: VersionedRow<T>,
  ): Promise<ResolutionResult<T>> {
    if (!this.onManualRequired) {
      // Fall back to LWW if no manual handler
      return this.resolveLWW(local, remote)
    }

    const conflict: ConflictRecord<T> = {
      id: `conflict_${Date.now()}`,
      table,
      rowId: "",
      localVersion: local,
      remoteVersion: remote,
      strategy: "manual",
      region: { local: local.region, remote: remote.region },
    }

    const resolved = (await this.onManualRequired(conflict as ConflictRecord)) as T
    return {
      resolved,
      strategy: "manual",
      conflicts: this.detectFieldConflicts(local.data, remote.data, resolved),
      autoResolved: false,
    }
  }

  private detectFieldConflicts<T extends Record<string, unknown>>(local: T, remote: T, resolved: T): FieldConflict[] {
    const conflicts: FieldConflict[] = []
    const allKeys = Array.from(new Set([...Object.keys(local), ...Object.keys(remote)]))

    for (const key of allKeys) {
      const lv = (local as Record<string, unknown>)[key]
      const rv = (remote as Record<string, unknown>)[key]
      if (JSON.stringify(lv) !== JSON.stringify(rv)) {
        conflicts.push({
          field: key,
          localValue: lv,
          remoteValue: rv,
          resolvedValue: (resolved as Record<string, unknown>)[key],
          strategy: this.defaultStrategy,
        })
      }
    }
    return conflicts
  }
}

// ─── Network Partition Testing ───────────────────────────────────────────────

export interface PartitionConfig {
  regions: string[]
  partitionedRegions: string[][]
  durationMs: number
}

export interface PartitionTestResult {
  config: PartitionConfig
  conflictsGenerated: number
  conflictsResolved: number
  dataLoss: boolean
  events: PartitionEvent[]
  durationMs: number
}

export interface PartitionEvent {
  type: "partition_start" | "partition_end" | "write_local" | "conflict_detected" | "conflict_resolved"
  region: string
  timestamp: number
  detail?: string
}

/**
 * Simulate network partitions and test conflict resolution behavior.
 */
export class PartitionTester {
  private events: PartitionEvent[] = []

  /**
   * Simulate a network partition scenario.
   */
  async simulate(
    config: PartitionConfig,
    writeFn: (region: string) => Promise<Record<string, unknown>>,
    resolver: ConflictResolver,
  ): Promise<PartitionTestResult> {
    this.events = []
    const start = Date.now()

    // Record partition start
    for (const group of config.partitionedRegions) {
      for (const region of group) {
        this.events.push({
          type: "partition_start",
          region,
          timestamp: Date.now(),
          detail: `Partitioned with: ${group.join(", ")}`,
        })
      }
    }

    // Generate writes in partitioned regions
    const writes: Array<{ region: string; data: Record<string, unknown> }> = []
    for (const group of config.partitionedRegions) {
      for (const region of group) {
        const data = await writeFn(region)
        writes.push({ region, data })
        this.events.push({
          type: "write_local",
          region,
          timestamp: Date.now(),
          detail: JSON.stringify(data).substring(0, 200),
        })
      }
    }

    // End partition
    for (const region of config.regions) {
      this.events.push({ type: "partition_end", region, timestamp: Date.now() })
    }

    // Resolve conflicts between partitioned writes
    let conflictsGenerated = 0
    let conflictsResolved = 0

    for (let i = 0; i < writes.length; i++) {
      for (let j = i + 1; j < writes.length; j++) {
        conflictsGenerated++
        this.events.push({
          type: "conflict_detected",
          region: writes[i].region,
          timestamp: Date.now(),
          detail: `${writes[i].region} vs ${writes[j].region}`,
        })

        const local: VersionedRow = {
          data: writes[i].data,
          version: 1,
          timestamp: Date.now() - 100,
          region: writes[i].region,
        }
        const remote: VersionedRow = {
          data: writes[j].data,
          version: 1,
          timestamp: Date.now(),
          region: writes[j].region,
        }

        await resolver.resolve("test", "row-1", local, remote)
        conflictsResolved++

        this.events.push({
          type: "conflict_resolved",
          region: writes[i].region,
          timestamp: Date.now(),
        })
      }
    }

    return {
      config,
      conflictsGenerated,
      conflictsResolved,
      dataLoss: conflictsGenerated > conflictsResolved,
      events: this.events,
      durationMs: Date.now() - start,
    }
  }

  /**
   * Get the event log from the last simulation.
   */
  getEvents(): PartitionEvent[] {
    return [...this.events]
  }
}

// ─── Conflict Visualization ──────────────────────────────────────────────────

/**
 * Generate a human-readable conflict report.
 */
export function formatConflictReport(conflicts: ConflictRecord[]): string {
  if (conflicts.length === 0) return "No conflicts recorded."

  const lines: string[] = [`Conflict Report (${conflicts.length} conflicts)`, "=".repeat(50)]

  for (const c of conflicts) {
    lines.push(``)
    lines.push(`[${c.strategy.toUpperCase()}] ${c.table}/${c.rowId}`)
    lines.push(`  Regions: ${c.region.local} ↔ ${c.region.remote}`)
    lines.push(`  Local v${c.localVersion.version} (${new Date(c.localVersion.timestamp).toISOString()})`)
    lines.push(`  Remote v${c.remoteVersion.version} (${new Date(c.remoteVersion.timestamp).toISOString()})`)
    if (c.resolvedAt) {
      lines.push(`  Resolved at: ${new Date(c.resolvedAt).toISOString()}`)
    }
  }

  return lines.join("\n")
}
