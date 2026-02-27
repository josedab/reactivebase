/**
 * Guided Tutorial Engine — Enhanced guided tutorials with validation,
 * progressive hints, and completion tracking.
 *
 * Usage:
 *   const engine = new GuidedTutorialEngine()
 *   const session = engine.startTutorial("getting-started")
 *   const result = engine.submitStep(session.sessionId, 0, userCode)
 *   const progress = engine.getProgress(session.sessionId)
 */

import type { ValidationRule } from "./tutorial-manager.js"
import { randomUUID } from "node:crypto"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GuidedTutorialDef {
  id: string
  title: string
  description: string
  difficulty: "beginner" | "intermediate" | "advanced"
  estimatedMinutes: number
  steps: GuidedStepDef[]
}

export interface GuidedStepDef {
  title: string
  instruction: string
  starterCode: string
  solutionCode: string
  hints: string[]
  validationRules: ValidationRule[]
}

export interface GuidedTutorialSession {
  sessionId: string
  tutorialId: string
  currentStep: number
  completedSteps: Set<number>
  hintsUsed: Map<number, number>
  startedAt: number
}

export interface StepSubmissionResult {
  passed: boolean
  errors: string[]
  hint?: string
}

export interface TutorialProgress {
  sessionId: string
  tutorialId: string
  currentStep: number
  totalSteps: number
  completedSteps: number
  completionPercent: number
}

// ─── Built-in Guided Tutorials ───────────────────────────────────────────────

