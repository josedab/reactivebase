/**
 * Realtime Query Debugger & Profiler
 *
 * Instrumentation layer for the ReactivityEngine that captures live dependency
 * graphs, invalidation chains, re-execution counts, result diffs, and
 * bottleneck detection. Streams debug data over WebSocket for a browser-based UI.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type DebugEventType =
  | "subscription_created"
  | "subscription_removed"
  | "invalidation_triggered"
  | "query_re_executed"
  | "result_diff"
  | "dependency_changed"
  | "bottleneck_detected"

export interface DebugEvent {
  readonly id: string
  readonly type: DebugEventType
  readonly timestamp: number
  readonly data: Record<string, unknown>
}

export interface DependencyEdge {
  readonly sourceTable: string
  readonly subscriptionId: string
  readonly queryName: string
  readonly filters?: Record<string, unknown>
}

export interface InvalidationChain {
  readonly triggerId: string
  readonly sourceTable: string
  readonly affectedSubscriptions: string[]
  readonly reExecutionCount: number
  readonly totalDurationMs: number
  readonly timestamp: number
}

export interface SubscriptionProfile {
  readonly subscriptionId: string
  readonly queryName: string
  readonly connectionId: string
  invalidationCount: number
  reExecutionCount: number
  totalReExecutionMs: number
  avgReExecutionMs: number
  lastInvalidatedAt: number | null
  resultDiffCount: number
}

export interface BottleneckReport {
  readonly subscriptionId: string
  readonly queryName: string
  readonly reason: string
  readonly metric: number
  readonly threshold: number
  readonly detectedAt: number
}

export interface DebuggerOptions {
  enabled: boolean
  maxEventHistory: number
  maxInvalidationChains: number
  bottleneckThresholdMs: number
  bottleneckFrequencyThreshold: number
  sampleRate: number
}

const DEFAULT_OPTIONS: DebuggerOptions = {
  enabled: true,
  maxEventHistory: 5000,
  maxInvalidationChains: 200,
  bottleneckThresholdMs: 100,
  bottleneckFrequencyThreshold: 10, // invalidations per minute
  sampleRate: 1.0,
}

// ── Query Debugger ───────────────────────────────────────────────────────────

export type DebugEventHandler = (event: DebugEvent) => void

export class QueryDebugger {
  private events: DebugEvent[] = []
  private profiles = new Map<string, SubscriptionProfile>()
  private dependencyGraph = new Map<string, DependencyEdge[]>()
  private invalidationChains: InvalidationChain[] = []
  private bottlenecks: BottleneckReport[] = []
  private handlers = new Set<DebugEventHandler>()
  private options: DebuggerOptions
  private eventCounter = 0

  constructor(options: Partial<DebuggerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Record a new subscription being created.
   */
  recordSubscriptionCreated(
    subscriptionId: string,
    queryName: string,
    connectionId: string,
    dependencies: Array<{ table: string; filters?: Record<string, unknown> }>,
  ): void {
    if (!this.shouldSample()) return

    this.profiles.set(subscriptionId, {
      subscriptionId,
      queryName,
      connectionId,
      invalidationCount: 0,
      reExecutionCount: 0,
      totalReExecutionMs: 0,
      avgReExecutionMs: 0,
      lastInvalidatedAt: null,
      resultDiffCount: 0,
    })

    // Update dependency graph
    const edges: DependencyEdge[] = dependencies.map((dep) => ({
      sourceTable: dep.table,
      subscriptionId,
      queryName,
      filters: dep.filters,
    }))
    this.dependencyGraph.set(subscriptionId, edges)

    this.emitEvent("subscription_created", {
      subscriptionId,
      queryName,
      connectionId,
      dependencies,
    })
  }

  /**
   * Record a subscription being removed.
   */
  recordSubscriptionRemoved(subscriptionId: string): void {
    this.profiles.delete(subscriptionId)
    this.dependencyGraph.delete(subscriptionId)
    this.emitEvent("subscription_removed", { subscriptionId })
  }

  /**
   * Record an invalidation being triggered for a table change.
   */
  recordInvalidation(
    sourceTable: string,
    affectedSubscriptionIds: string[],
  ): void {
    if (!this.shouldSample()) return

    for (const sid of affectedSubscriptionIds) {
      const profile = this.profiles.get(sid)
      if (profile) {
        profile.invalidationCount++
        profile.lastInvalidatedAt = performance.now()
      }
    }

    const chain: InvalidationChain = {
      triggerId: `inv_${++this.eventCounter}`,
      sourceTable,
      affectedSubscriptions: affectedSubscriptionIds,
      reExecutionCount: affectedSubscriptionIds.length,
      totalDurationMs: 0,
      timestamp: performance.now(),
    }

    this.invalidationChains.push(chain)
    if (this.invalidationChains.length > this.options.maxInvalidationChains) {
      this.invalidationChains.shift()
    }

    this.emitEvent("invalidation_triggered", {
      sourceTable,
      affectedCount: affectedSubscriptionIds.length,
      subscriptionIds: affectedSubscriptionIds,
    })

    // Check for bottlenecks
    this.detectBottlenecks(affectedSubscriptionIds)
  }

  /**
   * Record a query re-execution with timing.
   */
  recordReExecution(subscriptionId: string, durationMs: number, resultChanged: boolean): void {
    if (!this.shouldSample()) return

    const profile = this.profiles.get(subscriptionId)
    if (profile) {
      profile.reExecutionCount++
      profile.totalReExecutionMs += durationMs
      profile.avgReExecutionMs = profile.totalReExecutionMs / profile.reExecutionCount
      if (resultChanged) profile.resultDiffCount++
    }

    this.emitEvent("query_re_executed", {
      subscriptionId,
      durationMs,
      resultChanged,
    })
  }

  /**
   * Get the live dependency graph for visualization.
   */
  getDependencyGraph(): Map<string, DependencyEdge[]> {
    return new Map(this.dependencyGraph)
  }

  /**
   * Get all subscription profiles.
   */
  getProfiles(): SubscriptionProfile[] {
    return Array.from(this.profiles.values())
  }

  /**
   * Get the profile for a specific subscription.
   */
  getProfile(subscriptionId: string): SubscriptionProfile | undefined {
    return this.profiles.get(subscriptionId)
  }

  /**
   * Get recent invalidation chains.
   */
  getInvalidationChains(limit?: number): InvalidationChain[] {
    const chains = [...this.invalidationChains]
    return limit ? chains.slice(-limit) : chains
  }

  /**
   * Get detected bottlenecks.
   */
  getBottlenecks(): BottleneckReport[] {
    return [...this.bottlenecks]
  }

  /**
   * Get recent events.
   */
  getEvents(limit?: number): DebugEvent[] {
    const events = [...this.events]
    return limit ? events.slice(-limit) : events
  }

  /**
   * Build a "why did this re-render?" trace for a subscription.
   */
  whyDidReRender(subscriptionId: string): {
    subscriptionId: string
    queryName: string
    recentInvalidations: InvalidationChain[]
    dependencies: DependencyEdge[]
    profile: SubscriptionProfile | undefined
  } {
    const profile = this.profiles.get(subscriptionId)
    const deps = this.dependencyGraph.get(subscriptionId) ?? []
    const recentInvalidations = this.invalidationChains
      .filter((c) => c.affectedSubscriptions.includes(subscriptionId))
      .slice(-10)

    return {
      subscriptionId,
      queryName: profile?.queryName ?? "unknown",
      recentInvalidations,
      dependencies: deps,
      profile,
    }
  }

  /**
   * Get a summary for the debugger dashboard.
   */
  getSummary(): {
    totalSubscriptions: number
    totalEvents: number
    totalInvalidations: number
    bottleneckCount: number
    topReExecuted: SubscriptionProfile[]
  } {
    const profiles = this.getProfiles()
    const topReExecuted = [...profiles]
      .sort((a, b) => b.reExecutionCount - a.reExecutionCount)
      .slice(0, 10)

    return {
      totalSubscriptions: this.profiles.size,
      totalEvents: this.events.length,
      totalInvalidations: this.invalidationChains.length,
      bottleneckCount: this.bottlenecks.length,
      topReExecuted,
    }
  }

  /**
   * Register an event handler for streaming debug data.
   */
  onEvent(handler: DebugEventHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  /**
   * Clear all debug data.
   */
  clear(): void {
    this.events = []
    this.profiles.clear()
    this.dependencyGraph.clear()
    this.invalidationChains = []
    this.bottlenecks = []
  }

  private detectBottlenecks(subscriptionIds: string[]): void {
    for (const sid of subscriptionIds) {
      const profile = this.profiles.get(sid)
      if (!profile) continue

      // Slow re-execution detection
      if (profile.avgReExecutionMs > this.options.bottleneckThresholdMs && profile.reExecutionCount > 3) {
        this.bottlenecks.push({
          subscriptionId: sid,
          queryName: profile.queryName,
          reason: "slow_re_execution",
          metric: profile.avgReExecutionMs,
          threshold: this.options.bottleneckThresholdMs,
          detectedAt: performance.now(),
        })

        this.emitEvent("bottleneck_detected", {
          subscriptionId: sid,
          reason: "slow_re_execution",
          avgMs: profile.avgReExecutionMs,
        })
      }
    }
  }

  private shouldSample(): boolean {
    if (!this.options.enabled) return false
    if (this.options.sampleRate >= 1.0) return true
    return Math.random() < this.options.sampleRate
  }

  private emitEvent(type: DebugEventType, data: Record<string, unknown>): void {
    const event: DebugEvent = {
      id: `dbg_${++this.eventCounter}`,
      type,
      timestamp: performance.now(),
      data,
    }

    this.events.push(event)
    if (this.events.length > this.options.maxEventHistory) {
      this.events.shift()
    }

    for (const handler of this.handlers) {
      handler(event)
    }
  }
}
