/**
 * ReactiveBase VS Code Extension.
 *
 * Provides real-time type generation, schema validation, and inline
 * diagnostics for ReactiveBase projects. Watches function files and
 * auto-regenerates typed API modules on save.
 *
 * Features:
 *   - Watch mode: auto-regenerate types on file save
 *   - Status bar: shows generation status and function count
 *   - Diagnostics: inline errors for schema issues
 *   - Commands: manual generate, start/stop watch, validate schema
 */

import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import * as crypto from "crypto"

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExtensionState {
  watching: boolean
  watcher: vscode.FileSystemWatcher | null
  statusBarItem: vscode.StatusBarItem
  diagnosticCollection: vscode.DiagnosticCollection
  lastGenerateTime: number
  functionCount: number
  fileHashes: Map<string, string>
  debounceTimer: NodeJS.Timeout | null
  outputChannel: vscode.OutputChannel
}

interface ScanResult {
  functions: Array<{
    name: string
    type: "query" | "mutation" | "action"
    file: string
    line: number
    argsType: string
    hasAuth: boolean
  }>
  errors: Array<{
    file: string
    line: number
    message: string
  }>
}

// ─── Extension Lifecycle ─────────────────────────────────────────────────────

let state: ExtensionState

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("ReactiveBase")
  outputChannel.appendLine("ReactiveBase extension activated")

  state = {
    watching: false,
    watcher: null,
    statusBarItem: vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100),
    diagnosticCollection: vscode.languages.createDiagnosticCollection("reactivebase"),
    lastGenerateTime: 0,
    functionCount: 0,
    fileHashes: new Map(),
    debounceTimer: null,
    outputChannel,
  }

  state.statusBarItem.command = "reactivebase.showStatus"
  updateStatusBar("idle")
  state.statusBarItem.show()

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("reactivebase.generate", cmdGenerate),
    vscode.commands.registerCommand("reactivebase.watchStart", cmdWatchStart),
    vscode.commands.registerCommand("reactivebase.watchStop", cmdWatchStop),
    vscode.commands.registerCommand("reactivebase.showStatus", cmdShowStatus),
    vscode.commands.registerCommand("reactivebase.validateSchema", cmdValidateSchema),
    state.statusBarItem,
    state.diagnosticCollection,
    outputChannel,
  )

  // Auto-start watch mode if configured
  const config = vscode.workspace.getConfiguration("reactivebase")
  if (config.get<boolean>("autoGenerate", true)) {
    cmdWatchStart()
  }
}

