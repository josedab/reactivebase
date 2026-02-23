/**
 * Prisma schema parser and ReactiveBase schema code generator.
 * Converts Prisma schema files to ReactiveBase defineSchema() calls.
 *
 * Parses a subset of Prisma schema language:
 * - model definitions → defineTable()
 * - field types → v.string(), v.number(), etc.
 * - @id, @unique, @default → indexes, defaults
 * - @relation → relation()
 * - @@index, @@unique → index()
 */

export interface PrismaModel {
  name: string
  fields: PrismaField[]
  indexes: PrismaIndex[]
}

export interface PrismaField {
  name: string
  type: string
  isOptional: boolean
  isList: boolean
  isId: boolean
  isUnique: boolean
  default?: string
  relation?: { fields: string[]; references: string[] }
}

export interface PrismaIndex {
  name?: string
  fields: string[]
  unique: boolean
}

/**
 * Parse a Prisma schema string into model definitions.
 */
export function parsePrismaSchema(schema: string): PrismaModel[] {
  const models: PrismaModel[] = []
  const lines = schema.split("\n")
  let currentModel: PrismaModel | null = null
  let braceDepth = 0

  for (const rawLine of lines) {
    const line = rawLine.trim()

    // Skip empty lines and comments
    if (!line || line.startsWith("//") || line.startsWith("generator") || line.startsWith("datasource")) {
      if (line.includes("{")) braceDepth++
      if (line.includes("}")) braceDepth--
      continue
    }

    // Model start
    const modelMatch = line.match(/^model\s+(\w+)\s*\{/)
    if (modelMatch) {
      currentModel = { name: modelMatch[1], fields: [], indexes: [] }
      braceDepth++
      continue
    }

    // Enum / other blocks
    if (line.match(/^(enum|type)\s+\w+\s*\{/)) {
      braceDepth++
      continue
    }

    if (line === "}" || line.startsWith("}")) {
      braceDepth--
      if (currentModel && braceDepth === 0) {
        models.push(currentModel)
        currentModel = null
      }
      continue
    }

    if (!currentModel) continue

    // @@index or @@unique
    const indexMatch = line.match(/@@(index|unique)\(\[([^\]]+)\](?:,\s*name:\s*"([^"]+)")?\)/)
    if (indexMatch) {
      currentModel.indexes.push({
        fields: indexMatch[2].split(",").map((f) => f.trim()),
        unique: indexMatch[1] === "unique",
        name: indexMatch[3],
      })
      continue
    }

    // Field definition
    const fieldMatch = line.match(/^(\w+)\s+(\w+)(\?)?(\[\])?(.*)$/)
    if (fieldMatch) {
      const [, name, type, optional, isList, rest] = fieldMatch

      // Skip relation fields (the model reference side)
      if (type[0] === type[0].toUpperCase() && !isPrismaScalarType(type)) {
        // Check for @relation
        const relMatch = rest?.match(/@relation\(.*fields:\s*\[([^\]]+)\].*references:\s*\[([^\]]+)\]/)
        if (relMatch) {
          // Find the FK field and annotate it
          const fkFields = relMatch[1].split(",").map((f) => f.trim())
          const refFields = relMatch[2].split(",").map((f) => f.trim())
          for (const fk of fkFields) {
            const existing = currentModel.fields.find((f) => f.name === fk)
            if (existing) {
              existing.relation = { fields: fkFields, references: refFields }
            }
          }
        }
        continue
      }

      const field: PrismaField = {
        name,
        type,
        isOptional: !!optional,
        isList: !!isList,
        isId: rest?.includes("@id") ?? false,
        isUnique: rest?.includes("@unique") ?? false,
      }

      // Parse @default — handle nested parens like now()
      const defaultMatch = rest?.match(/@default\((.+?)\)\s*(?:@|$)/) ?? rest?.match(/@default\((.+)\)/)
      if (defaultMatch) {
        field.default = defaultMatch[1]
      }

      currentModel.fields.push(field)
    }
  }

  return models
}

function isPrismaScalarType(type: string): boolean {
  return ["String", "Int", "Float", "Boolean", "DateTime", "Json", "BigInt", "Decimal", "Bytes"].includes(type)
}

/**
 * Map Prisma field type to ReactiveBase validator call.
 */
function mapFieldToValidator(field: PrismaField, referencedTable?: string): string {
  let validator: string

  switch (field.type) {
    case "String":
      if (referencedTable) {
        validator = `v.id("${referencedTable}")`
      } else {
        validator = "v.string()"
      }
      break
    case "Int":
      validator = "v.integer()"
      break
    case "Float":
    case "Decimal":
      validator = "v.number()"
      break
    case "Boolean":
      if (field.default === "false") {
        validator = "v.boolean({ default: false })"
      } else if (field.default === "true") {
        validator = "v.boolean({ default: true })"
      } else {
        validator = "v.boolean()"
      }
      break
    case "DateTime":
      if (field.default === "now()") {
        validator = 'v.timestamp({ default: "now" })'
      } else {
        validator = "v.timestamp()"
      }
      break
    case "Json":
      validator = "v.json()"
      break
    case "BigInt":
      validator = "v.integer()"
      break
    default:
      validator = `v.string() /* Prisma type: ${field.type} */`
  }

  if (field.isList) {
    validator = `v.array(${validator})`
  }

  if (field.isOptional) {
    validator = `v.optional(${validator})`
  }

  return validator
}

/**
 * Generate ReactiveBase schema code from parsed Prisma models.
 */
export function generateReactiveBaseSchema(models: PrismaModel[]): string {
  const lines: string[] = []

  lines.push('import { defineSchema, defineTable, v } from "@reactivebase/server"')
  lines.push("")
  lines.push("export default defineSchema({")

  // Build a map of FK relationships for foreign key detection
  const fkMap = new Map<string, string>() // fieldName → referenced table
  for (const model of models) {
    for (const field of model.fields) {
      if (field.relation) {
        // Find the model that the FK references
        const refModel = models.find((m) => m.fields.some((f) => f.isId && field.relation!.references.includes(f.name)))
        if (refModel) {
          fkMap.set(`${model.name}.${field.name}`, camelCase(refModel.name))
        }
      }
    }
  }

  for (let i = 0; i < models.length; i++) {
    const model = models[i]
    const tableName = camelCase(model.name)

    lines.push(`  ${tableName}: defineTable({`)

    // Generate fields (skip the @id field as ReactiveBase auto-adds id)
    for (const field of model.fields) {
      if (field.isId) continue

      const refTable = fkMap.get(`${model.name}.${field.name}`)
      const validator = mapFieldToValidator(field, refTable)
      lines.push(`    ${field.name}: ${validator},`)
    }

    let chain = "  })"

    // Generate indexes
    for (const index of model.indexes) {
      const indexName = index.name ?? `by_${index.fields.join("_")}`
      const fields = index.fields.map((f) => `"${f}"`).join(", ")
      const opts = index.unique ? ", { unique: true }" : ""
      chain += `\n    .index("${indexName}", [${fields}]${opts})`
    }

    // Add unique field indexes
    for (const field of model.fields) {
      if (field.isUnique && !field.isId) {
        chain += `\n    .index("by_${field.name}", ["${field.name}"], { unique: true })`
      }
    }

    chain += i < models.length - 1 ? "," : ","
    lines.push(chain)
    lines.push("")
  }

  lines.push("})")
  lines.push("")

  return lines.join("\n")
}

function camelCase(name: string): string {
  // PascalCase → camelCase
  return name.charAt(0).toLowerCase() + name.slice(1)
}

/**
 * Convert a Prisma schema file to ReactiveBase schema code.
 */
export function convertPrismaToReactiveBase(prismaSchema: string): string {
  const models = parsePrismaSchema(prismaSchema)
  return generateReactiveBaseSchema(models)
}
