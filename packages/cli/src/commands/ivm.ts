/**
 * IVM CLI commands — manage incremental view maintenance views.
 * Subcommands: list, stats, register, unregister
 */

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

export interface IvmCommandOptions {
  projectDir: string
  connectionString?: string
}

/**
 * List registered IVM views.
 */
export async function ivmList(options: IvmCommandOptions): Promise<void> {
  const viewsPath = findViewsFile(options.projectDir)

  if (!viewsPath) {
    console.log("No IVM views file found.")
    console.log("Create a views file at one of:")
    console.log("  - convex/views.ts")
    console.log("  - src/views.ts")
    console.log("")
    console.log("Example:")
    console.log('  import { IncrementalViewMaintainer } from "@reactivebase/server"')
    console.log("")
    console.log("  const ivm = new IncrementalViewMaintainer()")
    console.log("  ivm.register({")
    console.log('    viewId: "active-tasks",')
    console.log('    queryAst: { type: "filter", source: { type: "scan", table: "tasks" },')
    console.log('      predicate: { field: "done", operator: "=", value: false } },')
    console.log("    currentResult: [],")
    console.log("  })")
    return
  }

  console.log(`Found views at: ${viewsPath}`)
  console.log("")
  console.log("Registered IVM views:")
  console.log("  (Views are registered at runtime from your TypeScript file)")
  console.log("  Use `reactivebase ivm stats` to see runtime statistics.")
}

/**
 * Show IVM runtime statistics.
 */
export async function ivmStats(options: IvmCommandOptions): Promise<void> {
  console.log("IVM Statistics")
  console.log("==============")
  console.log("")
  console.log("To see IVM statistics at runtime, use IncrementalViewMaintainer.getStats():")
  console.log("")
  console.log('  import { IncrementalViewMaintainer } from "@reactivebase/server"')
  console.log("  const ivm = new IncrementalViewMaintainer()")
  console.log("  // ... register views and process changes ...")
  console.log("  const stats = ivm.getStats()")
  console.log("  console.table({")
  console.log("    'Total Views': stats.totalViews,")
  console.log("    'IVM Eligible': stats.ivmEligibleViews,")
  console.log("    'Deltas Applied': stats.deltaApplied,")
  console.log("    'Full Refreshes': stats.fullRefreshes,")
  console.log("    'Avg Delta Time': `${stats.avgDeltaTimeMs.toFixed(2)}ms`,")
  console.log("  })")
  console.log("")
  console.log("Or visit the dashboard at http://localhost:4000/dashboard when dev server is running.")
}

/**
 * Show IVM eligibility analysis for current schema.
 */
export async function ivmAnalyze(options: IvmCommandOptions): Promise<void> {
  console.log("IVM Eligibility Analysis")
  console.log("========================")
  console.log("")
  console.log("Query patterns and IVM eligibility:")
  console.log("")
  console.log("  ✅ IVM-eligible patterns:")
  console.log("    - Simple scans: SELECT * FROM tasks")
  console.log("    - Filtered scans: SELECT * FROM tasks WHERE done = false")
  console.log("    - Projections: SELECT id, title FROM tasks")
  console.log("    - Aggregations: SELECT COUNT(*) FROM tasks GROUP BY priority")
  console.log("    - Sorts: SELECT * FROM tasks ORDER BY created_at")
  console.log("")
  console.log("  ❌ Requires full re-execution:")
  console.log("    - LIMIT/OFFSET: SELECT * FROM tasks LIMIT 10")
  console.log("    - Complex JOINs (hash index needed)")
  console.log("    - Window functions")
  console.log("    - DISTINCT")
  console.log("")
  console.log("To check if a specific query is IVM-eligible:")
  console.log('  import { isIvmEligible } from "@reactivebase/server"')
  console.log('  console.log(isIvmEligible(myQueryAst))')
}

function findViewsFile(projectDir: string): string | null {
  const candidates = [
    "convex/views.ts",
    "src/views.ts",
    "views.ts",
  ]
  for (const candidate of candidates) {
    const filePath = join(projectDir, candidate)
    if (existsSync(filePath)) return filePath
  }
  return null
}
