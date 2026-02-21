/**
 * create-reactivebase - Project scaffolding tool with interactive wizard.
 * Usage: npx create-reactivebase my-app
 *        npx create-reactivebase my-app --yes (skip wizard, use defaults)
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { runWizard, generateDependencies, generateConfigFile, generateEnvFile, type WizardOptions } from "./wizard.js"

const projectName = process.argv[2]
const skipWizard = process.argv.includes("--yes") || process.argv.includes("-y")

if (!projectName) {
  console.error("Usage: npx create-reactivebase <project-name>")
  console.error("       npx create-reactivebase <project-name> --yes  (skip wizard)")
  process.exit(1)
}

const projectDir = resolve(projectName)

if (existsSync(projectDir)) {
  console.error(`Error: Directory "${projectName}" already exists.`)
  process.exit(1)
}

console.log(`\n  Creating ReactiveBase project: ${projectName}\n`)

// Run wizard or use defaults
let wizardOptions: WizardOptions = {
  projectName,
  framework: "react",
  auth: "jwt",
  database: "pglite",
  template: "blank",
}

if (!skipWizard && process.stdin.isTTY) {
  try {
    wizardOptions = await runWizard(projectName)
  } catch {
    // If wizard fails (e.g., non-interactive), use defaults
  }
}

const { dependencies, devDependencies } = generateDependencies(wizardOptions)

// Create directory structure
const dirs = [
  "",
  "convex",
  "_generated",
]

for (const dir of dirs) {
  mkdirSync(join(projectDir, dir), { recursive: true })
}

// package.json
writeFileSync(
  join(projectDir, "package.json"),
  JSON.stringify(
    {
      name: projectName,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        dev: "reactivebase dev",
        build: "tsc",
        generate: "reactivebase generate",
        "migrate:generate": "reactivebase migrate --generate",
        "migrate:apply": "reactivebase migrate --apply",
      },
      dependencies: {
        reactivebase: "^0.1.0",
        "@reactivebase/server": "^0.1.0",
        "@reactivebase/client": "^0.1.0",
        "@reactivebase/react": "^0.1.0",
        "@reactivebase/cli": "^0.1.0",
      },
      devDependencies: {
        typescript: "^5.7.0",
        "@types/node": "^20.0.0",
      },
    },
    null,
    2,
  ) + "\n",
)

// tsconfig.json
writeFileSync(
  join(projectDir, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        lib: ["ES2022"],
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        jsx: "react-jsx",
        outDir: "./dist",
        rootDir: "./",
      },
      include: ["convex/**/*.ts", "**/*.ts", "**/*.tsx"],
      exclude: ["node_modules", "dist"],
    },
    null,
    2,
  ) + "\n",
)

// Schema file
writeFileSync(
  join(projectDir, "convex", "schema.ts"),
  `import { defineSchema, defineTable, v } from "@reactivebase/server"

export default defineSchema({
  tasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    done: v.boolean({ default: false }),
    priority: v.enum("low", "medium", "high", "critical"),
    createdAt: v.timestamp({ default: "now" }),
    updatedAt: v.timestamp({ default: "now", onUpdate: "now" }),
  })
    .index("by_done", ["done"])
    .index("by_priority", ["priority"]),
})
`,
)

// Example query and mutation
writeFileSync(
  join(projectDir, "convex", "tasks.ts"),
  `import { query, mutation } from "@reactivebase/server"

/**
 * List all incomplete tasks, ordered by priority.
 * This is a reactive query - subscribed clients will automatically
 * receive updates when tasks change.
 */
export const listTasks = query(async (ctx) => {
  return ctx.db.tasks
    .where({ done: false })
    .orderBy("priority", "desc")
})

/**
 * Get task statistics.
 */
export const taskStats = query(async (ctx) => {
  const [total, completed] = await Promise.all([
    ctx.db.tasks.count(),
    ctx.db.tasks.where({ done: true }).count(),
  ])

  return {
    total,
    completed,
    remaining: total - completed,
    completionRate: total > 0 ? completed / total : 0,
  }
})

/**
 * Create a new task.
 * Runs inside a serializable Postgres transaction.
 */
export const createTask = mutation(async (ctx, args: {
  title: string
  description?: string
  priority: "low" | "medium" | "high" | "critical"
}) => {
  return ctx.db.tasks.insert({
    title: args.title,
    description: args.description,
    done: false,
    priority: args.priority,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
})

/**
 * Mark a task as complete.
 * All subscriptions watching this task will automatically update.
 */
export const completeTask = mutation(async (ctx, { taskId }: { taskId: string }) => {
  const task = await ctx.db.tasks.getOrThrow(taskId)

  await ctx.db.tasks.update(taskId, {
    done: true,
    updatedAt: new Date(),
  })

  return { success: true, title: task.title }
})

/**
 * Delete a task.
 */
export const deleteTask = mutation(async (ctx, { taskId }: { taskId: string }) => {
  await ctx.db.tasks.delete(taskId)
  return { success: true }
})
`,
)

// ReactiveBase config
writeFileSync(
  join(projectDir, "reactivebase.config.ts"),
  `import { defineConfig } from "@reactivebase/server"

export default defineConfig({
  database: {
    connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/reactivebase_dev",
  },
  server: {
    port: 4000,
  },
  dev: {
    logLevel: "debug",
  },
})
`,
)

// .env.example
writeFileSync(
  join(projectDir, ".env.example"),
  `# Database connection
DATABASE_URL=postgresql://localhost:5432/reactivebase_dev

# Server port
PORT=4000
`,
)

// .gitignore
writeFileSync(
  join(projectDir, ".gitignore"),
  `node_modules/
dist/
_generated/
.env
*.log
`,
)

// README
writeFileSync(
  join(projectDir, "README.md"),
  `# ${projectName}

Built with [ReactiveBase](https://github.com/reactivebase/reactivebase) - the reactive backend framework.

## Getting Started

\`\`\`bash
# Install dependencies
npm install

# Set up your database
cp .env.example .env
# Edit .env with your Postgres connection string

# Generate types
npm run generate

# Start the dev server
npm run dev
\`\`\`

## Project Structure

\`\`\`
${projectName}/
├── convex/
│   ├── schema.ts     # Data model definition
│   └── tasks.ts      # Queries, mutations, and actions
├── _generated/       # Auto-generated types (don't edit)
├── reactivebase.config.ts
├── package.json
└── tsconfig.json
\`\`\`

## Learn More

- [ReactiveBase Documentation](https://reactivebase.dev/docs)
- [Schema Definition](https://reactivebase.dev/docs/schema)
- [Queries & Mutations](https://reactivebase.dev/docs/functions)
- [React Hooks](https://reactivebase.dev/docs/react)
`,
)

console.log(`  ✓ Created project structure`)
console.log(`  ✓ Generated schema.ts with example schema`)
console.log(`  ✓ Generated tasks.ts with example queries/mutations`)
console.log(`  ✓ Generated reactivebase.config.ts`)
console.log(`  ✓ Framework: ${wizardOptions.framework}`)
console.log(`  ✓ Auth: ${wizardOptions.auth}`)
console.log(`  ✓ Database: ${wizardOptions.database}`)
console.log(`
  Next steps:

    cd ${projectName}
    npm install
    cp .env.example .env
    npm run dev

  Happy building! 🚀
`)
