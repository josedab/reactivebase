/**
 * DACL Policy Language Parser & Compiler for ReactiveBase.
 *
 * Parses `.dacl` text-format policy files into an AST, compiles them to
 * Postgres RLS SQL policies and application-level PolicyDefinition[], and
 * provides a dry-run simulator with step-by-step evaluation trace.
 *
 * Syntax example:
 *   allow read on tasks where role in ["admin", "editor"];
 *   allow read on tasks where row.teamId == user.teamId;
 *   deny delete on tasks where role not in ["admin"];
 *   allow * on public_data;
 *
 * Usage:
 *   const ast = parseDacl(sourceText)
 *   const policies = compileToPolicies(ast)
 *   const sql = compileToRlsSQL(ast)
 *   const trace = simulateDacl(ast, context)
 */

import type { Action, PolicyDefinition, PolicyCheckContext, RlsPolicy } from "./dacl.js"

// ─── Error Class ─────────────────────────────────────────────────────────────

export class DaclParseError extends Error {
  readonly line: number
  readonly column: number
  readonly source: string

  constructor(message: string, line: number, column: number, source: string) {
    super(`DACL parse error at line ${line}, column ${column}: ${message}`)
    this.name = "DaclParseError"
    this.line = line
    this.column = column
    this.source = source
  }
}

// ─── Token Types ─────────────────────────────────────────────────────────────

export type TokenType = "keyword" | "action" | "identifier" | "string" | "number" | "operator" | "punctuation" | "eof"

export interface Token {
  type: TokenType
  value: string
  line: number
  column: number
}

// ─── AST Types ───────────────────────────────────────────────────────────────

export interface DaclPolicyAST {
  statements: DaclStatement[]
  source: string
}

export interface DaclStatement {
  effect: "allow" | "deny"
  action: Action
  table: string
  condition: DaclCondition | null
  line: number
}

export type DaclCondition = DaclRoleCondition | DaclFieldCondition | DaclAndCondition | DaclOrCondition

export interface DaclRoleCondition {
  type: "role"
  operator: "in" | "not_in"
  values: string[]
}

export interface DaclFieldCondition {
  type: "field"
  left: DaclFieldPath | DaclLiteral
  operator: "==" | "!=" | ">" | ">=" | "<" | "<="
  right: DaclFieldPath | DaclLiteral
}

export interface DaclAndCondition {
  type: "and"
  left: DaclCondition
  right: DaclCondition
}

export interface DaclOrCondition {
  type: "or"
  left: DaclCondition
  right: DaclCondition
}

export interface DaclFieldPath {
  kind: "field"
  root: "row" | "user"
  path: string
}

export interface DaclLiteral {
  kind: "literal"
  value: string | number | boolean
}

// ─── Compiler Output Types ───────────────────────────────────────────────────

export interface DaclCompileResult {
  policies: PolicyDefinition[]
  rlsPolicies: RlsPolicy[]
  rlsSQL: string[]
  warnings: string[]
}

// ─── Simulator Types ─────────────────────────────────────────────────────────

export interface DaclSimulationStep {
  statementIndex: number
  effect: "allow" | "deny"
  table: string
  action: Action
  conditionSource: string | null
  tableMatch: boolean
  actionMatch: boolean
  conditionMatch: boolean | null
  overallMatch: boolean
  reason: string
}

export interface DaclSimulationResult {
  allowed: boolean
  matchedStatementIndex: number | null
  defaultApplied: boolean
  steps: DaclSimulationStep[]
  evaluationTimeMs: number
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

const KEYWORDS = new Set(["allow", "deny", "on", "where", "role", "in", "not", "and", "or", "true", "false"])
const ACTIONS = new Set(["read", "write", "create", "update", "delete", "*"])
const OPERATORS = new Set(["==", "!=", ">=", "<=", ">", "<"])

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let pos = 0
  let line = 1
  let col = 1

