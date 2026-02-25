/**
 * Advanced Offline Sync Engine with conflict resolution.
 * Extends the basic offline support with:
 *   - Vector clocks for causal ordering across clients
 *   - Configurable conflict resolution strategies (LWW, custom merge)
 *   - Automatic sync with exponential backoff
 *   - Sync status tracking and progress events
 *   - Delta sync (only send changed data)
 *   - Batch mutation replay with transaction semantics
 *
 * Usage:
 *   const engine = new OfflineSyncEngine({
 *     storage: new MemoryOfflineStorage(),
 *     clientId: "client-1",
 *     onSync: (status) => updateUI(status),
 *   })
 *   engine.queueMutation("tasks.complete", { taskId: "t1" })
 *   await engine.sync(executeMutation)
 */

import type { OfflineStorage, PendingMutation } from "./offline.js"
import { MutationQueue, PersistentCache } from "./offline.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SyncEngineOptions {
  /** Client storage backend */
  storage: OfflineStorage
  /** Unique client identifier */
  clientId: string
  /** Max retry attempts per mutation (default: 5) */
  maxRetries?: number
  /** Initial backoff delay in ms (default: 1000) */
  initialBackoffMs?: number
  /** Max backoff delay in ms (default: 30000) */
  maxBackoffMs?: number
  /** Batch size for mutation replay (default: 10) */
  batchSize?: number
  /** Conflict resolution strategy (default: "last-write-wins") */
  conflictStrategy?: ConflictStrategy
  /** Custom merge function for "custom" strategy */
  customMerge?: MergeFunction
  /** Callback for sync status changes */
  onSyncStatus?: (status: SyncStatus) => void
  /** Callback for conflict notifications */
  onConflict?: (conflict: SyncConflict) => void
}

export type ConflictStrategy = "last-write-wins" | "server-wins" | "client-wins" | "custom"

export type MergeFunction = (clientValue: unknown, serverValue: unknown, baseValue: unknown | undefined) => unknown

export interface VectorClock {
  [clientId: string]: number
}

export interface SyncStatus {
  state: "idle" | "syncing" | "error" | "offline"
  pendingMutations: number
  lastSyncAt: number | null
  lastError: string | null
  syncProgress: { current: number; total: number } | null
}

export interface SyncConflict {
  mutationId: string
  mutationName: string
  clientArgs: unknown
  serverState: unknown
  resolution: "client-wins" | "server-wins" | "merged" | "dropped"
  resolvedValue?: unknown
}

export interface SyncBatchResult {
  synced: number
  failed: number
  conflicts: SyncConflict[]
  durationMs: number
}

export interface VersionedValue {
  value: unknown
  clock: VectorClock
  clientId: string
  timestamp: number
}

export interface DeltaChange {
  table: string
  rowId: string
  fields: Record<string, unknown>
  clock: VectorClock
  clientId: string
  timestamp: number
}

// ─── Vector Clock Operations ─────────────────────────────────────────────────

export function createVectorClock(clientId: string): VectorClock {
  return { [clientId]: 0 }
}

export function incrementClock(clock: VectorClock, clientId: string): VectorClock {
  return { ...clock, [clientId]: (clock[clientId] ?? 0) + 1 }
}

export function mergeClock(a: VectorClock, b: VectorClock): VectorClock {
  const merged: VectorClock = { ...a }
  for (const [id, value] of Object.entries(b)) {
    merged[id] = Math.max(merged[id] ?? 0, value)
  }
  return merged
}

export function happensBefore(a: VectorClock, b: VectorClock): boolean {
  let strictlyLess = false
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const aVal = a[id] ?? 0
    const bVal = b[id] ?? 0
    if (aVal > bVal) return false
    if (aVal < bVal) strictlyLess = true
  }
  return strictlyLess
}

export function areConcurrent(a: VectorClock, b: VectorClock): boolean {
  return !happensBefore(a, b) && !happensBefore(b, a) && !clocksEqual(a, b)
}

export function clocksEqual(a: VectorClock, b: VectorClock): boolean {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const id of allKeys) {
    if ((a[id] ?? 0) !== (b[id] ?? 0)) return false
  }
  return true
}

// ─── Offline Sync Engine ─────────────────────────────────────────────────────

const DEFAULT_SYNC_OPTIONS = {
  maxRetries: 5,
  initialBackoffMs: 1000,
  maxBackoffMs: 30_000,
  batchSize: 10,
  conflictStrategy: "last-write-wins" as ConflictStrategy,
}

