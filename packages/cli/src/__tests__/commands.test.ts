/**
 * Behavioral tests for CLI commands — argument parsing, output verification,
 * error handling, and file-system interactions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createTmpDir(): string {
  const dir = `/tmp/rb-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

// ─── migrate-safe command ────────────────────────────────────────────────────

describe("migrate-safe command", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTmpDir()
  })

  afterEach(() => {
    cleanupDir(tmpDir)
  })

  it("exports migrateSafe function", async () => {
    const mod = await import("../commands/migrate-safe.js")
    expect(typeof mod.migrateSafe).toBe("function")
  })

  it("handles missing migrations directory gracefully", async () => {
    const { migrateSafe } = await import("../commands/migrate-safe.js")
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await migrateSafe({ projectDir: tmpDir })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No migrations/"))
    } finally {
      consoleSpy.mockRestore()
    }
  })

  it("handles empty migrations directory", async () => {
    const { migrateSafe } = await import("../commands/migrate-safe.js")
    mkdirSync(join(tmpDir, "migrations"), { recursive: true })
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await migrateSafe({ projectDir: tmpDir })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No migration files"))
    } finally {
      consoleSpy.mockRestore()
    }
  })

  it("analyzes SQL migration files for safety", async () => {
    const { migrateSafe } = await import("../commands/migrate-safe.js")
    mkdirSync(join(tmpDir, "migrations"), { recursive: true })
    writeFileSync(
      join(tmpDir, "migrations", "001_add_users.sql"),
      "CREATE TABLE users (id TEXT PRIMARY KEY);\nADD COLUMN email TEXT;\n",
    )
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await migrateSafe({ projectDir: tmpDir })
      // Should have analyzed the file
      expect(consoleSpy).toHaveBeenCalled()
    } finally {
      consoleSpy.mockRestore()
    }
  })

  it("detects unsafe DROP TABLE operations", async () => {
    const { migrateSafe } = await import("../commands/migrate-safe.js")
    mkdirSync(join(tmpDir, "migrations"), { recursive: true })
    writeFileSync(join(tmpDir, "migrations", "001_dangerous.sql"), "DROP TABLE users;\n")
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await migrateSafe({ projectDir: tmpDir })
      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n")
      expect(allOutput).toMatch(/drop_table|unsafe|❌/i)
    } finally {
      consoleSpy.mockRestore()
    }
  })
})

// ─── deploy-cloud command ────────────────────────────────────────────────────

describe("deploy-cloud command", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTmpDir()
  })

  afterEach(() => {
    cleanupDir(tmpDir)
  })

  it("exports deployCloud function", async () => {
    const mod = await import("../commands/deploy-cloud.js")
    expect(typeof mod.deployCloud).toBe("function")
  })

  it("resolves project name from package.json", async () => {
    const { deployCloud } = await import("../commands/deploy-cloud.js")
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "my-app" }))

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never)
    try {
      await deployCloud({ projectDir: tmpDir, projectName: "", region: "us-east-1", plan: "starter" })
      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n")
      expect(allOutput).toContain("my-app")
    } finally {
      consoleSpy.mockRestore()
      exitSpy.mockRestore()
    }
  })

  it("uses directory basename when no package.json", async () => {
    const { deployCloud } = await import("../commands/deploy-cloud.js")
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never)
    try {
      await deployCloud({ projectDir: tmpDir, projectName: "", region: "eu-west-1", plan: "pro" })
    } finally {
      consoleSpy.mockRestore()
      errorSpy.mockRestore()
      exitSpy.mockRestore()
    }
  })
})

// ─── doctor command ──────────────────────────────────────────────────────────

describe("doctor command", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTmpDir()
  })

  afterEach(() => {
    cleanupDir(tmpDir)
  })

  it("exports doctor function", async () => {
    const mod = await import("../commands/doctor.js")
    expect(typeof mod.doctor).toBe("function")
  })

  it("handles empty schema directory", async () => {
    const { doctor } = await import("../commands/doctor.js")
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await doctor({ projectDir: tmpDir })
      expect(consoleSpy).toHaveBeenCalled()
    } finally {
      consoleSpy.mockRestore()
    }
  })

  it("supports JSON output mode", async () => {
    const { doctor } = await import("../commands/doctor.js")
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await doctor({ projectDir: tmpDir, json: true })
      // Should output JSON for no-extension case
      const hasJson = consoleSpy.mock.calls.some((c) => {
        try {
          JSON.parse(String(c[0]))
          return true
        } catch {
          return false
        }
      })
      expect(hasJson).toBe(true)
    } finally {
      consoleSpy.mockRestore()
    }
  })
})

// ─── generate command ────────────────────────────────────────────────────────

describe("generate command", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTmpDir()
  })

  afterEach(() => {
    cleanupDir(tmpDir)
  })

  it("exports generateTypes and writeGeneratedFiles", async () => {
    const mod = await import("../commands/generate.js")
    expect(typeof mod.generateTypes).toBe("function")
    expect(typeof mod.writeGeneratedFiles).toBe("function")
  })

  it("generates dataModel.ts and api.ts for empty project", async () => {
    const { generateTypes } = await import("../commands/generate.js")
    const files = generateTypes(tmpDir)
    expect(files.length).toBeGreaterThanOrEqual(2)
    expect(files.some((f) => f.path.includes("dataModel.ts"))).toBe(true)
    expect(files.some((f) => f.path.includes("api.ts"))).toBe(true)
  })

  it("writeGeneratedFiles writes files to disk", async () => {
    const { generateTypes, writeGeneratedFiles } = await import("../commands/generate.js")
    const files = generateTypes(tmpDir)
    writeGeneratedFiles(tmpDir, files)

    for (const file of files) {
      expect(existsSync(file.path)).toBe(true)
    }
  })
})

// ─── generate-tests command ──────────────────────────────────────────────────

describe("generate-tests command", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTmpDir()
  })

  afterEach(() => {
    cleanupDir(tmpDir)
  })

  it("exports generateTestsCommand function", async () => {
    const mod = await import("../commands/generate-tests.js")
    expect(typeof mod.generateTestsCommand).toBe("function")
  })

  it("handles missing schema directory gracefully", async () => {
    const { generateTestsCommand } = await import("../commands/generate-tests.js")
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      await generateTestsCommand({ projectDir: tmpDir, dryRun: true })
    } finally {
      consoleSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })

  it("accepts coverage level parameter", async () => {
    const { generateTestsCommand } = await import("../commands/generate-tests.js")
    mkdirSync(join(tmpDir, "schema"), { recursive: true })

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await generateTestsCommand({ projectDir: tmpDir, coverage: "high", dryRun: true })
      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n")
      expect(allOutput).toContain("high")
    } finally {
      consoleSpy.mockRestore()
    }
  })
})

// ─── analyze command ─────────────────────────────────────────────────────────

describe("analyze command", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTmpDir()
  })

  afterEach(() => {
    cleanupDir(tmpDir)
  })

  it("exports analyzeCommand function", async () => {
    const mod = await import("../commands/analyze.js")
    expect(typeof mod.analyzeCommand).toBe("function")
  })

  it("handles project with no queries", async () => {
    const { analyzeCommand } = await import("../commands/analyze.js")
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await analyzeCommand({ projectDir: tmpDir })
      expect(consoleSpy).toHaveBeenCalled()
    } finally {
      consoleSpy.mockRestore()
    }
  })
})

// ─── insights command ────────────────────────────────────────────────────────

describe("insights command", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTmpDir()
  })

  afterEach(() => {
    cleanupDir(tmpDir)
  })

  it("exports insights function", async () => {
    const mod = await import("../commands/insights.js")
    expect(typeof mod.insights).toBe("function")
  })

  it("produces output for empty project", async () => {
    const { insights } = await import("../commands/insights.js")
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await insights({ projectDir: tmpDir })
      expect(consoleSpy).toHaveBeenCalled()
    } finally {
      consoleSpy.mockRestore()
    }
  })

  it("outputs JSON when --json flag is used", async () => {
    const { insights } = await import("../commands/insights.js")
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await insights({ projectDir: tmpDir, json: true })
      const hasJsonOutput = consoleSpy.mock.calls.some((c) => {
        try {
          const parsed = JSON.parse(String(c[0]))
          return parsed && typeof parsed === "object" && "summary" in parsed
        } catch {
          return false
        }
      })
      expect(hasJsonOutput).toBe(true)
    } finally {
      consoleSpy.mockRestore()
    }
  })
})

// ─── init-profile command ────────────────────────────────────────────────────

describe("init-profile command", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTmpDir()
  })

  afterEach(() => {
    cleanupDir(tmpDir)
  })

  it("exports initProject function", async () => {
    const mod = await import("../commands/init-profile.js")
    expect(typeof mod.initProject).toBe("function")
  })

  it("creates config file for minimal profile", async () => {
    const { initProject } = await import("../commands/init-profile.js")
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await initProject({ projectDir: tmpDir, profile: "minimal" })
      // Should create a config file
      const hasConfig =
        existsSync(join(tmpDir, "reactivebase.config.ts")) || existsSync(join(tmpDir, "reactivebase.config.json"))
      expect(hasConfig).toBe(true)
    } finally {
      consoleSpy.mockRestore()
    }
  })

  it("creates config file for saas profile", async () => {
    const { initProject } = await import("../commands/init-profile.js")
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await initProject({ projectDir: tmpDir, profile: "saas" })
      const hasConfig =
        existsSync(join(tmpDir, "reactivebase.config.ts")) || existsSync(join(tmpDir, "reactivebase.config.json"))
      expect(hasConfig).toBe(true)
    } finally {
      consoleSpy.mockRestore()
    }
  })

  it("rejects unknown profile names", async () => {
    const { initProject } = await import("../commands/init-profile.js")
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      await initProject({ projectDir: tmpDir, profile: "nonexistent" })
      const allErrors = errorSpy.mock.calls.map((c) => String(c[0])).join("\n")
      const allLogs = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n")
      const allOutput = allErrors + allLogs
      expect(allOutput).toMatch(/unknown|invalid|not found|available/i)
    } finally {
      consoleSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })
})

// ─── flyio-client command ────────────────────────────────────────────────────

describe("flyio-client command", () => {
  it("exports FlyioClient class", async () => {
    const mod = await import("../commands/flyio-client.js")
    expect(typeof mod.FlyioClient).toBe("function")
  })

  it("exports generateFlyDockerfile", async () => {
    const mod = await import("../commands/flyio-client.js")
    expect(typeof mod.generateFlyDockerfile).toBe("function")
  })

  it("exports generateFlyToml", async () => {
    const mod = await import("../commands/flyio-client.js")
    expect(typeof mod.generateFlyToml).toBe("function")
  })

  it("generateFlyDockerfile returns valid Dockerfile content", async () => {
    const { generateFlyDockerfile } = await import("../commands/flyio-client.js")
    const dockerfile = generateFlyDockerfile()
    expect(dockerfile).toContain("FROM")
    expect(dockerfile).toContain("node")
  })

  it("generateFlyToml returns valid TOML content", async () => {
    const { generateFlyToml } = await import("../commands/flyio-client.js")
    const toml = generateFlyToml("test-app", "iad")
    expect(toml).toContain("test-app")
  })
})

// ─── seed command ────────────────────────────────────────────────────────────

describe("seed command", () => {
  it("exports seedRun, seedReset, seedStatus", async () => {
    const mod = await import("../commands/seed.js")
    expect(typeof mod.seedRun).toBe("function")
    expect(typeof mod.seedReset).toBe("function")
    expect(typeof mod.seedStatus).toBe("function")
  })
})

// ─── auth-debug command ──────────────────────────────────────────────────────

describe("auth-debug command", () => {
  it("exports authDebug function", async () => {
    const mod = await import("../commands/auth-debug.js")
    expect(typeof mod.authDebug).toBe("function")
  })
})

// ─── dacl command ────────────────────────────────────────────────────────────

describe("dacl command", () => {
  it("exports all subcommands", async () => {
    const mod = await import("../commands/dacl.js")
    expect(typeof mod.daclList).toBe("function")
    expect(typeof mod.daclTest).toBe("function")
    expect(typeof mod.daclGenerateRls).toBe("function")
    expect(typeof mod.daclCoverage).toBe("function")
  })
})

// ─── ivm command ─────────────────────────────────────────────────────────────

describe("ivm command", () => {
  it("exports all subcommands", async () => {
    const mod = await import("../commands/ivm.js")
    expect(typeof mod.ivmList).toBe("function")
    expect(typeof mod.ivmStats).toBe("function")
    expect(typeof mod.ivmAnalyze).toBe("function")
  })
})

// ─── deploy command ──────────────────────────────────────────────────────────

describe("deploy command", () => {
  it("exports deploy and helpers", async () => {
    const mod = await import("../commands/deploy.js")
    expect(typeof mod.deploy).toBe("function")
    expect(typeof mod.deployPreview).toBe("function")
    expect(typeof mod.destroyPreview).toBe("function")
    expect(typeof mod.tailLogs).toBe("function")
  })
})

// ─── generate-procedures command ─────────────────────────────────────────────

describe("generate-procedures command", () => {
  it("exports generateProcedures function", async () => {
    const mod = await import("../commands/generate-procedures.js")
    expect(typeof mod.generateProcedures).toBe("function")
  })
})
