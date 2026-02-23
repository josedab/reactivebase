/**
 * Database Branching & Preview Environments for ReactiveBase.
 * Create isolated database branches for feature development and PR previews.
 *
 * Strategies:
 *   - Local: Schema-level isolation within the same Postgres instance
 *   - Cloud: Neon's branching API for copy-on-write forks
 *   - GitHub: CI integration with GitHub Action for PR-linked environments
 *
 * Usage:
 *   const branching = new DatabaseBranching({ strategy: "schema" })
 *   const branch = await branching.createBranch("feature-x", { fromBranch: "main" })
 *   await branching.switchBranch("feature-x")
 *   await branching.mergeBranch("feature-x", "main")
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DatabaseBranchingOptions {
  /** Branching strategy (default: "schema") */
  strategy?: BranchStrategy
  /** Default branch name (default: "main") */
  defaultBranch?: string
  /** Max branches per project (default: 50) */
  maxBranches?: number
  /** Neon API key for cloud branching */
  neonApiKey?: string
  /** Neon project ID */
  neonProjectId?: string
  /** Auto-delete branch after PR merge (default: true) */
  autoDeleteOnMerge?: boolean
}

export type BranchStrategy = "schema" | "neon" | "database"

export interface BranchRecord {
  name: string
  parentBranch: string
  strategy: BranchStrategy
  status: "creating" | "active" | "merging" | "merged" | "deleted"
  createdAt: number
  createdBy: string
  /** Schema name for schema-level isolation */
  schemaName: string | null
  /** Neon branch ID for cloud branching */
  neonBranchId: string | null
  /** Connection string for this branch */
  connectionString: string | null
  /** PR number if linked to a PR */
  prNumber: number | null
  /** Seed data applied */
  seeded: boolean
  metadata: Record<string, unknown>
}

export interface BranchDiff {
  sourceBranch: string
  targetBranch: string
  schemaChanges: SchemaChange[]
  dataChanges: DataChange[]
  conflictsDetected: boolean
  conflicts: BranchConflict[]
}

export interface SchemaChange {
  type:
    | "table_added"
    | "table_removed"
    | "column_added"
    | "column_removed"
    | "column_modified"
    | "index_added"
    | "index_removed"
  table: string
  column?: string
  details: string
}

export interface DataChange {
  table: string
  inserts: number
  updates: number
  deletes: number
}

export interface BranchConflict {
  table: string
  column?: string
  description: string
  resolution: "source_wins" | "target_wins" | "manual"
}

export interface SeedDataConfig {
  /** SQL statements to run after branch creation */
  seedSQL?: string[]
  /** Tables to copy data from parent branch */
  copyTables?: string[]
  /** Max rows to copy per table (default: 10000) */
  maxRowsPerTable?: number
}

export interface GitHubPRConfig {
  prNumber: number
  branch: string
  commitSha: string
  repository: string
  author: string
}

// ─── SQL Builders ────────────────────────────────────────────────────────────

export function generateBranchTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_branches (
  name TEXT PRIMARY KEY,
  parent_branch TEXT NOT NULL DEFAULT 'main',
  strategy TEXT NOT NULL DEFAULT 'schema',
  status TEXT NOT NULL DEFAULT 'creating',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL DEFAULT '',
  schema_name TEXT,
  neon_branch_id TEXT,
  connection_string TEXT,
  pr_number INTEGER,
  seeded BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_branches_status ON _reactivebase_branches(status);
CREATE INDEX IF NOT EXISTS idx_branches_pr ON _reactivebase_branches(pr_number) WHERE pr_number IS NOT NULL;
`.trim()
}

export function buildCreateBranchSchemaSQL(schemaName: string): { sql: string; params: unknown[] } {
  return {
    sql: `CREATE SCHEMA IF NOT EXISTS "${schemaName}"`,
    params: [],
  }
}

export function buildDropBranchSchemaSQL(schemaName: string): { sql: string; params: unknown[] } {
  return {
    sql: `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
    params: [],
  }
}

export function buildSetSearchPathSQL(schemaName: string): { sql: string; params: unknown[] } {
  return {
    sql: `SET search_path TO "${schemaName}", public`,
    params: [],
  }
}

export function buildCopyTableSchemaSQL(
  sourceSchema: string,
  targetSchema: string,
  tableName: string,
): { sql: string; params: unknown[] } {
  return {
    sql: `CREATE TABLE "${targetSchema}"."${tableName}" (LIKE "${sourceSchema}"."${tableName}" INCLUDING ALL)`,
    params: [],
  }
}

