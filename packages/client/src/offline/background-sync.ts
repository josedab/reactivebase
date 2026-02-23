/**
 * Background sync engine for offline-first mobile support.
 * Provides automatic sync loop with exponential backoff,
 * connectivity awareness, priority-based queue, and event callbacks.
 *
 * Usage:
 *   const manager = new BackgroundSyncManager({
 *     syncFn: () => engine.sync(execute),
 *     getPendingCount: () => engine.getPendingCount(),
 *   })
 *   manager.start()
 *   manager.onConnectivityChange(navigator.onLine)
 */

import type { SyncBatchResult } from "./sync-engine.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export type SyncState = "idle" | "syncing" | "error" | "offline"

export interface SyncStatus {
  /** Current state of the sync engine */
  state: SyncState
  /** Number of pending mutations waiting to sync */
  pendingCount: number
  /** Timestamp of last successful sync (ms since epoch), or null */
  lastSyncAt: number | null
  /** Timestamp of next scheduled sync (ms since epoch), or null */
  nextSyncAt: number | null
  /** Number of consecutive failures */
  consecutiveFailures: number
}

export interface ConnectivityAwarePrimitive {
  /** Whether the device is currently online */
  isOnline: boolean
  /** Number of changes waiting to be synced */
  pendingChangesCount: number
  /** Sync progress (0-1), or null if not syncing */
  syncProgress: number | null
}

export interface BackgroundSyncOptions {
  /** Function that performs the actual sync */
  syncFn: () => Promise<SyncBatchResult>
  /** Function that returns the current pending mutation count */
  getPendingCount: () => Promise<number>
  /** Base interval between syncs in ms (default: 5000) */
  syncIntervalMs?: number
  /** Initial backoff delay in ms (default: 1000) */
  initialBackoffMs?: number
  /** Maximum backoff delay in ms (default: 60000) */
  maxBackoffMs?: number
  /** Maximum consecutive failures before stopping (default: Infinity) */
  maxConsecutiveFailures?: number
}

export interface PriorityMutation {
  id: string
  mutationName: string
  args: unknown
  priority: "critical" | "high" | "normal" | "low"
  timestamp: number
}

// ─── Background Sync Manager ─────────────────────────────────────────────────

const DEFAULT_OPTIONS = {
  syncIntervalMs: 5_000,
  initialBackoffMs: 1_000,
  maxBackoffMs: 60_000,
  maxConsecutiveFailures: Infinity,
}

export class BackgroundSyncManager {
  private options: Required<Pick<BackgroundSyncOptions, "syncFn" | "getPendingCount">> & typeof DEFAULT_OPTIONS
  private status: SyncStatus = {
    state: "idle",
    pendingCount: 0,
    lastSyncAt: null,
    nextSyncAt: null,
    consecutiveFailures: 0,
  }
  private running = false
  private syncing = false
  private timerId: ReturnType<typeof setTimeout> | null = null
  private online = true

  private syncCompleteCallbacks: Array<(result: SyncBatchResult) => void> = []
  private conflictCallbacks: Array<(conflicts: SyncBatchResult["conflicts"]) => void> = []

  // Priority queue for critical mutations
  private priorityQueue: PriorityMutation[] = []

  constructor(options: BackgroundSyncOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Start the background sync loop.
   */
  start(): void {
    if (this.running) return
    this.running = true

    if (!this.online) {
      this.updateState("offline")
      return
    }

    this.scheduleNext(0)
  }

  /**
   * Stop the background sync loop.
   */
  stop(): void {
    this.running = false
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
      this.timerId = null
    }
    this.status.nextSyncAt = null
  }

  /**
   * Trigger an immediate sync (bypasses interval timer).
   */
  async syncNow(): Promise<SyncBatchResult | null> {
    if (this.syncing) return null
    if (!this.online) {
      this.updateState("offline")
      return null
    }

    // Cancel the scheduled timer if any
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
      this.timerId = null
    }

