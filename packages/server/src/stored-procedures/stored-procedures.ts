/**
 * Reactive Stored Procedures for ReactiveBase.
 * Define Postgres stored procedures/functions in TypeScript that compile to PL/pgSQL,
 * with automatic reactive invalidation when they execute.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type PgParamType =
  | "text"
  | "integer"
  | "bigint"
  | "boolean"
  | "timestamptz"
  | "jsonb"
  | "uuid"
  | "double precision"
  | "numeric"

export type PgReturnType = PgParamType | "void" | "trigger" | "setof"

export interface ProcedureParam {
  name: string
  type: PgParamType
  defaultValue?: string
}

export interface ProcedureDefinition {
  /** Unique name for the stored procedure */
  name: string
  /** Input parameters */
  params: ProcedureParam[]
  /** Return type */
  returns: PgReturnType
  /** For setof returns, the table or row type name */
  returnsTable?: string
  /** TypeScript body that compiles to PL/pgSQL */
  body: ProcedureBody
  /** Tables this procedure reads from (for reactive tracking) */
  readsTables?: string[]
  /** Tables this procedure writes to (triggers invalidation) */
  writesTables?: string[]
  /** Security definer (runs as owner, not caller) */
  securityDefiner?: boolean
  /** Volatility: stable, volatile, immutable */
  volatility?: "stable" | "volatile" | "immutable"
  /** Language override (default: plpgsql) */
  language?: "plpgsql" | "sql"
}

export interface ProcedureBody {
  /** Raw SQL/PL/pgSQL statements */
  statements: ProcedureStatement[]
}

export type ProcedureStatement =
  | DeclareStatement
  | AssignStatement
  | QueryStatement
  | InsertStatement
  | UpdateStatement
  | DeleteStatement
  | IfStatement
  | ReturnStatement
  | RaiseStatement
  | PerformStatement
  | RawSqlStatement

export interface DeclareStatement {
  kind: "declare"
  name: string
  type: string
  defaultValue?: string
}

export interface AssignStatement {
  kind: "assign"
  variable: string
  expression: string
}

export interface QueryStatement {
  kind: "query"
  into?: string
  sql: string
}

export interface InsertStatement {
  kind: "insert"
  table: string
  columns: string[]
  values: string[]
  returning?: string
  into?: string
}

export interface UpdateStatement {
  kind: "update"
  table: string
  set: Record<string, string>
  where: string
  returning?: string
  into?: string
}

export interface DeleteStatement {
  kind: "delete"
  table: string
  where: string
  returning?: string
  into?: string
}

export interface IfStatement {
  kind: "if"
  condition: string
  then: ProcedureStatement[]
  elseIf?: Array<{ condition: string; then: ProcedureStatement[] }>
  else?: ProcedureStatement[]
}

export interface ReturnStatement {
  kind: "return"
  expression?: string
  query?: string
}

export interface RaiseStatement {
  kind: "raise"
  level: "notice" | "warning" | "exception"
  message: string
  params?: string[]
}

export interface PerformStatement {
  kind: "perform"
  sql: string
}

export interface RawSqlStatement {
  kind: "raw"
  sql: string
}

// ─── Compiler ────────────────────────────────────────────────────────────────

export class ProcedureCompileError extends Error {
  readonly code = "PROCEDURE_COMPILE_ERROR"

  constructor(
    public readonly procedureName: string,
    message: string,
  ) {
    super(`Compile error in procedure "${procedureName}": ${message}`)
    this.name = "ProcedureCompileError"
  }
}

const SAFE_DEFAULT_VALUE_RE =
  /^(?:'[^']*'|\d+(?:\.\d+)?|true|false|NULL|gen_random_uuid\(\)|NOW\(\)|CURRENT_TIMESTAMP)$/i

function sanitizeDefaultValue(value: string): string {
  if (!SAFE_DEFAULT_VALUE_RE.test(value)) {
    throw new Error(`Unsafe default value: ${value}`)
  }
  return value
}

