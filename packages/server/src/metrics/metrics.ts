/**
 * Metrics collector for ReactiveBase observability.
 * Tracks subscriptions, mutations, invalidations, query performance,
 * and exposes data via a JSON API for the observability dashboard.
 */

export interface MetricsSnapshot {
  server: ServerMetrics
  queries: QueryMetrics
  mutations: MutationMetrics
  subscriptions: SubscriptionMetrics
  invalidations: InvalidationMetrics
  uptime: number
}

export interface ServerMetrics {
  connections: number
  activeSubscriptions: number
  pendingJobs: number
}

export interface QueryMetrics {
  totalExecuted: number
  totalErrors: number
  avgLatencyMs: number
  p99LatencyMs: number
  byFunction: Record<string, FunctionMetrics>
}

export interface MutationMetrics {
  totalExecuted: number
  totalErrors: number
  totalRetries: number
  avgLatencyMs: number
  p99LatencyMs: number
  byFunction: Record<string, FunctionMetrics>
}

export interface SubscriptionMetrics {
  totalCreated: number
  totalRemoved: number
  currentActive: number
  avgPerConnection: number
}

export interface InvalidationMetrics {
  totalEvaluations: number
  totalInvalidated: number
  totalSkipped: number
  avgEvaluationTimeMs: number
  falseInvalidationRate: number
}

export interface FunctionMetrics {
  name: string
  calls: number
  errors: number
  totalLatencyMs: number
  avgLatencyMs: number
  lastCalledAt: number
}

export class MetricsCollector {
  private startTime = Date.now()
  private latencies = new LatencyTracker()
  private mutationLatencies = new LatencyTracker()

  private queryCount = 0
  private queryErrors = 0
  private mutationCount = 0
  private mutationErrors = 0
  private mutationRetries = 0

  private subscriptionsCreated = 0
  private subscriptionsRemoved = 0
  private currentSubscriptions = 0
  private currentConnections = 0
  private pendingJobs = 0

  private invalidationEvals = 0
  private invalidationHits = 0
  private invalidationSkips = 0
  private invalidationTotalTimeMs = 0

  private functionMetrics = new Map<string, FunctionMetrics>()

  /**
   * Record a query execution.
   */
  recordQuery(functionName: string, latencyMs: number, error?: boolean): void {
    this.queryCount++
    this.latencies.record(latencyMs)
    if (error) this.queryErrors++

    this.updateFunctionMetrics(functionName, latencyMs, error)
  }

  /**
   * Record a mutation execution.
   */
  recordMutation(functionName: string, latencyMs: number, error?: boolean, retries?: number): void {
    this.mutationCount++
    this.mutationLatencies.record(latencyMs)
    if (error) this.mutationErrors++
    if (retries) this.mutationRetries += retries

    this.updateFunctionMetrics(functionName, latencyMs, error)
  }

  /**
   * Record a subscription lifecycle event.
   */
  recordSubscription(event: "created" | "removed"): void {
    if (event === "created") {
      this.subscriptionsCreated++
      this.currentSubscriptions++
    } else {
      this.subscriptionsRemoved++
      this.currentSubscriptions = Math.max(0, this.currentSubscriptions - 1)
    }
  }

  /**
   * Record an invalidation evaluation.
   */
  recordInvalidation(evaluationTimeMs: number, invalidatedCount: number, totalChecked: number): void {
    this.invalidationEvals++
    this.invalidationHits += invalidatedCount
    this.invalidationSkips += totalChecked - invalidatedCount
    this.invalidationTotalTimeMs += evaluationTimeMs
  }

  /**
   * Update server connection count.
   */
  setConnections(count: number): void {
    this.currentConnections = count
  }

  /**
   * Update pending job count.
   */
  setPendingJobs(count: number): void {
    this.pendingJobs = count
  }

