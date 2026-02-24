// --------------------------------------------------------------------------
// Event Sourcing & CQRS Module
// Typed event store with projections, snapshots, and replay debugging
// --------------------------------------------------------------------------

// ── Types ──────────────────────────────────────────────────────────────────

export interface DomainEvent<T = unknown> {
  id: string
  streamId: string
  type: string
  data: T
  metadata: EventMetadata
  version: number
  timestamp: number
}

export interface EventMetadata {
  correlationId?: string
  causationId?: string
  userId?: string
  source?: string
  tags?: string[]
}

export interface EventStream {
  streamId: string
  type: string
  version: number
  createdAt: number
  updatedAt: number
}

export interface Snapshot<T = unknown> {
  streamId: string
  version: number
  state: T
  timestamp: number
}

export interface Projection<TState = unknown> {
  name: string
  init: () => TState
  handlers: Record<string, (state: TState, event: DomainEvent) => TState>
  version: number
}

export interface ProjectionState<TState = unknown> {
  name: string
  state: TState
  lastEventVersion: number
  lastProcessedAt: number
}

export interface EventFilter {
  streamId?: string
  types?: string[]
  fromVersion?: number
  toVersion?: number
  fromTimestamp?: number
  toTimestamp?: number
  limit?: number
  metadata?: Partial<EventMetadata>
}

export interface EventStoreOptions {
  snapshotInterval?: number
  maxEventsPerStream?: number
  enableReplayDebugging?: boolean
  projectionBatchSize?: number
}

export interface AppendResult {
  streamId: string
  version: number
  eventsWritten: number
}

export interface ReplaySession {
  id: string
  streamId: string
  fromVersion: number
  toVersion: number
  currentVersion: number
  states: Map<number, unknown>
  status: "active" | "completed" | "cancelled"
}

export interface CommandHandler<TCommand = unknown, TEvents extends DomainEvent[] = DomainEvent[]> {
  type: string
  handle: (command: TCommand, currentState: unknown) => TEvents
  validate?: (command: TCommand) => string | null
}

export interface ReadModel<TState = unknown> {
  name: string
  state: TState
  rebuild: (events: DomainEvent[]) => TState
}

export interface EventStoreStats {
  totalEvents: number
  totalStreams: number
  totalSnapshots: number
  projectionCount: number
  avgEventsPerStream: number
}

// ── Error ──────────────────────────────────────────────────────────────────

export class EventSourcingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly streamId?: string,
  ) {
    super(message)
    this.name = "EventSourcingError"
  }
}

// ── SQL Builders ───────────────────────────────────────────────────────────

export function buildCreateEventStoreTablesSQL(): string {
  return `
    CREATE TABLE IF NOT EXISTS _rb_es_events (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      type TEXT NOT NULL,
      data JSONB NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (stream_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_es_events_stream ON _rb_es_events (stream_id, version);
    CREATE INDEX IF NOT EXISTS idx_es_events_type ON _rb_es_events (type, timestamp);
    CREATE INDEX IF NOT EXISTS idx_es_events_ts ON _rb_es_events (timestamp);

    CREATE TABLE IF NOT EXISTS _rb_es_streams (
      stream_id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS _rb_es_snapshots (
      stream_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      state JSONB NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (stream_id, version)
    );

    CREATE TABLE IF NOT EXISTS _rb_es_projections (
      name TEXT PRIMARY KEY,
      state JSONB NOT NULL DEFAULT '{}',
      last_event_version INTEGER NOT NULL DEFAULT 0,
      last_processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `
}

export function buildAppendEventSQL(): string {
  return `
    INSERT INTO _rb_es_events (id, stream_id, type, data, metadata, version)
    VALUES ($1, $2, $3, $4, $5, $6)
  `
}

export function buildGetEventsSQL(): string {
  return `
    SELECT id, stream_id, type, data, metadata, version, timestamp
    FROM _rb_es_events
    WHERE stream_id = $1 AND version >= $2
    ORDER BY version ASC
    LIMIT $3
  `
}

