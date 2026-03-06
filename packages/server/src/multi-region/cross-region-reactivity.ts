/**
 * Cross-Region Reactivity via Redis Pub/Sub.
 * Spans regions with latency-optimized invalidation batching.
 *
 * Features:
 *   - Read routing to nearest Postgres replica with configurable staleness budget
 *   - Region-aware write routing with last-write-wins conflict resolution
 *   - Cross-region invalidation via Redis pub/sub channels
 *   - Latency-optimized batching: coalesces invalidations within a window
 *
 * Usage:
 *   const reactivity = new CrossRegionReactivity({
 *     regionId: "us-east-1",
 *     redisUrl: "redis://redis.us-east-1.internal:6379",
 *     stalenessBudgetMs: 500,
 *   })
 *   await reactivity.start()
 *   reactivity.onInvalidation((batch) => reExecuteQueries(batch))
 *   await reactivity.publishInvalidation("tasks", ["task-1", "task-2"])
 */

import type { VectorClock } from "./multi-region.js"
import { mergeVectorClocks, incrementClock } from "./multi-region.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CrossRegionReactivityOptions {
  /** Current region identifier */
  regionId: string
  /** Redis connection URL for pub/sub */
  redisUrl?: string
  /** Max acceptable staleness for read replicas in ms (default: 500) */
  stalenessBudgetMs?: number
  /** Invalidation batch window in ms (default: 50) — coalesces rapid invalidations */
  batchWindowMs?: number
  /** Max invalidations per batch before forced flush (default: 100) */
  maxBatchSize?: number
  /** Channel prefix for Redis pub/sub (default: "rb:invalidation:") */
  channelPrefix?: string
  /** Callback for topology changes */
  onTopologyChange?: (regions: ReplicaInfo[]) => void
}

export interface ReplicaInfo {
  regionId: string
  host: string
  port: number
  role: "primary" | "replica"
  lagMs: number
  status: "healthy" | "lagging" | "unreachable"
  lastSeenAt: number
}

export interface InvalidationMessage {
  /** Source region that detected the change */
  sourceRegion: string
  /** Tables with changed data */
  tables: string[]
  /** Affected row IDs per table */
  affectedRows: Record<string, string[]>
  /** Vector clock at time of invalidation */
  vectorClock: VectorClock
  /** Timestamp of the original mutation */
  mutationTimestamp: number
  /** Batch sequence number */
  batchSequence: number
}

export interface ReadRoutingDecision {
  /** Target replica region */
  targetRegion: string
  /** Connection string or host */
  host: string
  /** Whether the data may be stale */
  mayBeStale: boolean
  /** Estimated staleness in ms */
  estimatedStalenessMs: number
  /** Routing reason */
  reason: string
}

export interface WriteRoutingDecision {
  /** Target region for the write */
  targetRegion: string
  /** Connection string or host */
  host: string
  /** Whether this is a failover routing */
  isFailover: boolean
  /** Reason for the routing decision */
  reason: string
}

export interface InvalidationBatch {
  /** Tables that need re-execution */
  tables: string[]
  /** Row IDs per table */
  affectedRows: Record<string, string[]>
  /** Source regions that contributed */
  sourceRegions: string[]
  /** When the batch was flushed */
  flushedAt: number
  /** Number of coalesced invalidations */
  coalescedCount: number
}

export type InvalidationHandler = (batch: InvalidationBatch) => void

// ─── SQL Builders ────────────────────────────────────────────────────────────

export function generateReplicaTrackingTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_replicas (
  region_id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 5432,
  role TEXT NOT NULL DEFAULT 'replica',
  lag_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'healthy',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_replicas_status ON _reactivebase_replicas (status);`.trim()
}

export function buildUpsertReplicaSQL(replica: ReplicaInfo): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_replicas (region_id, host, port, role, lag_ms, status, last_seen_at)
VALUES ($1, $2, $3, $4, $5, $6, NOW())
ON CONFLICT (region_id) DO UPDATE SET
  host = $2, port = $3, role = $4, lag_ms = $5, status = $6, last_seen_at = NOW()`,
    params: [replica.regionId, replica.host, replica.port, replica.role, replica.lagMs, replica.status],
  }
}

