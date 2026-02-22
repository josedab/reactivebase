import { describe, it, expect } from "vitest"
import {
  computePluginQualityScore,
  checkPluginCompatibility,
  generatePluginTemplate,
  resendPlugin,
  sentryPlugin,
  vercelPlugin,
  FIRST_PARTY_PLUGINS,
} from "../plugins/first-party-plugins.js"
import { PluginMarketplace } from "../plugins/marketplace.js"

describe("computePluginQualityScore", () => {
  it("scores a well-maintained first-party plugin highly", () => {
    const score = computePluginQualityScore({
      hasTests: true,
      testCount: 50,
      hasReadme: true,
      hasChangelog: true,
      hasTypeDefinitions: true,
      hasExamples: true,
      downloadCount: 100_000,
      lastPublishedDaysAgo: 7,
      openIssues: 2,
      closedIssues: 30,
      dependencies: 1,
      hasCICD: true,
      isVerified: true,
      isFirstParty: true,
    })

    expect(score.overall).toBeGreaterThanOrEqual(8)
    expect(score.badges).toContain("first-party")
    expect(score.badges).toContain("verified")
    expect(score.badges).toContain("well-documented")
    expect(score.warnings).toHaveLength(0)
  })

  it("scores a poorly maintained plugin low with warnings", () => {
    const score = computePluginQualityScore({
      hasTests: false,
      testCount: 0,
      hasReadme: false,
      hasChangelog: false,
      hasTypeDefinitions: false,
      hasExamples: false,
      downloadCount: 5,
      lastPublishedDaysAgo: 365,
      openIssues: 100,
      closedIssues: 2,
      dependencies: 20,
      hasCICD: false,
      isVerified: false,
      isFirstParty: false,
    })

    expect(score.overall).toBeLessThan(3)
    expect(score.warnings.length).toBeGreaterThan(0)
    expect(score.warnings).toContain("No tests found")
    expect(score.warnings).toContain("Missing README")
  })

  it("awards badges based on thresholds", () => {
    const score = computePluginQualityScore({
      hasTests: true,
      testCount: 30,
      hasReadme: true,
      hasChangelog: true,
      hasTypeDefinitions: true,
      hasExamples: true,
      downloadCount: 50_000,
      lastPublishedDaysAgo: 14,
      openIssues: 5,
      closedIssues: 50,
      dependencies: 3,
      hasCICD: true,
      isVerified: true,
      isFirstParty: false,
    })

    expect(score.badges).toContain("actively-maintained")
    expect(score.badges).toContain("well-documented")
    expect(score.badges).toContain("verified")
  })
})

describe("checkPluginCompatibility", () => {
  it("returns compatible when no version requirement", () => {
    const result = checkPluginCompatibility("test", "1.0.0", undefined, "0.1.0")
    expect(result.compatible).toBe(true)
  })

  it("checks caret ranges", () => {
    const compatible = checkPluginCompatibility("test", "1.0.0", "^0.1.0", "0.1.5")
    expect(compatible.compatible).toBe(true)

    const incompatible = checkPluginCompatibility("test", "1.0.0", "^0.2.0", "0.1.0")
    expect(incompatible.compatible).toBe(false)
  })

  it("checks >= ranges", () => {
    const result = checkPluginCompatibility("test", "1.0.0", ">=0.1.0", "0.2.0")
    expect(result.compatible).toBe(true)
  })

  it("provides reason for incompatibility", () => {
    const result = checkPluginCompatibility("my-plugin", "1.0.0", "^0.2.0", "0.1.0")
    expect(result.compatible).toBe(false)
    expect(result.reason).toContain("Requires")
  })
})

describe("First-party plugins", () => {
  it("exports all expected plugins", () => {
    expect(FIRST_PARTY_PLUGINS.resend).toBeDefined()
    expect(FIRST_PARTY_PLUGINS.sentry).toBeDefined()
    expect(FIRST_PARTY_PLUGINS.vercel).toBeDefined()
  })

  it("resend plugin has correct config schema", () => {
    expect(resendPlugin.configSchema?.apiKey.required).toBe(true)
    expect(resendPlugin.configSchema?.defaultFrom.default).toBe("noreply@example.com")
  })

  it("sentry plugin includes error middleware", () => {
    expect(sentryPlugin.middleware).toHaveLength(1)
    expect(sentryPlugin.middleware![0].phase).toBe("error")
  })

  it("vercel plugin has deploy function registration", async () => {
    const marketplace = new PluginMarketplace()
    await marketplace.install(vercelPlugin, { token: "test-token" })
    expect(marketplace.isInstalled("vercel")).toBe(true)
  })

  it("installs and starts resend plugin", async () => {
    const marketplace = new PluginMarketplace()
    const instance = await marketplace.install(resendPlugin, { apiKey: "re_test_123" })
    expect(instance.status).toBe("installed")

    await marketplace.start("resend")
    const started = marketplace.getPlugin("resend")
    expect(started?.status).toBe("started")
  })

  it("validates required config", async () => {
    const marketplace = new PluginMarketplace()
    await expect(marketplace.install(resendPlugin, {})).rejects.toThrow("Missing required config: apiKey")
  })
})

describe("generatePluginTemplate", () => {
  it("generates a complete plugin template", () => {
    const template = generatePluginTemplate("webhook-relay", "utilities")

    expect(template.files["src/index.ts"]).toContain("webhook-relay")
    expect(template.files["package.json"]).toContain("@reactivebase/plugin-webhook-relay")
    expect(template.files["src/__tests__/plugin.test.ts"]).toContain("webhook-relay plugin")
    expect(template.files["README.md"]).toContain("Installation")
  })

  it("uses correct category in template", () => {
    const template = generatePluginTemplate("my-auth", "auth")
    expect(template.files["src/index.ts"]).toContain('"auth"')
  })
})
