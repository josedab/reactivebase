/**
 * Structured Logging Abstraction for ReactiveBase.
 *
 * Provides structured JSON logging with log levels and request-scoped
 * correlation IDs for production observability. Drop-in replacement for
 * console.* calls with zero external dependencies.
 *
 * Usage:
 *   import { createLogger } from "./logging/index.js"
 *
 *   const logger = createLogger({ name: "server", level: "info" })
 *   logger.info("Server started", { port: 4000 })
 *   logger.error("Query failed", { query: "tasks.list", error: err.message })
 *
 *   // With correlation ID for request tracing
 *   const reqLogger = logger.child({ correlationId: "req-abc-123" })
 *   reqLogger.info("Handling request", { path: "/query" })
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent"

export interface LogEntry {
  level: LogLevel
  msg: string
  name?: string
  timestamp: string
  correlationId?: string
  [key: string]: unknown
}

export interface LoggerOptions {
  /** Logger name, typically the module name */
  name?: string
  /** Minimum log level (default: "info") */
  level?: LogLevel
  /** Output as JSON (default: true in production, false otherwise) */
  json?: boolean
  /** Custom output function (default: console methods) */
  output?: (entry: LogEntry) => void
  /** Base context fields included in every log entry */
  context?: Record<string, unknown>
}

export interface Logger {
  trace(msg: string, data?: Record<string, unknown>): void
  debug(msg: string, data?: Record<string, unknown>): void
  info(msg: string, data?: Record<string, unknown>): void
  warn(msg: string, data?: Record<string, unknown>): void
  error(msg: string, data?: Record<string, unknown>): void
  fatal(msg: string, data?: Record<string, unknown>): void
  /** Create a child logger with additional context fields */
  child(context: Record<string, unknown>): Logger
}

// ─── Level Priority ──────────────────────────────────────────────────────────

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 100,
}

const LEVEL_CONSOLE_METHOD: Record<LogLevel, keyof Console> = {
  trace: "debug",
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
  fatal: "error",
  silent: "log",
}

// ─── Logger Implementation ───────────────────────────────────────────────────

class StructuredLogger implements Logger {
  private readonly name?: string
  private readonly minLevel: number
  private readonly useJson: boolean
  private readonly outputFn?: (entry: LogEntry) => void
  private readonly context: Record<string, unknown>

  constructor(options: LoggerOptions = {}) {
    this.name = options.name
    this.minLevel = LEVEL_PRIORITY[options.level ?? "info"]
    this.useJson = options.json ?? process.env.NODE_ENV === "production"
    this.outputFn = options.output
    this.context = options.context ?? {}
  }

  trace(msg: string, data?: Record<string, unknown>): void {
    this.log("trace", msg, data)
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.log("debug", msg, data)
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.log("info", msg, data)
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.log("warn", msg, data)
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.log("error", msg, data)
  }

  fatal(msg: string, data?: Record<string, unknown>): void {
    this.log("fatal", msg, data)
  }

  child(context: Record<string, unknown>): Logger {
    return new StructuredLogger({
      name: this.name,
      level: this.levelFromPriority(this.minLevel),
      json: this.useJson,
      output: this.outputFn,
      context: { ...this.context, ...context },
    })
  }

  private log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < this.minLevel) return

    const entry: LogEntry = {
      level,
      msg,
      timestamp: new Date().toISOString(),
      ...(this.name && { name: this.name }),
      ...this.context,
      ...data,
    }

    if (this.outputFn) {
      this.outputFn(entry)
      return
    }

    const method = LEVEL_CONSOLE_METHOD[level]
    // eslint-disable-next-line no-console
    const consoleFn = console[method] as (...args: unknown[]) => void

    if (this.useJson) {
      consoleFn(JSON.stringify(entry))
    } else {
      const prefix = this.name ? `[${this.name}]` : ""
      const contextStr = Object.keys(this.context).length > 0 ? ` ${JSON.stringify(this.context)}` : ""
      const dataStr = data ? ` ${JSON.stringify(data)}` : ""
      consoleFn(`${level.toUpperCase()} ${prefix} ${msg}${contextStr}${dataStr}`)
    }
  }

  private levelFromPriority(priority: number): LogLevel {
    for (const [level, p] of Object.entries(LEVEL_PRIORITY)) {
      if (p === priority) return level as LogLevel
    }
    return "info"
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a structured logger instance.
 *
 * In production (NODE_ENV=production), outputs JSON to stdout.
 * In development, outputs human-readable format.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  return new StructuredLogger(options)
}

/** Default server-wide logger */
export const serverLogger = createLogger({ name: "reactivebase" })
