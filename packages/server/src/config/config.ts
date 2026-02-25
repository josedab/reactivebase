/**
 * ReactiveBase server configuration.
 */

import type { AuthProvider } from "../auth/index.js"

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

const _DEFAULT_CONFIG: Partial<ReactiveBaseConfig> = {
  server: {
    port: 4000,
    hostname: "0.0.0.0",
    heartbeatInterval: 30_000,
  },
  dev: {
    dashboardPort: 4001,
    logLevel: "info",
  },
}

export function defineConfig(config: ReactiveBaseConfig): ReactiveBaseConfig {
  return {
    ...config,
    server: {
      port: 4000,
      hostname: "0.0.0.0",
      heartbeatInterval: 30_000,
      ...config.server,
    },
    dev: {
      dashboardPort: 4001,
      logLevel: "info",
      ...config.dev,
    },
  }
}
