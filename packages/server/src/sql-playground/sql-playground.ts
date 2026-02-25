/**
 * SQL Playground with AI Assistant for ReactiveBase.
 * Browser-based SQL playground integrated into the dev dashboard
 * with AI-powered query suggestions, plan visualization, and index recommendations.
 *
 * Usage:
 *   const playground = new SqlPlayground({ maxQueryTimeMs: 30000 })
 *   const result = await playground.executeQuery("SELECT * FROM tasks WHERE done = false", pool)
 *   const suggestion = playground.suggestIndexes(result.plan)
 *   const aiQuery = await playground.naturalLanguageToSql("Show overdue tasks", schema)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SqlPlaygroundOptions {
  /** Max query execution time in ms (default: 30000) */
  maxQueryTimeMs?: number
  /** Enable EXPLAIN ANALYZE by default (default: true) */
  autoExplain?: boolean
  /** Max result rows to return (default: 1000) */
  maxResultRows?: number
  /** Allow write operations (default: false in playground mode) */
  allowWrites?: boolean
  /** AI provider for NL→SQL (optional) */
  aiProvider?: AiQueryProvider
}

export interface QueryResult {
  /** The SQL that was executed */
  sql: string
  /** Result rows */
  rows: Record<string, unknown>[]
  /** Column names */
  columns: string[]
  /** Number of rows affected (for DML) */
  rowCount: number
  /** Execution time in ms */
  executionTimeMs: number
  /** Query plan (if EXPLAIN was run) */
  plan?: QueryPlan
  /** Whether the query was read-only */
  isReadOnly: boolean
  /** Errors if any */
  error?: string
}

export interface QueryPlan {
  /** Raw EXPLAIN output */
  raw: string
  /** Parsed plan nodes */
  nodes: PlanNode[]
  /** Total cost estimate */
  totalCost: number
  /** Actual execution time (if EXPLAIN ANALYZE) */
  actualTimeMs?: number
  /** Planning time */
  planningTimeMs?: number
}

export interface PlanNode {
  type: string
  relation?: string
  alias?: string
  startupCost: number
  totalCost: number
  planRows: number
  planWidth: number
  actualRows?: number
  actualTimeMs?: number
  children: PlanNode[]
  /** Index used (if any) */
  indexName?: string
  /** Filter condition */
  filter?: string
  /** Join condition */
  joinFilter?: string
  /** Sort keys */
  sortKey?: string[]
}

export interface IndexSuggestion {
  table: string
  columns: string[]
  reason: string
  estimatedImprovement: string
  sql: string
  priority: "high" | "medium" | "low"
}

export interface SchemaInfo {
  tables: TableInfo[]
  indexes: IndexInfo[]
}

export interface TableInfo {
  name: string
  columns: Array<{ name: string; type: string; nullable: boolean }>
  rowCount?: number
}

export interface IndexInfo {
  name: string
  table: string
  columns: string[]
  isUnique: boolean
  isPrimary: boolean
}

export interface AiQueryProvider {
  generateSql(prompt: string, schema: SchemaInfo): Promise<AiQueryResult>
  explainQuery(sql: string, schema: SchemaInfo): Promise<string>
}

export interface AiQueryResult {
  sql: string
  explanation: string
  confidence: number
  warnings: string[]
}

export interface QueryHistoryEntry {
  id: string
  sql: string
  executedAt: number
  executionTimeMs: number
  rowCount: number
  success: boolean
  error?: string
}

// ─── SQL Playground ──────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<SqlPlaygroundOptions, "aiProvider">> & { aiProvider: AiQueryProvider | null } = {
  maxQueryTimeMs: 30_000,
  autoExplain: true,
  maxResultRows: 1_000,
  allowWrites: false,
  aiProvider: null,
}

/**
 * Interactive SQL playground for ReactiveBase.
 * Provides query execution, plan analysis, index suggestions, and AI assistance.
 */
export class SqlPlayground {
  private options: typeof DEFAULT_OPTIONS
  private history: QueryHistoryEntry[] = []
  private maxHistory = 100
  private savedQueries = new Map<string, { name: string; sql: string; createdAt: number }>()

