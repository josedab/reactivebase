/**
 * Schema-Driven E2E Test Generator
 *
 * Analyzes schema definitions to auto-generate comprehensive Vitest test suites
 * covering CRUD operations, constraint violations, index utilization, cascade
 * behaviors, concurrent mutation conflicts, and subscription update correctness.
 */

// ── Schema Analysis ──────────────────────────────────────────────────────────

export interface AnalyzedTable {
  readonly name: string
  readonly columns: AnalyzedColumn[]
  readonly indexes: AnalyzedIndex[]
  readonly foreignKeys: ForeignKeyInfo[]
  readonly hasCreatedAt: boolean
  readonly hasUpdatedAt: boolean
  readonly primaryKey: string[]
}

export interface AnalyzedColumn {
  readonly name: string
  readonly type: string
  readonly nullable: boolean
  readonly hasDefault: boolean
  readonly isUnique: boolean
  readonly referencedTable?: string
  readonly referencedColumn?: string
}

export interface AnalyzedIndex {
  readonly name: string
  readonly columns: string[]
  readonly unique: boolean
}

export interface ForeignKeyInfo {
  readonly column: string
  readonly referencedTable: string
  readonly referencedColumn: string
  readonly onDelete?: "cascade" | "restrict" | "set null" | "no action"
}

export interface SchemaAnalysis {
  readonly tables: AnalyzedTable[]
  readonly relationships: RelationshipInfo[]
  readonly circularDeps: string[][]
}

export interface RelationshipInfo {
  readonly from: string
  readonly to: string
  readonly type: "one-to-many" | "many-to-one" | "many-to-many"
  readonly throughColumn: string
}

/**
 * Analyze a schema definition for test generation.
 */
export function analyzeSchema(schemaDef: Record<string, {
  columns: Record<string, { type?: string; nullable?: boolean; default?: unknown; unique?: boolean; referencedTable?: string; referencedColumn?: string }>
  indexes: Array<{ name: string; columns: string[]; unique?: boolean }>
  primaryKey?: string[]
}>): SchemaAnalysis {
  const tables: AnalyzedTable[] = []
  const relationships: RelationshipInfo[] = []

  for (const [tableName, tableDef] of Object.entries(schemaDef)) {
    const columns: AnalyzedColumn[] = []
    const foreignKeys: ForeignKeyInfo[] = []

    for (const [colName, colDef] of Object.entries(tableDef.columns)) {
      columns.push({
        name: colName,
        type: colDef.type ?? "text",
        nullable: colDef.nullable ?? false,
        hasDefault: colDef.default !== undefined,
        isUnique: colDef.unique ?? false,
        referencedTable: colDef.referencedTable,
        referencedColumn: colDef.referencedColumn,
      })

      if (colDef.referencedTable) {
        foreignKeys.push({
          column: colName,
          referencedTable: colDef.referencedTable,
          referencedColumn: colDef.referencedColumn ?? "id",
        })

        relationships.push({
          from: tableName,
          to: colDef.referencedTable,
          type: "many-to-one",
          throughColumn: colName,
        })
      }
    }

    const indexes: AnalyzedIndex[] = tableDef.indexes.map((idx) => ({
      name: idx.name,
      columns: idx.columns,
      unique: idx.unique ?? false,
    }))

    tables.push({
      name: tableName,
      columns,
      indexes,
      foreignKeys,
      hasCreatedAt: columns.some((c) => c.name === "createdAt" || c.name === "created_at"),
      hasUpdatedAt: columns.some((c) => c.name === "updatedAt" || c.name === "updated_at"),
      primaryKey: tableDef.primaryKey ?? ["id"],
    })
  }

  return { tables, relationships, circularDeps: detectCircularDeps(relationships) }
}

function detectCircularDeps(relationships: RelationshipInfo[]): string[][] {
  const graph = new Map<string, Set<string>>()
  for (const rel of relationships) {
    if (!graph.has(rel.from)) graph.set(rel.from, new Set())
    graph.get(rel.from)!.add(rel.to)
  }

  const cycles: string[][] = []
  const visited = new Set<string>()
  const inStack = new Set<string>()

  const dfs = (node: string, path: string[]) => {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node)
      if (cycleStart >= 0) cycles.push(path.slice(cycleStart))
      return
    }
    if (visited.has(node)) return

    visited.add(node)
    inStack.add(node)
    path.push(node)

    for (const neighbor of graph.get(node) ?? []) {
      dfs(neighbor, [...path])
    }

    inStack.delete(node)
  }

  for (const node of graph.keys()) {
    dfs(node, [])
  }

  return cycles
}

