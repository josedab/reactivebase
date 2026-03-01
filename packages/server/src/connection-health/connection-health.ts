/**
 * Connection Health Intelligence
 *
 * Smart connection pooling with latency monitoring, circuit breakers,
 * adaptive pool scaling, read replica routing, and predictive intelligence.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half-open"
export type ConnectionRole = "primary" | "replica"

export interface ConnectionEndpoint {
  readonly id: string
  readonly connectionString: string
  readonly role: ConnectionRole
  readonly region?: string
}

export interface ConnectionHealthStats {
  readonly endpointId: string
  latencyMs: number
  avgLatencyMs: number
  p95LatencyMs: number
  queryCount: number
  errorCount: number
  circuitState: CircuitState
  lastChecked: Date
  poolSize: number
  activeConnections: number
}

export interface HealthMonitorOptions {
  checkIntervalMs: number
  latencyWindowSize: number
  errorThreshold: number
  circuitOpenDurationMs: number
  halfOpenMaxAttempts: number
  minPoolSize: number
  maxPoolSize: number
  scaleUpThreshold: number
  scaleDownThreshold: number
  predictiveScalingEnabled: boolean
}

const DEFAULT_OPTIONS: HealthMonitorOptions = {
  checkIntervalMs: 5_000,
  latencyWindowSize: 100,
  errorThreshold: 5,
  circuitOpenDurationMs: 30_000,
  halfOpenMaxAttempts: 3,
  minPoolSize: 2,
  maxPoolSize: 50,
  scaleUpThreshold: 0.8,
  scaleDownThreshold: 0.3,
  predictiveScalingEnabled: true,
}

// ── Circuit Breaker ──────────────────────────────────────────────────────────

export class CircuitBreaker {
  private state: CircuitState = "closed"
  private failureCount = 0
  private lastFailure: Date | null = null
  private halfOpenAttempts = 0

  constructor(
    private readonly errorThreshold: number,
    private readonly openDurationMs: number,
    private readonly halfOpenMaxAttempts: number,
  ) {}

  /**
   * Record a successful operation.
   */
  recordSuccess(): void {
    if (this.state === "half-open") {
      this.state = "closed"
      this.failureCount = 0
      this.halfOpenAttempts = 0
    }
    this.failureCount = Math.max(0, this.failureCount - 1)
  }

  /**
   * Record a failed operation.
   */
  recordFailure(): void {
    this.failureCount++
    this.lastFailure = new Date()

    if (this.state === "half-open") {
      this.halfOpenAttempts++
      if (this.halfOpenAttempts >= this.halfOpenMaxAttempts) {
        this.state = "open"
      }
    } else if (this.failureCount >= this.errorThreshold) {
      this.state = "open"
    }
  }

  /**
   * Check if requests are allowed through.
   */
  isAllowed(): boolean {
    if (this.state === "closed") return true

    if (this.state === "open" && this.lastFailure) {
      const elapsed = Date.now() - this.lastFailure.getTime()
      if (elapsed >= this.openDurationMs) {
        this.state = "half-open"
        this.halfOpenAttempts = 0
        return true
      }
      return false
    }

    // half-open: allow limited requests
    return this.halfOpenAttempts < this.halfOpenMaxAttempts
  }

  getState(): CircuitState {
    return this.state
  }

  reset(): void {
    this.state = "closed"
    this.failureCount = 0
    this.lastFailure = null
    this.halfOpenAttempts = 0
  }
}

// ── Latency Tracker ──────────────────────────────────────────────────────────

export class LatencyTracker {
  private samples: number[] = []
  private windowSize: number

  constructor(windowSize: number = 100) {
    this.windowSize = windowSize
  }

  record(latencyMs: number): void {
    this.samples.push(latencyMs)
    if (this.samples.length > this.windowSize) {
      this.samples.shift()
    }
  }

  getAverage(): number {
    if (this.samples.length === 0) return 0
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length
  }

  getP95(): number {
    if (this.samples.length === 0) return 0
    const sorted = [...this.samples].sort((a, b) => a - b)
    const idx = Math.ceil(sorted.length * 0.95) - 1
    return sorted[Math.max(0, idx)]
  }

  getLatest(): number {
    return this.samples.length > 0 ? this.samples[this.samples.length - 1] : 0
  }

  getSampleCount(): number {
    return this.samples.length
  }
}

// ── Adaptive Pool Scaler ─────────────────────────────────────────────────────

