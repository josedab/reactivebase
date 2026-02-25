/**
 * Smart Connection Pooling & Query Coalescing.
 *
 * Intelligent connection pool that:
 * 1. Coalesces identical concurrent queries into a single DB round-trip
 * 2. Deduplicates subscription re-evaluations across connections
 * 3. Provides backpressure when DB is saturated
 * 4. Adaptive pool sizing based on latency
 */

import { createHash } from "node:crypto"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SmartPoolOptions {
  /** Minimum connections in the pool */
  minConnections?: number
  /** Maximum connections in the pool */
  maxConnections?: number
  /** Coalescing window in ms (queries within this window are candidates for dedup) */
  coalescingWindowMs?: number
  /** Max pending queries before backpressure kicks in */
  maxPendingQueries?: number
  /** Latency threshold (ms) above which pool scales up */
  highLatencyThresholdMs?: number
  /** Latency threshold (ms) below which pool scales down */
  lowLatencyThresholdMs?: number
  /** How often to check pool health (ms) */
  healthCheckIntervalMs?: number
  /** Enable query coalescing (default: true) */
  enableCoalescing?: boolean
  /** Enable adaptive sizing (default: true) */
  enableAdaptiveSizing?: boolean
}

const DEFAULT_OPTIONS: Required<SmartPoolOptions> = {
  minConnections: 2,
  maxConnections: 20,
  coalescingWindowMs: 5,
  maxPendingQueries: 1000,
  highLatencyThresholdMs: 100,
  lowLatencyThresholdMs: 20,
  healthCheckIntervalMs: 10_000,
  enableCoalescing: true,
  enableAdaptiveSizing: true,
}

export interface CoalescedQuery {
  /** Hash of SQL + params for deduplication */
  hash: string
  /** SQL string */
  sql: string
  /** Query parameters */
  params: unknown[]
  /** Resolvers waiting for this query result */
  waiters: Array<{
    resolve: (result: QueryResult) => void
    reject: (error: Error) => void
  }>
  /** When this query was first queued */
  queuedAt: number
}

export interface QueryResult {
  rows: unknown[]
  rowCount: number
}

export interface PoolStats {
  /** Current active connections */
  activeConnections: number
  /** Current idle connections */
  idleConnections: number
  /** Total connections */
  totalConnections: number
  /** Target connections (adaptive) */
  targetConnections: number
  /** Queries currently in flight */
  inFlightQueries: number
  /** Queries waiting for a connection */
  pendingQueries: number
  /** Queries coalesced (deduped) total */
  coalescedTotal: number
  /** Queries executed total */
  executedTotal: number
  /** Queries rejected due to backpressure */
  backpressureRejections: number
  /** Average query latency (ms) */
  avgLatencyMs: number
  /** P99 query latency (ms) */
  p99LatencyMs: number
  /** Pool utilization (0-1) */
  utilization: number
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class BackpressureError extends Error {
  readonly code = "BACKPRESSURE"
  readonly statusCode = 503

  constructor(
    public readonly pendingCount: number,
    public readonly maxPending: number,
  ) {
    super(`Database backpressure: ${pendingCount} pending queries (max: ${maxPending}). Try again later.`)
    this.name = "BackpressureError"
  }
}

export class PoolExhaustedError extends Error {
  readonly code = "POOL_EXHAUSTED"

  constructor(
    public readonly activeConnections: number,
    public readonly maxConnections: number,
  ) {
    super(`Connection pool exhausted: ${activeConnections}/${maxConnections} connections in use`)
    this.name = "PoolExhaustedError"
  }
}

// ─── Query Deduplication Layer ───────────────────────────────────────────────

/**
 * Hash-based query deduplication.
 * Identical queries within a coalescing window share a single DB execution.
 */
export class QueryDeduplicator {
  private inflight = new Map<string, CoalescedQuery>()
  private coalescedCount = 0

  constructor(private coalescingWindowMs: number) {}