export function deactivate(): void {
  if (state?.watcher) {
    state.watcher.dispose()
  }
  if (state?.debounceTimer) {
    clearTimeout(state.debounceTimer)
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdGenerate(): Promise<void> {
  updateStatusBar("generating")
  state.outputChannel.appendLine(`[${timestamp()}] Generating types...`)

  try {
    const result = await scanAndGenerate()
    state.functionCount = result.functions.length
    state.lastGenerateTime = Date.now()

    // Report diagnostics
    reportDiagnostics(result)

    updateStatusBar("idle")
    state.outputChannel.appendLine(
      `[${timestamp()}] Generated types for ${result.functions.length} functions` +
        (result.errors.length > 0 ? ` (${result.errors.length} errors)` : ""),
    )

    if (result.errors.length === 0) {
      vscode.window.showInformationMessage(`ReactiveBase: Generated types for ${result.functions.length} functions`)
    } else {
      vscode.window.showWarningMessage(`ReactiveBase: Generated types with ${result.errors.length} error(s)`)
    }
  } catch (error: unknown) {
    updateStatusBar("error")
    const msg = error instanceof Error ? error.message : String(error)
    state.outputChannel.appendLine(`[${timestamp()}] Error: ${msg}`)
    vscode.window.showErrorMessage(`ReactiveBase: ${msg}`)
  }
}

function cmdWatchStart(): void {
  if (state.watching) {
    vscode.window.showInformationMessage("ReactiveBase: Watch mode already active")
    return
  }

  const config = vscode.workspace.getConfiguration("reactivebase")
  const functionsDir = config.get<string>("functionsDir", "./convex")
  const debounceMs = config.get<number>("watchDebounceMs", 300)

  const pattern = new vscode.RelativePattern(
    vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file("."),
    `${functionsDir}/**/*.{ts,tsx}`,
  )

  state.watcher = vscode.workspace.createFileSystemWatcher(pattern)

  const debouncedGenerate = () => {
    if (state.debounceTimer) clearTimeout(state.debounceTimer)
    state.debounceTimer = setTimeout(async () => {
      updateStatusBar("generating")
      try {
        const result = await scanAndGenerate()
        state.functionCount = result.functions.length
        state.lastGenerateTime = Date.now()
        reportDiagnostics(result)
        updateStatusBar("watching")
      } catch {
        updateStatusBar("error")
      }
    }, debounceMs)
  }

  state.watcher.onDidChange(debouncedGenerate)
  state.watcher.onDidCreate(debouncedGenerate)
  state.watcher.onDidDelete(debouncedGenerate)

  state.watching = true
  updateStatusBar("watching")
  state.outputChannel.appendLine(`[${timestamp()}] Watch mode started (${functionsDir}/**/*.ts)`)

  // Initial generation
  cmdGenerate()
}

function cmdWatchStop(): void {
  if (!state.watching) return

  state.watcher?.dispose()
  state.watcher = null
  state.watching = false
  if (state.debounceTimer) clearTimeout(state.debounceTimer)

  updateStatusBar("idle")
  state.outputChannel.appendLine(`[${timestamp()}] Watch mode stopped`)
  vscode.window.showInformationMessage("ReactiveBase: Watch mode stopped")
}

function cmdShowStatus(): void {
  const status = [
    `ReactiveBase Extension Status`,
    `─────────────────────────────`,
    `Watch Mode: ${state.watching ? "Active ✅" : "Inactive"}`,
    `Functions Found: ${state.functionCount}`,
    `Last Generate: ${state.lastGenerateTime ? new Date(state.lastGenerateTime).toLocaleTimeString() : "Never"}`,
    `Files Tracked: ${state.fileHashes.size}`,
  ]

  state.outputChannel.appendLine("")
  for (const line of status) state.outputChannel.appendLine(line)
  state.outputChannel.show()
}

async function cmdValidateSchema(): Promise<void> {
  state.outputChannel.appendLine(`[${timestamp()}] Validating schema...`)

  const schemaFile = await findSchemaFile()
  if (!schemaFile) {
    vscode.window.showWarningMessage("ReactiveBase: No schema.ts file found")
    return
  }

  try {
    const content = await fs.promises.readFile(schemaFile, "utf-8")
    const errors = validateSchemaSource(content)

    if (errors.length === 0) {
      vscode.window.showInformationMessage("ReactiveBase: Schema is valid ✅")
    } else {
      const diagnostics: vscode.Diagnostic[] = errors.map(
        (e) =>
          new vscode.Diagnostic(
            new vscode.Range(e.line - 1, 0, e.line - 1, 100),
            e.message,
            vscode.DiagnosticSeverity.Error,
          ),
      )
      state.diagnosticCollection.set(vscode.Uri.file(schemaFile), diagnostics)
      vscode.window.showWarningMessage(`ReactiveBase: Schema has ${errors.length} error(s)`)
    }
  } catch (_error: unknown) {
    vscode.window.showErrorMessage(`ReactiveBase: Failed to validate schema`)
  }
}

// ─── Core Logic ──────────────────────────────────────────────────────────────

async function scanAndGenerate(): Promise<ScanResult> {
  const config = vscode.workspace.getConfiguration("reactivebase")
  const functionsDir = config.get<string>("functionsDir", "./convex")
  const outputDir = config.get<string>("outputDir", "./_generated")

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!workspaceRoot) throw new Error("No workspace folder open")

  const fullFunctionsDir = path.join(workspaceRoot, functionsDir)
  const fullOutputDir = path.join(workspaceRoot, outputDir)

  const functions: ScanResult["functions"] = []
  const errors: ScanResult["errors"] = []

  // Scan all .ts files in functions directory
  if (!fs.existsSync(fullFunctionsDir)) {
    throw new Error(`Functions directory not found: ${functionsDir}`)
  }

  const files = fs.readdirSync(fullFunctionsDir).filter((f) => f.endsWith(".ts") && f !== "schema.ts")

  for (const file of files) {
    const filePath = path.join(fullFunctionsDir, file)
    const content = await fs.promises.readFile(filePath, "utf-8")

    // Check if file changed since last scan
    const hash = crypto.createHash("md5").update(content).digest("hex")
    const prevHash = state.fileHashes.get(filePath)
    state.fileHashes.set(filePath, hash)

    if (prevHash === hash && state.functionCount > 0) continue

    const moduleName = path.basename(file, ".ts")
    const scanned = scanFunctionSource(content, moduleName, filePath)
    functions.push(...scanned.functions)
    errors.push(...scanned.errors)
  }

  // Generate output files
  if (functions.length > 0 || errors.length === 0) {
    await fs.promises.mkdir(fullOutputDir, { recursive: true })

    const apiContent = generateApiModule(functions)
    await fs.promises.writeFile(path.join(fullOutputDir, "api.ts"), apiContent)

    state.outputChannel.appendLine(
      `[${timestamp()}] Wrote ${path.join(outputDir, "api.ts")} (${functions.length} functions)`,
    )
  }

  return { functions, errors }
}

function scanFunctionSource(source: string, moduleName: string, filePath: string): ScanResult {
  const functions: ScanResult["functions"] = []
  const errors: ScanResult["errors"] = []

  // Match exported function definitions
  const patterns = [
    /export\s+const\s+(\w+)\s*=\s*(query|mutation|action)\s*\(\s*async\s+\(\s*ctx\s*(?:,\s*(?:\{[^}]*\}|\w+)\s*:\s*(\{[^}]*\}|\w+))?\s*\)/g,
    /export\s+const\s+(\w+)\s*=\s*(query|mutation|action)\s*\(\s*async\s+\(\s*ctx\s*\)/g,
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      const name = match[1]
      const type = match[2] as "query" | "mutation" | "action"
      const argsType = match[3] ?? "void"
      const line = source.substring(0, match.index).split("\n").length

      if (functions.some((f) => f.name === `${moduleName}.${name}`)) continue

      const fnBody = extractBody(source, match.index)
      const hasAuth = fnBody?.includes("ctx.auth") ?? false

      functions.push({
        name: `${moduleName}.${name}`,
        type,
        file: filePath,
        line,
        argsType,
        hasAuth,
      })
    }
  }

  // Check for common errors
  const duplicateExports = findDuplicateExports(source)
  for (const dup of duplicateExports) {
    errors.push({ file: filePath, line: dup.line, message: `Duplicate export: "${dup.name}"` })
  }

  return { functions, errors }
}

