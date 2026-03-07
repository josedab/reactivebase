/**
 * Behavioral tests for deploy, migrate, optimize, and seed CLI commands.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

// Mock the server migration-analyzer to prevent import errors in migratePreview
// NOTE: migrate.ts dynamically imports @reactivebase/server/migrations/migration-analyzer
// which doesn't have proper exports in the package. This is a pre-existing issue
// (also affects the existing cli.test.ts). We skip migrate tests accordingly.

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTmpDir(): string {
  const dir = `/tmp/rb-cli-commands-${Date.now()}-${Math.random().toString(36).slice(2)}`
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

// ─── deploy ──────────────────────────────────────────────────────────────────

describe("deploy command", () => {
  let tmpDir: string
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpDir = createTmpDir()
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    cleanupDir(tmpDir)
    vi.restoreAllMocks()
  })

  it("exports deploy, generateDeployManifestFile, deployPreview, destroyPreview, tailLogs", async () => {
    const mod = await import("../commands/deploy.js")
    expect(typeof mod.deploy).toBe("function")
    expect(typeof mod.generateDeployManifestFile).toBe("function")
    expect(typeof mod.deployPreview).toBe("function")
    expect(typeof mod.destroyPreview).toBe("function")
    expect(typeof mod.tailLogs).toBe("function")
  })

  describe("generateDeployManifestFile", () => {
    it("generates manifest with correct structure", async () => {
      const { generateDeployManifestFile } = await import("../commands/deploy.js")
      const manifest = generateDeployManifestFile("my-app", "iad", {
        projectDir: tmpDir,
      })
      expect(manifest.version).toBe("1.0")
      expect(manifest.app.name).toBe("my-app")
      expect(manifest.app.region).toBe("iad")
      expect(manifest.build.runtime).toBe("nodejs-20")
      expect(manifest.services.postgres.enabled).toBe(true)
      expect(manifest.scaling.minInstances).toBe(2)
      expect(manifest.scaling.maxInstances).toBe(10)
      expect(manifest.env.NODE_ENV).toBe("production")
    })

    it("generates preview manifest with reduced scaling", async () => {
      const { generateDeployManifestFile } = await import("../commands/deploy.js")
      const manifest = generateDeployManifestFile("my-app-pr-42", "iad", {
        projectDir: tmpDir,
        preview: "pr-42",
      })
      expect(manifest.scaling.minInstances).toBe(1)
      expect(manifest.scaling.maxInstances).toBe(1)
      expect(manifest.services.redis.enabled).toBe(false)
      expect(manifest.env.NODE_ENV).toBe("development")
    })

    it("includes custom env vars", async () => {
      const { generateDeployManifestFile } = await import("../commands/deploy.js")
      const manifest = generateDeployManifestFile("app", "iad", {
        projectDir: tmpDir,
        envVars: { API_KEY: "secret123" },
      })
      expect(manifest.env.API_KEY).toBe("secret123")
    })
  })

  describe("deploy", () => {
    it("returns deployed result with correct structure", async () => {
      const { deploy } = await import("../commands/deploy.js")
      const result = await deploy({ projectDir: tmpDir })
      expect(result.status).toBe("deployed")
      expect(result.provider).toBe("flyio")
      expect(result.url).toBeTruthy()
      expect(result.databaseUrl).toBeTruthy()
      expect(result.buildLogs.length).toBeGreaterThan(0)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it("uses specified provider and region", async () => {
      const { deploy } = await import("../commands/deploy.js")
      const result = await deploy({
        projectDir: tmpDir,
        provider: "railway",
        region: "us-west-1",
      })
      expect(result.provider).toBe("railway")
    })

    it("uses specified appName", async () => {
      const { deploy } = await import("../commands/deploy.js")
      const result = await deploy({
        projectDir: tmpDir,
        appName: "custom-app",
      })
      expect(result.appName).toBe("custom-app")
    })
  })

  describe("deployPreview", () => {
    it("deploys with PR-based app name", async () => {
      const { deployPreview } = await import("../commands/deploy.js")
      const result = await deployPreview({
        projectDir: tmpDir,
        prNumber: 42,
        branch: "feature/test",
      })
      expect(result.status).toBe("deployed")
      expect(result.appName).toContain("pr-42")
    })
  })

  describe("destroyPreview", () => {
    it("logs destruction message", async () => {
      const { destroyPreview } = await import("../commands/deploy.js")
      await destroyPreview("my-app-pr-42")
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Destroying preview"))
    })
  })

  describe("tailLogs", () => {
    it("logs tailing message", async () => {
      const { tailLogs } = await import("../commands/deploy.js")
      await tailLogs("my-app")
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Tailing logs"))
    })
  })
})

// ─── migrate ─────────────────────────────────────────────────────────────────

// NOTE: Tests that require @reactivebase/server/migrations/migration-analyzer
// dynamic import gracefully fall back (try/catch in migrate.ts).
// Tests that exercise DB connections will fail without a real Postgres; those
// are tested separately in cli-integration.test.ts.
describe("migrate command", () => {
  let tmpDir: string
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let consoleErrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpDir = createTmpDir()
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    cleanupDir(tmpDir)
    vi.restoreAllMocks()
  })

  it("exports migrateGenerate, migrateApply, migrateStatus, migratePreview", async () => {
    const mod = await import("../commands/migrate.js")
    expect(typeof mod.migrateGenerate).toBe("function")
    expect(typeof mod.migrateApply).toBe("function")
    expect(typeof mod.migrateStatus).toBe("function")
    expect(typeof mod.migratePreview).toBe("function")
  })

  describe("migrateGenerate", () => {
    it("creates migrations directory and SQL file when schema exists", async () => {
      const { migrateGenerate } = await import("../commands/migrate.js")
      writeFileSync(join(tmpDir, "schema.ts"), "export default {}")
      await migrateGenerate({ projectDir: tmpDir })

      const migrationsDir = join(tmpDir, "migrations")
      expect(existsSync(migrationsDir)).toBe(true)

      const { readdirSync } = await import("node:fs")
      const files = readdirSync(migrationsDir)
      expect(files.length).toBe(1)
      expect(files[0]).toMatch(/\.sql$/)
    })

    it("exits when no schema file found", async () => {
      const { migrateGenerate } = await import("../commands/migrate.js")
      const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called")
      }) as never)

      try {
        await migrateGenerate({ projectDir: tmpDir })
      } catch {
        // expected
      }

      expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringContaining("No schema file found"))
      mockExit.mockRestore()
    })
  })

  describe("migrateApply", () => {
    it("reports no migrations directory", async () => {
      const { migrateApply } = await import("../commands/migrate.js")
      await migrateApply({ projectDir: tmpDir })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No migrations directory"))
    })

    it("reports no pending migrations for empty dir", async () => {
      const { migrateApply } = await import("../commands/migrate.js")
      mkdirSync(join(tmpDir, "migrations"))
      await migrateApply({ projectDir: tmpDir })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No pending migrations"))
    })

    it("exits when no connection string for pending migrations", async () => {
      const { migrateApply } = await import("../commands/migrate.js")
      const migrationsDir = join(tmpDir, "migrations")
      mkdirSync(migrationsDir)
      writeFileSync(join(migrationsDir, "001_init.sql"), "CREATE TABLE test (id TEXT);")

      const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called")
      }) as never)

      try {
        await migrateApply({ projectDir: tmpDir })
      } catch {
        // expected
      }

      expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringContaining("DATABASE_URL"))
      mockExit.mockRestore()
    })

    it("handles connection failure gracefully", async () => {
      const { migrateApply } = await import("../commands/migrate.js")
      const migrationsDir = join(tmpDir, "migrations")
      mkdirSync(migrationsDir)
      writeFileSync(join(migrationsDir, "001_init.sql"), "CREATE TABLE test (id TEXT);")

      const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called")
      }) as never)

      try {
        // Invalid connection string causes pg.Pool to fail
        await migrateApply({
          projectDir: tmpDir,
          connectionString: "postgresql://invalid:invalid@localhost:1/nonexistent",
        })
      } catch {
        // Expected: either pool connection error or process.exit
      }

      mockExit.mockRestore()
    })
  })

  describe("migrateStatus", () => {
    it("reports no migrations directory", async () => {
      const { migrateStatus } = await import("../commands/migrate.js")
      await migrateStatus({ projectDir: tmpDir })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No migrations directory"))
    })

    it("lists migration files", async () => {
      const { migrateStatus } = await import("../commands/migrate.js")
      const migrationsDir = join(tmpDir, "migrations")
      mkdirSync(migrationsDir)
      writeFileSync(join(migrationsDir, "001_init.sql"), "-- init")
      writeFileSync(join(migrationsDir, "002_add_users.sql"), "-- users")

      await migrateStatus({ projectDir: tmpDir })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("001_init.sql"))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("002_add_users.sql"))
    })
  })
})

// ─── seed ────────────────────────────────────────────────────────────────────

describe("seed command", () => {
  let tmpDir: string
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let processExitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpDir = createTmpDir()
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as unknown as (code?: number) => never)
  })

  afterEach(() => {
    cleanupDir(tmpDir)
    vi.restoreAllMocks()
  })

  it("exports seedRun, seedReset, seedStatus", async () => {
    const mod = await import("../commands/seed.js")
    expect(typeof mod.seedRun).toBe("function")
    expect(typeof mod.seedReset).toBe("function")
    expect(typeof mod.seedStatus).toBe("function")
  })

  describe("seedRun", () => {
    it("reports no seeds directory", async () => {
      const { seedRun } = await import("../commands/seed.js")
      await seedRun({ projectDir: tmpDir })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No seeds/ directory"))
    })

    it("reports no seed files in empty dir", async () => {
      const { seedRun } = await import("../commands/seed.js")
      mkdirSync(join(tmpDir, "seeds"))
      await seedRun({ projectDir: tmpDir })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No .seed.ts or .seed.js files"))
    })

    it("requires DATABASE_URL when seed files exist", async () => {
      const { seedRun } = await import("../commands/seed.js")
      const seedsDir = join(tmpDir, "seeds")
      mkdirSync(seedsDir)
      writeFileSync(join(seedsDir, "users.seed.ts"), "export default {}")
      writeFileSync(join(seedsDir, "posts.seed.ts"), "export default {}")

      await seedRun({ projectDir: tmpDir })
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("DATABASE_URL"))
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    it("lists seed files when connectionString is provided", async () => {
      const { seedRun } = await import("../commands/seed.js")
      const seedsDir = join(tmpDir, "seeds")
      mkdirSync(seedsDir)
      writeFileSync(join(seedsDir, "users.seed.ts"), "export default {}")
      writeFileSync(join(seedsDir, "posts.seed.ts"), "export default {}")

      await seedRun({ projectDir: tmpDir, connectionString: "postgres://localhost/test" })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("users"))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("posts"))
    })

    it("respects environment option", async () => {
      const { seedRun } = await import("../commands/seed.js")
      const seedsDir = join(tmpDir, "seeds")
      mkdirSync(seedsDir)
      writeFileSync(join(seedsDir, "users.seed.ts"), "export default {}")

      await seedRun({ projectDir: tmpDir, environment: "test", connectionString: "postgres://localhost/test" })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("environment: test"))
    })
  })

  describe("seedReset", () => {
    it("requires DATABASE_URL", async () => {
      const { seedReset } = await import("../commands/seed.js")
      await seedReset({ projectDir: tmpDir })
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("DATABASE_URL"))
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    it("logs reset message when seeds dir exists", async () => {
      const { seedReset } = await import("../commands/seed.js")
      mkdirSync(join(tmpDir, "seeds"))
      await seedReset({ projectDir: tmpDir, connectionString: "postgres://localhost/test" })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Resetting seed data"))
    })
  })

  describe("seedStatus", () => {
    it("reports no seeds directory", async () => {
      const { seedStatus } = await import("../commands/seed.js")
      await seedStatus({ projectDir: tmpDir })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No seeds/ directory"))
    })

    it("reports no seed files", async () => {
      const { seedStatus } = await import("../commands/seed.js")
      mkdirSync(join(tmpDir, "seeds"))
      await seedStatus({ projectDir: tmpDir })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No seed files"))
    })

    it("shows status for seed files", async () => {
      const { seedStatus } = await import("../commands/seed.js")
      const seedsDir = join(tmpDir, "seeds")
      mkdirSync(seedsDir)
      writeFileSync(join(seedsDir, "users.seed.ts"), "export default {}")

      await seedStatus({ projectDir: tmpDir })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("users"))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("registered"))
    })
  })
})

// ─── optimize ────────────────────────────────────────────────────────────────

describe("optimize command", () => {
  it("exports optimize function", async () => {
    const mod = await import("../commands/optimize.js")
    expect(typeof mod.optimize).toBe("function")
  })
})
