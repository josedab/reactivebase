import { describe, it, expect } from "vitest"
import { StressTestSuite } from "../benchmark/stress-test.js"

describe("StressTestSuite", () => {
  it("runs a basic stress test with small subscription counts", async () => {
    const suite = new StressTestSuite({
      subscriptionLevels: [100, 500],
      writesPerSecond: 50,
      phaseDurationMs: 1000,
      tableCount: 5,
      enableChaos: false,
    })

    const report = await suite.run()
    expect(report.phases).toHaveLength(2)
    expect(report.phases[0].subscriptionCount).toBe(100)
    expect(report.phases[1].subscriptionCount).toBe(500)
    expect(report.phases[0].invalidationsPerSecond).toBeGreaterThan(0)
    expect(report.phases[0].avgLatencyMs).toBeGreaterThanOrEqual(0)
    expect(report.phases[0].p99LatencyMs).toBeGreaterThanOrEqual(0)
  })

  it("runs chaos tests", async () => {
    const suite = new StressTestSuite({
      subscriptionLevels: [200],
      writesPerSecond: 20,
      phaseDurationMs: 500,
      enableChaos: true,
    })

    const report = await suite.run()
    expect(report.chaos.length).toBeGreaterThan(0)
    expect(report.chaos[0].scenario).toBe("connection-drop")
    expect(report.summary.chaosTestsTotal).toBe(3)
  })

  it("generates a markdown report", async () => {
    const suite = new StressTestSuite({
      subscriptionLevels: [100],
      phaseDurationMs: 500,
      enableChaos: false,
    })

    const report = await suite.run()
    const markdown = suite.formatReport(report)

    expect(markdown).toContain("# ReactiveBase Stress Test Report")
    expect(markdown).toContain("Subscription Load Test")
    expect(markdown).toContain("Summary")
    expect(markdown).toContain("100")
  })

  it("generates a JSON report", async () => {
    const suite = new StressTestSuite({
      subscriptionLevels: [100],
      phaseDurationMs: 500,
      enableChaos: false,
    })

    const report = await suite.run()
    const json = suite.formatReportJSON(report)
    const parsed = JSON.parse(json)
    expect(parsed.phases).toHaveLength(1)
    expect(parsed.summary).toBeDefined()
  })

  it("detects threshold violations", async () => {
    const suite = new StressTestSuite({
      subscriptionLevels: [5000],
      phaseDurationMs: 500,
      enableChaos: false,
      thresholds: { maxP99LatencyMs: 0.00001, maxFalseInvalidationRate: 0 },
    })

    const report = await suite.run()
    // At least one threshold should be violated with impossibly tight limits
    expect(report.failures.length).toBeGreaterThan(0)
  })

  it("tracks memory usage", async () => {
    const suite = new StressTestSuite({
      subscriptionLevels: [1000],
      phaseDurationMs: 500,
      enableChaos: false,
    })

    const report = await suite.run()
    expect(report.phases[0].memoryUsageMb).toBeGreaterThan(0)
    expect(report.summary.peakMemoryMb).toBeGreaterThan(0)
  })
})
