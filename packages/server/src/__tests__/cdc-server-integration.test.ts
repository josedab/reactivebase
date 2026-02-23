import { describe, it, expect } from "vitest"
import { ReactiveCdcAdapter } from "../cdc/reactive-cdc.js"

describe("ReactiveCdcAdapter server integration", () => {
  it("processes WAL changes and delivers to processChanges callback", async () => {
    const processedTables: string[][] = []

    const adapter = new ReactiveCdcAdapter(
      async (tables, events) => {
        processedTables.push(tables)
      },
      { tables: ["tasks", "users"], batchSize: 5, rowLevelTracking: true },
    )

    adapter.startBuffering()

    // Simulate WAL events arriving from logical replication
    await adapter.processWalChange({
      table: "tasks",
      operation: "insert",
      rowId: "t1",
      oldValues: null,
      newValues: { title: "New task", done: false },
      lsn: "0/100",
      timestamp: Date.now(),
    })

    await adapter.processWalChange({
      table: "users",
      operation: "update",
      rowId: "u1",
      oldValues: { name: "Old" },
      newValues: { name: "New" },
      lsn: "0/101",
      timestamp: Date.now(),
    })

    // Wait for flush
    await new Promise((r) => setTimeout(r, 50))
    await adapter.stopBuffering()

    expect(processedTables.length).toBeGreaterThan(0)

    const stats = adapter.getStats()
    expect(stats.eventsProcessed).toBe(2)
    expect(stats.status).toBe("stopped")
    expect(stats.lastLsn).toBe("0/101")
  })

  it("starts in streaming status when buffering", () => {
    const adapter = new ReactiveCdcAdapter(async () => {})
    adapter.startBuffering()
    expect(adapter.status).toBe("streaming")
    adapter.stopBuffering()
  })

  it("falls back gracefully to LISTEN/NOTIFY", () => {
    const adapter = new ReactiveCdcAdapter(async () => {})

    const event = adapter.processListenNotifyPayload({
      table: "tasks",
      operation: "insert",
      id: "t1",
    })

    expect(event.table).toBe("tasks")
    expect(event.operation).toBe("insert")
    expect(adapter.status).toBe("fallback")

    const stats = adapter.getStats()
    expect(stats.tableLevelFallbacks).toBe(1)
  })

  it("processes batch at threshold", async () => {
    const flushed: number[] = []

    const adapter = new ReactiveCdcAdapter(
      async (tables, events) => {
        flushed.push(events.length)
      },
      { batchSize: 3 },
    )

    // Send exactly batchSize events — should auto-flush
    await adapter.processWalChanges([
      {
        table: "t",
        operation: "insert",
        rowId: "1",
        oldValues: null,
        newValues: null,
        lsn: "0/1",
        timestamp: Date.now(),
      },
      {
        table: "t",
        operation: "insert",
        rowId: "2",
        oldValues: null,
        newValues: null,
        lsn: "0/2",
        timestamp: Date.now(),
      },
      {
        table: "t",
        operation: "insert",
        rowId: "3",
        oldValues: null,
        newValues: null,
        lsn: "0/3",
        timestamp: Date.now(),
      },
    ])

    expect(flushed.length).toBeGreaterThan(0)
    expect(adapter.getStats().eventsProcessed).toBe(3)
  })

  it("resets stats", async () => {
    const adapter = new ReactiveCdcAdapter(async () => {}, { batchSize: 1 })
    await adapter.processWalChange({
      table: "t",
      operation: "insert",
      rowId: "1",
      oldValues: null,
      newValues: null,
      lsn: "0/1",
      timestamp: Date.now(),
    })

    expect(adapter.getStats().eventsProcessed).toBe(1)
    adapter.resetStats()
    expect(adapter.getStats().eventsProcessed).toBe(0)
  })
})
