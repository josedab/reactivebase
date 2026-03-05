/**
 * PlaygroundEngine — core execution engine for the ReactiveBase Playground.
 * Handles session management, code execution, tutorial progress, and session sharing.
 */

import { randomUUID } from "node:crypto"

import {
  type PlaygroundSession,
  type ExecutionResult,
  type TutorialDefinition,
  type TutorialStep,
  type PlaygroundOptions,
  type PlaygroundContext,
  type PlaygroundTemplate,
  type LogEntry,
  DEFAULT_PLAYGROUND_OPTIONS,
  PlaygroundError,
} from "./playground-types.js"
import { PLAYGROUND_TEMPLATES, BUILTIN_TUTORIALS } from "./playground-templates.js"

export class PlaygroundEngine {
  private options: Required<PlaygroundOptions>
  private sessions = new Map<string, PlaygroundSession>()
  private tutorials: Map<string, TutorialDefinition>
  private tutorialProgress = new Map<string, Map<string, Set<string>>>()

  constructor(options: PlaygroundOptions = {}) {
    this.options = { ...DEFAULT_PLAYGROUND_OPTIONS, ...options }
    this.tutorials = new Map<string, TutorialDefinition>()
    for (const t of BUILTIN_TUTORIALS) {
      this.tutorials.set(t.id, t)
    }
    for (const t of this.options.tutorials) {
      this.tutorials.set(t.id, t)
    }
  }

  get sessionCount(): number {
    return this.sessions.size
  }

  get availableTutorials(): TutorialDefinition[] {
    return Array.from(this.tutorials.values())
  }

  get templates(): PlaygroundTemplate[] {
    return PLAYGROUND_TEMPLATES
  }

  // ─── Session Management ──────────────────────────────────────────────────

  createSession(title?: string, templateId?: string): PlaygroundSession {
    const id = `pg-${randomUUID()}`
    const template = templateId ? PLAYGROUND_TEMPLATES.find((t) => t.id === templateId) : undefined

    if (templateId && !template) {
      throw new PlaygroundError(`Template not found: ${templateId}`)
    }

    if (this.sessions.size >= this.options.maxSessions) {
      this.evictOldestSession()
    }

    const session: PlaygroundSession = {
      id,
      title: title ?? template?.name ?? "Untitled Playground",
      code: "",
      schemaCode: template?.schema ?? "",
      queryCode: template?.queries ?? "",
      mutationCode: template?.mutations ?? "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      results: [],
    }

    this.sessions.set(id, session)
    return session
  }

  getSession(sessionId: string): PlaygroundSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new PlaygroundError(`Session not found: ${sessionId}`)
    return session
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  updateSession(
    sessionId: string,
    updates: Partial<Pick<PlaygroundSession, "title" | "schemaCode" | "queryCode" | "mutationCode">>,
  ): PlaygroundSession {
    const session = this.getSession(sessionId)
    if (updates.title !== undefined) session.title = updates.title
    if (updates.schemaCode !== undefined) session.schemaCode = updates.schemaCode
    if (updates.queryCode !== undefined) session.queryCode = updates.queryCode
    if (updates.mutationCode !== undefined) session.mutationCode = updates.mutationCode
    session.updatedAt = Date.now()
    return session
  }

  deleteSession(sessionId: string): void {
    if (!this.sessions.delete(sessionId)) {
      throw new PlaygroundError(`Session not found: ${sessionId}`)
    }
  }

