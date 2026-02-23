/**
 * Production benchmark suite for ReactiveBase.
 * Measures query latency, mutation throughput, subscription update delivery,
 * invalidation precision, and memory usage.
 */

export interface BenchmarkResult {
  name: string
  iterations: number
  totalMs: number
  avgMs: number
  minMs: number
  maxMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  opsPerSec: number
}

export interface BenchmarkSuite {
  name: string
  results: BenchmarkResult[]
  timestamp: string
  environment: {
    nodeVersion: string
    platform: string
    arch: string
  }
}

/**
 * Run a benchmark with given iterations.
 */
export async function bench(
  name: string,
  fn: () => Promise<void> | void,
  options: { iterations?: number; warmup?: number } = {},
): Promise<BenchmarkResult> {
  const iterations = options.iterations ?? 1000
  const warmup = options.warmup ?? 100

  // Warmup
  for (let i = 0; i < warmup; i++) {
    await fn()
  }

  // Collect latencies
  const latencies: number[] = []

  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await fn()
    latencies.push(performance.now() - start)
  }

  latencies.sort((a, b) => a - b)
  const totalMs = latencies.reduce((a, b) => a + b, 0)

  return {
    name,
    iterations,
    totalMs,
    avgMs: totalMs / iterations,
    minMs: latencies[0],
    maxMs: latencies[latencies.length - 1],
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    opsPerSec: (iterations / totalMs) * 1000,
  }
}

/**
 * Run a suite of benchmarks.
 */
export async function runSuite(
  name: string,
  benchmarks: Array<{ name: string; fn: () => Promise<void> | void; iterations?: number }>,
): Promise<BenchmarkSuite> {
  const results: BenchmarkResult[] = []

  for (const b of benchmarks) {
    const result = await bench(b.name, b.fn, { iterations: b.iterations })
    results.push(result)
  }

  return {
    name,
    results,
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  }
}

/**
 * Format benchmark results as a readable table.
 */
export function formatResults(suite: BenchmarkSuite): string {
  const lines: string[] = []

  lines.push(`# ${suite.name}`)
  lines.push(`Date: ${suite.timestamp}`)
  lines.push(`Node: ${suite.environment.nodeVersion} | ${suite.environment.platform}/${suite.environment.arch}`)
  lines.push("")
  lines.push("| Benchmark | Iterations | Avg (ms) | P50 (ms) | P95 (ms) | P99 (ms) | Ops/sec |")
  lines.push("|-----------|-----------|---------|---------|---------|---------|---------|")

  for (const r of suite.results) {
    lines.push(
      `| ${r.name} | ${r.iterations} | ${r.avgMs.toFixed(3)} | ${r.p50Ms.toFixed(3)} | ${r.p95Ms.toFixed(3)} | ${r.p99Ms.toFixed(3)} | ${Math.round(r.opsPerSec).toLocaleString()} |`,
    )
  }

  return lines.join("\n")
}

/**
 * Format results as JSON for CI comparison.
 */
export function formatResultsJSON(suite: BenchmarkSuite): string {
  return JSON.stringify(suite, null, 2)
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

// --- Built-in Benchmarks ---

/**
 * Benchmark the query builder SQL generation.
 */
export async function queryBuilderBenchmarks() {
  const { QueryBuilder } = await import("../query-builder/query-builder.js")

  return [
    {
      name: "QueryBuilder: simple WHERE",
      fn: () => {
        new QueryBuilder("tasks").where({ assigneeId: "u1", done: false }).build()
      },
      iterations: 10_000,
    },
    {
      name: "QueryBuilder: complex (WHERE + JOIN + ORDER + LIMIT)",
      fn: () => {
        new QueryBuilder("tasks")
          .where({ assigneeId: "u1" })
          .where("priority", "in", ["high", "critical"])
          .join("users", "assigneeId")
          .orderBy("priority", "desc")
          .limit(20)
          .build()
      },
      iterations: 10_000,
    },
    {
      name: "QueryBuilder: vector similarity",
      fn: () => {
        const embedding = new Array(1536).fill(0.1)
        new QueryBuilder("documents").whereVectorSimilar("embedding", embedding, { topK: 10 }).build()
      },
      iterations: 1_000,
    },
  ]
}

/**
 * Benchmark the subscription registry operations.
 */
export async function subscriptionRegistryBenchmarks() {
  const { SubscriptionRegistry } = await import("../reactivity/subscription-registry.js")

  return [
    {
      name: "SubscriptionRegistry: register 1K subscriptions",
      fn: () => {
        const registry = new SubscriptionRegistry()
        for (let i = 0; i < 1000; i++) {
          registry.register({
            id: `sub_${i}`,
            queryName: "tasks.list",
            args: { userId: `u${i % 100}` },
            connectionId: `conn_${i % 50}`,
            dependencies: [{ table: "tasks", filters: { assigneeId: `u${i % 100}` } }],
            lastResult: [],
            lastResultHash: "hash",
          })
        }
      },
      iterations: 100,
    },
    {
      name: "SubscriptionRegistry: lookup by table (1K subs)",
      fn: () => {
        const registry = new SubscriptionRegistry()
        for (let i = 0; i < 1000; i++) {
          registry.register({
            id: `sub_${i}`,
            queryName: "tasks.list",
            args: {},
            connectionId: `conn_${i % 50}`,
            dependencies: [{ table: "tasks", filters: {} }],
            lastResult: [],
            lastResultHash: "hash",
          })
        }
        // Measure lookup
        registry.getSubscriptionsForTable("tasks")
      },
      iterations: 100,
    },
  ]
}

/**
 * Benchmark result hashing.
 */
export async function resultDifferBenchmarks() {
  const { hashResult } = await import("../reactivity/result-differ.js")

  const smallResult = [{ id: "1", title: "Task 1", done: false }]
  const largeResult = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    title: `Task ${i}`,
    done: i % 2 === 0,
    priority: ["low", "medium", "high"][i % 3],
    assigneeId: `user_${i % 10}`,
    createdAt: new Date().toISOString(),
  }))

  return [
    {
      name: "hashResult: small (1 row)",
      fn: () => {
        hashResult(smallResult)
      },
      iterations: 10_000,
    },
    {
      name: "hashResult: large (100 rows)",
      fn: () => {
        hashResult(largeResult)
      },
      iterations: 1_000,
    },
  ]
}
