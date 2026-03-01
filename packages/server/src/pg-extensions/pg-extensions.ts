/**
 * Postgres Extension Auto-Provisioner
 *
 * Detects required PostgreSQL extensions based on schema definitions and query
 * patterns. Handles provisioning with compatibility checks, version requirements,
 * and graceful fallback paths.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type ExtensionStatus = "available" | "installed" | "missing" | "incompatible" | "fallback"

export interface ExtensionRequirement {
  readonly name: string
  readonly reason: string
  readonly minVersion?: string
  readonly optional: boolean
  readonly fallbackStrategy?: string
}

export interface ExtensionInfo {
  readonly name: string
  readonly version: string
  readonly installed: boolean
  readonly available: boolean
  readonly schema?: string
}

export interface DetectionResult {
  required: ExtensionRequirement[]
  optional: ExtensionRequirement[]
  detectedPatterns: DetectedPattern[]
}

export interface DetectedPattern {
  readonly pattern: string
  readonly extension: string
  readonly source: string
  readonly confidence: "high" | "medium" | "low"
}

export interface ExtensionProvisioningResult {
  readonly extension: string
  readonly success: boolean
  readonly status: ExtensionStatus
  readonly error?: string
  readonly fallbackApplied?: string
}

export interface DoctorReport {
  readonly timestamp: Date
  readonly extensions: ExtensionCheckResult[]
  readonly overallHealthy: boolean
  readonly recommendations: string[]
}

export interface ExtensionCheckResult {
  readonly extension: string
  readonly status: ExtensionStatus
  readonly currentVersion?: string
  readonly requiredVersion?: string
  readonly message: string
}

// ── Extension Detection ──────────────────────────────────────────────────────

interface ExtensionDetector {
  extension: string
  detect(schema: SchemaInput): DetectedPattern[]
}

export interface SchemaInput {
  columns: Array<{ table: string; name: string; type: string }>
  indexes: Array<{ table: string; name: string; type?: string; columns: string[] }>
  queries?: string[]
}

const EXTENSION_DETECTORS: ExtensionDetector[] = [
  {
    extension: "pgvector",
    detect(schema) {
      const patterns: DetectedPattern[] = []
      for (const col of schema.columns) {
        if (col.type === "vector" || col.type.startsWith("vector(")) {
          patterns.push({
            pattern: `vector column: ${col.table}.${col.name}`,
            extension: "pgvector",
            source: "schema",
            confidence: "high",
          })
        }
      }
      for (const idx of schema.indexes) {
        if (idx.type === "ivfflat" || idx.type === "hnsw") {
          patterns.push({
            pattern: `vector index: ${idx.table}.${idx.name} (${idx.type})`,
            extension: "pgvector",
            source: "schema",
            confidence: "high",
          })
        }
      }
      return patterns
    },
  },
  {
    extension: "postgis",
    detect(schema) {
      const patterns: DetectedPattern[] = []
      const geoTypes = ["geometry", "geography", "point", "polygon", "linestring"]
      for (const col of schema.columns) {
        if (geoTypes.some((t) => col.type.toLowerCase().includes(t))) {
          patterns.push({
            pattern: `spatial column: ${col.table}.${col.name} (${col.type})`,
            extension: "postgis",
            source: "schema",
            confidence: "high",
          })
        }
      }
      for (const idx of schema.indexes) {
        if (idx.type === "gist" || idx.type === "spgist") {
          patterns.push({
            pattern: `spatial index: ${idx.table}.${idx.name}`,
            extension: "postgis",
            source: "schema",
            confidence: "medium",
          })
        }
      }
      return patterns
    },
  },
  {
    extension: "pg_trgm",
    detect(schema) {
      const patterns: DetectedPattern[] = []
      for (const idx of schema.indexes) {
        if (idx.type === "gin" || idx.type === "gist") {
          patterns.push({
            pattern: `trigram-compatible index: ${idx.table}.${idx.name}`,
            extension: "pg_trgm",
            source: "schema",
            confidence: "medium",
          })
        }
      }
      for (const q of schema.queries ?? []) {
        if (q.includes("similarity(") || q.includes("%>") || q.includes("ILIKE")) {
          patterns.push({
            pattern: "trigram query pattern detected",
            extension: "pg_trgm",
            source: "query",
            confidence: "medium",
          })
        }
      }
      return patterns
    },
  },
  {
    extension: "pgcrypto",
    detect(schema) {
      const patterns: DetectedPattern[] = []
      for (const col of schema.columns) {
        if (col.type === "uuid" && col.name === "id") {
          patterns.push({
            pattern: `UUID generation: ${col.table}.${col.name}`,
            extension: "pgcrypto",
            source: "schema",
            confidence: "low",
          })
        }
      }
      for (const q of schema.queries ?? []) {
        if (q.includes("gen_random_uuid()") || q.includes("crypt(") || q.includes("digest(")) {
          patterns.push({
            pattern: "crypto function usage",
            extension: "pgcrypto",
            source: "query",
            confidence: "high",
          })
        }
      }
      return patterns
    },
  },
  {
    extension: "pg_cron",
    detect(schema) {
      const patterns: DetectedPattern[] = []
      for (const q of schema.queries ?? []) {
        if (q.includes("cron.schedule") || q.includes("cron.job")) {
          patterns.push({
            pattern: "cron scheduling detected",
            extension: "pg_cron",
            source: "query",
            confidence: "high",
          })
        }
      }
      return patterns
    },
  },
]

/**
 * Detect required extensions from schema definitions and queries.
 */