  /**
   * Compute a hash for a SQL query + params combination.
   */
  computeHash(sql: string, params: unknown[]): string {
    const key = sql + "|" + JSON.stringify(params)
    return createHash("sha256").update(key).digest("hex").substring(0, 16)
  }

  /**
   * Try to coalesce with an existing in-flight query.
   * Returns a promise that resolves when the shared query completes.
   * Returns null if no matching query is in-flight.
   */
  tryCoalesce(sql: string, params: unknown[]): Promise<QueryResult> | null {
    const hash = this.computeHash(sql, params)
    const existing = this.inflight.get(hash)

    if (!existing) return null

    // Check if within coalescing window
    if (Date.now() - existing.queuedAt > this.coalescingWindowMs) {
      return null
    }

    this.coalescedCount++

    return new Promise<QueryResult>((resolve, reject) => {
      existing.waiters.push({ resolve, reject })
    })
  }

  /**
   * Register a query as in-flight.
   * Returns the coalesced query entry and a promise for the first waiter.
   */
  register(sql: string, params: unknown[]): { entry: CoalescedQuery; promise: Promise<QueryResult> } {
    const hash = this.computeHash(sql, params)

    let resolve!: (result: QueryResult) => void
    let reject!: (error: Error) => void
    const promise = new Promise<QueryResult>((res, rej) => {
      resolve = res
      reject = rej
    })

    const entry: CoalescedQuery = {
      hash,
      sql,
      params,
      waiters: [{ resolve, reject }],
      queuedAt: Date.now(),
    }

    this.inflight.set(hash, entry)
    return { entry, promise }
  }

  /**
   * Resolve all waiters for a coalesced query.
   */
  resolve(hash: string, result: QueryResult): void {
    const entry = this.inflight.get(hash)
    if (!entry) return

    this.inflight.delete(hash)
    for (const waiter of entry.waiters) {
      waiter.resolve(result)
    }
  }

  /**
   * Reject all waiters for a coalesced query.
   */
  reject(hash: string, error: Error): void {
    const entry = this.inflight.get(hash)
    if (!entry) return

    this.inflight.delete(hash)
    for (const waiter of entry.waiters) {
      waiter.reject(error)
    }
  }

  get infightCount(): number {
    return this.inflight.size
  }

  get totalCoalesced(): number {
    return this.coalescedCount
  }
}

// ─── Adaptive Pool Sizer ────────────────────────────────────────────────────

/**
 * Tracks query latencies and recommends pool size adjustments.
 */
export class AdaptivePoolSizer {
  private latencies: number[] = []
  private maxSamples: number
  private currentTarget: number

  constructor(
    private minConnections: number,
    private maxConnections: number,
    private highThresholdMs: number,
    private lowThresholdMs: number,
    maxSamples: number = 100,
  ) {
    this.maxSamples = maxSamples
    this.currentTarget = minConnections
  }

  /**
   * Record a query latency sample.
   */
  recordLatency(latencyMs: number): void {
    this.latencies.push(latencyMs)
    if (this.latencies.length > this.maxSamples) {
      this.latencies.shift()
    }
  }

  /**
   * Get the recommended pool size based on recent latencies.
   */
  getRecommendedSize(): number {
    if (this.latencies.length < 5) return this.currentTarget

    const avgLatency = this.getAverageLatency()
    const p99 = this.getP99Latency()

    if (avgLatency > this.highThresholdMs || p99 > this.highThresholdMs * 3) {
      // Scale up
      this.currentTarget = Math.min(this.currentTarget + 1, this.maxConnections)
    } else if (avgLatency < this.lowThresholdMs && this.currentTarget > this.minConnections) {
      // Scale down
      this.currentTarget = Math.max(this.currentTarget - 1, this.minConnections)
    }

    return this.currentTarget
  }

  getAverageLatency(): number {
    if (this.latencies.length === 0) return 0
    return this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length
  }

  getP99Latency(): number {
    if (this.latencies.length === 0) return 0
    const sorted = [...this.latencies].sort((a, b) => a - b)
    const idx = Math.floor(sorted.length * 0.99)
    return sorted[idx] ?? sorted[sorted.length - 1]
  }

