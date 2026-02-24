/**
 * GitHub Action for PR Preview Environments.
 * Generates workflow YAML and manages PR-linked database branch previews.
 *
 * Usage:
 *   const yaml = generateGitHubActionYAML({ projectName: "my-app" })
 *   const manager = new PRPreviewManager(branchingInstance)
 *   const preview = await manager.createPreview(42, "feature-x", "abc123")
 */

import type { BranchDiff, SchemaChange } from "./branching.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PreviewConfig {
  /** Project name for display (default: "reactivebase") */
  projectName?: string
  /** Preview URL template. Use {{branch}} for branch name, {{pr}} for PR number */
  previewUrlTemplate?: string
  /** Run migration dry-run before applying (default: true) */
  migrationDryRun?: boolean
  /** Auto-apply migrations on preview creation (default: true) */
  autoMigrate?: boolean
  /** Additional environment variables for the workflow */
  envVars?: Record<string, string>
  /** Node.js version (default: "20") */
  nodeVersion?: string
}

export interface PreviewRecord {
  prNumber: number
  branch: string
  commitSha: string
  dbBranch: string
  previewUrl: string | null
  status: "creating" | "active" | "updating" | "destroying" | "destroyed"
  createdAt: number
  updatedAt: number
  migrationStatus: "pending" | "applied" | "failed" | "skipped"
  metadata: Record<string, unknown>
}

// ─── Workflow Generator ──────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<PreviewConfig> = {
  projectName: "reactivebase",
  previewUrlTemplate: "https://preview-pr-{{pr}}.{{projectName}}.dev",
  migrationDryRun: true,
  autoMigrate: true,
  envVars: {},
  nodeVersion: "20",
}

export function generateGitHubActionYAML(config: PreviewConfig = {}): string {
  const c = { ...DEFAULT_CONFIG, ...config }
  const extraEnv = Object.entries(c.envVars)
    .map(([k, v]) => `          ${k}: ${v}`)
    .join("\n")
  const extraEnvBlock = extraEnv ? `\n${extraEnv}` : ""

  const dryRunStep = c.migrationDryRun
    ? `
      - name: Migration dry-run preview
        if: github.event.action != 'closed'
        run: npx reactivebase migrate --dry-run --branch pr-\${{ github.event.pull_request.number }}
        env:
          DATABASE_URL: \${{ secrets.DATABASE_URL }}
          NEON_API_KEY: \${{ secrets.NEON_API_KEY }}${extraEnvBlock}
`
    : ""

  const migrateStep = c.autoMigrate
    ? `
      - name: Apply migrations on preview
        if: github.event.action != 'closed'
        run: npx reactivebase migrate --apply --branch pr-\${{ github.event.pull_request.number }}
        env:
          DATABASE_URL: \${{ secrets.DATABASE_URL }}
          NEON_API_KEY: \${{ secrets.NEON_API_KEY }}${extraEnvBlock}
`
    : ""

  return `name: ${c.projectName} Preview Environment
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

env:
  PREVIEW_PROJECT: ${c.projectName}

jobs:
  preview-create:
    if: github.event.action != 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "${c.nodeVersion}"

      - name: Install dependencies
        run: npm ci

      - name: Create database branch
        run: |
          npx reactivebase branch create pr-\${{ github.event.pull_request.number }} \\
            --from main \\
            --pr \${{ github.event.pull_request.number }} \\
            --commit \${{ github.sha }}
        env:
          DATABASE_URL: \${{ secrets.DATABASE_URL }}
          NEON_API_KEY: \${{ secrets.NEON_API_KEY }}${extraEnvBlock}
${dryRunStep}${migrateStep}
      - name: Deploy preview environment
        if: github.event.action != 'closed'
        run: |
          echo "Preview URL: ${c.previewUrlTemplate.replace("{{pr}}", "${{ github.event.pull_request.number }}").replace("{{projectName}}", c.projectName)}"
        env:
          DATABASE_URL: \${{ secrets.DATABASE_URL }}${extraEnvBlock}

      - name: Comment PR with preview URL
        uses: actions/github-script@v7
        with:
          script: |
            const previewUrl = '${c.previewUrlTemplate.replace("{{pr}}", "' + context.issue.number + '").replace("{{projectName}}", c.projectName)}';
            const body = [
              '## 🔀 Preview Environment Ready',
              '',
              '| Resource | Value |',
              '|----------|-------|',
              '| **Database Branch** | \`pr-' + context.issue.number + '\` |',
              '| **Preview URL** | ' + previewUrl + ' |',
              '| **Commit** | \`\${{ github.sha }}\` |',
              '',
              '> This preview will be automatically cleaned up when the PR is closed.',
            ].join('\\n');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body,
            });

  preview-cleanup:
    if: github.event.action == 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "${c.nodeVersion}"

      - name: Install dependencies
        run: npm ci

      - name: Cleanup database branch
        run: npx reactivebase branch delete pr-\${{ github.event.pull_request.number }}
        env:
          DATABASE_URL: \${{ secrets.DATABASE_URL }}
          NEON_API_KEY: \${{ secrets.NEON_API_KEY }}${extraEnvBlock}

      - name: Comment PR with cleanup notice
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '🧹 Preview environment for PR #' + context.issue.number + ' has been cleaned up.',
            });
`
}