export function buildGetEventsByFilterSQL(filter: EventFilter): { sql: string; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []
  let paramIdx = 1

  if (filter.streamId) {
    conditions.push(`stream_id = $${paramIdx++}`)
    params.push(filter.streamId)
  }
  if (filter.types && filter.types.length > 0) {
    conditions.push(`type = ANY($${paramIdx++})`)
    params.push(filter.types)
  }
  if (filter.fromVersion !== undefined) {
    conditions.push(`version >= $${paramIdx++}`)
    params.push(filter.fromVersion)
  }
  if (filter.toVersion !== undefined) {
    conditions.push(`version <= $${paramIdx++}`)
    params.push(filter.toVersion)
  }
  if (filter.fromTimestamp !== undefined) {
    conditions.push(`timestamp >= to_timestamp($${paramIdx++} / 1000.0)`)
    params.push(filter.fromTimestamp)
  }
  if (filter.toTimestamp !== undefined) {
    conditions.push(`timestamp <= to_timestamp($${paramIdx++} / 1000.0)`)
    params.push(filter.toTimestamp)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const limit = filter.limit ? `LIMIT $${paramIdx}` : ""
  if (filter.limit) params.push(filter.limit)

  return {
    sql: `SELECT id, stream_id, type, data, metadata, version, timestamp FROM _rb_es_events ${where} ORDER BY version ASC ${limit}`,
    params,
  }
}

export function buildUpsertStreamSQL(): string {
  return `
    INSERT INTO _rb_es_streams (stream_id, type, version)
    VALUES ($1, $2, $3)
    ON CONFLICT (stream_id) DO UPDATE SET version = $3, updated_at = NOW()
  `
}

export function buildSaveSnapshotSQL(): string {
  return `
    INSERT INTO _rb_es_snapshots (stream_id, version, state)
    VALUES ($1, $2, $3)
    ON CONFLICT (stream_id, version) DO UPDATE SET state = $3, timestamp = NOW()
  `
}

export function buildGetLatestSnapshotSQL(): string {
  return `
    SELECT stream_id, version, state, timestamp
    FROM _rb_es_snapshots
    WHERE stream_id = $1
    ORDER BY version DESC
    LIMIT 1
  `
}

export function buildUpsertProjectionSQL(): string {
  return `
    INSERT INTO _rb_es_projections (name, state, last_event_version)
    VALUES ($1, $2, $3)
    ON CONFLICT (name) DO UPDATE SET state = $2, last_event_version = $3, last_processed_at = NOW()
  `
}

// ── Projection Engine ──────────────────────────────────────────────────────

export class ProjectionEngine {
  private projections = new Map<string, Projection>()
  private states = new Map<string, ProjectionState>()

  register<TState>(projection: Projection<TState>): void {
    this.projections.set(projection.name, projection as Projection)
    if (!this.states.has(projection.name)) {
      this.states.set(projection.name, {
        name: projection.name,
        state: projection.init(),
        lastEventVersion: 0,
        lastProcessedAt: Date.now(),
      })
    }
  }

  process(event: DomainEvent): void {
    for (const [name, projection] of this.projections) {
      const handler = projection.handlers[event.type]
      if (!handler) continue

      const projState = this.states.get(name)!
      projState.state = handler(projState.state, event)
      projState.lastEventVersion = event.version
      projState.lastProcessedAt = Date.now()
    }
  }

  processMany(events: DomainEvent[]): void {
    for (const event of events) {
      this.process(event)
    }
  }

  getState<TState>(projectionName: string): TState | null {
    const ps = this.states.get(projectionName)
    return ps ? (ps.state as TState) : null
  }

  getProjectionState(name: string): ProjectionState | null {
    return this.states.get(name) || null
  }

  rebuild(projectionName: string, events: DomainEvent[]): void {
    const projection = this.projections.get(projectionName)
    if (!projection) {
      throw new EventSourcingError(`Projection ${projectionName} not found`, "PROJECTION_NOT_FOUND")
    }

    let state = projection.init()
    let lastVersion = 0
    for (const event of events) {
      const handler = projection.handlers[event.type]
      if (handler) {
        state = handler(state, event)
        lastVersion = event.version
      }
    }

    this.states.set(projectionName, {
      name: projectionName,
      state,
      lastEventVersion: lastVersion,
      lastProcessedAt: Date.now(),
    })
  }

  listProjections(): string[] {
    return Array.from(this.projections.keys())
  }
}

// ── Event Store (Main Engine) ──────────────────────────────────────────────

export class EventStore {
  private events = new Map<string, DomainEvent[]>()
  private streams = new Map<string, EventStream>()
  private snapshots = new Map<string, Snapshot[]>()
  private replaySessions = new Map<string, ReplaySession>()
  readonly projections: ProjectionEngine
  private readonly snapshotInterval: number
  private readonly maxEventsPerStream: number
  private readonly enableReplay: boolean
  private commandHandlers = new Map<string, CommandHandler>()
  private subscribers = new Map<string, Set<(event: DomainEvent) => void>>()
  private globalVersion = 0

  constructor(options: EventStoreOptions = {}) {
    this.snapshotInterval = options.snapshotInterval ?? 100
    this.maxEventsPerStream = options.maxEventsPerStream ?? 10000
    this.enableReplay = options.enableReplayDebugging ?? true
    this.projections = new ProjectionEngine()
  }

  append(
    streamId: string,
    events: Array<{ type: string; data: unknown; metadata?: EventMetadata }>,
    expectedVersion?: number,
  ): AppendResult {
    const stream = this.streams.get(streamId) || {
      streamId,
      type: "",
      version: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    // Optimistic concurrency check
    if (expectedVersion !== undefined && stream.version !== expectedVersion) {
      throw new EventSourcingError(
        `Concurrency conflict: expected version ${expectedVersion}, got ${stream.version}`,
        "CONCURRENCY_CONFLICT",
        streamId,
      )
    }

    if (!this.events.has(streamId)) {
      this.events.set(streamId, [])
    }
    const streamEvents = this.events.get(streamId)!

    if (streamEvents.length + events.length > this.maxEventsPerStream) {
      throw new EventSourcingError(
        `Stream ${streamId} would exceed max events (${this.maxEventsPerStream})`,
        "MAX_EVENTS_EXCEEDED",
        streamId,
      )
    }

    const written: DomainEvent[] = []
    for (const evt of events) {
      stream.version++
      this.globalVersion++

      const domainEvent: DomainEvent = {
        id: `evt_${this.globalVersion}_${Math.random().toString(36).slice(2, 8)}`,
        streamId,
        type: evt.type,
        data: evt.data,
        metadata: evt.metadata || {},
        version: stream.version,
        timestamp: Date.now(),
      }

      streamEvents.push(domainEvent)
      written.push(domainEvent)

      // Process projections
      this.projections.process(domainEvent)

      // Notify subscribers
      this.notifySubscribers(domainEvent)
    }

    stream.updatedAt = Date.now()
    this.streams.set(streamId, stream)

    // Auto-snapshot
    if (stream.version % this.snapshotInterval === 0) {
      this.createSnapshot(streamId)
    }

    return { streamId, version: stream.version, eventsWritten: written.length }
  }

  getEvents(streamId: string, fromVersion: number = 0, limit?: number): DomainEvent[] {
    const events = this.events.get(streamId) || []
    const filtered = events.filter((e) => e.version >= fromVersion)
    return limit ? filtered.slice(0, limit) : filtered
  }

  queryEvents(filter: EventFilter): DomainEvent[] {
    let results: DomainEvent[] = []

    if (filter.streamId) {
      results = this.events.get(filter.streamId) || []
    } else {
      for (const events of this.events.values()) {
        results.push(...events)
      }
    }

    if (filter.types) {
      const typeSet = new Set(filter.types)
      results = results.filter((e) => typeSet.has(e.type))
    }
    if (filter.fromVersion !== undefined) {
      results = results.filter((e) => e.version >= filter.fromVersion!)
    }
    if (filter.toVersion !== undefined) {
      results = results.filter((e) => e.version <= filter.toVersion!)
    }
    if (filter.fromTimestamp !== undefined) {
      results = results.filter((e) => e.timestamp >= filter.fromTimestamp!)
    }
    if (filter.toTimestamp !== undefined) {
      results = results.filter((e) => e.timestamp <= filter.toTimestamp!)
    }

    results.sort((a, b) => a.version - b.version)
    return filter.limit ? results.slice(0, filter.limit) : results
  }

  getStream(streamId: string): EventStream | null {
    return this.streams.get(streamId) || null
  }

  createSnapshot(streamId: string): Snapshot | null {
    const events = this.events.get(streamId)
    if (!events || events.length === 0) return null

    const stream = this.streams.get(streamId)
    if (!stream) return null

    // Build state from events (simple aggregate)
    const state = events.reduce<Record<string, unknown>>(
      (acc, evt) => ({ ...acc, ...(evt.data as Record<string, unknown>) }),
      {},
    )

    const snapshot: Snapshot = {
      streamId,
      version: stream.version,
      state,
      timestamp: Date.now(),
    }

    if (!this.snapshots.has(streamId)) {
      this.snapshots.set(streamId, [])
    }
    this.snapshots.get(streamId)!.push(snapshot)
    return snapshot
  }

  getLatestSnapshot(streamId: string): Snapshot | null {
    const snaps = this.snapshots.get(streamId)
    return snaps && snaps.length > 0 ? snaps[snaps.length - 1] : null
  }

  // ── CQRS Command Handling ──────────────────────────────────────────────

  registerCommand(handler: CommandHandler): void {
    this.commandHandlers.set(handler.type, handler)
  }

  executeCommand(streamId: string, type: string, command: unknown): AppendResult {
    const handler = this.commandHandlers.get(type)
    if (!handler) {
      throw new EventSourcingError(`No handler for command: ${type}`, "UNKNOWN_COMMAND")
    }

    if (handler.validate) {
      const error = handler.validate(command)
      if (error) {
        throw new EventSourcingError(`Command validation failed: ${error}`, "VALIDATION_ERROR")
      }
    }

    // Rebuild current state from events
    const events = this.events.get(streamId) || []
    const currentState = events.reduce<Record<string, unknown>>(
      (acc, evt) => ({ ...acc, ...(evt.data as Record<string, unknown>) }),
      {},
    )

    const newEvents = handler.handle(command, currentState)
    return this.append(
      streamId,
      newEvents.map((e) => ({ type: e.type, data: e.data, metadata: e.metadata })),
    )
  }

  // ── Replay Debugging ───────────────────────────────────────────────────

  startReplay(streamId: string, fromVersion: number = 0, toVersion?: number): ReplaySession {
    if (!this.enableReplay) {
      throw new EventSourcingError("Replay debugging is disabled", "REPLAY_DISABLED")
    }

    const events = this.events.get(streamId) || []
    const maxVersion = events.length > 0 ? events[events.length - 1].version : 0

    const session: ReplaySession = {
      id: `replay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      streamId,
      fromVersion,
      toVersion: toVersion ?? maxVersion,
      currentVersion: fromVersion,
      states: new Map(),
      status: "active",
    }

    // Pre-compute states at each version
    let state: Record<string, unknown> = {}
    for (const event of events) {
      if (event.version < fromVersion) continue
      if (toVersion !== undefined && event.version > toVersion) break
      state = { ...state, ...(event.data as Record<string, unknown>) }
      session.states.set(event.version, structuredClone(state))
    }

    this.replaySessions.set(session.id, session)
    return session
  }

  stepReplay(sessionId: string): { version: number; state: unknown; done: boolean } | null {
    const session = this.replaySessions.get(sessionId)
    if (!session || session.status !== "active") return null

    session.currentVersion++
    const state = session.states.get(session.currentVersion)
    const done = session.currentVersion >= session.toVersion

    if (done) session.status = "completed"

    return { version: session.currentVersion, state: state || null, done }
  }

  getReplayState(sessionId: string, version: number): unknown | null {
    const session = this.replaySessions.get(sessionId)
    return session?.states.get(version) || null
  }

  // ── Subscriptions ──────────────────────────────────────────────────────

  subscribe(eventType: string, handler: (event: DomainEvent) => void): () => void {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set())
    }
    this.subscribers.get(eventType)!.add(handler)
    return () => this.subscribers.get(eventType)?.delete(handler)
  }

  getStats(): EventStoreStats {
    let totalEvents = 0
    for (const events of this.events.values()) {
      totalEvents += events.length
    }
    let totalSnapshots = 0
    for (const snaps of this.snapshots.values()) {
      totalSnapshots += snaps.length
    }

    return {
      totalEvents,
      totalStreams: this.streams.size,
      totalSnapshots,
      projectionCount: this.projections.listProjections().length,
      avgEventsPerStream: this.streams.size > 0 ? totalEvents / this.streams.size : 0,
    }
  }

  private notifySubscribers(event: DomainEvent): void {
    // Type-specific subscribers
    const handlers = this.subscribers.get(event.type)
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event)
        } catch {
          // Subscriber errors shouldn't break the store
        }
      }
    }

    // Wildcard subscribers
    const wildcardHandlers = this.subscribers.get("*")
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          handler(event)
        } catch {
          // Swallow
        }
      }
    }
  }
}
