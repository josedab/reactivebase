/**
 * Type-safe query builder that generates parameterized SQL.
 * Tracks table access for reactivity dependency tracking.
 */

export type WhereOperator = "=" | "!=" | ">" | "<" | ">=" | "<=" | "in" | "like" | "ilike"
export type OrderDirection = "asc" | "desc"

export interface WhereClause {
  column: string
  operator: WhereOperator
  value: unknown
  paramIndex: number
}

export interface OrderByClause {
  column: string
  direction: OrderDirection
}

export interface JoinClause {
  table: string
  fromColumn: string
  toColumn: string
  type: "INNER" | "LEFT" | "RIGHT"
}

export interface VectorSearchClause {
  column: string
  embedding: number[]
  metric: "cosine" | "l2" | "inner_product"
  topK: number
}

export interface QueryPlan {
  table: string
  selectedColumns: string[]
  whereClauses: WhereClause[]
  orderByClauses: OrderByClause[]
  joinClauses: JoinClause[]
  groupByColumns: string[]
  limitValue?: number
  offsetValue?: number
  includes: Record<string, IncludeConfig>
  vectorSearch?: VectorSearchClause
}

export interface IncludeConfig {
  relation: string
  orderBy?: Record<string, OrderDirection>
  limit?: number
  include?: Record<string, IncludeConfig | boolean>
}

export interface BuiltQuery {
  sql: string
  params: unknown[]
  plan: QueryPlan
}

/**
 * Dependency information tracked during query execution for reactivity.
 */
export interface QueryDependency {
  table: string
  filters: Record<string, unknown>
}

export class QueryBuilder<TRow = Record<string, unknown>> {
  private plan: QueryPlan

  constructor(table: string) {
    this.plan = {
      table,
      selectedColumns: [],
      whereClauses: [],
      orderByClauses: [],
      joinClauses: [],
      groupByColumns: [],
      includes: {},
    }
  }

  where(
    columnOrObject: string | Partial<TRow>,
    operatorOrValue?: WhereOperator | unknown,
    value?: unknown,
  ): QueryBuilder<TRow> {
    const clone = this.clone()

    if (typeof columnOrObject === "object" && columnOrObject !== null) {
      for (const [col, val] of Object.entries(columnOrObject)) {
        clone.plan.whereClauses.push({
          column: col,
          operator: "=",
          value: val,
          paramIndex: clone.plan.whereClauses.length + 1,
        })
      }
    } else if (value !== undefined) {
      clone.plan.whereClauses.push({
        column: columnOrObject as string,
        operator: operatorOrValue as WhereOperator,
        value,
        paramIndex: clone.plan.whereClauses.length + 1,
      })
    } else {
      clone.plan.whereClauses.push({
        column: columnOrObject as string,
        operator: "=",
        value: operatorOrValue,
        paramIndex: clone.plan.whereClauses.length + 1,
      })
    }

    return clone
  }

  orderBy(column: string, direction: OrderDirection = "asc"): QueryBuilder<TRow> {
    const clone = this.clone()
    clone.plan.orderByClauses.push({ column, direction })
    return clone
  }

  limit(value: number): QueryBuilder<TRow> {
    const clone = this.clone()
    clone.plan.limitValue = value
    return clone
  }

  offset(value: number): QueryBuilder<TRow> {
    const clone = this.clone()
    clone.plan.offsetValue = value
    return clone
  }

  select(...columns: string[]): QueryBuilder<TRow> {
    const clone = this.clone()
    clone.plan.selectedColumns = columns
    return clone
  }

  join(
    table: string,
    fromColumn: string,
    toColumn?: string,
    type: "INNER" | "LEFT" | "RIGHT" = "INNER",
  ): QueryBuilder<TRow> {
    const clone = this.clone()
    clone.plan.joinClauses.push({
      table,
      fromColumn,
      toColumn: toColumn ?? "id",
      type,
    })
    return clone
  }

  groupBy(...columns: string[]): QueryBuilder<TRow> {
    const clone = this.clone()
    clone.plan.groupByColumns = columns
    return clone
  }

