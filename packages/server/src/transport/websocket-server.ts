/**
 * WebSocket server - manages client connections and routes messages
 * to the reactivity engine, mutation executor, and action executor.
 */

import { WebSocketServer, WebSocket } from "ws"
import type { Server as HttpServer } from "node:http"
import type { Pool } from "pg"
import type { Schema } from "../schema/index.js"
import type { RegisteredFunction } from "../functions/index.js"
import { executeMutationFunction, executeActionFunction } from "../functions/index.js"
import { createAuthContext, type AuthContext, type AuthProvider } from "../auth/index.js"
import { ReactivityEngine, type SubscriptionUpdate } from "../reactivity/index.js"
import { MiddlewareManager, type MiddlewareContext } from "../middleware/index.js"
import { MetricsCollector } from "../metrics/index.js"
import { parseClientMessage, serializeServerMessage, type ServerMessage, type ClientMessage } from "./protocol.js"

export interface TransportServerOptions {
  heartbeatInterval: number
  maxConnectionsPerIp: number
  maxSubscriptionsPerConnection: number
}

const DEFAULT_OPTIONS: TransportServerOptions = {
  heartbeatInterval: 30_000,
  maxConnectionsPerIp: 100,
  maxSubscriptionsPerConnection: 1000,
}

interface ConnectionState {
  id: string
  ws: WebSocket
  auth: AuthContext
  isAlive: boolean
  subscriptionCount: number
}

export class TransportServer {
  private wss: WebSocketServer | null = null
  private connections = new Map<string, ConnectionState>()
  private engine: ReactivityEngine
  private functions = new Map<string, RegisteredFunction>()
  private authProviders: AuthProvider[] = []
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private options: TransportServerOptions
  private middleware: MiddlewareManager
  private metrics: MetricsCollector | null

  constructor(
    private pool: Pool,
    private schema: Schema,
    options: Partial<TransportServerOptions> = {},
    middleware?: MiddlewareManager,
    metrics?: MetricsCollector,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.middleware = middleware ?? new MiddlewareManager()
    this.metrics = metrics ?? null
    this.engine = new ReactivityEngine(pool, schema)

    // Wire up reactivity updates to WebSocket delivery
    this.engine.onUpdate((update) => this.deliverUpdate(update))
  }

  /**
   * Register a server function.
   */
  registerFunction(name: string, fn: RegisteredFunction): void {
    this.functions.set(name, fn)
    this.engine.registerFunction(name, fn)
  }

  /**
   * Register an auth provider.
   */
  addAuthProvider(provider: AuthProvider): void {
    this.authProviders.push(provider)
  }

