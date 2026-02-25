/**
 * ReactiveBase Server - the main entry point for creating a reactive backend.
 * Combines all subsystems: schema, functions, reactivity, transport, auth.
 */

import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http"
import { Pool } from "pg"
import type { Schema } from "./schema/index.js"
import type { RegisteredFunction } from "./functions/index.js"
import { executeQueryFunction } from "./functions/index.js"
import { createAuthContext, type AuthProvider } from "./auth/index.js"
import type { ReactiveBaseConfig } from "./config/index.js"
import type { Middleware } from "./middleware/index.js"
import { MiddlewareManager } from "./middleware/index.js"
import { MetricsCollector } from "./metrics/index.js"
import { toPrometheusFormat } from "./metrics/index.js"
import { schemaToVisualModel } from "./dashboard/index.js"
import { generateFullDashboardHTML } from "./dashboard/index.js"
import { TransportServer } from "./transport/index.js"
import { ReactiveCdcAdapter } from "./cdc/index.js"

export interface ReactiveBaseServer {
  /** Register server functions (queries, mutations, actions) */
  registerFunctions(functions: Record<string, RegisteredFunction>): void
  /** Register middleware */
  use(middleware: Middleware): void
  /** Start the server */
  start(): Promise<{ port: number; httpServer: HttpServer }>
  /** Stop the server */
  stop(): Promise<void>
  /** Get the transport server for testing */
  getTransport(): TransportServer
  /** Get the CDC adapter for feeding external WAL changes (when cdc.mode is "logical-replication") */
  getCdcAdapter(): ReactiveCdcAdapter | null
}

