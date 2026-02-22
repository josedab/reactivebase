import { describe, it, expect } from "vitest"
import { CloudClient, PLANS, REGIONS, generateDeployCommand, estimateMonthlyCost } from "../cloud/cloud.js"

describe("PLANS", () => {
  it("defines free, pro, team, and enterprise plans", () => {
    expect(Object.keys(PLANS)).toEqual(["free", "pro", "team", "enterprise"])
  })

  it("free plan has correct limits", () => {
    expect(PLANS.free.price).toBe(0)
    expect(PLANS.free.limits.projects).toBe(1)
    expect(PLANS.free.limits.subscriptions).toBe(1_000)
  })

  it("pro plan has higher limits", () => {
    expect(PLANS.pro.price).toBe(29)
    expect(PLANS.pro.limits.subscriptions).toBe(50_000)
  })

  it("enterprise has custom pricing", () => {
    expect(PLANS.enterprise.price).toBe(-1)
  })
})

describe("REGIONS", () => {
  it("defines multiple regions", () => {
    expect(REGIONS.length).toBeGreaterThanOrEqual(4)
  })

  it("each region has id, name, and provider", () => {
    for (const region of REGIONS) {
      expect(region.id).toBeTruthy()
      expect(region.name).toBeTruthy()
      expect(region.provider).toBeTruthy()
    }
  })

  it("includes us-east-1", () => {
    expect(REGIONS.find((r) => r.id === "us-east-1")).toBeDefined()
  })
})

describe("generateDeployCommand", () => {
  it("returns help text", () => {
    const help = generateDeployCommand()
    expect(help).toContain("reactivebase deploy")
    expect(help).toContain("--cloud")
    expect(help).toContain("--fly")
    expect(help).toContain("REACTIVEBASE_API_KEY")
  })
})

describe("estimateMonthlyCost", () => {
  it("returns free plan for small usage", () => {
    const result = estimateMonthlyCost({
      subscriptions: 500,
      storageGb: 0.5,
      bandwidthGb: 2,
    })
    expect(result.plan).toBe("free")
    expect(result.monthlyCost).toBe(0)
  })

  it("returns pro plan for medium usage", () => {
    const result = estimateMonthlyCost({
      subscriptions: 5_000,
      storageGb: 5,
      bandwidthGb: 50,
    })
    expect(result.plan).toBe("pro")
    expect(result.monthlyCost).toBe(29)
  })

  it("returns team plan for high usage", () => {
    const result = estimateMonthlyCost({
      subscriptions: 100_000,
      storageGb: 50,
      bandwidthGb: 500,
    })
    expect(result.plan).toBe("team")
    expect(result.monthlyCost).toBe(99)
  })

  it("returns enterprise for usage exceeding team limits", () => {
    const result = estimateMonthlyCost({
      subscriptions: 1_000_000,
      storageGb: 500,
      bandwidthGb: 5000,
    })
    expect(result.plan).toBe("enterprise")
    expect(result.monthlyCost).toBe(-1)
  })
})

describe("CloudClient", () => {
  it("can be instantiated with config", () => {
    const client = new CloudClient({
      apiKey: "test-key",
      apiUrl: "https://api.example.com",
    })
    expect(client).toBeDefined()
  })

  it("accepts timeout option", () => {
    const client = new CloudClient({
      apiKey: "test-key",
      timeout: 5000,
    })
    expect(client).toBeDefined()
  })
})
