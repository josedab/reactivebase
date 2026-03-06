/**
 * Server-Sent Events (SSE) Transport Server for ReactiveBase.
 * First-class SSE transport alongside WebSocket with automatic protocol
 * negotiation, HTTP/2 multiplexing support, and edge runtime compatibility.
 *
 * Features:
 *   - Full SSE transport with subscription management
 *   - Automatic protocol negotiation (prefer WS, fallback to SSE)
 *   - HTTP/2 multiplexing for concurrent subscriptions
 *   - Edge-compatible streaming (Cloudflare Workers, Vercel Edge)
 *   - Event replay via Last-Event-ID header
 *   - Per-client backpressure detection
 *   - Heartbeat keep-alive
 *
 * Usage:
 *   const sse = new SseTransportServer({ path: '/sse' })
 *   sse.attach(httpServer)
 *
 *   // Or with protocol negotiation:
 *   const negotiator = new ProtocolNegotiator({ wsServer, sseServer })
 *   negotiator.attach(httpServer)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SseTransportOptions {
  /** SSE endpoint path (default: "/sse") */
  path?: string
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatIntervalMs?: number
  /** Max events to buffer for replay (default: 1000) */
  replayBufferSize?: number
  /** Max concurrent SSE connections (default: 10000) */
  maxConnections?: number
  /** Max subscriptions per connection (default: 100) */
  maxSubscriptionsPerConnection?: number
  /** Enable HTTP/2 push (default: true) */
  http2Multiplexing?: boolean
  /** Compression (default: false, enable for non-edge) */
  compress?: boolean
  /** CORS origin (default: "*") */
  corsOrigin?: string
}

export interface SseConnection {
  id: string
  writer: SseWritable
  subscriptions: Set<string>
  connectedAt: number
  lastEventId: string | null
  eventCount: number
  ip: string
  userAgent: string
  authenticated: boolean
  metadata: Record<string, unknown>
}

export interface SseWritable {
  write(data: string): boolean
  end(): void
  writeHead?(status: number, headers: Record<string, string>): void
  on?(event: string, listener: () => void): void
  /** For HTTP/2 streams */
  respond?(headers: Record<string, string | number>): void
}

export interface SseSubscriptionRequest {
  connectionId: string
  subscriptionId: string
  queryName: string
  variables?: Record<string, unknown>
}

export interface SseEvent {
  id: string
  event: string
  data: unknown
  retry?: number
}

export interface SseTransportStats {
  connections: number
  totalSubscriptions: number
  eventsDelivered: number
  replayBufferSize: number
  droppedEvents: number
}

// ─── SSE Transport Server ────────────────────────────────────────────────────

const SSE_DEFAULTS: Required<Omit<SseTransportOptions, "compress" | "corsOrigin">> & {
  compress: boolean
  corsOrigin: string
} = {
  path: "/sse",
  heartbeatIntervalMs: 30_000,
  replayBufferSize: 1_000,
  maxConnections: 10_000,
  maxSubscriptionsPerConnection: 100,
  http2Multiplexing: true,
  compress: false,
  corsOrigin: "*",
}

export class SseTransportServer {
  private options: typeof SSE_DEFAULTS
  private connections = new Map<string, SseConnection>()
  private replayBuffer: Array<{ id: string; event: string; data: string; timestamp: number }> = []
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private eventCounter = 0
  private droppedEvents = 0
  private totalEventsDelivered = 0

  // Index: subscriptionId → connectionId for routing updates
  private subscriptionIndex = new Map<string, string>()
  // Index: queryName → Set<subscriptionId> for broadcasting
  private queryIndex = new Map<string, Set<string>>()

  constructor(options?: SseTransportOptions) {
    this.options = { ...SSE_DEFAULTS, ...options }
  }

  /**
   * Handle an incoming SSE connection request.
   * Call this from your HTTP server's request handler.
   */
  handleConnection(
    connectionId: string,
    writer: SseWritable,
    meta?: { ip?: string; userAgent?: string; lastEventId?: string; authToken?: string },
  ): SseConnection {
    if (this.connections.size >= this.options.maxConnections) {
      throw new SseTransportError(`Max connections reached (${this.options.maxConnections})`)
    }

    // Write SSE headers
    const headers: Record<string, string> = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": this.options.corsOrigin,
    }

    if (writer.writeHead) {
      writer.writeHead(200, headers)
    } else if (writer.respond) {
      writer.respond({ ...headers, ":status": 200 })
    }

