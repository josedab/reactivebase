---
sidebar_position: 17
---

# Database Branching

*Estimated time: 10 minutes*

ReactiveBase supports database branching for development, CI, and preview environments. Create isolated copies of your database for feature development and PR previews, then merge or discard them. Branching is exported from `@reactivebase/server` under the `data` category.

## Branching Strategies

| Strategy | How It Works | Speed | Isolation | Cost |
|----------|-------------|-------|-----------|------|
| **Schema** | Creates a separate Postgres schema in the same database | Fast (ms) | Logical (shared DB) | Low |
| **Neon** | Copy-on-write fork via Neon API | Medium (seconds) | Full (separate connection) | Medium |
| **Database** | Creates a separate database | Slow (seconds) | Full (separate DB) | High |

### Choosing a Strategy

- **Schema** — Best for most use cases. Fast, low cost, works with any Postgres. Limited to 50 branches.
- **Neon** — Best for production-like previews. Copy-on-write means instant forks with zero storage overhead for unchanged data. Requires Neon.
- **Database** — Best for full isolation when schema-level separation isn't sufficient.

## Setup

### Schema Branching (Default)

```typescript
import { DatabaseBranching } from "@reactivebase/server"

const branching = new DatabaseBranching({
  strategy: "schema",
  mainSchema: "public",
  maxBranches: 50,
})
```

### Neon Branching

```typescript
import { DatabaseBranching, NeonBranchingAdapter } from "@reactivebase/server"

const neon = new NeonBranchingAdapter({
  apiKey: process.env.NEON_API_KEY,
  projectId: process.env.NEON_PROJECT_ID,
})

const branching = new DatabaseBranching({
  strategy: "neon",
  neonAdapter: neon,
})
```

## Branch Lifecycle

### Create a Branch

```typescript
// Create a branch from the main schema
const branch = await branching.createBranch("feature-auth", {
  seedData: true, // copy data from parent
})

// Create a branch linked to a PR
const prBranch = await branching.createPRBranch({
  prNumber: 42,
  branchName: "pr-42-auth",
  baseBranch: "main",
})
```

### Switch to a Branch

```typescript
await branching.switchBranch("feature-auth")
// All subsequent queries execute against the branch schema
```

### List Branches

```typescript
const all = await branching.listBranches()
const active = await branching.listActiveBranches()

console.log(branching.activeBranch) // current branch name
console.log(branching.branchCount)  // total branch count
```

### Compare Branches

```typescript
const diff = await branching.diffBranches("feature-auth", "main")
// diff.schemaChanges => [{ type: "add_column", table: "users", column: "role" }]
// diff.dataChanges   => [{ table: "users", inserts: 5, updates: 2, deletes: 0 }]
```

### Merge a Branch

```typescript
const result = await branching.mergeBranch("feature-auth", "main")

if (result.conflicts.length > 0) {
  // Handle merge conflicts
  for (const conflict of result.conflicts) {
    console.log(`Conflict in ${conflict.table}: ${conflict.description}`)
  }
}
```

### Delete a Branch

```typescript
await branching.deleteBranch("feature-auth")

// Auto-cleanup PR branches on merge
await branching.cleanupPRBranch(42)
```

## CI Setup with GitHub Actions

ReactiveBase can generate a GitHub Actions workflow that automatically creates preview branches for PRs and cleans them up on merge.

### Generate the Workflow

```typescript
const yaml = branching.generateGitHubActionYAML()
// Write to .github/workflows/db-preview.yml
```

### Generated Workflow

The generated workflow:

1. **On PR open/sync** — Creates a database branch matching the PR
2. **Runs migrations** — Applies pending migrations to the branch
3. **Posts a comment** — Adds a PR comment with the preview connection string
4. **On PR close** — Deletes the branch

```yaml
# .github/workflows/db-preview.yml (generated)
name: Database Preview
on:
  pull_request:
    types: [opened, synchronize, closed]

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - name: Create preview branch
        if: github.event.action != 'closed'
        run: npx reactivebase branch create pr-${{ github.event.number }}
      - name: Run migrations
        if: github.event.action != 'closed'
        run: npx reactivebase migrate --schema pr-${{ github.event.number }}
      - name: Cleanup preview branch
        if: github.event.action == 'closed'
        run: npx reactivebase branch delete pr-${{ github.event.number }}
```

### PR Preview Manager

For more control, use `PRPreviewManager` directly:

```typescript
import { PRPreviewManager } from "@reactivebase/server"

const previews = new PRPreviewManager(branching)

// On PR open
await previews.createPreview({
  prNumber: 42,
  baseBranch: "main",
  headBranch: "feature-auth",
})

// On PR close
await previews.cleanupPreview(42)

// Get preview status for a PR
const status = await previews.getPreviewStatus(42)
```

## Branch Dashboard

`BranchDashboard` provides a visual overview of all branches, their status, and parent-child relationships.

```typescript
import { BranchDashboard } from "@reactivebase/server"

const dashboard = new BranchDashboard(branching)

// Branch tree with parent/child relationships
const tree = dashboard.getBranchTree()

// Preview status tracking
const previews = dashboard.getPreviewStatuses()
```

## Branch Limits

The default limit is **50 branches** to prevent resource exhaustion. This is configurable:

```typescript
const branching = new DatabaseBranching({
  strategy: "schema",
  maxBranches: 100,
})
```

For Neon branching, limits are governed by your Neon plan.

## Typical Workflows

### Feature Development

```
main ──┬── feature-auth ──── (develop) ──── merge back ──── delete
       │
       └── feature-billing ── (develop) ──── merge back ──── delete
```

```typescript
await branching.createBranch("feature-auth", { seedData: true })
await branching.switchBranch("feature-auth")
// ... develop and test ...
await branching.mergeBranch("feature-auth", "main")
await branching.deleteBranch("feature-auth")
```

### PR Preview Environments

```
PR opened  → createPRBranch(42)  → run migrations → post comment
PR updated → re-run migrations on existing branch
PR merged  → cleanupPRBranch(42)
```

## Next Steps

→ [Event Sourcing](./event-sourcing.md) — Build event-driven architectures with projections and time-travel
→ [Schema Deep Dive](./schema-deep-dive.md) — Understand the schema definition system