  /**
   * Attach to an HTTP server and start accepting WebSocket connections.
   */
  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: "/ws" })

    this.wss.on("connection", (ws) => this.handleConnection(ws))

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.options.heartbeatInterval)
  }

  /**
   * Create a standalone WebSocket server on a given port.
   */
  listen(port: number): void {
    this.wss = new WebSocketServer({ port, path: "/ws" })
    this.wss.on("connection", (ws) => this.handleConnection(ws))
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.options.heartbeatInterval)
  }

  /**
   * Gracefully shut down the server.
   */
  async close(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    for (const conn of this.connections.values()) {
      conn.ws.close(1001, "Server shutting down")
    }
    this.connections.clear()

    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => resolve())
      } else {
        resolve()
      }
    })
  }

  /**
   * Get the reactivity engine for direct access (e.g., testing).
   */
  getEngine(): ReactivityEngine {
    return this.engine
  }

  get connectionCount(): number {
    return this.connections.size
  }

  get subscriptionCount(): number {
    return this.engine.registry.size
  }

  private handleConnection(ws: WebSocket): void {
    const connectionId = this.generateConnectionId()

    const state: ConnectionState = {
      id: connectionId,
      ws,
      auth: createAuthContext(null),
      isAlive: true,
      subscriptionCount: 0,
    }

    this.connections.set(connectionId, state)
    this.metrics?.setConnections(this.connections.size)

    ws.on("message", (data) => {
      this.handleMessage(state, data.toString())
    })

    ws.on("close", () => {
      this.engine.removeConnection(connectionId)
      this.connections.delete(connectionId)
      this.metrics?.setConnections(this.connections.size)
    })

    ws.on("pong", () => {
      state.isAlive = true
    })

    ws.on("error", (error) => {
      console.error(`WebSocket error for connection ${connectionId}:`, error)
    })
  }

  private async handleMessage(conn: ConnectionState, raw: string): Promise<void> {
    let msg: ClientMessage

    try {
      msg = parseClientMessage(raw)
    } catch {
      this.send(conn, {
        type: "mutation_error",
        requestId: "unknown",
        error: { code: "INVALID_MESSAGE", message: "Failed to parse message" },
      })
      return
    }

    switch (msg.type) {
      case "auth":
        await this.handleAuth(conn, msg.token)
        break
      case "subscribe":
        await this.handleSubscribe(conn, msg.subscriptionId, msg.queryName, msg.args)
        break
      case "unsubscribe":
        this.handleUnsubscribe(conn, msg.subscriptionId)
        break
      case "mutate":
        await this.handleMutate(conn, msg.requestId, msg.mutationName, msg.args)
        break
      case "action":
        await this.handleAction(conn, msg.requestId, msg.actionName, msg.args)
        break
      case "ping":
        this.send(conn, { type: "pong" })
        break
    }
  }

  private async handleAuth(conn: ConnectionState, token: string): Promise<void> {
    for (const provider of this.authProviders) {
      try {
        const result = await provider.verify(token)
        conn.auth = createAuthContext(result.userId, result.claims)
        this.send(conn, { type: "auth_result", success: true })
        return
      } catch {
        // Try next provider
      }
    }

    this.send(conn, {
      type: "auth_result",
      success: false,
      error: "Authentication failed",
    })
  }

  private async handleSubscribe(
    conn: ConnectionState,
    subscriptionId: string,
    queryName: string,
    args: unknown,
  ): Promise<void> {
    if (conn.subscriptionCount >= this.options.maxSubscriptionsPerConnection) {
      this.send(conn, {
        type: "subscription_error",
        subscriptionId,
        error: { code: "MAX_SUBSCRIPTIONS", message: "Maximum subscriptions reached" },
      })
      return
    }

    try {
      const startTime = performance.now()
      const { result, version } = await this.engine.subscribe(subscriptionId, conn.id, queryName, args, conn.auth)
      const latencyMs = performance.now() - startTime

      conn.subscriptionCount++
      this.metrics?.recordSubscription("created")
      this.metrics?.recordQuery(`query:${queryName}`, latencyMs)
      this.metrics?.setConnections(this.connections.size)

      this.send(conn, {
        type: "subscription_data",
        subscriptionId,
        data: result,
        version,
      })
    } catch (error) {
      this.metrics?.recordQuery(`query:${queryName}`, 0, true)
      this.send(conn, {
        type: "subscription_error",
        subscriptionId,
        error: {
          code: "QUERY_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      })
    }
  }

  private handleUnsubscribe(conn: ConnectionState, subscriptionId: string): void {
    this.engine.unsubscribe(subscriptionId)
    conn.subscriptionCount = Math.max(0, conn.subscriptionCount - 1)
    this.metrics?.recordSubscription("removed")
  }

  private async handleMutate(
    conn: ConnectionState,
    requestId: string,
    mutationName: string,
    args: unknown,
  ): Promise<void> {
    const fn = this.functions.get(mutationName)
    if (!fn || fn.type !== "mutation") {
      this.send(conn, {
        type: "mutation_error",
        requestId,
        error: { code: "NOT_FOUND", message: `Mutation "${mutationName}" not found` },
      })
      return
    }

    try {
      const startTime = performance.now()
      const mwCtx: MiddlewareContext = {
        functionName: mutationName,
        functionType: "mutation",
        args,
        auth: conn.auth,
        state: new Map(),
      }

      const beforeResult = await this.middleware.runBefore(mwCtx)
      if (beforeResult.shortCircuit !== undefined) {
        this.send(conn, { type: "mutation_result", requestId, data: beforeResult.shortCircuit })
        return
      }

      const result = await executeMutationFunction(this.pool, this.schema, fn, beforeResult.args, conn.auth)
      const latencyMs = performance.now() - startTime

      const finalResult = await this.middleware.runAfter(mwCtx, result.result)

      this.metrics?.recordMutation(`mutation:${mutationName}`, latencyMs)

      // Send mutation result to caller
      this.send(conn, {
        type: "mutation_result",
        requestId,
        data: finalResult,
      })

      // Process reactivity (invalidate affected subscriptions)
      await this.engine.processChanges(result.modifiedTables)
    } catch (error) {
      const mwCtx: MiddlewareContext = {
        functionName: mutationName,
        functionType: "mutation",
        args,
        auth: conn.auth,
        state: new Map(),
      }
      await this.middleware.runOnError(mwCtx, error instanceof Error ? error : new Error(String(error)))
      this.metrics?.recordMutation(`mutation:${mutationName}`, 0, true)
      this.send(conn, {
        type: "mutation_error",
        requestId,
        error: {
          code: "MUTATION_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      })
    }
  }

  private async handleAction(
    conn: ConnectionState,
    requestId: string,
    actionName: string,
    args: unknown,
  ): Promise<void> {
    const fn = this.functions.get(actionName)
    if (!fn || fn.type !== "action") {
      this.send(conn, {
        type: "action_error",
        requestId,
        error: { code: "NOT_FOUND", message: `Action "${actionName}" not found` },
      })
      return
    }

    try {
      const mwCtx: MiddlewareContext = {
        functionName: actionName,
        functionType: "action",
        args,
        auth: conn.auth,
        state: new Map(),
      }

      const beforeResult = await this.middleware.runBefore(mwCtx)
      if (beforeResult.shortCircuit !== undefined) {
        this.send(conn, { type: "action_result", requestId, data: beforeResult.shortCircuit })
        return
      }

      const result = await executeActionFunction(this.pool, this.schema, fn, beforeResult.args, conn.auth)
      const finalResult = await this.middleware.runAfter(mwCtx, result)
      this.send(conn, { type: "action_result", requestId, data: finalResult })
    } catch (error) {
      const mwCtx: MiddlewareContext = {
        functionName: actionName,
        functionType: "action",
        args,
        auth: conn.auth,
        state: new Map(),
      }
      await this.middleware.runOnError(mwCtx, error instanceof Error ? error : new Error(String(error)))
      this.send(conn, {
        type: "action_error",
        requestId,
        error: {
          code: "ACTION_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      })
    }
  }

  private deliverUpdate(update: SubscriptionUpdate): void {
    const conn = this.connections.get(update.connectionId)
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) return

    this.send(conn, {
      type: "subscription_update",
      subscriptionId: update.subscriptionId,
      data: update.result,
      version: update.version,
    })
  }

  private send(conn: ConnectionState, msg: ServerMessage): void {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(serializeServerMessage(msg))
    }
  }

  private heartbeat(): void {
    for (const [id, conn] of this.connections) {
      if (!conn.isAlive) {
        conn.ws.terminate()
        this.engine.removeConnection(id)
        this.connections.delete(id)
        continue
      }
      conn.isAlive = false
      conn.ws.ping()
    }
  }

  private connectionCounter = 0
  private generateConnectionId(): string {
    return `conn_${++this.connectionCounter}_${Date.now().toString(36)}`
  }
}
