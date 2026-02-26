/**
 * Reactive Full-Text Search with Highlighting.
 *
 * First-class integration with Postgres tsvector/tsquery and pg_trgm for fuzzy matching.
 * Reactive search queries that auto-update results as documents change.
 * Includes query builder methods for search, fuzzy, highlight, facets, and boost.
 */

import type { QueryDependency } from "../query-builder/index.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export type SearchLanguage =
  | "simple"
  | "english"
  | "spanish"
  | "french"
  | "german"
  | "italian"
  | "portuguese"
  | "russian"
export type FuzzyMatchType = "trigram" | "levenshtein" | "metaphone"
export type SearchRankFunction = "ts_rank" | "ts_rank_cd"

export interface SearchableColumnConfig {
  /** Column name */
  column: string
  /** Weight for ranking (A=highest, D=lowest) */
  weight?: "A" | "B" | "C" | "D"
  /** Language for tsvector (default: english) */
  language?: SearchLanguage
}

export interface SearchOptions {
  /** Full-text search language */
  language?: SearchLanguage
  /** Ranking function */
  rankFunction?: SearchRankFunction
  /** Minimum rank threshold (0-1) */
  minRank?: number
  /** Highlight options */
  highlight?: HighlightOptions
  /** Maximum results */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

export interface FuzzySearchOptions {
  /** Minimum similarity threshold (0-1, default: 0.3) */
  threshold?: number
  /** Fuzzy match algorithm */
  matchType?: FuzzyMatchType
  /** Maximum results */
  limit?: number
}

export interface HighlightOptions {
  /** Start tag for highlighting (default: <b>) */
  startTag?: string
  /** End tag for highlighting (default: </b>) */
  endTag?: string
  /** Max words in highlight fragment */
  maxWords?: number
  /** Min words in highlight fragment */
  minWords?: number
  /** Fragment delimiter */
  fragmentDelimiter?: string
}

export interface FacetConfig {
  /** Column to facet on */
  column: string
  /** Limit number of facet values */
  limit?: number
  /** Sort by count or value */
  orderBy?: "count" | "value"
}

export interface FacetResult {
  column: string
  values: Array<{ value: string; count: number }>
}

export interface SearchResult<T = Record<string, unknown>> {
  /** Matched rows */
  rows: Array<T & { _rank?: number; _highlight?: Record<string, string> }>
  /** Total matching count (for pagination) */
  totalCount: number
  /** Facet results */
  facets?: FacetResult[]
  /** Query execution time (ms) */
  queryTimeMs: number
  /** Dependencies for reactivity tracking */
  dependencies: QueryDependency[]
}

export interface SearchIndexDefinition {
  /** Table name */
  table: string
  /** Columns to index for full-text search */
  columns: SearchableColumnConfig[]
  /** Auto-generated GIN index name */
  indexName: string
  /** Language for the index */
  language: SearchLanguage
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class SearchError extends Error {
  readonly code = "SEARCH_ERROR"

  constructor(message: string) {
    super(message)
    this.name = "SearchError"
  }
}

const VALID_SEARCH_LANGUAGES = new Set<string>([
  "simple",
  "english",
  "spanish",
  "french",
  "german",
  "italian",
  "portuguese",
  "russian",
])

function validateLanguage(language: string): string {
  if (!VALID_SEARCH_LANGUAGES.has(language)) {
    throw new SearchError(`Invalid search language: ${language}`)
  }
  return language
}

// ─── Search Query Builder ────────────────────────────────────────────────────

export interface SearchQueryPlan {
  table: string
  searchColumns: SearchableColumnConfig[]
  searchQuery?: string
  fuzzyQuery?: string
  fuzzyOptions?: FuzzySearchOptions
  highlightOptions?: HighlightOptions
  facets: FacetConfig[]
  boosts: Array<{ column: string; weight: number }>
  filters: Array<{ column: string; operator: string; value: unknown }>
  language: SearchLanguage
  rankFunction: SearchRankFunction
  minRank?: number
  limit?: number
  offset?: number
}

/**
 * Type-safe search query builder.
 * Generates Postgres full-text search SQL with reactivity tracking.
 */
export class SearchQueryBuilder<T = Record<string, unknown>> {
  private plan: SearchQueryPlan