function extractBody(source: string, startIndex: number): string | null {
  let depth = 0
  let bodyStart = -1
  for (let i = startIndex; i < source.length; i++) {
    if (source[i] === "{") {
      if (bodyStart === -1) bodyStart = i
      depth++
    } else if (source[i] === "}") {
      depth--
      if (depth === 0 && bodyStart !== -1) {
        return source.substring(bodyStart, i + 1)
      }
    }
  }
  return null
}

function findDuplicateExports(source: string): Array<{ name: string; line: number }> {
  const seen = new Map<string, number>()
  const duplicates: Array<{ name: string; line: number }> = []
  const exportPattern = /export\s+const\s+(\w+)/g
  let match: RegExpExecArray | null
  while ((match = exportPattern.exec(source)) !== null) {
    const name = match[1]
    const line = source.substring(0, match.index).split("\n").length
    if (seen.has(name)) {
      duplicates.push({ name, line })
    }
    seen.set(name, line)
  }
  return duplicates
}

function generateApiModule(functions: ScanResult["functions"]): string {
  const lines: string[] = [
    "/* eslint-disable */",
    "/* Auto-generated by ReactiveBase VS Code Extension. Do not edit. */",
    "",
    "export interface FunctionReference<TArgs = unknown, TReturn = unknown> {",
    "  readonly _name: string",
    '  readonly _type: "query" | "mutation" | "action"',
    "  readonly _args: TArgs",
    "  readonly _return: TReturn",
    "}",
    "",
    "function ref<TArgs = unknown, TReturn = unknown>(",
    '  name: string, type: "query" | "mutation" | "action"',
    "): FunctionReference<TArgs, TReturn> {",
    "  return { _name: name, _type: type } as FunctionReference<TArgs, TReturn>",
    "}",
    "",
  ]

  // Group by module
  const modules = new Map<string, typeof functions>()
  for (const fn of functions) {
    const moduleName = fn.name.split(".")[0]
    if (!modules.has(moduleName)) modules.set(moduleName, [])
    modules.get(moduleName)!.push(fn)
  }

  lines.push("export const api = {")
  for (const [moduleName, fns] of modules) {
    lines.push(`  ${moduleName}: {`)
    for (const fn of fns) {
      const exportName = fn.name.split(".").pop()
      const args = fn.argsType === "void" ? "void" : fn.argsType
      lines.push(`    ${exportName}: ref<${args}, unknown>("${fn.name}", "${fn.type}"),`)
    }
    lines.push("  },")
  }
  lines.push("} as const")
  lines.push("")

  return lines.join("\n")
}

