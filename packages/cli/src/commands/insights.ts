/**
 * CLI command: reactivebase insights
 * Schema complexity analysis, dead function detection, performance predictions,
 * and CI-friendly JSON output for automated quality gates.
 *
 * Usage:
 *   reactivebase insights
 *   reactivebase insights --json
 *   reactivebase insights --threshold complexity=50
 */

export interface InsightsOptions {
  projectDir: string
  json?: boolean
  threshold?: string
}

export interface SchemaComplexity {
  totalTables: number
  totalColumns: number
  totalRelations: number
  totalIndexes: number
  avgColumnsPerTable: number
  maxColumnsTable: { name: string; count: number } | null
  circularRelations: string[][]
  complexityScore: number
}

export interface DeadFunction {
  name: string
  file: string
  type: "query" | "mutation" | "action" | "unknown"
  reason: string
}

export interface PerformancePrediction {
  area: string
  risk: "low" | "medium" | "high"
  detail: string
  recommendation: string
}

export interface InsightsReport {
  timestamp: number
  schemaComplexity: SchemaComplexity
  deadFunctions: DeadFunction[]
  performancePredictions: PerformancePrediction[]
  summary: {
    complexityScore: number
    deadFunctionCount: number
    highRiskCount: number
    grade: "A" | "B" | "C" | "D" | "F"
  }
}

