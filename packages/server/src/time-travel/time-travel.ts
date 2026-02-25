/**
 * Time-Travel Debugging for ReactiveBase.
 * Records mutation history with full transaction snapshots, enabling
 * query replay against any historical point in time.
 *
 * Features:
 *   - Append-only event store for mutation history
 *   - Query replay against historical state via asOf()
 *   - Diff viewer between two points in time
 *   - Configurable retention with automatic pruning
 *
 * Usage:
 *   const tt = new TimeTravelEngine({ retentionDays: 7 })
 *   tt.recordMutation({ table, operation, before, after })
 *   const snapshot = tt.getSnapshotAt(timestamp)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MutationEvent {
  id: string
  /** ISO timestamp */
  timestamp: string
  /** Wall clock ms */
  timestampMs: number
  /** Name of the mutation function */
  mutationName: string
  /** Affected table */
  table: string
  /** Operation type */
  operation: "insert" | "update" | "delete"
  /** Row ID affected */
  rowId: string
  /** Row state before mutation (null for inserts) */
  before: Record<string, unknown> | null
  /** Row state after mutation (null for deletes) */
  after: Record<string, unknown> | null
  /** User who triggered the mutation */
  userId?: string
  /** Transaction ID from Postgres */
  transactionId?: string
  /** Duration of the mutation in ms */
  durationMs?: number
}

export interface TimeTravelSnapshot {
  timestamp: string
  timestampMs: number
  tables: Record<string, Record<string, Record<string, unknown>>>
}

export interface TimeTravelDiff {
  fromTimestamp: string
  toTimestamp: string
  changes: DiffEntry[]
}

export interface DiffEntry {
  table: string
  rowId: string
  operation: "insert" | "update" | "delete"
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  changedFields?: string[]
}

export interface TimeTravelOptions {
  /** Retention period in days (default: 7) */
  retentionDays?: number
  /** Max events in memory before flushing (default: 10000) */
  maxInMemoryEvents?: number
  /** Whether to capture before/after snapshots (default: true) */
  captureSnapshots?: boolean
  /** Prune interval in ms (default: 1 hour) */
  pruneInterval?: number
}

// ─── Persistence SQL ─────────────────────────────────────────────────────────

export function generateTimeTravelTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_mutation_events (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timestamp_ms BIGINT NOT NULL,
  mutation_name TEXT NOT NULL,
  "table" TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
  row_id TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB,
  user_id TEXT,
  transaction_id TEXT,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tt_events_timestamp
  ON _reactivebase_mutation_events(timestamp_ms);

CREATE INDEX IF NOT EXISTS idx_tt_events_table
  ON _reactivebase_mutation_events("table", timestamp_ms);

CREATE INDEX IF NOT EXISTS idx_tt_events_row
  ON _reactivebase_mutation_events("table", row_id, timestamp_ms);

CREATE INDEX IF NOT EXISTS idx_tt_events_mutation
  ON _reactivebase_mutation_events(mutation_name, timestamp_ms);
`.trim()
}

export function buildInsertEventSQL(event: MutationEvent): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_mutation_events
  (id, timestamp_ms, mutation_name, "table", operation, row_id, before_state, after_state, user_id, transaction_id, duration_ms)
VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)`,
    params: [
      event.id,
      event.timestampMs,
      event.mutationName,
      event.table,
      event.operation,
      event.rowId,
      event.before ? JSON.stringify(event.before) : null,
      event.after ? JSON.stringify(event.after) : null,
      event.userId ?? null,
      event.transactionId ?? null,
      event.durationMs ?? null,
    ],
  }
}

export function buildGetEventsInRangeSQL(
  fromMs: number,
  toMs: number,
  table?: string,
): { sql: string; params: unknown[] } {
  if (table) {
    return {
      sql: `SELECT * FROM _reactivebase_mutation_events
WHERE timestamp_ms >= $1 AND timestamp_ms <= $2 AND "table" = $3
ORDER BY timestamp_ms ASC`,
      params: [fromMs, toMs, table],
    }
  }
  return {
    sql: `SELECT * FROM _reactivebase_mutation_events
WHERE timestamp_ms >= $1 AND timestamp_ms <= $2
ORDER BY timestamp_ms ASC`,
    params: [fromMs, toMs],
  }
}