  constructor(table: string, columns: SearchableColumnConfig[]) {
    this.plan = {
      table,
      searchColumns: columns,
      facets: [],
      boosts: [],
      filters: [],
      language: "english",
      rankFunction: "ts_rank",
    }
  }

  /**
   * Full-text search using tsvector/tsquery.
   */
  search(query: string, options: SearchOptions = {}): SearchQueryBuilder<T> {
    const clone = this.clone()
    clone.plan.searchQuery = query
    clone.plan.language = options.language ?? clone.plan.language
    clone.plan.rankFunction = options.rankFunction ?? clone.plan.rankFunction
    clone.plan.minRank = options.minRank
    clone.plan.highlightOptions = options.highlight
    clone.plan.limit = options.limit ?? clone.plan.limit
    clone.plan.offset = options.offset ?? clone.plan.offset
    return clone
  }

  /**
   * Fuzzy search using pg_trgm similarity.
   */
  fuzzy(query: string, options: FuzzySearchOptions = {}): SearchQueryBuilder<T> {
    const clone = this.clone()
    clone.plan.fuzzyQuery = query
    clone.plan.fuzzyOptions = options
    clone.plan.limit = options.limit ?? clone.plan.limit
    return clone
  }

  /**
   * Enable highlighting in results.
   */
  highlight(options: HighlightOptions = {}): SearchQueryBuilder<T> {
    const clone = this.clone()
    clone.plan.highlightOptions = {
      startTag: "<b>",
      endTag: "</b>",
      maxWords: 35,
      minWords: 15,
      fragmentDelimiter: " ... ",
      ...options,
    }
    return clone
  }

  /**
   * Add faceted search on a column.
   */
  facet(column: string, options: { limit?: number; orderBy?: "count" | "value" } = {}): SearchQueryBuilder<T> {
    const clone = this.clone()
    clone.plan.facets.push({
      column,
      limit: options.limit ?? 20,
      orderBy: options.orderBy ?? "count",
    })
    return clone
  }

  /**
   * Boost a column's relevance in ranking.
   */
  boost(column: string, weight: number): SearchQueryBuilder<T> {
    const clone = this.clone()
    clone.plan.boosts.push({ column, weight })
    return clone
  }

  /**
   * Add a filter condition.
   */
  where(column: string, operator: string, value: unknown): SearchQueryBuilder<T> {
    const clone = this.clone()
    clone.plan.filters.push({ column, operator, value })
    return clone
  }

  /**
   * Set result limit.
   */
  limit(n: number): SearchQueryBuilder<T> {
    const clone = this.clone()
    clone.plan.limit = n
    return clone
  }

  /**
   * Set result offset.
   */
  offset(n: number): SearchQueryBuilder<T> {
    const clone = this.clone()
    clone.plan.offset = n
    return clone
  }

  /**
   * Build the SQL query.
   */
  build(): { sql: string; params: unknown[]; plan: SearchQueryPlan } {
    const params: unknown[] = []
    const parts: string[] = []

    if (this.plan.searchQuery) {
      return this.buildFullTextQuery(parts, params)
    } else if (this.plan.fuzzyQuery) {
      return this.buildFuzzyQuery(parts, params)
    } else {
      throw new SearchError("Either search() or fuzzy() must be called before build()")
    }
  }

  /**
   * Get reactivity dependencies.
   */
  getDependencies(): QueryDependency[] {
    return [{ table: this.plan.table, filters: {} }]
  }

