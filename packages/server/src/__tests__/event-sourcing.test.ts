import { describe, it, expect } from "vitest"
import {
  EventStore,
  ProjectionEngine,
  EventSourcingError,
  buildCreateEventStoreTablesSQL,
  buildAppendEventSQL,
  buildGetEventsSQL,
} from "../event-sourcing/index.js"

describe("event-sourcing", () => {
  it("should export all expected symbols", () => {
    expect(EventStore).toBeDefined()
    expect(ProjectionEngine).toBeDefined()
    expect(EventSourcingError).toBeDefined()
    expect(buildCreateEventStoreTablesSQL).toBeDefined()
    expect(buildAppendEventSQL).toBeDefined()
    expect(buildGetEventsSQL).toBeDefined()
  })

  it("should generate valid event store tables SQL", () => {
    const sql = buildCreateEventStoreTablesSQL()
    expect(typeof sql).toBe("string")
    expect(sql.toUpperCase()).toContain("CREATE")
  })

  it("should throw EventSourcingError with correct message", () => {
    // TODO: test error propagation with event metadata
    const error = new EventSourcingError("test error", "TEST_CODE")
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe("test error")
    expect(error.code).toBe("TEST_CODE")
  })
})
