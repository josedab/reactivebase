/**
 * Relation resolver - generates SQL for eager-loading relations
 * using LATERAL JOINs for efficient nested data loading.
 */

import type { Schema } from "../schema/index.js"
import type { RelationDefinition } from "../schema/table.js"
import type { IncludeConfig, OrderDirection } from "./query-builder.js"

export interface ResolvedRelation {
  relation: RelationDefinition
  targetTable: string
  sourceColumn: string
  targetColumn: string
  config: IncludeConfig
}

/**
 * Resolve relation definitions from schema for a given table.
 */
export function resolveRelations(
  schema: Schema,
  tableName: string,
  includes: Record<string, IncludeConfig>,
): ResolvedRelation[] {
  const table = schema.tables[tableName]
  if (!table) return []

  const resolved: ResolvedRelation[] = []

  for (const [name, config] of Object.entries(includes)) {
    const relation = table.relations.find((r) => r.name === name)
    if (!relation) {
      throw new Error(`Relation "${name}" not found on table "${tableName}"`)
    }

    const { sourceColumn, targetTable, targetColumn } = parseRelation(relation, tableName)

    resolved.push({
      relation,
      targetTable,
      sourceColumn,
      targetColumn,
      config,
    })
  }

  return resolved
}

/**
 * Parse a relation definition into source/target columns.
 *
 * Relation formats:
 * - { from: "assigneeId", to: "users" }          → FK from this table to users.id
 * - { from: "id", to: "comments.taskId" }         → Has-many: comments.taskId → this.id
 */
function parseRelation(
  relation: RelationDefinition,
  currentTable: string,
): { sourceColumn: string; targetTable: string; targetColumn: string } {
  const toParts = relation.to.split(".")

  if (toParts.length === 2) {
    // Has-many: { from: "id", to: "comments.taskId" }
    return {
      sourceColumn: relation.from,
      targetTable: toParts[0],
      targetColumn: toParts[1],
    }
  }

  // Belongs-to: { from: "assigneeId", to: "users" }
  return {
    sourceColumn: relation.from,
    targetTable: relation.to,
    targetColumn: "id",
  }
}

/**
 * Build a lateral join subquery for a relation.
 */
export function buildIncludeSubquery(resolved: ResolvedRelation, parentAlias: string, params: unknown[]): string {
  const { targetTable, sourceColumn, targetColumn, config } = resolved

  let subquery = `SELECT json_agg(sub.*) FROM (
    SELECT "${targetTable}".*
    FROM "${targetTable}"
    WHERE "${targetTable}"."${targetColumn}" = "${parentAlias}"."${sourceColumn}"`

  // ORDER BY
  if (config.orderBy) {
    const orders = Object.entries(config.orderBy)
      .map(([col, dir]) => `"${col}" ${(dir as string).toUpperCase()}`)
      .join(", ")
    subquery += `\n    ORDER BY ${orders}`
  }

  // LIMIT
  if (config.limit !== undefined) {
    subquery += `\n    LIMIT ${config.limit}`
  }

  subquery += `\n  ) sub`

  return subquery
}

/**
 * Build a complete query with includes using lateral joins.
 */
export function buildQueryWithIncludes(
  baseSql: string,
  baseParams: unknown[],
  tableName: string,
  resolvedRelations: ResolvedRelation[],
): { sql: string; params: unknown[] } {
  if (resolvedRelations.length === 0) {
    return { sql: baseSql, params: baseParams }
  }

  const params = [...baseParams]

  // Wrap the base query and add lateral joins for each relation
  const selectParts = [`"_base".*`]
  const lateralJoins: string[] = []

  for (const resolved of resolvedRelations) {
    const alias = `_rel_${resolved.relation.name}`
    const subquery = buildIncludeSubquery(resolved, "_base", params)

    selectParts.push(`COALESCE(${alias}.data, '[]'::json) as "${resolved.relation.name}"`)
    lateralJoins.push(`LEFT JOIN LATERAL (SELECT (${subquery}) as data) "${alias}" ON true`)
  }

  const sql = `SELECT ${selectParts.join(", ")}
FROM (${baseSql}) "_base"
${lateralJoins.join("\n")}`

  return { sql, params }
}