  while (pos < source.length) {
    // Skip whitespace
    if (/\s/.test(source[pos])) {
      if (source[pos] === "\n") {
        line++
        col = 1
      } else {
        col++
      }
      pos++
      continue
    }

    // Skip line comments
    if (source[pos] === "/" && source[pos + 1] === "/") {
      while (pos < source.length && source[pos] !== "\n") pos++
      continue
    }

    // Skip block comments
    if (source[pos] === "/" && source[pos + 1] === "*") {
      pos += 2
      col += 2
      while (pos < source.length - 1 && !(source[pos] === "*" && source[pos + 1] === "/")) {
        if (source[pos] === "\n") {
          line++
          col = 1
        } else {
          col++
        }
        pos++
      }
      pos += 2
      col += 2
      continue
    }

    const startCol = col

    // String literals
    if (source[pos] === '"' || source[pos] === "'") {
      const quote = source[pos]
      pos++
      col++
      let value = ""
      while (pos < source.length && source[pos] !== quote) {
        if (source[pos] === "\\") {
          pos++
          col++
        }
        value += source[pos]
        pos++
        col++
      }
      if (pos >= source.length) {
        throw new DaclParseError("Unterminated string literal", line, startCol, source)
      }
      pos++ // skip closing quote
      col++
      tokens.push({ type: "string", value, line, column: startCol })
      continue
    }

    // Numbers
    if (/\d/.test(source[pos]) || (source[pos] === "-" && pos + 1 < source.length && /\d/.test(source[pos + 1]))) {
      let value = ""
      if (source[pos] === "-") {
        value = "-"
        pos++
        col++
      }
      while (pos < source.length && /[\d.]/.test(source[pos])) {
        value += source[pos]
        pos++
        col++
      }
      tokens.push({ type: "number", value, line, column: startCol })
      continue
    }

    // Two-character operators
    if (pos + 1 < source.length) {
      const twoChar = source[pos] + source[pos + 1]
      if (OPERATORS.has(twoChar)) {
        tokens.push({ type: "operator", value: twoChar, line, column: startCol })
        pos += 2
        col += 2
        continue
      }
    }

    // Single-character operators
    if (source[pos] === ">" || source[pos] === "<") {
      tokens.push({ type: "operator", value: source[pos], line, column: startCol })
      pos++
      col++
      continue
    }

    // Punctuation: ; [ ] , .
    if (";[],".includes(source[pos])) {
      tokens.push({ type: "punctuation", value: source[pos], line, column: startCol })
      pos++
      col++
      continue
    }

    // Dot (field path separator)
    if (source[pos] === ".") {
      tokens.push({ type: "punctuation", value: ".", line, column: startCol })
      pos++
      col++
      continue
    }

    // Wildcard action
    if (source[pos] === "*") {
      tokens.push({ type: "action", value: "*", line, column: startCol })
      pos++
      col++
      continue
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(source[pos])) {
      let value = ""
      while (pos < source.length && /[a-zA-Z0-9_]/.test(source[pos])) {
        value += source[pos]
        pos++
        col++
      }

      if (ACTIONS.has(value)) {
        tokens.push({ type: "action", value, line, column: startCol })
      } else if (KEYWORDS.has(value)) {
        tokens.push({ type: "keyword", value, line, column: startCol })
      } else {
        tokens.push({ type: "identifier", value, line, column: startCol })
      }
      continue
    }

    throw new DaclParseError(`Unexpected character: '${source[pos]}'`, line, col, source)
  }

  tokens.push({ type: "eof", value: "", line, column: col })
  return tokens
}

// ─── Parser ──────────────────────────────────────────────────────────────────

class DaclParser {
  private tokens: Token[]
  private pos: number
  private source: string

  constructor(tokens: Token[], source: string) {
    this.tokens = tokens
    this.pos = 0
    this.source = source
  }

  parse(): DaclPolicyAST {
    const statements: DaclStatement[] = []
    while (this.peek().type !== "eof") {
      statements.push(this.parseStatement())
    }
    return { statements, source: this.source }
  }

  private parseStatement(): DaclStatement {
    const effectToken = this.expect("keyword", ["allow", "deny"])
    const effect = effectToken.value as "allow" | "deny"
    const line = effectToken.line

    const actionToken = this.expect("action")
    const action = actionToken.value as Action

    this.expect("keyword", ["on"])

    const tableToken = this.expect("identifier")
    const table = tableToken.value

    let condition: DaclCondition | null = null
    if (this.peek().type === "keyword" && this.peek().value === "where") {
      this.advance()
      condition = this.parseConditionOr()
    }

    this.expect("punctuation", [";"])

    return { effect, action, table, condition, line }
  }

  private parseConditionOr(): DaclCondition {
    let left = this.parseConditionAnd()

    while (this.peek().type === "keyword" && this.peek().value === "or") {
      this.advance()
      const right = this.parseConditionAnd()
      left = { type: "or", left, right }
    }

    return left
  }

