import { describe, it, expect, vi, beforeEach } from "vitest"
import { CdcListener, ChangeEventBuffer, deduplicateEvents, type PgListenClient } from "../cdc/cdc.js"
import { defineSchema, defineTable, v } from "../schema/index.js"
import type { ChangeEvent } from "../reactivity/index.js"

function createMockClient(): PgListenClient & { emit: (event: string, data: unknown) => void } {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  return {
    async query() {},
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event)!.push(handler)
    },
    emit(event: string, data: unknown) {
      for (const h of handlers.get(event) ?? []) h(data)
    },
  }
}

describe("CdcListener", () => {
  it("starts and stops listening", async () => {
    const client = createMockClient()
    const listener = new CdcListener()

    await listener.start(client)
    expect(listener.isListening).toBe(true)

    await listener.stop()
    expect(listener.isListening).toBe(false)
  })

  it("receives NOTIFY events and calls handler", async () => {
    const client = createMockClient()
    const listener = new CdcListener({ channel: "test_ch" })
    const received: ChangeEvent[][] = []

    listener.onChanges((events) => {
      received.push(events)
    })
    await listener.start(client)

    client.emit("notification", {
      channel: "test_ch",
      payload: JSON.stringify({ table: "tasks", operation: "INSERT", row: { id: "1" } }),
    })

    expect(received).toHaveLength(1)
    expect(received[0][0].table).toBe("tasks")
  })

  it("ignores events from other channels", async () => {
    const client = createMockClient()
    const listener = new CdcListener({ channel: "my_channel" })
    const received: ChangeEvent[][] = []

    listener.onChanges((events) => {
      received.push(events)
    })
    await listener.start(client)

    client.emit("notification", {
      channel: "other_channel",
      payload: JSON.stringify({ table: "tasks", operation: "INSERT" }),
    })

    expect(received).toHaveLength(0)
  })

  it("generates trigger SQL for all schema tables", () => {
    const schema = defineSchema({
      users: defineTable({ name: v.string() }),
      tasks: defineTable({ title: v.string() }),
    })

    const listener = new CdcListener()
    const sql = listener.generateTriggerSQL(schema)

    expect(sql).toContain("notify_users_changes")
    expect(sql).toContain("notify_tasks_changes")
    expect(sql).toContain("AFTER INSERT OR UPDATE OR DELETE")
  })
})

describe("ChangeEventBuffer", () => {
  it("batches events and flushes", async () => {
    const received: ChangeEvent[][] = []
    const buffer = new ChangeEventBuffer((events) => {
      received.push([...events])
    }, 10)

    buffer.push({ table: "tasks", operation: "insert" })
    buffer.push({ table: "tasks", operation: "update" })

    // Events should not be flushed yet
    expect(received).toHaveLength(0)

    // Wait for flush
    await new Promise((r) => setTimeout(r, 50))
    expect(received).toHaveLength(1)
    expect(received[0].length).toBeGreaterThanOrEqual(1)

    await buffer.stop()
  })

  it("flushes immediately when stop is called", async () => {
    const received: ChangeEvent[][] = []
    const buffer = new ChangeEventBuffer((events) => {
      received.push([...events])
    }, 10000)

    buffer.push({ table: "tasks", operation: "insert" })
    await buffer.stop()

    expect(received).toHaveLength(1)
  })
})

describe("deduplicateEvents", () => {
  it("deduplicates events for same table/operation/id", () => {
    const events: ChangeEvent[] = [
      { table: "tasks", operation: "update", affectedFilters: { id: "1" } },
      { table: "tasks", operation: "update", affectedFilters: { id: "1" } },
      { table: "tasks", operation: "update", affectedFilters: { id: "2" } },
      { table: "users", operation: "insert" },
    ]

    const deduped = deduplicateEvents(events)
    expect(deduped).toHaveLength(3)
  })

  it("keeps events for different operations", () => {
    const events: ChangeEvent[] = [
      { table: "tasks", operation: "insert", affectedFilters: { id: "1" } },
      { table: "tasks", operation: "update", affectedFilters: { id: "1" } },
    ]

    const deduped = deduplicateEvents(events)
    expect(deduped).toHaveLength(2)
  })
})
