import { describe, it, expect } from "vitest"
import {
  CircuitBreaker,
  LatencyTracker,
  AdaptivePoolScaler,
  ReadReplicaRouter,
  ConnectionHealthMonitor,
} from "../connection-health/connection-health.js"

describe("CircuitBreaker", () => {
  it("starts in closed state", () => {
    const breaker = new CircuitBreaker(3, 30_000, 2)
    expect(breaker.getState()).toBe("closed")
    expect(breaker.isAllowed()).toBe(true)
  })

  it("opens after threshold failures", () => {
    const breaker = new CircuitBreaker(3, 30_000, 2)

    breaker.recordFailure()
    breaker.recordFailure()
    expect(breaker.getState()).toBe("closed")

    breaker.recordFailure()
    expect(breaker.getState()).toBe("open")
    expect(breaker.isAllowed()).toBe(false)
  })

  it("recovers through half-open on success", () => {
    const breaker = new CircuitBreaker(1, 0, 3) // 0ms open duration for testing

    breaker.recordFailure()
    expect(breaker.getState()).toBe("open")

    // After open duration passes (0ms), should transition to half-open
    expect(breaker.isAllowed()).toBe(true)
    expect(breaker.getState()).toBe("half-open")

    breaker.recordSuccess()
    expect(breaker.getState()).toBe("closed")
  })

  it("resets cleanly", () => {
    const breaker = new CircuitBreaker(1, 30_000, 2)
    breaker.recordFailure()
    expect(breaker.getState()).toBe("open")

    breaker.reset()
    expect(breaker.getState()).toBe("closed")
    expect(breaker.isAllowed()).toBe(true)
  })
})

describe("LatencyTracker", () => {
  it("tracks average latency", () => {
    const tracker = new LatencyTracker(10)
    tracker.record(10)
    tracker.record(20)
    tracker.record(30)

    expect(tracker.getAverage()).toBe(20)
    expect(tracker.getLatest()).toBe(30)
  })

  it("calculates p95", () => {
    const tracker = new LatencyTracker(100)
    for (let i = 1; i <= 100; i++) {
      tracker.record(i)
    }
    expect(tracker.getP95()).toBe(95)
  })

  it("slides window when exceeding size", () => {
    const tracker = new LatencyTracker(3)
    tracker.record(100)
    tracker.record(200)
    tracker.record(300)
    tracker.record(10)

    expect(tracker.getSampleCount()).toBe(3)
    expect(tracker.getAverage()).toBeCloseTo(170)
  })
})

describe("AdaptivePoolScaler", () => {
  it("recommends scale-up when utilization is high", () => {
    const scaler = new AdaptivePoolScaler(2, 50, 0.8, 0.3)
    const decision = scaler.evaluate("db1", 9, 10)

    expect(decision.recommendedSize).toBe(15)
    expect(decision.reason).toContain("scale-up")
  })

  it("recommends scale-down when utilization is low", () => {
    const scaler = new AdaptivePoolScaler(2, 50, 0.8, 0.3)
    const decision = scaler.evaluate("db1", 1, 20)

    expect(decision.recommendedSize).toBe(14)
    expect(decision.reason).toContain("scale-down")
  })

  it("respects min/max bounds", () => {
    const scaler = new AdaptivePoolScaler(5, 10, 0.8, 0.3)

    const scaleUp = scaler.evaluate("db1", 9, 10)
    expect(scaleUp.recommendedSize).toBeLessThanOrEqual(10)

    const scaleDown = scaler.evaluate("db1", 0, 5)
    expect(scaleDown.recommendedSize).toBeGreaterThanOrEqual(5)
  })
})

describe("ReadReplicaRouter", () => {
  it("routes reads to lowest-latency replica", () => {
    const router = new ReadReplicaRouter()
    router.addEndpoint({ id: "primary", connectionString: "pg://primary", role: "primary" })
    router.addEndpoint({ id: "replica1", connectionString: "pg://replica1", role: "replica", region: "us-east" })
    router.addEndpoint({ id: "replica2", connectionString: "pg://replica2", role: "replica", region: "eu-west" })

    router.updateStats("replica1", {
      endpointId: "replica1",
      latencyMs: 50,
      avgLatencyMs: 50,
      p95LatencyMs: 80,
      queryCount: 100,
      errorCount: 0,
      circuitState: "closed",
      lastChecked: new Date(),
      poolSize: 10,
      activeConnections: 5,
    })
    router.updateStats("replica2", {
      endpointId: "replica2",
      latencyMs: 10,
      avgLatencyMs: 10,
      p95LatencyMs: 20,
      queryCount: 100,
      errorCount: 0,
      circuitState: "closed",
      lastChecked: new Date(),
      poolSize: 10,
      activeConnections: 5,
    })

    const endpoint = router.routeRead()
    expect(endpoint?.id).toBe("replica2")
  })

  it("falls back to primary when replicas are unhealthy", () => {
    const router = new ReadReplicaRouter()
    router.addEndpoint({ id: "primary", connectionString: "pg://primary", role: "primary" })
    router.addEndpoint({ id: "replica1", connectionString: "pg://replica1", role: "replica" })

    router.updateStats("replica1", {
      endpointId: "replica1",
      latencyMs: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      queryCount: 0,
      errorCount: 10,
      circuitState: "open",
      lastChecked: new Date(),
      poolSize: 10,
      activeConnections: 0,
    })

    const endpoint = router.routeRead()
    expect(endpoint?.id).toBe("primary")
  })

  it("routes writes to primary", () => {
    const router = new ReadReplicaRouter()
    router.addEndpoint({ id: "primary", connectionString: "pg://primary", role: "primary" })
    router.addEndpoint({ id: "replica1", connectionString: "pg://replica1", role: "replica" })

    const endpoint = router.routeWrite()
    expect(endpoint?.id).toBe("primary")
  })
})

describe("ConnectionHealthMonitor", () => {
  it("tracks endpoint health", () => {
    const monitor = new ConnectionHealthMonitor()
    monitor.addEndpoint({ id: "db1", connectionString: "pg://db1", role: "primary" })

    monitor.recordQuery("db1", 15, true)
    monitor.recordQuery("db1", 20, true)

    const stats = monitor.getEndpointStats("db1")
    expect(stats).toBeDefined()
    expect(stats!.avgLatencyMs).toBeGreaterThan(0)
    expect(stats!.circuitState).toBe("closed")
  })

  it("emits alerts when circuit opens", () => {
    const alerts: string[] = []
    const monitor = new ConnectionHealthMonitor({ errorThreshold: 2 })
    monitor.addEndpoint({ id: "db1", connectionString: "pg://db1", role: "primary" })
    monitor.onAlert((alert) => alerts.push(alert.type))

    monitor.recordQuery("db1", 100, false)
    monitor.recordQuery("db1", 100, false)

    expect(alerts).toContain("circuit_opened")
  })
})