export interface ScaleDecision {
  endpointId: string
  currentSize: number
  recommendedSize: number
  reason: string
}

export class AdaptivePoolScaler {
  private subscriptionCounts = new Map<string, number[]>()

  constructor(
    private readonly minSize: number,
    private readonly maxSize: number,
    private readonly scaleUpThreshold: number,
    private readonly scaleDownThreshold: number,
  ) {}

  /**
   * Evaluate whether pool size should change based on utilization.
   */
  evaluate(endpointId: string, activeConnections: number, poolSize: number): ScaleDecision {
    const utilization = poolSize > 0 ? activeConnections / poolSize : 0

    let recommendedSize = poolSize
    let reason = "no change needed"

    if (utilization >= this.scaleUpThreshold && poolSize < this.maxSize) {
      recommendedSize = Math.min(Math.ceil(poolSize * 1.5), this.maxSize)
      reason = `utilization ${(utilization * 100).toFixed(0)}% exceeds scale-up threshold`
    } else if (utilization <= this.scaleDownThreshold && poolSize > this.minSize) {
      recommendedSize = Math.max(Math.ceil(poolSize * 0.7), this.minSize)
      reason = `utilization ${(utilization * 100).toFixed(0)}% below scale-down threshold`
    }

    return { endpointId, currentSize: poolSize, recommendedSize, reason }
  }

  /**
   * Record subscription count for predictive scaling.
   */
  recordSubscriptionCount(endpointId: string, count: number): void {
    if (!this.subscriptionCounts.has(endpointId)) {
      this.subscriptionCounts.set(endpointId, [])
    }
    const history = this.subscriptionCounts.get(endpointId)!
    history.push(count)
    if (history.length > 60) history.shift() // keep 60 samples
  }

  /**
   * Predict future pool needs based on subscription growth.
   */
  predictPoolSize(endpointId: string, connectionsPerSubscription: number): number | null {
    const history = this.subscriptionCounts.get(endpointId)
    if (!history || history.length < 10) return null

    // Simple linear trend
    const recent = history.slice(-10)
    const first = recent[0]
    const last = recent[recent.length - 1]
    const trend = (last - first) / recent.length

    // Predict 5 intervals ahead
    const predicted = last + trend * 5
    const poolNeeded = Math.ceil(predicted * connectionsPerSubscription)

    return Math.max(this.minSize, Math.min(poolNeeded, this.maxSize))
  }
}

// ── Read Replica Router ──────────────────────────────────────────────────────

export class ReadReplicaRouter {
  private endpoints = new Map<string, ConnectionEndpoint>()
  private healthStats = new Map<string, ConnectionHealthStats>()

  addEndpoint(endpoint: ConnectionEndpoint): void {
    this.endpoints.set(endpoint.id, endpoint)
  }

  removeEndpoint(id: string): void {
    this.endpoints.delete(id)
    this.healthStats.delete(id)
  }

  updateStats(endpointId: string, stats: ConnectionHealthStats): void {
    this.healthStats.set(endpointId, stats)
  }

  /**
   * Route a read query to the best available replica.
   * Falls back to primary if no healthy replicas are available.
   */
  routeRead(): ConnectionEndpoint | null {
    const replicas = Array.from(this.endpoints.values()).filter((e) => e.role === "replica")

    // Filter by circuit breaker state
    const healthy = replicas.filter((r) => {
      const stats = this.healthStats.get(r.id)
      return !stats || stats.circuitState !== "open"
    })

    if (healthy.length === 0) {
      // Fallback to primary
      return Array.from(this.endpoints.values()).find((e) => e.role === "primary") ?? null
    }

    // Route to lowest latency replica
    let best: ConnectionEndpoint = healthy[0]
    let bestLatency = Infinity

    for (const endpoint of healthy) {
      const stats = this.healthStats.get(endpoint.id)
      const latency = stats?.avgLatencyMs ?? Infinity
      if (latency < bestLatency) {
        bestLatency = latency
        best = endpoint
      }
    }

    return best
  }

  /**
   * Route a write query to the primary.
   */
  routeWrite(): ConnectionEndpoint | null {
    return Array.from(this.endpoints.values()).find((e) => e.role === "primary") ?? null
  }

  getEndpoints(): ConnectionEndpoint[] {
    return Array.from(this.endpoints.values())
  }
}

// ── Connection Health Monitor ────────────────────────────────────────────────

