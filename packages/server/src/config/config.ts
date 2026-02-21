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
  }
  dev?: {
    dashboardPort?: number
    logLevel?: "debug" | "info" | "warn" | "error"
  }
}

const DEFAULT_CONFIG: Partial<ReactiveBaseConfig> = {
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
