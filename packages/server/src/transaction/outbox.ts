/**
 * Transactional Outbox Pattern for ReactiveBase.
 * Mutations atomically write domain events to an _outbox table within
 * the same SERIALIZABLE transaction. A poller/CDC relay delivers events
 * to external consumers (Kafka, SQS, HTTP) with exactly-once semantics.
 *
 * Usage:
 *   // In a mutation:
 *   ctx.emit({ type: "task.completed", payload: { taskId: "t1" } })
 *
 *   // Relay setup:
 *   const relay = new OutboxRelay(pool, { deliveryTarget: kafkaTarget })
 *   relay.start()
 */

import type { PoolClient, Pool } from "pg"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OutboxEvent {
  /** Event type identifier (e.g. "task.completed") */
  type: string
  /** Arbitrary event payload */
  payload: unknown
  /** Optional aggregate ID for ordering guarantees */
  aggregateId?: string
  /** Optional metadata (correlation ID, causation ID, etc.) */
  metadata?: Record<string, unknown>
}

export interface OutboxRecord {
  id: string
  type: string
  payload: unknown
  aggregateId: string | null
  metadata: Record<string, unknown>
  status: OutboxStatus
  attempts: number
  lastError: string | null
  createdAt: Date
  processedAt: Date | null
}

export type OutboxStatus = "pending" | "processing" | "delivered" | "dead_letter"

export interface DeliveryTarget {
  name: string
  deliver(events: OutboxRecord[]): Promise<DeliveryResult[]>
}

export interface DeliveryResult {
  eventId: string
  success: boolean
  error?: string
}

export interface OutboxRelayOptions {
  /** Polling interval in ms (default: 1000) */
  pollIntervalMs?: number
  /** Batch size per poll (default: 100) */
  batchSize?: number
  /** Max delivery attempts before dead-lettering (default: 5) */
  maxAttempts?: number
  /** Delivery target */
  deliveryTarget: DeliveryTarget
}

export interface OutboxStats {
  pending: number
  processing: number
  delivered: number
  deadLetter: number
  totalEvents: number
  lastPollAt: number | null
  lastDeliveryAt: number | null
}

// ─── SQL Helpers ─────────────────────────────────────────────────────────────

export function generateOutboxTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_outbox (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  aggregate_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'delivered', 'dead_letter'))
);

CREATE INDEX IF NOT EXISTS idx_outbox_status ON _reactivebase_outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_aggregate ON _reactivebase_outbox(aggregate_id, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_type ON _reactivebase_outbox(type);
`.trim()
}

export function buildInsertOutboxEventSQL(event: OutboxEvent): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_outbox (type, payload, aggregate_id, metadata)
VALUES ($1, $2, $3, $4)
RETURNING *`,
    params: [
      event.type,
      JSON.stringify(event.payload),
      event.aggregateId ?? null,
      JSON.stringify(event.metadata ?? {}),
    ],
  }
}

export function buildClaimBatchSQL(batchSize: number): { sql: string; params: unknown[] } {
  return {
    sql: `UPDATE _reactivebase_outbox
SET status = 'processing'
WHERE id IN (
  SELECT id FROM _reactivebase_outbox
  WHERE status = 'pending'
  ORDER BY created_at ASC
  LIMIT $1
  FOR UPDATE SKIP LOCKED
)
RETURNING *`,
    params: [batchSize],
  }
}

export function buildMarkDeliveredSQL(eventIds: string[]): { sql: string; params: unknown[] } {
  const placeholders = eventIds.map((_, i) => `$${i + 1}`).join(", ")
  return {
    sql: `UPDATE _reactivebase_outbox
SET status = 'delivered', processed_at = NOW()
WHERE id IN (${placeholders})`,
    params: eventIds,
  }
}

export function buildMarkFailedSQL(
  eventId: string,
  error: string,
  maxAttempts: number,
): { sql: string; params: unknown[] } {
  return {
    sql: `UPDATE _reactivebase_outbox
SET attempts = attempts + 1,
    last_error = $2,
    status = CASE
      WHEN attempts + 1 >= $3 THEN 'dead_letter'
      ELSE 'pending'
    END
WHERE id = $1`,
    params: [eventId, error, maxAttempts],
  }
}

export function buildReplaySQL(eventIds: string[]): { sql: string; params: unknown[] } {
  const placeholders = eventIds.map((_, i) => `$${i + 1}`).join(", ")
  return {
    sql: `UPDATE _reactivebase_outbox
SET status = 'pending', attempts = 0, last_error = NULL, processed_at = NULL
WHERE id IN (${placeholders})`,
    params: eventIds,
  }
}

export function buildOutboxStatsSQL(): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT
  COUNT(*) FILTER (WHERE status = 'pending') AS pending,
  COUNT(*) FILTER (WHERE status = 'processing') AS processing,
  COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
  COUNT(*) FILTER (WHERE status = 'dead_letter') AS dead_letter,
  COUNT(*) AS total,
  MAX(processed_at) AS last_delivery_at
FROM _reactivebase_outbox`,
    params: [],
  }
}

export function buildDeadLetterQuerySQL(limit: number = 50): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT * FROM _reactivebase_outbox
WHERE status = 'dead_letter'
ORDER BY created_at DESC
LIMIT $1`,
    params: [limit],
  }
}

// ─── Outbox Writer (used within mutations) ───────────────────────────────────

/**
 * Write an event to the outbox table within an existing transaction.
 * Called via ctx.emit() inside mutation handlers.
 */