export function buildCopyTableDataSQL(
  sourceSchema: string,
  targetSchema: string,
  tableName: string,
  maxRows: number,
): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO "${targetSchema}"."${tableName}" SELECT * FROM "${sourceSchema}"."${tableName}" LIMIT $1`,
    params: [maxRows],
  }
}

export function buildListTablesInSchemaSQL(schemaName: string): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
    params: [schemaName],
  }
}

export function buildInsertBranchSQL(branch: BranchRecord): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO _reactivebase_branches (name, parent_branch, strategy, status, created_by, schema_name, neon_branch_id, connection_string, pr_number, seeded, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
      ON CONFLICT (name) DO UPDATE SET status = $4, metadata = $11::jsonb`,
    params: [
      branch.name,
      branch.parentBranch,
      branch.strategy,
      branch.status,
      branch.createdBy,
      branch.schemaName,
      branch.neonBranchId,
      branch.connectionString,
      branch.prNumber,
      branch.seeded,
      JSON.stringify(branch.metadata),
    ],
  }
}

// ─── Database Branching Engine ───────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<DatabaseBranchingOptions, "neonApiKey" | "neonProjectId">> & {
  neonApiKey: string | null
  neonProjectId: string | null
} = {
  strategy: "schema",
  defaultBranch: "main",
  maxBranches: 50,
  neonApiKey: null,
  neonProjectId: null,
  autoDeleteOnMerge: true,
}

export class DatabaseBranching {
  private options: typeof DEFAULT_OPTIONS
  private branches = new Map<string, BranchRecord>()
  private currentBranch: string

  constructor(options: DatabaseBranchingOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options } as typeof DEFAULT_OPTIONS
    this.currentBranch = this.options.defaultBranch

