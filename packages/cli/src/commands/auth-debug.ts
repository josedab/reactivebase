/**
 * CLI command: auth:debug
 * Interactive debugging tool for tracing permission decisions.
 */

/** Options for the `reactivebase auth:debug` command. */
export interface AuthDebugCommandOptions {
  /** Path to the project root directory */
  projectDir: string
  /** User ID to debug permissions for */
  userId: string
  /** Query function name to trace (e.g. "getDocuments") */
  queryName: string
  /** Table name to inspect RLS policies for (e.g. "posts") */
  table: string
}

/**
 * Run the interactive auth debugger to trace permission decisions.
 *
 * @param options - Auth debug options including user, query, and table to inspect
 * @returns Resolves when debugging output is complete
 */
export async function authDebug(options: AuthDebugCommandOptions): Promise<void> {
  if (!options.userId && !options.queryName) {
    showAuthDebugHelp()
    return
  }

  console.log("╔══════════════════════════════════════════════════╗")
  console.log("║          ReactiveBase Auth Debugger              ║")
  console.log("╚══════════════════════════════════════════════════╝")
  console.log("")

  if (options.userId) {
    console.log(`  User: ${options.userId}`)
  }
  if (options.queryName) {
    console.log(`  Query: ${options.queryName}`)
  }
  if (options.table) {
    console.log(`  Table: ${options.table}`)
  }
  console.log("")

  console.log("To use the full debugger, integrate with the PermissionsDebugger API:")
  console.log("")
  console.log("  import { createPermissionsDebugger } from '@reactivebase/server'")
  console.log("")
  console.log("  const debugger = createPermissionsDebugger({ includeExplain: true })")
  console.log("  debugger.registerRlsPolicies(myPolicies)")
  console.log("  debugger.setZanzibarTuples(myTuples)")
  console.log("")
  console.log("  const result = debugger.debugQuery(auth, 'getDocuments', { limit: 10 }, ['documents'], rows)")
  console.log("  console.log(debugger.formatForCLI(result))")
  console.log("")
  console.log("The debugger traces:")
  console.log("  ✅ Authentication context (JWT claims, user ID)")
  console.log("  ✅ RLS policy evaluation per row")
  console.log("  ✅ Zanzibar tuple matching")
  console.log("  ✅ SQL EXPLAIN output")
  console.log("  ✅ Ring buffer for recent trace history")
}

function showAuthDebugHelp(): void {
  console.log(`
Usage: reactivebase auth:debug [options]

Options:
  --user <userId>     User ID to debug permissions for
  --query <name>      Query function name to trace
  --table <name>      Table to inspect RLS policies for

Examples:
  reactivebase auth:debug --user user-123 --query getDocuments
  reactivebase auth:debug --user user-456 --table posts
  reactivebase auth:debug --query getPublicPosts
`)
}