  private parseConditionAnd(): DaclCondition {
    let left = this.parseConditionPrimary()

    while (this.peek().type === "keyword" && this.peek().value === "and") {
      this.advance()
      const right = this.parseConditionPrimary()
      left = { type: "and", left, right }
    }

    return left
  }

  private parseConditionPrimary(): DaclCondition {
    // Role condition: role [not] in [...]
    if (this.peek().type === "keyword" && this.peek().value === "role") {
      return this.parseRoleCondition()
    }

    // Field condition: field.path op value
    return this.parseFieldCondition()
  }

  private parseRoleCondition(): DaclRoleCondition {
    this.expect("keyword", ["role"])

    let operator: "in" | "not_in" = "in"
    if (this.peek().type === "keyword" && this.peek().value === "not") {
      this.advance()
      operator = "not_in"
    }

    this.expect("keyword", ["in"])

    const values = this.parseStringArray()
    return { type: "role", operator, values }
  }

  private parseFieldCondition(): DaclFieldCondition {
    const left = this.parseValueExpression()
    const opToken = this.expect("operator")
    const operator = opToken.value as DaclFieldCondition["operator"]
    const right = this.parseValueExpression()

    return { type: "field", left, operator, right }
  }

  private parseValueExpression(): DaclFieldPath | DaclLiteral {
    const token = this.peek()

    // String literal
    if (token.type === "string") {
      this.advance()
      return { kind: "literal", value: token.value }
    }

    // Number literal
    if (token.type === "number") {
      this.advance()
      return { kind: "literal", value: parseFloat(token.value) }
    }

    // Boolean literal
    if (token.type === "keyword" && (token.value === "true" || token.value === "false")) {
      this.advance()
      return { kind: "literal", value: token.value === "true" }
    }

    // Field path: row.field or user.field
    if (token.type === "identifier" || (token.type === "keyword" && token.value === "role")) {
      const root = this.advance().value
      if (root !== "row" && root !== "user") {
        throw new DaclParseError(
          `Expected 'row' or 'user' in field path, got '${root}'`,
          token.line,
          token.column,
          this.source,
        )
      }
      this.expect("punctuation", ["."])
      const pathParts: string[] = []
      pathParts.push(this.expect("identifier").value)
      while (this.peek().type === "punctuation" && this.peek().value === ".") {
        this.advance()
        pathParts.push(this.expect("identifier").value)
      }
      return { kind: "field", root: root as "row" | "user", path: pathParts.join(".") }
    }

    throw new DaclParseError(`Expected value expression, got '${token.value}'`, token.line, token.column, this.source)
  }

  private parseStringArray(): string[] {
    this.expect("punctuation", ["["])
    const values: string[] = []

    if (this.peek().type !== "punctuation" || this.peek().value !== "]") {
      values.push(this.expect("string").value)
      while (this.peek().type === "punctuation" && this.peek().value === ",") {
        this.advance()
        values.push(this.expect("string").value)
      }
    }

    this.expect("punctuation", ["]"])
    return values
  }

  // ─── Token Helpers ─────────────────────────────────────────────────────

  private peek(): Token {
    return this.tokens[this.pos]
  }

  private advance(): Token {
    const token = this.tokens[this.pos]
    this.pos++
    return token
  }

  private expect(type: TokenType, values?: string[]): Token {
    const token = this.peek()
    if (token.type !== type) {
      throw new DaclParseError(
        `Expected token type '${type}', got '${token.type}' ('${token.value}')`,
        token.line,
        token.column,
        this.source,
      )
    }
    if (values && !values.includes(token.value)) {
      throw new DaclParseError(
        `Expected one of [${values.join(", ")}], got '${token.value}'`,
        token.line,
        token.column,
        this.source,
      )
    }
    return this.advance()
  }
}

// ─── Public Parser API ───────────────────────────────────────────────────────

/**
 * Parse a DACL policy source string into an AST.
 */
export function parseDacl(source: string): DaclPolicyAST {
  const tokens = tokenize(source)
  const parser = new DaclParser(tokens, source)
  return parser.parse()
}

// ─── Condition Evaluation Helpers ────────────────────────────────────────────

