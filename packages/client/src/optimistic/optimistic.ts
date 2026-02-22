/**
 * Optimistic Updates with Automatic Rollback for ReactiveBase Client.
 * Provides client-side optimistic mutation pipeline where mutations apply locally
 * immediately, sync to server, and automatically rollback if rejected.
 *
 * Usage:
 *   const manager = new OptimisticUpdateManager(queryCache)
 *   const result = manager.apply({
 *     mutationId: "m1",
 *     subscriptionId: "sub_tasks",
 *     optimisticData: [...currentTasks, newTask],
 *   })
 *   // On server confirm:
 *   manager.confirm("m1", serverData)
 *   // On server reject:
 *   manager.rollback("m1") // Restores original data
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OptimisticUpdate {
  /** Unique mutation identifier */
  mutationId: string
  /** Subscription ID to update optimistically */
  subscriptionId: string
  /** The optimistic data to show immediately */
  optimisticData: unknown
  /** Optional: custom rollback data (defaults to pre-mutation snapshot) */
  rollbackData?: unknown
  /** Timestamp of the optimistic update */
  timestamp: number
}

export interface OptimisticSnapshot {
  mutationId: string
  subscriptionId: string
  originalData: unknown
  originalVersion: number
  optimisticData: unknown
  timestamp: number
  status: "pending" | "confirmed" | "rolled-back" | "expired"
}

export interface OptimisticManagerOptions {
  /** Max number of snapshots to retain (default: 50) */
  maxSnapshots?: number
  /** Timeout in ms before auto-rolling back unconfirmed mutations (default: 30000) */
  timeoutMs?: number
  /** Callback when a rollback occurs */
  onRollback?: (snapshot: OptimisticSnapshot) => void
  /** Callback when a mutation is confirmed */
  onConfirm?: (mutationId: string) => void
  /** Callback when a mutation times out */
  onTimeout?: (mutationId: string) => void
}

export interface ConflictInfo {
  mutationId: string
  subscriptionId: string
  localData: unknown
  serverData: unknown
  resolution: "local" | "server" | "custom" | "pending"
}

export type ConflictResolver = (conflict: ConflictInfo) => unknown | Promise<unknown>

/** Minimal cache interface to avoid tight coupling */
export interface OptimisticCacheAdapter {
  get(subscriptionId: string): { data: unknown; version: number } | undefined
  update(subscriptionId: string, data: unknown, version: number): void
}

// ─── Optimistic Update Manager ───────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<OptimisticManagerOptions, "onRollback" | "onConfirm" | "onTimeout">> & {
  onRollback: OptimisticManagerOptions["onRollback"]
  onConfirm: OptimisticManagerOptions["onConfirm"]
  onTimeout: OptimisticManagerOptions["onTimeout"]
} = {
  maxSnapshots: 50,
  timeoutMs: 30_000,
  onRollback: undefined,
  onConfirm: undefined,
  onTimeout: undefined,
}

/**
 * Manages optimistic updates with snapshot-based rollback.
 * Maintains a stack of snapshots so mutations can be undone in any order.
 */
export class OptimisticUpdateManager {
  private snapshots = new Map<string, OptimisticSnapshot>()
  private snapshotOrder: string[] = []
  private timeouts = new Map<string, ReturnType<typeof setTimeout>>()
  private conflictResolver: ConflictResolver | null = null
  private options: typeof DEFAULT_OPTIONS
  private cache: OptimisticCacheAdapter