export function detectExtensions(schema: SchemaInput): DetectionResult {
  const allPatterns: DetectedPattern[] = []
  const extensionMap = new Map<string, DetectedPattern[]>()

  for (const detector of EXTENSION_DETECTORS) {
    const patterns = detector.detect(schema)
    for (const p of patterns) {
      allPatterns.push(p)
      if (!extensionMap.has(detector.extension)) {
        extensionMap.set(detector.extension, [])
      }
      extensionMap.get(detector.extension)!.push(p)
    }
  }

  const required: ExtensionRequirement[] = []
  const optional: ExtensionRequirement[] = []

  for (const [ext, patterns] of extensionMap) {
    const hasHigh = patterns.some((p) => p.confidence === "high")
    const reasons = patterns.map((p) => p.pattern).join("; ")

    const req: ExtensionRequirement = {
      name: ext,
      reason: reasons,
      optional: !hasHigh,
      fallbackStrategy: getFallbackStrategy(ext),
    }

    if (hasHigh) {
      required.push(req)
    } else {
      optional.push(req)
    }
  }

  return { required, optional, detectedPatterns: allPatterns }
}

function getFallbackStrategy(extension: string): string | undefined {
  const fallbacks: Record<string, string> = {
    pgcrypto: "Use application-level UUID generation (crypto.randomUUID())",
    pg_trgm: "Use LIKE/ILIKE queries instead of trigram similarity",
    pg_cron: "Use application-level job scheduling (e.g., node-cron)",
  }
  return fallbacks[extension]
}

// ── Extension Provisioner ────────────────────────────────────────────────────

export interface ProvisionerAdapter {
  queryInstalledExtensions(): Promise<ExtensionInfo[]>
  queryAvailableExtensions(): Promise<ExtensionInfo[]>
  createExtension(name: string, schema?: string): Promise<void>
}

export class ExtensionProvisioner {
  constructor(private adapter: ProvisionerAdapter) {}

  /**
   * Check and provision all required extensions.
   */
  async provision(requirements: ExtensionRequirement[]): Promise<ExtensionProvisioningResult[]> {
    const installed = await this.adapter.queryInstalledExtensions()
    const available = await this.adapter.queryAvailableExtensions()
    const installedNames = new Set(installed.map((e) => e.name))
    const availableNames = new Set(available.map((e) => e.name))

    const results: ExtensionProvisioningResult[] = []

    for (const req of requirements) {
      // Already installed
      if (installedNames.has(req.name)) {
        const info = installed.find((e) => e.name === req.name)!
        if (req.minVersion && info.version < req.minVersion) {
          results.push({
            extension: req.name,
            success: false,
            status: "incompatible",
            error: `Installed ${info.version}, requires >= ${req.minVersion}`,
          })
        } else {
          results.push({ extension: req.name, success: true, status: "installed" })
        }
        continue
      }

      // Available but not installed
      if (availableNames.has(req.name)) {
        try {
          await this.adapter.createExtension(req.name)
          results.push({ extension: req.name, success: true, status: "installed" })
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error)
          if (req.optional && req.fallbackStrategy) {
            results.push({
              extension: req.name,
              success: true,
              status: "fallback",
              fallbackApplied: req.fallbackStrategy,
            })
          } else {
            results.push({ extension: req.name, success: false, status: "missing", error: msg })
          }
        }
        continue
      }

      // Not available
      if (req.optional && req.fallbackStrategy) {
        results.push({
          extension: req.name,
          success: true,
          status: "fallback",
          fallbackApplied: req.fallbackStrategy,
        })
      } else {
        results.push({
          extension: req.name,
          success: false,
          status: "missing",
          error: `Extension "${req.name}" is not available on this PostgreSQL instance`,
        })
      }
    }

    return results
  }

  /**
   * Run a health check on all required extensions.
   */
  async runDoctorCheck(requirements: ExtensionRequirement[]): Promise<DoctorReport> {
    const installed = await this.adapter.queryInstalledExtensions()
    const installedMap = new Map(installed.map((e) => [e.name, e]))

    const checks: ExtensionCheckResult[] = []
    const recommendations: string[] = []
    let healthy = true

    for (const req of requirements) {
      const ext = installedMap.get(req.name)

      if (ext?.installed) {
        if (req.minVersion && ext.version < req.minVersion) {
          checks.push({
            extension: req.name,
            status: "incompatible",
            currentVersion: ext.version,
            requiredVersion: req.minVersion,
            message: `Version ${ext.version} installed, but >= ${req.minVersion} required`,
          })
          healthy = false
          recommendations.push(`Upgrade ${req.name} to >= ${req.minVersion}`)
        } else {
          checks.push({
            extension: req.name,
            status: "installed",
            currentVersion: ext.version,
            message: `✅ ${req.name} ${ext.version} installed`,
          })
        }
      } else if (req.optional) {
        checks.push({
          extension: req.name,
          status: "missing",
          message: `⚠️  ${req.name} not installed (optional, fallback available)`,
        })
        if (req.fallbackStrategy) {
          recommendations.push(`Optional: Install ${req.name} for better performance. Fallback: ${req.fallbackStrategy}`)
        }
      } else {
        checks.push({
          extension: req.name,
          status: "missing",
          message: `❌ ${req.name} required but not installed`,
        })
        healthy = false
        recommendations.push(`Install ${req.name}: CREATE EXTENSION IF NOT EXISTS ${req.name};`)
      }
    }

    return { timestamp: new Date(), extensions: checks, overallHealthy: healthy, recommendations }
  }
}