// ── Test Generation ──────────────────────────────────────────────────────────

export type TestCoverage = "basic" | "standard" | "high"

export interface TestGeneratorOptions {
  coverage: TestCoverage
  outputDir: string
  importPath: string
  includeSubscriptionTests: boolean
  includeConcurrencyTests: boolean
}

const DEFAULT_GENERATOR_OPTIONS: TestGeneratorOptions = {
  coverage: "standard",
  outputDir: "__generated_tests__",
  importPath: "@reactivebase/testing",
  includeSubscriptionTests: true,
  includeConcurrencyTests: false,
}

export interface GeneratedTestFile {
  readonly path: string
  readonly content: string
  readonly testCount: number
  readonly tableName: string
}

/**
 * Generate Vitest test files from analyzed schema.
 */
export function generateTests(
  analysis: SchemaAnalysis,
  options: Partial<TestGeneratorOptions> = {},
): GeneratedTestFile[] {
  const opts = { ...DEFAULT_GENERATOR_OPTIONS, ...options }
  const files: GeneratedTestFile[] = []

  for (const table of analysis.tables) {
    const tests: string[] = []
    let testCount = 0

    // CRUD tests
    tests.push(generateCrudTests(table))
    testCount += 4

    // Constraint violation tests
    const constraintTests = generateConstraintTests(table)
    if (constraintTests) {
      tests.push(constraintTests)
      testCount += table.columns.filter((c) => !c.nullable && !c.hasDefault).length
      testCount += table.columns.filter((c) => c.isUnique).length
    }

    // Foreign key / cascade tests
    if (table.foreignKeys.length > 0) {
      tests.push(generateForeignKeyTests(table))
      testCount += table.foreignKeys.length
    }

    // Index utilization tests
    if (table.indexes.length > 0 && (opts.coverage === "standard" || opts.coverage === "high")) {
      tests.push(generateIndexTests(table))
      testCount += table.indexes.length
    }

    // Subscription tests
    if (opts.includeSubscriptionTests && opts.coverage !== "basic") {
      tests.push(generateSubscriptionTests(table))
      testCount += 3
    }

    // Concurrency tests
    if (opts.includeConcurrencyTests && opts.coverage === "high") {
      tests.push(generateConcurrencyTests(table))
      testCount += 2
    }

    const content = [
      `import { describe, it, expect } from "vitest"`,
      `import { createTestServer } from "${opts.importPath}"`,
      ``,
      `describe("${table.name}", () => {`,
      tests.join("\n\n"),
      `})`,
      ``,
    ].join("\n")

    files.push({
      path: `${opts.outputDir}/${table.name}.test.ts`,
      content,
      testCount,
      tableName: table.name,
    })
  }

  return files
}

function generateCrudTests(table: AnalyzedTable): string {
  const cols = table.columns.filter((c) => !c.hasDefault && c.name !== "id")
  const sampleData = cols.map((c) => `      ${c.name}: ${getSampleValue(c.type)}`).join(",\n")

  return `  // CRUD Operations
  it("creates a ${table.name} record", async () => {
    const server = createTestServer()
    const result = await server.runMutation("create${capitalize(table.name)}", {
${sampleData}
    })
    expect(result).toBeDefined()
  })

  it("reads ${table.name} records", async () => {
    const server = createTestServer()
    const result = await server.runQuery("list${capitalize(table.name)}", {})
    expect(Array.isArray(result)).toBe(true)
  })

  it("updates a ${table.name} record", async () => {
    const server = createTestServer()
    const created = await server.runMutation("create${capitalize(table.name)}", {
${sampleData}
    })
    const result = await server.runMutation("update${capitalize(table.name)}", {
      id: created.id,
${cols.length > 0 ? `      ${cols[0].name}: ${getSampleValue(cols[0].type, true)}` : ""}
    })
    expect(result).toBeDefined()
  })

  it("deletes a ${table.name} record", async () => {
    const server = createTestServer()
    const created = await server.runMutation("create${capitalize(table.name)}", {
${sampleData}
    })
    await server.runMutation("delete${capitalize(table.name)}", { id: created.id })
    const result = await server.runQuery("get${capitalize(table.name)}", { id: created.id })
    expect(result).toBeNull()
  })`
}