export function buildGetRowHistorySQL(table: string, rowId: string): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT * FROM _reactivebase_mutation_events
WHERE "table" = $1 AND row_id = $2
ORDER BY timestamp_ms ASC`,
    params: [table, rowId],
  }
}

export function buildPruneEventsSQL(beforeMs: number): { sql: string; params: unknown[] } {
  return {
    sql: `DELETE FROM _reactivebase_mutation_events WHERE timestamp_ms < $1`,
    params: [beforeMs],
  }
}

// ─── TimeTravelEngine ────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<TimeTravelOptions> = {
  retentionDays: 7,
  maxInMemoryEvents: 10_000,
  captureSnapshots: true,
  pruneInterval: 60 * 60 * 1000,
}

export class TimeTravelEngine {
  private options: Required<TimeTravelOptions>
  private events: MutationEvent[] = []
  private pruneTimer: ReturnType<typeof setInterval> | null = null
  private eventCounter = 0

  constructor(options: TimeTravelOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Record a mutation event.
   */
  recordMutation(params: {
    mutationName: string
    table: string
    operation: "insert" | "update" | "delete"
    rowId: string
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
    userId?: string
    transactionId?: string
    durationMs?: number
  }): MutationEvent {
    this.eventCounter++
    const now = Date.now()

    const event: MutationEvent = {
      id: `evt_${now}_${this.eventCounter}`,
      timestamp: new Date(now).toISOString(),
      timestampMs: now,
      mutationName: params.mutationName,
      table: params.table,
      operation: params.operation,
      rowId: params.rowId,
      before: this.options.captureSnapshots ? (params.before ?? null) : null,
      after: this.options.captureSnapshots ? (params.after ?? null) : null,
      userId: params.userId,
      transactionId: params.transactionId,
      durationMs: params.durationMs,
    }

    this.events.push(event)

    // Enforce in-memory limit
    if (this.events.length > this.options.maxInMemoryEvents) {
      this.events = this.events.slice(-Math.floor(this.options.maxInMemoryEvents * 0.8))
    }

    return event
  }

  /**
   * Get all events in a time range.
   */
  getEventsInRange(fromMs: number, toMs: number, table?: string): MutationEvent[] {
    return this.events.filter((e) => {
      if (e.timestampMs < fromMs || e.timestampMs > toMs) return false
      if (table && e.table !== table) return false
      return true
    })
  }

  /**
   * Get the history of a specific row.
   */
  getRowHistory(table: string, rowId: string): MutationEvent[] {
    return this.events.filter((e) => e.table === table && e.rowId === rowId)
  }

  /**
   * Reconstruct the state of a row at a point in time.
   */
  getRowStateAt(table: string, rowId: string, atMs: number): Record<string, unknown> | null {
    const history = this.events
      .filter((e) => e.table === table && e.rowId === rowId && e.timestampMs <= atMs)
      .sort((a, b) => a.timestampMs - b.timestampMs)

    if (history.length === 0) return null

    const last = history[history.length - 1]
    if (last.operation === "delete") return null
    return last.after ?? null
  }

  /**
   * Generate a diff between two points in time.
   */
  diff(fromMs: number, toMs: number): TimeTravelDiff {
    const events = this.getEventsInRange(fromMs, toMs)
    const changes: DiffEntry[] = []

    // Collapse multiple events per row into a single diff entry
    const rowMap = new Map<string, MutationEvent[]>()
    for (const event of events) {
      const key = `${event.table}:${event.rowId}`
      const list = rowMap.get(key) ?? []
      list.push(event)
      rowMap.set(key, list)
    }

    for (const [_key, rowEvents] of rowMap) {
      const first = rowEvents[0]
      const last = rowEvents[rowEvents.length - 1]

      const changedFields: string[] = []
      if (first.before && last.after) {
        for (const key of new Set([...Object.keys(first.before), ...Object.keys(last.after)])) {
          if (JSON.stringify(first.before[key]) !== JSON.stringify(last.after[key])) {
            changedFields.push(key)
          }
        }
      }

      changes.push({
        table: first.table,
        rowId: first.rowId,
        operation:
          first.operation === "insert" && last.operation === "delete"
            ? "delete"
            : first.operation === "insert"
              ? "insert"
              : last.operation === "delete"
                ? "delete"
                : "update",
        before: first.before,
        after: last.after,
        changedFields: changedFields.length > 0 ? changedFields : undefined,
      })
    }

    return {
      fromTimestamp: new Date(fromMs).toISOString(),
      toTimestamp: new Date(toMs).toISOString(),
      changes,
    }
  }

  /**
   * Get recent events.
   */
  getRecentEvents(limit: number = 50): MutationEvent[] {
    return this.events.slice(-limit)
  }

  /**
   * Get event counts by table.
   */
  getEventCountsByTable(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const event of this.events) {
      counts[event.table] = (counts[event.table] ?? 0) + 1
    }
    return counts
  }

  /**
   * Get event counts by mutation name.
   */
  getEventCountsByMutation(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const event of this.events) {
      counts[event.mutationName] = (counts[event.mutationName] ?? 0) + 1
    }
    return counts
  }

  /**
   * Prune events older than the retention period.
   */
  prune(): number {
    const cutoff = Date.now() - this.options.retentionDays * 24 * 60 * 60 * 1000
    const before = this.events.length
    this.events = this.events.filter((e) => e.timestampMs >= cutoff)
    return before - this.events.length
  }

  /**
   * Start automatic pruning at the configured interval.
   */
  startAutoPrune(): void {
    if (this.pruneTimer) return
    this.pruneTimer = setInterval(() => this.prune(), this.options.pruneInterval)
  }

  /**
   * Stop automatic pruning.
   */
  stop(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer)
      this.pruneTimer = null
    }
  }

  get eventCount(): number {
    return this.events.length
  }

  /**
   * Clear all events.
   */
  clear(): void {
    this.events = []
    this.eventCounter = 0
  }
}

// ─── Audit Trail ─────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string
  timestamp: string
  timestampMs: number
  action: string
  resource: string
  resourceId: string
  userId: string
  ipAddress?: string
  userAgent?: string
  changes?: Record<string, { from: unknown; to: unknown }>
  metadata?: Record<string, unknown>
  severity: "info" | "warning" | "critical"
}

export interface AuditFilter {
  userId?: string
  resource?: string
  resourceId?: string
  action?: string
  severity?: AuditEntry["severity"]
  fromMs?: number
  toMs?: number
  limit?: number
}

export interface AuditTrailOptions {
  retentionDays?: number
  maxEntries?: number
  enableComplianceMode?: boolean
}

export interface TimelineEntry {
  timestamp: number
  type: "mutation" | "audit"
  label: string
  detail: string
  severity?: AuditEntry["severity"]
  userId?: string
  resource?: string
}

export function generateAuditTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_audit_trail (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timestamp_ms BIGINT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  changes JSONB,
  metadata JSONB,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical'))
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON _reactivebase_audit_trail (user_id, timestamp_ms);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON _reactivebase_audit_trail (resource, resource_id, timestamp_ms);
CREATE INDEX IF NOT EXISTS idx_audit_action ON _reactivebase_audit_trail (action, timestamp_ms);
CREATE INDEX IF NOT EXISTS idx_audit_severity ON _reactivebase_audit_trail (severity, timestamp_ms);
`.trim()
}

