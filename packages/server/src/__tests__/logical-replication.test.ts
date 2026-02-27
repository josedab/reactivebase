import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  LogicalReplicator,
  WalDecoder,
  ChangeBatcher,
  parseLsn,
  formatLsn,
  compareLsn,
} from "../logical-replication/logical-replication.js"
import type { WalChange } from "../logical-replication/logical-replication.js"

// ─── LSN Utilities ───────────────────────────────────────────────────────────

describe("LSN Utilities", () => {
  it("parses LSN strings to bigint", () => {
    expect(parseLsn("0/16B3748")).toBe(BigInt(0x16b3748))
    expect(parseLsn("1/0")).toBe(BigInt(0x100000000))
    expect(parseLsn("0/0")).toBe(0n)
  })

  it("formats bigint back to LSN string", () => {
    expect(formatLsn(BigInt(0x16b3748))).toBe("0/16B3748")
    expect(formatLsn(BigInt(0x100000000))).toBe("1/0")
  })

  it("compares LSN strings correctly", () => {
    expect(compareLsn("0/16B3748", "0/16B3749")).toBe(-1)
    expect(compareLsn("0/16B3748", "0/16B3748")).toBe(0)
    expect(compareLsn("1/0", "0/FFFFFFFF")).toBe(1)
  })

  it("roundtrips LSN parse/format", () => {
    const lsn = "A/1234ABCD"
    expect(formatLsn(parseLsn(lsn))).toBe(lsn)
  })
})

// ─── WalDecoder ──────────────────────────────────────────────────────────────

describe("WalDecoder", () => {
  let decoder: WalDecoder

  beforeEach(() => {
    decoder = new WalDecoder()
  })

  it("returns null for empty buffer", () => {
    expect(decoder.decode("0/0", Buffer.alloc(0))).toBeNull()
  })

  it("returns null for unknown message types", () => {
    const buf = Buffer.from([0xff, 0x00, 0x00])
    expect(decoder.decode("0/0", buf)).toBeNull()
  })

  it("decodes Begin message", () => {
    // Build a Begin message: [B][finalLSN:8][commitTimestamp:8][xid:4]
    const buf = Buffer.alloc(21)
    buf[0] = 0x42 // 'B'
    buf.writeBigInt64BE(0n, 1) // final LSN
    buf.writeBigInt64BE(0n, 9) // commit timestamp
    buf.writeUInt32BE(42, 17) // xid

    const change = decoder.decode("0/100", buf)
    expect(change).not.toBeNull()
    expect(change!.type).toBe("begin")
    expect(change!.xid).toBe(42)
  })

  it("decodes Commit message", () => {
    // First send a Begin to set xid
    const beginBuf = Buffer.alloc(21)
    beginBuf[0] = 0x42
    beginBuf.writeUInt32BE(99, 17)
    decoder.decode("0/100", beginBuf)

    // Then a Commit
    const commitBuf = Buffer.alloc(1)
    commitBuf[0] = 0x43 // 'C'
    const change = decoder.decode("0/200", commitBuf)
    expect(change).not.toBeNull()
    expect(change!.type).toBe("commit")
    expect(change!.xid).toBe(99)
  })

  it("decodes Relation message and caches metadata", () => {
    const buf = buildRelationMessage(1, "public", "tasks", [
      { name: "id", typeOid: 23, isKey: true },
      { name: "title", typeOid: 25, isKey: false },
    ])

    const change = decoder.decode("0/100", buf)
    expect(change).not.toBeNull()
    expect(change!.type).toBe("relation")
    expect(change!.table).toBe("tasks")
    expect(change!.schema).toBe("public")
    expect(change!.columns).toHaveLength(2)
    expect(change!.columns![0].name).toBe("id")
    expect(change!.columns![1].name).toBe("title")
  })

  it("decodes Insert message using cached relation", () => {
    // First register a relation
    const relBuf = buildRelationMessage(1, "public", "users", [
      { name: "id", typeOid: 23, isKey: true },
      { name: "name", typeOid: 25, isKey: false },
    ])
    decoder.decode("0/100", relBuf)

    // Build Insert message: [I][relationId:4][N][tuple]
    const tupleBuf = buildTupleData(["42", "Alice"])
    const insertBuf = Buffer.alloc(6 + tupleBuf.length)
    insertBuf[0] = 0x49 // 'I'
    insertBuf.writeUInt32BE(1, 1) // relation ID
    insertBuf[5] = 0x4e // 'N' for new tuple
    tupleBuf.copy(insertBuf, 6)

    const change = decoder.decode("0/200", insertBuf)
    expect(change).not.toBeNull()
    expect(change!.type).toBe("insert")
    expect(change!.table).toBe("users")
    expect(change!.newRow).toBeDefined()
    expect(change!.newRow!.id).toBe(42) // parsed as integer (OID 23)
    expect(change!.newRow!.name).toBe("Alice")
  })

  it("returns null for Insert with unknown relation", () => {
    const buf = Buffer.alloc(6)
    buf[0] = 0x49
    buf.writeUInt32BE(999, 1) // unknown relation ID
    buf[5] = 0x4e
    expect(decoder.decode("0/100", buf)).toBeNull()
  })

  it("tracks relations via getRelations()", () => {
    const relBuf = buildRelationMessage(5, "public", "items", [{ name: "id", typeOid: 23, isKey: true }])
    decoder.decode("0/100", relBuf)

    const rels = decoder.getRelations()
    expect(rels.size).toBe(1)
    expect(rels.get(5)!.table).toBe("items")
  })

  it("clears state on reset", () => {
    const relBuf = buildRelationMessage(1, "public", "tasks", [{ name: "id", typeOid: 23, isKey: true }])
    decoder.decode("0/100", relBuf)
    expect(decoder.getRelations().size).toBe(1)

    decoder.reset()
    expect(decoder.getRelations().size).toBe(0)
  })
})