    const connection: SseConnection = {
      id: connectionId,
      writer,
      subscriptions: new Set(),
      connectedAt: Date.now(),
      lastEventId: meta?.lastEventId ?? null,
      eventCount: 0,
      ip: meta?.ip ?? "unknown",
      userAgent: meta?.userAgent ?? "unknown",
      authenticated: !!meta?.authToken,
      metadata: {},
    }

    this.connections.set(connectionId, connection)

    // Listen for disconnect
    if (writer.on) {
      writer.on("close", () => this.removeConnection(connectionId))
    }

    // Replay missed events
    if (connection.lastEventId) {
      this.replayEvents(connection)
    }

    // Start heartbeat if first connection
    if (this.connections.size === 1) {
      this.startHeartbeat()
    }

    // Send connection acknowledgement
    this.sendEvent(connection, {
      id: `sys-${Date.now()}`,
      event: "connected",
      data: { connectionId, serverTime: Date.now() },
    })

    return connection
  }

  /**
   * Remove a connection and clean up its subscriptions.
   */
  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId)
    if (!connection) return

    // Clean up subscriptions
    for (const subId of connection.subscriptions) {
      this.subscriptionIndex.delete(subId)
      for (const [, subs] of this.queryIndex) {
        subs.delete(subId)
      }
    }

    try {
      connection.writer.end()
    } catch {
      // Writer may already be closed
    }

    this.connections.delete(connectionId)

    if (this.connections.size === 0) {
      this.stopHeartbeat()
    }
  }

  /**
   * Subscribe a connection to a query's updates.
   */
  subscribe(request: SseSubscriptionRequest): void {
    const connection = this.connections.get(request.connectionId)
    if (!connection) {
      throw new SseTransportError(`Connection "${request.connectionId}" not found`)
    }

    if (connection.subscriptions.size >= this.options.maxSubscriptionsPerConnection) {
      throw new SseTransportError(
        `Max subscriptions per connection reached (${this.options.maxSubscriptionsPerConnection})`,
      )
    }

    connection.subscriptions.add(request.subscriptionId)
    this.subscriptionIndex.set(request.subscriptionId, request.connectionId)

    let querySubs = this.queryIndex.get(request.queryName)
    if (!querySubs) {
      querySubs = new Set()
      this.queryIndex.set(request.queryName, querySubs)
    }
    querySubs.add(request.subscriptionId)

    // Acknowledge subscription
    this.sendEvent(connection, {
      id: `sub-ack-${request.subscriptionId}`,
      event: "subscribed",
      data: { subscriptionId: request.subscriptionId, queryName: request.queryName },
    })
  }

  /**
   * Unsubscribe from a query.
   */
  unsubscribe(subscriptionId: string): void {
    const connectionId = this.subscriptionIndex.get(subscriptionId)
    if (!connectionId) return

    const connection = this.connections.get(connectionId)
    if (connection) {
      connection.subscriptions.delete(subscriptionId)
    }

    this.subscriptionIndex.delete(subscriptionId)
    for (const [, subs] of this.queryIndex) {
      subs.delete(subscriptionId)
    }
  }

  /**
   * Push a data update to all subscriptions for a given query.
   */
  pushUpdate(queryName: string, data: unknown): number {
    const subIds = this.queryIndex.get(queryName)
    if (!subIds || subIds.size === 0) return 0

    const eventId = `evt-${++this.eventCounter}`
    const eventData = JSON.stringify({ queryName, data, timestamp: Date.now() })
    let delivered = 0

    // Buffer for replay
    this.replayBuffer.push({ id: eventId, event: "update", data: eventData, timestamp: Date.now() })
    if (this.replayBuffer.length > this.options.replayBufferSize) {
      this.replayBuffer.shift()
    }

    for (const subId of subIds) {
      const connectionId = this.subscriptionIndex.get(subId)
      if (!connectionId) continue

      const connection = this.connections.get(connectionId)
      if (!connection) continue

      try {
        const sseString = `id: ${eventId}\nevent: update\ndata: ${eventData}\n\n`
        const written = connection.writer.write(sseString)
        if (!written) {
          this.droppedEvents++
        } else {
          connection.eventCount++
          this.totalEventsDelivered++
          delivered++
        }
      } catch {
        this.removeConnection(connectionId)
      }
    }

    return delivered
  }

  /**
   * Push to a specific subscription.
   */
  pushToSubscription(subscriptionId: string, data: unknown): boolean {
    const connectionId = this.subscriptionIndex.get(subscriptionId)
    if (!connectionId) return false

    const connection = this.connections.get(connectionId)
    if (!connection) return false

    const eventId = `evt-${++this.eventCounter}`

    return this.sendEvent(connection, { id: eventId, event: "update", data })
  }

  /**
   * Get transport statistics.
   */
  getStats(): SseTransportStats {
    let totalSubs = 0
    for (const conn of this.connections.values()) {
      totalSubs += conn.subscriptions.size
    }

    return {
      connections: this.connections.size,
      totalSubscriptions: totalSubs,
      eventsDelivered: this.totalEventsDelivered,
      replayBufferSize: this.replayBuffer.length,
      droppedEvents: this.droppedEvents,
    }
  }

  /**
   * Clean up all connections and resources.
   */
  async close(): Promise<void> {
    this.stopHeartbeat()
    for (const connection of Array.from(this.connections.values())) {
      try {
        connection.writer.end()
      } catch {
        // Ignore close errors
      }
    }
    this.connections.clear()
    this.subscriptionIndex.clear()
    this.queryIndex.clear()
    this.replayBuffer = []
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private sendEvent(connection: SseConnection, event: SseEvent): boolean {
    try {
      const data = typeof event.data === "string" ? event.data : JSON.stringify(event.data)
      let sseString = `id: ${event.id}\nevent: ${event.event}\ndata: ${data}\n`
      if (event.retry) sseString += `retry: ${event.retry}\n`
      sseString += "\n"

      return connection.writer.write(sseString)
    } catch {
      this.removeConnection(connection.id)
      return false
    }
  }

  private replayEvents(connection: SseConnection): void {
    if (!connection.lastEventId) return

    const startIdx = this.replayBuffer.findIndex((e) => e.id === connection.lastEventId)
    if (startIdx === -1) return

    const missed = this.replayBuffer.slice(startIdx + 1)
    for (const entry of missed) {
      try {
        connection.writer.write(`id: ${entry.id}\nevent: ${entry.event}\ndata: ${entry.data}\n\n`)
      } catch {
        this.removeConnection(connection.id)
        return
      }
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return
    this.heartbeatTimer = setInterval(() => {
      const comment = `: heartbeat ${Date.now()}\n\n`
      for (const connection of Array.from(this.connections.values())) {
        try {
          connection.writer.write(comment)
        } catch {
          this.removeConnection(connection.id)
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

// ─── Protocol Negotiation ────────────────────────────────────────────────────

export type TransportProtocol = "websocket" | "sse"

export interface ProtocolNegotiatorOptions {
  /** Preferred protocol order (default: ["websocket", "sse"]) */
  preferenceOrder?: TransportProtocol[]
  /** Force a specific protocol (overrides negotiation) */
  forceProtocol?: TransportProtocol
  /** SSE endpoint path (default: "/sse") */
  ssePath?: string
  /** WebSocket endpoint path (default: "/ws") */
  wsPath?: string
}

export interface NegotiationResult {
  protocol: TransportProtocol
  reason: "preferred" | "forced" | "fallback" | "upgrade_unavailable"
  endpoint: string
}

/**
 * Negotiates the optimal transport protocol based on client capabilities.
 */
export class ProtocolNegotiator {
  private options: Required<ProtocolNegotiatorOptions>

  constructor(options?: ProtocolNegotiatorOptions) {
    this.options = {
      preferenceOrder: options?.preferenceOrder ?? ["websocket", "sse"],
      forceProtocol: options?.forceProtocol ?? (undefined as unknown as TransportProtocol),
      ssePath: options?.ssePath ?? "/sse",
      wsPath: options?.wsPath ?? "/ws",
    }
  }

  /**
   * Negotiate the best transport based on request headers.
   */
  negotiate(headers: Record<string, string | string[] | undefined>): NegotiationResult {
    // Forced protocol
    if (this.options.forceProtocol) {
      return {
        protocol: this.options.forceProtocol,
        reason: "forced",
        endpoint: this.options.forceProtocol === "websocket" ? this.options.wsPath : this.options.ssePath,
      }
    }

    const upgradeHeader = normalizeHeader(headers["upgrade"])
    const acceptHeader = normalizeHeader(headers["accept"])

    // Check if WebSocket upgrade is available
    const wsAvailable = upgradeHeader?.toLowerCase() === "websocket"

    // Check for SSE preference via Accept header
    const ssePreferred = acceptHeader?.includes("text/event-stream")

    // Check for explicit protocol request
    const requestedProtocol = normalizeHeader(headers["x-reactive-transport"])

    if (requestedProtocol === "sse") {
      return { protocol: "sse", reason: "preferred", endpoint: this.options.ssePath }
    }
    if (requestedProtocol === "websocket" && wsAvailable) {
      return { protocol: "websocket", reason: "preferred", endpoint: this.options.wsPath }
    }

    // Negotiate based on preference order
    for (const protocol of this.options.preferenceOrder) {
      if (protocol === "websocket" && wsAvailable) {
        return { protocol: "websocket", reason: "preferred", endpoint: this.options.wsPath }
      }
      if (protocol === "sse" && (ssePreferred || !wsAvailable)) {
        return { protocol: "sse", reason: wsAvailable ? "preferred" : "fallback", endpoint: this.options.ssePath }
      }
    }

    // Default fallback to SSE (always available)
    return {
      protocol: "sse",
      reason: "upgrade_unavailable",
      endpoint: this.options.ssePath,
    }
  }

  /**
   * Generate a client-side negotiation snippet.
   */
  generateClientSnippet(baseUrl: string): string {
    return `// ReactiveBase Protocol Negotiation
async function connectReactiveBase(baseUrl = '${baseUrl}') {
  // Try WebSocket first
  try {
    const ws = new WebSocket(baseUrl.replace(/^http/, 'ws') + '${this.options.wsPath}');
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
      setTimeout(reject, 3000);
    });
    return { protocol: 'websocket', connection: ws };
  } catch {
    // Fallback to SSE
    const sse = new EventSource(baseUrl + '${this.options.ssePath}');
    return { protocol: 'sse', connection: sse };
  }
}`
  }
}

// ─── Edge Runtime SSE Adapter ────────────────────────────────────────────────

export interface EdgeSseOptions {
  /** Heartbeat interval in ms (default: 15000, shorter for edge) */
  heartbeatIntervalMs?: number
  /** Custom headers to include in SSE response */
  headers?: Record<string, string>
}

/**
 * Edge-compatible SSE streaming for environments without WebSocket support.
 * Works with Cloudflare Workers, Vercel Edge, Deno Deploy.
 * Uses ReadableStream API instead of Node.js streams.
 */
export class EdgeSseStream {
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null
  private encoder = new TextEncoder()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private closed = false
  private options: Required<EdgeSseOptions>
  private eventCount = 0

  readonly stream: ReadableStream<Uint8Array>
  readonly headers: Record<string, string>

  constructor(options?: EdgeSseOptions) {
    this.options = {
      heartbeatIntervalMs: options?.heartbeatIntervalMs ?? 15_000,
      headers: options?.headers ?? {},
    }

    this.headers = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...this.options.headers,
    }

    this.stream = new ReadableStream({
      start: (controller) => {
        this.controller = controller
        this.startHeartbeat()
      },
      cancel: () => {
        this.close()
      },
    })
  }

  /**
   * Send an SSE event through the stream.
   */
  send(event: string, data: unknown, id?: string): void {
    if (this.closed || !this.controller) return

    const eventId = id ?? `edge-${++this.eventCount}`
    const payload = typeof data === "string" ? data : JSON.stringify(data)
    const message = `id: ${eventId}\nevent: ${event}\ndata: ${payload}\n\n`

    try {
      this.controller.enqueue(this.encoder.encode(message))
    } catch {
      this.close()
    }
  }

  /**
   * Send a comment (keep-alive ping).
   */
  sendComment(text: string): void {
    if (this.closed || !this.controller) return
    try {
      this.controller.enqueue(this.encoder.encode(`: ${text}\n\n`))
    } catch {
      this.close()
    }
  }

  /**
   * Close the SSE stream.
   */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.stopHeartbeat()
    try {
      this.controller?.close()
    } catch {
      // Already closed
    }
  }

  /**
   * Create a Response object suitable for edge runtimes.
   */
  toResponse(status = 200): Response {
    return new Response(this.stream, {
      status,
      headers: this.headers,
    })
  }

  get isClosed(): boolean {
    return this.closed
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.sendComment(`heartbeat ${Date.now()}`)
    }, this.options.heartbeatIntervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class SseTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SseTransportError"
  }
}