export const GUIDED_TUTORIALS: GuidedTutorialDef[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    description: "Define schema, create mutations, query data",
    difficulty: "beginner",
    estimatedMinutes: 10,
    steps: [
      {
        title: "Define Your Schema",
        instruction: "Create a schema with a `tasks` table containing `title` (string) and `done` (boolean) fields.",
        starterCode: `import { defineSchema, defineTable, v } from "@reactivebase/server"\n\nexport default defineSchema({\n  // Add your table here\n})`,
        solutionCode: `import { defineSchema, defineTable, v } from "@reactivebase/server"\n\nexport default defineSchema({\n  tasks: defineTable({\n    title: v.string(),\n    done: v.boolean({ default: false }),\n  }),\n})`,
        hints: [
          "Use defineTable() inside defineSchema() to create a table.",
          "Column types are defined with v.string(), v.boolean(), etc.",
          "Look at the solution: defineSchema({ tasks: defineTable({ title: v.string(), done: v.boolean({ default: false }) }) })",
        ],
        validationRules: [
          { type: "contains", value: "defineSchema", message: "Must use defineSchema()" },
          { type: "contains", value: "defineTable", message: "Must use defineTable()" },
          { type: "contains", value: "tasks", message: "Must define a 'tasks' table" },
        ],
      },
      {
        title: "Create a Mutation",
        instruction: "Create an `addTask` mutation that inserts a new task into the database.",
        starterCode: `import { mutation } from "@reactivebase/server"\n\n// Write a mutation that adds a task`,
        solutionCode: `import { mutation } from "@reactivebase/server"\n\nexport const addTask = mutation(async (ctx, args: { title: string }) => {\n  return ctx.db.tasks.insert({ title: args.title, done: false })\n})`,
        hints: [
          "Wrap your function with mutation() from @reactivebase/server.",
          "Use ctx.db.tasks.insert() to add a row.",
          "Don't forget to export the mutation: export const addTask = mutation(...)",
        ],
        validationRules: [
          { type: "contains", value: "mutation", message: "Must use mutation()" },
          { type: "exports", value: "addTask", message: "Must export 'addTask'" },
          { type: "contains", value: "insert", message: "Must insert data" },
        ],
      },
      {
        title: "Query Your Data",
        instruction: "Create a `listTasks` query that returns all tasks.",
        starterCode: `import { query } from "@reactivebase/server"\n\n// Write a query that returns all tasks`,
        solutionCode: `import { query } from "@reactivebase/server"\n\nexport const listTasks = query(async (ctx) => {\n  return ctx.db.tasks.where({})\n})`,
        hints: [
          "Wrap your function with query() from @reactivebase/server.",
          "Use ctx.db.tasks.where({}) to return all rows.",
          "Export it as: export const listTasks = query(...)",
        ],
        validationRules: [
          { type: "contains", value: "query", message: "Must use query()" },
          { type: "exports", value: "listTasks", message: "Must export 'listTasks'" },
          { type: "contains", value: "ctx.db", message: "Must access database via ctx.db" },
        ],
      },
    ],
  },
  {
    id: "realtime-subscriptions",
    title: "Real-time Subscriptions",
    description: "Set up reactive queries that update automatically",
    difficulty: "beginner",
    estimatedMinutes: 10,
    steps: [
      {
        title: "Create a Reactive Query",
        instruction:
          "Create a `liveTasks` query that returns incomplete tasks. Clients subscribed to this query receive updates automatically.",
        starterCode: `import { query } from "@reactivebase/server"\n\n// Reactive query for incomplete tasks`,
        solutionCode: `import { query } from "@reactivebase/server"\n\nexport const liveTasks = query(async (ctx) => {\n  return ctx.db.tasks.where({ done: false })\n})`,
        hints: [
          "All queries in ReactiveBase are reactive by default.",
          "Use .where({ done: false }) to filter incomplete tasks.",
          "Export the query so clients can subscribe to it.",
        ],
        validationRules: [
          { type: "contains", value: "query", message: "Must use query()" },
          { type: "contains", value: "where", message: "Must use .where() to filter" },
          { type: "contains", value: "done: false", message: "Must filter for incomplete tasks" },
        ],
      },
      {
        title: "Aggregation Subscription",
        instruction: "Create a `taskStats` query that returns total and completed task counts.",
        starterCode: `import { query } from "@reactivebase/server"\n\n// Query for task statistics`,
        solutionCode: `import { query } from "@reactivebase/server"\n\nexport const taskStats = query(async (ctx) => {\n  const total = await ctx.db.tasks.where({}).count()\n  const done = await ctx.db.tasks.where({ done: true }).count()\n  return { total, done, rate: total > 0 ? done / total : 0 }\n})`,
        hints: [
          "Use .count() to get the number of matching rows.",
          "Compute the rate as done / total (guard against division by zero).",
          "Export the query as taskStats.",
        ],
        validationRules: [
          { type: "contains", value: "count", message: "Must use .count() for aggregation" },
          { type: "exports", value: "taskStats", message: "Must export 'taskStats'" },
        ],
      },
    ],
  },
  {
    id: "auth-and-authorization",
    title: "Authentication & Authorization",
    description: "Add auth checks and role-based access to queries",
    difficulty: "intermediate",
    estimatedMinutes: 15,
    steps: [
      {
        title: "Require Authentication",
        instruction: "Create a `me` query that requires authentication and returns the current user.",
        starterCode: `import { query } from "@reactivebase/server"\n\n// Authenticated query`,
        solutionCode: `import { query } from "@reactivebase/server"\n\nexport const me = query(async (ctx) => {\n  const identity = await ctx.auth.getUserIdentity()\n  if (!identity) throw new Error("Not authenticated")\n  return ctx.db.users.where({ email: identity.email })\n})`,
        hints: [
          "Use ctx.auth.getUserIdentity() to get the current user.",
          "Throw an error if identity is null (user not authenticated).",
          "Query the users table using the identity's email.",
        ],
        validationRules: [
          { type: "contains", value: "ctx.auth", message: "Must check authentication" },
          { type: "contains", value: "getUserIdentity", message: "Must call getUserIdentity()" },
          { type: "exports", value: "me", message: "Must export 'me'" },
        ],
      },
      {
        title: "Role-Based Access",
        instruction: "Create an `adminStats` query that only allows users with the 'admin' role.",
        starterCode: `import { query } from "@reactivebase/server"\n\n// Admin-only query`,
        solutionCode: `import { query } from "@reactivebase/server"\n\nexport const adminStats = query(async (ctx) => {\n  const identity = await ctx.auth.getUserIdentity()\n  if (!identity || identity.role !== "admin") throw new Error("Unauthorized")\n  return ctx.db.users.where({}).count()\n})`,
        hints: [
          "First get the user identity with ctx.auth.getUserIdentity().",
          "Check that the user has role === 'admin'.",
          "Throw an error for unauthorized access.",
        ],
        validationRules: [
          { type: "contains", value: "ctx.auth", message: "Must check authentication" },
          { type: "contains", value: "role", message: "Must check user role" },
          { type: "exports", value: "adminStats", message: "Must export 'adminStats'" },
        ],
      },
    ],
  },
]

// ─── Guided Tutorial Engine ──────────────────────────────────────────────────

export class GuidedTutorialEngine {
  private tutorials = new Map<string, GuidedTutorialDef>()
  private sessions = new Map<string, GuidedTutorialSession>()

