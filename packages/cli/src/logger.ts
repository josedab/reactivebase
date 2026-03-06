/**
 * Structured CLI logger.
 * Provides leveled logging for CLI commands, respecting --quiet and --verbose flags.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent"

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
}

export interface CliLogger {
  debug(msg: string, data?: Record<string, unknown>): void
  info(msg: string, data?: Record<string, unknown>): void
  warn(msg: string, data?: Record<string, unknown>): void
  error(msg: string, data?: Record<string, unknown>): void
}

export function createCliLogger(options: { level?: LogLevel; json?: boolean } = {}): CliLogger {
  const minLevel = LEVEL_PRIORITY[options.level ?? "info"]
  const useJson = options.json ?? false

  function log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < minLevel) return

    if (useJson) {
      const entry = { level, msg, timestamp: new Date().toISOString(), ...data }
      console.log(JSON.stringify(entry))
      return
    }

    const dataStr = data && Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : ""
    switch (level) {
      case "debug":
        console.debug(msg + dataStr)
        break
      case "warn":
        console.warn(msg + dataStr)
        break
      case "error":
        console.error(msg + dataStr)
        break
      default:
        console.log(msg + dataStr)
    }
  }

  return {
    debug: (msg, data) => log("debug", msg, data),
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (msg, data) => log("error", msg, data),
  }
}

/** Resolve log level from environment and CLI flags */
export function resolveLogLevel(): LogLevel {
  if (process.env.LOG_LEVEL === "debug") return "debug"
  if (process.env.LOG_LEVEL === "silent") return "silent"
  return "info"
}

/** Shared CLI logger instance */
export const cliLogger = createCliLogger({ level: resolveLogLevel() })