// ─── PR Preview Manager ──────────────────────────────────────────────────────

export interface PRPreviewBranching {
  createBranch(
    name: string,
    options?: { fromBranch?: string; createdBy?: string },
  ): Promise<{ name: string; connectionString: string | null }>
  deleteBranch(name: string): Promise<void>
  getBranch(name: string): { name: string; status: string; connectionString: string | null } | undefined
  listBranches(): { name: string; prNumber: number | null; status: string }[]
  diffBranches(source: string, target: string): Promise<BranchDiff>
}

export class PRPreviewManager {
  private previews = new Map<number, PreviewRecord>()
  private branching: PRPreviewBranching

  constructor(branching: PRPreviewBranching) {
    this.branching = branching
  }

  async createPreview(prNumber: number, branch: string, commitSha: string): Promise<PreviewRecord> {
    const dbBranch = `pr-${prNumber}`

    // Clean up existing preview if present
    if (this.previews.has(prNumber)) {
      await this.destroyPreview(prNumber)
    }

    const record: PreviewRecord = {
      prNumber,
      branch,
      commitSha,
      dbBranch,
      previewUrl: null,
      status: "creating",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      migrationStatus: "pending",
      metadata: {},
    }
    this.previews.set(prNumber, record)

    const created = await this.branching.createBranch(dbBranch, {
      fromBranch: "main",
      createdBy: `pr-${prNumber}`,
    })

    record.status = "active"
    record.previewUrl = `https://preview-pr-${prNumber}.reactivebase.dev`
    record.updatedAt = Date.now()
    record.metadata.connectionString = created.connectionString

    return record
  }

  async updatePreview(prNumber: number, commitSha: string): Promise<PreviewRecord> {
    const preview = this.previews.get(prNumber)
    if (!preview) {
      throw new PreviewError(`No preview found for PR #${prNumber}`)
    }

    preview.status = "updating"
    preview.commitSha = commitSha
    preview.updatedAt = Date.now()

    // Re-create the branch for the new commit
    await this.branching.deleteBranch(preview.dbBranch)
    await this.branching.createBranch(preview.dbBranch, {
      fromBranch: "main",
      createdBy: `pr-${prNumber}`,
    })

    preview.status = "active"
    preview.migrationStatus = "pending"
    preview.updatedAt = Date.now()

    return preview
  }

  async destroyPreview(prNumber: number): Promise<void> {
    const preview = this.previews.get(prNumber)
    if (!preview) return

    preview.status = "destroying"
    preview.updatedAt = Date.now()

    try {
      await this.branching.deleteBranch(preview.dbBranch)
    } catch {
      // Branch may already be deleted
    }

    preview.status = "destroyed"
    preview.updatedAt = Date.now()
    this.previews.delete(prNumber)
  }

  getPreview(prNumber: number): PreviewRecord | undefined {
    return this.previews.get(prNumber)
  }

  listPreviews(): PreviewRecord[] {
    return [...this.previews.values()]
  }

