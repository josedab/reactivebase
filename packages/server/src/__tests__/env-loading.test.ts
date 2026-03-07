import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { parseEnvFile, loadEnvFile, loadEnv } from "../config/index.js"

describe("parseEnvFile", () => {
  it("parses simple key-value pairs", () => {
    const result = parseEnvFile("FOO=bar\nBAZ=qux")
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" })
  })

  it("ignores comments and empty lines", () => {
    const result = parseEnvFile("# comment\n\nFOO=bar\n  # another comment")
    expect(result).toEqual({ FOO: "bar" })
  })

  it("handles double-quoted values", () => {
    const result = parseEnvFile('FOO="hello world"')
    expect(result).toEqual({ FOO: "hello world" })
  })

  it("handles single-quoted values", () => {
    const result = parseEnvFile("FOO='hello world'")
    expect(result).toEqual({ FOO: "hello world" })
  })

  it("strips inline comments from unquoted values", () => {
    const result = parseEnvFile("FOO=bar # this is a comment")
    expect(result).toEqual({ FOO: "bar" })
  })

  it("unescapes \\n in double-quoted values", () => {
    const result = parseEnvFile('FOO="line1\\nline2"')
    expect(result).toEqual({ FOO: "line1\nline2" })
  })

  it("handles values with equals signs", () => {
    const result = parseEnvFile("DATABASE_URL=postgres://user:pass@host:5432/db?ssl=true")
    expect(result).toEqual({ DATABASE_URL: "postgres://user:pass@host:5432/db?ssl=true" })
  })

  it("handles empty values", () => {
    const result = parseEnvFile("FOO=")
    expect(result).toEqual({ FOO: "" })
  })
})

describe("loadEnvFile", () => {
  const testDir = join(tmpdir(), `reactivebase-env-test-${Date.now()}`)

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    delete process.env.TEST_LOAD_VAR
  })

  it("loads env vars from a file", () => {
    writeFileSync(join(testDir, ".env"), "TEST_LOAD_VAR=loaded_value")
    const count = loadEnvFile(join(testDir, ".env"))
    expect(count).toBe(1)
    expect(process.env.TEST_LOAD_VAR).toBe("loaded_value")
  })

  it("does not overwrite existing env vars", () => {
    process.env.TEST_LOAD_VAR = "original"
    writeFileSync(join(testDir, ".env"), "TEST_LOAD_VAR=new_value")
    loadEnvFile(join(testDir, ".env"))
    expect(process.env.TEST_LOAD_VAR).toBe("original")
  })

  it("returns -1 for non-existent files", () => {
    const count = loadEnvFile(join(testDir, "nonexistent"))
    expect(count).toBe(-1)
  })
})

describe("loadEnv", () => {
  const testDir = join(tmpdir(), `reactivebase-env-load-${Date.now()}`)

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    delete process.env.TEST_ENV_A
    delete process.env.TEST_ENV_B
  })

  it("loads .env file from directory", () => {
    writeFileSync(join(testDir, ".env"), "TEST_ENV_A=from_dotenv")
    const loaded = loadEnv({ dir: testDir, nodeEnv: "development" })
    expect(loaded.length).toBeGreaterThanOrEqual(1)
    expect(process.env.TEST_ENV_A).toBe("from_dotenv")
  })

  it("respects priority: .env.development overrides .env", () => {
    writeFileSync(join(testDir, ".env"), "TEST_ENV_B=base")
    writeFileSync(join(testDir, ".env.development"), "TEST_ENV_B=dev")
    loadEnv({ dir: testDir, nodeEnv: "development" })
    expect(process.env.TEST_ENV_B).toBe("dev")
  })

  it("skips .env.local in test mode", () => {
    writeFileSync(join(testDir, ".env"), "TEST_ENV_A=from_env")
    writeFileSync(join(testDir, ".env.local"), "TEST_ENV_A=from_local")
    const loaded = loadEnv({ dir: testDir, nodeEnv: "test" })
    // .env.local should not appear in loaded files
    expect(loaded.every((f) => !f.endsWith(".env.local"))).toBe(true)
  })
})