  private buildFullTextQuery(
    parts: string[],
    params: unknown[],
  ): { sql: string; params: unknown[]; plan: SearchQueryPlan } {
    const { table, searchColumns, searchQuery, language, rankFunction } = this.plan

    // Build tsvector expression
    const tsvectorParts = searchColumns.map((col) => {
      const lang = validateLanguage(col.language ?? language)
      const weight = col.weight
        ? `setweight(to_tsvector('${lang}', COALESCE("${col.column}", '')), '${col.weight}')`
        : `to_tsvector('${lang}', COALESCE("${col.column}", ''))`
      return weight
    })
    const tsvector = tsvectorParts.length > 1 ? tsvectorParts.join(" || ") : tsvectorParts[0]

    params.push(searchQuery)
    const validatedLang = validateLanguage(language)
    const tsquery = `plainto_tsquery('${validatedLang}', $${params.length})`

    // SELECT clause
    const selectParts = [`"${table}".*`, `${rankFunction}(${tsvector}, ${tsquery}) AS "_rank"`]

    // Highlighting
    if (this.plan.highlightOptions) {
      const hl = this.plan.highlightOptions
      for (const col of searchColumns) {
        const hlLang = validateLanguage(col.language ?? language)
        selectParts.push(
          `ts_headline('${hlLang}', COALESCE("${col.column}", ''), ${tsquery}, ` +
            `'StartSel=${hl.startTag ?? "<b>"}, StopSel=${hl.endTag ?? "</b>"}, ` +
            `MaxWords=${hl.maxWords ?? 35}, MinWords=${hl.minWords ?? 15}, ` +
            `FragmentDelimiter=${hl.fragmentDelimiter ?? " ... "}') AS "_hl_${col.column}"`,
        )
      }
    }

    parts.push(`SELECT ${selectParts.join(", ")}`)
    parts.push(`FROM "${table}"`)
    parts.push(`WHERE ${tsvector} @@ ${tsquery}`)

    // Additional filters
    for (const filter of this.plan.filters) {
      params.push(filter.value)
      parts.push(`AND "${filter.column}" ${filter.operator} $${params.length}`)
    }

    // Min rank filter
    if (this.plan.minRank !== undefined) {
      parts.push(`AND ${rankFunction}(${tsvector}, ${tsquery}) >= ${this.plan.minRank}`)
    }

    // ORDER BY rank
    parts.push(`ORDER BY "_rank" DESC`)

    // LIMIT / OFFSET
    if (this.plan.limit !== undefined) parts.push(`LIMIT ${this.plan.limit}`)
    if (this.plan.offset !== undefined) parts.push(`OFFSET ${this.plan.offset}`)

    return { sql: parts.join("\n"), params, plan: { ...this.plan } }
  }

  private buildFuzzyQuery(
    parts: string[],
    params: unknown[],
  ): { sql: string; params: unknown[]; plan: SearchQueryPlan } {
    const { table, searchColumns, fuzzyQuery, fuzzyOptions } = this.plan
    const threshold = fuzzyOptions?.threshold ?? 0.3
    const matchType = fuzzyOptions?.matchType ?? "trigram"

    if (matchType === "trigram") {
      // pg_trgm similarity search
      const simColumns = searchColumns.map((col) => `similarity("${col.column}", $1)`).join(" + ")
      const orConditions = searchColumns.map((col) => `similarity("${col.column}", $1) > ${threshold}`).join(" OR ")

      params.push(fuzzyQuery)

      parts.push(`SELECT "${table}".*, (${simColumns}) / ${searchColumns.length} AS "_rank"`)
      parts.push(`FROM "${table}"`)
      parts.push(`WHERE ${orConditions}`)

      // Additional filters
      for (const filter of this.plan.filters) {
        params.push(filter.value)
        parts.push(`AND "${filter.column}" ${filter.operator} $${params.length}`)
      }

      parts.push(`ORDER BY "_rank" DESC`)
    } else {
      // Levenshtein distance
      const distColumns = searchColumns.map((col) => `levenshtein("${col.column}", $1)`).join(" + ")
      params.push(fuzzyQuery)

      parts.push(`SELECT "${table}".*, ${distColumns} AS "_distance"`)
      parts.push(`FROM "${table}"`)
      parts.push(`ORDER BY "_distance" ASC`)
    }

    if (this.plan.limit !== undefined) parts.push(`LIMIT ${this.plan.limit}`)
    if (this.plan.offset !== undefined) parts.push(`OFFSET ${this.plan.offset}`)

    return { sql: parts.join("\n"), params, plan: { ...this.plan } }
  }