  listSessions(): PlaygroundSession[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  // ─── Code Execution ──────────────────────────────────────────────────────

  execute(sessionId: string, blockId: string, code: string): ExecutionResult {
    const session = this.getSession(sessionId)
    const start = Date.now()

    try {
      const context = this.createMockContext(session)
      const output = this.evaluateCode(code, context)

      const result: ExecutionResult = {
        blockId,
        status: "success",
        output,
        durationMs: Date.now() - start,
        timestamp: Date.now(),
      }

      session.results = [...session.results.filter((r) => r.blockId !== blockId), result]
      session.updatedAt = Date.now()
      return result
    } catch (err: unknown) {
      const result: ExecutionResult = {
        blockId,
        status: "error",
        output: null,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
        timestamp: Date.now(),
      }

      session.results = [...session.results.filter((r) => r.blockId !== blockId), result]
      session.updatedAt = Date.now()
      return result
    }
  }

  // ─── Tutorial Engine ─────────────────────────────────────────────────────

  getTutorial(tutorialId: string): TutorialDefinition {
    const tutorial = this.tutorials.get(tutorialId)
    if (!tutorial) throw new PlaygroundError(`Tutorial not found: ${tutorialId}`)
    return tutorial
  }

  startTutorial(sessionId: string, tutorialId: string): TutorialStep {
    const tutorial = this.getTutorial(tutorialId)
    if (!this.tutorialProgress.has(sessionId)) {
      this.tutorialProgress.set(sessionId, new Map())
    }
    const sessionProgress = this.tutorialProgress.get(sessionId)!
    sessionProgress.set(tutorialId, new Set())
    return tutorial.steps[0]
  }

  validateStep(
    sessionId: string,
    tutorialId: string,
    stepId: string,
    result: ExecutionResult,
  ): { passed: boolean; message: string } {
    const tutorial = this.getTutorial(tutorialId)
    const step = tutorial.steps.find((s) => s.id === stepId)
    if (!step) throw new PlaygroundError(`Step not found: ${stepId}`)

    let passed = false
    let message = ""

    switch (step.validation) {
      case "no-errors":
        passed = result.status === "success"
        message = passed ? "No errors — step complete!" : `Error: ${result.error}`
        break
      case "has-output":
        passed = result.status === "success" && result.output != null
        message = passed ? "Output received — step complete!" : "No output produced"
        break
      case "matches-pattern":
        if (step.validationPattern && result.status === "success") {
          try {
            const pattern = step.validationPattern
            // Reject patterns with potential catastrophic backtracking
            if (/(\.\*){2,}|(\\\w\+){2,}\+|(\.\+){2,}|([^\\]\+){3,}/.test(pattern) || pattern.length > 1000) {
              passed = false
              message = "Validation pattern is too complex"
            } else {
              const regex = new RegExp(pattern)
              const outputStr = typeof result.output === "string" ? result.output : JSON.stringify(result.output)
              passed = regex.test(outputStr)
              message = passed ? "Pattern matched — step complete!" : `Output doesn't match expected pattern`
            }
          } catch {
            passed = false
            message = "Invalid validation pattern"
          }
        }
        break
      case "custom":
        passed = result.status === "success"
        message = passed ? "Step complete!" : `Error: ${result.error}`
        break
    }

    if (passed) {
      this.markStepComplete(sessionId, tutorialId, stepId)
    }

    return { passed, message }
  }

  getTutorialProgress(
    sessionId: string,
    tutorialId: string,
  ): { completedSteps: string[]; totalSteps: number; isComplete: boolean } {
    const tutorial = this.getTutorial(tutorialId)
    const sessionProgress = this.tutorialProgress.get(sessionId)
    const completedSteps = sessionProgress?.get(tutorialId)

    const completed = completedSteps ? Array.from(completedSteps) : []
    return {
      completedSteps: completed,
      totalSteps: tutorial.steps.length,
      isComplete: completed.length >= tutorial.steps.length,
    }
  }

  getNextStep(sessionId: string, tutorialId: string): TutorialStep | null {
    const tutorial = this.getTutorial(tutorialId)
    const progress = this.getTutorialProgress(sessionId, tutorialId)

    for (const step of tutorial.steps) {
      if (!progress.completedSteps.includes(step.id)) {
        return step
      }
    }
    return null
  }

  // ─── Session Sharing ─────────────────────────────────────────────────────

  encodeSession(sessionId: string): string {
    const session = this.getSession(sessionId)
    const data = {
      t: session.title,
      s: session.schemaCode,
      q: session.queryCode,
      m: session.mutationCode,
    }
    return Buffer.from(JSON.stringify(data)).toString("base64url")
  }

  decodeSession(encoded: string): PlaygroundSession {
    try {
      const json = Buffer.from(encoded, "base64url").toString("utf-8")
      const data = JSON.parse(json)
      const session = this.createSession(data.t)
      this.updateSession(session.id, {
        schemaCode: data.s ?? "",
        queryCode: data.q ?? "",
        mutationCode: data.m ?? "",
      })
      return session
    } catch {
      throw new PlaygroundError("Invalid encoded session data")
    }
  }

  // ─── Internal Helpers ────────────────────────────────────────────────────

  private markStepComplete(sessionId: string, tutorialId: string, stepId: string): void {
    if (!this.tutorialProgress.has(sessionId)) {
      this.tutorialProgress.set(sessionId, new Map())
    }
    const sessionProgress = this.tutorialProgress.get(sessionId)!
    if (!sessionProgress.has(tutorialId)) {
      sessionProgress.set(tutorialId, new Set())
    }
    sessionProgress.get(tutorialId)!.add(stepId)
  }

  private evictOldestSession(): void {
    let oldest: PlaygroundSession | null = null
    for (const session of this.sessions.values()) {
      if (!oldest || session.updatedAt < oldest.updatedAt) {
        oldest = session
      }
    }
    if (oldest) this.sessions.delete(oldest.id)
  }

  private createMockContext(_session: PlaygroundSession): PlaygroundContext {
    return {
      tables: {},
      variables: {},
      log: [],
    }
  }

  private evaluateCode(code: string, context: PlaygroundContext): unknown {
    const log: LogEntry[] = []
    const _mockConsole = {
      log: (...args: unknown[]) => {
        log.push({ level: "info", message: args.map(String).join(" "), timestamp: Date.now() })
      },
      warn: (...args: unknown[]) => {
        log.push({ level: "warn", message: args.map(String).join(" "), timestamp: Date.now() })
      },
      error: (...args: unknown[]) => {
        log.push({ level: "error", message: args.map(String).join(" "), timestamp: Date.now() })
      },
    }

    // Static analysis: extract exported names and structure
    const _exports: Record<string, unknown> = {}
    const importPattern = /import\s+\{([^}]+)\}\s+from\s+["'][^"']+["']/g
    const exportPattern = /export\s+(?:const|function|default)\s+(\w+)/g

    const imports: string[] = []
    let match: RegExpExecArray | null
    while ((match = importPattern.exec(code)) !== null) {
      imports.push(...match[1].split(",").map((s) => s.trim()))
    }

    const exportedNames: string[] = []
    while ((match = exportPattern.exec(code)) !== null) {
      exportedNames.push(match[1])
    }

    context.log = log

    return {
      imports,
      exports: exportedNames,
      log,
      parsed: true,
      linesOfCode: code.split("\n").filter((l) => l.trim().length > 0).length,
    }
  }
}
