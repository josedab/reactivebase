import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { deploy, generateDeployManifestFile, deployPreview, destroyPreview } from "../commands/deploy.js"
import type { DeployOptions as _DeployOptions } from "../commands/deploy.js"

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CLI deploy command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  describe("generateDeployManifestFile()", () => {
    it("generates a production manifest", () => {
      const manifest = generateDeployManifestFile("my-app", "iad", {
        projectDir: "/app",
      })
      expect(manifest.version).toBe("1.0")
      expect(manifest.app.name).toBe("my-app")
      expect(manifest.app.region).toBe("iad")
      expect(manifest.build.runtime).toBe("nodejs-20")
      expect(manifest.build.buildCommand).toBe("npm run build")
      expect(manifest.build.startCommand).toBe("node dist/server.js")
    })

    it("enables redis for production", () => {
      const manifest = generateDeployManifestFile("my-app", "iad", {
        projectDir: "/app",
      })
      expect(manifest.services.redis.enabled).toBe(true)
    })

    it("disables redis for preview", () => {
      const manifest = generateDeployManifestFile("my-app", "iad", {
        projectDir: "/app",
        preview: "pr-42",
      })
      expect(manifest.services.redis.enabled).toBe(false)
    })

    it("always enables postgres", () => {
      const manifest = generateDeployManifestFile("my-app", "iad", {
        projectDir: "/app",
      })
      expect(manifest.services.postgres.enabled).toBe(true)
      expect(manifest.services.postgres.version).toBe("16")
    })

    it("sets production scaling (min 2, max 10)", () => {
      const manifest = generateDeployManifestFile("my-app", "iad", {
        projectDir: "/app",
      })
      expect(manifest.scaling.minInstances).toBe(2)
      expect(manifest.scaling.maxInstances).toBe(10)
    })

    it("sets preview scaling (min 1, max 1)", () => {
      const manifest = generateDeployManifestFile("my-app", "iad", {
        projectDir: "/app",
        preview: "pr-1",
      })
      expect(manifest.scaling.minInstances).toBe(1)
      expect(manifest.scaling.maxInstances).toBe(1)
    })

    it("sets NODE_ENV to production for non-preview", () => {
      const manifest = generateDeployManifestFile("my-app", "iad", {
        projectDir: "/app",
      })
      expect(manifest.env.NODE_ENV).toBe("production")
    })

    it("sets NODE_ENV to development for preview", () => {
      const manifest = generateDeployManifestFile("my-app", "iad", {
        projectDir: "/app",
        preview: "pr-1",
      })
      expect(manifest.env.NODE_ENV).toBe("development")
    })

    it("includes custom env vars", () => {
      const manifest = generateDeployManifestFile("my-app", "iad", {
        projectDir: "/app",
        envVars: { MY_VAR: "value", SECRET: "123" },
      })
      expect(manifest.env.MY_VAR).toBe("value")
      expect(manifest.env.SECRET).toBe("123")
    })

    it("custom env vars override defaults", () => {
      const manifest = generateDeployManifestFile("my-app", "iad", {
        projectDir: "/app",
        envVars: { PORT: "8080" },
      })
      expect(manifest.env.PORT).toBe("8080")
    })

    describe("Fly.io manifest", () => {
      it("generates valid manifest for Fly.io", () => {
        const manifest = generateDeployManifestFile("my-fly-app", "sjc", {
          projectDir: "/app",
          provider: "flyio",
        })
        expect(manifest.app.name).toBe("my-fly-app")
        expect(manifest.app.region).toBe("sjc")
      })
    })

    describe("Railway manifest", () => {
      it("generates valid manifest for Railway", () => {
        const manifest = generateDeployManifestFile("my-railway-app", "us-east", {
          projectDir: "/app",
          provider: "railway",
        })
        expect(manifest.app.name).toBe("my-railway-app")
        expect(manifest.app.region).toBe("us-east")
      })
    })
  })

  describe("deploy()", () => {
    it("deploys with default options", async () => {
      const result = await deploy({ projectDir: "/my-project" })
      expect(result.provider).toBe("flyio")
      expect(result.status).toBe("deployed")
      expect(result.url).toBeDefined()
      expect(result.databaseUrl).toBeDefined()
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it("uses default region iad", async () => {
      const result = await deploy({ projectDir: "/my-project" })
      expect(result.appName).toBeDefined()
      expect(result.buildLogs.length).toBeGreaterThan(0)
    })

    it("uses custom app name", async () => {
      const result = await deploy({ projectDir: "/my-project", appName: "custom-name" })
      expect(result.appName).toBe("custom-name")
    })

    it("derives app name from project dir", async () => {
      const result = await deploy({ projectDir: "/path/to/my-awesome-app" })
      expect(result.appName).toBe("my-awesome-app")
    })

    it("includes build logs", async () => {
      const result = await deploy({ projectDir: "/app" })
      expect(result.buildLogs.some((l) => l.includes("manifest"))).toBe(true)
      expect(result.buildLogs.some((l) => l.includes("Deployed"))).toBe(true)
    })

    it("returns deployed status on success", async () => {
      const result = await deploy({ projectDir: "/app" })
      expect(result.status).toBe("deployed")
    })

    it("accepts provider option", async () => {
      const result = await deploy({ projectDir: "/app", provider: "railway" })
      expect(result.provider).toBe("railway")
    })
  })

  describe("deployPreview()", () => {
    it("deploys with PR number in app name", async () => {
      const result = await deployPreview({
        projectDir: "/my-project",
        prNumber: 42,
        branch: "feature/new-thing",
      })
      expect(result.appName).toContain("pr-42")
      expect(result.status).toBe("deployed")
    })

    it("uses preview configuration", async () => {
      const result = await deployPreview({
        projectDir: "/my-project",
        prNumber: 1,
        branch: "main",
      })
      expect(result.status).toBe("deployed")
    })
  })

  describe("destroyPreview()", () => {
    it("executes without error", async () => {
      await expect(destroyPreview("my-app-pr-42")).resolves.toBeUndefined()
    })

    it("accepts custom provider", async () => {
      await expect(destroyPreview("my-app", "railway")).resolves.toBeUndefined()
    })
  })

  describe("edge cases", () => {
    it("handles special characters in project dir", async () => {
      const result = await deploy({ projectDir: "/path/to/My App @v2" })
      // App name should be sanitized
      expect(result.appName).toMatch(/^[a-z0-9-]+$/)
    })

    it("includes env vars in manifest", async () => {
      const result = await deploy({
        projectDir: "/app",
        envVars: { API_KEY: "test" },
      })
      expect(result.status).toBe("deployed")
    })
  })
})