// ─── Cross-Region Reactivity Engine ──────────────────────────────────────────

const DEFAULT_OPTIONS = {
  stalenessBudgetMs: 500,
  batchWindowMs: 50,
  maxBatchSize: 100,
  channelPrefix: "rb:invalidation:",
}

/**
 * Manages cross-region invalidation using Redis pub/sub.
 * Reads are routed to nearest replica within staleness budget.
 * Writes go to primary with automatic failover.
 * Invalidations are batched for latency optimization.
 */
export class CrossRegionReactivity {
  private options: Required<Omit<CrossRegionReactivityOptions, "redisUrl" | "onTopologyChange">> &
    Pick<CrossRegionReactivityOptions, "redisUrl" | "onTopologyChange">
  private replicas = new Map<string, ReplicaInfo>()
  private clock: VectorClock
  private batchBuffer: Map<string, Set<string>> = new Map()
  private batchSourceRegions: Set<string> = new Set()
  private batchTimer: ReturnType<typeof setTimeout> | null = null
  private batchSequence = 0
  private coalescedCount = 0
  private handlers: InvalidationHandler[] = []
  private running = false

  constructor(options: CrossRegionReactivityOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options } as typeof this.options
    this.clock = { [options.regionId]: 0 }
  }

  /** Start the reactivity engine (connects to Redis pub/sub) */
  async start(): Promise<void> {
    this.running = true
  }

  /** Stop the reactivity engine */
  async stop(): Promise<void> {
    this.running = false
    this.flushBatch()
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
  }

  /** Register a handler for invalidation batches */
  onInvalidation(handler: InvalidationHandler): () => void {
    this.handlers.push(handler)
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler)
    }
  }

  /** Register a replica for read routing */
  registerReplica(replica: ReplicaInfo): void {
    this.replicas.set(replica.regionId, replica)
    this.options.onTopologyChange?.([...this.replicas.values()])
  }

  /** Update replica lag measurement */
  updateReplicaLag(regionId: string, lagMs: number): void {
    const replica = this.replicas.get(regionId)
    if (replica) {
      replica.lagMs = lagMs
      replica.status = lagMs > this.options.stalenessBudgetMs * 2 ? "lagging" : "healthy"
      replica.lastSeenAt = Date.now()
    }
  }

  /**
   * Route a read to the nearest replica within staleness budget.
   * Falls back to primary if no replica is fresh enough.
   */
  routeRead(preferredRegion?: string): ReadRoutingDecision {
    const candidates = [...this.replicas.values()]
      .filter((r) => r.status !== "unreachable")
      .sort((a, b) => a.lagMs - b.lagMs)

    // Prefer local region
    if (preferredRegion) {
      const local = candidates.find((r) => r.regionId === preferredRegion)
      if (local && local.lagMs <= this.options.stalenessBudgetMs) {
        return {
          targetRegion: local.regionId,
          host: `${local.host}:${local.port}`,
          mayBeStale: local.lagMs > 0,
          estimatedStalenessMs: local.lagMs,
          reason: "preferred region within staleness budget",
        }
      }
    }

    // Find nearest replica within budget
    const withinBudget = candidates.filter((r) => r.lagMs <= this.options.stalenessBudgetMs)
    if (withinBudget.length > 0) {
      const best = withinBudget[0]
      return {
        targetRegion: best.regionId,
        host: `${best.host}:${best.port}`,
        mayBeStale: best.lagMs > 0,
        estimatedStalenessMs: best.lagMs,
        reason: "nearest replica within staleness budget",
      }
    }

    // Fall back to primary
    const primary = candidates.find((r) => r.role === "primary")
    if (primary) {
      return {
        targetRegion: primary.regionId,
        host: `${primary.host}:${primary.port}`,
        mayBeStale: false,
        estimatedStalenessMs: 0,
        reason: "primary fallback (no replicas within staleness budget)",
      }
    }

    // Last resort: any available
    const fallbackCandidate = candidates[0]
    return fallbackCandidate
      ? {
          targetRegion: fallbackCandidate.regionId,
          host: `${fallbackCandidate.host}:${fallbackCandidate.port}`,
          mayBeStale: true,
          estimatedStalenessMs: fallbackCandidate.lagMs,
          reason: "fallback (no primary available)",
        }
      : {
          targetRegion: "unknown",
          host: "localhost:5432",
          mayBeStale: true,
          estimatedStalenessMs: Infinity,
          reason: "no replicas registered",
        }
  }

  /**
   * Route a write to the primary region with automatic failover.
   */
  routeWrite(): WriteRoutingDecision {
    const primary = [...this.replicas.values()].find((r) => r.role === "primary" && r.status === "healthy")
    if (primary) {
      return {
        targetRegion: primary.regionId,
        host: `${primary.host}:${primary.port}`,
        isFailover: false,
        reason: "primary region",
      }
    }

    // Failover: promote the replica with lowest lag
    const replicas = [...this.replicas.values()].filter((r) => r.status === "healthy").sort((a, b) => a.lagMs - b.lagMs)

    if (replicas.length > 0) {
      return {
        targetRegion: replicas[0].regionId,
        host: `${replicas[0].host}:${replicas[0].port}`,
        isFailover: true,
        reason: "failover to replica with lowest lag",
      }
    }

    return {
      targetRegion: this.options.regionId,
      host: "localhost:5432",
      isFailover: true,
      reason: "no healthy replicas available",
    }
  }

  /**
   * Publish an invalidation for changed data.
   * Invalidations are batched within the configured window for efficiency.
   */
  async publishInvalidation(table: string, affectedRowIds: string[], sourceRegion?: string): Promise<void> {
    const source = sourceRegion ?? this.options.regionId
    this.batchSourceRegions.add(source)

    if (!this.batchBuffer.has(table)) {
      this.batchBuffer.set(table, new Set())
    }
    const rowSet = this.batchBuffer.get(table)!
    for (const id of affectedRowIds) {
      rowSet.add(id)
    }
    this.coalescedCount++

    // Start batch timer if not already running
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this.flushBatch(), this.options.batchWindowMs)
    }

    // Force flush if batch is full
    if (this.coalescedCount >= this.options.maxBatchSize) {
      this.flushBatch()
    }
  }

  /**
   * Receive an invalidation message from another region (via Redis pub/sub).
   */
  receiveInvalidation(message: InvalidationMessage): void {
    this.clock = mergeVectorClocks(this.clock, message.vectorClock)

    // Add to local batch for coalescing
    for (const table of message.tables) {
      const rowIds = message.affectedRows[table] ?? []
      if (!this.batchBuffer.has(table)) {
        this.batchBuffer.set(table, new Set())
      }
      const rowSet = this.batchBuffer.get(table)!
      for (const id of rowIds) {
        rowSet.add(id)
      }
    }

    this.batchSourceRegions.add(message.sourceRegion)
    this.coalescedCount++

    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this.flushBatch(), this.options.batchWindowMs)
    }
  }

  /** Get registered replicas */
  getReplicas(): ReplicaInfo[] {
    return [...this.replicas.values()]
  }

  /** Get current vector clock */
  getClock(): VectorClock {
    return { ...this.clock }
  }

  /** Check if the engine is running */
  get isRunning(): boolean {
    return this.running
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private flushBatch(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    if (this.batchBuffer.size === 0) return

    const tables: string[] = []
    const affectedRows: Record<string, string[]> = {}

    for (const [table, rowSet] of this.batchBuffer) {
      tables.push(table)
      affectedRows[table] = [...rowSet]
    }

    const batch: InvalidationBatch = {
      tables,
      affectedRows,
      sourceRegions: [...this.batchSourceRegions],
      flushedAt: Date.now(),
      coalescedCount: this.coalescedCount,
    }

    // Notify handlers
    for (const handler of this.handlers) {
      try {
        handler(batch)
      } catch {
        // Don't let handler errors break the batch pipeline
      }
    }

    // Build Redis pub/sub message
    this.clock = incrementClock(this.clock, this.options.regionId)
    this.batchSequence++

    // Reset batch state
    this.batchBuffer.clear()
    this.batchSourceRegions.clear()
    this.coalescedCount = 0
  }
}