export async function writeOutboxEvent(client: PoolClient, event: OutboxEvent): Promise<OutboxRecord> {
  if (!event.type || typeof event.type !== "string") {
    throw new OutboxError("Event type is required and must be a string")
  }

  const { sql, params } = buildInsertOutboxEventSQL(event)
  const result = await client.query(sql, params)
  const row = result.rows[0]

  return mapRowToRecord(row)
}

// ─── Outbox Relay (Poller) ───────────────────────────────────────────────────

const DEFAULT_RELAY_OPTIONS: Required<Omit<OutboxRelayOptions, "deliveryTarget">> = {
  pollIntervalMs: 1000,
  batchSize: 100,
  maxAttempts: 5,
}

export class OutboxRelay {
  private options: Required<Omit<OutboxRelayOptions, "deliveryTarget">>
  private target: DeliveryTarget
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private lastPollAt: number | null = null

  constructor(
    private pool: Pool,
    options: OutboxRelayOptions,
  ) {
    this.options = { ...DEFAULT_RELAY_OPTIONS, ...options }
    this.target = options.deliveryTarget
  }

  /** Start the polling relay. */
  start(): void {
    if (this.running) return
    this.running = true
    this.poll()
    this.timer = setInterval(() => this.poll(), this.options.pollIntervalMs)
  }

  /** Stop the polling relay. */
  stop(): void {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Execute a single poll cycle (claim + deliver + ack). */
  async poll(): Promise<number> {
    if (!this.running) return 0

    const client = await this.pool.connect()
    try {
      this.lastPollAt = Date.now()

      // Claim a batch
      await client.query("BEGIN")
      const { sql, params } = buildClaimBatchSQL(this.options.batchSize)
      const result = await client.query(sql, params)
      await client.query("COMMIT")

      if (result.rows.length === 0) return 0

      const records = result.rows.map(mapRowToRecord)

      // Deliver to target
      const deliveryResults = await this.target.deliver(records)

      // Process results
      const delivered: string[] = []
      for (const dr of deliveryResults) {
        if (dr.success) {
          delivered.push(dr.eventId)
        } else {
          const { sql: failSql, params: failParams } = buildMarkFailedSQL(
            dr.eventId,
            dr.error ?? "Unknown delivery error",
            this.options.maxAttempts,
          )
          await client.query(failSql, failParams)
        }
      }

      if (delivered.length > 0) {
        const { sql: ackSql, params: ackParams } = buildMarkDeliveredSQL(delivered)
        await client.query(ackSql, ackParams)
      }

      return records.length
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  /** Replay dead-letter events by resetting their status to pending. */
  async replayDeadLetters(eventIds: string[]): Promise<number> {
    if (eventIds.length === 0) return 0
    const { sql, params } = buildReplaySQL(eventIds)
    const result = await this.pool.query(sql, params)
    return result.rowCount ?? 0
  }

  /** Get current outbox statistics. */
  async getStats(): Promise<OutboxStats> {
    const { sql, params } = buildOutboxStatsSQL()
    const result = await this.pool.query(sql, params)
    const row = result.rows[0]
    return {
      pending: parseInt(row.pending, 10),
      processing: parseInt(row.processing, 10),
      delivered: parseInt(row.delivered, 10),
      deadLetter: parseInt(row.dead_letter, 10),
      totalEvents: parseInt(row.total, 10),
      lastPollAt: this.lastPollAt,
      lastDeliveryAt: row.last_delivery_at ? new Date(row.last_delivery_at).getTime() : null,
    }
  }

  /** Inspect dead-letter events. */
  async inspectDeadLetters(limit: number = 50): Promise<OutboxRecord[]> {
    const { sql, params } = buildDeadLetterQuerySQL(limit)
    const result = await this.pool.query(sql, params)
    return result.rows.map(mapRowToRecord)
  }

  get isRunning(): boolean {
    return this.running
  }
}

// ─── Built-in Delivery Targets ───────────────────────────────────────────────

/** HTTP webhook delivery target — posts events as JSON to a URL. */
export function httpDeliveryTarget(url: string, options: { headers?: Record<string, string> } = {}): DeliveryTarget {
  return {
    name: `http:${url}`,
    async deliver(events: OutboxRecord[]): Promise<DeliveryResult[]> {
      const results: DeliveryResult[] = []

      for (const event of events) {
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...options.headers },
            body: JSON.stringify({
              id: event.id,
              type: event.type,
              payload: event.payload,
              aggregateId: event.aggregateId,
              metadata: event.metadata,
              createdAt: event.createdAt.toISOString(),
            }),
          })

          results.push({
            eventId: event.id,
            success: response.ok,
            error: response.ok ? undefined : `HTTP ${response.status}`,
          })
        } catch (err) {
          results.push({
            eventId: event.id,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      return results
    },
  }
}

/** Console/logging delivery target — useful for development. */
export function consoleDeliveryTarget(): DeliveryTarget {
  return {
    name: "console",
    async deliver(events: OutboxRecord[]): Promise<DeliveryResult[]> {
      return events.map((event) => {
        console.log(`[outbox] ${event.type}`, JSON.stringify(event.payload))
        return { eventId: event.id, success: true }
      })
    },
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapRowToRecord(row: Record<string, unknown>): OutboxRecord {
  return {
    id: row.id as string,
    type: row.type as string,
    payload: row.payload,
    aggregateId: (row.aggregate_id as string) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    status: row.status as OutboxStatus,
    attempts: row.attempts as number,
    lastError: (row.last_error as string) ?? null,
    createdAt: new Date(row.created_at as string),
    processedAt: row.processed_at ? new Date(row.processed_at as string) : null,
  }
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class OutboxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OutboxError"
  }
}