export function createReactiveBaseServer(schema: Schema, config: ReactiveBaseConfig): ReactiveBaseServer {
  const pool = new Pool({
    connectionString: config.database.connectionString,
    max: config.database.poolSize ?? 20,
  })

  const middlewareManager = new MiddlewareManager()
  const metrics = new MetricsCollector()

  const transport = new TransportServer(
    pool,
    schema,
    {
      heartbeatInterval: config.server?.heartbeatInterval ?? 30_000,
    },
    middlewareManager,
    metrics,
  )

  const functions = new Map<string, RegisteredFunction>()
  const authProviders: AuthProvider[] = []

  // Initialize CDC adapter if logical replication mode is configured
  const cdcAdapter =
    config.cdc?.mode === "logical-replication"
      ? new ReactiveCdcAdapter(
          async (tables, events) => {
            await transport.getEngine().processChanges(tables, events)
          },
          {
            tables: config.cdc?.tables ?? schema.tableNames,
            batchSize: config.cdc?.batchSize ?? 100,
            flushIntervalMs: config.cdc?.flushIntervalMs ?? 10,
            rowLevelTracking: true,
          },
        )
      : null

  // Register auth providers
  if (config.auth?.providers) {
    for (const provider of config.auth.providers) {
      transport.addAuthProvider(provider)
      authProviders.push(provider)
    }
  }

  let httpServer: HttpServer | null = null

  const MAX_BODY_SIZE = 1024 * 1024 // 1 MB

  /** Parse request body as JSON */
  async function readBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let totalSize = 0
      req.on("data", (chunk: Buffer) => {
        totalSize += chunk.length
        if (totalSize > MAX_BODY_SIZE) {
          req.destroy(new Error("Request body too large"))
          return
        }
        chunks.push(chunk)
      })
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")))
        } catch {
          reject(new Error("Invalid JSON body"))
        }
      })
      req.on("error", reject)
    })
  }

  /** Resolve auth from Authorization header */
  async function resolveAuth(req: IncomingMessage) {
    const authHeader = req.headers.authorization
    if (!authHeader) return createAuthContext(null)

    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader

    for (const provider of authProviders) {
      try {
        const result = await provider.verify(token)
        return createAuthContext(result.userId, result.claims)
      } catch {
        // Try next provider
      }
    }
    return createAuthContext(null)
  }

  /** Handle POST /query — one-shot query execution for SSR */
  async function handleQueryRequest(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Method not allowed" }))
      return
    }

    try {
      const body = (await readBody(req)) as { queryName?: string; args?: unknown }
      if (!body.queryName) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Missing queryName" }))
        return
      }

      const fn = functions.get(body.queryName)
      if (!fn || fn.type !== "query") {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: `Query "${body.queryName}" not found` }))
        return
      }

      const auth = await resolveAuth(req)
      const startTime = performance.now()
      const result = await executeQueryFunction(pool, schema, fn, body.args ?? {}, auth)
      const latencyMs = performance.now() - startTime

      metrics.recordQuery(`query:${body.queryName}`, latencyMs)

      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      res.end(JSON.stringify({ data: result.result }))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Internal server error"
      metrics.recordQuery("query:unknown", 0, true)
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: message }))
    }
  }

  return {
    registerFunctions(fns: Record<string, RegisteredFunction>) {
      for (const [name, fn] of Object.entries(fns)) {
        functions.set(name, fn)
        transport.registerFunction(name, fn)
      }
    },

    use(middleware: Middleware) {
      middlewareManager.use(middleware)
    },

    async start() {
      const port = config.server?.port ?? 4000

      // Start CDC adapter buffering if in logical replication mode
      if (cdcAdapter) {
        cdcAdapter.startBuffering()
      }

      httpServer = createServer((req, res) => {
        // Security headers for all responses
        res.setHeader("X-Frame-Options", "DENY")
        res.setHeader("X-Content-Type-Options", "nosniff")
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
        )

        // CORS headers
        const corsOrigin = config.server?.corsOrigin
        if (corsOrigin) {
          res.setHeader("Access-Control-Allow-Origin", corsOrigin)
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
          res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
        }

        if (req.method === "OPTIONS") {
          res.writeHead(204)
          res.end()
          return
        }

        if (req.url === "/query") {
          handleQueryRequest(req, res)
          return
        }

        // Dashboard/metrics endpoints require authentication in production
        if (req.url === "/dashboard" || req.url === "/dashboard/schema.json" || req.url === "/metrics") {
          const dashboardToken = config.server?.dashboardToken
          const isProduction = process.env.NODE_ENV === "production"

          if (isProduction && !dashboardToken) {
            res.writeHead(403, { "Content-Type": "application/json" })
            res.end(
              JSON.stringify({
                error: "Dashboard endpoints are disabled in production. Set server.dashboardToken to enable.",
              }),
            )
            return
          }

          if (dashboardToken) {
            const authHeader = req.headers.authorization
            const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : authHeader
            if (token !== dashboardToken) {
              res.writeHead(401, { "Content-Type": "application/json" })
              res.end(JSON.stringify({ error: "Unauthorized — invalid or missing dashboard token" }))
              return
            }
          }
        }

        if (req.url === "/dashboard") {
          const model = schemaToVisualModel(schema)
          const html = generateFullDashboardHTML(model)
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          res.end(html)
          return
        }

        if (req.url === "/dashboard/schema.json") {
          const model = schemaToVisualModel(schema)
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify(model))
          return
        }

        if (req.url === "/metrics") {
          const accept = req.headers.accept ?? ""
          const snapshot = metrics.getSnapshot()

          if (accept.includes("text/plain") || accept.includes("text/plain; version=0.0.4")) {
            // Prometheus exposition format
            res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" })
            res.end(toPrometheusFormat(snapshot))
          } else {
            // JSON format (default, for dashboard)
            res.writeHead(200, { "Content-Type": "application/json" })
            res.end(JSON.stringify(snapshot))
          }
          return
        }

        // Health check endpoint (default)
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            status: "ok",
            connections: transport.connectionCount,
            subscriptions: transport.subscriptionCount,
          }),
        )
      })

      transport.attach(httpServer)

      return new Promise((resolve) => {
        httpServer!.listen(port, config.server?.hostname ?? "0.0.0.0", () => {
          console.info(`ReactiveBase server running on port ${port}`)
          resolve({ port, httpServer: httpServer! })
        })
      })
    },

    async stop() {
      if (cdcAdapter) {
        await cdcAdapter.stopBuffering()
      }
      await transport.close()
      await pool.end()
      if (httpServer) {
        await new Promise<void>((resolve) => httpServer!.close(() => resolve()))
      }
    },

    getTransport() {
      return transport
    },

    getCdcAdapter() {
      return cdcAdapter
    },
  }
}
