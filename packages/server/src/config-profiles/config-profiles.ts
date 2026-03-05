/**
 * Portable Configuration Profiles
 *
 * Shareable, composable configuration profiles that bundle optimal settings
 * for different deployment scenarios. Support config inheritance with deep
 * merging and validation.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type ProfileName = "saas" | "edge" | "collaborative" | "analytics" | "minimal"

export interface ConfigProfile {
  readonly name: string
  readonly description: string
  readonly extends?: string
  readonly config: ProfileConfig
}

export interface ProfileConfig {
  database?: {
    poolSize?: number
    statementTimeout?: number
    idleTimeout?: number
  }
  server?: {
    port?: number
    corsOrigin?: string
    heartbeatInterval?: number
    maxConnectionsPerIp?: number
    maxSubscriptionsPerConnection?: number
  }
  auth?: {
    provider?: string
    tokenExpiration?: number
    refreshEnabled?: boolean
  }
  cdc?: {
    mode?: "listen-notify" | "logical-replication"
    batchSize?: number
    flushIntervalMs?: number
  }
  cache?: {
    enabled?: boolean
    ttlMs?: number
    maxEntries?: number
  }
  tenancy?: {
    mode?: "shared" | "schema" | "database"
    isolation?: "row" | "schema" | "full"
  }
  scaling?: {
    readReplicas?: boolean
    horizontalSharding?: boolean
    maxWorkers?: number
  }
  deployment?: {
    target?: "standalone" | "docker" | "kubernetes" | "serverless"
    healthCheck?: boolean
    gracefulShutdownMs?: number
  }
}

export interface ProfileValidationResult {
  valid: boolean
  errors: ProfileValidationError[]
  warnings: string[]
}

export interface ProfileValidationError {
  path: string
  message: string
}

// ── Built-in Profiles ────────────────────────────────────────────────────────

const BUILT_IN_PROFILES: Record<ProfileName, ConfigProfile> = {
  minimal: {
    name: "minimal",
    description: "Minimal configuration for development and prototyping",
    config: {
      database: { poolSize: 5, statementTimeout: 30_000, idleTimeout: 10_000 },
      server: { port: 4000, maxConnectionsPerIp: 10, maxSubscriptionsPerConnection: 50 },
      cdc: { mode: "listen-notify", batchSize: 50 },
      cache: { enabled: false },
      deployment: { target: "standalone", healthCheck: false },
    },
  },
  saas: {
    name: "saas",
    description: "Multi-tenant SaaS with row-level isolation, connection pooling, auth",
    extends: "minimal",
    config: {
      database: { poolSize: 20, statementTimeout: 10_000, idleTimeout: 30_000 },
      server: {
        corsOrigin: undefined, // Must be explicitly configured (e.g., 'https://your-app.example.com')
        heartbeatInterval: 30_000,
        maxConnectionsPerIp: 50,
        maxSubscriptionsPerConnection: 200,
      },
      auth: { provider: "jwt", tokenExpiration: 3600, refreshEnabled: true },
      cdc: { mode: "logical-replication", batchSize: 100, flushIntervalMs: 10 },
      cache: { enabled: true, ttlMs: 60_000, maxEntries: 10_000 },
      tenancy: { mode: "shared", isolation: "row" },
      scaling: { readReplicas: true, horizontalSharding: false, maxWorkers: 4 },
      deployment: { target: "docker", healthCheck: true, gracefulShutdownMs: 30_000 },
    },
  },
  edge: {
    name: "edge",
    description: "Edge deployment optimized for low-latency with aggressive caching",
    extends: "minimal",
    config: {
      database: { poolSize: 10, statementTimeout: 5_000 },
      server: { heartbeatInterval: 15_000, maxSubscriptionsPerConnection: 100 },
      cdc: { mode: "listen-notify", batchSize: 25, flushIntervalMs: 5 },
      cache: { enabled: true, ttlMs: 30_000, maxEntries: 5_000 },
      scaling: { readReplicas: true },
      deployment: { target: "serverless", healthCheck: true, gracefulShutdownMs: 5_000 },
    },
  },
  collaborative: {
    name: "collaborative",
    description: "Real-time collaboration with high subscription limits and CRDT support",
    extends: "minimal",
    config: {
      database: { poolSize: 30, statementTimeout: 15_000 },
      server: {
        heartbeatInterval: 10_000,
        maxConnectionsPerIp: 100,
        maxSubscriptionsPerConnection: 500,
      },
      cdc: { mode: "logical-replication", batchSize: 200, flushIntervalMs: 5 },
      cache: { enabled: true, ttlMs: 10_000, maxEntries: 20_000 },
      scaling: { readReplicas: true, maxWorkers: 8 },
      deployment: { target: "kubernetes", healthCheck: true, gracefulShutdownMs: 60_000 },
    },
  },
  analytics: {
    name: "analytics",
    description: "Optimized for read-heavy analytics workloads with large result sets",
    extends: "minimal",
    config: {
      database: { poolSize: 15, statementTimeout: 60_000, idleTimeout: 60_000 },
      server: { maxSubscriptionsPerConnection: 100 },
      cdc: { mode: "listen-notify", batchSize: 500 },
      cache: { enabled: true, ttlMs: 300_000, maxEntries: 50_000 },
      scaling: { readReplicas: true, maxWorkers: 4 },
      deployment: { target: "docker", healthCheck: true, gracefulShutdownMs: 30_000 },
    },
  },
}

// ── Profile Engine ───────────────────────────────────────────────────────────

export class ProfileEngine {
  private customProfiles = new Map<string, ConfigProfile>()

  /**
   * Get a built-in profile by name.
   */
  getProfile(name: string): ConfigProfile | undefined {
    return BUILT_IN_PROFILES[name as ProfileName] ?? this.customProfiles.get(name)
  }

  /**
   * Register a custom profile.
   */
  registerProfile(profile: ConfigProfile): void {
    this.customProfiles.set(profile.name, profile)
  }

  /**
   * Resolve a profile including inherited configs.
   */
  resolveProfile(name: string): ProfileConfig {
    const profile = this.getProfile(name)
    if (!profile) throw new Error(`Unknown profile: "${name}"`)

    if (profile.extends) {
      const parent = this.resolveProfile(profile.extends)
      return deepMerge(parent, profile.config)
    }

    return { ...profile.config }
  }

  /**
   * Merge multiple profiles in order (later overrides earlier).
   */
  mergeProfiles(...names: string[]): ProfileConfig {
    let result: ProfileConfig = {}

    for (const name of names) {
      const resolved = this.resolveProfile(name)
      result = deepMerge(result, resolved)
    }

    return result
  }

  /**
   * Apply overrides on top of a profile.
   */
  applyOverrides(profileName: string, overrides: Partial<ProfileConfig>): ProfileConfig {
    const base = this.resolveProfile(profileName)
    return deepMerge(base, overrides as ProfileConfig)
  }

  /**
   * List all available profiles.
   */
  listProfiles(): Array<{ name: string; description: string; builtin: boolean }> {
    const profiles: Array<{ name: string; description: string; builtin: boolean }> = []

    for (const [name, profile] of Object.entries(BUILT_IN_PROFILES)) {
      profiles.push({ name, description: profile.description, builtin: true })
    }
    for (const [name, profile] of this.customProfiles) {
      profiles.push({ name, description: profile.description, builtin: false })
    }

    return profiles
  }

  /**
   * Validate a profile configuration.
   */
  validateProfile(config: ProfileConfig): ProfileValidationResult {
    const errors: ProfileValidationError[] = []
    const warnings: string[] = []

    if (config.database?.poolSize !== undefined) {
      if (config.database.poolSize < 1) {
        errors.push({ path: "database.poolSize", message: "Pool size must be at least 1" })
      }
      if (config.database.poolSize > 100) {
        warnings.push("database.poolSize > 100 may cause resource exhaustion")
      }
    }

    if (config.server?.port !== undefined) {
      if (config.server.port < 1 || config.server.port > 65535) {
        errors.push({ path: "server.port", message: "Port must be between 1 and 65535" })
      }
    }

    if (config.server?.maxConnectionsPerIp !== undefined && config.server.maxConnectionsPerIp < 1) {
      errors.push({ path: "server.maxConnectionsPerIp", message: "Must be at least 1" })
    }

    if (config.cache?.ttlMs !== undefined && config.cache.ttlMs < 0) {
      errors.push({ path: "cache.ttlMs", message: "TTL cannot be negative" })
    }

    if (config.deployment?.gracefulShutdownMs !== undefined && config.deployment.gracefulShutdownMs < 0) {
      errors.push({ path: "deployment.gracefulShutdownMs", message: "Cannot be negative" })
    }

    if (config.tenancy?.mode === "database" && config.scaling?.horizontalSharding) {
      warnings.push("Database-level tenancy with horizontal sharding may cause complexity")
    }

    return { valid: errors.length === 0, errors, warnings }
  }
}

// ── Deep Merge Utility ───────────────────────────────────────────────────────

function deepMerge<T extends object>(base: T, override: T): T {
  const result = { ...base } as Record<string, unknown>

  for (const key of Object.keys(override)) {
    const baseVal = result[key]
    const overrideVal = (override as Record<string, unknown>)[key]

    if (
      baseVal !== null &&
      overrideVal !== null &&
      typeof baseVal === "object" &&
      typeof overrideVal === "object" &&
      !Array.isArray(baseVal) &&
      !Array.isArray(overrideVal)
    ) {
      result[key] = deepMerge(baseVal as Record<string, unknown>, overrideVal as Record<string, unknown>)
    } else if (overrideVal !== undefined) {
      result[key] = overrideVal
    }
  }

  return result as T
}

export { deepMerge }