  include(includes: Record<string, boolean | IncludeConfig>): QueryBuilder<TRow> {
    const clone = this.clone()
    for (const [key, value] of Object.entries(includes)) {
      if (value === true) {
        clone.plan.includes[key] = { relation: key }
      } else if (value !== false) {
        clone.plan.includes[key] = value
      }
    }
    return clone
  }

  /**
   * Add vector similarity search.
   * Orders results by distance to the given embedding vector.
   */
  whereVectorSimilar(
    column: string,
    embedding: number[],
    options: { topK?: number; metric?: "cosine" | "l2" | "inner_product" } = {},
  ): QueryBuilder<TRow> {
    const clone = this.clone()
    clone.plan.vectorSearch = {
      column,
      embedding,
      metric: options.metric ?? "cosine",
      topK: options.topK ?? 10,
    }
    return clone
  }

  /**
   * Build the SQL query and parameters.
   */
  build(): BuiltQuery {
    const params: unknown[] = []
    const parts: string[] = []

    // SELECT
    const columns =
      this.plan.selectedColumns.length > 0
        ? this.plan.selectedColumns.map((c) => `"${c}"`).join(", ")
        : `"${this.plan.table}".*`
    parts.push(`SELECT ${columns}`)

    // FROM
    parts.push(`FROM "${this.plan.table}"`)

    // JOINs
    for (const join of this.plan.joinClauses) {
      parts.push(
        `${join.type} JOIN "${join.table}" ON "${this.plan.table}"."${join.fromColumn}" = "${join.table}"."${join.toColumn}"`,
      )
    }

    // WHERE
    if (this.plan.whereClauses.length > 0) {
      const conditions = this.plan.whereClauses.map((clause) => {
        params.push(clause.value)
        const paramRef = `$${params.length}`

        if (clause.operator === "in") {
          return `"${clause.column}" = ANY(${paramRef})`
        }
        return `"${clause.column}" ${clause.operator} ${paramRef}`
      })
      parts.push(`WHERE ${conditions.join(" AND ")}`)
    }

    // GROUP BY
    if (this.plan.groupByColumns.length > 0) {
      parts.push(`GROUP BY ${this.plan.groupByColumns.map((c) => `"${c}"`).join(", ")}`)
    }

    // ORDER BY (vector search overrides if present)
    if (this.plan.vectorSearch) {
      const vs = this.plan.vectorSearch
      params.push(`[${vs.embedding.join(",")}]`)
      const paramRef = `$${params.length}`

      const distanceOp: Record<string, string> = {
        cosine: "<=>",
        l2: "<->",
        inner_product: "<#>",
      }
      const op = distanceOp[vs.metric] ?? "<=>"
      parts.push(`ORDER BY "${vs.column}" ${op} ${paramRef}`)

      // Vector search implies a limit
      if (this.plan.limitValue === undefined) {
        parts.push(`LIMIT ${vs.topK}`)
      }
    } else if (this.plan.orderByClauses.length > 0) {
      const orders = this.plan.orderByClauses.map((o) => `"${o.column}" ${o.direction.toUpperCase()}`)
      parts.push(`ORDER BY ${orders.join(", ")}`)
    }

    // LIMIT
    if (this.plan.limitValue !== undefined) {
      parts.push(`LIMIT ${this.plan.limitValue}`)
    }

    // OFFSET
    if (this.plan.offsetValue !== undefined) {
      parts.push(`OFFSET ${this.plan.offsetValue}`)
    }

    return {
      sql: parts.join("\n"),
      params,
      plan: { ...this.plan },
    }
  }

  /**
   * Extract dependency information for reactivity tracking.
   */
  getDependencies(): QueryDependency[] {
    const deps: QueryDependency[] = []
    const filters: Record<string, unknown> = {}

    for (const clause of this.plan.whereClauses) {
      if (clause.operator === "=") {
        filters[clause.column] = clause.value
      }
    }

    deps.push({ table: this.plan.table, filters })

    // Joined tables are also dependencies
    for (const join of this.plan.joinClauses) {
      deps.push({ table: join.table, filters: {} })
    }

    return deps
  }

