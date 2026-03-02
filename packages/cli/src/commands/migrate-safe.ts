/**
 * CLI command: migrate --safe
 * Analyzes migrations for safety and generates expand/contract phases.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

export interface MigrateSafeOptions {
  projectDir: string
  connectionString?: string
}

/**
 * Analyze migrations for zero-downtime safety and generate expand/contract phase templates.
 *
 * @param options - Safe migration options including project directory and optional connection string
 */
export async function migrateSafe(options: MigrateSafeOptions): Promise<void> {
  const migrationsDir = join(options.projectDir, "migrations")

  if (!existsSync(migrationsDir)) {
    console.log("No migrations/ directory found. Run `reactivebase migrate --generate` first.")
    return
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()

  if (files.length === 0) {
    console.log("No migration files found.")
    return
  }

  console.log("🔍 Analyzing migrations for zero-downtime safety...\n")

  // Import the analyzer dynamically to avoid bundling server in CLI
  const safePatterns = [
    { pattern: /CREATE\s+TABLE/i, type: "add_table" as const, safe: true },
    { pattern: /ADD\s+COLUMN/i, type: "add_column" as const, safe: true },
    { pattern: /DROP\s+COLUMN/i, type: "drop_column" as const, safe: false },
    { pattern: /DROP\s+TABLE/i, type: "drop_table" as const, safe: false },
    { pattern: /ALTER\s+COLUMN.*TYPE/i, type: "alter_column_type" as const, safe: false },
    { pattern: /SET\s+NOT\s+NULL/i, type: "add_not_null" as const, safe: false },
    { pattern: /CREATE\s+INDEX\s+CONCURRENTLY/i, type: "add_index" as const, safe: true },
    { pattern: /CREATE\s+INDEX/i, type: "add_index" as const, safe: false },
    { pattern: /RENAME\s+COLUMN/i, type: "rename_column" as const, safe: false },
  ]

  let hasUnsafe = false

  for (const file of files) {
    const content = readFileSync(join(migrationsDir, file), "utf-8")
    const detectedOps: Array<{ type: string; safe: boolean; line: string }> = []

    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (trimmed.startsWith("--") || trimmed.length === 0) continue

      for (const { pattern, type, safe } of safePatterns) {
        if (pattern.test(trimmed)) {
          detectedOps.push({ type, safe, line: trimmed })
          if (!safe) hasUnsafe = true
        }
      }
    }

    if (detectedOps.length === 0) {
      console.log(`  ✅ ${file} — No DDL operations detected`)
      continue
    }

    console.log(`  📄 ${file}:`)
    for (const op of detectedOps) {
      const icon = op.safe ? "✅" : "⚠️"
      console.log(`     ${icon} ${op.type}: ${op.line.substring(0, 80)}`)
    }
    console.log("")
  }

  if (hasUnsafe) {
    console.log("⚠️  Unsafe operations detected!")
    console.log("")
    console.log("Recommendations for zero-downtime migration:")
    console.log("  1. DROP COLUMN → Use expand/contract: stop writing first, then drop in a later release")
    console.log("  2. DROP TABLE  → Archive data first, then drop in contract phase")
    console.log("  3. ALTER TYPE  → Add new column, backfill, swap (3-phase migration)")
    console.log("  4. SET NOT NULL → Backfill NULLs first, then add constraint")
    console.log("  5. CREATE INDEX → Use CONCURRENTLY to avoid table locks")
    console.log("  6. RENAME COL  → Add new column + trigger, backfill, drop old")
    console.log("")
    console.log("Use the MigrationAnalyzer API for automated expand/contract generation:")
    console.log("  import { createMigrationAnalyzer } from '@reactivebase/server'")

    // Generate safe migration files
    const safeDir = join(migrationsDir, "safe")
    mkdirSync(safeDir, { recursive: true })

    const timestamp = Date.now()
    writeFileSync(
      join(safeDir, `${timestamp}_expand.sql`),
      "-- EXPAND PHASE: Safe operations that can run with live traffic\n-- Add new columns, create tables, add indexes concurrently\n\n",
      "utf-8",
    )
    writeFileSync(
      join(safeDir, `${timestamp}_contract.sql`),
      "-- CONTRACT PHASE: Cleanup after verification\n-- Drop old columns, remove triggers, drop deprecated tables\n-- Only run after confirming expand phase is stable\n\n",
      "utf-8",
    )

    console.log(`\nGenerated safe migration templates in migrations/safe/`)
  } else {
    console.log("✅ All migrations are safe for zero-downtime deployment!")
  }
}