  /**
   * Get a snapshot of all current metrics.
   */
  getSnapshot(): MetricsSnapshot {
    const byQueryFunction: Record<string, FunctionMetrics> = {}
    const byMutationFunction: Record<string, FunctionMetrics> = {}

    for (const [name, fm] of this.functionMetrics) {
      if (name.startsWith("query:")) {
        byQueryFunction[name.substring(6)] = fm
      } else if (name.startsWith("mutation:")) {
        byMutationFunction[name.substring(9)] = fm
      }
    }

    return {
      server: {
        connections: this.currentConnections,
        activeSubscriptions: this.currentSubscriptions,
        pendingJobs: this.pendingJobs,
      },
      queries: {
        totalExecuted: this.queryCount,
        totalErrors: this.queryErrors,
        avgLatencyMs: this.latencies.average(),
        p99LatencyMs: this.latencies.percentile(99),
        byFunction: byQueryFunction,
      },
      mutations: {
        totalExecuted: this.mutationCount,
        totalErrors: this.mutationErrors,
        totalRetries: this.mutationRetries,
        avgLatencyMs: this.mutationLatencies.average(),
        p99LatencyMs: this.mutationLatencies.percentile(99),
        byFunction: byMutationFunction,
      },
      subscriptions: {
        totalCreated: this.subscriptionsCreated,
        totalRemoved: this.subscriptionsRemoved,
        currentActive: this.currentSubscriptions,
        avgPerConnection: this.currentConnections > 0
          ? this.currentSubscriptions / this.currentConnections
          : 0,
      },
      invalidations: {
        totalEvaluations: this.invalidationEvals,
        totalInvalidated: this.invalidationHits,
        totalSkipped: this.invalidationSkips,
        avgEvaluationTimeMs: this.invalidationEvals > 0
          ? this.invalidationTotalTimeMs / this.invalidationEvals
          : 0,
        falseInvalidationRate: this.invalidationHits > 0
          ? this.invalidationSkips / (this.invalidationHits + this.invalidationSkips)
          : 0,
      },
      uptime: Date.now() - this.startTime,
    }
  }

  /**
   * Reset all metrics.
   */
  reset(): void {
    this.startTime = Date.now()
    this.latencies = new LatencyTracker()
    this.mutationLatencies = new LatencyTracker()
    this.queryCount = 0
    this.queryErrors = 0
    this.mutationCount = 0
    this.mutationErrors = 0
    this.mutationRetries = 0
    this.subscriptionsCreated = 0
    this.subscriptionsRemoved = 0
    this.currentSubscriptions = 0
    this.invalidationEvals = 0
    this.invalidationHits = 0
    this.invalidationSkips = 0
    this.invalidationTotalTimeMs = 0
    this.functionMetrics.clear()
  }

  private updateFunctionMetrics(name: string, latencyMs: number, error?: boolean): void {
    let fm = this.functionMetrics.get(name)
    if (!fm) {
      fm = { name, calls: 0, errors: 0, totalLatencyMs: 0, avgLatencyMs: 0, lastCalledAt: 0 }
      this.functionMetrics.set(name, fm)
    }
    fm.calls++
    fm.totalLatencyMs += latencyMs
    fm.avgLatencyMs = fm.totalLatencyMs / fm.calls
    fm.lastCalledAt = Date.now()
    if (error) fm.errors++
  }
}

/**
 * Efficient latency tracker using a circular buffer.
 */
class LatencyTracker {
  private buffer: number[] = []
  private maxSize = 10_000

  record(latencyMs: number): void {
    if (this.buffer.length >= this.maxSize) {
      this.buffer.shift()
    }
    this.buffer.push(latencyMs)
  }

  average(): number {
    if (this.buffer.length === 0) return 0
    return this.buffer.reduce((a, b) => a + b, 0) / this.buffer.length
  }

  percentile(p: number): number {
    if (this.buffer.length === 0) return 0
    const sorted = [...this.buffer].sort((a, b) => a - b)
    const idx = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, idx)]
  }
}