function validateSchemaSource(source: string): Array<{ line: number; message: string }> {
  const errors: Array<{ line: number; message: string }> = []

  // Check for defineSchema
  if (!source.includes("defineSchema")) {
    errors.push({ line: 1, message: "Missing defineSchema() call" })
  }

  // Check for duplicate table names
  const tableNames = new Map<string, number>()
  const tablePattern = /(\w+)\s*:\s*defineTable/g
  let match: RegExpExecArray | null
  while ((match = tablePattern.exec(source)) !== null) {
    const name = match[1]
    const line = source.substring(0, match.index).split("\n").length
    if (tableNames.has(name)) {
      errors.push({ line, message: `Duplicate table name: "${name}" (first defined at line ${tableNames.get(name)})` })
    }
    tableNames.set(name, line)
  }

  // Check for invalid validator usage
  const invalidValidators = /v\.\s*$/gm
  while ((match = invalidValidators.exec(source)) !== null) {
    const line = source.substring(0, match.index).split("\n").length
    errors.push({ line, message: "Incomplete validator expression" })
  }

  return errors
}

async function findSchemaFile(): Promise<string | null> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!workspaceRoot) return null

  const config = vscode.workspace.getConfiguration("reactivebase")
  const functionsDir = config.get<string>("functionsDir", "./convex")
  const schemaPath = path.join(workspaceRoot, functionsDir, "schema.ts")

  return fs.existsSync(schemaPath) ? schemaPath : null
}

// ─── UI Helpers ──────────────────────────────────────────────────────────────

function updateStatusBar(status: "idle" | "watching" | "generating" | "error"): void {
  switch (status) {
    case "idle":
      state.statusBarItem.text = `$(database) RB: ${state.functionCount} fns`
      state.statusBarItem.tooltip = "ReactiveBase — Click for status"
      state.statusBarItem.backgroundColor = undefined
      break
    case "watching":
      state.statusBarItem.text = `$(eye) RB: ${state.functionCount} fns`
      state.statusBarItem.tooltip = "ReactiveBase — Watch mode active"
      state.statusBarItem.backgroundColor = undefined
      break
    case "generating":
      state.statusBarItem.text = "$(sync~spin) RB: Generating..."
      state.statusBarItem.tooltip = "ReactiveBase — Generating types"
      break
    case "error":
      state.statusBarItem.text = "$(error) RB: Error"
      state.statusBarItem.tooltip = "ReactiveBase — Error occurred"
      state.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground")
      break
  }
}

function reportDiagnostics(result: ScanResult): void {
  state.diagnosticCollection.clear()

  const diagsByFile = new Map<string, vscode.Diagnostic[]>()
  for (const error of result.errors) {
    if (!diagsByFile.has(error.file)) diagsByFile.set(error.file, [])
    diagsByFile
      .get(error.file)!
      .push(
        new vscode.Diagnostic(
          new vscode.Range(error.line - 1, 0, error.line - 1, 100),
          error.message,
          vscode.DiagnosticSeverity.Error,
        ),
      )
  }

  for (const [file, diags] of diagsByFile) {
    state.diagnosticCollection.set(vscode.Uri.file(file), diags)
  }
}

function timestamp(): string {
  return new Date().toLocaleTimeString()
}