  private clone(): QueryBuilder<TRow> {
    const cloned = new QueryBuilder<TRow>(this.plan.table)
    cloned.plan = {
      ...this.plan,
      selectedColumns: [...this.plan.selectedColumns],
      whereClauses: [...this.plan.whereClauses],
      orderByClauses: [...this.plan.orderByClauses],
      joinClauses: [...this.plan.joinClauses],
      groupByColumns: [...this.plan.groupByColumns],
      includes: { ...this.plan.includes },
      vectorSearch: this.plan.vectorSearch ? { ...this.plan.vectorSearch } : undefined,
    }
    return cloned
  }
}

/**
 * Count query builder - returns COUNT(*) instead of rows.
 */
export class CountQueryBuilder {
  private queryBuilder: QueryBuilder

  constructor(queryBuilder: QueryBuilder) {
    this.queryBuilder = queryBuilder
  }

  build(): BuiltQuery {
    const base = this.queryBuilder.build()
    const sql = base.sql.replace(/^SELECT .+?\n/m, 'SELECT COUNT(*) as "count"\n')
    return { sql, params: base.params, plan: base.plan }
  }
}

export function createQueryBuilder<TRow>(table: string): QueryBuilder<TRow> {
  return new QueryBuilder<TRow>(table)
}

// ─── Aggregate Query Builder ─────────────────────────────────────────────────

export type AggregateFunction = "count" | "sum" | "avg" | "min" | "max"

export interface AggregationColumn {
  fn: AggregateFunction
  column: string
  alias: string
  distinct?: boolean
}

export interface HavingClause {
  fn: AggregateFunction
  column: string
  operator: WhereOperator
  value: unknown
}

export interface AggregateResult {
  sql: string
  params: unknown[]
  groupByColumns: string[]
  aggregations: AggregationColumn[]
}

/**
 * Fluent aggregate query builder supporting count, sum, avg, min, max,
 * groupBy, and having — all reactive through the dependency tracking system.
 */
export class AggregateQueryBuilder<TRow = Record<string, unknown>> {
  private table: string
  private aggregations: AggregationColumn[] = []
  private _groupBy: string[] = []
  private _having: HavingClause[] = []
  private _where: WhereClause[] = []
  private _joins: JoinClause[] = []

  constructor(table: string) {
    this.table = table
  }

  /** Count rows or a specific column. */
  count(column: string = "*", alias?: string): AggregateQueryBuilder<TRow> {
    this.aggregations.push({ fn: "count", column, alias: alias ?? `${column}_count` })
    return this
  }

  /** Count distinct values of a column. */
  countDistinct(column: string, alias?: string): AggregateQueryBuilder<TRow> {
    this.aggregations.push({ fn: "count", column, alias: alias ?? `${column}_distinct_count`, distinct: true })
    return this
  }

  /** Sum values of a column. */
  sum(column: string, alias?: string): AggregateQueryBuilder<TRow> {
    this.aggregations.push({ fn: "sum", column, alias: alias ?? `${column}_sum` })
    return this
  }

  /** Average values of a column. */
  avg(column: string, alias?: string): AggregateQueryBuilder<TRow> {
    this.aggregations.push({ fn: "avg", column, alias: alias ?? `${column}_avg` })
    return this
  }

  /** Minimum value of a column. */
  min(column: string, alias?: string): AggregateQueryBuilder<TRow> {
    this.aggregations.push({ fn: "min", column, alias: alias ?? `${column}_min` })
    return this
  }

  /** Maximum value of a column. */
  max(column: string, alias?: string): AggregateQueryBuilder<TRow> {
    this.aggregations.push({ fn: "max", column, alias: alias ?? `${column}_max` })
    return this
  }

  /** Group results by one or more columns. */
  groupBy(...columns: string[]): AggregateQueryBuilder<TRow> {
    this._groupBy.push(...columns)
    return this
  }

