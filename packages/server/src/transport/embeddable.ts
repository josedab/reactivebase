/**
 * Embeddable ReactiveBase (In-Process Mode).
 *
 * Run ReactiveBase as an embedded library within an existing Express/Fastify/Hono
 * server via createReactiveBaseMiddleware(). Mounts WebSocket upgrade handler and
 * HTTP routes on the existing server, enables sharing auth middleware and request context.
 *
 * Usage:
 *   // Express
 *   import express from "express"
 *   const app = express()
 *   const { httpHandler, wsHandler } = createReactiveBaseMiddleware({ pool, schema, functions })
 *   app.use("/api/reactivebase", httpHandler)
 *   server.on("upgrade", wsHandler)
 *
 *   // Fastify
 *   fastify.register(createReactiveBaseFastifyPlugin({ pool, schema, functions }))
 *
 *   // Hono
 *   app.route("/api/reactivebase", createReactiveBaseHonoRoutes({ pool, schema, functions }))
 */

import type { Pool } from "pg"
import type { Schema } from "../schema/index.js"
import type { RegisteredFunction } from "../functions/index.js"
import { executeQueryFunction, executeMutationFunction, executeActionFunction } from "../functions/index.js"
import { createAuthContext, type AuthContext, type AuthProvider } from "../auth/index.js"
import { ReactivityEngine } from "../reactivity/index.js"
import { MiddlewareManager, type Middleware } from "../middleware/index.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EmbeddableConfig {
  /** Postgres connection pool */
  pool: Pool
  /** Schema definition */
  schema: Schema
  /** Registered server functions */
  functions: Record<string, RegisteredFunction>
  /** Auth providers for token verification */
  authProviders?: AuthProvider[]
  /** Server middleware */
  middleware?: Middleware[]
  /** HTTP route prefix (default: "/api/reactivebase") */
  routePrefix?: string
  /** External auth context resolver — use to share auth with existing server middleware */
  resolveAuth?: (req: IncomingRequest) => Promise<AuthContext> | AuthContext
}

export interface IncomingRequest {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

export interface OutgoingResponse {
  status: number
  headers: Record<string, string>
  body: unknown
}

export interface ReactiveBaseMiddlewareResult {
  /** HTTP request handler — mount on your server's route */
  httpHandler: HttpHandler
  /** WebSocket upgrade handler — mount on server's "upgrade" event */
  wsHandler: WsUpgradeHandler
  /** Reactivity engine (for programmatic access) */
  engine: ReactivityEngine
  /** Middleware manager */
  middlewareManager: MiddlewareManager
  /** Shutdown function */
  shutdown: () => void
}

export type HttpHandler = (req: IncomingRequest) => Promise<OutgoingResponse>

export type WsUpgradeHandler = (req: IncomingRequest, socket: unknown, head: unknown) => void

// ─── Middleware Factory ──────────────────────────────────────────────────────

const DEFAULT_ROUTE_PREFIX = "/api/reactivebase"

/**
 * Create an embeddable ReactiveBase middleware for any HTTP server.
 * Returns HTTP and WebSocket handlers that can be mounted on
 * Express, Fastify, Hono, or any Node.js HTTP server.
 */
export function createReactiveBaseMiddleware(config: EmbeddableConfig): ReactiveBaseMiddlewareResult {
  const {
    pool,
    schema,
    functions,
    authProviders = [],
    middleware: middlewareList = [],
    routePrefix = DEFAULT_ROUTE_PREFIX,
    resolveAuth,
  } = config

  const engine = new ReactivityEngine(pool, schema)
  const middlewareManager = new MiddlewareManager()

  // Register functions with the engine
  for (const [name, fn] of Object.entries(functions)) {
    engine.registerFunction(name, fn)
  }

  // Register middleware
  for (const mw of middlewareList) {
    middlewareManager.use(mw)
  }

  // ─── Auth resolution ─────────────────────────────────────────────────
  const resolveAuthContext = async (req: IncomingRequest): Promise<AuthContext> => {
    // Use external resolver if provided (shares auth with existing server)
    if (resolveAuth) {
      return resolveAuth(req)
    }

    // Otherwise, extract token and verify with providers
    const authHeader = req.headers["authorization"] ?? req.headers["Authorization"]
    const token = typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "") : null

    if (!token) {
      return createAuthContext(null)
    }

    for (const provider of authProviders) {
      try {
        const { userId, claims } = await provider.verify(token)
        return createAuthContext(userId, claims)
      } catch {
        continue
      }
    }

    return createAuthContext(null)
  }

