import { describe, it, expect, vi } from "vitest"
import { createLogger } from "../logging/index.js"
import type { LogEntry } from "../logging/index.js"

describe("Structured Logger", () => {
  it("creates a logger with default options", () => {
    const logger = createLogger()
    expect(logger).toBeDefined()
    expect(logger.info).toBeInstanceOf(Function)
    expect(logger.error).toBeInstanceOf(Function)
    expect(logger.child).toBeInstanceOf(Function)
  })

  it("outputs structured log entries via custom output", () => {
    const entries: LogEntry[] = []
    const logger = createLogger({
      name: "test",
      level: "debug",
      output: (entry) => entries.push(entry),
    })

    logger.info("Server started", { port: 4000 })

    expect(entries).toHaveLength(1)
    expect(entries[0].level).toBe("info")
    expect(entries[0].msg).toBe("Server started")
    expect(entries[0].name).toBe("test")
    expect(entries[0].port).toBe(4000)
    expect(entries[0].timestamp).toBeDefined()
  })

  it("respects minimum log level", () => {
    const entries: LogEntry[] = []
    const logger = createLogger({
      level: "warn",
      output: (entry) => entries.push(entry),
    })

    logger.debug("debug message")
    logger.info("info message")
    logger.warn("warn message")
    logger.error("error message")

    expect(entries).toHaveLength(2)
    expect(entries[0].level).toBe("warn")
    expect(entries[1].level).toBe("error")
  })

  it("silent level suppresses all logs", () => {
    const entries: LogEntry[] = []
    const logger = createLogger({
      level: "silent",
      output: (entry) => entries.push(entry),
    })

    logger.fatal("should not appear")
    expect(entries).toHaveLength(0)
  })

  it("child logger inherits context and adds new fields", () => {
    const entries: LogEntry[] = []
    const logger = createLogger({
      name: "server",
      level: "info",
      output: (entry) => entries.push(entry),
    })

    const reqLogger = logger.child({ correlationId: "req-123", userId: "u1" })
    reqLogger.info("Handling request", { path: "/query" })

    expect(entries).toHaveLength(1)
    expect(entries[0].correlationId).toBe("req-123")
    expect(entries[0].userId).toBe("u1")
    expect(entries[0].path).toBe("/query")
    expect(entries[0].name).toBe("server")
  })

  it("child logger does not affect parent", () => {
    const entries: LogEntry[] = []
    const logger = createLogger({
      level: "info",
      output: (entry) => entries.push(entry),
    })

    logger.child({ correlationId: "req-123" })
    logger.info("Parent log")

    expect(entries).toHaveLength(1)
    expect(entries[0].correlationId).toBeUndefined()
  })

  it("supports all log levels", () => {
    const entries: LogEntry[] = []
    const logger = createLogger({
      level: "trace",
      output: (entry) => entries.push(entry),
    })

    logger.trace("trace")
    logger.debug("debug")
    logger.info("info")
    logger.warn("warn")
    logger.error("error")
    logger.fatal("fatal")

    expect(entries).toHaveLength(6)
    expect(entries.map((e) => e.level)).toEqual(["trace", "debug", "info", "warn", "error", "fatal"])
  })

  it("outputs JSON in production mode", () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const logger = createLogger({ json: true })

    logger.info("test message")

    expect(consoleSpy).toHaveBeenCalledOnce()
    const output = consoleSpy.mock.calls[0][0]
    const parsed = JSON.parse(output)
    expect(parsed.level).toBe("info")
    expect(parsed.msg).toBe("test message")

    consoleSpy.mockRestore()
  })

  it("outputs human-readable format in dev mode", () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const logger = createLogger({ json: false, name: "test" })

    logger.info("hello world")

    expect(consoleSpy).toHaveBeenCalledOnce()
    const output = consoleSpy.mock.calls[0][0]
    expect(output).toContain("INFO")
    expect(output).toContain("[test]")
    expect(output).toContain("hello world")

    consoleSpy.mockRestore()
  })

  it("data fields are included in log entry", () => {
    const entries: LogEntry[] = []
    const logger = createLogger({
      level: "info",
      output: (entry) => entries.push(entry),
    })

    logger.error("Query failed", { query: "tasks.list", duration: 1500, error: "timeout" })

    expect(entries[0].query).toBe("tasks.list")
    expect(entries[0].duration).toBe(1500)
    expect(entries[0].error).toBe("timeout")
  })
})
