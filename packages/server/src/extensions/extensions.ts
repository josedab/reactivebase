/**
 * Postgres Extension Auto-Provisioner.
 *
 * Detects required extensions from schema definitions and auto-enables them.
 * Provides compatibility checks for cloud providers (RDS, Cloud SQL, Neon).
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type CloudProvider = "self_hosted" | "rds" | "cloud_sql" | "neon" | "supabase" | "alloydb" | "aurora"

export interface PgExtensionInfo {
  /** Extension name (e.g., pgvector, pg_trgm) */
  name: string
  /** Human-readable description */
  description: string
  /** SQL to enable the extension */
  enableSQL: string
  /** Minimum Postgres version required */
  minPgVersion?: number
  /** Cloud providers that support this extension */
  supportedProviders: CloudProvider[]
  /** Cloud providers that do NOT support this extension */
  unsupportedProviders: CloudProvider[]
  /** Notes or limitations per provider */
  providerNotes: Record<string, string>
  /** Whether this extension is required by schema features */
  requiredBy?: string[]
}

export interface ExtensionDetectionResult {
  /** Extensions required by the schema */
  required: PgExtensionInfo[]
  /** Extensions that are already enabled */
  enabled: string[]
  /** Extensions that need to be enabled */
  missing: string[]
  /** Extensions that are not supported on the target provider */
  unsupported: Array<{ extension: string; provider: string; reason: string }>
  /** Recommended extensions (not required but useful) */
  recommended: PgExtensionInfo[]
}

export interface ExtensionProvisionOptions {
  /** Target cloud provider */
  provider?: CloudProvider
  /** Auto-enable extensions without confirmation */
  autoEnable?: boolean
  /** Postgres version */
  pgVersion?: number
}

// ─── Known Extensions Database ───────────────────────────────────────────────

const KNOWN_EXTENSIONS: PgExtensionInfo[] = [
  {
    name: "pgvector",
    description: "Open-source vector similarity search",
    enableSQL: "CREATE EXTENSION IF NOT EXISTS vector;",
    minPgVersion: 14,
    supportedProviders: ["self_hosted", "rds", "cloud_sql", "neon", "supabase", "alloydb", "aurora"],
    unsupportedProviders: [],
    providerNotes: {
      rds: "Available in RDS for PostgreSQL 15.2+. Enable via parameter group.",
      cloud_sql: "Available as a preview feature. Enable via Cloud Console.",
      neon: "Pre-installed and available by default.",
      supabase: "Pre-installed and available by default.",
    },
  },
  {
    name: "pg_trgm",
    description: "Trigram matching for fuzzy text search",
    enableSQL: "CREATE EXTENSION IF NOT EXISTS pg_trgm;",
    supportedProviders: ["self_hosted", "rds", "cloud_sql", "neon", "supabase", "alloydb", "aurora"],
    unsupportedProviders: [],
    providerNotes: {
      rds: "Available by default in all RDS PostgreSQL versions.",
      cloud_sql: "Available by default.",
    },
  },
  {
    name: "postgis",
    description: "Geographic Information Systems (GIS) support",
    enableSQL: "CREATE EXTENSION IF NOT EXISTS postgis;",
    minPgVersion: 12,
    supportedProviders: ["self_hosted", "rds", "cloud_sql", "supabase", "alloydb", "aurora"],
    unsupportedProviders: ["neon"],
    providerNotes: {
      neon: "PostGIS is not currently supported on Neon. Use Supabase or RDS instead.",
      rds: "Available via shared library. May require parameter group change.",
    },
  },
  {
    name: "pg_cron",
    description: "Job scheduling within PostgreSQL",
    enableSQL: "CREATE EXTENSION IF NOT EXISTS pg_cron;",
    minPgVersion: 12,
    supportedProviders: ["self_hosted", "rds", "supabase", "aurora"],
    unsupportedProviders: ["cloud_sql", "neon"],
    providerNotes: {
      rds: "Available in RDS. Must be enabled in parameter group (shared_preload_libraries).",
      cloud_sql: "Not supported. Use Cloud Scheduler or external cron instead.",
      neon: "Not supported. Use external cron (e.g., pg_cron via Supabase, or GitHub Actions).",
      supabase: "Pre-installed. Enable via Supabase Dashboard > Database > Extensions.",
    },
  },
  {
    name: "pg_stat_statements",
    description: "Track execution statistics of SQL statements",
    enableSQL: "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;",
    supportedProviders: ["self_hosted", "rds", "cloud_sql", "neon", "supabase", "alloydb", "aurora"],
    unsupportedProviders: [],
    providerNotes: {
      rds: "Enabled by default in most RDS instances. Check parameter group.",
      neon: "Available but may have limited statistics retention.",
    },
  },
  {
    name: "uuid-ossp",
    description: "UUID generation functions",
    enableSQL: 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";',
    supportedProviders: ["self_hosted", "rds", "cloud_sql", "neon", "supabase", "alloydb", "aurora"],
    unsupportedProviders: [],
    providerNotes: {},
  },
  {
    name: "pgcrypto",
    description: "Cryptographic functions",
    enableSQL: "CREATE EXTENSION IF NOT EXISTS pgcrypto;",
    supportedProviders: ["self_hosted", "rds", "cloud_sql", "neon", "supabase", "alloydb", "aurora"],
    unsupportedProviders: [],
    providerNotes: {},
  },
  {
    name: "hstore",
    description: "Key-value pair data type",
    enableSQL: "CREATE EXTENSION IF NOT EXISTS hstore;",
    supportedProviders: ["self_hosted", "rds", "cloud_sql", "neon", "supabase", "alloydb", "aurora"],
    unsupportedProviders: [],
    providerNotes: {},
  },
]

