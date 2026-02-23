/**
 * @reactivebase/migrate-from-prisma
 *
 * One-command migration tool that reads a Prisma schema file
 * and generates a complete ReactiveBase project.
 *
 * Usage:
 *   npx @reactivebase/migrate-from-prisma
 *   npx @reactivebase/migrate-from-prisma --input prisma/schema.prisma --output ./my-app
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { convertPrismaToReactiveBase } from "@reactivebase/server"

const args = process.argv.slice(2)

function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`)
  if (idx >= 0 && args[idx + 1]) return args[idx + 1]
  return fallback
}

const inputPath = getArg("input", "prisma/schema.prisma")
const outputDir = getArg("output", ".")

console.log(`
  🔄 ReactiveBase Prisma Migration Tool
  
  Input:  ${resolve(inputPath)}
  Output: ${resolve(outputDir)}
`)

// Read Prisma schema
if (!existsSync(inputPath)) {
  console.error(`❌ Prisma schema not found at: ${inputPath}`)
  console.error(`   Run this command from your project root, or use --input <path>`)
  process.exit(1)
}

const prismaSchema = readFileSync(inputPath, "utf-8")

// Convert to ReactiveBase schema
console.log("  📝 Parsing Prisma schema...")
const reactiveBaseSchema = convertPrismaToReactiveBase(prismaSchema)

// Write output
const convexDir = join(outputDir, "convex")
mkdirSync(convexDir, { recursive: true })

const schemaPath = join(convexDir, "schema.ts")
writeFileSync(schemaPath, reactiveBaseSchema, "utf-8")

console.log(`  ✅ Generated: ${schemaPath}`)

// Generate a basic server.ts if it doesn't exist
const serverPath = join(outputDir, "server.ts")
if (!existsSync(serverPath)) {
  writeFileSync(
    serverPath,
    `import { createReactiveBaseServer, defineConfig } from "@reactivebase/server"
import schema from "./convex/schema.js"

const config = defineConfig({
  database: {
    connectionString: process.env.DATABASE_URL ?? "postgresql://localhost:5432/myapp",
  },
  server: { port: 4000 },
})

const server = createReactiveBaseServer(schema, config)
server.start().then(({ port }) => {
  console.log(\`ReactiveBase server running on port \${port}\`)
})
`,
    "utf-8",
  )
  console.log(`  ✅ Generated: ${serverPath}`)
}

console.log(`
  🎉 Migration complete!

  Next steps:
    1. Review the generated schema: ${schemaPath}
    2. Install dependencies: npm install @reactivebase/server @reactivebase/react
    3. Write your queries and mutations in convex/*.ts
    4. Run: npm run dev

  Docs: https://reactivebase.dev/docs/getting-started
`)
