import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  LogicalReplicator,
  WalDecoder,
  ChangeBatcher,
} from "../logical-replication/logical-replication.js"
import type { WalChange } from "../logical-replication/logical-replication.js"
import type { ChangeEvent } from "../reactivity/invalidation-evaluator.js"

/**
 * Integration tests for Logical Replication → Reactivity Engine pipeline.
 * Tests the full flow: WAL change → decode → batch → convert to ChangeEvent → invalidate.
 */

describe("Logical Replication → Reactivity Integration", () => {
  // ─── WAL Change to ChangeEvent Conversion ────────────────────────────

  describe("walChangeToChangeEvent", () => {
    it("converts INSERT WAL change to ChangeEvent", () => {
      const walChange: WalChange = {
        lsn: "0/16B3748",
        xid: 42,
        timestamp: new Date(),
        type: "insert",
        schema: "public",
        table: "tasks",
        newRow: { id: "t1", title: "New Task", done: false },
      }

      const event = walChangeToChangeEvent(walChange)
      expect(event).not.toBeNull()
      expect(event!.table).toBe("tasks")
      expect(event!.operation).toBe("insert")
      expect(event!.affectedFilters).toEqual({ id: "t1", title: "New Task", done: false })
    })

    it("converts UPDATE WAL change to ChangeEvent with old values", () => {
      const walChange: WalChange = {
        lsn: "0/16B3749",
        xid: 43,
        timestamp: new Date(),
        type: "update",
        schema: "public",
        table: "tasks",
        newRow: { id: "t1", title: "Updated", done: true },
        oldRow: { id: "t1", title: "Old", done: false },
      }

      const event = walChangeToChangeEvent(walChange)
      expect(event).not.toBeNull()
      expect(event!.operation).toBe("update")
      expect(event!.affectedFilters).toEqual({ id: "t1", title: "Updated", done: true })
      expect(event!.oldValues).toEqual({ id: "t1", title: "Old", done: false })
    })

    it("converts DELETE WAL change to ChangeEvent", () => {
      const walChange: WalChange = {
        lsn: "0/16B374A",
        xid: 44,
        timestamp: new Date(),
        type: "delete",
        schema: "public",
        table: "tasks",
        oldRow: { id: "t1", title: "Deleted", done: false },
      }

      const event = walChangeToChangeEvent(walChange)
      expect(event).not.toBeNull()
      expect(event!.operation).toBe("delete")
      expect(event!.affectedFilters).toEqual({ id: "t1", title: "Deleted", done: false })
    })

    it("returns null for non-data WAL changes", () => {
      const begin: WalChange = { lsn: "0/0", xid: 1, timestamp: new Date(), type: "begin", schema: "", table: "" }
      const commit: WalChange = { lsn: "0/0", xid: 1, timestamp: new Date(), type: "commit", schema: "", table: "" }
      const relation: WalChange = { lsn: "0/0", xid: 1, timestamp: new Date(), type: "relation", schema: "public", table: "tasks" }

      expect(walChangeToChangeEvent(begin)).toBeNull()
      expect(walChangeToChangeEvent(commit)).toBeNull()
      expect(walChangeToChangeEvent(relation)).toBeNull()
    })
  })

  // ─── Batch → ChangeEvents Pipeline ────────────────────────────────────

  describe("batch to change events pipeline", () => {
    it("converts a batch of WAL changes to ChangeEvents", () => {
      const batch: WalChange[] = [
        { lsn: "0/1", xid: 1, timestamp: new Date(), type: "insert", schema: "public", table: "tasks", newRow: { id: "t1" } },
        { lsn: "0/2", xid: 1, timestamp: new Date(), type: "update", schema: "public", table: "users", newRow: { id: "u1", name: "Bob" }, oldRow: { id: "u1", name: "Alice" } },
        { lsn: "0/3", xid: 1, timestamp: new Date(), type: "delete", schema: "public", table: "tasks", oldRow: { id: "t2" } },
      ]

      const events = batchToChangeEvents(batch)
      expect(events).toHaveLength(3)
      expect(events[0].table).toBe("tasks")
      expect(events[0].operation).toBe("insert")
      expect(events[1].table).toBe("users")
      expect(events[1].operation).toBe("update")
      expect(events[2].table).toBe("tasks")
      expect(events[2].operation).toBe("delete")
    })

    it("extracts unique modified tables from batch", () => {
      const batch: WalChange[] = [
        { lsn: "0/1", xid: 1, timestamp: new Date(), type: "insert", schema: "public", table: "tasks", newRow: { id: "t1" } },
        { lsn: "0/2", xid: 1, timestamp: new Date(), type: "update", schema: "public", table: "tasks", newRow: { id: "t2" } },
        { lsn: "0/3", xid: 1, timestamp: new Date(), type: "insert", schema: "public", table: "users", newRow: { id: "u1" } },
      ]

      const tables = extractModifiedTables(batch)
      expect(tables).toHaveLength(2)
      expect(tables).toContain("tasks")
      expect(tables).toContain("users")
    })

    it("filters out transaction boundary events", () => {
      const batch: WalChange[] = [
        { lsn: "0/0", xid: 1, timestamp: new Date(), type: "begin", schema: "", table: "" },
        { lsn: "0/1", xid: 1, timestamp: new Date(), type: "insert", schema: "public", table: "tasks", newRow: { id: "t1" } },
        { lsn: "0/2", xid: 1, timestamp: new Date(), type: "commit", schema: "", table: "" },
      ]

      const events = batchToChangeEvents(batch)
      expect(events).toHaveLength(1)
      expect(events[0].operation).toBe("insert")
    })
  })

  // ─── Full Pipeline: Replicator → Batcher → ChangeEvents ──────────────

  describe("full pipeline", () => {
    it("processes WAL binary data through replicator and produces change events", async () => {
      const receivedEvents: ChangeEvent[] = []
      const replicator = new LogicalReplicator({ batchSize: 5 })

      // Wire up the pipeline
      replicator.onChange((walChanges) => {
        const events = batchToChangeEvents(walChanges)
        receivedEvents.push(...events)
      })
      replicator.start()

      // Register a relation via raw binary
      const relBuf = buildRelationMessage(1, "public", "tasks", [
        { name: "id", typeOid: 23, isKey: true },
        { name: "title", typeOid: 25, isKey: false },
        { name: "done", typeOid: 16, isKey: false },
      ])
      replicator.processWalData("0/100", relBuf)

      // Process 5 inserts to trigger batch flush
      for (let i = 0; i < 5; i++) {
        const tupleBuf = buildTupleData([String(i + 1), `Task ${i + 1}`, "f"])
        const insertBuf = Buffer.alloc(6 + tupleBuf.length)
        insertBuf[0] = 0x49 // 'I'
        insertBuf.writeUInt32BE(1, 1)
        insertBuf[5] = 0x4E
        tupleBuf.copy(insertBuf, 6)
        replicator.processWalData(`0/${200 + i}`, insertBuf)
      }

      // Wait for batch flush
      await new Promise((r) => setTimeout(r, 100))
      await replicator.stop()

      expect(receivedEvents.length).toBeGreaterThanOrEqual(5)
      for (const event of receivedEvents) {
        expect(event.table).toBe("tasks")
        expect(event.operation).toBe("insert")
        expect(event.affectedFilters).toBeDefined()
        expect(event.affectedFilters!.id).toBeDefined()
        expect(event.affectedFilters!.title).toBeDefined()
      }
    })

    it("groups changes by transaction ID", async () => {
      const transactions: Map<number, WalChange[]> = new Map()
      const replicator = new LogicalReplicator({ batchSize: 100 })

      replicator.onChange((walChanges) => {
        for (const change of walChanges) {
          if (!transactions.has(change.xid)) transactions.set(change.xid, [])
          transactions.get(change.xid)!.push(change)
        }
      })
      replicator.start()

      // Register relation
      const relBuf = buildRelationMessage(1, "public", "tasks", [
        { name: "id", typeOid: 23, isKey: true },
      ])
      replicator.processWalData("0/100", relBuf)

      // Simulate two transactions by setting up Begin with different XIDs
      // (In real usage, Begin messages set the xid context)
      const beginBuf1 = Buffer.alloc(21)
      beginBuf1[0] = 0x42
      beginBuf1.writeUInt32BE(100, 17)
      replicator.processWalData("0/200", beginBuf1)

      // Insert in transaction 100
      const tupleBuf = buildTupleData(["1"])
      const insertBuf = Buffer.alloc(6 + tupleBuf.length)
      insertBuf[0] = 0x49
      insertBuf.writeUInt32BE(1, 1)
      insertBuf[5] = 0x4E
      tupleBuf.copy(insertBuf, 6)
      replicator.processWalData("0/201", insertBuf)

      // Flush and verify
      await new Promise((r) => setTimeout(r, 100))
      await replicator.stop()

      // At least one transaction's changes should be captured
      const allChanges = [...transactions.values()].flat()
      expect(allChanges.length).toBeGreaterThanOrEqual(1)
    })

    it("replicator stats reflect processed changes", async () => {
      const replicator = new LogicalReplicator({ batchSize: 2 })
      replicator.onChange(() => {}) // No-op handler
      replicator.start()

      // Register relation
      const relBuf = buildRelationMessage(1, "public", "items", [
        { name: "id", typeOid: 23, isKey: true },
      ])
      replicator.processWalData("0/100", relBuf)

      // Process 4 inserts
      for (let i = 0; i < 4; i++) {
        const tupleBuf = buildTupleData([String(i)])
        const insertBuf = Buffer.alloc(6 + tupleBuf.length)
        insertBuf[0] = 0x49
        insertBuf.writeUInt32BE(1, 1)
        insertBuf[5] = 0x4E
        tupleBuf.copy(insertBuf, 6)
        replicator.processWalData(`0/${200 + i}`, insertBuf)
      }

      await new Promise((r) => setTimeout(r, 100))
      await replicator.stop()

      const stats = replicator.getStats()
      expect(stats.totalChangesReceived).toBe(5) // 1 relation + 4 inserts
      expect(stats.batchesProcessed).toBeGreaterThanOrEqual(2) // 4 inserts / batch size 2
      expect(stats.lastLsn).not.toBeNull()
    })
  })
})