/**
 * Compile a TypeScript procedure definition to PL/pgSQL.
 */
export function compileProcedure(def: ProcedureDefinition): string {
  validateProcedureDefinition(def)

  const parts: string[] = []
  const language = def.language ?? "plpgsql"

  // DROP IF EXISTS for idempotent deployment
  parts.push(`DROP FUNCTION IF EXISTS "${def.name}"(${def.params.map((p) => `${p.type}`).join(", ")});`)
  parts.push("")

  // CREATE FUNCTION
  const paramList = def.params
    .map((p) => `"${p.name}" ${p.type}${p.defaultValue ? ` DEFAULT ${sanitizeDefaultValue(p.defaultValue)}` : ""}`)
    .join(", ")

  let returnClause: string
  if (def.returns === "setof" && def.returnsTable) {
    returnClause = `SETOF "${def.returnsTable}"`
  } else if (def.returns === "trigger") {
    returnClause = "TRIGGER"
  } else {
    returnClause = def.returns
  }

  parts.push(`CREATE OR REPLACE FUNCTION "${def.name}"(${paramList})`)
  parts.push(`RETURNS ${returnClause}`)
  parts.push(`LANGUAGE ${language}`)

  // Volatility
  if (def.volatility) {
    parts.push(def.volatility.toUpperCase())
  }

  // Security
  if (def.securityDefiner) {
    parts.push("SECURITY DEFINER")
  }

  parts.push("AS $$")

  if (language === "plpgsql") {
    // DECLARE block
    const declares = def.body.statements.filter((s): s is DeclareStatement => s.kind === "declare")
    if (declares.length > 0) {
      parts.push("DECLARE")
      for (const d of declares) {
        parts.push(`  "${d.name}" ${d.type}${d.defaultValue ? ` := ${sanitizeDefaultValue(d.defaultValue)}` : ""};`)
      }
    }

    // BEGIN block
    parts.push("BEGIN")

    const bodyStatements = def.body.statements.filter((s) => s.kind !== "declare")
    for (const stmt of bodyStatements) {
      parts.push(compileStatement(stmt, 1))
    }

    // Reactive NOTIFY for write operations
    if (def.writesTables && def.writesTables.length > 0) {
      for (const table of def.writesTables) {
        // Escape for SQL string (single quotes) and JSON (double quotes)
        const safeTable = table.replace(/'/g, "''").replace(/"/g, '\\"')
        const safeName = def.name.replace(/'/g, "''").replace(/"/g, '\\"')
        parts.push(
          `  PERFORM pg_notify('reactivebase_invalidation', '{"table":"${safeTable}","operation":"procedure","procedure":"${safeName}"}');`,
        )
      }
    }

    parts.push("END;")
  } else {
    // Plain SQL body
    const bodyStatements = def.body.statements.filter((s) => s.kind !== "declare")
    for (const stmt of bodyStatements) {
      parts.push(compileStatement(stmt, 0))
    }
  }

  parts.push("$$;")

  // Add comment for documentation
  parts.push("")
  parts.push(
    `COMMENT ON FUNCTION "${def.name}" IS 'ReactiveBase managed procedure. Reads: [${(def.readsTables ?? []).join(", ")}]. Writes: [${(def.writesTables ?? []).join(", ")}].';`,
  )

  return parts.join("\n")
}

function compileStatement(stmt: ProcedureStatement, indent: number): string {
  const pad = "  ".repeat(indent)

  switch (stmt.kind) {
    case "declare":
      return "" // handled above

    case "assign":
      return `${pad}"${stmt.variable}" := ${stmt.expression};`

    case "query": {
      if (stmt.into) {
        return `${pad}SELECT ${stmt.sql} INTO "${stmt.into}";`
      }
      return `${pad}${stmt.sql};`
    }

    case "insert": {
      const cols = stmt.columns.map((c) => `"${c}"`).join(", ")
      const vals = stmt.values.join(", ")
      let sql = `${pad}INSERT INTO "${stmt.table}" (${cols}) VALUES (${vals})`
      if (stmt.returning && stmt.into) {
        sql += ` RETURNING ${stmt.returning} INTO "${stmt.into}"`
      }
      return sql + ";"
    }

    case "update": {
      const setClauses = Object.entries(stmt.set)
        .map(([col, val]) => `"${col}" = ${val}`)
        .join(", ")
      let sql = `${pad}UPDATE "${stmt.table}" SET ${setClauses} WHERE ${stmt.where}`
      if (stmt.returning && stmt.into) {
        sql += ` RETURNING ${stmt.returning} INTO "${stmt.into}"`
      }
      return sql + ";"
    }

    case "delete": {
      let sql = `${pad}DELETE FROM "${stmt.table}" WHERE ${stmt.where}`
      if (stmt.returning && stmt.into) {
        sql += ` RETURNING ${stmt.returning} INTO "${stmt.into}"`
      }
      return sql + ";"
    }

    case "if": {
      const lines: string[] = []
      lines.push(`${pad}IF ${stmt.condition} THEN`)
      for (const s of stmt.then) {
        lines.push(compileStatement(s, indent + 1))
      }
      if (stmt.elseIf) {
        for (const branch of stmt.elseIf) {
          lines.push(`${pad}ELSIF ${branch.condition} THEN`)
          for (const s of branch.then) {
            lines.push(compileStatement(s, indent + 1))
          }
        }
      }
      if (stmt.else) {
        lines.push(`${pad}ELSE`)
        for (const s of stmt.else) {
          lines.push(compileStatement(s, indent + 1))
        }
      }
      lines.push(`${pad}END IF;`)
      return lines.join("\n")
    }

    case "return": {
      if (stmt.query) {
        return `${pad}RETURN QUERY ${stmt.query};`
      }
      if (stmt.expression) {
        return `${pad}RETURN ${stmt.expression};`
      }
      return `${pad}RETURN;`
    }

    case "raise": {
      const params = stmt.params ? `, ${stmt.params.join(", ")}` : ""
      return `${pad}RAISE ${stmt.level.toUpperCase()} '${stmt.message}'${params};`
    }

    case "perform":
      return `${pad}PERFORM ${stmt.sql};`

    case "raw":
      return `${pad}${stmt.sql}`

    default:
      return ""
  }
}

function validateProcedureDefinition(def: ProcedureDefinition): void {
  if (!def.name || def.name.trim().length === 0) {
    throw new ProcedureCompileError("(unnamed)", "Procedure name is required")
  }

  if (!/^[a-z_][a-z0-9_]*$/i.test(def.name)) {
    throw new ProcedureCompileError(def.name, "Invalid procedure name. Use alphanumeric and underscores only.")
  }

  if (def.returns === "setof" && !def.returnsTable) {
    throw new ProcedureCompileError(def.name, "SETOF return type requires returnsTable to be specified")
  }

  if (!def.body || !def.body.statements || def.body.statements.length === 0) {
    throw new ProcedureCompileError(def.name, "Procedure body must contain at least one statement")
  }

  for (const param of def.params) {
    if (!param.name || !param.type) {
      throw new ProcedureCompileError(def.name, "All parameters must have a name and type")
    }
  }
}

// ─── DSL Builder ─────────────────────────────────────────────────────────────

/**
 * Fluent builder for defining stored procedures.
 */
export class ProcedureBuilder {
  private def: ProcedureDefinition

  constructor(name: string) {
    this.def = {
      name,
      params: [],
      returns: "void",
      body: { statements: [] },
    }
  }

  param(name: string, type: PgParamType, defaultValue?: string): this {
    this.def.params.push({ name, type, defaultValue })
    return this
  }

  returns(type: PgReturnType, table?: string): this {
    this.def.returns = type
    if (table) this.def.returnsTable = table
    return this
  }

  reads(...tables: string[]): this {
    this.def.readsTables = tables
    return this
  }

  writes(...tables: string[]): this {
    this.def.writesTables = tables
    return this
  }

  securityDefiner(): this {
    this.def.securityDefiner = true
    return this
  }

  volatility(v: "stable" | "volatile" | "immutable"): this {
    this.def.volatility = v
    return this
  }

  language(lang: "plpgsql" | "sql"): this {
    this.def.language = lang
    return this
  }

  declare(name: string, type: string, defaultValue?: string): this {
    this.def.body.statements.push({ kind: "declare", name, type, defaultValue })
    return this
  }

  assign(variable: string, expression: string): this {
    this.def.body.statements.push({ kind: "assign", variable, expression })
    return this
  }

  query(sql: string, into?: string): this {
    this.def.body.statements.push({ kind: "query", sql, into })
    return this
  }

  insert(table: string, columns: string[], values: string[], options?: { returning?: string; into?: string }): this {
    this.def.body.statements.push({ kind: "insert", table, columns, values, ...options })
    return this
  }

  update(
    table: string,
    set: Record<string, string>,
    where: string,
    options?: { returning?: string; into?: string },
  ): this {
    this.def.body.statements.push({ kind: "update", table, set, where, ...options })
    return this
  }

  delete(table: string, where: string, options?: { returning?: string; into?: string }): this {
    this.def.body.statements.push({ kind: "delete", table, where, ...options })
    return this
  }

  ifThen(condition: string, then: (b: StatementCollector) => void): IfBuilder {
    const collector = new StatementCollector()
    then(collector)
    const ifStmt: IfStatement = { kind: "if", condition, then: collector.statements }
    this.def.body.statements.push(ifStmt)
    return new IfBuilder(ifStmt)
  }

  returnValue(expression?: string): this {
    this.def.body.statements.push({ kind: "return", expression })
    return this
  }

  returnQuery(sql: string): this {
    this.def.body.statements.push({ kind: "return", query: sql })
    return this
  }

  raise(level: "notice" | "warning" | "exception", message: string, params?: string[]): this {
    this.def.body.statements.push({ kind: "raise", level, message, params })
    return this
  }

  perform(sql: string): this {
    this.def.body.statements.push({ kind: "perform", sql })
    return this
  }

  raw(sql: string): this {
    this.def.body.statements.push({ kind: "raw", sql })
    return this
  }

  build(): ProcedureDefinition {
    return { ...this.def }
  }

  compile(): string {
    return compileProcedure(this.def)
  }
}

export class StatementCollector {
  readonly statements: ProcedureStatement[] = []

  assign(variable: string, expression: string): this {
    this.statements.push({ kind: "assign", variable, expression })
    return this
  }

  query(sql: string, into?: string): this {
    this.statements.push({ kind: "query", sql, into })
    return this
  }

  insert(table: string, columns: string[], values: string[]): this {
    this.statements.push({ kind: "insert", table, columns, values })
    return this
  }

  returnValue(expression?: string): this {
    this.statements.push({ kind: "return", expression })
    return this
  }

  raise(level: "notice" | "warning" | "exception", message: string): this {
    this.statements.push({ kind: "raise", level, message })
    return this
  }

  raw(sql: string): this {
    this.statements.push({ kind: "raw", sql })
    return this
  }
}

export class IfBuilder {
  constructor(private stmt: IfStatement) {}

  elseIf(condition: string, then: (b: StatementCollector) => void): IfBuilder {
    const collector = new StatementCollector()
    then(collector)
    if (!this.stmt.elseIf) this.stmt.elseIf = []
    this.stmt.elseIf.push({ condition, then: collector.statements })
    return this
  }

  else(then: (b: StatementCollector) => void): void {
    const collector = new StatementCollector()
    then(collector)
    this.stmt.else = collector.statements
  }
}

// ─── Registry & Reactive Wiring ──────────────────────────────────────────────

export interface StoredProcedureRegistryOptions {
  /** Channel name for LISTEN/NOTIFY (default: reactivebase_invalidation) */
  notifyChannel?: string
}

const DEFAULT_REGISTRY_OPTIONS: Required<StoredProcedureRegistryOptions> = {
  notifyChannel: "reactivebase_invalidation",
}

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/**
 * Registry that manages stored procedures and wires them to the reactivity engine.
 */
export class StoredProcedureRegistry {
  private procedures = new Map<string, ProcedureDefinition>()
  private options: Required<StoredProcedureRegistryOptions>

  constructor(options: StoredProcedureRegistryOptions = {}) {
    this.options = { ...DEFAULT_REGISTRY_OPTIONS, ...options }
    if (!IDENTIFIER_RE.test(this.options.notifyChannel)) {
      throw new Error(`Invalid notifyChannel: "${this.options.notifyChannel}" — must match ${IDENTIFIER_RE}`)
    }
  }

  /**
   * Register a stored procedure definition.
   */
  register(def: ProcedureDefinition): void {
    validateProcedureDefinition(def)
    this.procedures.set(def.name, def)
  }

  /**
   * Get a registered procedure by name.
   */
  get(name: string): ProcedureDefinition | undefined {
    return this.procedures.get(name)
  }

  /**
   * Get all registered procedures.
   */
  getAll(): ProcedureDefinition[] {
    return Array.from(this.procedures.values())
  }

  /**
   * Compile all registered procedures to SQL.
   */
  compileAll(): string {
    const parts: string[] = []

    // LISTEN/NOTIFY setup
    parts.push(this.generateNotifySetupSQL())
    parts.push("")

    for (const def of this.procedures.values()) {
      parts.push(compileProcedure(def))
      parts.push("")
    }

    return parts.join("\n")
  }

  /**
   * Compile a single procedure by name.
   */
  compile(name: string): string {
    const def = this.procedures.get(name)
    if (!def) {
      throw new ProcedureCompileError(name, "Procedure not registered")
    }
    return compileProcedure(def)
  }

  /**
   * Generate SQL to set up the LISTEN/NOTIFY channel and notification function.
   */
  generateNotifySetupSQL(): string {
    const channel = this.options.notifyChannel
    return `-- ReactiveBase procedure invalidation setup
CREATE OR REPLACE FUNCTION _reactivebase_notify_invalidation()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- This function is called by reactive stored procedures
  -- to notify the ReactiveBase server of data changes.
  -- The server listens on '${channel}' and processes invalidations.
  NULL;
END;
$$;`
  }

  /**
   * Generate SQL for the LISTEN command (run on server connection).
   */
  generateListenSQL(): string {
    return `LISTEN "${this.options.notifyChannel}";`
  }

  /**
   * Parse a NOTIFY payload from a stored procedure.
   */
  parseNotifyPayload(payload: string): { table: string; operation: string; procedure: string } | null {
    try {
      const parsed = JSON.parse(payload)
      if (parsed.table && parsed.operation === "procedure") {
        return { table: parsed.table, operation: parsed.operation, procedure: parsed.procedure ?? "unknown" }
      }
      return null
    } catch {
      return null
    }
  }

  get size(): number {
    return this.procedures.size
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Define a stored procedure using the fluent builder API.
 */
export function defineProcedure(name: string): ProcedureBuilder {
  return new ProcedureBuilder(name)
}

/**
 * Define a stored procedure from a raw definition object.
 */
export function defineRawProcedure(def: ProcedureDefinition): ProcedureDefinition {
  validateProcedureDefinition(def)
  return { ...def }
}

/**
 * Create a StoredProcedureRegistry.
 */
export function createProcedureRegistry(options?: StoredProcedureRegistryOptions): StoredProcedureRegistry {
  return new StoredProcedureRegistry(options)
}
