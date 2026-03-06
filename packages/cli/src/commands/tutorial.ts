/**
 * Interactive Onboarding Tutorial for ReactiveBase.
 * Terminal-based guided walkthrough for creating a schema, writing queries,
 * adding mutations, subscribing in React, and seeing live updates.
 *
 * Features:
 *   - 7-step interactive tutorial with progress tracking
 *   - Rich terminal formatting with boxes and colors
 *   - Step-by-step code scaffolding
 *   - Graduation with project scaffold generation
 *   - Resume from last completed step
 *
 * Usage:
 *   reactivebase tutorial
 *   reactivebase tutorial --step 3
 *   reactivebase tutorial --reset
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TutorialOptions {
  /** Project directory */
  projectDir: string
  /** Start at a specific step (1-7) */
  startStep?: number
  /** Reset tutorial progress */
  reset?: boolean
  /** Skip interactive prompts (CI mode) */
  nonInteractive?: boolean
}

export interface TutorialStep {
  number: number
  title: string
  description: string
  code: string
  filePath: string
  explanation: string
}

export interface TutorialProgress {
  currentStep: number
  completedSteps: number[]
  startedAt: string
  lastActivityAt: string
}

// ─── Tutorial Steps ──────────────────────────────────────────────────────────

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    number: 1,
    title: "Define Your Schema",
    description:
      "Create a schema that defines your data model. ReactiveBase generates TypeScript types and Postgres DDL from this single source of truth.",
    filePath: "schema.ts",
    code: `import { defineSchema, defineTable, v } from "reactivebase";

export const schema = defineSchema({
  tasks: defineTable({
    title: v.string(),
    description: v.string().optional(),
    status: v.enum(["todo", "in_progress", "done"]),
    assigneeId: v.id().optional(),
    createdAt: v.timestamp(),
  }),
  users: defineTable({
    name: v.string(),
    email: v.string(),
    role: v.enum(["admin", "member"]),
  }),
});`,
    explanation:
      "Your schema is the single source of truth. ReactiveBase uses it to generate TypeScript types, Postgres tables, and real-time subscriptions automatically.",
  },
  {
    number: 2,
    title: "Write a Query",
    description:
      "Queries are server functions that read data. They're automatically reactive — any client subscribing to a query gets live updates when data changes.",
    filePath: "functions/listTasks.ts",
    code: `import { query } from "reactivebase";
import { schema } from "../schema";

export const listTasks = query({
  schema,
  handler: async (ctx, args: { status?: string }) => {
    if (args.status) {
      return ctx.db.tasks.where({ status: args.status });
    }
    return ctx.db.tasks.all();
  },
});`,
    explanation:
      "Queries run on the server but are automatically subscribed to by clients. When a mutation modifies the tasks table, all clients watching listTasks get updated data instantly.",
  },
  {
    number: 3,
    title: "Add a Mutation",
    description:
      "Mutations modify data and automatically trigger reactive updates for any queries watching the affected tables.",
    filePath: "functions/createTask.ts",
    code: `import { mutation } from "reactivebase";
import { schema } from "../schema";

export const createTask = mutation({
  schema,
  handler: async (ctx, args: { title: string; description?: string }) => {
    const task = await ctx.db.tasks.insert({
      title: args.title,
      description: args.description ?? null,
      status: "todo",
      assigneeId: null,
      createdAt: new Date(),
    });
    return task;
  },
});`,
    explanation:
      "When createTask inserts a row, ReactiveBase detects the change via CDC (Change Data Capture) and pushes the updated result to every client subscribed to listTasks. Zero extra code needed.",
  },
  {
    number: 4,
    title: "Subscribe in React",
    description:
      "Use the React hook to subscribe to your query. The component re-renders automatically when data changes anywhere.",
    filePath: "app/TaskList.tsx",
    code: `import { useQuery } from "@reactivebase/react";
import { listTasks } from "../functions/listTasks";

export function TaskList() {
  const { data: tasks, isLoading, error } = useQuery(listTasks, {
    status: "todo",
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <ul>
      {tasks.map((task) => (
        <li key={task.id}>
          {task.title} — {task.status}
        </li>
      ))}
    </ul>
  );
}`,
    explanation:
      "useQuery subscribes to the server over WebSocket. When any user creates, updates, or deletes a task, this component updates in real-time across all connected clients.",
  },
  {
    number: 5,
    title: "Add a Mutation Button",
    description:
      "Use the useMutation hook to call mutations from React. Optimistic updates are supported out of the box.",
    filePath: "app/AddTask.tsx",
    code: `import { useMutation } from "@reactivebase/react";
import { createTask } from "../functions/createTask";
import { useState } from "react";

export function AddTask() {
  const [title, setTitle] = useState("");
  const { mutate, isLoading } = useMutation(createTask);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    await mutate({ title });
    setTitle("");
  };

  return (
    <div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="New task..."
      />
      <button onClick={handleSubmit} disabled={isLoading}>
        {isLoading ? "Adding..." : "Add Task"}
      </button>
    </div>
  );
}`,
    explanation:
      "When you click 'Add Task', the mutation runs on the server, inserts a row in Postgres, and ReactiveBase pushes the update to the TaskList component in real-time. No polling, no refetching.",
  },
  {
    number: 6,
    title: "Add Authentication",
    description:
      "Protect your functions with authentication. ReactiveBase supports JWT, session tokens, and custom auth providers.",
    filePath: "functions/updateTask.ts",
    code: `import { mutation, AuthenticationError } from "reactivebase";
import { schema } from "../schema";

export const updateTask = mutation({
  schema,
  handler: async (ctx, args: { id: string; status: string }) => {
    // ctx.auth is populated from the client's auth token
    if (!ctx.auth.userId) {
      throw new AuthenticationError("Must be logged in to update tasks");
    }

    const task = await ctx.db.tasks.update(args.id, {
      status: args.status,
    });
    return task;
  },
});`,
    explanation:
      "The auth context is automatically extracted from the client's WebSocket connection. ReactiveBase supports JWT tokens, session auth, and custom providers like Clerk, Auth0, and Supabase Auth.",
  },
  {
    number: 7,
    title: "Configure & Launch",
    description:
      "Create a config file and start the dev server. ReactiveBase handles Postgres, WebSocket, and type generation automatically.",
    filePath: "reactivebase.config.ts",
    code: `import { defineConfig } from "reactivebase";
import { schema } from "./schema";
import { listTasks } from "./functions/listTasks";
import { createTask } from "./functions/createTask";
import { updateTask } from "./functions/updateTask";

export default defineConfig({
  schema,
  functions: [listTasks, createTask, updateTask],
  server: {
    port: 4000,
  },
  auth: {
    providers: ["jwt"],
    secret: process.env.AUTH_SECRET,
  },
});

// Run: npx reactivebase dev`,
    explanation:
      "That's it! Run 'npx reactivebase dev' and your reactive backend is live. Every query automatically becomes a real-time subscription, mutations trigger instant updates, and types are generated from your schema.",
  },
]

