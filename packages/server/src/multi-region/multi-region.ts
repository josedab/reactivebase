/**
 * Multi-Region Active-Active Deployment for ReactiveBase.
 * Supports geographically distributed deployments with conflict-free replication,
 * region-aware routing, and automatic failover.
 *
 * Usage:
 *   const region = new RegionManager({
 *     regionId: "us-east-1",
 *     regions: [
 *       { id: "us-east-1", host: "us-east.example.com", primary: true },
 *       { id: "eu-west-1", host: "eu-west.example.com" },
 *     ],
 *   })
 *   region.onConflict((conflict) => resolve(conflict))
 *   await region.start()
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RegionConfig {
  id: string
  host: string
  port?: number
  primary?: boolean
  weight?: number
  maxLatencyMs?: number
  metadata?: Record<string, unknown>
}

export interface RegionManagerOptions {
  regionId: string
  regions: RegionConfig[]
  /** Replication mode (default: "async") */
  replicationMode?: "sync" | "async" | "semi-sync"
  /** Conflict resolution strategy (default: "last-write-wins") */
  conflictStrategy?: ConflictStrategy
  /** Health check interval in ms (default: 5000) */
  healthCheckIntervalMs?: number
  /** Max acceptable replication lag in ms (default: 1000) */
  maxLagMs?: number
  /** Callback when topology changes */
  onTopologyChange?: (topology: RegionTopology) => void
}

export type ConflictStrategy = "last-write-wins" | "region-priority" | "custom"

export interface RegionTopology {
  regions: RegionStatus[]
  primaryRegion: string
  totalRegions: number
  healthyRegions: number
  timestamp: number
}

export interface RegionStatus {
  id: string
  host: string
  status: "healthy" | "degraded" | "unreachable" | "syncing"
  latencyMs: number
  lagMs: number
  lastHealthCheck: number
  isPrimary: boolean
  connectionCount: number
}

export interface ReplicationEvent {
  id: string
  sourceRegion: string
  targetRegion: string
  type: "insert" | "update" | "delete"
  table: string
  rowId: string
  data: Record<string, unknown>
  vectorClock: VectorClock
  timestamp: number
}

export interface VectorClock {
  [regionId: string]: number
}

export interface ReplicationConflict {
  table: string
  rowId: string
  localEvent: ReplicationEvent
  remoteEvent: ReplicationEvent
  localData: Record<string, unknown>
  remoteData: Record<string, unknown>
  resolution?: "local" | "remote" | "merged"
  mergedData?: Record<string, unknown>
}

export type ConflictHandler = (conflict: ReplicationConflict) => ReplicationConflict

export interface RegionRoutingDecision {
  targetRegion: string
  reason: string
  latencyMs: number
  fallback?: string
}

export interface ReplicationStats {
  eventsReplicated: number
  conflictsDetected: number
  conflictsResolved: number
  avgLagMs: number
  pendingEvents: number
  bytesTransferred: number
}

// ─── Vector Clock ────────────────────────────────────────────────────────────

/**
 * Merge two vector clocks by taking the max of each component.
 */
export function mergeVectorClocks(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a }
  for (const [region, clock] of Object.entries(b)) {
    result[region] = Math.max(result[region] ?? 0, clock)
  }
  return result
}

/**
 * Increment the vector clock for a specific region.
 */
export function incrementClock(clock: VectorClock, regionId: string): VectorClock {
  return { ...clock, [regionId]: (clock[regionId] ?? 0) + 1 }
}

/**
 * Check if clock A happened-before clock B.
 */
export function happenedBefore(a: VectorClock, b: VectorClock): boolean {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)])
  let strictlyLess = false

  for (const key of allKeys) {
    const aVal = a[key] ?? 0
    const bVal = b[key] ?? 0
    if (aVal > bVal) return false
    if (aVal < bVal) strictlyLess = true
  }

  return strictlyLess
}

/**
 * Check if two vector clocks are concurrent (neither happened-before the other).
 */
export function areConcurrent(a: VectorClock, b: VectorClock): boolean {
  return !happenedBefore(a, b) && !happenedBefore(b, a)
}

// ─── Region Router ──────────────────────────────────────────────────────────

/**
 * Routes requests to the best region based on latency and health.
 */
export class RegionRouter {
  private regions: RegionStatus[] = []

  updateTopology(regions: RegionStatus[]): void {
    this.regions = [...regions]
  }