  /**
   * Reset latency tracking.
   */
  reset(): void {
    this.latencies = []
  }
}

// ─── Subscription Deduplication ──────────────────────────────────────────────

/**
 * Deduplicates subscription re-evaluations across connections.
 * When multiple subscriptions watching the same query are invalidated,
 * only one DB query is executed and the result shared.
 */
export class SubscriptionCoalescer {
  private pendingEvaluations = new Map<string, Promise<unknown>>()
  private deduplicatedCount = 0

  /**
   * Create a deduplication key for a subscription re-evaluation.
   */
  createKey(queryName: string, args: unknown): string {
    return queryName + "|" + JSON.stringify(args)
  }

  /**
   * Try to share an existing evaluation. Returns the shared result or null.
   */
  tryShare(key: string): Promise<unknown> | null {
    const existing = this.pendingEvaluations.get(key)
    if (existing) {
      this.deduplicatedCount++
      return existing
    }
    return null
  }

  /**
   * Register a new evaluation. Other calls with the same key will share this result.
   */
  register(key: string, evaluation: Promise<unknown>): void {
    this.pendingEvaluations.set(key, evaluation)

    // Clean up after evaluation completes
    evaluation.finally(() => {
      this.pendingEvaluations.delete(key)
    })
  }

  get pendingCount(): number {
    return this.pendingEvaluations.size
  }

  get totalDeduplicated(): number {
    return this.deduplicatedCount
  }
}

// ─── Batch Evaluator ─────────────────────────────────────────────────────────

export interface BatchEvaluatorOptions {
  /** Max time to wait for more invalidations before executing batch (ms) */
  batchWindowMs?: number
  /** Max invalidations before forcing batch execution */
  maxBatchSize?: number
}

const DEFAULT_BATCH_OPTIONS: Required<BatchEvaluatorOptions> = {
  batchWindowMs: 10,
  maxBatchSize: 100,
}

/**
 * Coalesces mutation-triggered invalidations into batches.
 * Multiple rapid mutations are grouped and their invalidation queries evaluated together.
 */
export class BatchInvalidationEvaluator {
  private pendingInvalidations: Array<{ tables: string[]; callback: () => Promise<void> }> = []
  private batchTimer: ReturnType<typeof setTimeout> | null = null
  private options: Required<BatchEvaluatorOptions>
  private batchesProcessed = 0

  constructor(options: BatchEvaluatorOptions = {}) {
    this.options = { ...DEFAULT_BATCH_OPTIONS, ...options }
  }

  /**
   * Queue an invalidation for batched processing.
   */
  queue(tables: string[], callback: () => Promise<void>): void {
    this.pendingInvalidations.push({ tables, callback })

    if (this.pendingInvalidations.length >= this.options.maxBatchSize) {
      this.flush()
      return
    }

    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this.flush(), this.options.batchWindowMs)
    }
  }

  /**
   * Flush pending invalidations immediately.
   */
  async flush(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    if (this.pendingInvalidations.length === 0) return

    const batch = this.pendingInvalidations.splice(0)
    this.batchesProcessed++

    // Deduplicate by table set
    const _uniqueTables = new Set(batch.flatMap((inv) => inv.tables))
    const uniqueCallbacks = new Map<string, () => Promise<void>>()

    for (const inv of batch) {
      const key = inv.tables.sort().join(",")
      if (!uniqueCallbacks.has(key)) {
        uniqueCallbacks.set(key, inv.callback)
      }
    }

    // Execute deduplicated callbacks
    await Promise.all(Array.from(uniqueCallbacks.values()).map((cb) => cb()))
  }

  /**
   * Stop the batch evaluator.
   */
  stop(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
    this.pendingInvalidations = []
  }

  get pendingCount(): number {
    return this.pendingInvalidations.length
  }

  get totalBatches(): number {
    return this.batchesProcessed
  }
}

// ─── Smart Pool (main class) ────────────────────────────────────────────────