// ─── ChangeBatcher ───────────────────────────────────────────────────────────

describe("ChangeBatcher", () => {
  it("flushes when batch size reached", async () => {
    const received: WalChange[][] = []
    const batcher = new ChangeBatcher(3, 100_000) // large interval so only size triggers
    batcher.onFlush((changes) => {
      received.push([...changes])
    })

    for (let i = 0; i < 3; i++) {
      batcher.add(makeChange("insert", "tasks", `0/${i}`))
    }

    // Wait a tick for the async flush
    await new Promise((r) => setTimeout(r, 10))
    expect(received).toHaveLength(1)
    expect(received[0]).toHaveLength(3)
  })

  it("flushes on interval", async () => {
    const received: WalChange[][] = []
    const batcher = new ChangeBatcher(1000, 30)
    batcher.onFlush((changes) => {
      received.push([...changes])
    })

    batcher.start()
    batcher.add(makeChange("insert", "tasks", "0/1"))

    await new Promise((r) => setTimeout(r, 80))
    batcher.stop()

    expect(received.length).toBeGreaterThanOrEqual(1)
    expect(received[0]).toHaveLength(1)
  })

  it("reports pending count", () => {
    const batcher = new ChangeBatcher(100, 100_000)
    expect(batcher.pending).toBe(0)

    batcher.add(makeChange("insert", "tasks", "0/1"))
    batcher.add(makeChange("update", "tasks", "0/2"))
    expect(batcher.pending).toBe(2)
  })

  it("manual flush drains buffer", async () => {
    const received: WalChange[][] = []
    const batcher = new ChangeBatcher(100, 100_000)
    batcher.onFlush((changes) => {
      received.push([...changes])
    })

    batcher.add(makeChange("insert", "tasks", "0/1"))
    await batcher.flush()

    expect(received).toHaveLength(1)
    expect(batcher.pending).toBe(0)
  })

  it("does not flush when empty", async () => {
    const handler = vi.fn()
    const batcher = new ChangeBatcher(100, 100_000)
    batcher.onFlush(handler)

    await batcher.flush()
    expect(handler).not.toHaveBeenCalled()
  })
})

