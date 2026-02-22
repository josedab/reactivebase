import { describe, it, expect } from "vitest"
import { parseDelay, getNextCronRun } from "../scheduler/scheduler.js"

describe("parseDelay", () => {
  it("parses milliseconds", () => {
    expect(parseDelay("500ms")).toBe(500)
  })

  it("parses seconds", () => {
    expect(parseDelay("5s")).toBe(5000)
  })

  it("parses minutes", () => {
    expect(parseDelay("10m")).toBe(600_000)
  })

  it("parses hours", () => {
    expect(parseDelay("2h")).toBe(7_200_000)
  })

  it("parses days", () => {
    expect(parseDelay("1d")).toBe(86_400_000)
  })

  it("parses plain number as ms", () => {
    expect(parseDelay("1000")).toBe(1000)
  })

  it("throws on invalid format", () => {
    expect(() => parseDelay("invalid")).toThrow("Invalid delay format")
  })

  it("handles fractional values", () => {
    expect(parseDelay("1.5h")).toBe(5_400_000)
  })
})

describe("getNextCronRun", () => {
  it("returns a future date for every-minute cron", () => {
    const next = getNextCronRun("* * * * *")
    expect(next).not.toBeNull()
    expect(next!.getTime()).toBeGreaterThan(Date.now())
  })

  it("returns null for invalid cron expression", () => {
    expect(getNextCronRun("invalid")).toBeNull()
  })

  it("handles */5 interval for minutes", () => {
    const next = getNextCronRun("*/5 * * * *")
    expect(next).not.toBeNull()
    expect(next!.getMinutes() % 5).toBe(0)
  })

  it("handles specific hour cron", () => {
    const next = getNextCronRun("0 12 * * *")
    expect(next).not.toBeNull()
    expect(next!.getHours()).toBe(12)
    expect(next!.getMinutes()).toBe(0)
  })

  it("handles comma-separated values", () => {
    const next = getNextCronRun("0,30 * * * *")
    expect(next).not.toBeNull()
    expect([0, 30]).toContain(next!.getMinutes())
  })

  it("handles range expressions", () => {
    const next = getNextCronRun("0 9-17 * * *")
    expect(next).not.toBeNull()
    const hour = next!.getHours()
    expect(hour).toBeGreaterThanOrEqual(9)
    expect(hour).toBeLessThanOrEqual(17)
  })
})
