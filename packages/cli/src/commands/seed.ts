/**
 * CLI commands: seed, seed:reset, seed:status
 */

import { existsSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

export interface SeedCommandOptions {
  projectDir: string
  profile?: string
  environment?: string
  connectionString?: string
}

export async function seedRun(options: SeedCommandOptions): Promise<void> {
  const seedsDir = join(resolve(options.projectDir), "seeds")

  if (!existsSync(seedsDir)) {
    console.log("No seeds/ directory found. Create .seed.ts files to define seed data.")
    console.log("")
    console.log("Example seeds/users.seed.ts:")
    console.log('  import { defineSeed } from "@reactivebase/server"')
    console.log("")
    console.log("  export default defineSeed('users', {")
    console.log("    environments: ['dev', 'test'],")
    console.log("    generate: (ctx) => [")
    console.log("      { table: 'users', data: { name: 'Alice', email: 'alice@test.com' } },")
    console.log("    ]")
    console.log("  })")
    return
  }

  const files = readdirSync(seedsDir).filter((f) => f.endsWith(".seed.ts") || f.endsWith(".seed.js"))

  if (files.length === 0) {
    console.log("No .seed.ts or .seed.js files found in seeds/")
    return
  }

  const env = options.environment ?? "dev"
  const profile = options.profile
  const connectionString = options.connectionString ?? process.env.DATABASE_URL

  if (!connectionString) {
    console.error("Error: DATABASE_URL environment variable is required to run seeds.")
    process.exit(1)
  }

  console.log(`🌱 Running seeds for environment: ${env}`)
  if (profile) console.log(`   Profile: ${profile}`)
  console.log(`   Found ${files.length} seed file(s)\n`)

  let totalRecords = 0
  let succeeded = 0
  let failed = 0

  for (const file of files) {
    const filePath = join(seedsDir, file)
    const seedName = file.replace(/\.seed\.(ts|js)$/, "")

    try {
      console.log(`  ▸ ${seedName}...`)

      // Dynamic import of seed file
      const fileUrl = pathToFileURL(filePath).href
      const mod = (await import(fileUrl)) as {
        default?: {
          name: string
          environments?: string[]
          generate: (ctx: SeedContext) => Array<{ table: string; data: Record<string, unknown> }>
        }
      }

      const seed = mod.default
      if (!seed || typeof seed.generate !== "function") {
        console.log(`    ⚠ Skipped: no default export with generate() function`)
        failed++
        continue
      }

      // Check environment filter
      if (seed.environments && !seed.environments.includes(env)) {
        console.log(`    ⚠ Skipped: not configured for environment "${env}"`)
        continue
      }

      // Generate seed data
      const ctx = createSeedContext()
      const records = seed.generate(ctx)

      if (!records || records.length === 0) {
        console.log(`    ⚠ No records generated`)
        continue
      }

      // Execute against database
      const { default: pg } = (await import("pg" as string)) as {
        default: { Pool: new (config: { connectionString: string }) => PgPool }
      }
      const pool = new pg.Pool({ connectionString })

      try {
        for (const record of records) {
          const columns = Object.keys(record.data)
          const values = Object.values(record.data)
          const placeholders = columns.map((_, i) => `$${i + 1}`)

          await pool.query(
            `INSERT INTO "${record.table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders.join(", ")})`,
            values,
          )
          totalRecords++
        }
        console.log(`    ✓ ${records.length} record(s) inserted`)
        succeeded++
      } finally {
        await pool.end()
      }
    } catch (error: unknown) {
      console.log(`    ✗ Failed: ${error instanceof Error ? error.message : error}`)
      failed++
    }
  }

  console.log(`\n🌱 Seeding complete: ${succeeded} succeeded, ${failed} failed, ${totalRecords} total records`)
}

export async function seedReset(options: SeedCommandOptions): Promise<void> {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL

  if (!connectionString) {
    console.error("Error: DATABASE_URL environment variable is required.")
    process.exit(1)
  }

  const seedsDir = join(resolve(options.projectDir), "seeds")
  if (!existsSync(seedsDir)) {
    console.log("No seeds/ directory found.")
    return
  }

  console.log("🗑️  Resetting seed data...")

  try {
    const { default: pg } = (await import("pg" as string)) as {
      default: { Pool: new (config: { connectionString: string }) => PgPool }
    }
    const pool = new pg.Pool({ connectionString })

    try {
      const result = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT LIKE '_reactivebase_%' ORDER BY table_name`,
      )

      const tables = result.rows.map((r: Record<string, unknown>) => r.table_name as string)

      if (tables.length === 0) {
        console.log("  No tables found to reset.")
        return
      }

      console.log(`  Truncating ${tables.length} table(s)...`)
      for (const table of tables) {
        await pool.query(`TRUNCATE "${table}" CASCADE`)
        console.log(`    ✓ ${table}`)
      }

      console.log("\n✓ Seed data reset complete.")
    } finally {
      await pool.end()
    }
  } catch (error: unknown) {
    console.error(`  ✗ Reset failed: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
}

export async function seedStatus(options: SeedCommandOptions): Promise<void> {
  const seedsDir = join(resolve(options.projectDir), "seeds")

  if (!existsSync(seedsDir)) {
    console.log("No seeds/ directory found.")
    return
  }

  const files = readdirSync(seedsDir).filter((f) => f.endsWith(".seed.ts") || f.endsWith(".seed.js"))

  console.log("📊 Seed Status:\n")

  if (files.length === 0) {
    console.log("  No seed files found.")
    return
  }

  for (const file of files) {
    const name = file.replace(/\.seed\.(ts|js)$/, "")
    console.log(`  📄 ${name}`)
    console.log(`     File: seeds/${file}`)
    console.log(`     Status: registered`)
    console.log("")
  }

  console.log("Use `reactivebase seed` to execute seeds.")
  console.log("Use `reactivebase seed:reset` to reset seed data.")
}

// Minimal seed context for generate functions
interface SeedContext {
  id: () => string
  fake: {
    fullName: () => string
    email: () => string
    sentence: () => string
    number: (min: number, max: number) => number
  }
}

interface PgPool {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
  end: () => Promise<void>
}

let seedIdCounter = 0
function createSeedContext(): SeedContext {
  return {
    id: () => `seed-${++seedIdCounter}-${Date.now()}`,
    fake: {
      fullName: () => {
        const firsts = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank"]
        const lasts = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Davis"]
        return `${firsts[Math.floor(Math.random() * firsts.length)]} ${lasts[Math.floor(Math.random() * lasts.length)]}`
      },
      email: () => `user${Math.floor(Math.random() * 10000)}@example.com`,
      sentence: () => "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
      number: (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min,
    },
  }
}
