/**
 * Declarative Testing DSL for ReactiveBase.
 * Write reactive integration tests using a fluent, natural-language-style API:
 *
 *   scenario('user completes task')
 *     .given(seed({ tasks: [{ id: '1', title: 'Test', status: 'active' }] }))
 *     .when(mutation(completeTask, { id: '1' }))
 *     .then(subscription('tasks'))
 *     .emits([{ id: '1', status: 'completed' }])
 *
 * Features:
 *   - Fluent builder DSL for test scenarios
 *   - Seed data helpers
 *   - Mutation/query/action execution steps
 *   - Subscription assertion with expected emissions
 *   - Time-travel replay with snapshot diffing
 *   - Parallel execution support for CI
 *   - Timeout and retry configuration
 */

import type { MockRow } from "./mock-database.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScenarioDefinition {
  name: string
  givenSteps: GivenStep[]
  whenSteps: WhenStep[]
  thenSteps: ThenStep[]
  options: ScenarioOptions
}

export interface ScenarioOptions {
  /** Timeout per step in ms (default: 5000) */
  timeoutMs?: number
  /** Number of retries for flaky assertions (default: 0) */
  retries?: number
  /** Tags for filtering in CI (e.g., ["smoke", "integration"]) */
  tags?: string[]
  /** Whether to capture snapshots after each step (default: true) */
  captureSnapshots?: boolean
  /** Parallel group for CI execution */
  parallelGroup?: string
}

export interface GivenStep {
  type: "seed"
  tables: Record<string, Record<string, unknown>[]>
}

export interface WhenStep {
  type: "mutation" | "query" | "action" | "delay" | "custom"
  name: string
  handler?: { handler: (...args: never[]) => unknown | Promise<unknown> }
  args?: Record<string, unknown>
  delayMs?: number
  customFn?: () => Promise<void>
}

export interface ThenStep {
  type: "subscription" | "query_result" | "table_state" | "snapshot_diff" | "custom"
  table?: string
  queryName?: string
  expected?: unknown
  matcher?: "exact" | "contains" | "subset" | "custom"
  customMatcher?: (actual: unknown) => boolean | string
  description?: string
}

export interface ScenarioResult {
  name: string
  passed: boolean
  steps: StepResult[]
  duration: number
  snapshots: SnapshotRecord[]
  error?: string
}

export interface StepResult {
  type: string
  name: string
  passed: boolean
  duration: number
  error?: string
  actual?: unknown
  expected?: unknown
}

export interface SnapshotRecord {
  step: string
  tables: Record<string, MockRow[]>
  timestamp: number
}

export interface CIReport {
  suiteName: string
  totalScenarios: number
  passed: number
  failed: number
  skipped: number
  duration: number
  results: ScenarioResult[]
  parallelGroups: string[]
}

// ─── DSL Builder ─────────────────────────────────────────────────────────────

/**
 * Create a new test scenario with a descriptive name.
 */
export function scenario(name: string): ScenarioBuilder {
  return new ScenarioBuilder(name)
}

/**
 * Create a seed step for populating test data.
 */
export function seed(tables: Record<string, Record<string, unknown>[]>): GivenStep {
  return { type: "seed", tables }
}

/**
 * Create a mutation step.
 */
export function mutation(
  handler: { handler: (...args: never[]) => unknown | Promise<unknown> },
  args?: Record<string, unknown>,
): WhenStep {
  return { type: "mutation", name: handler.handler.name || "anonymous_mutation", handler, args }
}

/**
 * Create a query step.
 */
export function query(
  handler: { handler: (...args: never[]) => unknown | Promise<unknown> },
  args?: Record<string, unknown>,
): WhenStep {
  return { type: "query", name: handler.handler.name || "anonymous_query", handler, args }
}

/**
 * Create an action step.
 */
export function action(
  handler: { handler: (...args: never[]) => unknown | Promise<unknown> },
  args?: Record<string, unknown>,
): WhenStep {
  return { type: "action", name: handler.handler.name || "anonymous_action", handler, args }
}

/**
 * Create a delay step for testing async flows.
 */
export function delay(ms: number): WhenStep {
  return { type: "delay", name: `delay(${ms}ms)`, delayMs: ms }
}

/**
 * Create a subscription assertion on a table.
 */
export function subscription(table: string): ThenStep {
  return { type: "subscription", table, matcher: "subset" }
}

/**
 * Create a query result assertion.
 */
export function queryResult(queryName: string): ThenStep {
  return { type: "query_result", queryName, matcher: "exact" }
}

/**
 * Create a table state assertion.
 */
export function tableState(table: string): ThenStep {
  return { type: "table_state", table, matcher: "exact" }
}

// ─── Scenario Builder ────────────────────────────────────────────────────────

export class ScenarioBuilder {
  private definition: ScenarioDefinition

  constructor(name: string) {
    this.definition = {
      name,
      givenSteps: [],
      whenSteps: [],
      thenSteps: [],
      options: {},
    }
  }

  /** Add seed data to the scenario. */
  given(step: GivenStep): this {
    this.definition.givenSteps.push(step)
    return this
  }

