/**
 * Integration tests for CLI migrate and seed commands.
 * All tests run WITHOUT a real Postgres connection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTmpDir(): string {
  const dir = `/tmp/rb-cli-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

// ─── migrate helpers ─────────────────────────────────────────────────────────

describe("migrate helpers", () => {
  describe("extractUpSection", () => {
    it("extracts UP section before -- DOWN marker", async () => {
      const { extractUpSection } = await import("../commands/migrate.js")
      const sql = "CREATE TABLE users (id INT);\n\n-- DOWN\nDROP TABLE users;"
      const up = extractUpSection(sql)
      expect(up).toBe("CREATE TABLE users (id INT);\n\n")
      expect(up).not.toContain("DROP TABLE")
    })

    it("returns full SQL when no DOWN marker exists", async () => {
      const { extractUpSection } = await import("../commands/migrate.js")
      const sql = "CREATE TABLE users (id INT);"
      expect(extractUpSection(sql)).toBe(sql)
    })

    it("handles case-insensitive DOWN marker", async () => {
      const { extractUpSection } = await import("../commands/migrate.js")
      const sql = "CREATE TABLE t (id INT);\n-- down\nDROP TABLE t;"
      const up = extractUpSection(sql)
      expect(up).toBe("CREATE TABLE t (id INT);\n")
    })

    it("returns empty string for SQL that starts with DOWN marker", async () => {
      const { extractUpSection } = await import("../commands/migrate.js")
      const sql = "-- DOWN\nDROP TABLE t;"
      expect(extractUpSection(sql)).toBe("")
    })

    it("handles multiline UP section with comments", async () => {
      const { extractUpSection } = await import("../commands/migrate.js")
      const sql = [
        "-- Migration: 001",
        "-- UP",
        "CREATE TABLE users (id INT);",
        "CREATE TABLE posts (id INT);",
        "",
        "-- DOWN",
        "DROP TABLE posts;",
        "DROP TABLE users;",
      ].join("\n")
      const up = extractUpSection(sql)
      expect(up).toContain("CREATE TABLE users")
      expect(up).toContain("CREATE TABLE posts")
      expect(up).not.toContain("DROP TABLE")
    })
  })

  describe("simpleHash", () => {
    it("returns a string hash", async () => {
      const { simpleHash } = await import("../commands/migrate.js")
      const result = simpleHash("hello")
      expect(typeof result).toBe("string")
      expect(result.length).toBeGreaterThan(0)
    })

    it("returns consistent results for same input", async () => {
      const { simpleHash } = await import("../commands/migrate.js")
      expect(simpleHash("test")).toBe(simpleHash("test"))
    })

    it("returns different results for different input", async () => {
      const { simpleHash } = await import("../commands/migrate.js")
      expect(simpleHash("abc")).not.toBe(simpleHash("xyz"))
    })

    it("handles empty string", async () => {
      const { simpleHash } = await import("../commands/migrate.js")
      const result = simpleHash("")
      expect(typeof result).toBe("string")
      expect(result).toBe("0")
    })
  })
})

// ─── migrateGenerate ─────────────────────────────────────────────────────────

describe("migrateGenerate", () => {
  let tmpDir: string
  let consoleErrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpDir = createTmpDir()
    vi.spyOn(console, "log").mockImplementation(() => {})
    consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    cleanupDir(tmpDir)
    vi.restoreAllMocks()
  })

  it("creates migrations directory if not exists", async () => {
    const convexDir = join(tmpDir, "convex")
    mkdirSync(convexDir, { recursive: true })
    writeFileSync(
      join(convexDir, "schema.ts"),
      `
      import { defineSchema, defineTable, v } from "@reactivebase/server"
      export default defineSchema({
        tasks: defineTable({ title: v.string() })
      })
    `,
    )

    const { migrateGenerate } = await import("../commands/migrate.js")
    await migrateGenerate({ projectDir: tmpDir })

    const migrationsDir = join(tmpDir, "migrations")
    expect(existsSync(migrationsDir)).toBe(true)
    const files = readdirSync(migrationsDir)
    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/^\d+.*\.sql$/)
  })

  it("generates SQL file with migration header", async () => {
    mkdirSync(join(tmpDir, "convex"), { recursive: true })
    writeFileSync(join(tmpDir, "convex", "schema.ts"), "export default {}")

    const { migrateGenerate } = await import("../commands/migrate.js")
    await migrateGenerate({ projectDir: tmpDir })

    const migrationsDir = join(tmpDir, "migrations")
    const files = readdirSync(migrationsDir)
    expect(files.length).toBe(1)
    const content = readFileSync(join(migrationsDir, files[0]), "utf-8")
    expect(content).toContain("Migration:")
    expect(content).toContain("Generated by ReactiveBase CLI")
  })

  it("detects table names from defineTable patterns in schema", async () => {
    mkdirSync(join(tmpDir, "convex"), { recursive: true })
    writeFileSync(
      join(tmpDir, "convex", "schema.ts"),
      `
      import { defineSchema, defineTable, v } from "@reactivebase/server"
      export default defineSchema({
        users: defineTable({ name: v.string() }),
        posts: defineTable({ title: v.string() })
      })
    `,
    )

    const { migrateGenerate } = await import("../commands/migrate.js")
    await migrateGenerate({ projectDir: tmpDir })

    const files = readdirSync(join(tmpDir, "migrations"))
    const content = readFileSync(join(tmpDir, "migrations", files[0]), "utf-8")
    expect(content).toContain("users")
    expect(content).toContain("posts")
  })

  it("finds schema.ts at project root", async () => {
    writeFileSync(join(tmpDir, "schema.ts"), "export default {}")

    const { migrateGenerate } = await import("../commands/migrate.js")
    await migrateGenerate({ projectDir: tmpDir })

    expect(existsSync(join(tmpDir, "migrations"))).toBe(true)
    expect(readdirSync(join(tmpDir, "migrations")).length).toBe(1)
  })

  it("finds schema.ts in src/ directory", async () => {
    mkdirSync(join(tmpDir, "src"), { recursive: true })
    writeFileSync(join(tmpDir, "src", "schema.ts"), "export default {}")

    const { migrateGenerate } = await import("../commands/migrate.js")
    await migrateGenerate({ projectDir: tmpDir })

    expect(existsSync(join(tmpDir, "migrations"))).toBe(true)
  })

  it("exits when no schema file found", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called")
    }) as never)

    const { migrateGenerate } = await import("../commands/migrate.js")
    await expect(migrateGenerate({ projectDir: tmpDir })).rejects.toThrow("process.exit called")

    expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringContaining("No schema file found"))
    exitSpy.mockRestore()
  })

  it("generates UP and DOWN section markers", async () => {
    writeFileSync(join(tmpDir, "schema.ts"), "export default {}")

    const { migrateGenerate } = await import("../commands/migrate.js")
    await migrateGenerate({ projectDir: tmpDir })

    const files = readdirSync(join(tmpDir, "migrations"))
    const content = readFileSync(join(tmpDir, "migrations", files[0]), "utf-8")
    expect(content).toContain("-- UP")
    expect(content).toContain("-- DOWN")
  })
})

// ─── migrateApply without DB ─────────────────────────────────────────────────

describe("migrateApply without DB", () => {
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

  it("reports no migrations directory", async () => {
    const { migrateApply } = await import("../commands/migrate.js")
    await migrateApply({ projectDir: tmpDir })
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No migrations directory"))
  })

  it("reports no pending migrations for empty dir", async () => {
    mkdirSync(join(tmpDir, "migrations"))
    const { migrateApply } = await import("../commands/migrate.js")
    await migrateApply({ projectDir: tmpDir })
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No pending migrations"))
  })

  it("exits when no DATABASE_URL for pending migrations", async () => {
    const migrationsDir = join(tmpDir, "migrations")
    mkdirSync(migrationsDir)
    writeFileSync(join(migrationsDir, "001_init.sql"), "CREATE TABLE test (id INT);")

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit")
    }) as never)

    const { migrateApply } = await import("../commands/migrate.js")
    await expect(migrateApply({ projectDir: tmpDir })).rejects.toThrow("exit")

    expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringContaining("DATABASE_URL"))
    exitSpy.mockRestore()
  })

  it("only processes .sql files", async () => {
    const migrationsDir = join(tmpDir, "migrations")
    mkdirSync(migrationsDir)
    writeFileSync(join(migrationsDir, "README.md"), "# Migrations")
    writeFileSync(join(migrationsDir, ".gitkeep"), "")

    const { migrateApply } = await import("../commands/migrate.js")
    await migrateApply({ projectDir: tmpDir })
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No pending migrations"))
  })
})

// ─── migrateStatus without DB ────────────────────────────────────────────────

describe("migrateStatus without DB", () => {
  let tmpDir: string
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpDir = createTmpDir()
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    cleanupDir(tmpDir)
    vi.restoreAllMocks()
  })

  it("reports no migrations directory", async () => {
    const { migrateStatus } = await import("../commands/migrate.js")
    await migrateStatus({ projectDir: tmpDir })
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No migrations directory"))
  })

  it("reports no migration files in empty dir", async () => {
    mkdirSync(join(tmpDir, "migrations"))
    const { migrateStatus } = await import("../commands/migrate.js")
    await migrateStatus({ projectDir: tmpDir })
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No migration files"))
  })

  it("lists migration files without DB connection", async () => {
    mkdirSync(join(tmpDir, "migrations"), { recursive: true })
    writeFileSync(join(tmpDir, "migrations", "001_init.sql"), "-- init")
    writeFileSync(join(tmpDir, "migrations", "002_add_users.sql"), "-- users")

    const { migrateStatus } = await import("../commands/migrate.js")
    await migrateStatus({ projectDir: tmpDir })

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n")
    expect(output).toContain("001_init.sql")
    expect(output).toContain("002_add_users.sql")
  })

  it("shows hint to set DATABASE_URL when no connection", async () => {
    mkdirSync(join(tmpDir, "migrations"), { recursive: true })
    writeFileSync(join(tmpDir, "migrations", "001_init.sql"), "-- init")

    const { migrateStatus } = await import("../commands/migrate.js")
    await migrateStatus({ projectDir: tmpDir })

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n")
    expect(output).toContain("DATABASE_URL")
  })

  it("lists files sorted alphabetically", async () => {
    mkdirSync(join(tmpDir, "migrations"), { recursive: true })
    writeFileSync(join(tmpDir, "migrations", "003_c.sql"), "-- c")
    writeFileSync(join(tmpDir, "migrations", "001_a.sql"), "-- a")
    writeFileSync(join(tmpDir, "migrations", "002_b.sql"), "-- b")

    const { migrateStatus } = await import("../commands/migrate.js")
    await migrateStatus({ projectDir: tmpDir })

    const fileCalls = consoleSpy.mock.calls.map((c) => String(c[0])).filter((s) => s.includes(".sql"))
    expect(fileCalls.length).toBe(3)
    const joined = fileCalls.join("\n")
    const idxA = joined.indexOf("001_a.sql")
    const idxB = joined.indexOf("002_b.sql")
    const idxC = joined.indexOf("003_c.sql")
    expect(idxA).toBeLessThan(idxB)
    expect(idxB).toBeLessThan(idxC)
  })
})

// ─── seed helpers ────────────────────────────────────────────────────────────

describe("seed helpers", () => {
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

  describe("seedStatus", () => {
    it("reports no seeds directory", async () => {
      const { seedStatus } = await import("../commands/seed.js")
      await seedStatus({ projectDir: tmpDir })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No seeds/ directory"))
    })

    it("reports no seed files in empty dir", async () => {
      mkdirSync(join(tmpDir, "seeds"))
      const { seedStatus } = await import("../commands/seed.js")
      await seedStatus({ projectDir: tmpDir })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No seed files"))
    })

    it("lists seed files by name", async () => {
      mkdirSync(join(tmpDir, "seeds"), { recursive: true })
      writeFileSync(join(tmpDir, "seeds", "users.seed.ts"), "export default {}")
      writeFileSync(join(tmpDir, "seeds", "posts.seed.ts"), "export default {}")

      const { seedStatus } = await import("../commands/seed.js")
      await seedStatus({ projectDir: tmpDir })

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n")
      expect(output).toContain("users")
      expect(output).toContain("posts")
    })

    it("shows registered status for each seed file", async () => {
      mkdirSync(join(tmpDir, "seeds"), { recursive: true })
      writeFileSync(join(tmpDir, "seeds", "users.seed.ts"), "export default {}")

      const { seedStatus } = await import("../commands/seed.js")
      await seedStatus({ projectDir: tmpDir })

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n")
      expect(output).toContain("registered")
    })

    it("recognizes .seed.js files", async () => {
      mkdirSync(join(tmpDir, "seeds"), { recursive: true })
      writeFileSync(join(tmpDir, "seeds", "data.seed.js"), "module.exports = {}")

      const { seedStatus } = await import("../commands/seed.js")
      await seedStatus({ projectDir: tmpDir })

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n")
      expect(output).toContain("data")
    })

    it("ignores non-seed files", async () => {
      mkdirSync(join(tmpDir, "seeds"), { recursive: true })
      writeFileSync(join(tmpDir, "seeds", "README.md"), "# Seeds")
      writeFileSync(join(tmpDir, "seeds", "utils.ts"), "export {}")

      const { seedStatus } = await import("../commands/seed.js")
      await seedStatus({ projectDir: tmpDir })

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No seed files"))
    })
  })

  describe("seedRun", () => {
    it("reports no seeds directory with example", async () => {
      const { seedRun } = await import("../commands/seed.js")
      await seedRun({ projectDir: tmpDir })

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n")
      expect(output).toContain("No seeds/ directory")
    })

    it("reports no seed files in empty dir", async () => {
      mkdirSync(join(tmpDir, "seeds"))
      const { seedRun } = await import("../commands/seed.js")
      await seedRun({ projectDir: tmpDir })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No .seed.ts or .seed.js"))
    })

    it("exits when no DATABASE_URL", async () => {
      mkdirSync(join(tmpDir, "seeds"), { recursive: true })
      writeFileSync(join(tmpDir, "seeds", "test.seed.ts"), "export default {}")

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("exit")
      }) as never)

      const { seedRun } = await import("../commands/seed.js")
      await expect(seedRun({ projectDir: tmpDir })).rejects.toThrow("exit")

      expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringContaining("DATABASE_URL"))
      exitSpy.mockRestore()
    })

    it("defaults to dev environment", async () => {
      mkdirSync(join(tmpDir, "seeds"), { recursive: true })
      writeFileSync(join(tmpDir, "seeds", "test.seed.ts"), "export default {}")

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("exit")
      }) as never)

      const { seedRun } = await import("../commands/seed.js")
      try {
        await seedRun({ projectDir: tmpDir })
      } catch {
        // expected: process.exit mock
      }

      // Shouldn't have logged a non-default environment before exiting
      const logged = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n")
      expect(logged).not.toContain("environment: test")
      exitSpy.mockRestore()
    })
  })

  describe("seedReset", () => {
    it("exits when no DATABASE_URL", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("exit")
      }) as never)

      const { seedReset } = await import("../commands/seed.js")
      await expect(seedReset({ projectDir: tmpDir })).rejects.toThrow("exit")

      expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringContaining("DATABASE_URL"))
      exitSpy.mockRestore()
    })

    it("reports no seeds directory when missing", async () => {
      const { seedReset } = await import("../commands/seed.js")
      await seedReset({ projectDir: tmpDir, connectionString: "postgres://localhost/test" })

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n")
      expect(output).toContain("No seeds/ directory")
    })
  })
})