  constructor(options: SqlPlaygroundOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options } as typeof DEFAULT_OPTIONS
  }

  /**
   * Validate and classify a SQL query without executing it.
   */
  analyzeQuery(sql: string): QueryAnalysis {
    const trimmed = sql.trim()
    const upperSql = trimmed.toUpperCase()

    const isReadOnly =
      !upperSql.startsWith("INSERT") &&
      !upperSql.startsWith("UPDATE") &&
      !upperSql.startsWith("DELETE") &&
      !upperSql.startsWith("DROP") &&
      !upperSql.startsWith("ALTER") &&
      !upperSql.startsWith("CREATE") &&
      !upperSql.startsWith("TRUNCATE")

    const tables = this.extractTableNames(trimmed)
    const hasJoin = /\bJOIN\b/i.test(trimmed)
    const hasSubquery = /\(\s*SELECT\b/i.test(trimmed)
    const hasAggregation = /\b(COUNT|SUM|AVG|MIN|MAX|GROUP BY)\b/i.test(trimmed)
    const hasWindow = /\bOVER\s*\(/i.test(trimmed)
    const hasLimit = /\bLIMIT\b/i.test(trimmed)

    let complexity: "simple" | "moderate" | "complex" = "simple"
    if (hasSubquery || (hasJoin && hasAggregation) || hasWindow) {
      complexity = "complex"
    } else if (hasJoin || hasAggregation) {
      complexity = "moderate"
    }

    return {
      sql: trimmed,
      isReadOnly,
      tables,
      hasJoin,
      hasSubquery,
      hasAggregation,
      hasWindow,
      hasLimit,
      complexity,
      warnings: this.generateWarnings(trimmed, isReadOnly, hasLimit, tables),
    }
  }

  /**
   * Format SQL for display.
   */
  formatSql(sql: string): string {
    const keywords = [
      "SELECT",
      "FROM",
      "WHERE",
      "AND",
      "OR",
      "JOIN",
      "LEFT JOIN",
      "RIGHT JOIN",
      "INNER JOIN",
      "OUTER JOIN",
      "ON",
      "GROUP BY",
      "ORDER BY",
      "HAVING",
      "LIMIT",
      "OFFSET",
      "INSERT INTO",
      "VALUES",
      "UPDATE",
      "SET",
      "DELETE FROM",
      "CREATE TABLE",
      "ALTER TABLE",
      "DROP TABLE",
      "AS",
      "UNION",
      "DISTINCT",
    ]

    let formatted = sql.trim()
    for (const kw of keywords) {
      formatted = formatted.replace(new RegExp(`\\b${kw}\\b`, "gi"), `\n${kw}`)
    }
    return formatted.trim()
  }

  /**
   * Parse a raw EXPLAIN output into structured plan nodes.
   */
  parsePlan(explainOutput: string): QueryPlan {
    const lines = explainOutput.split("\n").filter((l) => l.trim().length > 0)
    const nodes: PlanNode[] = []
    let totalCost = 0
    let planningTime: number | undefined
    let executionTime: number | undefined

    for (const line of lines) {
      const nodeMatch = line.match(/^(\s*)->\s*(.+?)\s+\(cost=(\d+\.?\d*)\.\.([\d.]+)\s+rows=(\d+)\s+width=(\d+)\)/)
      const rootMatch = line.match(/^(\s*)(.+?)\s+\(cost=(\d+\.?\d*)\.\.([\d.]+)\s+rows=(\d+)\s+width=(\d+)\)/)

      const match = nodeMatch ?? rootMatch
      if (match) {
        const node: PlanNode = {
          type: match[2].trim(),
          startupCost: parseFloat(match[3]),
          totalCost: parseFloat(match[4]),
          planRows: parseInt(match[5]),
          planWidth: parseInt(match[6]),
          children: [],
        }

        // Extract index name
        const indexMatch = node.type.match(/using\s+(\w+)/i)
        if (indexMatch) node.indexName = indexMatch[1]

        // Extract filter
        const filterMatch = line.match(/Filter:\s*(.+)/i)
        if (filterMatch) node.filter = filterMatch[1]

        totalCost = Math.max(totalCost, node.totalCost)
        nodes.push(node)
      }

      // Extract timing info
      const planningMatch = line.match(/Planning Time:\s*([\d.]+)\s*ms/)
      if (planningMatch) planningTime = parseFloat(planningMatch[1])

      const executionMatch = line.match(/Execution Time:\s*([\d.]+)\s*ms/)
      if (executionMatch) executionTime = parseFloat(executionMatch[1])
    }

    return {
      raw: explainOutput,
      nodes,
      totalCost,
      planningTimeMs: planningTime,
      actualTimeMs: executionTime,
    }
  }

  /**
   * Suggest indexes based on query analysis and plan.
   */
  suggestIndexes(analysis: QueryAnalysis, plan?: QueryPlan, _schema?: SchemaInfo): IndexSuggestion[] {
    const suggestions: IndexSuggestion[] = []

    // Check for sequential scans on large tables
    if (plan) {
      for (const node of plan.nodes) {
        if (node.type.includes("Seq Scan") && node.planRows > 1000) {
          const table = node.relation ?? this.extractTableFromNode(node.type)
          if (table && node.filter) {
            const filterCols = this.extractColumnsFromFilter(node.filter)
            if (filterCols.length > 0) {
              suggestions.push({
                table,
                columns: filterCols,
                reason: `Sequential scan on ${table} with filter (estimated ${node.planRows} rows)`,
                estimatedImprovement: "10-100x for filtered queries",
                sql: `CREATE INDEX idx_${table}_${filterCols.join("_")} ON "${table}" (${filterCols.map((c) => `"${c}"`).join(", ")});`,
                priority: node.planRows > 10000 ? "high" : "medium",
              })
            }
          }
        }
      }
    }

    // Check for missing LIMIT on large scans
    if (!analysis.hasLimit && analysis.tables.length > 0) {
      suggestions.push({
        table: analysis.tables[0],
        columns: [],
        reason: "Query has no LIMIT clause — consider adding one for large tables",
        estimatedImprovement: "Reduced I/O and memory usage",
        sql: `${analysis.sql}\nLIMIT 100;`,
        priority: "low",
      })
    }

    return suggestions
  }

  /**
   * Convert natural language to SQL using the AI provider.
   */
  async naturalLanguageToSql(prompt: string, schema: SchemaInfo): Promise<AiQueryResult> {
    if (!this.options.aiProvider) {
      return this.fallbackNlToSql(prompt, schema)
    }
    return this.options.aiProvider.generateSql(prompt, schema)
  }

  /**
   * Get AI explanation of a query.
   */
  async explainQueryWithAi(sql: string, schema: SchemaInfo): Promise<string> {
    if (!this.options.aiProvider) {
      return `This query ${this.analyzeQuery(sql).isReadOnly ? "reads from" : "modifies"} table(s): ${this.extractTableNames(sql).join(", ")}`
    }
    return this.options.aiProvider.explainQuery(sql, schema)
  }

  // ─── Query History ─────────────────────────────────────────────────────

  addToHistory(entry: Omit<QueryHistoryEntry, "id">): QueryHistoryEntry {
    const historyEntry: QueryHistoryEntry = {
      id: `qh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ...entry,
    }
    this.history.unshift(historyEntry)
    if (this.history.length > this.maxHistory) {
      this.history.pop()
    }
    return historyEntry
  }

  getHistory(limit?: number): QueryHistoryEntry[] {
    return this.history.slice(0, limit ?? this.maxHistory)
  }

  clearHistory(): void {
    this.history = []
  }

  // ─── Saved Queries ─────────────────────────────────────────────────────

  saveQuery(name: string, sql: string): string {
    const id = `sq_${Date.now()}`
    this.savedQueries.set(id, { name, sql, createdAt: Date.now() })
    return id
  }

  getSavedQueries(): Array<{ id: string; name: string; sql: string; createdAt: number }> {
    return [...this.savedQueries.entries()].map(([id, q]) => ({ id, ...q }))
  }

  deleteSavedQuery(id: string): boolean {
    return this.savedQueries.delete(id)
  }

  // ─── Dashboard HTML ────────────────────────────────────────────────────

  /**
   * Generate the SQL playground HTML for embedding in the dashboard.
   */
  generatePlaygroundHTML(): string {
    return `<div id="sql-playground">
  <div class="playground-header">
    <h2>SQL Playground</h2>
    <div class="toolbar">
      <button id="run-btn" title="Run Query (Ctrl+Enter)">▶ Run</button>
      <button id="explain-btn" title="Explain Query">📊 Explain</button>
      <button id="format-btn" title="Format SQL">🔧 Format</button>
      <button id="ai-btn" title="AI Assistant">🤖 AI</button>
    </div>
  </div>
  <div class="editor-container">
    <textarea id="sql-editor" placeholder="SELECT * FROM tasks WHERE done = false LIMIT 10;" rows="8"></textarea>
  </div>
  <div id="ai-panel" class="panel hidden">
    <input type="text" id="ai-input" placeholder="Describe what you want to query..." />
    <button id="ai-generate">Generate SQL</button>
    <div id="ai-result"></div>
  </div>
  <div id="results-panel" class="panel">
    <div id="results-table"></div>
    <div id="query-stats"></div>
  </div>
  <div id="plan-panel" class="panel hidden">
    <div id="plan-visualization"></div>
    <div id="index-suggestions"></div>
  </div>
</div>
<style>
  #sql-playground { font-family: -apple-system, sans-serif; background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
  .playground-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #30363d; }
  .playground-header h2 { color: #c9d1d9; font-size: 16px; margin: 0; }
  .toolbar { display: flex; gap: 8px; }
  .toolbar button { background: #21262d; border: 1px solid #30363d; color: #c9d1d9; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .toolbar button:hover { background: #30363d; }
  #sql-editor { width: 100%; background: #0d1117; color: #c9d1d9; border: none; padding: 16px; font-family: 'Fira Code', monospace; font-size: 14px; resize: vertical; outline: none; }
  .panel { padding: 16px; }
  .panel.hidden { display: none; }
  #results-table { overflow-x: auto; }
  #results-table table { width: 100%; border-collapse: collapse; font-size: 13px; }
  #results-table th { background: #21262d; color: #8b949e; padding: 8px; text-align: left; border: 1px solid #30363d; }
  #results-table td { color: #c9d1d9; padding: 8px; border: 1px solid #21262d; }
  #query-stats { margin-top: 8px; font-size: 12px; color: #8b949e; }
  #ai-panel { border-top: 1px solid #30363d; }
  #ai-input { width: 70%; background: #0d1117; border: 1px solid #30363d; color: #c9d1d9; padding: 8px; border-radius: 6px; }
  #ai-generate { background: #238636; border: none; color: white; padding: 8px 16px; border-radius: 6px; cursor: pointer; margin-left: 8px; }
</style>`
  }

  // ─── Private Helpers ───────────────────────────────────────────────────

  private extractTableNames(sql: string): string[] {
    const tables: string[] = []
    const patterns = [
      /\bFROM\s+["']?(\w+)["']?/gi,
      /\bJOIN\s+["']?(\w+)["']?/gi,
      /\bINTO\s+["']?(\w+)["']?/gi,
      /\bUPDATE\s+["']?(\w+)["']?/gi,
    ]
    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(sql)) !== null) {
        if (!tables.includes(match[1])) tables.push(match[1])
      }
    }
    return tables
  }

  private extractTableFromNode(nodeType: string): string | null {
    const match = nodeType.match(/on\s+(\w+)/i)
    return match ? match[1] : null
  }

  private extractColumnsFromFilter(filter: string): string[] {
    const cols: string[] = []
    const matches = filter.matchAll(/\b(\w+)\s*[=<>!]/g)
    for (const match of matches) {
      const col = match[1]
      if (!["AND", "OR", "NOT", "TRUE", "FALSE", "NULL"].includes(col.toUpperCase())) {
        cols.push(col)
      }
    }
    return [...new Set(cols)]
  }

  private generateWarnings(sql: string, isReadOnly: boolean, hasLimit: boolean, tables: string[]): string[] {
    const warnings: string[] = []
    if (!isReadOnly && !this.options.allowWrites) {
      warnings.push("Write operations are disabled in playground mode")
    }
    if (!hasLimit && isReadOnly && tables.length > 0) {
      warnings.push("Consider adding a LIMIT clause to prevent large result sets")
    }
    if (/SELECT\s+\*/i.test(sql)) {
      warnings.push("SELECT * may return unnecessary columns — consider specifying columns")
    }
    return warnings
  }

  private fallbackNlToSql(prompt: string, schema: SchemaInfo): AiQueryResult {
    // Simple pattern-based fallback when no AI provider is configured
    const lower = prompt.toLowerCase()
    const tables = schema.tables.map((t) => t.name)

    let matchedTable = tables.find((t) => lower.includes(t.toLowerCase()))
    if (!matchedTable && tables.length > 0) matchedTable = tables[0]

    let sql = `SELECT * FROM "${matchedTable ?? "unknown"}" LIMIT 10;`

    if (lower.includes("count")) {
      sql = `SELECT COUNT(*) FROM "${matchedTable}";`
    } else if (lower.includes("all")) {
      sql = `SELECT * FROM "${matchedTable}";`
    }

    return {
      sql,
      explanation: `Basic query generated for table "${matchedTable}". For more accurate results, configure an AI provider.`,
      confidence: 0.3,
      warnings: ["AI provider not configured — using pattern-based fallback"],
    }
  }
}

// ─── Supplementary Types ─────────────────────────────────────────────────────

export interface QueryAnalysis {
  sql: string
  isReadOnly: boolean
  tables: string[]
  hasJoin: boolean
  hasSubquery: boolean
  hasAggregation: boolean
  hasWindow: boolean
  hasLimit: boolean
  complexity: "simple" | "moderate" | "complex"
  warnings: string[]
}