// ─── LogicalReplicator ──────────────────────────────────────────────────────

describe("LogicalReplicator", () => {
  it("generates publication SQL for all tables", () => {
    const replicator = new LogicalReplicator({ publicationName: "my_pub" })
    expect(replicator.generatePublicationSQL()).toBe("CREATE PUBLICATION my_pub FOR ALL TABLES;")
  })

  it("generates publication SQL for specific tables", () => {
    const replicator = new LogicalReplicator({
      publicationName: "my_pub",
      tables: ["tasks", "users"],
    })
    expect(replicator.generatePublicationSQL()).toBe('CREATE PUBLICATION my_pub FOR TABLE "tasks", "users";')
  })

  it("generates replication slot SQL", () => {
    const replicator = new LogicalReplicator({ slotName: "my_slot" })
    const query = replicator.generateSlotSQL()
    expect(query.text).toContain("pg_create_logical_replication_slot")
    expect(query.text).toContain("pgoutput")
    expect(query.values).toContain("my_slot")
  })

  it("generates replica identity SQL", () => {
    const replicator = new LogicalReplicator()
    const sqls = replicator.generateReplicaIdentitySQL(["tasks", "users"])
    expect(sqls).toHaveLength(2)
    expect(sqls[0]).toContain("REPLICA IDENTITY FULL")
    expect(sqls[0]).toContain("tasks")
  })

  it("generates full setup SQL", () => {
    const replicator = new LogicalReplicator({
      tables: ["tasks", "users"],
      includeOldTuples: true,
    })
    const sqls = replicator.generateSetupSQL()
    expect(sqls.length).toBeGreaterThanOrEqual(3) // publication + slot + 2 replica identity
  })

  it("generates teardown SQL", () => {
    const replicator = new LogicalReplicator()
    const sqls = replicator.generateTeardownSQL()
    expect(sqls).toHaveLength(2)
    const dropSlot = sqls[0] as { text: string; values: unknown[] }
    expect(dropSlot.text).toContain("pg_drop_replication_slot")
    expect(sqls[1]).toContain("DROP PUBLICATION")
  })

  it("starts and stops correctly", async () => {
    const statuses: string[] = []
    const replicator = new LogicalReplicator({
      onStatusChange: (s) => statuses.push(s),
    })

    replicator.start()
    expect(replicator.getStatus()).toBe("streaming")

    await replicator.stop()
    expect(replicator.getStatus()).toBe("stopped")
    expect(statuses).toContain("streaming")
    expect(statuses).toContain("stopped")
  })

  it("processes WAL data through decoder", () => {
    const replicator = new LogicalReplicator()
    const _decoder = replicator.getDecoder()

    // Register a relation via the decoder
    const relBuf = buildRelationMessage(1, "public", "tasks", [{ name: "id", typeOid: 23, isKey: true }])
    replicator.processWalData("0/100", relBuf)

    // Process an insert
    const tupleBuf = buildTupleData(["1"])
    const insertBuf = Buffer.alloc(6 + tupleBuf.length)
    insertBuf[0] = 0x49 // 'I'
    insertBuf.writeUInt32BE(1, 1)
    insertBuf[5] = 0x4e
    tupleBuf.copy(insertBuf, 6)

    const change = replicator.processWalData("0/200", insertBuf)
    expect(change).not.toBeNull()
    expect(change!.type).toBe("insert")
    expect(replicator.getStats().totalChangesReceived).toBe(2) // relation + insert
  })

  it("delivers batched changes to handler", async () => {
    const received: WalChange[][] = []
    const replicator = new LogicalReplicator({ batchSize: 2 })
    replicator.onChange((changes) => {
      received.push([...changes])
    })
    replicator.start()

    // Register relation
    const relBuf = buildRelationMessage(1, "public", "tasks", [{ name: "id", typeOid: 23, isKey: true }])
    replicator.processWalData("0/100", relBuf)

    // Send 2 inserts to trigger batch
    for (let i = 0; i < 2; i++) {
      const tupleBuf = buildTupleData([String(i)])
      const insertBuf = Buffer.alloc(6 + tupleBuf.length)
      insertBuf[0] = 0x49
      insertBuf.writeUInt32BE(1, 1)
      insertBuf[5] = 0x4e
      tupleBuf.copy(insertBuf, 6)
      replicator.processWalData(`0/${200 + i}`, insertBuf)
    }

    await new Promise((r) => setTimeout(r, 100))
    await replicator.stop()

    expect(received.length).toBeGreaterThanOrEqual(1)
  })

  it("tracks confirmed LSN", () => {
    const replicator = new LogicalReplicator()
    expect(replicator.getLastConfirmedLsn()).toBeNull()

    replicator.confirmLsn("0/16B3748")
    expect(replicator.getLastConfirmedLsn()).toBe("0/16B3748")
  })

  it("reports uptime after start", async () => {
    const replicator = new LogicalReplicator()
    expect(replicator.getStats().uptime).toBe(0)

    replicator.start()
    await new Promise((r) => setTimeout(r, 50))
    expect(replicator.getStats().uptime).toBeGreaterThan(0)
    await replicator.stop()
  })
})

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeChange(type: WalChange["type"], table: string, lsn: string): WalChange {
  return {
    lsn,
    xid: 1,
    timestamp: new Date(),
    type,
    schema: "public",
    table,
  }
}