// ─── Tutorial Runner ─────────────────────────────────────────────────────────

/**
 * Run the interactive onboarding tutorial.
 */
export async function runTutorial(options: TutorialOptions): Promise<void> {
  const progressFile = join(options.projectDir, ".reactivebase-tutorial.json")

  if (options.reset) {
    if (existsSync(progressFile)) {
      writeFileSync(
        progressFile,
        JSON.stringify({
          currentStep: 1,
          completedSteps: [],
          startedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
        }),
      )
    }
    console.log("✓ Tutorial progress reset.\n")
    return
  }

  // Load or create progress
  let progress: TutorialProgress
  if (existsSync(progressFile)) {
    progress = JSON.parse(readFileSync(progressFile, "utf-8"))
  } else {
    progress = {
      currentStep: 1,
      completedSteps: [],
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    }
  }

  const startStep = options.startStep ?? progress.currentStep

  // Header
  printBox("Welcome to ReactiveBase!", [
    "This interactive tutorial will guide you through building",
    "a reactive backend in 7 steps. Each step creates a real file",
    "in your project that you can build on.",
    "",
    `Progress: ${progress.completedSteps.length}/${TUTORIAL_STEPS.length} steps complete`,
  ])

  // Run steps
  for (let i = startStep - 1; i < TUTORIAL_STEPS.length; i++) {
    const step = TUTORIAL_STEPS[i]

    console.log("")
    printStepHeader(step.number, step.title)
    console.log("")
    console.log(`  ${step.description}`)
    console.log("")

    // Show the code
    printCodeBlock(step.code, step.filePath)
    console.log("")
    console.log(`  💡 ${step.explanation}`)
    console.log("")

    // Write the file
    const fullPath = join(options.projectDir, step.filePath)
    const dir = join(fullPath, "..")
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    if (!existsSync(fullPath)) {
      writeFileSync(fullPath, step.code)
      console.log(`  ✓ Created ${step.filePath}`)
    } else {
      console.log(`  ℹ ${step.filePath} already exists (skipped)`)
    }

    // Update progress
    if (!progress.completedSteps.includes(step.number)) {
      progress.completedSteps.push(step.number)
    }
    progress.currentStep = step.number + 1
    progress.lastActivityAt = new Date().toISOString()
    writeFileSync(progressFile, JSON.stringify(progress, null, 2))

    console.log(`  ✓ Step ${step.number}/7 complete`)
    console.log("")
    console.log("  " + "─".repeat(56))
  }

  // Graduation
  console.log("")
  printBox("🎓 Tutorial Complete!", [
    "Congratulations! You've built a full reactive backend.",
    "",
    "Next steps:",
    "  1. Run: npx reactivebase dev",
    "  2. Open http://localhost:4000 in your browser",
    "  3. Edit your schema and watch types regenerate",
    "  4. Add more queries and mutations",
    "",
    "Resources:",
    "  Docs:      https://reactivebase.dev/docs",
    "  Discord:   https://discord.gg/reactivebase",
    "  GitHub:    https://github.com/reactivebase/reactivebase",
  ])
}

/**
 * Get the list of tutorial steps (for programmatic access).
 */
export function getTutorialSteps(): TutorialStep[] {
  return [...TUTORIAL_STEPS]
}

// ─── Terminal Formatting ─────────────────────────────────────────────────────

function printBox(title: string, lines: string[]): void {
  const width = 60
  const border = "═".repeat(width)

  console.log(`  ╔${border}╗`)
  console.log(`  ║ ${title.padEnd(width - 1)}║`)
  console.log(`  ╠${border}╣`)
  for (const line of lines) {
    console.log(`  ║ ${line.padEnd(width - 1)}║`)
  }
  console.log(`  ╚${border}╝`)
}

function printStepHeader(step: number, title: string): void {
  const progress = "●".repeat(step) + "○".repeat(7 - step)
  console.log(`  ┌─ Step ${step}/7: ${title}`)
  console.log(`  │  [${progress}]`)
}

function printCodeBlock(code: string, filename: string): void {
  console.log(`  │  📄 ${filename}`)
  console.log(`  │  ${"─".repeat(50)}`)
  for (const line of code.split("\n")) {
    console.log(`  │  ${line}`)
  }
  console.log(`  │  ${"─".repeat(50)}`)
}
