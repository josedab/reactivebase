/**
 * Multi-Model Query Interface for ReactiveBase.
 * Supports relational, document (JSONB), and graph query patterns over PostgreSQL.
 *
 * Features:
 *   - Relational queries with joins, aggregations, and window functions
 *   - Document queries (MongoDB-like) using PostgreSQL JSONB
 *   - Graph queries for relationship traversal using recursive CTEs
 *   - Unified query builder API across all models
 *   - SQL generation for all query patterns
 *
 * Usage:
 *   const qb = new MultiModelQueryBuilder()
 *   // Relational
 *   const rel = qb.relational("users").where({ active: true }).join("orders", "users.id", "orders.user_id").build()
 *   // Document
 *   const doc = qb.document("profiles").match({ "settings.theme": "dark" }).build()
 *   // Graph
 *   const graph = qb.graph("employees").traverse("reports_to", { depth: 3 }).build()
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QueryResult {
  sql: string
  params: unknown[]
  model: "relational" | "document" | "graph"
}

export interface RelationalJoin {
  type: "inner" | "left" | "right" | "full"
  table: string
  on: string
  alias?: string
}

export interface WhereCondition {
  column: string
  operator: string
  value: unknown
}

export interface OrderByClause {
  column: string
  direction: "asc" | "desc"
  nulls?: "first" | "last"
}

export interface DocumentMatch {
  path: string
  operator: "=" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "exists" | "type"
  value: unknown
}

export interface GraphTraversal {
  edgeTable: string
  sourceColumn: string
  targetColumn: string
  direction: "outbound" | "inbound" | "both"
  maxDepth: number
  filter?: Record<string, unknown>
}

// ─── Relational Query Builder ────────────────────────────────────────────────

export class RelationalQueryBuilder {
  private table: string
  private selectCols: string[] = ["*"]
  private whereConds: WhereCondition[] = []
  private joins: RelationalJoin[] = []
  private orderByClauses: OrderByClause[] = []
  private groupByCols: string[] = []
  private havingConds: string[] = []
  private limitVal: number | null = null
  private offsetVal: number | null = null
  private distinctFlag = false
  private windowFns: string[] = []

  constructor(table: string) {
    this.table = table
  }

  select(...columns: string[]): this {
    this.selectCols = columns
    return this
  }

  distinct(): this {
    this.distinctFlag = true
    return this
  }

  where(conditions: Record<string, unknown>): this {
    for (const [col, val] of Object.entries(conditions)) {
      this.whereConds.push({ column: col, operator: "=", value: val })
    }
    return this
  }

  whereRaw(column: string, operator: string, value: unknown): this {
    this.whereConds.push({ column, operator, value })
    return this
  }

  join(table: string, leftCol: string, rightCol: string, type: RelationalJoin["type"] = "inner"): this {
    this.joins.push({ type, table, on: `"${sanitize(leftCol)}" = "${sanitize(rightCol)}"` })
    return this
  }

  leftJoin(table: string, leftCol: string, rightCol: string): this {
    return this.join(table, leftCol, rightCol, "left")
  }

  orderBy(column: string, direction: "asc" | "desc" = "asc"): this {
    this.orderByClauses.push({ column, direction })
    return this
  }

  groupBy(...columns: string[]): this {
    this.groupByCols = columns
    return this
  }

  having(condition: string): this {
    this.havingConds.push(condition)
    return this
  }

  limit(n: number): this {
    this.limitVal = n
    return this
  }

  offset(n: number): this {
    this.offsetVal = n
    return this
  }

  window(name: string, partitionBy: string, orderBy: string): this {
    this.windowFns.push(
      `"${sanitize(name)}" AS (PARTITION BY "${sanitize(partitionBy)}" ORDER BY "${sanitize(orderBy)}")`,
    )
    return this
  }

  build(): QueryResult {
    const params: unknown[] = []
    const parts: string[] = []

    // SELECT
    const distinct = this.distinctFlag ? "DISTINCT " : ""
    parts.push(`SELECT ${distinct}${this.selectCols.join(", ")}`)

    // FROM
    parts.push(`FROM "${sanitize(this.table)}"`)

    // JOINs
    for (const j of this.joins) {
      parts.push(`${j.type.toUpperCase()} JOIN "${sanitize(j.table)}" ON ${j.on}`)
    }

    // WHERE
    if (this.whereConds.length > 0) {
      const conditions = this.whereConds.map((c) => {
        params.push(c.value)
        return `"${sanitize(c.column)}" ${c.operator} $${params.length}`
      })
      parts.push(`WHERE ${conditions.join(" AND ")}`)
    }

    // GROUP BY
    if (this.groupByCols.length > 0) {
      parts.push(`GROUP BY ${this.groupByCols.map((c) => `"${sanitize(c)}"`).join(", ")}`)
    }

    // HAVING
    if (this.havingConds.length > 0) {
      parts.push(`HAVING ${this.havingConds.join(" AND ")}`)
    }

    // WINDOW
    if (this.windowFns.length > 0) {
      parts.push(`WINDOW ${this.windowFns.join(", ")}`)
    }

    // ORDER BY
    if (this.orderByClauses.length > 0) {
      const orderings = this.orderByClauses.map(
        (o) =>
          `"${sanitize(o.column)}" ${o.direction.toUpperCase()}${o.nulls ? ` NULLS ${o.nulls.toUpperCase()}` : ""}`,
      )
      parts.push(`ORDER BY ${orderings.join(", ")}`)
    }

    // LIMIT / OFFSET
    if (this.limitVal !== null) {
      params.push(this.limitVal)
      parts.push(`LIMIT $${params.length}`)
    }
    if (this.offsetVal !== null) {
      params.push(this.offsetVal)
      parts.push(`OFFSET $${params.length}`)
    }

    return { sql: parts.join("\n"), params, model: "relational" }
  }
}

// ─── Document Query Builder ──────────────────────────────────────────────────

export class DocumentQueryBuilder {
  private table: string
  private jsonColumn: string
  private matches: DocumentMatch[] = []
  private projections: string[] = []
  private sortFields: Array<{ path: string; direction: "asc" | "desc" }> = []
  private limitVal: number | null = null
  private offsetVal: number | null = null
  private unwindPath: string | null = null

  constructor(table: string, jsonColumn = "data") {
    this.table = table
    this.jsonColumn = jsonColumn
  }

  /**
   * Match documents by JSON path conditions.
   */
  match(conditions: Record<string, unknown>): this {
    for (const [path, value] of Object.entries(conditions)) {
      this.matches.push({ path, operator: "=", value })
    }
    return this
  }

  /**
   * Match with specific operator.
   */
  matchOp(path: string, operator: DocumentMatch["operator"], value: unknown): this {
    this.matches.push({ path, operator, value })
    return this
  }

  /**
   * Project specific JSON paths.
   */
  project(...paths: string[]): this {
    this.projections = paths
    return this
  }

  /**
   * Sort by JSON path.
   */
  sort(path: string, direction: "asc" | "desc" = "asc"): this {
    this.sortFields.push({ path, direction })
    return this
  }

  /**
   * Unwind (flatten) a JSON array field.
   */
  unwind(path: string): this {
    this.unwindPath = path
    return this
  }

  limit(n: number): this {
    this.limitVal = n
    return this
  }

  offset(n: number): this {
    this.offsetVal = n
    return this
  }

  build(): QueryResult {
    const params: unknown[] = []
    const col = `"${sanitize(this.jsonColumn)}"`
    const parts: string[] = []

    // SELECT
    if (this.projections.length > 0) {
      const projCols = this.projections.map((p) => {
        const jsonPath = buildJsonPath(col, p)
        return `${jsonPath} AS "${sanitize(p.replace(/\./g, "_"))}"`
      })
      parts.push(`SELECT "id", ${projCols.join(", ")}`)
    } else {
      parts.push(`SELECT "id", ${col}`)
    }

    // FROM (with optional LATERAL unwind)
    if (this.unwindPath) {
      const arrayPath = buildJsonPath(col, this.unwindPath)
      parts.push(`FROM "${sanitize(this.table)}", LATERAL jsonb_array_elements(${arrayPath}) AS unwound(element)`)
    } else {
      parts.push(`FROM "${sanitize(this.table)}"`)
    }

    // WHERE (JSON conditions)
    if (this.matches.length > 0) {
      const conditions = this.matches.map((m) => {
        const jsonPath = buildJsonPath(col, m.path)

        switch (m.operator) {
          case "=":
            params.push(JSON.stringify(m.value))
            return `${jsonPath} = $${params.length}::jsonb`
          case "!=":
            params.push(JSON.stringify(m.value))
            return `${jsonPath} != $${params.length}::jsonb`
          case ">":
            params.push(m.value)
            return `(${jsonPath})::numeric > $${params.length}`
          case "<":
            params.push(m.value)
            return `(${jsonPath})::numeric < $${params.length}`
          case ">=":
            params.push(m.value)
            return `(${jsonPath})::numeric >= $${params.length}`
          case "<=":
            params.push(m.value)
            return `(${jsonPath})::numeric <= $${params.length}`
          case "contains":
            params.push(JSON.stringify(m.value))
            return `${jsonPath} @> $${params.length}::jsonb`
          case "exists":
            return `${jsonPath} IS NOT NULL`
          case "type":
            params.push(m.value)
            return `jsonb_typeof(${jsonPath}) = $${params.length}`
          default:
            params.push(JSON.stringify(m.value))
            return `${jsonPath} = $${params.length}::jsonb`
        }
      })
      parts.push(`WHERE ${conditions.join(" AND ")}`)
    }

    // ORDER BY
    if (this.sortFields.length > 0) {
      const orderings = this.sortFields.map((s) => `${buildJsonPath(col, s.path)} ${s.direction.toUpperCase()}`)
      parts.push(`ORDER BY ${orderings.join(", ")}`)
    }

    // LIMIT / OFFSET
    if (this.limitVal !== null) {
      params.push(this.limitVal)
      parts.push(`LIMIT $${params.length}`)
    }
    if (this.offsetVal !== null) {
      params.push(this.offsetVal)
      parts.push(`OFFSET $${params.length}`)
    }

    return { sql: parts.join("\n"), params, model: "document" }
  }
}