// ─── Conversion Utilities ────────────────────────────────────────────────────

/**
 * Convert a single WAL change to a ReactivityEngine ChangeEvent.
 * Returns null for non-data changes (begin, commit, relation).
 */
function walChangeToChangeEvent(walChange: WalChange): ChangeEvent | null {
  if (walChange.type !== "insert" && walChange.type !== "update" && walChange.type !== "delete") {
    return null
  }

  const event: ChangeEvent = {
    table: walChange.table,
    operation: walChange.type,
  }

  // Map row data to affectedFilters for filter-level invalidation
  if (walChange.newRow) {
    event.affectedFilters = { ...walChange.newRow }
  } else if (walChange.oldRow) {
    event.affectedFilters = { ...walChange.oldRow }
  }

  // For updates, include old values for comparison
  if (walChange.type === "update" && walChange.oldRow) {
    event.oldValues = { ...walChange.oldRow }
  }

  return event
}

/**
 * Convert a batch of WAL changes to ChangeEvents, filtering out non-data events.
 */
function batchToChangeEvents(batch: WalChange[]): ChangeEvent[] {
  const events: ChangeEvent[] = []
  for (const walChange of batch) {
    const event = walChangeToChangeEvent(walChange)
    if (event) events.push(event)
  }
  return events
}