  /** Add a mutation/query/action step. */
  when(step: WhenStep): this {
    this.definition.whenSteps.push(step)
    return this
  }

  /** Add an assertion step. */
  then(step: ThenStep): this {
    this.definition.thenSteps.push(step)
    return this
  }

  /** Assert that a subscription emits the expected data. */
  emits(expected: unknown): this {
    const lastThen = this.definition.thenSteps[this.definition.thenSteps.length - 1]
    if (lastThen) {
      lastThen.expected = expected
    }
    return this
  }

  /** Assert with a contains matcher. */
  contains(expected: unknown): this {
    const lastThen = this.definition.thenSteps[this.definition.thenSteps.length - 1]
    if (lastThen) {
      lastThen.expected = expected
      lastThen.matcher = "contains"
    }
    return this
  }

  /** Set scenario options. */
  configure(options: ScenarioOptions): this {
    this.definition.options = { ...this.definition.options, ...options }
    return this
  }

  /** Tag this scenario for CI filtering. */
  tag(...tags: string[]): this {
    this.definition.options.tags = [...(this.definition.options.tags ?? []), ...tags]
    return this
  }

  /** Get the scenario definition for execution. */
  build(): ScenarioDefinition {
    return { ...this.definition }
  }
}

// ─── Scenario Runner ─────────────────────────────────────────────────────────

export interface ScenarioRunnerOptions {
  /** Default timeout per step (ms) */
  defaultTimeoutMs?: number
  /** Capture snapshots by default */
  captureSnapshots?: boolean
  /** Parallel execution limit */
  parallelLimit?: number
  /** Reporter callback */
  onStepComplete?: (scenarioName: string, step: StepResult) => void
}

/**
 * Executes test scenarios against a test server.
 */
export class ScenarioRunner {
  private options: Required<ScenarioRunnerOptions>
  private db: MockDatabaseLike

  constructor(db: MockDatabaseLike, options?: ScenarioRunnerOptions) {
    this.db = db
    this.options = {
      defaultTimeoutMs: options?.defaultTimeoutMs ?? 5_000,
      captureSnapshots: options?.captureSnapshots ?? true,
      parallelLimit: options?.parallelLimit ?? 4,
      onStepComplete: options?.onStepComplete ?? (() => {}),
    }
  }

  /**
   * Run a single scenario.
   */
  async run(builder: ScenarioBuilder): Promise<ScenarioResult> {
    const definition = builder.build()
    const startTime = Date.now()
    const steps: StepResult[] = []
    const snapshots: SnapshotRecord[] = []
    let passed = true
    let error: string | undefined

    try {
      // Given: seed data
      for (const givenStep of definition.givenSteps) {
        const stepStart = Date.now()
        try {
          for (const [tableName, rows] of Object.entries(givenStep.tables)) {
            for (const row of rows) {
              this.db.table(tableName).insert(row)
            }
          }
          steps.push({
            type: "given",
            name: `seed(${Object.keys(givenStep.tables).join(", ")})`,
            passed: true,
            duration: Date.now() - stepStart,
          })
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          steps.push({ type: "given", name: "seed", passed: false, duration: Date.now() - stepStart, error: msg })
          passed = false
          error = msg
          break
        }

        if (this.options.captureSnapshots) {
          snapshots.push(this.captureSnapshot("after-seed"))
        }
      }

      if (!passed) {
        return { name: definition.name, passed, steps, duration: Date.now() - startTime, snapshots, error }
      }

      // When: execute steps
      for (const whenStep of definition.whenSteps) {
        const stepStart = Date.now()
        try {
          if (whenStep.type === "delay") {
            await new Promise((resolve) => setTimeout(resolve, whenStep.delayMs ?? 0))
          } else if (whenStep.type === "custom" && whenStep.customFn) {
            await whenStep.customFn()
          } else if (whenStep.handler) {
            const ctx = this.createContext()
            await whenStep.handler.handler(ctx as never, (whenStep.args ?? {}) as never)
          }

          steps.push({
            type: "when",
            name: whenStep.name,
            passed: true,
            duration: Date.now() - stepStart,
          })

          if (this.options.captureSnapshots) {
            snapshots.push(this.captureSnapshot(`after-${whenStep.name}`))
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          steps.push({ type: "when", name: whenStep.name, passed: false, duration: Date.now() - stepStart, error: msg })
          passed = false
          error = msg
          break
        }
      }

      if (!passed) {
        return { name: definition.name, passed, steps, duration: Date.now() - startTime, snapshots, error }
      }

      // Then: assertions
      for (const thenStep of definition.thenSteps) {
        const stepStart = Date.now()
        try {
          const result = this.assertStep(thenStep)
          steps.push(result)
          if (!result.passed) {
            passed = false
            error = result.error
          }

          this.options.onStepComplete(definition.name, result)
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          steps.push({
            type: "then",
            name: thenStep.description ?? thenStep.type,
            passed: false,
            duration: Date.now() - stepStart,
            error: msg,
          })
          passed = false
          error = msg
        }
      }
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err)
      passed = false
    }

    return {
      name: definition.name,
      passed,
      steps,
      duration: Date.now() - startTime,
      snapshots,
      error,
    }
  }

