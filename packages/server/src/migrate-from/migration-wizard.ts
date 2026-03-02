/**
 * Enhanced Migration Wizard for Prisma and Drizzle.
 * Provides incremental migration, diff preview, API route conversion,
 * and interactive migration planning.
 *
 * Features:
 *   - Analyze existing Prisma/Drizzle project structure
 *   - Generate ReactiveBase schema with diff preview
 *   - Convert tRPC/Express API routes to query/mutation skeletons
 *   - Incremental migration support (one table at a time)
 *   - Migration plan with rollback support
 *   - Compatibility report showing feature gaps
 *
 * Usage:
 *   const wizard = new MigrationWizard()
 *   const analysis = wizard.analyzeProject(projectFiles)
 *   const plan = wizard.createMigrationPlan(analysis)
 *   const output = wizard.executePlan(plan)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProjectAnalysis {
  source: "prisma" | "drizzle" | "unknown"
  schemaFile?: string
  /** All model/table definitions found */
  tables: MigrationTable[]
  /** API routes found */
  routes: DiscoveredRoute[]
  /** Incompatibilities and warnings */
  warnings: MigrationWarning[]
  /** Feature gap analysis */
  featureGaps: FeatureGap[]
  /** Summary statistics */
  stats: {
    totalTables: number
    totalFields: number
    totalRelations: number
    totalRoutes: number
    estimatedMigrationMinutes: number
  }
}

export interface MigrationTable {
  name: string
  fields: MigrationField[]
  indexes: { name: string; columns: string[]; unique: boolean }[]
  relations: MigrationRelation[]
  /** Whether this table has been migrated */
  migrated: boolean
}

export interface MigrationField {
  name: string
  sourceType: string
  targetType: string
  targetValidator: string
  isOptional: boolean
  hasDefault: boolean
  defaultValue?: string
  isId: boolean
  isUnique: boolean
  /** Conversion notes or warnings */
  notes?: string
}

export interface MigrationRelation {
  name: string
  type: "one-to-one" | "one-to-many" | "many-to-many"
  fromField: string
  toTable: string
  toField: string
}

export interface DiscoveredRoute {
  path: string
  method: string
  /** Inferred ReactiveBase function type */
  suggestedType: "query" | "mutation" | "action"
  /** Generated ReactiveBase function skeleton */
  skeleton: string
  /** Source file location */
  sourceFile: string
  /** Tables accessed by this route (inferred) */
  tablesAccessed: string[]
}

export interface MigrationWarning {
  level: "info" | "warning" | "error"
  table?: string
  field?: string
  message: string
  suggestion?: string
}

export interface FeatureGap {
  feature: string
  available: boolean
  workaround?: string
}

export interface MigrationPlan {
  id: string
  source: "prisma" | "drizzle"
  /** Tables to migrate in order */
  steps: MigrationStep[]
  /** Generated schema code */
  schemaCode: string
  /** Generated migration SQL */
  migrationSQL: string
  /** Generated function skeletons */
  functionCode: string
  createdAt: number
}

export interface MigrationStep {
  order: number
  table: string
  action: "create" | "alter" | "skip"
  description: string
  /** SQL for this step */
  sql: string
  /** Rollback SQL */
  rollbackSql: string
  status: "pending" | "completed" | "failed" | "skipped"
}

export interface MigrationDiff {
  table: string
  changes: DiffChange[]
}

export interface DiffChange {
  type: "added" | "removed" | "modified"
  field: string
  before?: string
  after?: string
}

// ─── Route Discovery ─────────────────────────────────────────────────────────

/**
 * Discover API routes from tRPC router definitions.
 */
export function discoverTrpcRoutes(source: string, fileName: string): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = []

  // Match tRPC procedure definitions
  // Pattern: .query(...), .mutation(...), .input(...).query(...), .input(...).mutation(...)
  const procedurePattern =
    /(?:(\w+)\s*:\s*)?(?:\w+\.)?(?:input\s*\([^)]*\)\s*\.)?(\w+)\s*\(\s*(?:async\s*)?\(\s*(?:\{[^}]*\}|[^)]*)\)\s*=>/g
  let match: RegExpExecArray | null

  while ((match = procedurePattern.exec(source)) !== null) {
    const name = match[1] ?? `procedure_${routes.length}`
    const type = match[2]

    if (type === "query" || type === "mutation") {
      const tablesAccessed = extractTablesFromRouteBody(source, match.index)
      const suggestedType = type === "query" ? "query" : "mutation"

      routes.push({
        path: name,
        method: type === "query" ? "GET" : "POST",
        suggestedType,
        skeleton: generateFunctionSkeleton(name, suggestedType as "query" | "mutation", tablesAccessed),
        sourceFile: fileName,
        tablesAccessed,
      })
    }
  }

  return routes
}

