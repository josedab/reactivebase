import { describe, it, expect } from "vitest"
import {
  executeTransaction,
  executeReadOnly,
  OutboxRelay,
  OutboxError,
  writeOutboxEvent,
  httpDeliveryTarget,
  consoleDeliveryTarget,
  generateOutboxTableSQL,
  buildInsertOutboxEventSQL,
  buildMarkFailedSQL,
} from "../transaction/index.js"

describe("transaction", () => {
  it("should export all expected symbols", () => {
    expect(executeTransaction).toBeDefined()
    expect(executeReadOnly).toBeDefined()
    expect(OutboxRelay).toBeDefined()
    expect(OutboxError).toBeDefined()
    expect(writeOutboxEvent).toBeDefined()
    expect(httpDeliveryTarget).toBeDefined()
    expect(consoleDeliveryTarget).toBeDefined()
    expect(generateOutboxTableSQL).toBeDefined()
    expect(buildInsertOutboxEventSQL).toBeDefined()
  })

  it("should generate valid outbox table SQL", () => {
    const sql = generateOutboxTableSQL()
    expect(typeof sql).toBe("string")
    expect(sql.toUpperCase()).toContain("CREATE")
  })

  it("should test that SQL includes status columns and delivery tracking", () => {
    const sql = generateOutboxTableSQL()
    const upper = sql.toUpperCase()
    expect(upper).toContain("STATUS")
    expect(upper).toContain("ATTEMPTS")
    expect(upper).toContain("LAST_ERROR")
    expect(upper).toContain("PROCESSED_AT")
    expect(upper).toContain("CREATED_AT")
    expect(sql).toContain("pending")
    expect(sql).toContain("processing")
    expect(sql).toContain("delivered")
    expect(sql).toContain("dead_letter")
    expect(upper).toContain("INDEX")
  })

  it("should throw OutboxError with correct message", () => {
    const error = new OutboxError("outbox error")
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe("outbox error")
  })

  it("should test outbox error with delivery failure details", () => {
    const error = new OutboxError("Delivery failed: HTTP 503 Service Unavailable")
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(OutboxError)
    expect(error.name).toBe("OutboxError")
    expect(error.message).toContain("Delivery failed")
    expect(error.message).toContain("503")

    const markFailedResult = buildMarkFailedSQL("evt-123", "Connection timeout", 5)
    expect(markFailedResult.sql).toContain("attempts")
    expect(markFailedResult.sql).toContain("last_error")
    expect(markFailedResult.sql).toContain("dead_letter")
    expect(markFailedResult.params).toEqual(["evt-123", "Connection timeout", 5])
  })
})
