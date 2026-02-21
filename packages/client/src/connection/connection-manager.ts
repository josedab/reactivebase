/**
 * WebSocket connection manager for the ReactiveBase client.
 * Handles connection lifecycle, reconnection, and message routing.
 */

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "reconnecting"

export interface ConnectionOptions {
  url: string
  token?: string
  maxReconnectAttempts: number
  reconnectBaseDelay: number
  reconnectMaxDelay: number
  heartbeatInterval: number
}

const DEFAULT_OPTIONS: ConnectionOptions = {
  url: "ws://localhost:4000/ws",
  maxReconnectAttempts: Infinity,
  reconnectBaseDelay: 1000,
  reconnectMaxDelay: 30_000,
  heartbeatInterval: 25_000,
}

export type MessageHandler = (data: unknown) => void
export type StatusHandler = (status: ConnectionStatus) => void

export class ConnectionManager {
  private ws: WebSocket | null = null
  private options: ConnectionOptions
  private status: ConnectionStatus = "disconnected"
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private messageHandlers = new Set<MessageHandler>()
  private statusHandlers = new Set<StatusHandler>()
  private pendingMessages: string[] = []

  constructor(options: Partial<ConnectionOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Connect to the server.
   */
  connect(): void {
    if (this.status === "connected" || this.status === "connecting") return

    this.setStatus("connecting")
    this.createConnection()
  }

  /**
   * Disconnect from the server.
   */
  disconnect(): void {
    this.clearTimers()
    this.reconnectAttempts = 0

    if (this.ws) {
      this.ws.close(1000, "Client disconnect")
      this.ws = null
    }

    this.setStatus("disconnected")
  }

  /**
   * Send a message to the server.
   */
  send(message: unknown): void {
    const raw = JSON.stringify(message)

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(raw)
    } else {
      this.pendingMessages.push(raw)
    }
  }

  /**
   * Register a handler for incoming messages.
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  /**
   * Register a handler for connection status changes.
   */
  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler)
    return () => this.statusHandlers.delete(handler)
  }

  getStatus(): ConnectionStatus {
    return this.status
  }

  private createConnection(): void {
    try {
      this.ws = new WebSocket(this.options.url)

      this.ws.onopen = () => {
        this.setStatus("connected")
        this.reconnectAttempts = 0

        // Authenticate if token is provided
        if (this.options.token) {
          this.send({ type: "auth", token: this.options.token })
        }

        // Flush pending messages
        for (const msg of this.pendingMessages) {
          this.ws!.send(msg)
        }
        this.pendingMessages = []

        // Start heartbeat
        this.startHeartbeat()
      }

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string)
          for (const handler of this.messageHandlers) {
            handler(data)
          }
        } catch {
          console.error("Failed to parse server message")
        }
      }

      this.ws.onclose = (event) => {
        this.clearTimers()

        if (event.code === 1000) {
          this.setStatus("disconnected")
          return
        }

        this.attemptReconnect()
      }

      this.ws.onerror = () => {
        // Error will be followed by close event
      }
    } catch {
      this.attemptReconnect()
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.setStatus("disconnected")
      return
    }

    this.setStatus("reconnecting")
    this.reconnectAttempts++

    const delay = Math.min(
      this.options.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.options.reconnectMaxDelay,
    )

    this.reconnectTimer = setTimeout(() => {
      this.createConnection()
    }, delay)
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: "ping" })
    }, this.options.heartbeatInterval)
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return
    this.status = status
    for (const handler of this.statusHandlers) {
      handler(status)
    }
  }
}