  private clone(): SearchQueryBuilder<T> {
    const cloned = new SearchQueryBuilder<T>(this.plan.table, [...this.plan.searchColumns])
    cloned.plan = {
      ...this.plan,
      facets: [...this.plan.facets],
      boosts: [...this.plan.boosts],
      filters: [...this.plan.filters],
      searchColumns: [...this.plan.searchColumns],
    }
    return cloned
  }
}

// ─── Schema Integration: v.searchable() ──────────────────────────────────────

export interface SearchableValidatorOptions {
  /** Columns to include in full-text search index */
  columns: string[]
  /** Language for tsvector (default: english) */
  language?: SearchLanguage
  /** Weight assignments per column */
  weights?: Record<string, "A" | "B" | "C" | "D">
  /** Also create pg_trgm GIN index for fuzzy search */
  enableFuzzy?: boolean
}

/**
 * Generate SQL for creating full-text search indexes on a table.
 */
export function generateSearchIndexSQL(table: string, options: SearchableValidatorOptions): string {
  const language = options.language ?? "english"
  const parts: string[] = []

  // Generated tsvector column (materialized for performance)
  const tsvectorExpr = options.columns
    .map((col) => {
      const weight = options.weights?.[col]
      if (weight) {
        return `setweight(to_tsvector('${language}', COALESCE("${col}", '')), '${weight}')`
      }
      return `to_tsvector('${language}', COALESCE("${col}", ''))`
    })
    .join(" || ")

  // Add generated column
  parts.push(
    `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "_search_vector" tsvector GENERATED ALWAYS AS (${tsvectorExpr}) STORED;`,
  )

  // GIN index on tsvector
  parts.push(`CREATE INDEX IF NOT EXISTS "idx_${table}_search" ON "${table}" USING GIN ("_search_vector");`)

  // Optional pg_trgm index for fuzzy search
  if (options.enableFuzzy) {
    for (const col of options.columns) {
      parts.push(
        `CREATE INDEX IF NOT EXISTS "idx_${table}_${col}_trgm" ON "${table}" USING GIN ("${col}" gin_trgm_ops);`,
      )
    }
  }

  // Update trigger to keep tsvector fresh (for non-generated column approach)
  parts.push("")
  parts.push(`-- Search index on "${table}" created successfully.`)
  parts.push(`-- Columns: ${options.columns.join(", ")}`)
  parts.push(`-- Language: ${language}`)

  return parts.join("\n")
}

/**
 * Generate facet query SQL for a column.
 */
export function generateFacetSQL(table: string, column: string, options: FacetConfig): string {
  const orderClause = options.orderBy === "value" ? `"${column}" ASC` : `count DESC`
  const limitClause = options.limit ? `LIMIT ${options.limit}` : ""

  return `SELECT "${column}" AS value, COUNT(*) AS count
FROM "${table}"
GROUP BY "${column}"
ORDER BY ${orderClause}
${limitClause};`
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a search query builder for a table.
 */
export function createSearchQuery<T = Record<string, unknown>>(
  table: string,
  columns: SearchableColumnConfig[],
): SearchQueryBuilder<T> {
  return new SearchQueryBuilder<T>(table, columns)
}

/**
 * Convenience: create a simple full-text search query.
 */
export function searchTable<T = Record<string, unknown>>(
  table: string,
  columns: string[],
  query: string,
  options: SearchOptions = {},
): SearchQueryBuilder<T> {
  const cols = columns.map((c) => ({ column: c }))
  return new SearchQueryBuilder<T>(table, cols).search(query, options)
}