  /** Filter aggregated results (SQL HAVING clause). */
  having(fn: AggregateFunction, column: string, operator: WhereOperator, value: unknown): AggregateQueryBuilder<TRow> {
    this._having.push({ fn, column, operator, value })
    return this
  }

  /** Filter source rows before aggregation. */
  where(
    columnOrObject: string | Partial<TRow>,
    operatorOrValue?: WhereOperator | unknown,
    value?: unknown,
  ): AggregateQueryBuilder<TRow> {
    if (typeof columnOrObject === "object" && columnOrObject !== null) {
      for (const [col, val] of Object.entries(columnOrObject)) {
        this._where.push({
          column: col,
          operator: "=",
          value: val,
          paramIndex: this._where.length + 1,
        })
      }
    } else if (value !== undefined) {
      this._where.push({
        column: columnOrObject as string,
        operator: operatorOrValue as WhereOperator,
        value,
        paramIndex: this._where.length + 1,
      })
    } else {
      this._where.push({
        column: columnOrObject as string,
        operator: "=",
        value: operatorOrValue,
        paramIndex: this._where.length + 1,
      })
    }
    return this
  }

  /** Join another table for cross-table aggregations. */
  join(
    table: string,
    fromColumn: string,
    toColumn?: string,
    type: "INNER" | "LEFT" | "RIGHT" = "INNER",
  ): AggregateQueryBuilder<TRow> {
    this._joins.push({ table, fromColumn, toColumn: toColumn ?? "id", type })
    return this
  }

  /** Build the aggregate SQL query. */
  build(): AggregateResult {
    if (this.aggregations.length === 0) {
      throw new Error("At least one aggregation (count, sum, avg, min, max) is required")
    }

    const params: unknown[] = []
    const parts: string[] = []

    // SELECT: group by columns + aggregation functions
    const selectParts: string[] = []
    for (const col of this._groupBy) {
      selectParts.push(`"${col}"`)
    }
    for (const agg of this.aggregations) {
      const col = agg.column === "*" ? "*" : `"${agg.column}"`
      const distinctPrefix = agg.distinct ? "DISTINCT " : ""
      selectParts.push(`${agg.fn.toUpperCase()}(${distinctPrefix}${col}) AS "${agg.alias}"`)
    }
    parts.push(`SELECT ${selectParts.join(", ")}`)

    // FROM
    parts.push(`FROM "${this.table}"`)

    // JOINs
    for (const join of this._joins) {
      parts.push(
        `${join.type} JOIN "${join.table}" ON "${this.table}"."${join.fromColumn}" = "${join.table}"."${join.toColumn}"`,
      )
    }

    // WHERE
    if (this._where.length > 0) {
      const conditions = this._where.map((clause) => {
        params.push(clause.value)
        const paramRef = `$${params.length}`
        if (clause.operator === "in") {
          return `"${clause.column}" = ANY(${paramRef})`
        }
        return `"${clause.column}" ${clause.operator} ${paramRef}`
      })
      parts.push(`WHERE ${conditions.join(" AND ")}`)
    }

    // GROUP BY
    if (this._groupBy.length > 0) {
      parts.push(`GROUP BY ${this._groupBy.map((c) => `"${c}"`).join(", ")}`)
    }

    // HAVING
    if (this._having.length > 0) {
      const havingClauses = this._having.map((h) => {
        params.push(h.value)
        const col = h.column === "*" ? "*" : `"${h.column}"`
        return `${h.fn.toUpperCase()}(${col}) ${h.operator} $${params.length}`
      })
      parts.push(`HAVING ${havingClauses.join(" AND ")}`)
    }

    return {
      sql: parts.join("\n"),
      params,
      groupByColumns: [...this._groupBy],
      aggregations: [...this.aggregations],
    }
  }

  /** Extract dependency information for reactivity tracking. */
  getDependencies(): QueryDependency[] {
    const deps: QueryDependency[] = [{ table: this.table, filters: {} }]
    for (const join of this._joins) {
      deps.push({ table: join.table, filters: {} })
    }
    return deps
  }
}