// ─── Extension Detector ──────────────────────────────────────────────────────

export class ExtensionDetector {
  /**
   * Detect which extensions are needed based on schema column types.
   */
  detectFromSchema(tables: Array<{ name: string; columns: Record<string, { pgType: string; type: string }> }>): string[] {
    const needed = new Set<string>()

    for (const table of tables) {
      for (const [colName, col] of Object.entries(table.columns)) {
        // Vector columns require pgvector
        if (col.pgType.startsWith("vector") || col.type === "vector") {
          needed.add("pgvector")
        }

        // UUID columns may benefit from uuid-ossp
        if (col.pgType === "uuid") {
          needed.add("uuid-ossp")
        }

        // Encrypted fields benefit from pgcrypto
        if (col.pgType === "jsonb" && (col as Record<string, unknown>).__encrypted) {
          needed.add("pgcrypto")
        }
      }
    }

    return Array.from(needed)
  }

  /**
   * Check extension compatibility with a cloud provider.
   */
  checkCompatibility(
    extensionNames: string[],
    provider: CloudProvider,
    pgVersion?: number,
  ): ExtensionDetectionResult {
    const required: PgExtensionInfo[] = []
    const missing: string[] = []
    const unsupported: Array<{ extension: string; provider: string; reason: string }> = []
    const recommended: PgExtensionInfo[] = []

    for (const name of extensionNames) {
      const info = KNOWN_EXTENSIONS.find((e) => e.name === name)
      if (!info) {
        missing.push(name)
        continue
      }

      // Check version compatibility
      if (pgVersion && info.minPgVersion && pgVersion < info.minPgVersion) {
        unsupported.push({
          extension: name,
          provider,
          reason: `Requires PostgreSQL ${info.minPgVersion}+, but version ${pgVersion} detected`,
        })
        continue
      }

      // Check provider compatibility
      if (info.unsupportedProviders.includes(provider)) {
        unsupported.push({
          extension: name,
          provider,
          reason: info.providerNotes[provider] ?? `Not supported on ${provider}`,
        })
        continue
      }

      required.push(info)
      missing.push(name)
    }

    // Always recommend pg_stat_statements and pg_trgm
    for (const recName of ["pg_stat_statements", "pg_trgm"]) {
      if (!extensionNames.includes(recName)) {
        const info = KNOWN_EXTENSIONS.find((e) => e.name === recName)
        if (info && !info.unsupportedProviders.includes(provider)) {
          recommended.push(info)
        }
      }
    }

    return {
      required,
      enabled: [],
      missing,
      unsupported,
      recommended,
    }
  }

  /**
   * Generate SQL to enable all required extensions.
   */
  generateEnableSQL(extensionNames: string[]): string {
    const statements: string[] = []

    for (const name of extensionNames) {
      const info = KNOWN_EXTENSIONS.find((e) => e.name === name)
      if (info) {
        statements.push(info.enableSQL)
      } else {
        statements.push(`CREATE EXTENSION IF NOT EXISTS "${name}";`)
      }
    }

    return statements.join("\n")
  }

  /**
   * Get info about a known extension.
   */
  getExtensionInfo(name: string): PgExtensionInfo | undefined {
    return KNOWN_EXTENSIONS.find((e) => e.name === name)
  }

  /**
   * Get all known extensions.
   */
  getAllKnownExtensions(): PgExtensionInfo[] {
    return [...KNOWN_EXTENSIONS]
  }

  /**
   * Format detection results for CLI display.
   */
  formatForCLI(result: ExtensionDetectionResult, provider: CloudProvider): string {
    const lines: string[] = []
    lines.push("╔══════════════════════════════════════════════════╗")
    lines.push("║     Postgres Extension Auto-Provisioner          ║")
    lines.push("╚══════════════════════════════════════════════════╝")
    lines.push("")
    lines.push(`Provider: ${provider}`)
    lines.push("")

    if (result.required.length > 0) {
      lines.push("Required Extensions:")
      for (const ext of result.required) {
        lines.push(`  ✅ ${ext.name} — ${ext.description}`)
        const note = ext.providerNotes[provider]
        if (note) lines.push(`     ℹ️  ${note}`)
      }
      lines.push("")
    }

    if (result.unsupported.length > 0) {
      lines.push("⚠️  Unsupported Extensions:")
      for (const item of result.unsupported) {
        lines.push(`  ❌ ${item.extension} — ${item.reason}`)
      }
      lines.push("")
    }

    if (result.recommended.length > 0) {
      lines.push("Recommended Extensions:")
      for (const ext of result.recommended) {
        lines.push(`  💡 ${ext.name} — ${ext.description}`)
      }
      lines.push("")
    }

    if (result.missing.length > 0) {
      lines.push("Enable SQL:")
      for (const name of result.missing) {
        const info = KNOWN_EXTENSIONS.find((e) => e.name === name)
        if (info) lines.push(`  ${info.enableSQL}`)
      }
    }

    return lines.join("\n")
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createExtensionDetector(): ExtensionDetector {
  return new ExtensionDetector()
}