  /**
   * Route a read request to the nearest healthy region.
   */
  routeRead(preferredRegion?: string): RegionRoutingDecision {
    // Prefer the specified region if healthy
    if (preferredRegion) {
      const preferred = this.regions.find((r) => r.id === preferredRegion && r.status === "healthy")
      if (preferred) {
        return { targetRegion: preferred.id, reason: "preferred region", latencyMs: preferred.latencyMs }
      }
    }

    // Find the healthiest region with lowest latency
    const healthy = this.regions
      .filter((r) => r.status === "healthy" || r.status === "syncing")
      .sort((a, b) => a.latencyMs - b.latencyMs)

    if (healthy.length === 0) {
      // Fallback to any region
      const any = this.regions.sort((a, b) => a.latencyMs - b.latencyMs)[0]
      return any
        ? { targetRegion: any.id, reason: "fallback (no healthy regions)", latencyMs: any.latencyMs }
        : { targetRegion: "unknown", reason: "no regions available", latencyMs: Infinity }
    }

    return {
      targetRegion: healthy[0].id,
      reason: "lowest latency healthy region",
      latencyMs: healthy[0].latencyMs,
      fallback: healthy[1]?.id,
    }
  }

  /**
   * Route a write request to the primary region (or closest writable region).
   */
  routeWrite(): RegionRoutingDecision {
    const primary = this.regions.find((r) => r.isPrimary && r.status === "healthy")
    if (primary) {
      return { targetRegion: primary.id, reason: "primary region", latencyMs: primary.latencyMs }
    }

    // If primary is down, find best healthy region
    const healthy = this.regions.filter((r) => r.status === "healthy").sort((a, b) => a.latencyMs - b.latencyMs)

    if (healthy.length > 0) {
      return {
        targetRegion: healthy[0].id,
        reason: "failover (primary unreachable)",
        latencyMs: healthy[0].latencyMs,
      }
    }

    return { targetRegion: "unknown", reason: "no writable regions", latencyMs: Infinity }
  }

  /**
   * Get the current topology status.
   */
  getTopology(): RegionTopology {
    const primary = this.regions.find((r) => r.isPrimary)
    return {
      regions: this.regions,
      primaryRegion: primary?.id ?? "unknown",
      totalRegions: this.regions.length,
      healthyRegions: this.regions.filter((r) => r.status === "healthy").length,
      timestamp: Date.now(),
    }
  }
}

// ─── Region Manager ──────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<RegionManagerOptions, "regionId" | "regions" | "onTopologyChange">> & {
  onTopologyChange: RegionManagerOptions["onTopologyChange"]
} = {
  replicationMode: "async",
  conflictStrategy: "last-write-wins",
  healthCheckIntervalMs: 5_000,
  maxLagMs: 1_000,
  onTopologyChange: undefined,
}

/**
 * Manages multi-region deployment, replication, and failover.
 */
export class RegionManager {
  private regionId: string
  private configs: RegionConfig[]
  private options: typeof DEFAULT_OPTIONS
  private router: RegionRouter
  private clock: VectorClock = {}
  private conflictHandler: ConflictHandler | null = null
  private eventBuffer: ReplicationEvent[] = []
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private regions = new Map<string, RegionStatus>()
  private stats: ReplicationStats = {
    eventsReplicated: 0,
    conflictsDetected: 0,
    conflictsResolved: 0,
    avgLagMs: 0,
    pendingEvents: 0,
    bytesTransferred: 0,
  }

  constructor(options: RegionManagerOptions) {
    this.regionId = options.regionId
    this.configs = options.regions
    this.options = { ...DEFAULT_OPTIONS, ...options } as typeof DEFAULT_OPTIONS
    this.router = new RegionRouter()
    this.clock = { [this.regionId]: 0 }

    // Initialize region statuses
    for (const config of this.configs) {
      this.regions.set(config.id, {
        id: config.id,
        host: config.host,
        status: config.id === this.regionId ? "healthy" : "syncing",
        latencyMs: config.id === this.regionId ? 0 : 100,
        lagMs: 0,
        lastHealthCheck: Date.now(),
        isPrimary: config.primary ?? false,
        connectionCount: 0,
      })
    }

    this.router.updateTopology([...this.regions.values()])
  }

  /**
   * Start the region manager (health checks, replication).
   */
  start(): void {
    this.healthCheckTimer = setInterval(() => this.performHealthChecks(), this.options.healthCheckIntervalMs)
  }

  /**
   * Stop the region manager.
   */
  stop(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  /**
   * Create a replication event for a local write.
   */
  createEvent(
    type: ReplicationEvent["type"],
    table: string,
    rowId: string,
    data: Record<string, unknown>,
  ): ReplicationEvent {
    this.clock = incrementClock(this.clock, this.regionId)

    const event: ReplicationEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sourceRegion: this.regionId,
      targetRegion: "*", // Broadcast
      type,
      table,
      rowId,
      data,
      vectorClock: { ...this.clock },
      timestamp: Date.now(),
    }

    this.eventBuffer.push(event)
    this.stats.pendingEvents = this.eventBuffer.length

    return event
  }