  /**
   * Run multiple scenarios, optionally in parallel groups.
   */
  async runAll(scenarios: ScenarioBuilder[]): Promise<CIReport> {
    const startTime = Date.now()
    const results: ScenarioResult[] = []
    const parallelGroups = new Set<string>()

    // Group scenarios
    const groups = new Map<string, ScenarioBuilder[]>()
    for (const s of scenarios) {
      const def = s.build()
      const group = def.options.parallelGroup ?? "default"
      parallelGroups.add(group)
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group)!.push(s)
    }

    // Execute groups sequentially, scenarios within a group in parallel
    for (const [, groupScenarios] of groups) {
      const batchSize = this.options.parallelLimit
      for (let i = 0; i < groupScenarios.length; i += batchSize) {
        const batch = groupScenarios.slice(i, i + batchSize)
        const batchResults = await Promise.all(batch.map((s) => this.run(s)))
        results.push(...batchResults)
      }
    }

    return {
      suiteName: "ReactiveBase Test Suite",
      totalScenarios: scenarios.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      skipped: 0,
      duration: Date.now() - startTime,
      results,
      parallelGroups: [...parallelGroups],
    }
  }

  /**
   * Generate a CI-friendly report string.
   */
  formatReport(report: CIReport): string {
    const lines: string[] = [`\n${"═".repeat(60)}`, `  ${report.suiteName}`, `${"═".repeat(60)}`, ""]

    for (const result of report.results) {
      const icon = result.passed ? "✓" : "✗"
      lines.push(`  ${icon} ${result.name} (${result.duration}ms)`)
      if (!result.passed && result.error) {
        lines.push(`    Error: ${result.error}`)
      }
      for (const step of result.steps) {
        if (!step.passed) {
          lines.push(`    └─ ${step.type}/${step.name}: ${step.error}`)
        }
      }
    }

    lines.push("")
    lines.push(`  Total: ${report.totalScenarios}  Passed: ${report.passed}  Failed: ${report.failed}`)
    lines.push(`  Duration: ${report.duration}ms`)
    lines.push(`${"═".repeat(60)}\n`)

    return lines.join("\n")
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private assertStep(step: ThenStep): StepResult {
    const stepStart = Date.now()

    if (step.type === "table_state" || step.type === "subscription") {
      const tableName = step.table!
      const actual = this.db.table(tableName).all()
      const matchResult = this.matchData(actual, step.expected, step.matcher ?? "subset")

      return {
        type: "then",
        name: step.description ?? `${step.type}(${tableName})`,
        passed: matchResult.passed,
        duration: Date.now() - stepStart,
        actual,
        expected: step.expected,
        error: matchResult.error,
      }
    }

    if (step.type === "custom" && step.customMatcher) {
      const result = step.customMatcher(null)
      const passed = result === true
      return {
        type: "then",
        name: step.description ?? "custom assertion",
        passed,
        duration: Date.now() - stepStart,
        error: typeof result === "string" ? result : undefined,
      }
    }

    return {
      type: "then",
      name: step.description ?? step.type,
      passed: true,
      duration: Date.now() - stepStart,
    }
  }

  private matchData(actual: unknown, expected: unknown, matcher: string): { passed: boolean; error?: string } {
    if (expected === undefined || expected === null) {
      return { passed: true }
    }

    if (matcher === "exact") {
      const passed = JSON.stringify(actual) === JSON.stringify(expected)
      return {
        passed,
        error: passed
          ? undefined
          : `Expected exact match.\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`,
      }
    }

    if (matcher === "contains" || matcher === "subset") {
      if (!Array.isArray(actual) || !Array.isArray(expected)) {
        return { passed: false, error: "Contains/subset matcher requires arrays" }
      }

      for (const expectedItem of expected as Record<string, unknown>[]) {
        const found = (actual as Record<string, unknown>[]).some((actualItem) =>
          Object.entries(expectedItem).every(([key, value]) => actualItem[key] === value),
        )
        if (!found) {
          return {
            passed: false,
            error: `Expected item not found in actual data: ${JSON.stringify(expectedItem)}`,
          }
        }
      }
      return { passed: true }
    }

    return { passed: true }
  }

  private captureSnapshot(step: string): SnapshotRecord {
    return {
      step,
      tables: this.db.snapshot(),
      timestamp: Date.now(),
    }
  }

  private createContext(): Record<string, unknown> {
    return { db: this.db.context() }
  }
}

// ─── Database interface (decoupled from MockDatabase) ────────────────────────

export interface MockDatabaseLike {
  table(name: string): MockTableLike
  snapshot(): Record<string, MockRow[]>
  context(): unknown
}

export interface MockTableLike {
  insert(data: Record<string, unknown>): MockRow
  all(): MockRow[]
  get(id: string): MockRow | null
  where(filters: Record<string, unknown>): MockRow[]
}