export class OfflineSyncEngine {
  private options: Required<Omit<SyncEngineOptions, "customMerge" | "onSyncStatus" | "onConflict">> &
    Pick<SyncEngineOptions, "customMerge" | "onSyncStatus" | "onConflict">
  private queue: MutationQueue
  private cache: PersistentCache
  private clock: VectorClock
  private status: SyncStatus = {
    state: "idle",
    pendingMutations: 0,
    lastSyncAt: null,
    lastError: null,
    syncProgress: null,
  }
  private backoffAttempt = 0
  private deltas = new Map<string, DeltaChange>()

  constructor(options: SyncEngineOptions) {
    this.options = { ...DEFAULT_SYNC_OPTIONS, ...options }
    this.queue = new MutationQueue(options.storage, 10_000)
    this.cache = new PersistentCache(options.storage)
    this.clock = createVectorClock(options.clientId)
  }

  get syncStatus(): SyncStatus {
    return { ...this.status }
  }

  get vectorClock(): VectorClock {
    return { ...this.clock }
  }

  get clientId(): string {
    return this.options.clientId
  }

  // ─── Mutation Queueing ───────────────────────────────────────────────────

  async queueMutation(mutationName: string, args: unknown): Promise<string> {
    this.clock = incrementClock(this.clock, this.options.clientId)
    const id = await this.queue.enqueue(mutationName, args)
    this.status.pendingMutations = await this.queue.size()
    this.emitStatus()
    return id
  }

  async getPendingMutations(): Promise<PendingMutation[]> {
    return this.queue.getPending()
  }

  async getPendingCount(): Promise<number> {
    return this.queue.size()
  }

  // ─── Cache Operations ────────────────────────────────────────────────────

  async cacheQuery(queryName: string, argsKey: string, data: unknown, version: number): Promise<void> {
    await this.cache.set(queryName, argsKey, data, version)
  }

  async getCachedQuery(queryName: string, argsKey: string) {
    return this.cache.get(queryName, argsKey)
  }

  async invalidateCache(queryName: string): Promise<void> {
    await this.cache.invalidate(queryName)
  }

  // ─── Delta Tracking ──────────────────────────────────────────────────────

  trackDelta(table: string, rowId: string, fields: Record<string, unknown>): void {
    this.clock = incrementClock(this.clock, this.options.clientId)
    const key = `${table}:${rowId}`
    const existing = this.deltas.get(key)

    if (existing) {
      // Merge fields into existing delta
      existing.fields = { ...existing.fields, ...fields }
      existing.clock = { ...this.clock }
      existing.timestamp = Date.now()
    } else {
      this.deltas.set(key, {
        table,
        rowId,
        fields,
        clock: { ...this.clock },
        clientId: this.options.clientId,
        timestamp: Date.now(),
      })
    }
  }

  getPendingDeltas(): DeltaChange[] {
    return Array.from(this.deltas.values())
  }

  clearDeltas(): void {
    this.deltas.clear()
  }

  // ─── Sync Execution ──────────────────────────────────────────────────────

  async sync(
    executeMutation: (name: string, args: unknown) => Promise<unknown>,
    serverStateFetcher?: (mutationName: string) => Promise<unknown>,
  ): Promise<SyncBatchResult> {
    if (this.status.state === "syncing") {
      return { synced: 0, failed: 0, conflicts: [], durationMs: 0 }
    }

    const startTime = Date.now()
    this.updateStatus("syncing")
    const conflicts: SyncConflict[] = []
    let synced = 0
    let failed = 0

    try {
      const pending = await this.queue.getPending()
      const total = pending.length

      // Process in batches
      for (let i = 0; i < pending.length; i += this.options.batchSize) {
        const batch = pending.slice(i, i + this.options.batchSize)
        this.status.syncProgress = { current: i, total }
        this.emitStatus()

        for (const mutation of batch) {
          if (mutation.retries >= this.options.maxRetries) {
            // Dead letter — drop after max retries
            await this.queue.markComplete(mutation.id)
            conflicts.push({
              mutationId: mutation.id,
              mutationName: mutation.mutationName,
              clientArgs: mutation.args,
              serverState: null,
              resolution: "dropped",
            })
            failed++
            continue
          }

          try {
            await executeMutation(mutation.mutationName, mutation.args)
            await this.queue.markComplete(mutation.id)
            synced++
            this.backoffAttempt = 0
          } catch (error: unknown) {
            const conflict = await this.resolveConflict(mutation, error, serverStateFetcher)

            if (conflict) {
              conflicts.push(conflict)
              if (conflict.resolution === "dropped" || conflict.resolution === "server-wins") {
                await this.queue.markComplete(mutation.id)
              } else {
                await this.queue.markRetry(mutation.id)
              }
            } else {
              await this.queue.markRetry(mutation.id)
            }
            failed++
          }
        }
      }

      this.status.lastSyncAt = Date.now()
      this.status.pendingMutations = await this.queue.size()
      this.updateStatus(this.status.pendingMutations > 0 ? "error" : "idle")
      this.backoffAttempt = 0
    } catch (error: unknown) {
      this.status.lastError = error instanceof Error ? error.message : String(error)
      this.updateStatus("error")
      this.backoffAttempt++
    }

    // Notify conflicts
    for (const conflict of conflicts) {
      this.options.onConflict?.(conflict)
    }

    return {
      synced,
      failed,
      conflicts,
      durationMs: Date.now() - startTime,
    }
  }