// ─── Graph Query Builder ─────────────────────────────────────────────────────

export class GraphQueryBuilder {
  private nodeTable: string
  private edgeTable: string | null = null
  private sourceCol = "source_id"
  private targetCol = "target_id"
  private traversals: GraphTraversal[] = []
  private startNodeFilter: Record<string, unknown> = {}
  private selectCols: string[] = ["*"]
  private limitVal: number | null = null

  constructor(nodeTable: string) {
    this.nodeTable = nodeTable
  }

  /**
   * Set the edge table for traversals.
   */
  edges(table: string, sourceCol = "source_id", targetCol = "target_id"): this {
    this.edgeTable = table
    this.sourceCol = sourceCol
    this.targetCol = targetCol
    return this
  }

  /**
   * Traverse relationships from starting nodes.
   */
  traverse(direction: "outbound" | "inbound" | "both" = "outbound", maxDepth = 3): this {
    if (!this.edgeTable) {
      throw new MultiModelError("Edge table must be set before traversal. Call .edges() first.")
    }
    this.traversals.push({
      edgeTable: this.edgeTable,
      sourceColumn: this.sourceCol,
      targetColumn: this.targetCol,
      direction,
      maxDepth,
    })
    return this
  }

  /**
   * Filter starting nodes.
   */
  startFrom(conditions: Record<string, unknown>): this {
    this.startNodeFilter = conditions
    return this
  }