function resolveFieldValue(expr: DaclFieldPath | DaclLiteral, ctx: PolicyCheckContext): unknown {
  if (expr.kind === "literal") return expr.value

  const obj = expr.root === "row" ? ctx.row : ctx.user
  const parts = expr.path.split(".")
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function evaluateCondition(cond: DaclCondition, ctx: PolicyCheckContext): boolean {
  switch (cond.type) {
    case "role": {
      const hasAny = cond.values.some((v) => ctx.user.roles.includes(v))
      return cond.operator === "in" ? hasAny : !hasAny
    }
    case "field": {
      const leftVal = resolveFieldValue(cond.left, ctx)
      const rightVal = resolveFieldValue(cond.right, ctx)
      switch (cond.operator) {
        case "==":
          return leftVal === rightVal
        case "!=":
          return leftVal !== rightVal
        case ">":
          return (leftVal as number) > (rightVal as number)
        case ">=":
          return (leftVal as number) >= (rightVal as number)
        case "<":
          return (leftVal as number) < (rightVal as number)
        case "<=":
          return (leftVal as number) <= (rightVal as number)
      }
      return false
    }
    case "and":
      return evaluateCondition(cond.left, ctx) && evaluateCondition(cond.right, ctx)
    case "or":
      return evaluateCondition(cond.left, ctx) || evaluateCondition(cond.right, ctx)
  }
}

// ─── Compiler ────────────────────────────────────────────────────────────────

/**
 * Compile a DACL AST into application-level PolicyDefinition[].
 */
export function compileToPolicies(ast: DaclPolicyAST): PolicyDefinition[] {
  return ast.statements.map((stmt, idx) => {
    const roles = extractRoles(stmt.condition)
    const hasFieldCondition = hasFieldConditions(stmt.condition)

    const policy: PolicyDefinition = {
      id: `dacl_${idx + 1}`,
      table: stmt.table,
      action: stmt.action,
      effect: stmt.effect,
      roles,
      priority: 0,
      description: formatStatementDescription(stmt),
    }

    if (hasFieldCondition && stmt.condition) {
      const capturedCondition = stmt.condition
      policy.condition = (ctx: PolicyCheckContext) => evaluateCondition(capturedCondition, ctx)
    }

    return policy
  })
}

/**
 * Extract role names from role-in conditions.
 */
function extractRoles(cond: DaclCondition | null): string[] {
  if (!cond) return []
  switch (cond.type) {
    case "role":
      return cond.operator === "in" ? [...cond.values] : []
    case "and":
    case "or":
      return [...extractRoles(cond.left), ...extractRoles(cond.right)]
    case "field":
      return []
  }
}

/**
 * Check whether a condition tree contains field comparisons.
 */
function hasFieldConditions(cond: DaclCondition | null): boolean {
  if (!cond) return false
  switch (cond.type) {
    case "field":
      return true
    case "role":
      return false
    case "and":
    case "or":
      return hasFieldConditions(cond.left) || hasFieldConditions(cond.right)
  }
}

/**
 * Format a human-readable description for a DACL statement.
 */
function formatStatementDescription(stmt: DaclStatement): string {
  const condStr = stmt.condition ? ` where ${formatCondition(stmt.condition)}` : ""
  return `${stmt.effect} ${stmt.action} on ${stmt.table}${condStr}`
}

function formatCondition(cond: DaclCondition): string {
  switch (cond.type) {
    case "role":
      return `role ${cond.operator === "not_in" ? "not in" : "in"} [${cond.values.map((v) => `"${v}"`).join(", ")}]`
    case "field": {
      const l = cond.left.kind === "field" ? `${cond.left.root}.${cond.left.path}` : JSON.stringify(cond.left.value)
      const r = cond.right.kind === "field" ? `${cond.right.root}.${cond.right.path}` : JSON.stringify(cond.right.value)
      return `${l} ${cond.operator} ${r}`
    }
    case "and":
      return `${formatCondition(cond.left)} and ${formatCondition(cond.right)}`
    case "or":
      return `(${formatCondition(cond.left)} or ${formatCondition(cond.right)})`
  }
}

// ─── RLS SQL Compiler ────────────────────────────────────────────────────────

function actionToRlsCommand(action: Action): RlsPolicy["command"] {
  switch (action) {
    case "read":
      return "SELECT"
    case "create":
      return "INSERT"
    case "update":
      return "UPDATE"
    case "delete":
      return "DELETE"
    case "write":
      return "ALL"
    case "*":
      return "ALL"
  }
}

/**
 * Compile a condition to a SQL expression for RLS policies.
 * Returns null for conditions that cannot be represented in SQL.
 */
function conditionToSQL(cond: DaclCondition): string | null {
  switch (cond.type) {
    case "role": {
      const list = cond.values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ")
      const expr = `current_setting('app.user_role') IN (${list})`
      return cond.operator === "not_in" ? `NOT (${expr})` : expr
    }
    case "field": {
      const lSQL = fieldExprToSQL(cond.left)
      const rSQL = fieldExprToSQL(cond.right)
      if (lSQL === null || rSQL === null) return null
      return `${lSQL} ${cond.operator === "==" ? "=" : cond.operator === "!=" ? "<>" : cond.operator} ${rSQL}`
    }
    case "and": {
      const lExpr = conditionToSQL(cond.left)
      const rExpr = conditionToSQL(cond.right)
      if (lExpr === null || rExpr === null) return null
      return `(${lExpr}) AND (${rExpr})`
    }
    case "or": {
      const lExpr = conditionToSQL(cond.left)
      const rExpr = conditionToSQL(cond.right)
      if (lExpr === null || rExpr === null) return null
      return `(${lExpr}) OR (${rExpr})`
    }
  }
}

function fieldExprToSQL(expr: DaclFieldPath | DaclLiteral): string | null {
  if (expr.kind === "literal") {
    if (typeof expr.value === "string") return `'${String(expr.value).replace(/'/g, "''")}'`
    if (typeof expr.value === "number") return String(expr.value)
    if (typeof expr.value === "boolean") return expr.value ? "TRUE" : "FALSE"
    return null
  }
  if (expr.root === "row") return `"${expr.path}"`
  if (expr.root === "user") return `current_setting('app.${expr.path}')`
  return null
}

/**
 * Compile a DACL AST into Postgres RLS SQL policies.
 */
export function compileToRlsPolicies(ast: DaclPolicyAST): RlsPolicy[] {
  const policies: RlsPolicy[] = []

  for (let i = 0; i < ast.statements.length; i++) {
    const stmt = ast.statements[i]
    if (stmt.table === "*") continue // Cannot create RLS for wildcard tables

    const command = actionToRlsCommand(stmt.action)
    let usingExpr: string

    if (stmt.condition) {
      const sqlExpr = conditionToSQL(stmt.condition)
      if (sqlExpr === null) continue // Skip conditions that can't be compiled to SQL
      usingExpr = stmt.effect === "allow" ? sqlExpr : `NOT (${sqlExpr})`
    } else {
      usingExpr = stmt.effect === "allow" ? "true" : "false"
    }

    policies.push({
      table: stmt.table,
      name: `rls_dacl_${i + 1}`,
      command,
      usingExpression: usingExpr,
    })
  }

  return policies
}

/**
 * Compile a DACL AST into SQL statements including ALTER TABLE and CREATE POLICY.
 */
export function compileToRlsSQL(ast: DaclPolicyAST): string[] {
  const sqls: string[] = []
  const tables = new Set(ast.statements.map((s) => s.table).filter((t) => t !== "*"))

  for (const table of tables) {
    sqls.push(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`)
  }

  for (const rls of compileToRlsPolicies(ast)) {
    sqls.push(`CREATE POLICY "${rls.name}" ON "${rls.table}" FOR ${rls.command} USING (${rls.usingExpression});`)
  }

  return sqls
}

/**
 * Compile a DACL AST into both PolicyDefinition[] and RLS SQL.
 */
export function compileDacl(ast: DaclPolicyAST): DaclCompileResult {
  const policies = compileToPolicies(ast)
  const rlsPolicies = compileToRlsPolicies(ast)
  const rlsSQL = compileToRlsSQL(ast)
  const warnings: string[] = []

  // Warn about wildcard table statements (can't be compiled to RLS)
  for (let i = 0; i < ast.statements.length; i++) {
    const stmt = ast.statements[i]
    if (stmt.table === "*") {
      warnings.push(`Statement ${i + 1}: wildcard table '*' cannot be compiled to RLS`)
    }
    if (stmt.condition && conditionToSQL(stmt.condition) === null) {
      warnings.push(`Statement ${i + 1}: condition cannot be fully compiled to RLS SQL`)
    }
  }

  return { policies, rlsPolicies, rlsSQL, warnings }
}

// ─── Dry-Run Simulator ──────────────────────────────────────────────────────

/**
 * Simulate evaluation of DACL policies against a given context.
 * Returns a step-by-step trace showing which policies matched and why.
 */
export function simulateDacl(
  ast: DaclPolicyAST,
  context: PolicyCheckContext,
  defaultEffect: "allow" | "deny" = "deny",
): DaclSimulationResult {
  const start = Date.now()
  const steps: DaclSimulationStep[] = []
  let matchedIndex: number | null = null

  // Evaluate deny policies first, then allow (matching DaclEngine behavior)
  const denyIndices = ast.statements.map((s, i) => ({ stmt: s, idx: i })).filter((e) => e.stmt.effect === "deny")
  const allowIndices = ast.statements.map((s, i) => ({ stmt: s, idx: i })).filter((e) => e.stmt.effect === "allow")

  const ordered = [...denyIndices, ...allowIndices]

  for (const { stmt, idx } of ordered) {
    const tableMatch = stmt.table === context.table || stmt.table === "*"
    const actionMatch = stmt.action === context.action || stmt.action === "*"

    let conditionMatch: boolean | null = null
    if (tableMatch && actionMatch && stmt.condition) {
      conditionMatch = evaluateCondition(stmt.condition, context)
    } else if (tableMatch && actionMatch) {
      conditionMatch = true
    }

    const overallMatch = tableMatch && actionMatch && conditionMatch === true

    let reason: string
    if (!tableMatch) {
      reason = `Table mismatch: policy targets '${stmt.table}', context is '${context.table}'`
    } else if (!actionMatch) {
      reason = `Action mismatch: policy targets '${stmt.action}', context is '${context.action}'`
    } else if (conditionMatch === false) {
      reason = "Condition evaluated to false"
    } else if (overallMatch) {
      reason = `${stmt.effect === "allow" ? "Granted" : "Denied"} by statement`
    } else {
      reason = "Not evaluated (earlier match found)"
    }

    steps.push({
      statementIndex: idx,
      effect: stmt.effect,
      table: stmt.table,
      action: stmt.action,
      conditionSource: stmt.condition ? formatCondition(stmt.condition) : null,
      tableMatch,
      actionMatch,
      conditionMatch,
      overallMatch,
      reason,
    })

    if (overallMatch && matchedIndex === null) {
      matchedIndex = idx
    }
  }

  const allowed = matchedIndex !== null ? ast.statements[matchedIndex].effect === "allow" : defaultEffect === "allow"

  return {
    allowed,
    matchedStatementIndex: matchedIndex,
    defaultApplied: matchedIndex === null,
    steps,
    evaluationTimeMs: Date.now() - start,
  }
}

// ─── CLI Helpers ─────────────────────────────────────────────────────────────

export interface DaclParseCliResult {
  success: boolean
  ast: DaclPolicyAST | null
  statementCount: number
  error: string | null
}

export interface DaclCompileCliResult {
  success: boolean
  policies: PolicyDefinition[]
  rlsSQL: string[]
  warnings: string[]
  error: string | null
}

export interface DaclSimulateCliResult {
  success: boolean
  allowed: boolean
  matchedStatement: string | null
  defaultApplied: boolean
  steps: DaclSimulationStep[]
  error: string | null
}

/**
 * CLI helper for `dacl:parse` — parse a DACL source string and return results.
 */
export function daclParse(source: string): DaclParseCliResult {
  try {
    const ast = parseDacl(source)
    return {
      success: true,
      ast,
      statementCount: ast.statements.length,
      error: null,
    }
  } catch (err) {
    return {
      success: false,
      ast: null,
      statementCount: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * CLI helper for `dacl:compile` — parse and compile a DACL source string.
 */
export function daclCompile(source: string): DaclCompileCliResult {
  try {
    const ast = parseDacl(source)
    const result = compileDacl(ast)
    return {
      success: true,
      policies: result.policies,
      rlsSQL: result.rlsSQL,
      warnings: result.warnings,
      error: null,
    }
  } catch (err) {
    return {
      success: false,
      policies: [],
      rlsSQL: [],
      warnings: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * CLI helper for `dacl:simulate` — parse, then simulate against a context.
 */
export function daclSimulate(
  source: string,
  context: PolicyCheckContext,
  defaultEffect: "allow" | "deny" = "deny",
): DaclSimulateCliResult {
  try {
    const ast = parseDacl(source)
    const result = simulateDacl(ast, context, defaultEffect)
    return {
      success: true,
      allowed: result.allowed,
      matchedStatement:
        result.matchedStatementIndex !== null
          ? formatStatementDescription(ast.statements[result.matchedStatementIndex])
          : null,
      defaultApplied: result.defaultApplied,
      steps: result.steps,
      error: null,
    }
  } catch (err) {
    return {
      success: false,
      allowed: false,
      matchedStatement: null,
      defaultApplied: false,
      steps: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
