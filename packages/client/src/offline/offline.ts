/**
 * Offline-first client support for ReactiveBase.
 * Provides persistent query cache, mutation queue, and sync protocol.
 *
 * Uses a pluggable storage interface (IndexedDB, localStorage, or in-memory).
 */

export interface OfflineStorage {
  get(key: string): Promise<unknown | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
  clear(): Promise<void>
}

export interface PendingMutation {
  id: string
  mutationName: string
  args: unknown
  timestamp: number
  retries: number
}

export interface OfflineOptions {
  /** Storage backend */
  storage: OfflineStorage
  /** Max mutations to queue while offline (default: 1000) */
  maxQueueSize?: number
  /** Conflict resolution strategy */
  conflictStrategy?: "last-write-wins" | "server-wins" | "client-wins"
}

/**
 * Persistent query cache that survives page reloads.
 */
export class PersistentCache {
  private prefix = "rb_cache_"

  constructor(private storage: OfflineStorage) {}

  async get(queryName: string, argsKey: string): Promise<CachedQuery | undefined> {
    const key = this.prefix + this.cacheKey(queryName, argsKey)
    return (await this.storage.get(key)) as CachedQuery | undefined
  }

  async set(queryName: string, argsKey: string, data: unknown, version: number): Promise<void> {
    const key = this.prefix + this.cacheKey(queryName, argsKey)
    const entry: CachedQuery = {
      queryName,
      argsKey,
      data,
      version,
      cachedAt: Date.now(),
    }
    await this.storage.set(key, entry)
  }

  async invalidate(queryName: string): Promise<void> {
    const keys = await this.storage.keys()
    for (const key of keys) {
      if (key.startsWith(this.prefix + queryName + ":")) {
        await this.storage.delete(key)
      }
    }
  }

  async clear(): Promise<void> {
    const keys = await this.storage.keys()
    for (const key of keys) {
      if (key.startsWith(this.prefix)) {
        await this.storage.delete(key)
      }
    }
  }

  private cacheKey(queryName: string, argsKey: string): string {
    return `${queryName}:${argsKey}`
  }
}

export interface CachedQuery {
  queryName: string
  argsKey: string
  data: unknown
  version: number
  cachedAt: number
}

/**
 * Mutation queue that persists pending mutations while offline.
 */
export class MutationQueue {
  private prefix = "rb_queue_"

  constructor(
    private storage: OfflineStorage,
    private maxSize: number = 1000,
  ) {}

  async enqueue(mutationName: string, args: unknown): Promise<string> {
    const id = `mut_${Date.now()}_${crypto.randomUUID().substring(0, 6)}`
    const entry: PendingMutation = {
      id,
      mutationName,
      args,
      timestamp: Date.now(),
      retries: 0,
    }

    const queueSize = (await this.getPending()).length
    if (queueSize >= this.maxSize) {
      throw new Error("Offline mutation queue is full")
    }

    await this.storage.set(this.prefix + id, entry)
    return id
  }

  async getPending(): Promise<PendingMutation[]> {
    const keys = await this.storage.keys()
    const mutations: PendingMutation[] = []

    for (const key of keys) {
      if (key.startsWith(this.prefix)) {
        const entry = (await this.storage.get(key)) as PendingMutation
        if (entry) mutations.push(entry)
      }
    }

    return mutations.sort((a, b) => a.timestamp - b.timestamp)
  }

  async markComplete(id: string): Promise<void> {
    await this.storage.delete(this.prefix + id)
  }

  async markRetry(id: string): Promise<void> {
    const entry = (await this.storage.get(this.prefix + id)) as PendingMutation
    if (entry) {
      entry.retries++
      await this.storage.set(this.prefix + id, entry)
    }
  }

  async clear(): Promise<void> {
    const keys = await this.storage.keys()
    for (const key of keys) {
      if (key.startsWith(this.prefix)) {
        await this.storage.delete(key)
      }
    }
  }

  async size(): Promise<number> {
    return (await this.getPending()).length
  }
}

/**
 * Sync manager that replays queued mutations on reconnection.
 */
export class SyncManager {
  private queue: MutationQueue
  private syncing = false
  private conflictStrategy: string

  constructor(
    queue: MutationQueue,
    private executeMutation: (name: string, args: unknown) => Promise<unknown>,
    options: { conflictStrategy?: string } = {},
  ) {
    this.queue = queue
    this.conflictStrategy = options.conflictStrategy ?? "last-write-wins"
  }

  /**
   * Replay all queued mutations in order.
   */
  async sync(): Promise<SyncResult> {
    if (this.syncing) return { synced: 0, failed: 0, errors: [] }
    this.syncing = true

    const pending = await this.queue.getPending()
    let synced = 0
    let failed = 0
    const errors: Array<{ id: string; error: string }> = []

    for (const mutation of pending) {
      try {
        await this.executeMutation(mutation.mutationName, mutation.args)
        await this.queue.markComplete(mutation.id)
        synced++
      } catch (error: unknown) {
        failed++
        errors.push({
          id: mutation.id,
          error: error instanceof Error ? error.message : String(error),
        })

        if (this.conflictStrategy === "server-wins") {
          // Drop the conflicting mutation
          await this.queue.markComplete(mutation.id)
        } else {
          await this.queue.markRetry(mutation.id)
        }
      }
    }

    this.syncing = false
    return { synced, failed, errors }
  }

  get isSyncing(): boolean {
    return this.syncing
  }
}

export interface SyncResult {
  synced: number
  failed: number
  errors: Array<{ id: string; error: string }>
}

/**
 * In-memory storage for testing.
 */
export class MemoryOfflineStorage implements OfflineStorage {
  private data = new Map<string, unknown>()

  async get(key: string) {
    return this.data.get(key)
  }
  async set(key: string, value: unknown) {
    this.data.set(key, value)
  }
  async delete(key: string) {
    this.data.delete(key)
  }
  async keys() {
    return Array.from(this.data.keys())
  }
  async clear() {
    this.data.clear()
  }
}
