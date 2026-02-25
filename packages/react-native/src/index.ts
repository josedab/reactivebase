/**
 * ReactiveBase React Native SDK — offline-first reactive queries for mobile.
 *
 * Provides the same useQuery/useMutation API as @reactivebase/react but with:
 *   - SQLite-backed offline cache
 *   - Mutation queue with replay-on-reconnect
 *   - Configurable conflict resolution
 *   - Network-aware sync engine
 *
 * Usage:
 *   import { ReactiveBaseProvider, useQuery, useMutation } from "@reactivebase/react-native"
 *
 *   <ReactiveBaseProvider url="wss://api.example.com" offlineStorage={sqliteAdapter}>
 *     <App />
 *   </ReactiveBaseProvider>
 */

// ─── Offline Storage Interface ───────────────────────────────────────────────

export interface OfflineStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  getAllKeys(): Promise<string[]>
  clear(): Promise<void>
}

// ─── Mutation Queue ──────────────────────────────────────────────────────────

export interface QueuedMutation {
  id: string
  mutationName: string
  args: unknown
  createdAt: number
  retryCount: number
  status: "pending" | "in-flight" | "failed"
  error?: string
}

export type ConflictStrategy = "last-write-wins" | "client-wins" | "server-wins" | "custom"

export interface ConflictResolver {
  (local: unknown, remote: unknown, mutation: QueuedMutation): unknown
}

export interface MutationQueueOptions {
  /** Max retry attempts for failed mutations (default: 3) */
  maxRetries?: number
  /** Conflict resolution strategy (default: "last-write-wins") */
  conflictStrategy?: ConflictStrategy
  /** Custom conflict resolver (required when strategy is "custom") */
  conflictResolver?: ConflictResolver
}

const DEFAULT_QUEUE_OPTIONS: Required<Omit<MutationQueueOptions, "conflictResolver">> & {
  conflictResolver?: ConflictResolver
} = {
  maxRetries: 3,
  conflictStrategy: "last-write-wins",
  conflictResolver: undefined,
}

export class MutationQueue {
  private queue: QueuedMutation[] = []
  private storage: OfflineStorage | null = null
  private options: typeof DEFAULT_QUEUE_OPTIONS

  constructor(options: MutationQueueOptions = {}) {
    this.options = { ...DEFAULT_QUEUE_OPTIONS, ...options }
  }

  async init(storage: OfflineStorage): Promise<void> {
    this.storage = storage
    const raw = await storage.get("_rb_mutation_queue")
    if (raw) {
      try {
        this.queue = JSON.parse(raw)
      } catch {
        this.queue = []
      }
    }
  }