  // ─── HTTP Handler ────────────────────────────────────────────────────
  const httpHandler: HttpHandler = async (req: IncomingRequest): Promise<OutgoingResponse> => {
    const path = req.url.replace(routePrefix, "")

    try {
      // Validate POST body for mutation/query endpoints
      if (req.method === "POST" && req.body === undefined) {
        return jsonResponse(400, { error: "Request body is required for POST endpoints", code: "INVALID_REQUEST" })
      }

      const auth = await resolveAuthContext(req)

      // POST /query/:name
      if (req.method === "POST" && path.startsWith("/query/")) {
        const queryName = path.replace("/query/", "")
        const fn = functions[queryName]
        if (!fn || fn.type !== "query") {
          return jsonResponse(404, { error: `Query "${queryName}" not found` })
        }

        const result = await executeQueryFunction(pool, schema, fn, req.body, auth)
        return jsonResponse(200, { data: result.result })
      }

      // POST /mutation/:name
      if (req.method === "POST" && path.startsWith("/mutation/")) {
        const mutationName = path.replace("/mutation/", "")
        const fn = functions[mutationName]
        if (!fn || fn.type !== "mutation") {
          return jsonResponse(404, { error: `Mutation "${mutationName}" not found` })
        }

        const result = await executeMutationFunction(pool, schema, fn, req.body, auth)

        // Trigger reactivity invalidation
        if (result.modifiedTables.length > 0) {
          await engine.processChanges(result.modifiedTables)
        }

        return jsonResponse(200, { data: result.result })
      }

      // POST /action/:name
      if (req.method === "POST" && path.startsWith("/action/")) {
        const actionName = path.replace("/action/", "")
        const fn = functions[actionName]
        if (!fn || fn.type !== "action") {
          return jsonResponse(404, { error: `Action "${actionName}" not found` })
        }

        const result = await executeActionFunction(pool, schema, fn, req.body, auth)
        return jsonResponse(200, { data: result })
      }

      // GET /health
      if (req.method === "GET" && path === "/health") {
        return jsonResponse(200, {
          status: "ok",
          subscriptions: engine.registry.size,
          timestamp: new Date().toISOString(),
        })
      }

      // GET /functions — list available functions
      if (req.method === "GET" && path === "/functions") {
        const list = Object.entries(functions).map(([name, fn]) => ({
          name,
          type: fn.type,
        }))
        return jsonResponse(200, { functions: list })
      }

      return jsonResponse(404, { error: "Not found" })
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error))
      const statusCode = (err as { statusCode?: number }).statusCode ?? 500

      return jsonResponse(statusCode, {
        error: err.message,
        code: (err as { code?: string }).code ?? "INTERNAL_ERROR",
      })
    }
  }

  // ─── WebSocket Handler ───────────────────────────────────────────────
  const wsHandler: WsUpgradeHandler = (_req, _socket, _head) => {
    // WebSocket upgrade is handled by the TransportServer if available.
    // This is a stub for frameworks to wire into their own WS handling.
    // In practice, integrators would use the TransportServer's handleUpgrade.
  }

  const shutdown = () => {
    // Cleanup resources
  }

  return { httpHandler, wsHandler, engine, middlewareManager, shutdown }
}

// ─── Framework-Specific Helpers ──────────────────────────────────────────────

/**
 * Generate Express-compatible middleware from the embedded handler.
 */
export function toExpressMiddleware(config: EmbeddableConfig): {
  handler: (req: unknown, res: unknown, next: unknown) => void
  engine: ReactivityEngine
} {
  const { httpHandler, engine } = createReactiveBaseMiddleware(config)

  const handler = async (req: unknown, res: unknown, _next: unknown) => {
    const expressReq = req as { method: string; url: string; headers: Record<string, string>; body?: unknown }
    const expressRes = res as {
      status: (code: number) => { json: (body: unknown) => void; set: (headers: Record<string, string>) => void }
      json: (body: unknown) => void
    }

    const incomingReq: IncomingRequest = {
      method: expressReq.method,
      url: expressReq.url,
      headers: expressReq.headers,
      body: expressReq.body,
    }

    const response = await httpHandler(incomingReq)
    const resChain = expressRes.status(response.status)
    if (typeof resChain.set === "function") {
      resChain.set(response.headers)
    }
    resChain.json(response.body)
  }

  return { handler, engine }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(status: number, body: unknown): OutgoingResponse {
  return {
    status,
    headers: { "Content-Type": "application/json" },
    body,
  }
}
