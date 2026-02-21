/**
 * ReactiveBase Server - the main entry point for creating a reactive backend.
 * Combines all subsystems: schema, functions, reactivity, transport, auth.
 */

import { createServer, type Server as HttpServer } from "node:http"
import { Pool } from "pg"
import type { Schema } from "./schema/index.js"
import type { RegisteredFunction } from "./functions/index.js"
import type { ReactiveBaseConfig } from "./config/index.js"
import { TransportServer } from "./transport/index.js"

export interface ReactiveBaseServer {
  /** Register server functions (queries, mutations, actions) */
  registerFunctions(functions: Record<string, RegisteredFunction>): void
  /** Start the server */
  start(): Promise<{ port: number; httpServer: HttpServer }>
  /** Stop the server */
  stop(): Promise<void>
  /** Get the transport server for testing */
  getTransport(): TransportServer
}

export function createReactiveBaseServer(
  schema: Schema,
  config: ReactiveBaseConfig,
): ReactiveBaseServer {
  const pool = new Pool({
    connectionString: config.database.connectionString,
    max: config.database.poolSize ?? 20,
  })

  const transport = new TransportServer(pool, schema, {
    heartbeatInterval: config.server?.heartbeatInterval ?? 30_000,
  })

  // Register auth providers
  if (config.auth?.providers) {
    for (const provider of config.auth.providers) {
      transport.addAuthProvider(provider)
    }
  }

  let httpServer: HttpServer | null = null

  return {
    registerFunctions(functions: Record<string, RegisteredFunction>) {
      for (const [name, fn] of Object.entries(functions)) {
        transport.registerFunction(name, fn)
      }
    },

    async start() {
      const port = config.server?.port ?? 4000

      httpServer = createServer((_req, res) => {
        // Health check endpoint
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({
          status: "ok",
          connections: transport.connectionCount,
          subscriptions: transport.subscriptionCount,
        }))
      })

      transport.attach(httpServer)

      return new Promise((resolve) => {
        httpServer!.listen(port, config.server?.hostname ?? "0.0.0.0", () => {
          console.log(`ReactiveBase server running on port ${port}`)
          resolve({ port, httpServer: httpServer! })
        })
      })
    },

    async stop() {
      await transport.close()
      await pool.end()
      if (httpServer) {
        await new Promise<void>((resolve) => httpServer!.close(() => resolve()))
      }
    },

    getTransport() {
      return transport
    },
  }
}