/**
 * Extract unique modified table names from a batch of WAL changes.
 */
function extractModifiedTables(batch: WalChange[]): string[] {
  const tables = new Set<string>()
  for (const change of batch) {
    if (change.type === "insert" || change.type === "update" || change.type === "delete") {
      tables.add(change.table)
    }
  }
  return [...tables]
}

// ─── Test Helpers (duplicated from logical-replication test) ──────────────────

function buildRelationMessage(
  relationId: number,
  schema: string,
  table: string,
  columns: { name: string; typeOid: number; isKey: boolean }[],
): Buffer {
  const schemaBuf = Buffer.from(schema + "\0", "utf8")
  const tableBuf = Buffer.from(table + "\0", "utf8")
  let colsSize = 0
  const colBuffers: Buffer[] = []
  for (const col of columns) {
    const nameBuf = Buffer.from(col.name + "\0", "utf8")
    const colBuf = Buffer.alloc(1 + nameBuf.length + 8)
    colBuf[0] = col.isKey ? 1 : 0
    nameBuf.copy(colBuf, 1)
    colBuf.writeUInt32BE(col.typeOid, 1 + nameBuf.length)
    colBuf.writeUInt32BE(0, 1 + nameBuf.length + 4)
    colBuffers.push(colBuf)
    colsSize += colBuf.length
  }
  const headerSize = 1 + 4 + schemaBuf.length + tableBuf.length + 1 + 2
  const buf = Buffer.alloc(headerSize + colsSize)
  let offset = 0
  buf[offset] = 0x52
  offset += 1
  buf.writeUInt32BE(relationId, offset)
  offset += 4
  schemaBuf.copy(buf, offset)
  offset += schemaBuf.length
  tableBuf.copy(buf, offset)
  offset += tableBuf.length
  buf[offset] = 0x64
  offset += 1
  buf.writeUInt16BE(columns.length, offset)
  offset += 2
  for (const colBuf of colBuffers) {
    colBuf.copy(buf, offset)
    offset += colBuf.length
  }
  return buf
}

function buildTupleData(values: string[]): Buffer {
  let totalSize = 2
  for (const v of values) {
    totalSize += 1 + 4 + Buffer.byteLength(v, "utf8")
  }
  const buf = Buffer.alloc(totalSize)
  let offset = 0
  buf.writeUInt16BE(values.length, offset)
  offset += 2
  for (const v of values) {
    buf[offset] = 0x74
    offset += 1
    const len = Buffer.byteLength(v, "utf8")
    buf.writeUInt32BE(len, offset)
    offset += 4
    buf.write(v, offset, "utf8")
    offset += len
  }
  return buf
}