/**
 * Smart connection pool that combines query deduplication, adaptive sizing,
 * subscription coalescing, and backpressure.
 */
export class SmartPool {
  readonly deduplicator: QueryDeduplicator
  readonly sizer: AdaptivePoolSizer
  readonly subscriptionCoalescer: SubscriptionCoalescer
  readonly batchEvaluator: BatchInvalidationEvaluator
  private options: Required<SmartPoolOptions>

  private activeQueries = 0
  private pendingQueries = 0
  private executedTotal = 0
  private rejectedTotal = 0
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: SmartPoolOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }

    this.deduplicator = new QueryDeduplicator(this.options.coalescingWindowMs)
    this.sizer = new AdaptivePoolSizer(
      this.options.minConnections,
      this.options.maxConnections,
      this.options.highLatencyThresholdMs,
      this.options.lowLatencyThresholdMs,
    )
    this.subscriptionCoalescer = new SubscriptionCoalescer()
    this.batchEvaluator = new BatchInvalidationEvaluator()

    if (this.options.enableAdaptiveSizing) {
      this.healthCheckTimer = setInterval(() => this.healthCheck(), this.options.healthCheckIntervalMs)
    }
  }

  /**
   * Execute a query with coalescing and backpressure.
   * If an identical query is already in-flight, the result is shared.
   */
  async query(
    sql: string,
    params: unknown[],
    executor: (sql: string, params: unknown[]) => Promise<QueryResult>,
  ): Promise<QueryResult> {
    // Backpressure check
    if (this.pendingQueries >= this.options.maxPendingQueries) {
      this.rejectedTotal++
      throw new BackpressureError(this.pendingQueries, this.options.maxPendingQueries)
    }

    // Try coalescing
    if (this.options.enableCoalescing) {
      const coalesced = this.deduplicator.tryCoalesce(sql, params)
      if (coalesced) return coalesced
    }

    // Register new query
    const { entry, promise } = this.deduplicator.register(sql, params)
    this.pendingQueries++

    try {
      this.activeQueries++
      const startTime = performance.now()

      const result = await executor(sql, params)

      const latency = performance.now() - startTime
      this.sizer.recordLatency(latency)
      this.executedTotal++

      this.deduplicator.resolve(entry.hash, result)
      return promise
    } catch (error: unknown) {
      this.deduplicator.reject(entry.hash, error instanceof Error ? error : new Error(String(error)))
      throw error
    } finally {
      this.activeQueries--
      this.pendingQueries--
    }
  }

  /**
   * Get pool statistics.
   */
  getStats(): PoolStats {
    const targetConnections = this.sizer.getRecommendedSize()
    return {
      activeConnections: this.activeQueries,
      idleConnections: Math.max(0, targetConnections - this.activeQueries),
      totalConnections: targetConnections,
      targetConnections,
      inFlightQueries: this.activeQueries,
      pendingQueries: this.pendingQueries,
      coalescedTotal: this.deduplicator.totalCoalesced,
      executedTotal: this.executedTotal,
      backpressureRejections: this.rejectedTotal,
      avgLatencyMs: this.sizer.getAverageLatency(),
      p99LatencyMs: this.sizer.getP99Latency(),
      utilization: targetConnections > 0 ? this.activeQueries / targetConnections : 0,
    }
  }

  /**
   * Stop the smart pool.
   */
  stop(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
    this.batchEvaluator.stop()
  }

  private healthCheck(): void {
    // Adaptive pool sizing runs automatically via getRecommendedSize()
    this.sizer.getRecommendedSize()
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createSmartPool(options?: SmartPoolOptions): SmartPool {
  return new SmartPool(options)
}

export function createQueryDeduplicator(coalescingWindowMs?: number): QueryDeduplicator {
  return new QueryDeduplicator(coalescingWindowMs ?? DEFAULT_OPTIONS.coalescingWindowMs)
}

export function createSubscriptionCoalescer(): SubscriptionCoalescer {
  return new SubscriptionCoalescer()
}
