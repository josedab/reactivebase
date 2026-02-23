import { describe, it, expect, beforeEach } from "vitest"
import {
  EventStreamManager,
  KafkaStreamAdapter,
  NatsStreamAdapter,
  SqsStreamAdapter,
  generateEventStreamTableSQL,
} from "../webhooks/event-streaming.js"
import type { StreamEvent } from "../webhooks/event-streaming.js"

function createEvent(table: string, type: StreamEvent["type"] = "insert"): StreamEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    source: "test",
    type,
    table,
    timestamp: Date.now(),
    schemaVersion: 1,
    data: { id: "1" },
  }
}

describe("EventStreamManager", () => {
  let manager: EventStreamManager

  beforeEach(() => {
    manager = new EventStreamManager({ signingSecret: "test-secret" })
  })

  describe("adapter management", () => {
    it("registers and retrieves adapters", () => {
      const kafka = new KafkaStreamAdapter({ brokers: ["localhost:9092"] })
      manager.registerAdapter("kafka", kafka)
      expect(manager.getAdapter("kafka")).toBe(kafka)
    })

    it("removes adapters", () => {
      manager.registerAdapter("kafka", new KafkaStreamAdapter({ brokers: [] }))
      manager.removeAdapter("kafka")
      expect(manager.getAdapter("kafka")).toBeUndefined()
    })
  })

  describe("event creation", () => {
    it("creates events with signature", () => {
      const event = manager.createEvent("tasks", "insert", { id: "1" })
      expect(event.table).toBe("tasks")
      expect(event.type).toBe("insert")
      expect(event.signature).toBeDefined()
      expect(event.schemaVersion).toBe(1)
    })

    it("creates events without signature when no secret", () => {
      const noSig = new EventStreamManager()
      const event = noSig.createEvent("tasks", "insert", {})
      expect(event.signature).toBeUndefined()
    })
  })

  describe("publishing", () => {
    it("publishes to all registered adapters", async () => {
      manager.registerAdapter("kafka", new KafkaStreamAdapter({ brokers: [] }))
      manager.registerAdapter("nats", new NatsStreamAdapter({ servers: [] }))
      const event = createEvent("tasks")
      const results = await manager.publish("tasks", event)
      expect(results.size).toBe(2)
      expect(results.get("kafka")?.success).toBe(true)
      expect(results.get("nats")?.success).toBe(true)
    })

    it("publishes batches", async () => {
      manager.registerAdapter("kafka", new KafkaStreamAdapter({ brokers: [] }))
      const events = [createEvent("tasks"), createEvent("tasks")]
      const results = await manager.publishBatch("tasks", events)
      expect(results.get("kafka")).toHaveLength(2)
    })
  })

  describe("filtering", () => {
    it("filters by table", async () => {
      manager.registerAdapter("kafka", new KafkaStreamAdapter({ brokers: [] }))
      manager.addFilter("kafka", { tables: ["users"] })

      const results = await manager.publish("tasks", createEvent("tasks"))
      expect(results.size).toBe(0) // filtered out
    })

    it("filters by event type", async () => {
      manager.registerAdapter("kafka", new KafkaStreamAdapter({ brokers: [] }))
      manager.addFilter("kafka", { types: ["delete"] })

      const results = await manager.publish("tasks", createEvent("tasks", "insert"))
      expect(results.size).toBe(0)
    })

    it("filters with custom predicate", async () => {
      manager.registerAdapter("kafka", new KafkaStreamAdapter({ brokers: [] }))
      manager.addFilter("kafka", { predicate: (e) => (e.data as { id: string }).id === "special" })

      const results = await manager.publish("tasks", createEvent("tasks"))
      expect(results.size).toBe(0)
    })
  })

  describe("transforms", () => {
    it("applies transform pipeline", async () => {
      manager.registerAdapter("kafka", new KafkaStreamAdapter({ brokers: [] }))
      manager.addTransform({
        transform: (event) => ({ ...event, metadata: { ...event.metadata, enriched: true } }),
      })

      const results = await manager.publish("tasks", createEvent("tasks"))
      expect(results.get("kafka")?.success).toBe(true)
    })
  })

  describe("dead-letter queue", () => {
    it("starts empty", () => {
      expect(manager.getDeadLetterQueue()).toHaveLength(0)
    })

    it("clears DLQ", () => {
      expect(manager.clearDeadLetterQueue()).toBe(0)
    })
  })

  describe("stats", () => {
    it("tracks publish stats", async () => {
      manager.registerAdapter("kafka", new KafkaStreamAdapter({ brokers: [] }))
      await manager.publish("tasks", createEvent("tasks"))
      await manager.publish("tasks", createEvent("tasks"))

      const stats = manager.getStats()
      expect(stats.published).toBe(2)
      expect(stats.failed).toBe(0)
      expect(stats.adapterCount).toBe(1)
    })
  })

  describe("cleanup", () => {
    it("destroys manager and closes adapters", async () => {
      manager.registerAdapter("kafka", new KafkaStreamAdapter({ brokers: [] }))
      await manager.destroy()
      expect(manager.getStats().adapterCount).toBe(0)
    })
  })
})

describe("KafkaStreamAdapter", () => {
  it("publishes events successfully", async () => {
    const adapter = new KafkaStreamAdapter({ brokers: ["localhost:9092"], topicPrefix: "rb." })
    const result = await adapter.publish("tasks", createEvent("tasks"))
    expect(result.success).toBe(true)
    expect(result.partition).toBeDefined()
  })

  it("passes health check", async () => {
    const adapter = new KafkaStreamAdapter({ brokers: [] })
    expect(await adapter.healthCheck()).toBe(true)
  })
})

describe("NatsStreamAdapter", () => {
  it("publishes events successfully", async () => {
    const adapter = new NatsStreamAdapter({ servers: ["nats://localhost:4222"] })
    const result = await adapter.publish("tasks", createEvent("tasks"))
    expect(result.success).toBe(true)
  })
})

describe("SqsStreamAdapter", () => {
  it("publishes events successfully", async () => {
    const adapter = new SqsStreamAdapter({ region: "us-east-1", queueUrl: "https://sqs.example.com/queue" })
    const result = await adapter.publish("tasks", createEvent("tasks"))
    expect(result.success).toBe(true)
  })

  it("publishes batches", async () => {
    const adapter = new SqsStreamAdapter({ region: "us-east-1", queueUrl: "https://sqs.example.com/queue" })
    const results = await adapter.publishBatch("tasks", [createEvent("tasks"), createEvent("tasks")])
    expect(results).toHaveLength(2)
  })
})

describe("SQL builders", () => {
  it("generates event stream table SQL", () => {
    const sql = generateEventStreamTableSQL()
    expect(sql).toContain("_reactivebase_event_stream_dlq")
    expect(sql).toContain("_reactivebase_event_stream_log")
  })
})