function buildRelationMessage(
  relationId: number,
  schema: string,
  table: string,
  columns: { name: string; typeOid: number; isKey: boolean }[],
): Buffer {
  const schemaBuf = Buffer.from(schema + "\0", "utf8")
  const tableBuf = Buffer.from(table + "\0", "utf8")
  // [R][relationId:4][schema\0][table\0][replicaIdentity:1][numCols:2]
  // per column: [flags:1][name\0][typeOid:4][typeMod:4]
  let colsSize = 0
  const colBuffers: Buffer[] = []
  for (const col of columns) {
    const nameBuf = Buffer.from(col.name + "\0", "utf8")
    const colBuf = Buffer.alloc(1 + nameBuf.length + 8)
    colBuf[0] = col.isKey ? 1 : 0
    nameBuf.copy(colBuf, 1)
    colBuf.writeUInt32BE(col.typeOid, 1 + nameBuf.length)
    colBuf.writeUInt32BE(0, 1 + nameBuf.length + 4) // type modifier
    colBuffers.push(colBuf)
    colsSize += colBuf.length
  }

  const headerSize = 1 + 4 + schemaBuf.length + tableBuf.length + 1 + 2
  const buf = Buffer.alloc(headerSize + colsSize)
  let offset = 0

  buf[offset] = 0x52 // 'R'
  offset += 1
  buf.writeUInt32BE(relationId, offset)
  offset += 4
  schemaBuf.copy(buf, offset)
  offset += schemaBuf.length
  tableBuf.copy(buf, offset)
  offset += tableBuf.length
  buf[offset] = 0x64 // 'd' = default replica identity
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
  // [numCols:2] per column: [type:1 = 't'][len:4][data]
  let totalSize = 2
  for (const v of values) {
    totalSize += 1 + 4 + Buffer.byteLength(v, "utf8")
  }

  const buf = Buffer.alloc(totalSize)
  let offset = 0
  buf.writeUInt16BE(values.length, offset)
  offset += 2

  for (const v of values) {
    buf[offset] = 0x74 // 't' = text value
    offset += 1
    const len = Buffer.byteLength(v, "utf8")
    buf.writeUInt32BE(len, offset)
    offset += 4
    buf.write(v, offset, "utf8")
    offset += len
  }

  return buf
}
