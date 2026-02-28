/**
 * AI Schema & Query Copilot Commands for VS Code.
 * Registers commands for schema generation, index suggestions,
 * query explanation, and migration generation.
 *
 * Features:
 *   - Generate schema from natural language description
 *   - Suggest indexes for current schema
 *   - Explain query execution plan
 *   - Generate migration between schema versions
 *
 * Usage:
 *   const provider = new CopilotCommandProvider(outputChannel)
 *   const commands = provider.registerCommands()
 */

import * as vscode from "vscode"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CopilotCommand {
  /** Command identifier (e.g. "reactivebase.generateSchema") */
  id: string
  /** Human-readable title for command palette */
  title: string
  /** Command handler */
  handler: (context: CommandContext) => Promise<CommandResult>
}

export interface CommandContext {
  /** The active text editor, if any */
  editor: vscode.TextEditor | undefined
  /** The selected text in the active editor */
  selection: string
  /** The full document text of the active editor */
  documentText: string
  /** The output channel for logging */
  outputChannel: vscode.OutputChannel
}

export interface CommandResult {
  /** Whether the command succeeded */
  success: boolean
  /** Message to display to the user */
  message: string
  /** Generated content, if any */
  content?: string
}

// ─── Copilot Command Provider ────────────────────────────────────────────────

export class CopilotCommandProvider {
  private outputChannel: vscode.OutputChannel

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel
  }

  /**
   * Return all copilot command definitions.
   */
  registerCommands(): CopilotCommand[] {
    return [
      {
        id: "reactivebase.generateSchema",
        title: "ReactiveBase: Generate Schema from Description",
        handler: this.handleGenerateSchema.bind(this),
      },
      {
        id: "reactivebase.suggestIndexes",
        title: "ReactiveBase: Suggest Indexes",
        handler: this.handleSuggestIndexes.bind(this),
      },
      {
        id: "reactivebase.explainQuery",
        title: "ReactiveBase: Explain Query",
        handler: this.handleExplainQuery.bind(this),
      },
      {
        id: "reactivebase.generateMigration",
        title: "ReactiveBase: Generate Migration",
        handler: this.handleGenerateMigration.bind(this),
      },
    ]
  }

  // ─── Command Handlers ──────────────────────────────────────────────────

  private async handleGenerateSchema(context: CommandContext): Promise<CommandResult> {
    const description = await vscode.window.showInputBox({
      prompt: "Describe your schema in natural language",
      placeHolder: "e.g. a blog with posts, comments, and tags",
    })

    if (!description) {
      return { success: false, message: "No description provided" }
    }

    context.outputChannel.appendLine(`[Copilot] Generating schema from: "${description}"`)

    return {
      success: true,
      message: `Schema generation requested for: "${description}"`,
      content: description,
    }
  }

  private async handleSuggestIndexes(context: CommandContext): Promise<CommandResult> {
    if (!context.documentText) {
      return { success: false, message: "No active document — open a schema file first" }
    }

    context.outputChannel.appendLine("[Copilot] Analyzing schema for index suggestions...")

    return {
      success: true,
      message: "Index analysis requested",
      content: context.documentText,
    }
  }

  private async handleExplainQuery(context: CommandContext): Promise<CommandResult> {
    const queryText = context.selection || context.documentText
    if (!queryText) {
      return { success: false, message: "No query selected — select a query or open a query file" }
    }

    context.outputChannel.appendLine("[Copilot] Explaining query...")

    return {
      success: true,
      message: "Query explanation requested",
      content: queryText,
    }
  }

  private async handleGenerateMigration(context: CommandContext): Promise<CommandResult> {
    if (!context.documentText) {
      return { success: false, message: "No active document — open a schema file first" }
    }

    context.outputChannel.appendLine("[Copilot] Generating migration...")

    return {
      success: true,
      message: "Migration generation requested",
      content: context.documentText,
    }
  }
}

// ─── Registration Helper ─────────────────────────────────────────────────────

/**
 * Build a CommandContext from the current VS Code state.
 */
export function buildCommandContext(outputChannel: vscode.OutputChannel): CommandContext {
  const editor = vscode.window.activeTextEditor
  const selection = editor ? editor.document.getText(editor.selection) : ""
  const documentText = editor ? editor.document.getText() : ""

  return { editor, selection, documentText, outputChannel }
}