  constructor(cache: OptimisticCacheAdapter, options: OptimisticManagerOptions = {}) {
    this.cache = cache
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Apply an optimistic update. Snapshots the current data and immediately
   * updates the cache with the optimistic value.
   */
  apply(update: Omit<OptimisticUpdate, "timestamp">): OptimisticSnapshot {
    const { mutationId, subscriptionId, optimisticData } = update

    // Take snapshot of current state
    const current = this.cache.get(subscriptionId)
    const snapshot: OptimisticSnapshot = {
      mutationId,
      subscriptionId,
      originalData: current?.data ?? null,
      originalVersion: current?.version ?? 0,
      optimisticData,
      timestamp: Date.now(),
      status: "pending",
    }

    // Store snapshot
    this.snapshots.set(mutationId, snapshot)
    this.snapshotOrder.push(mutationId)
    this.enforceMaxSnapshots()

    // Apply optimistic data to cache
    this.cache.update(subscriptionId, optimisticData, (current?.version ?? 0) + 1)

    // Set timeout for auto-rollback
    if (this.options.timeoutMs > 0) {
      const timeout = setTimeout(() => {
        this.handleTimeout(mutationId)
      }, this.options.timeoutMs)
      this.timeouts.set(mutationId, timeout)
    }

    return snapshot
  }

  /**
   * Confirm a mutation succeeded on the server.
   * Replaces optimistic data with authoritative server data.
   */
  confirm(mutationId: string, serverData?: unknown): void {
    const snapshot = this.snapshots.get(mutationId)
    if (!snapshot) return

    snapshot.status = "confirmed"
    this.clearTimeout(mutationId)

    // If server provided data, update cache with it
    if (serverData !== undefined) {
      this.cache.update(snapshot.subscriptionId, serverData, snapshot.originalVersion + 1)
    }

    this.options.onConfirm?.(mutationId)
  }

  /**
   * Rollback a mutation. Restores the cache to the pre-mutation state.
   */
  rollback(mutationId: string): OptimisticSnapshot | undefined {
    const snapshot = this.snapshots.get(mutationId)
    if (!snapshot || snapshot.status !== "pending") return undefined

    snapshot.status = "rolled-back"
    this.clearTimeout(mutationId)

    // Restore original data
    this.cache.update(snapshot.subscriptionId, snapshot.originalData, snapshot.originalVersion)

    // Re-apply any subsequent pending optimistic updates for the same subscription
    this.reapplyPendingAfter(mutationId, snapshot.subscriptionId)

    this.options.onRollback?.(snapshot)
    return snapshot
  }

  /**
   * Rollback all pending optimistic updates.
   */
  rollbackAll(): OptimisticSnapshot[] {
    const rolledBack: OptimisticSnapshot[] = []
    for (const [id, snapshot] of this.snapshots) {
      if (snapshot.status === "pending") {
        const result = this.rollback(id)
        if (result) rolledBack.push(result)
      }
    }
    return rolledBack
  }

  /**
   * Handle a server conflict by invoking the conflict resolver.
   */
  async resolveConflict(mutationId: string, serverData: unknown): Promise<unknown> {
    const snapshot = this.snapshots.get(mutationId)
    if (!snapshot) return serverData

    if (!this.conflictResolver) {
      // Default: server wins
      this.confirm(mutationId, serverData)
      return serverData
    }

    const conflict: ConflictInfo = {
      mutationId,
      subscriptionId: snapshot.subscriptionId,
      localData: snapshot.optimisticData,
      serverData,
      resolution: "pending",
    }

    const resolved = await this.conflictResolver(conflict)
    this.confirm(mutationId, resolved)
    return resolved
  }

  /**
   * Set a custom conflict resolver.
   */
  setConflictResolver(resolver: ConflictResolver): void {
    this.conflictResolver = resolver
  }

  /**
   * Get a snapshot by mutation ID.
   */
  getSnapshot(mutationId: string): OptimisticSnapshot | undefined {
    return this.snapshots.get(mutationId)
  }

  /**
   * Get all pending (unconfirmed) snapshots.
   */
  getPending(): OptimisticSnapshot[] {
    return [...this.snapshots.values()].filter((s) => s.status === "pending")
  }

  /**
   * Get pending count for a specific subscription.
   */
  getPendingCount(subscriptionId?: string): number {
    if (!subscriptionId) return this.getPending().length
    return [...this.snapshots.values()].filter(
      (s) => s.status === "pending" && s.subscriptionId === subscriptionId,
    ).length
  }

  /**
   * Check if a subscription has any pending optimistic updates.
   */
  hasPending(subscriptionId: string): boolean {
    return this.getPendingCount(subscriptionId) > 0
  }

  /**
   * Clear all snapshots and timeouts.
   */
  clear(): void {
    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout)
    }
    this.timeouts.clear()
    this.snapshots.clear()
    this.snapshotOrder = []
  }

  private handleTimeout(mutationId: string): void {
    const snapshot = this.snapshots.get(mutationId)
    if (!snapshot || snapshot.status !== "pending") return

    this.rollback(mutationId)
    this.options.onTimeout?.(mutationId)
  }

  private clearTimeout(mutationId: string): void {
    const timeout = this.timeouts.get(mutationId)
    if (timeout) {
      clearTimeout(timeout)
      this.timeouts.delete(mutationId)
    }
  }

  private enforceMaxSnapshots(): void {
    while (this.snapshotOrder.length > this.options.maxSnapshots) {
      const oldest = this.snapshotOrder.shift()!
      const snapshot = this.snapshots.get(oldest)
      if (snapshot && snapshot.status !== "pending") {
        this.snapshots.delete(oldest)
        this.clearTimeout(oldest)
      }
    }
  }

  /**
   * Re-apply pending optimistic updates that came after a rolled-back mutation
   * on the same subscription.
   */
  private reapplyPendingAfter(rolledBackId: string, subscriptionId: string): void {
    const idx = this.snapshotOrder.indexOf(rolledBackId)
    if (idx === -1) return

    for (let i = idx + 1; i < this.snapshotOrder.length; i++) {
      const snapshot = this.snapshots.get(this.snapshotOrder[i])
      if (snapshot && snapshot.subscriptionId === subscriptionId && snapshot.status === "pending") {
        this.cache.update(subscriptionId, snapshot.optimisticData, snapshot.originalVersion + 1)
      }
    }
  }
}
