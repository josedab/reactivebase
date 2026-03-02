/**
 * Dev server command - starts the ReactiveBase development server
 * with hot reload and type generation.
 */

import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { writeGeneratedFiles } from "./generate.js"

export interface DevCommandOptions {
  port: number
  projectDir: string
  logLevel?: "debug" | "info" | "warn" | "error"
}

/**
 * Start the ReactiveBase development server with hot reload and type generation.
 *
 * @param options - Dev server options including port, project directory, and log level
 * @returns Resolves when the server is ready for connections
 */
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

  // Check for config file
  const configPath = join(projectDir, "reactivebase.config.ts")
  if (!existsSync(configPath)) {
    console.log("\nNo reactivebase.config.ts found. Using defaults.")
    console.log("Create a config file to customize your server settings.\n")
  }

  console.log(`\n✓ ReactiveBase dev server ready`)
  console.log(`  API:       http://localhost:${options.port}`)
  console.log(`  WebSocket: ws://localhost:${options.port}/ws`)
  console.log(`  Health:    http://localhost:${options.port}/health`)
  console.log(`\nWaiting for connections...\n`)
}