  async generateMigrationPreview(branch: string): Promise<string> {
    const diff = await this.branching.diffBranches(branch, "main")
    return formatMigrationDiff(diff)
  }
}

// ─── Migration Diff Formatter ────────────────────────────────────────────────

function formatMigrationDiff(diff: BranchDiff): string {
  const lines: string[] = [`## Migration Preview: \`${diff.sourceBranch}\` → \`${diff.targetBranch}\``, ""]

  if (diff.schemaChanges.length === 0 && diff.dataChanges.length === 0) {
    lines.push("No changes detected.")
    return lines.join("\n")
  }

  if (diff.schemaChanges.length > 0) {
    lines.push("### Schema Changes", "")
    lines.push("| Type | Table | Column | Details |")
    lines.push("|------|-------|--------|---------|")
    for (const change of diff.schemaChanges) {
      lines.push(
        `| ${formatChangeType(change.type)} | \`${change.table}\` | ${change.column ? `\`${change.column}\`` : "—"} | ${change.details} |`,
      )
    }
    lines.push("")
  }

  if (diff.dataChanges.length > 0) {
    lines.push("### Data Changes", "")
    lines.push("| Table | Inserts | Updates | Deletes |")
    lines.push("|-------|---------|---------|---------|")
    for (const change of diff.dataChanges) {
      lines.push(`| \`${change.table}\` | ${change.inserts} | ${change.updates} | ${change.deletes} |`)
    }
    lines.push("")
  }

  if (diff.conflictsDetected) {
    lines.push("### ⚠️ Conflicts Detected", "")
    for (const conflict of diff.conflicts) {
      lines.push(
        `- **${conflict.table}**${conflict.column ? `.${conflict.column}` : ""}: ${conflict.description} (resolution: ${conflict.resolution})`,
      )
    }
    lines.push("")
  }

  return lines.join("\n")
}

function formatChangeType(type: SchemaChange["type"]): string {
  const labels: Record<SchemaChange["type"], string> = {
    table_added: "➕ Table Added",
    table_removed: "➖ Table Removed",
    column_added: "➕ Column Added",
    column_removed: "➖ Column Removed",
    column_modified: "✏️ Column Modified",
    index_added: "➕ Index Added",
    index_removed: "➖ Index Removed",
  }
  return labels[type] ?? type
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class PreviewError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PreviewError"
  }
}

/**
 * Generate a GitHub Action workflow step that runs migration shadow preview
 * and posts results as a PR comment.
 */
export function generateMigrationPreviewStep(config: PreviewConfig = {}): string {
  const c = { ...DEFAULT_CONFIG, ...config }

  return `
      - name: Migration Impact Preview
        id: migration-preview
        run: |
          npx reactivebase migration:preview --format=json > /tmp/migration-report.json
        env:
          DATABASE_URL: \${{ secrets.PREVIEW_DATABASE_URL }}
          NODE_ENV: preview

      - name: Post Migration Report
        if: always() && steps.migration-preview.outcome != 'skipped'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            try {
              const report = JSON.parse(fs.readFileSync('/tmp/migration-report.json', 'utf8'));
              const emoji = report.status === 'safe' ? '✅' : report.status === 'warning' ? '⚠️' : '❌';
              let body = '## ' + emoji + ' Migration Impact Report\\n\\n';
              body += '**Status:** ' + report.status.toUpperCase() + '\\n';
              body += '**Duration:** ' + report.durationMs + 'ms\\n\\n';
              if (report.breakingChanges && report.breakingChanges.length > 0) {
                body += '### Breaking Changes\\n';
                report.breakingChanges.forEach(bc => { body += '- **' + bc.type + '**: ' + bc.description + '\\n'; });
                body += '\\n';
              }
              if (report.performanceRegressions && report.performanceRegressions.length > 0) {
                body += '### Performance Regressions\\n';
                report.performanceRegressions.forEach(pr => {
                  body += '- ' + (pr.functionName || pr.sql.substring(0, 50)) + ': +' + pr.regressionPct + '% regression\\n';
                });
                body += '\\n';
              }
              body += report.summary + '\\n';
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body: body
              });
            } catch (e) {
              console.log('Migration report not available:', e.message);
            }
`.trim()
}
