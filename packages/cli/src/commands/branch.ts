/**
 * Branch CLI commands for ReactiveBase.
 * Manages database branches for PR previews and feature development.
 *
 * Usage:
 *   reactivebase branch create <name> --pr <number> --seed
 *   reactivebase branch list
 *   reactivebase branch delete <name>
 *   reactivebase branch diff <source> <target>
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BranchCommandOptions {
  projectDir: string
  connectionString?: string
  neonApiKey?: string
  neonProjectId?: string
}

interface BranchRecord {
  name: string
  parentBranch: string
  strategy: string
  status: string
  connectionString: string | null
  prNumber: number | null
  seeded: boolean
}

interface BranchDiffResult {
  schemaChanges: Array<{ type: string; table: string; column?: string; details: string }>
  dataChanges: Array<{ table: string; inserts: number; updates: number; deletes: number }>
  conflictsDetected: boolean
  conflicts: Array<{ table: string; description: string; resolution: string }>
}

interface DatabaseBranchingLike {
  createBranch(name: string, options?: Record<string, unknown>): Promise<BranchRecord>
  listBranches(): BranchRecord[]
  deleteBranch(name: string): Promise<void>
  diffBranches(source: string, target: string): Promise<BranchDiffResult>
  switchBranch(name: string): Promise<BranchRecord>
  mergeBranch(name: string, target?: string): Promise<BranchDiffResult>
  generateGitHubActionYAML(): string
}

// ─── Branch Commands ─────────────────────────────────────────────────────────

export async function branchCreate(
  name: string,
  options: BranchCommandOptions & {
    from?: string
    pr?: number
    commit?: string
    seed?: boolean
    author?: string
  },
): Promise<void> {
  if (!name) {
    console.error("Error: Branch name is required")
    showBranchHelp()
    process.exit(1)
  }

  const branching = await createBranchingInstance(options)

  const seedConfig = options.seed ? { copyTables: [], maxRowsPerTable: 10000 } : undefined

  const prConfig = options.pr
    ? {
        prNumber: options.pr,
        branch: name,
        commitSha: options.commit ?? "unknown",
        repository: "",
        author: options.author ?? "cli",
      }
    : undefined

  try {
    const branch = await branching.createBranch(name, {
      fromBranch: options.from,
      createdBy: options.author ?? "cli",
      prConfig,
      seedConfig,
    })

    console.log(`✅ Branch "${branch.name}" created successfully`)
    console.log(`   Strategy: ${branch.strategy}`)
    console.log(`   Parent: ${branch.parentBranch}`)
    if (branch.connectionString) {
      console.log(`   Connection: ${branch.connectionString}`)
    }
    if (branch.prNumber) {
      console.log(`   Linked PR: #${branch.prNumber}`)
    }
    if (branch.seeded) {
      console.log(`   Seed data: applied`)
    }
  } catch (error: unknown) {
    console.error(`❌ Failed to create branch: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

export async function branchList(options: BranchCommandOptions): Promise<void> {
  const branching = await createBranchingInstance(options)
  const branches = branching.listBranches()

  if (branches.length === 0) {
    console.log("No branches found.")
    return
  }

  console.log(`\n  Database Branches (${branches.length}):\n`)
  console.log("  %-20s %-12s %-10s %-8s %s", "NAME", "PARENT", "STRATEGY", "STATUS", "PR")
  console.log("  " + "─".repeat(70))

  for (const branch of branches) {
    const pr = branch.prNumber ? `#${branch.prNumber}` : "—"
    console.log("  %-20s %-12s %-10s %-8s %s", branch.name, branch.parentBranch, branch.strategy, branch.status, pr)
  }
  console.log()
}

export async function branchDelete(name: string, options: BranchCommandOptions): Promise<void> {
  if (!name) {
    console.error("Error: Branch name is required")
    process.exit(1)
  }

  const branching = await createBranchingInstance(options)

  try {
    await branching.deleteBranch(name)
    console.log(`✅ Branch "${name}" deleted`)
  } catch (error: unknown) {
    console.error(`❌ Failed to delete branch: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

export async function branchDiff(source: string, target: string, options: BranchCommandOptions): Promise<void> {
  if (!source || !target) {
    console.error("Error: Both source and target branch names are required")
    process.exit(1)
  }

  const branching = await createBranchingInstance(options)

  try {
    const diff = await branching.diffBranches(source, target)

    console.log(`\n  Branch Diff: ${source} → ${target}\n`)

    if (diff.schemaChanges.length === 0 && diff.dataChanges.length === 0) {
      console.log("  No differences detected.")
      return
    }

    if (diff.schemaChanges.length > 0) {
      console.log("  Schema Changes:")
      for (const change of diff.schemaChanges) {
        const prefix = change.type.includes("added") ? "+" : change.type.includes("removed") ? "-" : "~"
        console.log(`    ${prefix} ${change.table}${change.column ? `.${change.column}` : ""}: ${change.details}`)
      }
    }

    if (diff.dataChanges.length > 0) {
      console.log("\n  Data Changes:")
      for (const change of diff.dataChanges) {
        console.log(
          `    ${change.table}: +${change.inserts} inserts, ~${change.updates} updates, -${change.deletes} deletes`,
        )
      }
    }

    if (diff.conflictsDetected) {
      console.log("\n  ⚠️  Conflicts Detected:")
      for (const conflict of diff.conflicts) {
        console.log(`    ${conflict.table}: ${conflict.description} (${conflict.resolution})`)
      }
    }
    console.log()
  } catch (error: unknown) {
    console.error(`❌ Failed to diff branches: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

export async function branchSwitch(name: string, options: BranchCommandOptions): Promise<void> {
  if (!name) {
    console.error("Error: Branch name is required")
    process.exit(1)
  }

  const branching = await createBranchingInstance(options)

  try {
    const branch = await branching.switchBranch(name)
    console.log(`✅ Switched to branch "${branch.name}"`)
    if (branch.connectionString) {
      console.log(`   Connection: ${branch.connectionString}`)
    }
  } catch (error: unknown) {
    console.error(`❌ Failed to switch branch: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

export async function branchMerge(name: string, options: BranchCommandOptions & { into?: string }): Promise<void> {
  if (!name) {
    console.error("Error: Branch name is required")
    process.exit(1)
  }

  const branching = await createBranchingInstance(options)

  try {
    const diff = await branching.mergeBranch(name, options.into)
    console.log(`✅ Branch "${name}" merged into "${options.into ?? "main"}"`)
    if (diff.schemaChanges.length > 0) {
      console.log(`   ${diff.schemaChanges.length} schema change(s) applied`)
    }
  } catch (error: unknown) {
    console.error(`❌ Failed to merge branch: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

export async function branchGenerateAction(options: BranchCommandOptions): Promise<void> {
  const branching = await createBranchingInstance(options)
  const yaml = branching.generateGitHubActionYAML()

  console.log("Generated GitHub Action workflow:\n")
  console.log(yaml)
  console.log("\nSave this to .github/workflows/preview-env.yml")
}

export function showBranchHelp(): void {
  console.log(
    `
ReactiveBase Branch Commands:

  reactivebase branch create <name>     Create a new database branch
    --from <branch>                     Branch from (default: main)
    --pr <number>                       Link to a PR number
    --commit <sha>                      Record commit SHA
    --seed                              Apply seed data

  reactivebase branch list              List all branches
  reactivebase branch switch <name>     Switch to a branch
  reactivebase branch diff <a> <b>      Show differences between branches
  reactivebase branch merge <name>      Merge branch into main
  reactivebase branch delete <name>     Delete a branch

Examples:
  reactivebase branch create feature-x
  reactivebase branch create feature-x --from staging --seed
  reactivebase branch pr 42 --commit abc123
`.trim(),
  )
}

// ─── Internal ────────────────────────────────────────────────────────────────

async function createBranchingInstance(options: BranchCommandOptions): Promise<DatabaseBranchingLike> {
  const mod = (await import("@reactivebase/server/branching" as string)) as {
    DatabaseBranching: new (opts: Record<string, unknown>) => DatabaseBranchingLike
  }
  const strategy = options.neonApiKey ? "neon" : "schema"
  return new mod.DatabaseBranching({
    strategy,
    neonApiKey: options.neonApiKey ?? process.env.NEON_API_KEY,
    neonProjectId: options.neonProjectId ?? process.env.NEON_PROJECT_ID,
  })
}
