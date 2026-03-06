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
    // TODO: test that SQL includes status columns and delivery tracking
    const sql = generateOutboxTableSQL()
    expect(typeof sql).toBe("string")
    expect(sql.toUpperCase()).toContain("CREATE")
  })

  it("should throw OutboxError with correct message", () => {
    // TODO: test outbox error with delivery failure details
    const error = new OutboxError("outbox error")
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe("outbox error")
  })
})
