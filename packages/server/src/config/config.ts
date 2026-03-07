/**
 * ReactiveBase server configuration.
 * Provides config definition, validation, and environment variable resolution.
 */

import type { AuthProvider } from "../auth/index.js"
import { ReactiveBaseError } from "../errors.js"

export interface ReactiveBaseConfig {
  database: {
    connectionString: string
    poolSize?: number
  }
  redis?: {
    url: string
  }
  auth?: {
    providers: AuthProvider[]
  }
  server?: {
    port: number
    hostname?: string
    heartbeatInterval?: number
    /** Allowed CORS origin(s). Set to '*' for any origin, or a specific origin string. Default: undefined (no CORS headers). */
    corsOrigin?: string
    /** Token required to access /dashboard, /dashboard/schema.json, /metrics. If not set, these endpoints are disabled in production (NODE_ENV=production). */
    dashboardToken?: string
    /** Graceful shutdown timeout in ms (default: 10000). */
    shutdownTimeoutMs?: number
  }
  /** Change Data Capture mode for reactivity invalidation */
  cdc?: {
    /** CDC mode: "listen-notify" (default) or "logical-replication" (WAL streaming) */
    mode?: "listen-notify" | "logical-replication"
    /** Tables to track (default: all schema tables) */
    tables?: string[]
    /** Batch size for WAL event processing (default: 100) */
    batchSize?: number
    /** Batch flush interval in ms (default: 10) */
    flushIntervalMs?: number
  }
  dev?: {
    dashboardPort?: number
    logLevel?: "debug" | "info" | "warn" | "error"
  }
}

export class ConfigValidationError extends ReactiveBaseError {
  constructor(
    message: string,
    public readonly issues: ConfigIssue[],
  ) {
    super(message, "CONFIG_VALIDATION_ERROR")
    this.name = "ConfigValidationError"
  }
}

export interface ConfigIssue {
  path: string
  message: string
  severity: "error" | "warning"
}

const ENV_VAR_RE = /\$\{([^}]+)\}|\$([A-Z_][A-Z0-9_]*)/g

/**
 * Resolve `$VAR` and `${VAR}` references in a string using `process.env`.
 * Returns the original string if no env vars are found.
 * Throws if a referenced variable is not set.
 */
export function resolveEnvVars(value: string): string {
  return value.replace(ENV_VAR_RE, (_match, braced: string | undefined, bare: string | undefined) => {
    const varName = braced ?? bare!
    const envValue = process.env[varName]
    if (envValue === undefined) {
      throw new ConfigValidationError(`Environment variable "${varName}" is not set`, [
        { path: varName, message: `Environment variable "${varName}" is not set`, severity: "error" },
      ])
    }
    return envValue
  })
}

/**
 * Recursively resolve environment variables in all string values of an object.
 */
function resolveEnvInObject<T>(obj: T): T {
  if (typeof obj === "string") {
    return resolveEnvVars(obj) as T
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvInObject(item)) as T
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvInObject(value)
    }
    return result as T
  }
  return obj
}

/**
 * Validate a ReactiveBase config and return any issues found.
 */
export function validateConfig(config: ReactiveBaseConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = []

  if (!config.database) {
    issues.push({ path: "database", message: "database configuration is required", severity: "error" })
  } else if (!config.database.connectionString) {
    issues.push({
      path: "database.connectionString",
      message: "database.connectionString is required — set it directly or use $DATABASE_URL",
      severity: "error",
    })
  } else if (typeof config.database.connectionString !== "string") {
    issues.push({
      path: "database.connectionString",
      message: "database.connectionString must be a string",
      severity: "error",
    })
  }

  if (config.database?.poolSize !== undefined) {
    if (!Number.isInteger(config.database.poolSize) || config.database.poolSize < 1) {
      issues.push({
        path: "database.poolSize",
        message: "database.poolSize must be a positive integer",
        severity: "error",
      })
    }
  }

  if (config.server?.port !== undefined) {
    if (!Number.isInteger(config.server.port) || config.server.port < 1 || config.server.port > 65535) {
      issues.push({
        path: "server.port",
        message: "server.port must be an integer between 1 and 65535",
        severity: "error",
      })
    }
  }

  if (config.server?.heartbeatInterval !== undefined) {
    if (!Number.isFinite(config.server.heartbeatInterval) || config.server.heartbeatInterval < 1000) {
      issues.push({
        path: "server.heartbeatInterval",
        message: "server.heartbeatInterval must be at least 1000ms",
        severity: "warning",
      })
    }
  }

  if (config.server?.shutdownTimeoutMs !== undefined) {
    if (!Number.isFinite(config.server.shutdownTimeoutMs) || config.server.shutdownTimeoutMs < 0) {
      issues.push({
        path: "server.shutdownTimeoutMs",
        message: "server.shutdownTimeoutMs must be a non-negative number",
        severity: "error",
      })
    }
  }

  if (config.cdc?.mode !== undefined) {
    if (!["listen-notify", "logical-replication"].includes(config.cdc.mode)) {
      issues.push({
        path: "cdc.mode",
        message: 'cdc.mode must be "listen-notify" or "logical-replication"',
        severity: "error",
      })
    }
  }

  if (config.dev?.logLevel !== undefined) {
    if (!["debug", "info", "warn", "error"].includes(config.dev.logLevel)) {
      issues.push({
        path: "dev.logLevel",
        message: 'dev.logLevel must be "debug", "info", "warn", or "error"',
        severity: "error",
      })
    }
  }

  // Production warnings
  const isProduction = process.env.NODE_ENV === "production"
  if (isProduction) {
    if (config.server?.corsOrigin === "*") {
      issues.push({
        path: "server.corsOrigin",
        message: 'corsOrigin is set to "*" in production — consider restricting to specific origins',
        severity: "warning",
      })
    }
    if (!config.server?.dashboardToken) {
      issues.push({
        path: "server.dashboardToken",
        message: "dashboardToken is not set — dashboard/metrics endpoints will be disabled in production",
        severity: "warning",
      })
    }
  }

  return issues
}

/**
 * Define a ReactiveBase server configuration with sensible defaults.
 * Resolves `$ENV_VAR` / `${ENV_VAR}` references in string values and validates the result.
 *
 * @param config - The server configuration options
 * @returns A fully merged configuration with defaults applied
 * @throws {ConfigValidationError} if required fields are missing or invalid
 */
export function defineConfig(config: ReactiveBaseConfig): ReactiveBaseConfig {
  // Resolve environment variables in all string values
  const resolved = resolveEnvInObject(config)

  // Merge defaults
  const merged: ReactiveBaseConfig = {
    ...resolved,
    server: {
      port: 4000,
      hostname: "0.0.0.0",
      heartbeatInterval: 30_000,
      shutdownTimeoutMs: 10_000,
      ...resolved.server,
    },
    dev: {
      dashboardPort: 4001,
      logLevel: "info",
      ...resolved.dev,
    },
  }

  // Validate
  const issues = validateConfig(merged)
  const errors = issues.filter((i) => i.severity === "error")
  if (errors.length > 0) {
    const summary = errors.map((e) => `  • ${e.path}: ${e.message}`).join("\n")
    throw new ConfigValidationError(`ReactiveBase configuration is invalid:\n${summary}`, issues)
  }

  return merged
}