  async enqueue(mutationName: string, args: unknown): Promise<QueuedMutation> {
    const mutation: QueuedMutation = {
      id: `mut_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      mutationName,
      args,
      createdAt: Date.now(),
      retryCount: 0,
      status: "pending",
    }

    this.queue.push(mutation)
    await this.persist()
    return mutation
  }

  async dequeue(): Promise<QueuedMutation | null> {
    const next = this.queue.find((m) => m.status === "pending")
    if (next) {
      next.status = "in-flight"
      await this.persist()
    }
    return next ?? null
  }

  async markCompleted(id: string): Promise<void> {
    this.queue = this.queue.filter((m) => m.id !== id)
    await this.persist()
  }

  async markFailed(id: string, error: string): Promise<void> {
    const mutation = this.queue.find((m) => m.id === id)
    if (mutation) {
      mutation.retryCount++
      mutation.error = error
      mutation.status = mutation.retryCount >= this.options.maxRetries ? "failed" : "pending"
      await this.persist()
    }
  }

  get pending(): QueuedMutation[] {
    return this.queue.filter((m) => m.status === "pending")
  }

  get all(): QueuedMutation[] {
    return [...this.queue]
  }

  get size(): number {
    return this.queue.length
  }

  async clear(): Promise<void> {
    this.queue = []
    await this.persist()
  }

  private async persist(): Promise<void> {
    if (this.storage) {
      await this.storage.set("_rb_mutation_queue", JSON.stringify(this.queue))
    }
  }
}

// ─── Query Cache ─────────────────────────────────────────────────────────────

export interface CachedQuery {
  key: string
  queryName: string
  args: unknown
  data: unknown
  cachedAt: number
  ttl: number
}

export interface QueryCacheOptions {
  /** Default TTL for cached queries in ms (default: 5 minutes) */
  defaultTtl?: number
  /** Max cached queries (default: 500) */
  maxEntries?: number
}

export class OfflineQueryCache {
  private cache = new Map<string, CachedQuery>()
  private storage: OfflineStorage | null = null
  private defaultTtl: number
  private maxEntries: number

  constructor(options: QueryCacheOptions = {}) {
    this.defaultTtl = options.defaultTtl ?? 5 * 60 * 1000
    this.maxEntries = options.maxEntries ?? 500
  }

  async init(storage: OfflineStorage): Promise<void> {
    this.storage = storage
    const keys = await storage.getAllKeys()
    for (const key of keys) {
      if (!key.startsWith("_rb_cache:")) continue
      const raw = await storage.get(key)
      if (raw) {
        try {
          const entry = JSON.parse(raw) as CachedQuery
          if (Date.now() - entry.cachedAt < entry.ttl) {
            this.cache.set(entry.key, entry)
          } else {
            await storage.delete(key)
          }
        } catch {
          await storage.delete(key)
        }
      }
    }
  }

  async put(queryName: string, args: unknown, data: unknown, ttl?: number): Promise<void> {
    const key = this.cacheKey(queryName, args)
    const entry: CachedQuery = {
      key,
      queryName,
      args,
      data,
      cachedAt: Date.now(),
      ttl: ttl ?? this.defaultTtl,
    }

    // Evict if over limit
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      const oldest = [...this.cache.values()].sort((a, b) => a.cachedAt - b.cachedAt)[0]
      if (oldest) {
        this.cache.delete(oldest.key)
        if (this.storage) await this.storage.delete(`_rb_cache:${oldest.key}`)
      }
    }

    this.cache.set(key, entry)
    if (this.storage) {
      await this.storage.set(`_rb_cache:${key}`, JSON.stringify(entry))
    }
  }

  get(queryName: string, args: unknown): unknown | undefined {
    const key = this.cacheKey(queryName, args)
    const entry = this.cache.get(key)
    if (!entry) return undefined

    if (Date.now() - entry.cachedAt > entry.ttl) {
      this.cache.delete(key)
      return undefined
    }

    return entry.data
  }

  has(queryName: string, args: unknown): boolean {
    return this.get(queryName, args) !== undefined
  }

  async invalidate(queryName: string, args?: unknown): Promise<void> {
    if (args !== undefined) {
      const key = this.cacheKey(queryName, args)
      this.cache.delete(key)
      if (this.storage) await this.storage.delete(`_rb_cache:${key}`)
    } else {
      // Invalidate all entries for this query name
      for (const [key, entry] of this.cache) {
        if (entry.queryName === queryName) {
          this.cache.delete(key)
          if (this.storage) await this.storage.delete(`_rb_cache:${key}`)
        }
      }
    }
  }

  async clear(): Promise<void> {
    for (const key of this.cache.keys()) {
      if (this.storage) await this.storage.delete(`_rb_cache:${key}`)
    }
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }

  private cacheKey(queryName: string, args: unknown): string {
    return `${queryName}:${JSON.stringify(args, Object.keys((args ?? {}) as object).sort())}`
  }
}

// ─── Sync Engine ─────────────────────────────────────────────────────────────

export type NetworkStatus = "online" | "offline" | "reconnecting"

export interface SyncEngineOptions {
  /** Reconnect interval in ms (default: 3000) */
  reconnectInterval?: number
  /** Max reconnect attempts (default: Infinity) */
  maxReconnectAttempts?: number
  /** Sync batch size for mutation replay (default: 10) */
  syncBatchSize?: number
}

export interface SyncEngineEvents {
  onStatusChange?: (status: NetworkStatus) => void
  onSyncStart?: () => void
  onSyncComplete?: (syncedCount: number) => void
  onSyncError?: (error: Error) => void
  onConflict?: (mutation: QueuedMutation, error: Error) => void
}

export class SyncEngine {
  private status: NetworkStatus = "offline"
  private mutationQueue: MutationQueue
  private queryCache: OfflineQueryCache
  private events: SyncEngineEvents
  private reconnectInterval: number
  private maxReconnectAttempts: number
  private syncBatchSize: number
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private syncInProgress = false

  constructor(
    mutationQueue: MutationQueue,
    queryCache: OfflineQueryCache,
    options: SyncEngineOptions = {},
    events: SyncEngineEvents = {},
  ) {
    this.mutationQueue = mutationQueue
    this.queryCache = queryCache
    this.events = events
    this.reconnectInterval = options.reconnectInterval ?? 3000
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? Infinity
    this.syncBatchSize = options.syncBatchSize ?? 10
  }

  get networkStatus(): NetworkStatus {
    return this.status
  }

  get isOnline(): boolean {
    return this.status === "online"
  }

  get pendingMutations(): number {
    return this.mutationQueue.pending.length
  }

  setOnline(): void {
    if (this.status === "online") return
    this.status = "online"
    this.reconnectAttempts = 0
    this.events.onStatusChange?.("online")
  }

  setOffline(): void {
    if (this.status === "offline") return
    this.status = "offline"
    this.events.onStatusChange?.("offline")
  }

  setReconnecting(): void {
    this.status = "reconnecting"
    this.events.onStatusChange?.("reconnecting")
  }

  /**
   * Replay pending mutations to the server.
   * Called when connection is re-established.
   */
  async replayMutations(executeMutation: (name: string, args: unknown) => Promise<unknown>): Promise<number> {
    if (this.syncInProgress) return 0
    this.syncInProgress = true
    this.events.onSyncStart?.()

    let syncedCount = 0

    try {
      let batch = 0
      const attempted = new Set<string>()
      while (batch < this.syncBatchSize) {
        const mutation = await this.mutationQueue.dequeue()
        if (!mutation || attempted.has(mutation.id)) break
        attempted.add(mutation.id)

        try {
          await executeMutation(mutation.mutationName, mutation.args)
          await this.mutationQueue.markCompleted(mutation.id)
          syncedCount++
        } catch (error: unknown) {
          const err = error instanceof Error ? error : new Error(String(error))
          await this.mutationQueue.markFailed(mutation.id, err.message)
          this.events.onConflict?.(mutation, err)
        }

        batch++
      }

      this.events.onSyncComplete?.(syncedCount)
    } catch (error: unknown) {
      this.events.onSyncError?.(error instanceof Error ? error : new Error(String(error)))
    } finally {
      this.syncInProgress = false
    }

    return syncedCount
  }

  /**
   * Start automatic reconnection attempts.
   */
  startReconnect(connectFn: () => Promise<boolean>): void {
    if (this.reconnectTimer) return

    this.setReconnecting()
    this.attemptReconnect(connectFn)
  }

  /**
   * Stop reconnection attempts.
   */
  stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private async attemptReconnect(connectFn: () => Promise<boolean>): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setOffline()
      return
    }

    this.reconnectAttempts++

    try {
      const connected = await connectFn()
      if (connected) {
        this.setOnline()
        return
      }
    } catch {
      // Connection failed
    }

    // Schedule next attempt with exponential backoff
    const delay = Math.min(this.reconnectInterval * Math.pow(1.5, this.reconnectAttempts - 1), 30_000)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.attemptReconnect(connectFn)
    }, delay)
  }

  destroy(): void {
    this.stopReconnect()
  }
}

// ─── In-Memory Storage (for testing) ─────────────────────────────────────────

export class InMemoryOfflineStorage implements OfflineStorage {
  private store = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async getAllKeys(): Promise<string[]> {
    return [...this.store.keys()]
  }

  async clear(): Promise<void> {
    this.store.clear()
  }

  get size(): number {
    return this.store.size
  }
}