    return this.executeSyncCycle()
  }

  /**
   * React to network connectivity changes.
   */
  onConnectivityChange(isOnline: boolean): void {
    this.online = isOnline

    if (isOnline) {
      if (this.status.state === "offline") {
        this.status.consecutiveFailures = 0
        this.updateState("idle")
      }
      if (this.running) {
        // Trigger immediate sync on reconnection
        this.scheduleNext(0)
      }
    } else {
      this.updateState("offline")
      if (this.timerId !== null) {
        clearTimeout(this.timerId)
        this.timerId = null
      }
      this.status.nextSyncAt = null
    }
  }

  // ─── Status ───────────────────────────────────────────────────────────────

  getSyncStatus(): SyncStatus {
    return { ...this.status }
  }

  getConnectivityState(): ConnectivityAwarePrimitive {
    return {
      isOnline: this.online,
      pendingChangesCount: this.status.pendingCount,
      syncProgress: this.status.state === "syncing" ? null : null,
    }
  }

  get isRunning(): boolean {
    return this.running
  }

  // ─── Event Callbacks ──────────────────────────────────────────────────────

  onSyncComplete(callback: (result: SyncBatchResult) => void): () => void {
    this.syncCompleteCallbacks.push(callback)
    return () => {
      this.syncCompleteCallbacks = this.syncCompleteCallbacks.filter((cb) => cb !== callback)
    }
  }

  onConflict(callback: (conflicts: SyncBatchResult["conflicts"]) => void): () => void {
    this.conflictCallbacks.push(callback)
    return () => {
      this.conflictCallbacks = this.conflictCallbacks.filter((cb) => cb !== callback)
    }
  }

  // ─── Priority Queue ───────────────────────────────────────────────────────

  enqueuePriority(mutation: PriorityMutation): void {
    this.priorityQueue.push(mutation)
    this.priorityQueue.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 }
      const diff = priorityOrder[a.priority] - priorityOrder[b.priority]
      return diff !== 0 ? diff : a.timestamp - b.timestamp
    })
  }

  getPriorityQueue(): PriorityMutation[] {
    return [...this.priorityQueue]
  }

  clearPriorityQueue(): void {
    this.priorityQueue = []
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async executeSyncCycle(): Promise<SyncBatchResult> {
    this.syncing = true
    this.updateState("syncing")

    try {
      const result = await this.options.syncFn()

      this.status.lastSyncAt = Date.now()
      this.status.consecutiveFailures = 0
      this.status.pendingCount = await this.options.getPendingCount()
      this.updateState("idle")

      // Notify sync complete callbacks
      for (const cb of this.syncCompleteCallbacks) {
        cb(result)
      }

      // Notify conflict callbacks if there were conflicts
      if (result.conflicts.length > 0) {
        for (const cb of this.conflictCallbacks) {
          cb(result.conflicts)
        }
      }

      // Schedule next sync if running
      if (this.running) {
        this.scheduleNext(this.options.syncIntervalMs)
      }

      return result
    } catch (error) {
      this.status.consecutiveFailures++
      this.status.pendingCount = await this.options.getPendingCount().catch(() => this.status.pendingCount)
      this.updateState("error")

      const emptyResult: SyncBatchResult = { synced: 0, failed: 0, conflicts: [], durationMs: 0 }

      // Schedule retry with backoff if under failure limit
      if (this.running && this.status.consecutiveFailures < this.options.maxConsecutiveFailures) {
        this.scheduleNext(this.getBackoffDelay())
      }

      return emptyResult
    } finally {
      this.syncing = false
    }
  }

  private scheduleNext(delayMs: number): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
    }

    this.status.nextSyncAt = Date.now() + delayMs
    this.timerId = setTimeout(async () => {
      this.timerId = null
      if (this.running && this.online && !this.syncing) {
        await this.executeSyncCycle()
      }
    }, delayMs)
  }

  private getBackoffDelay(): number {
    const delay = this.options.initialBackoffMs * Math.pow(2, this.status.consecutiveFailures - 1)
    return Math.min(delay, this.options.maxBackoffMs)
  }

  private updateState(state: SyncState): void {
    this.status.state = state
  }
}