  select(...columns: string[]): this {
    this.selectCols = columns
    return this
  }

  limit(n: number): this {
    this.limitVal = n
    return this
  }

  build(): QueryResult {
    const params: unknown[] = []
    const parts: string[] = []

    if (this.traversals.length === 0) {
      // Simple node query
      parts.push(`SELECT ${this.selectCols.join(", ")}`)
      parts.push(`FROM "${sanitize(this.nodeTable)}"`)

      if (Object.keys(this.startNodeFilter).length > 0) {
        const conditions = Object.entries(this.startNodeFilter).map(([col, val]) => {
          params.push(val)
          return `"${sanitize(col)}" = $${params.length}`
        })
        parts.push(`WHERE ${conditions.join(" AND ")}`)
      }
    } else {
      // Recursive CTE for graph traversal
      const traversal = this.traversals[0]
      const edge = sanitize(traversal.edgeTable)
      const src = sanitize(traversal.sourceColumn)
      const tgt = sanitize(traversal.targetColumn)
      const node = sanitize(this.nodeTable)

      // Starting conditions
      const startConditions: string[] = []
      for (const [col, val] of Object.entries(this.startNodeFilter)) {
        params.push(val)
        startConditions.push(`n."${sanitize(col)}" = $${params.length}`)
      }
      const startWhere = startConditions.length > 0 ? `WHERE ${startConditions.join(" AND ")}` : ""

      const joinExpr = traversal.direction === "inbound" ? `e."${tgt}" = g.node_id` : `e."${src}" = g.node_id`

      const nextNode = traversal.direction === "inbound" ? `e."${src}"` : `e."${tgt}"`

      params.push(traversal.maxDepth)
      const depthParam = `$${params.length}`

      parts.push(`WITH RECURSIVE graph_traversal AS (`)
      parts.push(`  -- Base case: starting nodes`)
      parts.push(`  SELECT n."id" AS node_id, 0 AS depth, ARRAY[n."id"] AS path`)
      parts.push(`  FROM "${node}" n`)
      if (startWhere) parts.push(`  ${startWhere}`)
      parts.push(`  UNION ALL`)
      parts.push(`  -- Recursive case: traverse edges`)
      parts.push(`  SELECT ${nextNode} AS node_id, g.depth + 1, g.path || ${nextNode}`)
      parts.push(`  FROM graph_traversal g`)
      parts.push(`  JOIN "${edge}" e ON ${joinExpr}`)
      parts.push(`  WHERE g.depth < ${depthParam}`)
      parts.push(`    AND NOT ${nextNode} = ANY(g.path)`) // Cycle prevention
      parts.push(`)`)
      parts.push(`SELECT DISTINCT n.${this.selectCols.join(", n.")}, g.depth, g.path`)
      parts.push(`FROM graph_traversal g`)
      parts.push(`JOIN "${node}" n ON n."id" = g.node_id`)
      parts.push(`ORDER BY g.depth`)
    }

    if (this.limitVal !== null) {
      params.push(this.limitVal)
      parts.push(`LIMIT $${params.length}`)
    }

    return { sql: parts.join("\n"), params, model: "graph" }
  }
}

// ─── Unified Query Builder ───────────────────────────────────────────────────

export class MultiModelQueryBuilder {
  /**
   * Create a relational (SQL) query builder.
   */
  relational(table: string): RelationalQueryBuilder {
    return new RelationalQueryBuilder(table)
  }

  /**
   * Create a document (JSONB) query builder.
   */
  document(table: string, jsonColumn = "data"): DocumentQueryBuilder {
    return new DocumentQueryBuilder(table, jsonColumn)
  }

  /**
   * Create a graph query builder.
   */
  graph(nodeTable: string): GraphQueryBuilder {
    return new GraphQueryBuilder(nodeTable)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildJsonPath(column: string, path: string): string {
  const segments = path.split(".")
  if (segments.length === 1) {
    return `${column}->>'${sanitize(segments[0])}'`
  }
  const intermediate = segments
    .slice(0, -1)
    .map((s) => `'${sanitize(s)}'`)
    .join("->")
  return `${column}->${intermediate}->>'${sanitize(segments[segments.length - 1])}'`
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.]/g, "")
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class MultiModelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MultiModelError"
  }
}
