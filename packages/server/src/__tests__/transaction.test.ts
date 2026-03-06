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
    const sql = generateOutboxTableSQL()
    expect(typeof sql).toBe("string")
    expect(sql.toUpperCase()).toContain("CREATE")
  })

  it.todo("should test that SQL includes status columns and delivery tracking")

  it("should throw OutboxError with correct message", () => {
    const error = new OutboxError("outbox error")
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe("outbox error")
  })

  it.todo("should test outbox error with delivery failure details")
})
