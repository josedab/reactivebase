/**
 * Dev server command - starts the ReactiveBase development server
 * with hot reload and type generation.
 */

import { existsSync, watch } from "node:fs"
import { join, resolve } from "node:path"
import { writeGeneratedFiles } from "./generate.js"

export interface DevCommandOptions {
  port: number
  projectDir: string
  logLevel?: "debug" | "info" | "warn" | "error"
}

export async function devServer(options: DevCommandOptions): Promise<void> {
  const projectDir = resolve(options.projectDir)

  console.log(`Starting ReactiveBase dev server...`)
  console.log(`  Project: ${projectDir}`)
  console.log(`  Port: ${options.port}`)

  // Generate types
  console.log("\nGenerating types...")
  try {
    writeGeneratedFiles(projectDir)
  } catch (error: unknown) {
    console.warn("Type generation warning:", error instanceof Error ? error.message : error)
  }

  // Load database config from environment
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error("\n✗ DATABASE_URL environment variable is required.")
    console.error("  Set it in your .env file or environment:\n")
    console.error("  export DATABASE_URL=postgresql://user:pass@localhost:5432/mydb\n")
    process.exit(1)
  }

  // Dynamically import and start the server
  try {
    const { createReactiveBaseServer } = (await import("@reactivebase/server" as string)) as {
      createReactiveBaseServer: (config: {
        database: { connectionString: string; poolSize?: number }
        server?: { port: number; hostname?: string }
        dev?: { logLevel?: string }
      }) => Promise<{ close: () => Promise<void> }>
    }

    const server = await createReactiveBaseServer({
      database: {
        connectionString: databaseUrl,
        poolSize: 5,
      },
      server: {
        port: options.port,
        hostname: "localhost",
      },
      dev: {
        logLevel: options.logLevel ?? "info",
      },
    })

    console.log(`\n✓ ReactiveBase dev server ready`)
    console.log(`  API:       http://localhost:${options.port}`)
    console.log(`  WebSocket: ws://localhost:${options.port}/ws`)
    console.log(`  Dashboard: http://localhost:${options.port}/dashboard`)
    console.log(`  Health:    http://localhost:${options.port}/health`)
    console.log(`\nWaiting for connections...\n`)

    // Watch for schema changes and regenerate types
    const convexDir = join(projectDir, "convex")
    if (existsSync(convexDir)) {
      const watcher = watch(convexDir, { recursive: true }, (_event, filename) => {
        if (filename && (filename.endsWith(".ts") || filename.endsWith(".js"))) {
          console.log(`\n♻ File changed: ${filename}`)
          try {
            writeGeneratedFiles(projectDir)
            console.log("  Types regenerated ✓")
          } catch (error: unknown) {
            console.warn("  Type generation warning:", error instanceof Error ? error.message : error)
          }
        }
      })

      // Graceful shutdown
      const shutdown = async () => {
        console.log("\nShutting down...")
        watcher.close()
        await server.close().catch(() => {})
        process.exit(0)
      }

      process.on("SIGINT", shutdown)
      process.on("SIGTERM", shutdown)
    }

    // Keep the process alive
    await new Promise(() => {})
  } catch (error: unknown) {
    // If server can't be started (e.g. no Postgres), fall back to type-gen only mode
    console.warn("\n⚠ Could not start server:", error instanceof Error ? error.message : error)
    console.log("  Running in type-generation only mode.")
    console.log(`\n  API:       http://localhost:${options.port} (not available)`)
    console.log(`  WebSocket: ws://localhost:${options.port}/ws (not available)`)
    console.log(`\nWaiting for file changes...\n`)

    // Still watch for schema changes
    const convexDir = join(projectDir, "convex")
    if (existsSync(convexDir)) {
      watch(convexDir, { recursive: true }, (_event, filename) => {
        if (filename && (filename.endsWith(".ts") || filename.endsWith(".js"))) {
          try {
            writeGeneratedFiles(projectDir)
            console.log(`♻ Regenerated types for ${filename}`)
          } catch {
            // Silently continue
          }
        }
      })
    }

    await new Promise(() => {})
  }
}