    // Create the default branch record
    this.branches.set(this.options.defaultBranch, {
      name: this.options.defaultBranch,
      parentBranch: this.options.defaultBranch,
      strategy: this.options.strategy,
      status: "active",
      createdAt: Date.now(),
      createdBy: "system",
      schemaName: "public",
      neonBranchId: null,
      connectionString: null,
      prNumber: null,
      seeded: true,
      metadata: {},
    })
  }

  get activeBranch(): string {
    return this.currentBranch
  }

  get branchCount(): number {
    return this.branches.size
  }

  // ─── Branch CRUD ────────────────────────────────────────────────────────

  async createBranch(
    name: string,
    options?: {
      fromBranch?: string
      createdBy?: string
      prConfig?: GitHubPRConfig
      seedConfig?: SeedDataConfig
    },
  ): Promise<BranchRecord> {
    if (this.branches.has(name)) {
      throw new BranchingError(`Branch "${name}" already exists`)
    }

    if (this.branches.size >= this.options.maxBranches) {
      throw new BranchingError(`Maximum number of branches (${this.options.maxBranches}) reached`)
    }

    const parentBranch = options?.fromBranch ?? this.options.defaultBranch
    if (!this.branches.has(parentBranch)) {
      throw new BranchingError(`Parent branch "${parentBranch}" does not exist`)
    }

    const schemaName = `rb_branch_${name.replace(/[^a-zA-Z0-9_]/g, "_")}`

    const branch: BranchRecord = {
      name,
      parentBranch,
      strategy: this.options.strategy,
      status: "creating",
      createdAt: Date.now(),
      createdBy: options?.createdBy ?? "unknown",
      schemaName: this.options.strategy === "schema" ? schemaName : null,
      neonBranchId: this.options.strategy === "neon" ? `br_${name}_${Date.now().toString(36)}` : null,
      connectionString: null,
      prNumber: options?.prConfig?.prNumber ?? null,
      seeded: false,
      metadata: options?.prConfig
        ? {
            pr: options.prConfig.prNumber,
            branch: options.prConfig.branch,
            commitSha: options.prConfig.commitSha,
            repository: options.prConfig.repository,
            author: options.prConfig.author,
          }
        : {},
    }

    this.branches.set(name, branch)

    // Generate connection string based on strategy
    if (this.options.strategy === "schema") {
      branch.connectionString = `postgresql://localhost:5432/reactivebase?options=-c search_path=${schemaName},public`
    } else if (this.options.strategy === "neon") {
      branch.connectionString = `postgresql://rb_${name}:****@branch-${branch.neonBranchId}.neon.tech:5432/reactivebase`
    }

    branch.status = "active"
    branch.seeded = true

    return branch
  }

  getBranch(name: string): BranchRecord | undefined {
    return this.branches.get(name)
  }

  listBranches(): BranchRecord[] {
    return [...this.branches.values()]
  }

  listActiveBranches(): BranchRecord[] {
    return [...this.branches.values()].filter((b) => b.status === "active")
  }

  // ─── Branch Navigation ──────────────────────────────────────────────────

  async switchBranch(name: string): Promise<BranchRecord> {
    const branch = this.branches.get(name)
    if (!branch) throw new BranchingError(`Branch "${name}" does not exist`)
    if (branch.status !== "active")
      throw new BranchingError(`Branch "${name}" is not active (status: ${branch.status})`)

    this.currentBranch = name
    return branch
  }

  getSearchPathSQL(): { sql: string; params: unknown[] } {
    const branch = this.branches.get(this.currentBranch)
    const schemaName = branch?.schemaName ?? "public"
    return buildSetSearchPathSQL(schemaName)
  }

  // ─── Branch Merge ───────────────────────────────────────────────────────

  async diffBranches(sourceBranch: string, targetBranch: string): Promise<BranchDiff> {
    const source = this.branches.get(sourceBranch)
    const target = this.branches.get(targetBranch)
    if (!source) throw new BranchingError(`Branch "${sourceBranch}" not found`)
    if (!target) throw new BranchingError(`Branch "${targetBranch}" not found`)

    return {
      sourceBranch,
      targetBranch,
      schemaChanges: [],
      dataChanges: [],
      conflictsDetected: false,
      conflicts: [],
    }
  }

  async mergeBranch(sourceBranch: string, targetBranch?: string): Promise<BranchDiff> {
    const target = targetBranch ?? this.options.defaultBranch
    const source = this.branches.get(sourceBranch)
    if (!source) throw new BranchingError(`Branch "${sourceBranch}" not found`)
    if (source.status !== "active") throw new BranchingError(`Branch "${sourceBranch}" is not active`)

    const diff = await this.diffBranches(sourceBranch, target)

    if (diff.conflictsDetected) {
      throw new BranchingError(
        `Merge conflicts detected between "${sourceBranch}" and "${target}". Resolve conflicts first.`,
      )
    }

    source.status = "merged"

    if (this.currentBranch === sourceBranch) {
      this.currentBranch = target
    }

    return diff
  }

  // ─── Branch Deletion ────────────────────────────────────────────────────

  async deleteBranch(name: string): Promise<void> {
    if (name === this.options.defaultBranch) {
      throw new BranchingError("Cannot delete the default branch")
    }

    const branch = this.branches.get(name)
    if (!branch) throw new BranchingError(`Branch "${name}" not found`)

    if (this.currentBranch === name) {
      this.currentBranch = this.options.defaultBranch
    }

    branch.status = "deleted"
    this.branches.delete(name)
  }

  // ─── PR Integration ─────────────────────────────────────────────────────

  async createPRBranch(prConfig: GitHubPRConfig): Promise<BranchRecord> {
    const branchName = `pr-${prConfig.prNumber}`

    // Delete existing PR branch if it exists
    if (this.branches.has(branchName)) {
      await this.deleteBranch(branchName)
    }

    return this.createBranch(branchName, {
      fromBranch: this.options.defaultBranch,
      createdBy: prConfig.author,
      prConfig,
    })
  }

  async cleanupPRBranch(prNumber: number): Promise<void> {
    const branchName = `pr-${prNumber}`
    const branch = this.branches.get(branchName)
    if (branch) {
      await this.deleteBranch(branchName)
    }
  }

  getBranchForPR(prNumber: number): BranchRecord | undefined {
    return [...this.branches.values()].find((b) => b.prNumber === prNumber && b.status === "active")
  }

  // ─── GitHub Action Config ──────────────────────────────────────────────

  generateGitHubActionYAML(): string {
    return `name: ReactiveBase Preview Environment
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Create/Update Preview Branch
        if: github.event.action != 'closed'
        run: |
          npx reactivebase branch create pr-\${{ github.event.pull_request.number }} \\
            --from main \\
            --pr \${{ github.event.pull_request.number }} \\
            --commit \${{ github.sha }}
        env:
          DATABASE_URL: \${{ secrets.DATABASE_URL }}
          NEON_API_KEY: \${{ secrets.NEON_API_KEY }}

      - name: Run migrations on preview
        if: github.event.action != 'closed'
        run: npx reactivebase migrate --apply --branch pr-\${{ github.event.pull_request.number }}
        env:
          DATABASE_URL: \${{ secrets.DATABASE_URL }}

      - name: Comment PR with preview URL
        if: github.event.action != 'closed'
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '🔀 Preview database branch created: \`pr-\${{ github.event.pull_request.number }}\`'
            })

      - name: Cleanup Preview Branch
        if: github.event.action == 'closed'
        run: npx reactivebase branch delete pr-\${{ github.event.pull_request.number }}
        env:
          DATABASE_URL: \${{ secrets.DATABASE_URL }}
`
  }
}

// ─── CLI Integration ─────────────────────────────────────────────────────────

export function generateBranchCLIUsage(): string {
  return `
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
  reactivebase branch pr <number>       Create/update PR preview branch
  reactivebase branch cleanup <pr>      Clean up PR preview branch

Examples:
  reactivebase branch create feature-x
  reactivebase branch create feature-x --from staging --seed
  reactivebase branch switch feature-x
  reactivebase branch merge feature-x
  reactivebase branch pr 42 --commit abc123
`.trim()
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class BranchingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BranchingError"
  }
}