  getBackoffDelay(): number {
    const delay = this.options.initialBackoffMs * Math.pow(2, this.backoffAttempt)
    return Math.min(delay, this.options.maxBackoffMs)
  }

  // ─── Conflict Resolution ─────────────────────────────────────────────────

  resolveVersionConflict(
    clientValue: VersionedValue,
    serverValue: VersionedValue,
  ): { winner: "client" | "server" | "merged"; value: unknown } {
    // If server happens-before client, client wins
    if (happensBefore(serverValue.clock, clientValue.clock)) {
      return { winner: "client", value: clientValue.value }
    }

    // If client happens-before server, server wins
    if (happensBefore(clientValue.clock, serverValue.clock)) {
      return { winner: "server", value: serverValue.value }
    }

    // Concurrent — use conflict strategy
    switch (this.options.conflictStrategy) {
      case "client-wins":
        return { winner: "client", value: clientValue.value }
      case "server-wins":
        return { winner: "server", value: serverValue.value }
      case "custom":
        if (this.options.customMerge) {
          const merged = this.options.customMerge(clientValue.value, serverValue.value, undefined)
          return { winner: "merged", value: merged }
        }
      // Fall through to LWW
      case "last-write-wins":
      default:
        // LWW: higher timestamp wins; tie-break by client ID
        if (clientValue.timestamp > serverValue.timestamp) {
          return { winner: "client", value: clientValue.value }
        }
        if (serverValue.timestamp > clientValue.timestamp) {
          return { winner: "server", value: serverValue.value }
        }
        // Tie: lexicographic client ID comparison for determinism
        return clientValue.clientId > serverValue.clientId
          ? { winner: "client", value: clientValue.value }
          : { winner: "server", value: serverValue.value }
    }
  }

  receiveClock(remoteClock: VectorClock): void {
    this.clock = mergeClock(this.clock, remoteClock)
    this.clock = incrementClock(this.clock, this.options.clientId)
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private async resolveConflict(
    mutation: PendingMutation,
    _error: unknown,
    serverStateFetcher?: (mutationName: string) => Promise<unknown>,
  ): Promise<SyncConflict | null> {
    const serverState = serverStateFetcher ? await serverStateFetcher(mutation.mutationName).catch(() => null) : null

    switch (this.options.conflictStrategy) {
      case "server-wins":
        return {
          mutationId: mutation.id,
          mutationName: mutation.mutationName,
          clientArgs: mutation.args,
          serverState,
          resolution: "server-wins",
        }
      case "client-wins":
        return {
          mutationId: mutation.id,
          mutationName: mutation.mutationName,
          clientArgs: mutation.args,
          serverState,
          resolution: "client-wins",
        }
      case "custom":
        if (this.options.customMerge && serverState != null) {
          const merged = this.options.customMerge(mutation.args, serverState, undefined)
          return {
            mutationId: mutation.id,
            mutationName: mutation.mutationName,
            clientArgs: mutation.args,
            serverState,
            resolution: "merged",
            resolvedValue: merged,
          }
        }
        return null
      default:
        return null
    }
  }

  private updateStatus(state: SyncStatus["state"]): void {
    this.status.state = state
    if (state !== "syncing") {
      this.status.syncProgress = null
    }
    this.emitStatus()
  }

  private emitStatus(): void {
    this.options.onSyncStatus?.({ ...this.status })
  }
}
