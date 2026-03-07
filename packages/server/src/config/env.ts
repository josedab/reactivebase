/**
 * Lightweight `.env` file loader for ReactiveBase.
 *
 * Loads environment variables from `.env` files without external dependencies.
 * Files are loaded in priority order (later files do NOT overwrite earlier ones):
 *   1. `.env.${NODE_ENV}.local` (e.g. `.env.development.local`)
 *   2. `.env.local` (not loaded in test to keep tests deterministic)
 *   3. `.env.${NODE_ENV}` (e.g. `.env.production`)
 *   4. `.env`
 *
 * Existing `process.env` values are never overwritten.
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ENV_LINE_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/

/**
 * Parse a `.env` file string into key-value pairs.
 * Handles quoted values (single/double) and inline comments.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {}

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim()

    // Skip empty lines and comments
    if (!line || line.startsWith("#")) continue

    const match = ENV_LINE_RE.exec(line)
    if (!match) continue

    const key = match[1]
    let value = match[2]

    // Handle quoted values
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    } else {
      // Strip inline comments for unquoted values
      const commentIndex = value.indexOf(" #")
      if (commentIndex >= 0) {
        value = value.substring(0, commentIndex).trim()
      }
    }

    // Unescape common escape sequences in double-quoted values
    if (match[2].startsWith('"')) {
      value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\\\/g, "\\")
    }

    result[key] = value
  }

  return result
}

/**
 * Load a single `.env` file into `process.env`.
 * Existing env vars are not overwritten.
 *
 * @returns The number of new variables set, or -1 if file not found.
 */
export function loadEnvFile(filePath: string): number {
  let content: string
  try {
    content = readFileSync(filePath, "utf-8")
  } catch {
    return -1
  }

  const parsed = parseEnvFile(content)
  let loaded = 0

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value
      loaded++
    }
  }

  return loaded
}

export interface LoadEnvOptions {
  /** Directory to search for `.env` files. Defaults to `process.cwd()`. */
  dir?: string
  /** Override NODE_ENV for file selection. */
  nodeEnv?: string
}

/**
 * Load `.env` files in priority order.
 * Call this before `defineConfig()` to populate `process.env`.
 *
 * @returns Array of file paths that were successfully loaded.
 */
export function loadEnv(options: LoadEnvOptions = {}): string[] {
  const dir = options.dir ?? process.cwd()
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development"
  const loaded: string[] = []

  // Priority order: most specific first. Later files do NOT overwrite.
  const candidates = [
    `.env.${nodeEnv}.local`,
    // .env.local is skipped in test to keep tests deterministic
    ...(nodeEnv !== "test" ? [".env.local"] : []),
    `.env.${nodeEnv}`,
    ".env",
  ]

  for (const filename of candidates) {
    const filePath = resolve(dir, filename)
    const count = loadEnvFile(filePath)
    if (count >= 0) {
      loaded.push(filePath)
    }
  }

  return loaded
}
