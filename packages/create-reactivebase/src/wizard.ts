/**
 * Interactive project wizard for create-reactivebase.
 * Prompts the user for framework, auth, and database choices,
 * then generates a fully configured project.
 */

import { createInterface } from "node:readline"

export interface WizardOptions {
  projectName: string
  framework: "react" | "vue" | "svelte" | "nextjs" | "none"
  auth: "jwt" | "clerk" | "none"
  database: "pglite" | "docker" | "url"
  template: "blank" | "todo" | "chat" | "ai-search"
}

const FRAMEWORKS = {
  react: { pkg: "@reactivebase/react", dep: "react react-dom", devDep: "@types/react @types/react-dom" },
  vue: { pkg: "@reactivebase/vue", dep: "vue", devDep: "" },
  svelte: { pkg: "@reactivebase/svelte", dep: "svelte", devDep: "" },
  nextjs: { pkg: "@reactivebase/nextjs", dep: "react react-dom next", devDep: "@types/react @types/react-dom" },
  none: { pkg: "", dep: "", devDep: "" },
}

/**
 * Run the interactive wizard.
 */
export async function runWizard(projectName: string): Promise<WizardOptions> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve))

  console.log("\n  🚀 ReactiveBase Project Setup\n")

  // Framework selection
  console.log("  Framework:")
  console.log("    1) React (default)")
  console.log("    2) Vue")
  console.log("    3) Svelte")
  console.log("    4) Next.js")
  console.log("    5) None (server only)")
  const fwChoice = await ask("  Choose [1-5]: ")
  const framework =
    (["react", "vue", "svelte", "nextjs", "none"] as const)[parseInt(fwChoice || "1", 10) - 1] ?? "react"

  // Auth selection
  console.log("\n  Authentication:")
  console.log("    1) JWT (built-in, default)")
  console.log("    2) Clerk")
  console.log("    3) None")
  const authChoice = await ask("  Choose [1-3]: ")
  const auth = (["jwt", "clerk", "none"] as const)[parseInt(authChoice || "1", 10) - 1] ?? "jwt"

  // Database selection
  console.log("\n  Database:")
  console.log("    1) PGlite (zero install, default)")
  console.log("    2) Docker Compose")
  console.log("    3) Connection URL")
  const dbChoice = await ask("  Choose [1-3]: ")
  const database = (["pglite", "docker", "url"] as const)[parseInt(dbChoice || "1", 10) - 1] ?? "pglite"

  // Template
  console.log("\n  Template:")
  console.log("    1) Blank project (default)")
  console.log("    2) Todo app")
  console.log("    3) Chat app")
  console.log("    4) AI search")
  const tplChoice = await ask("  Choose [1-4]: ")
  const template = (["blank", "todo", "chat", "ai-search"] as const)[parseInt(tplChoice || "1", 10) - 1] ?? "blank"

  rl.close()

  return { projectName, framework, auth, database, template }
}

/**
 * Generate package.json dependencies based on wizard options.
 */
export function generateDependencies(options: WizardOptions): {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
} {
  const deps: Record<string, string> = {
    "@reactivebase/server": "^0.1.0",
    "@reactivebase/client": "^0.1.0",
  }
  const devDeps: Record<string, string> = {
    typescript: "^5.7.0",
  }

  const fw = FRAMEWORKS[options.framework]
  if (fw.pkg) deps[fw.pkg] = "^0.1.0"
  if (fw.dep) {
    for (const d of fw.dep.split(" ").filter(Boolean)) deps[d] = "latest"
  }
  if (fw.devDep) {
    for (const d of fw.devDep.split(" ").filter(Boolean)) devDeps[d] = "latest"
  }

  if (options.database === "pglite") {
    deps["@electric-sql/pglite"] = "^0.2.0"
  }

  if (options.template === "ai-search") {
    // AI search needs no extra deps — uses server AI context
  }

  return { dependencies: deps, devDependencies: devDeps }
}

/**
 * Generate server config based on wizard options.
 */
export function generateConfigFile(options: WizardOptions): string {
  const lines: string[] = []

  lines.push('import { defineConfig } from "@reactivebase/server"')

  if (options.auth === "jwt") {
    lines.push('import { jwtProvider } from "@reactivebase/server"')
  }

  lines.push("")
  lines.push("export default defineConfig({")

  // Database
  if (options.database === "url") {
    lines.push("  database: {")
    lines.push('    connectionString: process.env.DATABASE_URL ?? "postgresql://localhost:5432/reactivebase",')
    lines.push("  },")
  } else if (options.database === "docker") {
    lines.push("  database: {")
    lines.push('    connectionString: "postgresql://reactivebase:reactivebase@localhost:5432/reactivebase",')
    lines.push("  },")
  } else {
    lines.push("  database: {")
    lines.push("    // PGlite — no Postgres installation needed")
    lines.push('    connectionString: "pglite://.reactivebase/data",')
    lines.push("  },")
  }

  // Auth
  if (options.auth === "jwt") {
    lines.push("  auth: {")
    lines.push("    providers: [")
    lines.push("      jwtProvider({")
    lines.push('        secret: process.env.JWT_SECRET ?? "dev-secret-change-in-production",')
    lines.push("      }),")
    lines.push("    ],")
    lines.push("  },")
  }

  lines.push("  server: { port: 4000 },")
  lines.push("})")
  lines.push("")

  return lines.join("\n")
}

/**
 * Generate a .env file based on options.
 */
export function generateEnvFile(options: WizardOptions): string {
  const lines: string[] = []

  if (options.database === "url") {
    lines.push("DATABASE_URL=postgresql://localhost:5432/reactivebase")
  }
  if (options.auth === "jwt") {
    lines.push("JWT_SECRET=change-this-to-a-secure-random-string")
  }

  return lines.join("\n") + "\n"
}
