/**
 * Server-Sent Events (SSE) adapter for ReactiveBase event streaming.
 * Implements the EventStreamAdapter interface to push data changes
 * to browser clients via SSE.
 *
 * Usage:
 *   const sse = new SseStreamAdapter()
 *   manager.registerAdapter("sse", sse)
 *
 *   // In your HTTP handler:
 *   app.get("/events", (req, res) => {
 *     sse.addClient("client-1", res, { tables: ["tasks"] })
 *   })
 */

import type { EventStreamAdapter, StreamEvent, PublishResult, EventFilter } from "./event-streaming.js"
import { serverLogger } from "../logging/index.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SseClient {
  id: string
  /** Writable stream (e.g., Node.js ServerResponse) */
  writer: SseWriter
  filter?: EventFilter
  connectedAt: number
  lastEventId: string | null
  eventCount: number
}

export interface SseWriter {
  write(data: string): boolean
  end(): void
  on?(event: string, listener: () => void): void
}

export interface SseAdapterOptions {
  /** Heartbeat interval in ms to keep connections alive (default: 30000) */
  heartbeatIntervalMs?: number
  /** Max events to retain for replay on reconnect (default: 100) */
  replayBufferSize?: number
  /** Custom event formatter */
  formatEvent?: (event: StreamEvent) => string
}

// ─── Implementation ──────────────────────────────────────────────────────────

const DEFAULT_OPTIONS = {
  heartbeatIntervalMs: 30_000,
  replayBufferSize: 100,
}

export class SseStreamAdapter implements EventStreamAdapter {
  readonly name = "sse"
  readonly type = "custom" as const

  private clients = new Map<string, SseClient>()
  private replayBuffer: Array<{ id: string; data: string; timestamp: number }> = []
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private options: Required<Omit<SseAdapterOptions, "formatEvent">>
  private formatEventFn?: (event: StreamEvent) => string

  constructor(options: SseAdapterOptions = {}) {
    const { formatEvent, ...rest } = options
    this.options = { ...DEFAULT_OPTIONS, ...rest }
    this.formatEventFn = formatEvent
  }

  /**
   * Add an SSE client connection.
   */
  addClient(id: string, writer: SseWriter, filter?: EventFilter, lastEventId?: string): void {
    // Set SSE headers if writer supports it
    const writerAny = writer as unknown as Record<string, unknown>
    if (typeof writerAny["writeHead"] === "function") {
      ;(writerAny["writeHead"] as (status: number, headers: Record<string, string>) => void)(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      })
    }

    const client: SseClient = {
      id,
      writer,
      filter,
      connectedAt: Date.now(),
      lastEventId: lastEventId ?? null,
      eventCount: 0,
    }

    this.clients.set(id, client)

    // Clean up on disconnect
    if (writer.on) {
      writer.on("close", () => this.removeClient(id))
    }

    // Replay missed events
    if (lastEventId) {
      this.replayEvents(client, lastEventId)
    }

    // Start heartbeat if first client
    if (this.clients.size === 1) {
      this.startHeartbeat()
    }
  }

  /**
   * Remove an SSE client.
   */
  removeClient(id: string): void {
    const client = this.clients.get(id)
    if (client) {
      try {
        client.writer.end()
      } catch (error: unknown) {
        serverLogger.debug("Failed to close SSE client writer", {
          clientId: id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      this.clients.delete(id)
    }

    if (this.clients.size === 0) {
      this.stopHeartbeat()
    }
  }

  /**
   * Publish an event to all matching SSE clients.
   */
  async publish(_topic: string, event: StreamEvent): Promise<PublishResult> {
    const sseData = this.formatSseEvent(event)

    // Add to replay buffer
    this.replayBuffer.push({ id: event.id, data: sseData, timestamp: event.timestamp })
    if (this.replayBuffer.length > this.options.replayBufferSize) {
      this.replayBuffer.shift()
    }

    let deliveredCount = 0
    for (const client of Array.from(this.clients.values())) {
      if (client.filter && !this.matchesFilter(event, client.filter)) continue

      try {
        client.writer.write(sseData)
        client.lastEventId = event.id
        client.eventCount++
        deliveredCount++
      } catch (error: unknown) {
        serverLogger.debug("Failed to write SSE event to client", {
          clientId: client.id,
          error: error instanceof Error ? error.message : String(error),
        })
        this.removeClient(client.id)
      }
    }

    return {
      success: deliveredCount > 0 || this.clients.size === 0,
      eventId: event.id,
    }
  }

  async publishBatch(_topic: string, events: StreamEvent[]): Promise<PublishResult[]> {
    return Promise.all(events.map((e) => this.publish(_topic, e)))
  }

  async healthCheck(): Promise<boolean> {
    return true
  }

  async close(): Promise<void> {
    this.stopHeartbeat()
    for (const client of Array.from(this.clients.values())) {
      try {
        client.writer.end()
      } catch (error: unknown) {
        serverLogger.debug("Failed to close SSE client on shutdown", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    this.clients.clear()
    this.replayBuffer = []
  }

  /**
   * Get connected client count.
   */
  get clientCount(): number {
    return this.clients.size
  }

  /**
   * Get stats for all connected clients.
   */
  getClientStats(): Array<{ id: string; connectedAt: number; eventCount: number }> {
    return Array.from(this.clients.values()).map((c) => ({
      id: c.id,
      connectedAt: c.connectedAt,
      eventCount: c.eventCount,
    }))
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private formatSseEvent(event: StreamEvent): string {
    if (this.formatEventFn) {
      return this.formatEventFn(event)
    }

    const data = JSON.stringify({
      table: event.table,
      type: event.type,
      data: event.data,
      timestamp: event.timestamp,
      metadata: event.metadata,
    })

    return `id: ${event.id}\nevent: ${event.type}\ndata: ${data}\n\n`
  }

  private matchesFilter(event: StreamEvent, filter: EventFilter): boolean {
    if (filter.tables && filter.tables.length > 0 && !filter.tables.includes(event.table)) return false
    if (filter.types && filter.types.length > 0 && !filter.types.includes(event.type)) return false
    if (filter.predicate && !filter.predicate(event)) return false
    return true
  }

  private replayEvents(client: SseClient, lastEventId: string): void {
    const startIdx = this.replayBuffer.findIndex((e) => e.id === lastEventId)
    if (startIdx === -1) return

    const missed = this.replayBuffer.slice(startIdx + 1)
    for (const entry of missed) {
      try {
        client.writer.write(entry.data)
      } catch (error: unknown) {
        serverLogger.debug("Failed to replay SSE event to client", {
          clientId: client.id,
          error: error instanceof Error ? error.message : String(error),
        })
        this.removeClient(client.id)
        return
      }
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return
    this.heartbeatTimer = setInterval(() => {
      const comment = `: heartbeat ${Date.now()}\n\n`
      for (const client of Array.from(this.clients.values())) {
        try {
          client.writer.write(comment)
        } catch (error: unknown) {
          serverLogger.debug("Failed to write SSE heartbeat to client", {
            clientId: client.id,
            error: error instanceof Error ? error.message : String(error),
          })
          this.removeClient(client.id)
        }
      }
    }, this.options.heartbeatIntervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
}
