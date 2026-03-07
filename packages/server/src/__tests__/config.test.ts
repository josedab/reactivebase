import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { defineConfig, validateConfig, resolveEnvVars, ConfigValidationError } from "../config/index.js"

describe("config validation", () => {
  it("accepts a valid config", () => {
    const config = defineConfig({
      database: { connectionString: "postgresql://localhost:5432/test" },
    })
    expect(config.database.connectionString).toBe("postgresql://localhost:5432/test")
    expect(config.server?.port).toBe(4000)
    expect(config.server?.hostname).toBe("0.0.0.0")
    expect(config.server?.heartbeatInterval).toBe(30_000)
    expect(config.server?.shutdownTimeoutMs).toBe(10_000)
    expect(config.dev?.logLevel).toBe("info")
  })

  it("throws on missing database.connectionString", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => defineConfig({ database: { connectionString: "" } } as any)).toThrow(ConfigValidationError)
  })

  it("throws on missing database object", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => defineConfig({} as any)).toThrow(ConfigValidationError)
  })

  it("throws on invalid port", () => {
    expect(() =>
      defineConfig({
        database: { connectionString: "postgresql://localhost/test" },
        server: { port: 99999 },
      }),
    ).toThrow(ConfigValidationError)
  })

  it("throws on invalid poolSize", () => {
    expect(() =>
      defineConfig({
        database: { connectionString: "postgresql://localhost/test", poolSize: -1 },
      }),
    ).toThrow(ConfigValidationError)
  })

  it("allows custom server options", () => {
    const config = defineConfig({
      database: { connectionString: "postgresql://localhost/test" },
      server: { port: 3000, corsOrigin: "https://app.example.com" },
    })
    expect(config.server?.port).toBe(3000)
    expect(config.server?.corsOrigin).toBe("https://app.example.com")
  })

  it("validates cdc.mode", () => {
    expect(() =>
      defineConfig({
        database: { connectionString: "postgresql://localhost/test" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cdc: { mode: "invalid" as any },
      }),
    ).toThrow(ConfigValidationError)
  })

  it("validates dev.logLevel", () => {
    expect(() =>
      defineConfig({
        database: { connectionString: "postgresql://localhost/test" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dev: { logLevel: "verbose" as any },
      }),
    ).toThrow(ConfigValidationError)
  })

  it("returns warnings for production CORS wildcard", () => {
    const prevEnv = process.env.NODE_ENV
    process.env.NODE_ENV = "production"
    try {
      const issues = validateConfig({
        database: { connectionString: "postgresql://localhost/test" },
        server: { port: 4000, corsOrigin: "*" },
      })
      const corsWarning = issues.find((i) => i.path === "server.corsOrigin")
      expect(corsWarning).toBeDefined()
      expect(corsWarning?.severity).toBe("warning")
    } finally {
      process.env.NODE_ENV = prevEnv
    }
  })
})

describe("environment variable resolution", () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    process.env.TEST_DB_URL = "postgresql://testhost:5432/testdb"
    process.env.TEST_PORT = "3000"
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it("resolves $VAR syntax", () => {
    expect(resolveEnvVars("$TEST_DB_URL")).toBe("postgresql://testhost:5432/testdb")
  })

  it("resolves ${VAR} syntax", () => {
    expect(resolveEnvVars("${TEST_DB_URL}")).toBe("postgresql://testhost:5432/testdb")
  })

  it("resolves env vars embedded in strings", () => {
    expect(resolveEnvVars("prefix_${TEST_DB_URL}_suffix")).toBe("prefix_postgresql://testhost:5432/testdb_suffix")
  })

  it("returns plain strings unchanged", () => {
    expect(resolveEnvVars("postgresql://localhost/db")).toBe("postgresql://localhost/db")
  })

  it("throws on undefined env var", () => {
    expect(() => resolveEnvVars("$UNDEFINED_VAR_12345")).toThrow(ConfigValidationError)
  })

  it("resolves env vars in defineConfig", () => {
    const config = defineConfig({
      database: { connectionString: "$TEST_DB_URL" },
    })
    expect(config.database.connectionString).toBe("postgresql://testhost:5432/testdb")
  })
})