/**
 * Discover API routes from Express/Next.js API route definitions.
 */
export function discoverExpressRoutes(source: string, fileName: string): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = []

  // Match Express-style route handlers
  const routePattern = /(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/g
  let match: RegExpExecArray | null

  while ((match = routePattern.exec(source)) !== null) {
    const method = match[1].toUpperCase()
    const path = match[2]
    const name = pathToFunctionName(path)
    const isRead = method === "GET"

    routes.push({
      path,
      method,
      suggestedType: isRead ? "query" : "mutation",
      skeleton: generateFunctionSkeleton(name, isRead ? "query" : "mutation", []),
      sourceFile: fileName,
      tablesAccessed: [],
    })
  }

  return routes
}

function extractTablesFromRouteBody(source: string, fromIndex: number): string[] {
  const tables = new Set<string>()
  const segment = source.substring(fromIndex, Math.min(fromIndex + 500, source.length))

  // Match common ORM patterns
  const patterns = [/prisma\.(\w+)\./g, /db\.(\w+)\./g, /from\s*\(\s*(\w+)\s*\)/g, /table\s*\(\s*["'](\w+)["']\)/g]

  for (const pattern of patterns) {
    let m: RegExpExecArray | null
    while ((m = pattern.exec(segment)) !== null) {
      tables.add(m[1])
    }
  }

  return Array.from(tables)
}

function pathToFunctionName(path: string): string {
  return (
    path
      .replace(/^\/api\//, "")
      .replace(/^\//, "")
      .replace(/\/:?\w+/g, "")
      .replace(/[^a-zA-Z0-9]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "") || "handler"
  )
}

function generateFunctionSkeleton(name: string, type: "query" | "mutation" | "action", tables: string[]): string {
  const tableAccess =
    tables.length > 0
      ? `\n  // [Migration] Migrate data access from ORM to ReactiveBase\n  // Tables: ${tables.join(", ")}`
      : "\n  // [Migration] Implement data access"

  return `export const ${name} = ${type}(async (ctx) => {${tableAccess}
  throw new Error("Not implemented — migrated from ${type}")
})`
}

// ─── Type Mapping ────────────────────────────────────────────────────────────

const PRISMA_TYPE_MAP: Record<string, { validator: string; tsType: string }> = {
  String: { validator: "v.string()", tsType: "string" },
  Int: { validator: "v.integer()", tsType: "number" },
  Float: { validator: "v.number()", tsType: "number" },
  Decimal: { validator: "v.number()", tsType: "number" },
  Boolean: { validator: "v.boolean()", tsType: "boolean" },
  DateTime: { validator: "v.timestamp()", tsType: "Date" },
  Json: { validator: "v.json()", tsType: "unknown" },
  BigInt: { validator: "v.integer()", tsType: "number" },
  Bytes: { validator: 'v.custom<Buffer>("bytea")', tsType: "Buffer" },
}

const DRIZZLE_TYPE_MAP: Record<string, { validator: string; tsType: string }> = {
  text: { validator: "v.string()", tsType: "string" },
  varchar: { validator: "v.string()", tsType: "string" },
  integer: { validator: "v.integer()", tsType: "number" },
  bigint: { validator: "v.integer()", tsType: "number" },
  real: { validator: "v.number()", tsType: "number" },
  doublePrecision: { validator: "v.number()", tsType: "number" },
  boolean: { validator: "v.boolean()", tsType: "boolean" },
  timestamp: { validator: "v.timestamp()", tsType: "Date" },
  json: { validator: "v.json()", tsType: "unknown" },
  jsonb: { validator: "v.json()", tsType: "unknown" },
  uuid: { validator: "v.string()", tsType: "string" },
  serial: { validator: "v.integer()", tsType: "number" },
}

export function mapPrismaType(prismaType: string): { validator: string; tsType: string; notes?: string } {
  const mapped = PRISMA_TYPE_MAP[prismaType]
  if (mapped) return mapped
  // Check if it's a relation (model name)
  return {
    validator: `v.id("${prismaType.toLowerCase()}s")`,
    tsType: "string",
    notes: `Assumed relation to ${prismaType}`,
  }
}

export function mapDrizzleType(drizzleType: string): { validator: string; tsType: string; notes?: string } {
  const mapped = DRIZZLE_TYPE_MAP[drizzleType]
  if (mapped) return mapped
  return { validator: `v.custom<unknown>("${drizzleType}")`, tsType: "unknown", notes: `Custom type: ${drizzleType}` }
}

// ─── Feature Gap Analysis ────────────────────────────────────────────────────

export function analyzeFeatureGaps(source: "prisma" | "drizzle"): FeatureGap[] {
  const common: FeatureGap[] = [
    { feature: "Reactive queries", available: true },
    { feature: "Automatic transactions", available: true },
    { feature: "Type-safe query builder", available: true },
    { feature: "Migrations", available: true },
    { feature: "Indexes", available: true },
    { feature: "Relations", available: true },
    { feature: "Raw SQL", available: true },
    { feature: "JSON/JSONB fields", available: true },
    { feature: "Enums", available: true },
  ]

  if (source === "prisma") {
    return [
      ...common,
      { feature: "Prisma Client extensions", available: false, workaround: "Use ReactiveBase middleware" },
      {
        feature: "@map / @@map annotations",
        available: false,
        workaround: "Use SQL migration to rename columns/tables",
      },
      { feature: "Multi-provider (MySQL/SQLite)", available: false, workaround: "ReactiveBase is Postgres-only" },
      { feature: "Prisma Studio", available: true, workaround: "ReactiveBase Dashboard serves the same purpose" },
    ]
  }

  return [
    ...common,
    { feature: "Drizzle Kit push", available: true, workaround: "Use reactivebase migrate" },
    { feature: "Drizzle custom SQL operators", available: true, workaround: "Use ctx.db.raw()" },
    { feature: "Drizzle prepared statements", available: false, workaround: "Query builder handles parameterization" },
  ]
}

// ─── Migration Wizard ────────────────────────────────────────────────────────

const SAFE_DEFAULT_VALUE_RE =
  /^(?:'[^']*'|\d+(?:\.\d+)?|true|false|NULL|gen_random_uuid\(\)|NOW\(\)|CURRENT_TIMESTAMP|[a-zA-Z_][a-zA-Z0-9_]*\(?\)?)$/i

function sanitizeDefaultValue(value: string): string {
  if (!SAFE_DEFAULT_VALUE_RE.test(value)) {
    throw new Error(`Unsafe default value: ${value}`)
  }
  return value
}

export class MigrationWizard {
  /**
   * Analyze a project's source files to discover schema and routes.
   */
  analyzeProject(files: Record<string, string>): ProjectAnalysis {
    let source: "prisma" | "drizzle" | "unknown" = "unknown"
    let schemaFile: string | undefined
    const tables: MigrationTable[] = []
    const routes: DiscoveredRoute[] = []
    const warnings: MigrationWarning[] = []

    // Detect source
    for (const [path, content] of Object.entries(files)) {
      if (path.endsWith(".prisma") || (content.includes("model ") && content.includes("@@"))) {
        source = "prisma"
        schemaFile = path
        const parsed = this.parsePrismaModels(content)
        tables.push(...parsed.tables)
        warnings.push(...parsed.warnings)
      } else if (content.includes("pgTable") || content.includes("mysqlTable") || content.includes("sqliteTable")) {
        source = "drizzle"
        schemaFile = path
        const parsed = this.parseDrizzleTables(content)
        tables.push(...parsed.tables)
        warnings.push(...parsed.warnings)
      }

      // Route discovery
      if (content.includes("trpc") || content.includes("createRouter") || content.includes("publicProcedure")) {
        routes.push(...discoverTrpcRoutes(content, path))
      }
      if (content.includes("router.get") || content.includes("router.post") || content.includes("app.get")) {
        routes.push(...discoverExpressRoutes(content, path))
      }
    }

    const featureGaps = source !== "unknown" ? analyzeFeatureGaps(source) : []
    const totalFields = tables.reduce((sum, t) => sum + t.fields.length, 0)
    const totalRelations = tables.reduce((sum, t) => sum + t.relations.length, 0)

    return {
      source,
      schemaFile,
      tables,
      routes,
      warnings,
      featureGaps,
      stats: {
        totalTables: tables.length,
        totalFields,
        totalRelations,
        totalRoutes: routes.length,
        estimatedMigrationMinutes: tables.length * 5 + routes.length * 3,
      },
    }
  }

  /**
   * Create a migration plan from analysis results.
   */
  createMigrationPlan(analysis: ProjectAnalysis, selectedTables?: string[]): MigrationPlan {
    const tablesToMigrate = selectedTables
      ? analysis.tables.filter((t) => selectedTables.includes(t.name))
      : analysis.tables

    const steps: MigrationStep[] = tablesToMigrate.map((table, idx) => ({
      order: idx + 1,
      table: table.name,
      action: "create",
      description: `Create table ${table.name} with ${table.fields.length} fields`,
      sql: this.generateTableSQL(table),
      rollbackSql: `DROP TABLE IF EXISTS "${table.name}" CASCADE;`,
      status: "pending",
    }))

    const schemaCode = this.generateSchemaCode(tablesToMigrate)
    const migrationSQL = steps.map((s) => s.sql).join("\n\n")
    const functionCode = this.generateFunctionSkeletons(analysis.routes)

    return {
      id: `migration-${Date.now()}`,
      source: analysis.source === "unknown" ? "prisma" : analysis.source,
      steps,
      schemaCode,
      migrationSQL,
      functionCode,
      createdAt: Date.now(),
    }
  }

  /**
   * Generate a diff between source and target schemas.
   */
  generateDiff(analysis: ProjectAnalysis): MigrationDiff[] {
    return analysis.tables.map((table) => ({
      table: table.name,
      changes: table.fields.map((field) => ({
        type: "added" as const,
        field: field.name,
        before: `${field.sourceType}${field.isOptional ? "?" : ""}`,
        after: field.targetValidator,
      })),
    }))
  }

  // ─── Internal Helpers ──────────────────────────────────────────────────

  private parsePrismaModels(content: string): { tables: MigrationTable[]; warnings: MigrationWarning[] } {
    const tables: MigrationTable[] = []
    const warnings: MigrationWarning[] = []

    const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g
    let match: RegExpExecArray | null

    while ((match = modelRegex.exec(content)) !== null) {
      const modelName = match[1]
      const body = match[2]
      const fields: MigrationField[] = []
      const relations: MigrationRelation[] = []
      const indexes: { name: string; columns: string[]; unique: boolean }[] = []

      for (const line of body.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("//")) continue

        // Index annotations
        if (trimmed.startsWith("@@index")) {
          const idxMatch = /@@index\s*\(\[([^\]]+)\]/.exec(trimmed)
          if (idxMatch) {
            indexes.push({
              name: `idx_${modelName.toLowerCase()}_${idxMatch[1].replace(/["\s]/g, "")}`,
              columns: idxMatch[1].split(",").map((c) => c.trim().replace(/"/g, "")),
              unique: false,
            })
          }
          continue
        }
        if (trimmed.startsWith("@@unique")) {
          const uqMatch = /@@unique\s*\(\[([^\]]+)\]/.exec(trimmed)
          if (uqMatch) {
            indexes.push({
              name: `uq_${modelName.toLowerCase()}_${uqMatch[1].replace(/["\s]/g, "")}`,
              columns: uqMatch[1].split(",").map((c) => c.trim().replace(/"/g, "")),
              unique: true,
            })
          }
          continue
        }
        if (trimmed.startsWith("@@")) continue

        // Field definition
        const fieldMatch = /^(\w+)\s+(\w+)(\[\])?\s*(\?)?(.*)$/.exec(trimmed)
        if (!fieldMatch) continue

        const [, fieldName, fieldType, isList, isOpt, rest] = fieldMatch

        // Skip relation fields (they're model types)
        if (rest?.includes("@relation")) {
          const relMatch = /@relation\s*\(\s*fields:\s*\[(\w+)\]\s*,\s*references:\s*\[(\w+)\]/.exec(rest)
          if (relMatch) {
            relations.push({
              name: fieldName,
              type: isList ? "one-to-many" : "one-to-one",
              fromField: relMatch[1],
              toTable: fieldType.toLowerCase() + "s",
              toField: relMatch[2],
            })
          }
          continue
        }

        // Skip list types (relation arrays)
        if (isList) continue

        const mapped = mapPrismaType(fieldType)
        const isId = rest?.includes("@id") ?? false
        const isUnique = rest?.includes("@unique") ?? false
        const hasDefault = rest?.includes("@default") ?? false

        let defaultValue: string | undefined
        if (hasDefault) {
          const defMatch = /@default\(([^)]+)\)/.exec(rest ?? "")
          if (defMatch) defaultValue = defMatch[1]
        }

        // Skip the auto-increment id field
        if (isId && (defaultValue === "autoincrement()" || defaultValue === "cuid()" || defaultValue === "uuid()")) {
          continue
        }

        let validator = mapped.validator
        if (isOpt) validator = `v.optional(${validator})`

        fields.push({
          name: fieldName,
          sourceType: fieldType,
          targetType: mapped.tsType,
          targetValidator: validator,
          isOptional: !!isOpt,
          hasDefault,
          defaultValue,
          isId,
          isUnique,
          notes: mapped.notes,
        })

        if (mapped.notes) {
          warnings.push({ level: "info", table: modelName, field: fieldName, message: mapped.notes })
        }
      }

      tables.push({
        name: modelName.charAt(0).toLowerCase() + modelName.slice(1) + "s",
        fields,
        indexes,
        relations,
        migrated: false,
      })
    }

    return { tables, warnings }
  }

  private parseDrizzleTables(content: string): { tables: MigrationTable[]; warnings: MigrationWarning[] } {
    const tables: MigrationTable[] = []
    const warnings: MigrationWarning[] = []

    // Match pgTable/mysqlTable/sqliteTable definitions
    const tablePattern = /(?:export\s+const\s+)?(\w+)\s*=\s*(?:pg|mysql|sqlite)Table\s*\(\s*["'](\w+)["']/g
    let match: RegExpExecArray | null

    while ((match = tablePattern.exec(content)) !== null) {
      const tableName = match[2]
      const fields: MigrationField[] = []

      // Find column definitions after this table
      const afterTable = content.substring(match.index, match.index + 1000)
      const colPattern = /(\w+)\s*:\s*(\w+)\s*\(\s*(?:["'](\w+)["'])?\s*\)/g
      let colMatch: RegExpExecArray | null

      while ((colMatch = colPattern.exec(afterTable)) !== null) {
        const colName = colMatch[1]
        const colType = colMatch[2]

        if (colType === "pgTable" || colType === "index" || colType === "uniqueIndex") continue

        const mapped = mapDrizzleType(colType)
        fields.push({
          name: colName,
          sourceType: colType,
          targetType: mapped.tsType,
          targetValidator: mapped.validator,
          isOptional: false,
          hasDefault: false,
          isId: colName === "id",
          isUnique: false,
          notes: mapped.notes,
        })
      }

      tables.push({
        name: tableName,
        fields,
        indexes: [],
        relations: [],
        migrated: false,
      })
    }

    return { tables, warnings }
  }

  private generateTableSQL(table: MigrationTable): string {
    const columns = table.fields.map((f) => {
      let sql = `  "${f.name}" `
      switch (f.targetType) {
        case "string":
          sql += "TEXT"
          break
        case "number":
          sql += "DOUBLE PRECISION"
          break
        case "boolean":
          sql += "BOOLEAN"
          break
        case "Date":
          sql += "TIMESTAMPTZ"
          break
        default:
          sql += "TEXT"
      }
      if (!f.isOptional) sql += " NOT NULL"
      if (f.defaultValue) sql += ` DEFAULT ${sanitizeDefaultValue(f.defaultValue)}`
      return sql
    })

    let sql = `CREATE TABLE IF NOT EXISTS "${table.name}" (\n`
    sql += `  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),\n`
    sql += columns.join(",\n")
    sql += "\n);"

    for (const idx of table.indexes) {
      const cols = idx.columns.map((c) => `"${c}"`).join(", ")
      sql += `\nCREATE ${idx.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${idx.name} ON "${table.name}" (${cols});`
    }

    return sql
  }

  private generateSchemaCode(tables: MigrationTable[]): string {
    const lines: string[] = []
    lines.push('import { defineSchema, defineTable, v } from "@reactivebase/server"')
    lines.push("")
    lines.push("export default defineSchema({")

    for (const table of tables) {
      lines.push(`  ${table.name}: defineTable({`)
      for (const field of table.fields) {
        lines.push(`    ${field.name}: ${field.targetValidator},${field.notes ? ` // ${field.notes}` : ""}`)
      }
      lines.push("  })")

      for (const idx of table.indexes) {
        lines.push(
          `    .index("${idx.name}", [${idx.columns.map((c) => `"${c}"`).join(", ")}]${idx.unique ? ", { unique: true }" : ""}`,
        )
      }

      lines.push("  ,")
    }

    lines.push("})")
    return lines.join("\n")
  }

  private generateFunctionSkeletons(routes: DiscoveredRoute[]): string {
    if (routes.length === 0) return "// No API routes found to convert\n"

    const lines: string[] = []
    lines.push('import { query, mutation, action } from "@reactivebase/server"')
    lines.push("")

    for (const route of routes) {
      lines.push(`// Migrated from: ${route.sourceFile} (${route.method} ${route.path})`)
      lines.push(route.skeleton)
      lines.push("")
    }

    return lines.join("\n")
  }
}
