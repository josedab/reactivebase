/**
 * CLI command: reactivebase init --profile <name>
 *
 * Initialize a new project with a configuration profile.
 */

import { writeFileSync, existsSync, mkdirSync } from "fs"
import { join } from "path"

export interface InitOptions {
  projectDir: string
  profile: string
  json?: boolean
}

const PROFILES: Record<string, { description: string; config: Record<string, unknown> }> = {
  minimal: {
    description: "Minimal configuration for development and prototyping",
    config: {
      database: { poolSize: 5, statementTimeout: 30_000 },
      server: { port: 4000 },
      cdc: { mode: "listen-notify" },
    },
  },
  saas: {
    description: "Multi-tenant SaaS with auth, pooling, and caching",
    config: {
      database: { poolSize: 20, statementTimeout: 10_000 },
      server: { port: 4000, heartbeatInterval: 30_000 },
      auth: { provider: "jwt", tokenExpiration: 3600, refreshEnabled: true },
      cdc: { mode: "logical-replication", batchSize: 100 },
      cache: { enabled: true, ttlMs: 60_000 },
      tenancy: { mode: "shared", isolation: "row" },
    },
  },
  edge: {
    description: "Edge deployment with aggressive caching and low latency",
    config: {
      database: { poolSize: 10, statementTimeout: 5_000 },
      server: { port: 4000, heartbeatInterval: 15_000 },
      cdc: { mode: "listen-notify", batchSize: 25 },
      cache: { enabled: true, ttlMs: 30_000 },
      deployment: { target: "serverless" },
    },
  },
  collaborative: {
    description: "Real-time collaboration with high subscription limits",
    config: {
      database: { poolSize: 30, statementTimeout: 15_000 },
      server: { port: 4000, heartbeatInterval: 10_000, maxSubscriptionsPerConnection: 500 },
      cdc: { mode: "logical-replication", batchSize: 200 },
      cache: { enabled: true, ttlMs: 10_000 },
    },
  },
  analytics: {
    description: "Read-heavy analytics with large result sets",
    config: {
      database: { poolSize: 15, statementTimeout: 60_000 },
      cdc: { mode: "listen-notify", batchSize: 500 },
      cache: { enabled: true, ttlMs: 300_000 },
      scaling: { readReplicas: true },
    },
  },
}

export async function initProject(options: InitOptions): Promise<void> {
  const { projectDir, profile, json = false } = options

  console.log(`\n🚀 ReactiveBase Init\n`)

  const profileDef = PROFILES[profile]
  if (!profileDef) {
    console.error(`❌ Unknown profile: "${profile}"`)
    console.log("\nAvailable profiles:")
    for (const [name, def] of Object.entries(PROFILES)) {
      console.log(`  ${name.padEnd(15)} ${def.description}`)
    }
    return
  }

  console.log(`📋 Profile: ${profile}`)
  console.log(`   ${profileDef.description}\n`)

  // Generate config file
  const configContent = generateConfigFile(profile, profileDef.config)
  const configPath = join(projectDir, "reactivebase.config.ts")

  if (existsSync(configPath)) {
    console.log(`⚠️  Config file already exists: ${configPath}`)
    console.log(`   Skipping config generation.`)
  } else {
    writeFileSync(configPath, configContent, "utf-8")
    console.log(`✅ Created: reactivebase.config.ts`)
  }

  // Create directories
  const dirs = ["schema", "functions", "seeds"]
  for (const dir of dirs) {
    const dirPath = join(projectDir, dir)
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true })
      console.log(`📁 Created: ${dir}/`)
    }
  }

  if (json) {
    console.log(JSON.stringify({ profile, config: profileDef.config }, null, 2))
  }

  console.log(`\n✅ Project initialized with "${profile}" profile.`)
  console.log(`   Next: reactivebase dev\n`)
}

function generateConfigFile(profile: string, config: Record<string, unknown>): string {
  const dbConfig = (config.database ?? {}) as Record<string, unknown>
  const serverConfig = (config.server ?? {}) as Record<string, unknown>
  const cdcConfig = (config.cdc ?? {}) as Record<string, unknown>

  return `import { defineConfig } from "@reactivebase/server"

// Profile: ${profile}
export default defineConfig({
  database: {
    connectionString: process.env.DATABASE_URL ?? "postgresql://localhost:5432/myapp",
    poolSize: ${dbConfig.poolSize ?? 10},
  },
  server: {
    port: ${serverConfig.port ?? 4000},${serverConfig.corsOrigin ? `\n    corsOrigin: "${serverConfig.corsOrigin}",` : ""}${serverConfig.heartbeatInterval ? `\n    heartbeatInterval: ${serverConfig.heartbeatInterval},` : ""}
  },
  cdc: {
    mode: "${cdcConfig.mode ?? "listen-notify"}",${cdcConfig.batchSize ? `\n    batchSize: ${cdcConfig.batchSize},` : ""}
  },
})
`
}
