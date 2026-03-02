/**
 * Postgres Change Data Capture (CDC) for ReactiveBase.
 * Detects external writes via LISTEN/NOTIFY and feeds them
 * into the reactive invalidation pipeline.
 */

import type { ChangeEvent } from "../reactivity/index.js"
import { parseNotifyPayload, generateNotifyTriggerSQL } from "../webhooks/index.js"
import type { Schema } from "../schema/index.js"

export interface CdcOptions {
  /** NOTIFY channel name (default: "reactivebase_changes") */
  channel?: string
  /** Polling interval fallback in ms when LISTEN fails (default: 5000) */
  pollInterval?: number
  /** Whether to auto-install triggers on start (default: false) */
  autoInstallTriggers?: boolean
}

const DEFAULT_OPTIONS: Required<CdcOptions> = {
  channel: "reactivebase_changes",
  pollInterval: 5000,
  autoInstallTriggers: false,
}

export type CdcHandler = (events: ChangeEvent[]) => Promise<void> | void

const SAFE_PG_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/**
 * CDC Listener that uses Postgres LISTEN/NOTIFY to detect external changes.
 */
export class CdcListener {
  private options: Required<CdcOptions>
  private handler: CdcHandler | null = null
  private listening = false
  private client: PgListenClient | null = null

  /**
   * Create a new CDC listener.
   *
   * @param options - CDC listener configuration options
   */
  constructor(options: CdcOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Set the handler for incoming change events.
   *
   * @param handler - Callback invoked with batched change events
   */
  onChanges(handler: CdcHandler): void {
    this.handler = handler
  }

  /**
   * Start listening for Postgres NOTIFY events.
   * Requires a dedicated pg client (separate from the pool).
   *
   * @param client - A dedicated Postgres client for LISTEN/NOTIFY
   */
  async start(client: PgListenClient): Promise<void> {
    if (!SAFE_PG_IDENTIFIER_RE.test(this.options.channel)) {
      throw new Error(`Invalid CDC channel name: must be a valid PostgreSQL identifier`)
    }
    this.client = client
    this.listening = true

    client.on("notification", (msg) => {
      if (msg.channel !== this.options.channel) return

      const event = parseNotifyPayload(msg.payload ?? "")
      if (event && this.handler) {
        this.handler([event])
      }
    })

    await client.query(`LISTEN "${this.options.channel}"`)
  }

  /**
   * Stop listening.
   */
  async stop(): Promise<void> {
    this.listening = false
    if (this.client) {
      try {
        await this.client.query(`UNLISTEN "${this.options.channel}"`)
      } catch {
        // Client may already be closed
      }
      this.client = null
    }
  }

  /**
   * Generate and execute trigger installation SQL for all schema tables.
   *
   * @param client - Postgres client to execute the trigger SQL
   * @param schema - Schema describing the tables to install triggers for
   * @returns Array of table names that had triggers installed
   */
  async installTriggers(client: PgListenClient, schema: Schema): Promise<string[]> {
    const installed: string[] = []

    for (const tableName of schema.tableNames) {
      const sql = generateNotifyTriggerSQL(tableName, this.options.channel)
      await client.query(sql)
      installed.push(tableName)
    }

    return installed
  }

  /**
   * Generate trigger SQL for all tables without executing.
   *
   * @param schema - Schema describing the tables to generate triggers for
   * @returns Combined SQL string with trigger statements for all tables
   */
  generateTriggerSQL(schema: Schema): string {
    const statements: string[] = []
    for (const tableName of schema.tableNames) {
      statements.push(generateNotifyTriggerSQL(tableName, this.options.channel))
    }
    return statements.join("\n")
  }

  get isListening(): boolean {
    return this.listening
  }
}

/**
 * Minimal Postgres client interface for LISTEN/NOTIFY.
 */
export interface PgListenClient {
  query(sql: string): Promise<unknown>
  on(event: "notification", handler: (msg: { channel: string; payload?: string }) => void): void
  on(event: string, handler: (...args: unknown[]) => void): void
}

/**
 * Change event buffer that batches rapid changes for efficiency.
 */
export class ChangeEventBuffer {
  private buffer: ChangeEvent[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private handler: CdcHandler

  /**
   * Create a new change event buffer.
   *
   * @param handler - Callback invoked when the buffer is flushed
   * @param flushInterval - Interval in ms between automatic flushes
   */
  constructor(
    handler: CdcHandler,
    private flushInterval: number = 50,
  ) {
    this.handler = handler
  }

  /**
   * Add a change event to the buffer.
   *
   * @param event - The change event to buffer
   */
  push(event: ChangeEvent): void {
    this.buffer.push(event)
    this.scheduleFlush()
  }

  /**
   * Immediately flush all buffered events.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return

    const events = this.buffer
    this.buffer = []

    // Deduplicate events for the same table
    const deduplicated = deduplicateEvents(events)
    await this.handler(deduplicated)
  }

  /**
   * Stop the buffer and flush remaining events.
   */
  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.flush()
  }

  private scheduleFlush(): void {
    if (this.timer) return
    this.timer = setTimeout(async () => {
      this.timer = null
      await this.flush()
    }, this.flushInterval)
  }
}

/**
 * Deduplicate change events by table+operation within a batch.
 *
 * @param events - Array of change events to deduplicate
 * @returns Deduplicated array keeping the latest event per table+operation+filter key
 */
export function deduplicateEvents(events: ChangeEvent[]): ChangeEvent[] {
  const seen = new Map<string, ChangeEvent>()

  for (const event of events) {
    const key = `${event.table}:${event.operation}:${event.affectedFilters?.id ?? ""}`
    // Keep the latest event for each key
    seen.set(key, event)
  }

  return Array.from(seen.values())
}
