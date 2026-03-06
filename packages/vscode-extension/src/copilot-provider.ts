/**
 * ReactiveBase Copilot Provider for VS Code.
 * Provides schema-aware inline completions, hover info, code actions,
 * and diagnostics for ReactiveBase projects.
 *
 * Features:
 *   - Inline completion provider for ctx.db.* chains
 *   - Schema-aware hover provider showing column types and relations
 *   - Code action provider for "Generate mutation from comment"
 *   - Diagnostics provider for detecting common query mistakes
 *   - Configuration for AI provider selection (ollama/openai/anthropic)
 *
 * Usage:
 *   const provider = new ReactiveBaseCopilotProvider(outputChannel)
 *   provider.register(context)
 */

import * as vscode from "vscode"

// ─── Types ───────────────────────────────────────────────────────────────────

export type AIProviderType = "ollama" | "openai" | "anthropic"

export interface CopilotConfig {
  /** AI provider to use for completions (default: "ollama") */
  aiProvider: AIProviderType
  /** Whether inline completions are enabled (default: true) */
  enableInlineCompletions: boolean
  /** Whether schema hover info is enabled (default: true) */
  enableHover: boolean
  /** Whether code actions are enabled (default: true) */
  enableCodeActions: boolean
  /** Whether diagnostics are enabled (default: true) */
  enableDiagnostics: boolean
}

export interface InlineCompletionContext {
  /** The partial code before the cursor */
  beforeCursor: string
  /** Detected table name, if any */
  tableName: string | null
  /** Whether cursor is after a dot */
  afterDot: boolean
  /** Current partial word being typed */
  currentWord: string
}

export interface SchemaHoverInfo {
  /** Table name */
  tableName: string
  /** Columns with types */
  columns: { name: string; type: string; nullable: boolean }[]
  /** Indexes on this table */
  indexes: { name: string; columns: string[] }[]
  /** Relations from/to this table */
  relations: { direction: "from" | "to"; relatedTable: string; column: string }[]
}

