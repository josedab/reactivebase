import { describe, it, expect } from "vitest"
import { CloudClient, PLANS, generateDeployCommand } from "../cloud/cloud.js"

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

describe("generateDeployCommand", () => {
  it("returns help text", () => {
    const help = generateDeployCommand()
    expect(help).toContain("reactivebase deploy")
    expect(help).toContain("--cloud")
    expect(help).toContain("--fly")
    expect(help).toContain("REACTIVEBASE_API_KEY")
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
})
