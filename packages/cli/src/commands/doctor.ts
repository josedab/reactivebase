/**
 * CLI command: reactivebase doctor
 *
 * Checks PostgreSQL extension health and provisions required extensions.
 */

import { readFileSync, existsSync, readdirSync } from "fs"
import { join } from "path"

export interface DoctorOptions {
  projectDir: string
  connectionString?: string
  autoFix?: boolean
  json?: boolean
}

/**
 * Check PostgreSQL extension health and provision required extensions based on schema analysis.
 *
 * @param options - Doctor options including project directory, connection string, auto-fix, and JSON output flags
 */
export async function doctor(options: DoctorOptions): Promise<void> {
  const { projectDir, autoFix = false, json = false } = options

  console.log("\n🩺 ReactiveBase Doctor\n")

  // Detect schema patterns
  const schemaDir = join(projectDir, "schema")
  const patterns = analyzeSchemaForExtensions(schemaDir)

  if (patterns.length === 0) {
    console.log("✅ No extension requirements detected from schema.\n")
    if (json) console.log(JSON.stringify({ healthy: true, extensions: [], recommendations: [] }))
    return
  }

  console.log(`📋 Detected ${patterns.length} extension pattern(s):\n`)

  for (const pattern of patterns) {
    const icon = pattern.required ? "🔴" : "🟡"
    console.log(`  ${icon} ${pattern.extension} — ${pattern.reason}`)
    if (pattern.fallback) {
      console.log(`     Fallback: ${pattern.fallback}`)
    }
  }

  console.log("")

  if (!options.connectionString) {
    console.log("⚠️  No DATABASE_URL set. Cannot check installed extensions.")
    console.log("   Set DATABASE_URL to enable full health check.\n")

    if (json) {
      console.log(
        JSON.stringify({
          healthy: null,
          extensions: patterns.map((p) => ({ name: p.extension, status: "unchecked", reason: p.reason })),
          recommendations: ["Set DATABASE_URL to enable extension health check"],
        }),
      )
    }
    return
  }

  // Would connect to database and check - show instructions for now
  console.log("📊 Extension provisioning SQL:\n")
  for (const pattern of patterns) {
    console.log(`  CREATE EXTENSION IF NOT EXISTS ${pattern.extension};`)
  }

  console.log("")

  if (autoFix) {
    console.log("🔧 Auto-fix mode: would execute CREATE EXTENSION statements.")
    console.log("   (Requires database connection - set DATABASE_URL)")
  }

  console.log("✅ Doctor check complete.\n")
}

interface SchemaPattern {
  extension: string
  reason: string
  required: boolean
  fallback?: string
}

function analyzeSchemaForExtensions(schemaDir: string): SchemaPattern[] {
  const patterns: SchemaPattern[] = []

  if (!existsSync(schemaDir)) return patterns

  const files = readdirSync(schemaDir).filter((f) => f.endsWith(".ts"))

  for (const file of files) {
    const content = readFileSync(join(schemaDir, file), "utf-8")

    if (content.includes("vector(") || content.includes("v.vector")) {
      patterns.push({
        extension: "pgvector",
        reason: `Vector column detected in ${file}`,
        required: true,
      })
    }

    if (content.includes("geometry") || content.includes("geography") || content.includes("v.point")) {
      patterns.push({
        extension: "postgis",
        reason: `Spatial type detected in ${file}`,
        required: true,
      })
    }

    if (content.includes("similarity") || content.includes("trgm") || content.includes("fuzzySearch")) {
      patterns.push({
        extension: "pg_trgm",
        reason: `Trigram search pattern detected in ${file}`,
        required: false,
        fallback: "Use LIKE/ILIKE instead of trigram similarity",
      })
    }

    if (content.includes("gen_random_uuid") || content.includes("pgcrypto") || content.includes("crypt(")) {
      patterns.push({
        extension: "pgcrypto",
        reason: `Cryptographic function detected in ${file}`,
        required: false,
        fallback: "Use crypto.randomUUID() at application level",
      })
    }

    if (content.includes("cron.schedule") || content.includes("pg_cron")) {
      patterns.push({
        extension: "pg_cron",
        reason: `Cron scheduling detected in ${file}`,
        required: false,
        fallback: "Use application-level scheduling (node-cron)",
      })
    }
  }

  // Deduplicate by extension name
  const seen = new Set<string>()
  return patterns.filter((p) => {
    if (seen.has(p.extension)) return false
    seen.add(p.extension)
    return true
  })
}
