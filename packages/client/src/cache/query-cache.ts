/**
 * Local query cache for storing subscription results on the client.
 * Supports optimistic updates with versioned rollback.
 */

export interface CacheEntry {
  queryName: string
  args: unknown
  data: unknown
  version: number
  updatedAt: number
  isStale: boolean
}

interface OptimisticLayer {
  subscriptionId: string
  originalData: unknown
  originalVersion: number
}

export class QueryCache {
  private cache = new Map<string, CacheEntry>()
  private listeners = new Map<string, Set<(entry: CacheEntry) => void>>()
  private optimisticLayers: OptimisticLayer[] = []

  /**
   * Get cached data for a subscription.
   */
  get(subscriptionId: string): CacheEntry | undefined {
    return this.cache.get(subscriptionId)
  }

  /**
   * Set cached data for a subscription.
   */
  set(subscriptionId: string, entry: Omit<CacheEntry, "updatedAt" | "isStale">): void {
    const fullEntry: CacheEntry = {
      ...entry,
      updatedAt: Date.now(),
      isStale: false,
    }
    this.cache.set(subscriptionId, fullEntry)
    this.notifyListeners(subscriptionId, fullEntry)
  }

  /**
   * Update cached data with a server update.
   */
  update(subscriptionId: string, data: unknown, version: number): void {
    const existing = this.cache.get(subscriptionId)
    if (!existing) return

    const updated: CacheEntry = {
      ...existing,
      data,
      version,
      updatedAt: Date.now(),
      isStale: false,
    }
    this.cache.set(subscriptionId, updated)
    this.notifyListeners(subscriptionId, updated)
  }

  /**
   * Mark cached data as stale (e.g., during reconnection).
   */
  markStale(subscriptionId: string): void {
    const entry = this.cache.get(subscriptionId)
    if (entry) {
      entry.isStale = true
    }
  }

  /**
   * Mark all entries as stale.
   */
  markAllStale(): void {
    for (const entry of this.cache.values()) {
      entry.isStale = true
    }
  }

  /**
   * Remove a cache entry.
   */
  remove(subscriptionId: string): void {
    this.cache.delete(subscriptionId)
    this.listeners.delete(subscriptionId)
  }

  /**
   * Apply an optimistic update to a subscription's cache.
   * Returns a rollback function to revert the change.
   */
  applyOptimisticUpdate(subscriptionId: string, updater: (data: unknown) => unknown): () => void {
    const entry = this.cache.get(subscriptionId)
    if (!entry) return () => {}

    const layer: OptimisticLayer = {
      subscriptionId,
      originalData: structuredClone(entry.data),
      originalVersion: entry.version,
    }
    this.optimisticLayers.push(layer)

    const optimisticData = updater(structuredClone(entry.data))
    this.update(subscriptionId, optimisticData, entry.version)

    // Return rollback function
    return () => {
      const idx = this.optimisticLayers.indexOf(layer)
      if (idx >= 0) {
        this.optimisticLayers.splice(idx, 1)
      }
      this.update(subscriptionId, layer.originalData, layer.originalVersion)
    }
  }

  /**
   * Apply an optimistic update across all subscriptions matching a query name.
   */
  applyOptimisticUpdateByQuery(queryName: string, updater: (data: unknown, args: unknown) => unknown): () => void {
    const rollbacks: (() => void)[] = []

    for (const [subId, entry] of this.cache.entries()) {
      if (entry.queryName === queryName) {
        const rollback = this.applyOptimisticUpdate(subId, (data) => updater(data, entry.args))
        rollbacks.push(rollback)
      }
    }

    return () => {
      for (const rollback of rollbacks) {
        rollback()
      }
    }
  }

  /**
   * Get the number of pending optimistic layers.
   */
  get pendingOptimisticUpdates(): number {
    return this.optimisticLayers.length
  }

  /**
   * Listen for changes to a specific subscription's cache.
   */
  listen(subscriptionId: string, callback: (entry: CacheEntry) => void): () => void {
    if (!this.listeners.has(subscriptionId)) {
      this.listeners.set(subscriptionId, new Set())
    }
    this.listeners.get(subscriptionId)!.add(callback)
    return () => this.listeners.get(subscriptionId)?.delete(callback)
  }

  /**
   * Clear all cache data.
   */
  clear(): void {
    this.cache.clear()
    this.listeners.clear()
    this.optimisticLayers = []
  }

  private notifyListeners(subscriptionId: string, entry: CacheEntry): void {
    const callbacks = this.listeners.get(subscriptionId)
    if (callbacks) {
      for (const cb of callbacks) {
        cb(entry)
      }
    }
  }
}