interface SchemaTable {
  name: string
  columns: { name: string; type: string; nullable: boolean }[]
  indexes: { name: string; columns: string[] }[]
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CHAIN_METHODS = [
  {
    label: "where",
    detail: "Filter by conditions",
    insertText: "where({ })",
    doc: "Filter rows by field-value pairs.",
  },
  { label: "orderBy", detail: "Sort results", insertText: 'orderBy("field", "asc")', doc: "Sort by column." },
  { label: "limit", detail: "Limit result count", insertText: "limit(10)", doc: "Limit returned rows." },
  { label: "first", detail: "Get first result", insertText: "first()", doc: "Return only the first matching row." },
  { label: "count", detail: "Count matching rows", insertText: "count()", doc: "Count matching rows." },
  { label: "join", detail: "Join related table", insertText: 'join("table")', doc: "Join with a related table." },
  { label: "select", detail: "Select columns", insertText: 'select("col1", "col2")', doc: "Select specific columns." },
  { label: "insert", detail: "Insert a row", insertText: "insert({ })", doc: "Insert a new row." },
  { label: "update", detail: "Update a row", insertText: "update(id, { })", doc: "Update a row by id." },
  { label: "delete", detail: "Delete a row", insertText: "delete(id)", doc: "Delete a row by id." },
]

const DIAGNOSTIC_SOURCE = "reactivebase-copilot"

// ─── Copilot Provider ────────────────────────────────────────────────────────

/**
 * ReactiveBase Copilot Provider for VS Code.
 * Registers inline completions, hover, code actions, and diagnostics providers.
 */
export class ReactiveBaseCopilotProvider {
  private outputChannel: vscode.OutputChannel
  private diagnosticCollection: vscode.DiagnosticCollection
  private schema: SchemaTable[] = []

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE)
  }

  /**
   * Register all copilot providers with the VS Code extension context.
   */
  register(context: vscode.ExtensionContext): void {
    const config = this.loadConfig()

    if (config.enableInlineCompletions) {
      context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
          { scheme: "file", language: "typescript" },
          { provideInlineCompletionItems: this.provideInlineCompletions.bind(this) },
        ),
      )
      this.outputChannel.appendLine("[Copilot] Inline completion provider registered")
    }

    if (config.enableHover) {
      context.subscriptions.push(
        vscode.languages.registerHoverProvider(
          { scheme: "file", language: "typescript" },
          { provideHover: this.provideHover.bind(this) },
        ),
      )
      this.outputChannel.appendLine("[Copilot] Hover provider registered")
    }

    if (config.enableCodeActions) {
      context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
          { scheme: "file", language: "typescript" },
          { provideCodeActions: this.provideCodeActions.bind(this) },
          { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Refactor] },
        ),
      )
      this.outputChannel.appendLine("[Copilot] Code action provider registered")
    }

    if (config.enableDiagnostics) {
      context.subscriptions.push(this.diagnosticCollection)
      context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e) => this.updateDiagnostics(e.document)),
        vscode.workspace.onDidOpenTextDocument((doc) => this.updateDiagnostics(doc)),
      )
      this.outputChannel.appendLine("[Copilot] Diagnostics provider registered")
    }

    // Register copilot-specific commands
    context.subscriptions.push(
      vscode.commands.registerCommand("reactivebase.copilot.generateMutation", () => this.handleGenerateMutation()),
      vscode.commands.registerCommand("reactivebase.copilot.setProvider", () => this.handleSetProvider()),
    )

    this.outputChannel.appendLine(`[Copilot] AI provider: ${config.aiProvider}`)
  }

  /**
   * Update the schema used for completions and diagnostics.
   */
  setSchema(schema: SchemaTable[]): void {
    this.schema = schema
    this.outputChannel.appendLine(`[Copilot] Schema updated (${schema.length} tables)`)
  }

  // ─── Inline Completion Provider ─────────────────────────────────────────

  private provideInlineCompletions(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.InlineCompletionList | undefined {
    const lineText = document.lineAt(position.line).text
    const beforeCursor = lineText.substring(0, position.character)
    const ctx = this.parseContext(beforeCursor)
    const items: vscode.InlineCompletionItem[] = []

    // After "ctx.db." → suggest table names
    if (/ctx\.db\.$/.test(beforeCursor.trimEnd())) {
      for (const table of this.schema) {
        items.push(new vscode.InlineCompletionItem(table.name, new vscode.Range(position, position)))
      }
      return new vscode.InlineCompletionList(items)
    }

    // After "ctx.db.TABLE." → suggest chain methods
    if (ctx.tableName && ctx.afterDot) {
      for (const method of CHAIN_METHODS) {
        items.push(new vscode.InlineCompletionItem(method.insertText, new vscode.Range(position, position)))
      }
      return new vscode.InlineCompletionList(items)
    }

    // Inside .where({}) → suggest column names
    if (ctx.tableName && beforeCursor.includes(".where({")) {
      const table = this.schema.find((t) => t.name === ctx.tableName)
      if (table) {
        for (const col of table.columns) {
          items.push(new vscode.InlineCompletionItem(`${col.name}: `, new vscode.Range(position, position)))
        }
        return new vscode.InlineCompletionList(items)
      }
    }

    return undefined
  }

  // ─── Hover Provider ─────────────────────────────────────────────────────

  private provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const lineText = document.lineAt(position.line).text

    // Hover over table name after ctx.db.
    const tableMatch = /ctx\.db\.(\w+)/.exec(lineText)
    if (tableMatch) {
      const tableStart = lineText.indexOf(tableMatch[1], tableMatch.index + 7)
      const tableEnd = tableStart + tableMatch[1].length
      if (position.character >= tableStart && position.character <= tableEnd) {
        const hoverInfo = this.getSchemaHoverInfo(tableMatch[1])
        if (hoverInfo) {
          const md = this.formatHoverMarkdown(hoverInfo)
          return new vscode.Hover(
            new vscode.MarkdownString(md),
            new vscode.Range(position.line, tableStart, position.line, tableEnd),
          )
        }
      }
    }

    // Hover over chain methods
    const methodPatterns: Array<{ pattern: RegExp; doc: string }> = [
      { pattern: /\.where\(/, doc: "**`.where(filter)`** — Filter rows by field-value pairs." },
      { pattern: /\.orderBy\(/, doc: '**`.orderBy(field, direction)`** — Sort results. Direction: "asc" or "desc".' },
      { pattern: /\.limit\(/, doc: "**`.limit(n)`** — Limit the number of returned rows." },
      { pattern: /\.first\(/, doc: "**`.first()`** — Return only the first matching row, or null." },
      { pattern: /\.count\(/, doc: "**`.count()`** — Count matching rows without fetching data." },
      { pattern: /\.join\(/, doc: "**`.join(table)`** — Join with a related table by foreign key." },
      { pattern: /\.select\(/, doc: "**`.select(...columns)`** — Select specific columns to reduce data transfer." },
    ]

    for (const mp of methodPatterns) {
      const match = mp.pattern.exec(lineText)
      if (match) {
        const start = match.index
        const end = start + match[0].length
        if (position.character >= start && position.character <= end) {
          return new vscode.Hover(
            new vscode.MarkdownString(mp.doc),
            new vscode.Range(position.line, start, position.line, end),
          )
        }
      }
    }

    return undefined
  }

  // ─── Code Action Provider ───────────────────────────────────────────────

  private provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = []
    const lineText = document.lineAt(range.start.line).text

    // "Generate mutation from comment" — detect comment lines like: // create a user
    const commentMatch = /\/\/\s*(create|add|update|delete|remove)\s+(.+)/i.exec(lineText)
    if (commentMatch) {
      const action = new vscode.CodeAction(
        `ReactiveBase: Generate mutation from comment`,
        vscode.CodeActionKind.Refactor,
      )
      action.command = {
        command: "reactivebase.copilot.generateMutation",
        title: "Generate Mutation",
        arguments: [commentMatch[0].replace(/^\/\/\s*/, "").trim(), range.start.line],
      }
      actions.push(action)
    }

    // Quick fix for empty .where({})
    if (/\.where\(\{\s*\}\)/.test(lineText)) {
      const action = new vscode.CodeAction("Add .limit(100) to restrict results", vscode.CodeActionKind.QuickFix)
      const whereIdx = lineText.indexOf(".where({})")
      if (whereIdx >= 0) {
        action.edit = new vscode.WorkspaceEdit()
        action.edit.replace(
          document.uri,
          new vscode.Range(range.start.line, whereIdx, range.start.line, whereIdx + ".where({})".length),
          ".where({}).limit(100)",
        )
        actions.push(action)
      }
    }

    // Quick fix for mutation without auth check
    if (lineText.includes("mutation(") && !document.getText().includes("ctx.auth")) {
      const action = new vscode.CodeAction("Add authentication check", vscode.CodeActionKind.QuickFix)
      const braceIdx = lineText.indexOf("{")
      if (braceIdx >= 0) {
        action.edit = new vscode.WorkspaceEdit()
        action.edit.insert(
          document.uri,
          new vscode.Position(range.start.line, braceIdx + 1),
          '\n  const identity = await ctx.auth.getUserIdentity()\n  if (!identity) throw new Error("Unauthenticated")\n',
        )
        actions.push(action)
      }
    }

    return actions
  }

  // ─── Diagnostics Provider ───────────────────────────────────────────────

  private updateDiagnostics(document: vscode.TextDocument): void {
    if (!document.fileName.endsWith(".ts") && !document.fileName.endsWith(".tsx")) {
      return
    }

    const text = document.getText()
    const lines = text.split("\n")
    const diagnostics: vscode.Diagnostic[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Check for references to non-existent tables
      const tableRefs = line.matchAll(/ctx\.db\.(\w+)/g)
      for (const match of tableRefs) {
        const tableName = match[1]
        if (tableName !== "raw" && this.schema.length > 0 && !this.schema.some((t) => t.name === tableName)) {
          const startChar = match.index! + 7
          const diag = new vscode.Diagnostic(
            new vscode.Range(i, startChar, i, startChar + tableName.length),
            `Table "${tableName}" does not exist in schema`,
            vscode.DiagnosticSeverity.Error,
          )
          diag.source = DIAGNOSTIC_SOURCE
          diag.code = "unknown-table"
          diagnostics.push(diag)
        }
      }

      // Check for .where() with empty object
      if (/\.where\(\{\s*\}\)/.test(line) && !line.includes("// all")) {
        const idx = line.indexOf(".where({})")
        if (idx >= 0) {
          const diag = new vscode.Diagnostic(
            new vscode.Range(i, idx, i, idx + 10),
            "Empty .where({}) fetches all rows — use specific filters or add .limit()",
            vscode.DiagnosticSeverity.Warning,
          )
          diag.source = DIAGNOSTIC_SOURCE
          diag.code = "empty-where"
          diagnostics.push(diag)
        }
      }

      // Check for mutation without auth check
      if (line.includes("mutation(") && !text.includes("ctx.auth")) {
        const mutIdx = line.indexOf("mutation(")
        if (mutIdx >= 0) {
          const diag = new vscode.Diagnostic(
            new vscode.Range(i, mutIdx, i, mutIdx + 9),
            "Mutation does not check ctx.auth — consider adding authentication",
            vscode.DiagnosticSeverity.Information,
          )
          diag.source = DIAGNOSTIC_SOURCE
          diag.code = "no-auth-check"
          diagnostics.push(diag)
        }
      }

      // Check for missing .limit() on unbounded queries
      if (
        line.includes(".where(") &&
        !line.includes(".limit(") &&
        !line.includes(".first(") &&
        !line.includes(".count(")
      ) {
        const whereIdx = line.indexOf(".where(")
        if (whereIdx >= 0 && !line.includes("// no-limit")) {
          const diag = new vscode.Diagnostic(
            new vscode.Range(i, whereIdx, i, whereIdx + 7),
            "Query without .limit() may return unbounded results — consider adding .limit()",
            vscode.DiagnosticSeverity.Hint,
          )
          diag.source = DIAGNOSTIC_SOURCE
          diag.code = "missing-limit"
          diagnostics.push(diag)
        }
      }
    }

    this.diagnosticCollection.set(document.uri, diagnostics)
  }

  // ─── Command Handlers ──────────────────────────────────────────────────

  private async handleGenerateMutation(): Promise<void> {
    const description = await vscode.window.showInputBox({
      prompt: "Describe the mutation in natural language",
      placeHolder: 'e.g. "create a user with name and email"',
    })

    if (!description) return

    this.outputChannel.appendLine(`[Copilot] Generating mutation: "${description}"`)

    // Generate a simple rule-based mutation
    const code = this.generateSimpleMutation(description)
    if (code) {
      const editor = vscode.window.activeTextEditor
      if (editor) {
        editor.edit((editBuilder) => {
          editBuilder.insert(editor.selection.active, code)
        })
        vscode.window.showInformationMessage("ReactiveBase: Mutation generated")
      }
    } else {
      vscode.window.showWarningMessage("ReactiveBase: Could not generate mutation from description")
    }
  }

  private async handleSetProvider(): Promise<void> {
    const selection = await vscode.window.showQuickPick(
      [
        { label: "Ollama (Local)", description: "Local inference via Ollama", value: "ollama" },
        { label: "OpenAI", description: "Cloud inference via OpenAI API", value: "openai" },
        { label: "Anthropic", description: "Cloud inference via Anthropic API", value: "anthropic" },
      ],
      { placeHolder: "Select AI provider for copilot features" },
    )

    if (selection) {
      const config = vscode.workspace.getConfiguration("reactivebase")
      await config.update("copilot.aiProvider", selection.value, vscode.ConfigurationTarget.Global)
      vscode.window.showInformationMessage(`ReactiveBase: AI provider set to ${selection.label}`)
      this.outputChannel.appendLine(`[Copilot] AI provider changed to: ${selection.value}`)
    }
  }

  // ─── Internal Helpers ──────────────────────────────────────────────────

  private loadConfig(): CopilotConfig {
    const config = vscode.workspace.getConfiguration("reactivebase")
    return {
      aiProvider: config.get<AIProviderType>("copilot.aiProvider", "ollama"),
      enableInlineCompletions: config.get<boolean>("copilot.enableInlineCompletions", true),
      enableHover: config.get<boolean>("copilot.enableHover", true),
      enableCodeActions: config.get<boolean>("copilot.enableCodeActions", true),
      enableDiagnostics: config.get<boolean>("copilot.enableDiagnostics", true),
    }
  }

  private parseContext(beforeCursor: string): InlineCompletionContext {
    const afterDot = beforeCursor.trimEnd().endsWith(".")
    const wordMatch = /(\w*)$/.exec(beforeCursor)
    const currentWord = wordMatch?.[1] ?? ""
    const tableMatch = /ctx\.db\.(\w+)\s*\.?\s*$/.exec(beforeCursor)
    const tableName = tableMatch?.[1] ?? null

    return { beforeCursor, tableName, afterDot, currentWord }
  }

  private getSchemaHoverInfo(tableName: string): SchemaHoverInfo | null {
    const table = this.schema.find((t) => t.name === tableName)
    if (!table) return null

    const relations: SchemaHoverInfo["relations"] = []

    // Detect outgoing relations (columns ending in Id)
    for (const col of table.columns) {
      if (col.name.endsWith("Id") && col.name.length > 2) {
        const relatedTable = col.name.slice(0, -2) + "s"
        if (this.schema.some((t) => t.name === relatedTable)) {
          relations.push({ direction: "from", relatedTable, column: col.name })
        }
      }
    }

    // Detect incoming relations
    for (const otherTable of this.schema) {
      if (otherTable.name === tableName) continue
      for (const col of otherTable.columns) {
        const singularName = tableName.replace(/s$/, "")
        if (col.name === `${singularName}Id`) {
          relations.push({ direction: "to", relatedTable: otherTable.name, column: col.name })
        }
      }
    }

    return {
      tableName: table.name,
      columns: table.columns,
      indexes: table.indexes,
      relations,
    }
  }

  private formatHoverMarkdown(info: SchemaHoverInfo): string {
    const parts: string[] = [`**Table: ${info.tableName}**\n`]

    parts.push("**Columns:**")
    for (const col of info.columns) {
      parts.push(`- \`${col.name}\`: ${col.type}${col.nullable ? " (nullable)" : ""}`)
    }

    if (info.indexes.length > 0) {
      parts.push("\n**Indexes:**")
      for (const idx of info.indexes) {
        parts.push(`- \`${idx.name}\` on (${idx.columns.join(", ")})`)
      }
    }

    if (info.relations.length > 0) {
      parts.push("\n**Relations:**")
      for (const rel of info.relations) {
        if (rel.direction === "from") {
          parts.push(`- → \`${rel.relatedTable}\` via \`${rel.column}\``)
        } else {
          parts.push(`- ← \`${rel.relatedTable}\` via \`${rel.column}\``)
        }
      }
    }

    return parts.join("\n")
  }

  private generateSimpleMutation(description: string): string | null {
    const createMatch = /(?:create|add|insert)\s+(?:a\s+)?(?:new\s+)?(\w+)/i.exec(description)
    if (createMatch) {
      const singular = createMatch[1].toLowerCase()
      const table = singular.endsWith("s") ? singular : singular + "s"
      return `export const create${singular.charAt(0).toUpperCase() + singular.slice(1)} = mutation(async (ctx, args: Record<string, unknown>) => {\n  const identity = await ctx.auth.getUserIdentity()\n  if (!identity) throw new Error("Unauthenticated")\n\n  return ctx.db.${table}.insert(args)\n})\n`
    }

    const deleteMatch = /(?:delete|remove)\s+(?:a\s+)?(\w+)/i.exec(description)
    if (deleteMatch) {
      const singular = deleteMatch[1].toLowerCase()
      const table = singular.endsWith("s") ? singular : singular + "s"
      return `export const delete${singular.charAt(0).toUpperCase() + singular.slice(1)} = mutation(async (ctx, args: { id: string }) => {\n  const identity = await ctx.auth.getUserIdentity()\n  if (!identity) throw new Error("Unauthenticated")\n\n  await ctx.db.${table}.delete(args.id)\n})\n`
    }

    const updateMatch = /(?:update|modify)\s+(?:a\s+)?(\w+)/i.exec(description)
    if (updateMatch) {
      const singular = updateMatch[1].toLowerCase()
      const table = singular.endsWith("s") ? singular : singular + "s"
      return `export const update${singular.charAt(0).toUpperCase() + singular.slice(1)} = mutation(async (ctx, args: { id: string; data: Record<string, unknown> }) => {\n  const identity = await ctx.auth.getUserIdentity()\n  if (!identity) throw new Error("Unauthenticated")\n\n  return ctx.db.${table}.update(args.id, args.data)\n})\n`
    }

    return null
  }
}