  /**
   * Receive a replication event from another region.
   */
  receiveEvent(event: ReplicationEvent): ReplicationConflict | null {
    // Merge vector clocks
    this.clock = mergeVectorClocks(this.clock, event.vectorClock)
    this.clock = incrementClock(this.clock, this.regionId)
    this.stats.eventsReplicated++

    // Check for conflicts (concurrent events)
    const localEvent = this.eventBuffer.find(
      (e) => e.table === event.table && e.rowId === event.rowId && e.sourceRegion === this.regionId,
    )

    if (localEvent && areConcurrent(localEvent.vectorClock, event.vectorClock)) {
      this.stats.conflictsDetected++

      const conflict: ReplicationConflict = {
        table: event.table,
        rowId: event.rowId,
        localEvent,
        remoteEvent: event,
        localData: localEvent.data,
        remoteData: event.data,
      }

      return this.resolveConflict(conflict)
    }

    return null
  }

  /**
   * Set a custom conflict handler.
   */
  onConflict(handler: ConflictHandler): void {
    this.conflictHandler = handler
  }

  /**
   * Route a read request.
   */
  routeRead(preferredRegion?: string): RegionRoutingDecision {
    return this.router.routeRead(preferredRegion)
  }

  /**
   * Route a write request.
   */
  routeWrite(): RegionRoutingDecision {
    return this.router.routeWrite()
  }

  /**
   * Get current topology.
   */
  getTopology(): RegionTopology {
    return this.router.getTopology()
  }

  /**
   * Get the current region ID.
   */
  getRegionId(): string {
    return this.regionId
  }

  /**
   * Get vector clock state.
   */
  getClock(): VectorClock {
    return { ...this.clock }
  }

  /**
   * Get pending events in the replication buffer.
   */
  getPendingEvents(): ReplicationEvent[] {
    return [...this.eventBuffer]
  }

  /**
   * Acknowledge that events have been replicated and remove from buffer.
   */
  acknowledgeEvents(eventIds: string[]): void {
    const idSet = new Set(eventIds)
    this.eventBuffer = this.eventBuffer.filter((e) => !idSet.has(e.id))
    this.stats.pendingEvents = this.eventBuffer.length
  }

  /**
   * Update a region's status (from health check results).
   */
  updateRegionStatus(regionId: string, status: Partial<RegionStatus>): void {
    const region = this.regions.get(regionId)
    if (region) {
      Object.assign(region, status)
      this.router.updateTopology([...this.regions.values()])
      this.options.onTopologyChange?.(this.getTopology())
    }
  }

  /**
   * Promote a region to primary (for failover).
   */
  promoteToPrimary(regionId: string): void {
    for (const [id, region] of this.regions) {
      region.isPrimary = id === regionId
    }
    this.router.updateTopology([...this.regions.values()])
    this.options.onTopologyChange?.(this.getTopology())
  }

  /**
   * Get replication statistics.
   */
  getStats(): ReplicationStats {
    return { ...this.stats }
  }

  private resolveConflict(conflict: ReplicationConflict): ReplicationConflict {
    if (this.conflictHandler) {
      const resolved = this.conflictHandler(conflict)
      this.stats.conflictsResolved++
      return resolved
    }

    // Default: last-write-wins
    if (this.options.conflictStrategy === "last-write-wins") {
      if (conflict.remoteEvent.timestamp >= conflict.localEvent.timestamp) {
        conflict.resolution = "remote"
        conflict.mergedData = conflict.remoteData
      } else {
        conflict.resolution = "local"
        conflict.mergedData = conflict.localData
      }
    } else if (this.options.conflictStrategy === "region-priority") {
      // Primary region wins
      const primaryId = [...this.regions.values()].find((r) => r.isPrimary)?.id
      if (conflict.remoteEvent.sourceRegion === primaryId) {
        conflict.resolution = "remote"
        conflict.mergedData = conflict.remoteData
      } else {
        conflict.resolution = "local"
        conflict.mergedData = conflict.localData
      }
    }

    this.stats.conflictsResolved++
    return conflict
  }

  private performHealthChecks(): void {
    for (const [id, region] of this.regions) {
      if (id === this.regionId) {
        region.status = "healthy"
        region.latencyMs = 0
        region.lastHealthCheck = Date.now()
      } else {
        // In a real implementation, this would ping the remote region
        region.lastHealthCheck = Date.now()
      }
    }
  }
}
