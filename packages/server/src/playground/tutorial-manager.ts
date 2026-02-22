/**
 * Interactive Playground Tutorials — Progressive learning paths
 * for the embedded playground with validation and share/export.
 *
 * Usage:
 *   const tutorials = new TutorialManager()
 *   const tutorial = tutorials.getTutorial("hello-world")
 *   const result = tutorials.validateStep("hello-world", 0, userCode)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InteractiveTutorial {
  id: string
  title: string
  description: string
  difficulty: "beginner" | "intermediate" | "advanced"
  estimatedMinutes: number
  steps: TutorialStepDef[]
  prerequisites: string[]
}

export interface TutorialStepDef {
  title: string
  instruction: string
  hint?: string
  starterCode: string
  solutionCode: string
  validationRules: ValidationRule[]
}

export interface ValidationRule {
  type: "contains" | "not_contains" | "matches" | "exports" | "calls"
  value: string
  message: string
}

export interface StepValidationResult {
  passed: boolean
  errors: string[]
  hints: string[]
}

export interface PlaygroundShareState {
  id: string
  schema: string
  queries: string
  mutations: string
  createdAt: number
  expiresAt: number
}

export interface ExportConfig {
  projectName: string
  includeSchema: boolean
  includeQueries: boolean
  framework: "react" | "vue" | "svelte" | "nextjs"
}

export interface ExportResult {
  files: Record<string, string>
  installCommand: string
  startCommand: string
}

// ─── Built-in Tutorials ──────────────────────────────────────────────────────

export const INTERACTIVE_TUTORIALS: InteractiveTutorial[] = [
  {
    id: "hello-world",
    title: "Hello ReactiveBase",
    description: "Create your first schema and query in 5 minutes",
    difficulty: "beginner",
    estimatedMinutes: 5,
    prerequisites: [],
    steps: [
      {
        title: "Define a Schema",
        instruction: "Create a schema with a `tasks` table that has `title` (string) and `done` (boolean) fields.",
        starterCode: `import { defineSchema, defineTable, v } from "@reactivebase/server"\n\nexport default defineSchema({\n  // Add your table here\n})`,
        solutionCode: `import { defineSchema, defineTable, v } from "@reactivebase/server"\n\nexport default defineSchema({\n  tasks: defineTable({\n    title: v.string(),\n    done: v.boolean({ default: false }),\n  }),\n})`,
        validationRules: [
          { type: "contains", value: "defineSchema", message: "Must use defineSchema()" },
          { type: "contains", value: "defineTable", message: "Must use defineTable()" },
          { type: "contains", value: "tasks", message: "Must define a 'tasks' table" },
          { type: "contains", value: "v.string()", message: "Title should be v.string()" },
          { type: "contains", value: "v.boolean", message: "Done should be v.boolean()" },
        ],
      },
      {
        title: "Write a Query",
        instruction: "Create a `listTasks` query that returns all tasks.",
        starterCode: `import { query } from "@reactivebase/server"\n\n// Write a query that returns all tasks`,
        solutionCode: `import { query } from "@reactivebase/server"\n\nexport const listTasks = query(async (ctx) => {\n  return ctx.db.tasks.where({})\n})`,
        validationRules: [
          { type: "contains", value: "query", message: "Must use query()" },
          { type: "exports", value: "listTasks", message: "Must export 'listTasks'" },
          { type: "contains", value: "ctx.db", message: "Must access database via ctx.db" },
        ],
      },
      {
        title: "Write a Mutation",
        instruction: "Create an `addTask` mutation that inserts a new task.",
        starterCode: `import { mutation } from "@reactivebase/server"\n\n// Write a mutation that adds a task`,
        solutionCode: `import { mutation } from "@reactivebase/server"\n\nexport const addTask = mutation(async (ctx, args: { title: string }) => {\n  return ctx.db.tasks.insert({ title: args.title, done: false })\n})`,
        validationRules: [
          { type: "contains", value: "mutation", message: "Must use mutation()" },
          { type: "exports", value: "addTask", message: "Must export 'addTask'" },
          { type: "contains", value: "insert", message: "Must insert data" },
        ],
      },
    ],
  },
  {
    id: "reactive-queries",
    title: "Reactive Queries",
    description: "Learn how queries automatically update when data changes",
    difficulty: "beginner",
    estimatedMinutes: 10,
    prerequisites: ["hello-world"],
    steps: [
      {
        title: "Filtered Query",
        instruction: "Create a query that only returns incomplete tasks for a specific user.",
        starterCode: `import { query } from "@reactivebase/server"\n\n// Query for incomplete tasks by user`,
        solutionCode: `import { query } from "@reactivebase/server"\n\nexport const myTasks = query(async (ctx, { userId }: { userId: string }) => {\n  return ctx.db.tasks.where({ assigneeId: userId, done: false })\n})`,
        validationRules: [
          { type: "contains", value: "where", message: "Must use .where() to filter" },
          { type: "contains", value: "done: false", message: "Must filter for incomplete tasks" },
        ],
      },
      {
        title: "Aggregation Query",
        instruction: "Create a query that returns task statistics (total, completed, rate).",
        starterCode: `import { query } from "@reactivebase/server"\n\n// Query for task statistics`,
        solutionCode: `import { query } from "@reactivebase/server"\n\nexport const taskStats = query(async (ctx) => {\n  const total = await ctx.db.tasks.where({}).count()\n  const done = await ctx.db.tasks.where({ done: true }).count()\n  return { total, done, rate: total > 0 ? done / total : 0 }\n})`,
        validationRules: [
          { type: "contains", value: "count", message: "Must use .count() for aggregation" },
          { type: "exports", value: "taskStats", message: "Must export 'taskStats'" },
        ],
      },
    ],
  },
  {
    id: "auth-and-permissions",
    title: "Authentication & Permissions",
    description: "Add JWT auth and role-based access control",
    difficulty: "intermediate",
    estimatedMinutes: 15,
    prerequisites: ["hello-world"],
    steps: [
      {
        title: "Auth Check",
        instruction: "Create a query that requires authentication and returns the current user.",
        starterCode: `import { query } from "@reactivebase/server"\n\n// Authenticated query`,
        solutionCode: `import { query } from "@reactivebase/server"\n\nexport const me = query(async (ctx) => {\n  const identity = await ctx.auth.getUserIdentity()\n  if (!identity) throw new Error("Not authenticated")\n  return ctx.db.users.where({ email: identity.email })\n})`,
        validationRules: [
          { type: "contains", value: "ctx.auth", message: "Must check authentication" },
          { type: "contains", value: "getUserIdentity", message: "Must call getUserIdentity()" },
        ],
      },
    ],
  },
  {
    id: "realtime-dashboard",
    title: "Real-Time Dashboard",
    description: "Build a live dashboard with reactive subscriptions",
    difficulty: "intermediate",
    estimatedMinutes: 20,
    prerequisites: ["reactive-queries"],
    steps: [
      {
        title: "Dashboard Metrics",
        instruction: "Create queries for dashboard metrics that update in real-time.",
        starterCode: `import { query } from "@reactivebase/server"\n\n// Dashboard metrics`,
        solutionCode: `import { query } from "@reactivebase/server"\n\nexport const dashboardMetrics = query(async (ctx) => {\n  const users = await ctx.db.users.where({}).count()\n  const tasks = await ctx.db.tasks.where({}).count()\n  const completed = await ctx.db.tasks.where({ done: true }).count()\n  return { users, tasks, completed, completionRate: tasks > 0 ? completed / tasks : 0 }\n})`,
        validationRules: [
          { type: "exports", value: "dashboardMetrics", message: "Must export 'dashboardMetrics'" },
          { type: "contains", value: "count", message: "Must use count aggregation" },
        ],
      },
    ],
  },
  {
    id: "background-jobs",
    title: "Actions & Background Jobs",
    description: "Run side effects and scheduled tasks with actions",
    difficulty: "advanced",
    estimatedMinutes: 15,
    prerequisites: ["hello-world"],
    steps: [
      {
        title: "Send Email Action",
        instruction: "Create an action that sends a welcome email (simulated).",
        starterCode: `import { action } from "@reactivebase/server"\n\n// Email action`,
        solutionCode: `import { action } from "@reactivebase/server"\n\nexport const sendWelcome = action(async (ctx, { userId }: { userId: string }) => {\n  const user = await ctx.db.users.get(userId)\n  if (!user) throw new Error("User not found")\n  // In production: await emailService.send({ to: user.email, template: "welcome" })\n  return { sent: true, to: user.email }\n})`,
        validationRules: [
          { type: "contains", value: "action", message: "Must use action()" },
          { type: "exports", value: "sendWelcome", message: "Must export 'sendWelcome'" },
        ],
      },
    ],
  },
]

// ─── Tutorial Manager ────────────────────────────────────────────────────────

export class TutorialManager {
  private tutorials: Map<string, InteractiveTutorial>
  private progress = new Map<string, Set<number>>()

  constructor(customTutorials?: InteractiveTutorial[]) {
    this.tutorials = new Map()
    for (const t of [...INTERACTIVE_TUTORIALS, ...(customTutorials ?? [])]) {
      this.tutorials.set(t.id, t)
    }
  }

  getTutorial(id: string): InteractiveTutorial | undefined {
    return this.tutorials.get(id)
  }

  listTutorials(): InteractiveTutorial[] {
    return Array.from(this.tutorials.values())
  }

  listByDifficulty(difficulty: InteractiveTutorial["difficulty"]): InteractiveTutorial[] {
    return this.listTutorials().filter((t) => t.difficulty === difficulty)
  }

  validateStep(tutorialId: string, stepIndex: number, userCode: string): StepValidationResult {
    const tutorial = this.tutorials.get(tutorialId)
    if (!tutorial) return { passed: false, errors: ["Tutorial not found"], hints: [] }

    const step = tutorial.steps[stepIndex]
    if (!step) return { passed: false, errors: ["Step not found"], hints: [] }

    const errors: string[] = []
    const hints: string[] = []

    for (const rule of step.validationRules) {
      switch (rule.type) {
        case "contains":
          if (!userCode.includes(rule.value)) {
            errors.push(rule.message)
            if (step.hint) hints.push(step.hint)
          }
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
          if (!new RegExp(rule.value).test(userCode)) errors.push(rule.message)
          break
      }
    }

    if (errors.length === 0) {
      // Mark step as completed
      if (!this.progress.has(tutorialId)) this.progress.set(tutorialId, new Set())
      this.progress.get(tutorialId)!.add(stepIndex)
    }

    return { passed: errors.length === 0, errors, hints }
  }

  getProgress(tutorialId: string): { completed: number; total: number } {
    const tutorial = this.tutorials.get(tutorialId)
    if (!tutorial) return { completed: 0, total: 0 }
    const completed = this.progress.get(tutorialId)?.size ?? 0
    return { completed, total: tutorial.steps.length }
  }

  isTutorialComplete(tutorialId: string): boolean {
    const { completed, total } = this.getProgress(tutorialId)
    return total > 0 && completed >= total
  }

  // ─── Share / Export ─────────────────────────────────────────────────────

  createShareState(schema: string, queries: string, mutations: string): PlaygroundShareState {
    const id = Math.random().toString(36).substring(2, 10)
    return {
      id,
      schema,
      queries,
      mutations,
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    }
  }

  exportProject(config: ExportConfig, schema: string, queries: string): ExportResult {
    const files: Record<string, string> = {
      "convex/schema.ts": schema,
      "convex/queries.ts": queries,
      "package.json": JSON.stringify({
        name: config.projectName,
        private: true,
        scripts: { dev: "reactivebase dev", build: "reactivebase generate && tsc", start: "node dist/server.js" },
        dependencies: {
          "@reactivebase/server": "^0.1.0",
          [`@reactivebase/${config.framework}`]: "^0.1.0",
        },
      }, null, 2),
      "reactivebase.config.ts": `import { defineConfig } from "@reactivebase/server"\n\nexport default defineConfig({\n  database: { connectionString: process.env.DATABASE_URL! },\n  server: { port: 4000 },\n})\n`,
    }

    return {
      files,
      installCommand: "npm install",
      startCommand: "npm run dev",
    }
  }
}