export interface HealthAlert {
  readonly endpointId: string
  readonly type: "latency_degradation" | "circuit_opened" | "pool_exhaustion" | "endpoint_down"
  readonly message: string
  readonly timestamp: Date
}

export type HealthAlertHandler = (alert: HealthAlert) => void

export class ConnectionHealthMonitor {
  private endpoints = new Map<string, ConnectionEndpoint>()
  private latencyTrackers = new Map<string, LatencyTracker>()
  private circuitBreakers = new Map<string, CircuitBreaker>()
  private poolScaler: AdaptivePoolScaler
  private replicaRouter: ReadReplicaRouter
  private alertHandlers = new Set<HealthAlertHandler>()
  private options: HealthMonitorOptions

  constructor(options: Partial<HealthMonitorOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.poolScaler = new AdaptivePoolScaler(
      this.options.minPoolSize,
      this.options.maxPoolSize,
      this.options.scaleUpThreshold,
      this.options.scaleDownThreshold,
    )
    this.replicaRouter = new ReadReplicaRouter()
  }

  /**
   * Register a database endpoint for monitoring.
   */
  addEndpoint(endpoint: ConnectionEndpoint): void {
    this.endpoints.set(endpoint.id, endpoint)
    this.latencyTrackers.set(endpoint.id, new LatencyTracker(this.options.latencyWindowSize))
    this.circuitBreakers.set(
      endpoint.id,
      new CircuitBreaker(
        this.options.errorThreshold,
        this.options.circuitOpenDurationMs,
        this.options.halfOpenMaxAttempts,
      ),
    )
    this.replicaRouter.addEndpoint(endpoint)
  }

  /**
   * Record a query execution result for an endpoint.
   */
  recordQuery(endpointId: string, latencyMs: number, success: boolean): void {
    const tracker = this.latencyTrackers.get(endpointId)
    const breaker = this.circuitBreakers.get(endpointId)
    if (!tracker || !breaker) return

    tracker.record(latencyMs)

    if (success) {
      breaker.recordSuccess()
    } else {
      breaker.recordFailure()
      if (breaker.getState() === "open") {
        this.emitAlert({
          endpointId,
          type: "circuit_opened",
          message: `Circuit opened for endpoint ${endpointId} after ${this.options.errorThreshold} failures`,
          timestamp: new Date(),
        })
      }
    }

    // Update replica router stats
    this.replicaRouter.updateStats(endpointId, this.getEndpointStats(endpointId)!)
  }

  /**
   * Check if an endpoint is available for queries.
   */
  isEndpointAvailable(endpointId: string): boolean {
    const breaker = this.circuitBreakers.get(endpointId)
    return breaker?.isAllowed() ?? false
  }

  /**
   * Get scaling recommendation for an endpoint.
   */
  getScaleDecision(endpointId: string, activeConnections: number, poolSize: number): ScaleDecision {
    return this.poolScaler.evaluate(endpointId, activeConnections, poolSize)
  }

  /**
   * Route a read query to the best available endpoint.
   */
  routeRead(): ConnectionEndpoint | null {
    return this.replicaRouter.routeRead()
  }

  /**
   * Route a write query to the primary endpoint.
   */
  routeWrite(): ConnectionEndpoint | null {
    return this.replicaRouter.routeWrite()
  }

  getEndpointStats(endpointId: string): ConnectionHealthStats | undefined {
    const tracker = this.latencyTrackers.get(endpointId)
    const breaker = this.circuitBreakers.get(endpointId)
    if (!tracker || !breaker) return undefined

    return {
      endpointId,
      latencyMs: tracker.getLatest(),
      avgLatencyMs: tracker.getAverage(),
      p95LatencyMs: tracker.getP95(),
      queryCount: tracker.getSampleCount(),
      errorCount: 0,
      circuitState: breaker.getState(),
      lastChecked: new Date(),
      poolSize: 0,
      activeConnections: 0,
    }
  }

  onAlert(handler: HealthAlertHandler): () => void {
    this.alertHandlers.add(handler)
    return () => this.alertHandlers.delete(handler)
  }

  getPoolScaler(): AdaptivePoolScaler {
    return this.poolScaler
  }

  getReplicaRouter(): ReadReplicaRouter {
    return this.replicaRouter
  }

  private emitAlert(alert: HealthAlert): void {
    for (const handler of this.alertHandlers) {
      handler(alert)
    }
  }
}
