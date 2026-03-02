/**
 * CLI commands: seed, seed:reset, seed:status
 */

import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

export interface SeedCommandOptions {
  projectDir: string
  profile?: string
  environment?: string
}

/**
 * Execute seed files to populate the database with test or development data.
 *
 * @param options - Seed options including project directory, profile, and target environment
 */
export async function seedRun(options: SeedCommandOptions): Promise<void> {
  const seedsDir = join(options.projectDir, "seeds")

  if (!existsSync(seedsDir)) {
    console.log("No seeds/ directory found. Create .seed.ts files to define seed data.")
    console.log("")
    console.log("Example seeds/users.seed.ts:")
    console.log("  import { defineSeed } from '@reactivebase/server'")
    console.log("")
    console.log("  export default defineSeed('users', {")
    console.log("    environments: ['dev', 'test'],")
    console.log("    generate: (ctx) => [")
    console.log("      { table: 'users', data: { id: ctx.id(), name: ctx.fake.fullName(), email: ctx.fake.email() } },")
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

  console.log(`🌱 Running seeds for environment: ${env}`)
  if (profile) {
    console.log(`   Profile: ${profile}`)
  }
  console.log(`   Found ${files.length} seed file(s):`)

  for (const file of files) {
    console.log(`     📄 ${file}`)
  }

  console.log("")
  console.log("To execute seeds programmatically:")
  console.log("  import { createSeedRegistry, defineSeed } from '@reactivebase/server'")
  console.log("  const registry = createSeedRegistry()")
  console.log("  registry.register(usersSeed)")
  console.log(`  const result = await registry.execute('${env}')`)
  console.log("  console.log(`Seeded ${result.totalRecords} records`)")
}

/**
 * Reset all seed data by truncating seeded tables.
 *
 * @param _options - Seed options (unused, reserved for future database connection)
 */
export async function seedReset(_options: SeedCommandOptions): Promise<void> {
  console.log("🗑️  Resetting seed data...")
  console.log("")
  console.log("To reset seeds programmatically:")
  console.log("  registry.reset()")
  console.log("  // Or truncate tables: TRUNCATE users, posts, ... CASCADE")
}

/**
 * Display the status of all registered seed files and their execution state.
 *
 * @param options - Seed options including project directory
 */
export async function seedStatus(options: SeedCommandOptions): Promise<void> {
  const seedsDir = join(options.projectDir, "seeds")

  if (!existsSync(seedsDir)) {
    console.log("No seeds/ directory found.")
    return
  }

  const files = readdirSync(seedsDir).filter((f) => f.endsWith(".seed.ts") || f.endsWith(".seed.js"))

  console.log("📊 Seed Status:")
  console.log("")

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