export function buildInsertAuditSQL(): string {
  return `INSERT INTO _reactivebase_audit_trail (id, timestamp_ms, action, resource, resource_id, user_id, ip_address, user_agent, changes, metadata, severity)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)`
}

export function buildQueryAuditSQL(filter: AuditFilter): { sql: string; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []
  let idx = 1

  if (filter.userId) {
    conditions.push(`user_id = $${idx++}`)
    params.push(filter.userId)
  }
  if (filter.resource) {
    conditions.push(`resource = $${idx++}`)
    params.push(filter.resource)
  }
  if (filter.resourceId) {
    conditions.push(`resource_id = $${idx++}`)
    params.push(filter.resourceId)
  }
  if (filter.action) {
    conditions.push(`action = $${idx++}`)
    params.push(filter.action)
  }
  if (filter.severity) {
    conditions.push(`severity = $${idx++}`)
    params.push(filter.severity)
  }
  if (filter.fromMs !== undefined) {
    conditions.push(`timestamp_ms >= $${idx++}`)
    params.push(filter.fromMs)
  }
  if (filter.toMs !== undefined) {
    conditions.push(`timestamp_ms <= $${idx++}`)
    params.push(filter.toMs)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const limit = filter.limit ? `LIMIT $${idx}` : "LIMIT 1000"
  if (filter.limit) params.push(filter.limit)

  return {
    sql: `SELECT * FROM _reactivebase_audit_trail ${where} ORDER BY timestamp_ms DESC ${limit}`,
    params,
  }
}

export function buildTemporalQuerySQL(table: string, timestamp: number): string {
  return `SELECT * FROM "${table.replace(/"/g, '""')}" AS OF SYSTEM TIME '${new Date(timestamp).toISOString()}'`
}

export function buildTemporalRangeQuerySQL(table: string, fromMs: number, toMs: number): string {
  return `SELECT * FROM "${table.replace(/"/g, '""')}" FOR SYSTEM_TIME FROM '${new Date(fromMs).toISOString()}' TO '${new Date(toMs).toISOString()}'`
}

export function buildEnableTemporalSQL(table: string): string {
  const escaped = table.replace(/"/g, '""')
  return `
ALTER TABLE "${escaped}" ADD COLUMN IF NOT EXISTS _rb_valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE "${escaped}" ADD COLUMN IF NOT EXISTS _rb_valid_to TIMESTAMPTZ NOT NULL DEFAULT 'infinity';
CREATE INDEX IF NOT EXISTS "idx_${escaped}_temporal" ON "${escaped}" (_rb_valid_from, _rb_valid_to);
`.trim()
}

export class AuditTrail {
  private entries: AuditEntry[] = []
  private readonly maxEntries: number
  private readonly retentionMs: number
  private readonly complianceMode: boolean
  private counter = 0

  constructor(options: AuditTrailOptions = {}) {
    this.maxEntries = options.maxEntries ?? 50000
    this.retentionMs = (options.retentionDays ?? 90) * 24 * 60 * 60 * 1000
    this.complianceMode = options.enableComplianceMode ?? false
  }

  record(params: {
    action: string
    resource: string
    resourceId: string
    userId: string
    ipAddress?: string
    userAgent?: string
    changes?: Record<string, { from: unknown; to: unknown }>
    metadata?: Record<string, unknown>
    severity?: AuditEntry["severity"]
  }): AuditEntry {
    this.counter++
    const now = Date.now()

    const entry: AuditEntry = {
      id: `audit_${now}_${this.counter}`,
      timestamp: new Date(now).toISOString(),
      timestampMs: now,
      action: params.action,
      resource: params.resource,
      resourceId: params.resourceId,
      userId: params.userId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      changes: params.changes,
      metadata: params.metadata,
      severity: params.severity ?? "info",
    }

    this.entries.push(entry)

    if (this.entries.length > this.maxEntries) {
      if (this.complianceMode) {
        // In compliance mode, keep critical entries even when pruning
        const critical = this.entries.filter((e) => e.severity === "critical")
        const recent = this.entries.slice(-Math.floor(this.maxEntries * 0.8))
        const merged = new Map<string, AuditEntry>()
        for (const e of critical) merged.set(e.id, e)
        for (const e of recent) merged.set(e.id, e)
        this.entries = Array.from(merged.values()).sort((a, b) => a.timestampMs - b.timestampMs)
      } else {
        this.entries = this.entries.slice(-Math.floor(this.maxEntries * 0.8))
      }
    }

    return entry
  }

  query(filter: AuditFilter): AuditEntry[] {
    let results = this.entries

    if (filter.userId) results = results.filter((e) => e.userId === filter.userId)
    if (filter.resource) results = results.filter((e) => e.resource === filter.resource)
    if (filter.resourceId) results = results.filter((e) => e.resourceId === filter.resourceId)
    if (filter.action) results = results.filter((e) => e.action === filter.action)
    if (filter.severity) results = results.filter((e) => e.severity === filter.severity)
    if (filter.fromMs !== undefined) results = results.filter((e) => e.timestampMs >= filter.fromMs!)
    if (filter.toMs !== undefined) results = results.filter((e) => e.timestampMs <= filter.toMs!)

    results = results.sort((a, b) => b.timestampMs - a.timestampMs)
    return filter.limit ? results.slice(0, filter.limit) : results
  }

  getResourceHistory(resource: string, resourceId: string): AuditEntry[] {
    return this.entries
      .filter((e) => e.resource === resource && e.resourceId === resourceId)
      .sort((a, b) => a.timestampMs - b.timestampMs)
  }

  prune(): number {
    const cutoff = Date.now() - this.retentionMs
    const before = this.entries.length
    if (this.complianceMode) {
      this.entries = this.entries.filter((e) => e.timestampMs >= cutoff || e.severity === "critical")
    } else {
      this.entries = this.entries.filter((e) => e.timestampMs >= cutoff)
    }
    return before - this.entries.length
  }

  get entryCount(): number {
    return this.entries.length
  }

  clear(): void {
    if (this.complianceMode) {
      throw new Error("Cannot clear audit trail in compliance mode")
    }
    this.entries = []
    this.counter = 0
  }
}

// ── At-Query Helper ──────────────────────────────────────────────────────────

export class TemporalQuery {
  constructor(private readonly engine: TimeTravelEngine) {}

  at(timestampMs: number) {
    return {
      getRow: (table: string, rowId: string) => this.engine.getRowStateAt(table, rowId, timestampMs),

      getTable: (table: string): Record<string, Record<string, unknown>> => {
        const events = this.engine.getEventsInRange(0, timestampMs, table)
        const rows = new Map<string, Record<string, unknown>>()
        for (const evt of events.sort((a, b) => a.timestampMs - b.timestampMs)) {
          if (evt.operation === "delete") {
            rows.delete(evt.rowId)
          } else if (evt.after) {
            rows.set(evt.rowId, evt.after)
          }
        }
        return Object.fromEntries(rows)
      },

      diff: (otherTimestampMs: number) =>
        this.engine.diff(Math.min(timestampMs, otherTimestampMs), Math.max(timestampMs, otherTimestampMs)),
    }
  }
}

// ── Timeline Builder ─────────────────────────────────────────────────────────

export class TimelineBuilder {
  constructor(
    private readonly engine: TimeTravelEngine,
    private readonly audit: AuditTrail,
  ) {}

  build(fromMs: number, toMs: number, options?: { limit?: number }): TimelineEntry[] {
    const limit = options?.limit ?? 200
    const entries: TimelineEntry[] = []

    // Mutation events
    const mutations = this.engine.getEventsInRange(fromMs, toMs)
    for (const evt of mutations) {
      entries.push({
        timestamp: evt.timestampMs,
        type: "mutation",
        label: `${evt.operation} on ${evt.table}`,
        detail: `${evt.mutationName}: ${evt.operation} ${evt.table}.${evt.rowId}`,
        userId: evt.userId,
        resource: evt.table,
      })
    }

    // Audit entries
    const audits = this.audit.query({ fromMs, toMs })
    for (const entry of audits) {
      entries.push({
        timestamp: entry.timestampMs,
        type: "audit",
        label: `${entry.action} on ${entry.resource}`,
        detail: `${entry.action}: ${entry.resource}/${entry.resourceId}`,
        severity: entry.severity,
        userId: entry.userId,
        resource: entry.resource,
      })
    }

    entries.sort((a, b) => a.timestamp - b.timestamp)
    return entries.slice(0, limit)
  }
}