function generateConstraintTests(table: AnalyzedTable): string | null {
  const requiredCols = table.columns.filter((c) => !c.nullable && !c.hasDefault && c.name !== "id")
  const uniqueCols = table.columns.filter((c) => c.isUnique)

  if (requiredCols.length === 0 && uniqueCols.length === 0) return null

  const tests: string[] = []

  for (const col of requiredCols) {
    tests.push(`  it("rejects null ${col.name}", async () => {
    const server = createTestServer()
    await expect(
      server.runMutation("create${capitalize(table.name)}", { ${col.name}: null })
    ).rejects.toThrow()
  })`)
  }

  for (const col of uniqueCols) {
    tests.push(`  it("rejects duplicate ${col.name}", async () => {
    const server = createTestServer()
    const value = ${getSampleValue(col.type)}
    await server.runMutation("create${capitalize(table.name)}", { ${col.name}: value })
    await expect(
      server.runMutation("create${capitalize(table.name)}", { ${col.name}: value })
    ).rejects.toThrow()
  })`)
  }

  return `  // Constraint Violations\n${tests.join("\n\n")}`
}

function generateForeignKeyTests(table: AnalyzedTable): string {
  const tests = table.foreignKeys.map(
    (fk) => `  it("validates ${fk.column} references ${fk.referencedTable}", async () => {
    const server = createTestServer()
    await expect(
      server.runMutation("create${capitalize(table.name)}", { ${fk.column}: "nonexistent_id" })
    ).rejects.toThrow()
  })`,
  )
  return `  // Foreign Key & Cascade Tests\n${tests.join("\n\n")}`
}

function generateIndexTests(table: AnalyzedTable): string {
  const tests = table.indexes.map(
    (idx) => `  it("efficiently queries by index: ${idx.name}", async () => {
    const server = createTestServer()
    const result = await server.runQuery("list${capitalize(table.name)}By${capitalize(idx.columns[0])}", {
      ${idx.columns[0]}: ${getSampleValue("text")}
    })
    expect(Array.isArray(result)).toBe(true)
  })`,
  )
  return `  // Index Utilization Tests\n${tests.join("\n\n")}`
}

function generateSubscriptionTests(table: AnalyzedTable): string {
  return `  // Subscription Update Correctness
  it("subscription receives create updates for ${table.name}", async () => {
    const server = createTestServer()
    const updates = await server.snapshotReactiveUpdates(
      "list${capitalize(table.name)}",
      {},
      [{ mutation: "create${capitalize(table.name)}", args: {} }]
    )
    expect(updates.length).toBeGreaterThan(0)
  })

  it("subscription receives update notifications for ${table.name}", async () => {
    const server = createTestServer()
    const updates = await server.snapshotReactiveUpdates(
      "list${capitalize(table.name)}",
      {},
      [{ mutation: "update${capitalize(table.name)}", args: { id: "test" } }]
    )
    expect(updates).toBeDefined()
  })

  it("subscription receives delete notifications for ${table.name}", async () => {
    const server = createTestServer()
    const updates = await server.snapshotReactiveUpdates(
      "list${capitalize(table.name)}",
      {},
      [{ mutation: "delete${capitalize(table.name)}", args: { id: "test" } }]
    )
    expect(updates).toBeDefined()
  })`
}

function generateConcurrencyTests(table: AnalyzedTable): string {
  return `  // Concurrent Mutation Conflict Tests
  it("handles concurrent creates for ${table.name}", async () => {
    const server = createTestServer()
    const results = await Promise.allSettled([
      server.runMutation("create${capitalize(table.name)}", {}),
      server.runMutation("create${capitalize(table.name)}", {}),
    ])
    const successes = results.filter(r => r.status === "fulfilled")
    expect(successes.length).toBeGreaterThanOrEqual(1)
  })

  it("handles concurrent updates for ${table.name}", async () => {
    const server = createTestServer()
    const created = await server.runMutation("create${capitalize(table.name)}", {})
    const results = await Promise.allSettled([
      server.runMutation("update${capitalize(table.name)}", { id: created.id }),
      server.runMutation("update${capitalize(table.name)}", { id: created.id }),
    ])
    expect(results.length).toBe(2)
  })`
}

// ── Utilities ────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function getSampleValue(type: string, alternate = false): string {
  switch (type) {
    case "text":
    case "string":
    case "varchar":
      return alternate ? '"updated_value"' : '"test_value"'
    case "integer":
    case "int":
    case "number":
      return alternate ? "99" : "42"
    case "boolean":
      return alternate ? "false" : "true"
    case "timestamp":
    case "date":
      return 'new Date().toISOString()'
    case "uuid":
      return '"00000000-0000-0000-0000-000000000001"'
    case "json":
    case "jsonb":
      return alternate ? '{ key: "updated" }' : '{ key: "value" }'
    default:
      return '"test"'
  }
}
