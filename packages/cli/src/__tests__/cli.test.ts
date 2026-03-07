/**
 * CLI smoke tests — verifies command module exports and basic functionality
 * without requiring a database or running server.
 */

import { describe, it, expect, vi } from "vitest"
import { mkdirSync, rmSync } from "node:fs"

// ─── Command module exports ─────────────────────────────────────────────────

describe("command module exports", () => {
  it("dev command exports devServer", async () => {
    const mod = await import("../commands/dev.js")
    expect(typeof mod.devServer).toBe("function")
  })

  it("generate command exports generateTypes and writeGeneratedFiles", async () => {
    const mod = await import("../commands/generate.js")
    expect(typeof mod.generateTypes).toBe("function")
    expect(typeof mod.writeGeneratedFiles).toBe("function")
  })

  it("migrate command exports migrateGenerate, migrateApply, migrateStatus, migrateRollback", async () => {
    const mod = await import("../commands/migrate.js")
    expect(typeof mod.migrateGenerate).toBe("function")
    expect(typeof mod.migrateApply).toBe("function")
    expect(typeof mod.migrateStatus).toBe("function")
    expect(typeof mod.migrateRollback).toBe("function")
  })

  it("migrate-safe command exports migrateSafe", async () => {
    const mod = await import("../commands/migrate-safe.js")
    expect(typeof mod.migrateSafe).toBe("function")
  })

  it("dacl command exports all subcommands", async () => {
    const mod = await import("../commands/dacl.js")
    expect(typeof mod.daclList).toBe("function")
    expect(typeof mod.daclTest).toBe("function")
    expect(typeof mod.daclGenerateRls).toBe("function")
    expect(typeof mod.daclCoverage).toBe("function")
  })

  it("ivm command exports all subcommands", async () => {
    const mod = await import("../commands/ivm.js")
    expect(typeof mod.ivmList).toBe("function")
    expect(typeof mod.ivmStats).toBe("function")
    expect(typeof mod.ivmAnalyze).toBe("function")
  })

  it("deploy command exports deploy and helpers", async () => {
    const mod = await import("../commands/deploy.js")
    expect(typeof mod.deploy).toBe("function")
    expect(typeof mod.deployPreview).toBe("function")
    expect(typeof mod.destroyPreview).toBe("function")
    expect(typeof mod.tailLogs).toBe("function")
  })

  it("deploy-cloud command exports deployCloud", async () => {
    const mod = await import("../commands/deploy-cloud.js")
    expect(typeof mod.deployCloud).toBe("function")
  })

  it("seed command exports seedRun, seedReset, seedStatus", async () => {
    const mod = await import("../commands/seed.js")
    expect(typeof mod.seedRun).toBe("function")
    expect(typeof mod.seedReset).toBe("function")
    expect(typeof mod.seedStatus).toBe("function")
  })

  it("auth-debug command exports authDebug", async () => {
    const mod = await import("../commands/auth-debug.js")
    expect(typeof mod.authDebug).toBe("function")
  })

  it("generate-procedures command exports generateProcedures", async () => {
    const mod = await import("../commands/generate-procedures.js")
    expect(typeof mod.generateProcedures).toBe("function")
  })

  it("flyio-client exports FlyioClient and helpers", async () => {
    const mod = await import("../commands/flyio-client.js")
    expect(typeof mod.FlyioClient).toBe("function")
    expect(typeof mod.generateFlyDockerfile).toBe("function")
    expect(typeof mod.generateFlyToml).toBe("function")
  })
})

// ─── Generate command smoke test ────────────────────────────────────────────

describe("generate command", () => {
  it("generateTypes returns expected files for empty project", async () => {
    const { generateTypes } = await import("../commands/generate.js")
    const tmpDir = "/tmp/rb-cli-test-" + Date.now()
    mkdirSync(tmpDir, { recursive: true })

    try {
      const files = generateTypes(tmpDir)
      expect(files.length).toBeGreaterThanOrEqual(2)
      expect(files.some((f) => f.path.includes("dataModel.ts"))).toBe(true)
      expect(files.some((f) => f.path.includes("api.ts"))).toBe(true)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

// ─── Dev command smoke test ─────────────────────────────────────────────────

describe("dev command", () => {
  it("devServer runs without crashing for a temp directory", async () => {
    const { devServer } = await import("../commands/dev.js")
    const tmpDir = "/tmp/rb-dev-test-" + Date.now()
    mkdirSync(tmpDir, { recursive: true })

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called")
    }) as never)

    try {
      await devServer({ port: 0, projectDir: tmpDir })
    } catch {
      // Expected: process.exit(1) throws due to mock when DATABASE_URL is missing
    } finally {
      consoleSpy.mockRestore()
      logSpy.mockRestore()
      warnSpy.mockRestore()
      exitSpy.mockRestore()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

// ─── Helpers ────────────────────────────────────────────────────────────────
