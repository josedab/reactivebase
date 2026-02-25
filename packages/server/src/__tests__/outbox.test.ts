import { describe, it, expect } from "vitest"
import {
  generateOutboxTableSQL,
  buildInsertOutboxEventSQL,
  buildClaimBatchSQL,
  buildMarkDeliveredSQL,
  buildMarkFailedSQL,
  buildReplaySQL,
  buildOutboxStatsSQL,
  buildDeadLetterQuerySQL,
  writeOutboxEvent,
  OutboxRelay,
  OutboxError,
  httpDeliveryTarget,
  consoleDeliveryTarget,
  type OutboxEvent,
  type OutboxRecord,
  type DeliveryTarget,
  type _DeliveryResult,
} from "../transaction/outbox.js"

describe("Outbox SQL Helpers", () => {
  describe("generateOutboxTableSQL", () => {
    it("generates valid CREATE TABLE SQL", () => {
      const sql = generateOutboxTableSQL()
      expect(sql).toContain("_reactivebase_outbox")
      expect(sql).toContain("id TEXT PRIMARY KEY")
      expect(sql).toContain("type TEXT NOT NULL")
      expect(sql).toContain("payload JSONB")
      expect(sql).toContain("status TEXT NOT NULL DEFAULT 'pending'")
      expect(sql).toContain("idx_outbox_status")
      expect(sql).toContain("idx_outbox_aggregate")
      expect(sql).toContain("valid_status")
    })
  })

  describe("buildInsertOutboxEventSQL", () => {
    it("builds parameterized INSERT", () => {
      const event: OutboxEvent = {
        type: "task.completed",
        payload: { taskId: "t1" },
        aggregateId: "task-t1",
        metadata: { correlationId: "c1" },
      }
      const { sql, params } = buildInsertOutboxEventSQL(event)
      expect(sql).toContain("INSERT INTO _reactivebase_outbox")
      expect(sql).toContain("RETURNING *")
      expect(params).toHaveLength(4)
      expect(params[0]).toBe("task.completed")
      expect(params[1]).toBe('{"taskId":"t1"}')
      expect(params[2]).toBe("task-t1")
    })

    it("handles null aggregateId and metadata", () => {
      const event: OutboxEvent = { type: "ping", payload: null }
      const { params } = buildInsertOutboxEventSQL(event)
      expect(params[2]).toBeNull() // aggregateId
      expect(params[3]).toBe("{}") // metadata
    })
  })

  describe("buildClaimBatchSQL", () => {
    it("uses FOR UPDATE SKIP LOCKED for concurrency safety", () => {
      const { sql, params } = buildClaimBatchSQL(50)
      expect(sql).toContain("FOR UPDATE SKIP LOCKED")
      expect(sql).toContain("SET status = 'processing'")
      expect(sql).toContain("LIMIT $1")
      expect(params).toEqual([50])
    })
  })

  describe("buildMarkDeliveredSQL", () => {
    it("marks multiple events as delivered", () => {
      const { sql, params } = buildMarkDeliveredSQL(["e1", "e2", "e3"])
      expect(sql).toContain("SET status = 'delivered'")
      expect(sql).toContain("processed_at = NOW()")
      expect(sql).toContain("$1, $2, $3")
      expect(params).toEqual(["e1", "e2", "e3"])
    })
  })

  describe("buildMarkFailedSQL", () => {
    it("increments attempts and dead-letters at max", () => {
      const { sql, params } = buildMarkFailedSQL("e1", "timeout", 5)
      expect(sql).toContain("attempts = attempts + 1")
      expect(sql).toContain("WHEN attempts + 1 >= $3 THEN 'dead_letter'")
      expect(sql).toContain("ELSE 'pending'")
      expect(params).toEqual(["e1", "timeout", 5])
    })
  })

  describe("buildReplaySQL", () => {
    it("resets dead-letter events to pending", () => {
      const { sql, params } = buildReplaySQL(["e1", "e2"])
      expect(sql).toContain("SET status = 'pending', attempts = 0")
      expect(sql).toContain("last_error = NULL")
      expect(params).toEqual(["e1", "e2"])
    })
  })

  describe("buildOutboxStatsSQL", () => {
    it("selects counts by status", () => {
      const { sql } = buildOutboxStatsSQL()
      expect(sql).toContain("FILTER (WHERE status = 'pending')")
      expect(sql).toContain("FILTER (WHERE status = 'delivered')")
      expect(sql).toContain("FILTER (WHERE status = 'dead_letter')")
    })
  })

  describe("buildDeadLetterQuerySQL", () => {
    it("queries dead-letter events with limit", () => {
      const { sql, params } = buildDeadLetterQuerySQL(25)
      expect(sql).toContain("WHERE status = 'dead_letter'")
      expect(sql).toContain("LIMIT $1")
      expect(params).toEqual([25])
    })
  })
})

describe("writeOutboxEvent", () => {
  it("rejects events without a type", async () => {
    const mockClient = {} as never
    await expect(writeOutboxEvent(mockClient, { type: "", payload: {} })).rejects.toThrow("Event type is required")
  })

  it("rejects events with non-string type", async () => {
    const mockClient = {} as never
    await expect(writeOutboxEvent(mockClient, { type: 123 as unknown as string, payload: {} })).rejects.toThrow(
      "Event type is required",
    )
  })
})

describe("OutboxRelay", () => {
  it("starts and stops correctly", () => {
    const mockPool = { connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }) } as never
    const target: DeliveryTarget = { name: "test", deliver: async () => [] }
    const relay = new OutboxRelay(mockPool, { deliveryTarget: target })

    expect(relay.isRunning).toBe(false)
    relay.start()
    expect(relay.isRunning).toBe(true)
    relay.stop()
    expect(relay.isRunning).toBe(false)
  })

  it("does not double-start", () => {
    const mockPool = { connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }) } as never
    const target: DeliveryTarget = { name: "test", deliver: async () => [] }
    const relay = new OutboxRelay(mockPool, { deliveryTarget: target })

    relay.start()
    relay.start() // Should be idempotent
    expect(relay.isRunning).toBe(true)
    relay.stop()
  })
})

describe("Delivery Targets", () => {
  it("consoleDeliveryTarget returns success for all events", async () => {
    const target = consoleDeliveryTarget()
    expect(target.name).toBe("console")

    const events: OutboxRecord[] = [
      {
        id: "e1",
        type: "test",
        payload: { x: 1 },
        aggregateId: null,
        metadata: {},
        status: "processing",
        attempts: 0,
        lastError: null,
        createdAt: new Date(),
        processedAt: null,
      },
    ]
    const results = await target.deliver(events)
    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(true)
    expect(results[0].eventId).toBe("e1")
  })

  it("httpDeliveryTarget creates a named target", () => {
    const target = httpDeliveryTarget("https://example.com/webhook")
    expect(target.name).toBe("http:https://example.com/webhook")
  })
})

describe("OutboxError", () => {
  it("has correct name and message", () => {
    const err = new OutboxError("test error")
    expect(err.name).toBe("OutboxError")
    expect(err.message).toBe("test error")
    expect(err).toBeInstanceOf(Error)
  })
})
