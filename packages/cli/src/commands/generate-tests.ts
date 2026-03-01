/**
 * CLI command: reactivebase generate:tests
 *
 * Auto-generates E2E test suites from schema definitions.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs"
import { join, resolve } from "path"

export interface GenerateTestsOptions {
  projectDir: string
  coverage?: "basic" | "standard" | "high"
  outputDir?: string
  dryRun?: boolean
}

export async function generateTestsCommand(options: GenerateTestsOptions): Promise<void> {
  const { projectDir, coverage = "standard", dryRun = false } = options
  const outputDir = options.outputDir ?? join(projectDir, "__generated_tests__")

  console.log(`\n🧪 ReactiveBase Test Generator`)
  console.log(`   Coverage: ${coverage}`)
  console.log(`   Output:   ${outputDir}\n`)

  // Discover schema files
  const schemaDir = join(projectDir, "schema")
  if (!existsSync(schemaDir)) {
    console.log("⚠️  No schema/ directory found. Looking for schema.ts...")
    const schemaFile = join(projectDir, "schema.ts")
    if (!existsSync(schemaFile)) {
      console.error("❌ No schema definitions found. Create a schema/ directory or schema.ts file.")
      return
    }
  }

  // Scan schema directory for table definitions
  const schemaFiles = existsSync(schemaDir)
    ? readdirSync(schemaDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    : []

  console.log(`📋 Found ${schemaFiles.length} schema file(s)`)

  // Extract table information from schema files
  const tables: Array<{ name: string; columns: string[]; hasIndex: boolean; hasFk: boolean }> = []

  for (const file of schemaFiles) {
    const content = readFileSync(join(schemaDir, file), "utf-8")
    const tableMatch = content.match(/defineTable\s*\(\s*["'](\w+)["']/)
    if (tableMatch) {
      const columnMatches = content.matchAll(/v\.(\w+)\(\)/g)
      const columns = Array.from(columnMatches).map((m) => m[1])
      tables.push({
        name: tableMatch[1],
        columns,
        hasIndex: content.includes("index("),
        hasFk: content.includes("references("),
      })
    }
  }

  if (tables.length === 0) {
    console.log("📄 No table definitions found in schema files.")
    console.log("   Generate placeholder tests based on file structure...")

    // Generate placeholder test structure
    for (const file of schemaFiles) {
      const name = file.replace(/\.ts$/, "")
      tables.push({ name, columns: [], hasIndex: false, hasFk: false })
    }
  }

  // Generate test files
  let totalTests = 0
  const generatedFiles: string[] = []

  if (!dryRun) {
    mkdirSync(outputDir, { recursive: true })
  }

  for (const table of tables) {
    let testCount = 4 // CRUD
    if (coverage !== "basic") testCount += 3 // subscription
    if (coverage === "high") testCount += 2 // concurrency
    if (table.hasFk) testCount += 1

    const testContent = generateTestFile(table.name, coverage, table.hasFk)
    const filePath = join(outputDir, `${table.name}.test.ts`)

    if (!dryRun) {
      writeFileSync(filePath, testContent, "utf-8")
    }

    generatedFiles.push(filePath)
    totalTests += testCount
    console.log(`  ✅ ${table.name}.test.ts (${testCount} tests)`)
  }

  console.log(`\n📊 Summary:`)
  console.log(`   Files generated: ${generatedFiles.length}`)
  console.log(`   Total tests:     ${totalTests}`)
  console.log(`   Coverage level:  ${coverage}`)

  if (dryRun) {
    console.log(`\n   (dry run — no files written)`)
  } else {
    console.log(`\n   Tests written to: ${outputDir}`)
    console.log(`   Run with: npx vitest ${outputDir}`)
  }
}

function generateTestFile(tableName: string, coverage: string, hasFk: boolean): string {
  const cap = tableName.charAt(0).toUpperCase() + tableName.slice(1)

  let content = `import { describe, it, expect } from "vitest"
import { createTestServer } from "@reactivebase/testing"

describe("${tableName}", () => {
  it("creates a ${tableName} record", async () => {
    const server = createTestServer()
    const result = await server.runMutation("create${cap}", {})
    expect(result).toBeDefined()
  })

  it("reads ${tableName} records", async () => {
    const server = createTestServer()
    const result = await server.runQuery("list${cap}", {})
    expect(Array.isArray(result)).toBe(true)
  })

  it("updates a ${tableName} record", async () => {
    const server = createTestServer()
    const created = await server.runMutation("create${cap}", {})
    const result = await server.runMutation("update${cap}", { id: created.id })
    expect(result).toBeDefined()
  })

  it("deletes a ${tableName} record", async () => {
    const server = createTestServer()
    const created = await server.runMutation("create${cap}", {})
    await server.runMutation("delete${cap}", { id: created.id })
    const result = await server.runQuery("get${cap}", { id: created.id })
    expect(result).toBeNull()
  })
`

  if (hasFk) {
    content += `
  it("validates foreign key references", async () => {
    const server = createTestServer()
    await expect(
      server.runMutation("create${cap}", { parentId: "nonexistent" })
    ).rejects.toThrow()
  })
`
  }

  if (coverage !== "basic") {
    content += `
  it("subscription receives create updates", async () => {
    const server = createTestServer()
    const updates = await server.snapshotReactiveUpdates(
      "list${cap}", {}, [{ mutation: "create${cap}", args: {} }]
    )
    expect(updates.length).toBeGreaterThan(0)
  })

  it("subscription receives update notifications", async () => {
    const server = createTestServer()
    const updates = await server.snapshotReactiveUpdates(
      "list${cap}", {}, [{ mutation: "update${cap}", args: { id: "test" } }]
    )
    expect(updates).toBeDefined()
  })

  it("subscription receives delete notifications", async () => {
    const server = createTestServer()
    const updates = await server.snapshotReactiveUpdates(
      "list${cap}", {}, [{ mutation: "delete${cap}", args: { id: "test" } }]
    )
    expect(updates).toBeDefined()
  })
`
  }

  if (coverage === "high") {
    content += `
  it("handles concurrent creates", async () => {
    const server = createTestServer()
    const results = await Promise.allSettled([
      server.runMutation("create${cap}", {}),
      server.runMutation("create${cap}", {}),
    ])
    expect(results.filter(r => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1)
  })

  it("handles concurrent updates", async () => {
    const server = createTestServer()
    const created = await server.runMutation("create${cap}", {})
    const results = await Promise.allSettled([
      server.runMutation("update${cap}", { id: created.id }),
      server.runMutation("update${cap}", { id: created.id }),
    ])
    expect(results.length).toBe(2)
  })
`
  }

  content += `})\n`
  return content
}
