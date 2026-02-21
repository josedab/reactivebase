/**
 * Local query cache for storing subscription results on the client.
 */

export interface CacheEntry {
  queryName: string
  args: unknown
  data: unknown
  version: number
  updatedAt: number
  isStale: boolean
}

export class QueryCache {
  private cache = new Map<string, CacheEntry>()
  private listeners = new Map<string, Set<(entry: CacheEntry) => void>>()

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
   * Apply an optimistic update.
   */
  applyOptimisticUpdate(
    subscriptionId: string,
    updater: (data: unknown) => unknown,
  ): () => void {
    const entry = this.cache.get(subscriptionId)
    if (!entry) return () => {}

    const originalData = entry.data
    const optimisticData = updater(structuredClone(originalData))

    this.update(subscriptionId, optimisticData, entry.version)

    // Return rollback function
    return () => {
      this.update(subscriptionId, originalData, entry.version)
    }
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