  constructor(customTutorials?: GuidedTutorialDef[]) {
    for (const t of [...GUIDED_TUTORIALS, ...(customTutorials ?? [])]) {
      this.tutorials.set(t.id, t)
    }
  }

  get tutorialCount(): number {
    return this.tutorials.size
  }

  get sessionCount(): number {
    return this.sessions.size
  }

  listTutorials(): GuidedTutorialDef[] {
    return Array.from(this.tutorials.values())
  }

  getTutorial(id: string): GuidedTutorialDef | undefined {
    return this.tutorials.get(id)
  }

  /**
   * Begin a guided tutorial and return a new session.
   */
  startTutorial(tutorialId: string): GuidedTutorialSession {
    const tutorial = this.tutorials.get(tutorialId)
    if (!tutorial) throw new Error(`Tutorial not found: ${tutorialId}`)

    const sessionId = `guided-${randomUUID()}`
    const session: GuidedTutorialSession = {
      sessionId,
      tutorialId,
      currentStep: 0,
      completedSteps: new Set(),
      hintsUsed: new Map(),
      startedAt: Date.now(),
    }

    this.sessions.set(sessionId, session)
    return session
  }

  /**
   * Validate user input for a step and advance if passed.
   */
  submitStep(sessionId: string, stepIndex: number, userCode: string): StepSubmissionResult {
    const session = this.sessions.get(sessionId)
    if (!session) return { passed: false, errors: ["Session not found"] }

    const tutorial = this.tutorials.get(session.tutorialId)
    if (!tutorial) return { passed: false, errors: ["Tutorial not found"] }

    const step = tutorial.steps[stepIndex]
    if (!step) return { passed: false, errors: ["Step not found"] }

    const errors: string[] = []

    for (const rule of step.validationRules) {
      switch (rule.type) {
        case "contains":
          if (!userCode.includes(rule.value)) errors.push(rule.message)
          break
        case "not_contains":
          if (userCode.includes(rule.value)) errors.push(rule.message)
          break
        case "exports":
          if (!userCode.includes(`export const ${rule.value}`) && !userCode.includes(`export function ${rule.value}`)) {
            errors.push(rule.message)
          }
          break
        case "calls":
          if (!userCode.includes(`${rule.value}(`)) errors.push(rule.message)
          break
        case "matches":
          try {
            const pattern = rule.value
            // Reject patterns with potential catastrophic backtracking
            if (/(\.\*){2,}|(\\\w\+){2,}\+|(\.\+){2,}|([^\\]\+){3,}/.test(pattern) || pattern.length > 1000) {
              errors.push("Validation pattern is too complex")
            } else {
              if (!new RegExp(pattern).test(userCode)) errors.push(rule.message)
            }
          } catch {
            errors.push("Invalid validation pattern")
          }
          break
      }
    }

    if (errors.length === 0) {
      session.completedSteps.add(stepIndex)
      // Auto-advance to next step
      if (stepIndex === session.currentStep && stepIndex < tutorial.steps.length - 1) {
        session.currentStep = stepIndex + 1
      }
      return { passed: true, errors: [] }
    }

    // Provide a hint on failure if available
    const hintsUsedCount = session.hintsUsed.get(stepIndex) ?? 0
    const hint = step.hints[hintsUsedCount]
    return { passed: false, errors, hint }
  }

  /**
   * Return completion percentage and current step.
   */
  getProgress(sessionId: string): TutorialProgress | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined

    const tutorial = this.tutorials.get(session.tutorialId)
    if (!tutorial) return undefined

    const totalSteps = tutorial.steps.length
    const completedSteps = session.completedSteps.size
    const completionPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0

    return {
      sessionId: session.sessionId,
      tutorialId: session.tutorialId,
      currentStep: session.currentStep,
      totalSteps,
      completedSteps,
      completionPercent,
    }
  }

  /**
   * Return progressive hints for a step (tracks how many hints have been revealed).
   */
  getHint(sessionId: string, stepIndex: number): string | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined

    const tutorial = this.tutorials.get(session.tutorialId)
    if (!tutorial) return undefined

    const step = tutorial.steps[stepIndex]
    if (!step) return undefined

    const usedCount = session.hintsUsed.get(stepIndex) ?? 0
    if (usedCount >= step.hints.length) return undefined

    // Reveal next hint and track usage
    session.hintsUsed.set(stepIndex, usedCount + 1)
    return step.hints[usedCount]
  }
}
