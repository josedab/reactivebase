import { describe, it, expect } from "vitest"
import { bench, runSuite, formatResults } from "../benchmark/benchmark.js"

describe("bench", () => {
  it("measures function execution time", async () => {
    const result = await bench("noop", () => {}, { iterations: 100, warmup: 10 })

    expect(result.name).toBe("noop")
    expect(result.iterations).toBe(100)
    expect(result.avgMs).toBeGreaterThanOrEqual(0)
    expect(result.p50Ms).toBeLessThanOrEqual(result.p99Ms)
    expect(result.opsPerSec).toBeGreaterThan(0)
  })

  it("measures async functions", async () => {
    const result = await bench(
      "async-noop",
      async () => {
        await Promise.resolve()
      },
      { iterations: 50, warmup: 5 },
    )

    expect(result.iterations).toBe(50)
    expect(result.avgMs).toBeGreaterThanOrEqual(0)
  })

  it("captures min/max latencies", async () => {
    const result = await bench(
      "variable",
      () => {
        // Do some work to create variance
        let sum = 0
        for (let i = 0; i < 100; i++) sum += i
      },
      { iterations: 100, warmup: 10 },
    )

    expect(result.minMs).toBeLessThanOrEqual(result.maxMs)
    expect(result.p50Ms).toBeLessThanOrEqual(result.p95Ms)
  })
})

describe("runSuite", () => {
  it("runs multiple benchmarks", async () => {
    const suite = await runSuite("test-suite", [
      { name: "fast", fn: () => {}, iterations: 50 },
      {
        name: "slower",
        fn: () => {
          let s = 0
          for (let i = 0; i < 1000; i++) s += i
        },
        iterations: 50,
      },
    ])

    expect(suite.name).toBe("test-suite")
    expect(suite.results).toHaveLength(2)
    expect(suite.environment.nodeVersion).toBeDefined()
    expect(suite.timestamp).toBeDefined()
  })
})

describe("formatResults", () => {
  it("formats as markdown table", async () => {
    const suite = await runSuite("format-test", [{ name: "test-bench", fn: () => {}, iterations: 10 }])

    const output = formatResults(suite)

    expect(output).toContain("# format-test")
    expect(output).toContain("test-bench")
    expect(output).toContain("Ops/sec")
    expect(output).toContain("|")
  })
})