export async function insights(options: InsightsOptions): Promise<void> {
  const { readdirSync, readFileSync, existsSync } = await import("node:fs")
  const { join } = await import("node:path")

  console.log("🔍 Analyzing project...\n")

  const schemaComplexity = analyzeSchemaComplexity(options.projectDir, { readdirSync, readFileSync, existsSync, join })
  const deadFunctions = detectDeadFunctions(options.projectDir, { readdirSync, readFileSync, existsSync, join })
  const performancePredictions = predictPerformance(schemaComplexity)

  const highRiskCount = performancePredictions.filter((p) => p.risk === "high").length
  const complexityScore = schemaComplexity.complexityScore
  const grade = computeGrade(complexityScore, deadFunctions.length, highRiskCount)

  const report: InsightsReport = {
    timestamp: Date.now(),
    schemaComplexity,
    deadFunctions,
    performancePredictions,
    summary: {
      complexityScore,
      deadFunctionCount: deadFunctions.length,
      highRiskCount,
      grade,
    },
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  // Pretty-print
  console.log("━".repeat(60))
  console.log("  ReactiveBase Developer Insights")
  console.log("━".repeat(60))
  console.log()

  // Schema Complexity
  console.log("📊 Schema Complexity")
  console.log("─".repeat(40))
  console.log(`  Tables: ${schemaComplexity.totalTables}`)
  console.log(`  Columns: ${schemaComplexity.totalColumns}`)
  console.log(`  Relations: ${schemaComplexity.totalRelations}`)
  console.log(`  Indexes: ${schemaComplexity.totalIndexes}`)
  console.log(`  Avg columns/table: ${schemaComplexity.avgColumnsPerTable.toFixed(1)}`)
  if (schemaComplexity.maxColumnsTable) {
    console.log(
      `  Largest table: ${schemaComplexity.maxColumnsTable.name} (${schemaComplexity.maxColumnsTable.count} columns)`,
    )
  }
  if (schemaComplexity.circularRelations.length > 0) {
    console.log(`  ⚠️  Circular relations: ${schemaComplexity.circularRelations.map((c) => c.join(" → ")).join("; ")}`)
  }
  console.log(`  Complexity score: ${schemaComplexity.complexityScore}/100`)
  console.log()

  // Dead Functions
  if (deadFunctions.length > 0) {
    console.log(`🗑️  Potentially Dead Functions (${deadFunctions.length})`)
    console.log("─".repeat(40))
    for (const fn of deadFunctions) {
      console.log(`  ${fn.type}: ${fn.name}`)
      console.log(`     File: ${fn.file}`)
      console.log(`     Reason: ${fn.reason}`)
    }
    console.log()
  } else {
    console.log("✅ No dead functions detected\n")
  }

  // Performance Predictions
  if (performancePredictions.length > 0) {
    console.log(`⚡ Performance Predictions (${performancePredictions.length})`)
    console.log("─".repeat(40))
    for (const pred of performancePredictions) {
      const icon = pred.risk === "high" ? "🔴" : pred.risk === "medium" ? "🟡" : "🟢"
      console.log(`  ${icon} ${pred.area} [${pred.risk}]`)
      console.log(`     ${pred.detail}`)
      console.log(`     → ${pred.recommendation}`)
      console.log()
    }
  }

  // Summary
  console.log("━".repeat(60))
  console.log(
    `  Grade: ${grade}  |  Complexity: ${complexityScore}/100  |  Dead fns: ${deadFunctions.length}  |  High risk: ${highRiskCount}`,
  )
  console.log("━".repeat(60))

  // Check thresholds for CI
  if (options.threshold) {
    const parts = options.threshold.split("=")
    if (parts[0] === "complexity" && complexityScore > parseInt(parts[1], 10)) {
      console.log(`\n❌ THRESHOLD EXCEEDED: complexity ${complexityScore} > ${parts[1]}`)
      process.exitCode = 1
    }
    if (parts[0] === "grade" && grade > parts[1]) {
      console.log(`\n❌ THRESHOLD EXCEEDED: grade ${grade} worse than ${parts[1]}`)
      process.exitCode = 1
    }
  }
}

// ─── Analysis Functions ──────────────────────────────────────────────────────

interface FsUtils {
  readdirSync: (path: string) => string[]
  readFileSync: (path: string, encoding: string) => string
  existsSync: (path: string) => boolean
  join: (...paths: string[]) => string
}

function analyzeSchemaComplexity(projectDir: string, fs: FsUtils): SchemaComplexity {
  const schemaDir = fs.join(projectDir, "src", "schema")
  if (!fs.existsSync(schemaDir)) {
    // Try alternative locations
    const altDirs = ["schema", "src/db/schema", "src/models"]
    for (const alt of altDirs) {
      const altPath = fs.join(projectDir, alt)
      if (fs.existsSync(altPath)) {
        return analyzeSchemaDir(altPath, fs)
      }
    }
    return {
      totalTables: 0,
      totalColumns: 0,
      totalRelations: 0,
      totalIndexes: 0,
      avgColumnsPerTable: 0,
      maxColumnsTable: null,
      circularRelations: [],
      complexityScore: 0,
    }
  }

  return analyzeSchemaDir(schemaDir, fs)
}

function analyzeSchemaDir(schemaDir: string, fs: FsUtils): SchemaComplexity {
  let totalTables = 0
  let totalColumns = 0
  let totalRelations = 0
  let totalIndexes = 0
  let maxColumnsTable: { name: string; count: number } | null = null

  try {
    const files = fs.readdirSync(schemaDir).filter((f: string) => f.endsWith(".ts") || f.endsWith(".js"))
    for (const file of files) {
      const content = fs.readFileSync(fs.join(schemaDir, file), "utf-8")

      // Count defineTable calls
      const tableMatches = content.match(/defineTable\s*\(/g)
      if (tableMatches) totalTables += tableMatches.length

      // Count column definitions (v.string(), v.number(), etc.)
      const columnMatches = content.match(/v\.\w+\s*\(/g)
      const colCount = columnMatches?.length ?? 0
      totalColumns += colCount

      // Track largest table
      if (colCount > 0 && (!maxColumnsTable || colCount > maxColumnsTable.count)) {
        maxColumnsTable = { name: file.replace(/\.(ts|js)$/, ""), count: colCount }
      }

      // Count relations
      const relationMatches = content.match(/\.relation\s*\(/g)
      if (relationMatches) totalRelations += relationMatches.length

      // Count indexes
      const indexMatches = content.match(/\.index\s*\(/g)
      if (indexMatches) totalIndexes += indexMatches.length
    }
  } catch {
    // Directory read error
  }

  const avgColumnsPerTable = totalTables > 0 ? totalColumns / totalTables : 0
  const complexityScore = Math.min(
    100,
    Math.round(
      totalTables * 3 +
        totalColumns * 0.5 +
        totalRelations * 5 +
        (avgColumnsPerTable > 15 ? 20 : 0) +
        (totalTables > 20 ? 15 : 0),
    ),
  )

  return {
    totalTables,
    totalColumns,
    totalRelations,
    totalIndexes,
    avgColumnsPerTable,
    maxColumnsTable,
    circularRelations: [],
    complexityScore,
  }
}

function detectDeadFunctions(projectDir: string, fs: FsUtils): DeadFunction[] {
  const dead: DeadFunction[] = []
  const functionsDir = fs.join(projectDir, "src", "functions")

  if (!fs.existsSync(functionsDir)) return dead

  try {
    const files = fs.readdirSync(functionsDir).filter((f: string) => f.endsWith(".ts") || f.endsWith(".js"))
    const allContent = files
      .map((f: string) => {
        try {
          return fs.readFileSync(fs.join(functionsDir, f), "utf-8")
        } catch {
          return ""
        }
      })
      .join("\n")

    for (const file of files) {
      const content = fs.readFileSync(fs.join(functionsDir, file), "utf-8")

      // Find exported function names
      const exportMatches = content.matchAll(/export\s+(?:const|function)\s+(\w+)/g)
      for (const match of exportMatches) {
        const fnName = match[1]
        // Count references across all files (excluding the definition itself)
        const regex = new RegExp(`\\b${fnName}\\b`, "g")
        const refs = (allContent.match(regex) ?? []).length
        // If only referenced once (its own definition), it might be dead
        if (refs <= 1) {
          const type = content.includes("query(")
            ? "query"
            : content.includes("mutation(")
              ? "mutation"
              : content.includes("action(")
                ? "action"
                : "unknown"
          dead.push({
            name: fnName,
            file: `src/functions/${file}`,
            type,
            reason: "No references found outside its definition file",
          })
        }
      }
    }
  } catch {
    // Directory read error
  }

  return dead
}

function predictPerformance(schema: SchemaComplexity): PerformancePrediction[] {
  const predictions: PerformancePrediction[] = []

  if (schema.avgColumnsPerTable > 20) {
    predictions.push({
      area: "Wide tables",
      risk: "high",
      detail: `Average ${schema.avgColumnsPerTable.toFixed(0)} columns per table may cause slow full-row reads`,
      recommendation: "Consider normalizing wide tables or using column-level subscriptions",
    })
  }

  if (schema.totalTables > 30 && schema.totalRelations < schema.totalTables * 0.5) {
    predictions.push({
      area: "Missing relations",
      risk: "medium",
      detail: `${schema.totalTables} tables but only ${schema.totalRelations} relations — possible N+1 queries`,
      recommendation: "Add explicit relations to enable join optimization",
    })
  }

  if (schema.totalIndexes < schema.totalTables) {
    predictions.push({
      area: "Missing indexes",
      risk: "medium",
      detail: `Only ${schema.totalIndexes} indexes for ${schema.totalTables} tables`,
      recommendation: "Run `reactivebase optimize` to identify missing indexes",
    })
  }

  if (schema.totalRelations > schema.totalTables * 3) {
    predictions.push({
      area: "High relation density",
      risk: "medium",
      detail: `${schema.totalRelations} relations may cause excessive subscription invalidations`,
      recommendation: "Consider using row-level tracking for frequently changed tables",
    })
  }

  if (schema.circularRelations.length > 0) {
    predictions.push({
      area: "Circular dependencies",
      risk: "high",
      detail: `${schema.circularRelations.length} circular relation chains detected`,
      recommendation: "Break circular dependencies to avoid infinite invalidation loops",
    })
  }

  if (schema.maxColumnsTable && schema.maxColumnsTable.count > 30) {
    predictions.push({
      area: "Table bloat",
      risk: "high",
      detail: `Table "${schema.maxColumnsTable.name}" has ${schema.maxColumnsTable.count} columns`,
      recommendation: "Split into multiple tables with relations",
    })
  }

  return predictions
}

function computeGrade(complexity: number, deadFunctions: number, highRisk: number): "A" | "B" | "C" | "D" | "F" {
  const score = 100 - complexity * 0.4 - deadFunctions * 5 - highRisk * 15
  if (score >= 80) return "A"
  if (score >= 60) return "B"
  if (score >= 40) return "C"
  if (score >= 20) return "D"
  return "F"
}
