import { describe, it, expect, beforeEach } from "vitest"
import {
  DeltaPatchEncoder,
  DeltaPatchDecoder,
  PatchAccumulator,
  encodeDeltaPatch,
  decodeDeltaPatch,
  computeChecksum,
} from "../ivm/delta-protocol.js"
import type { DeltaPatch } from "../ivm/delta-protocol.js"
import { RowLevelCdcAdapter } from "../cdc/row-level-cdc.js"
import { IvmPipeline } from "../ivm/ivm-pipeline.js"

// ─── DeltaPatchEncoder / Decoder ─────────────────────────────────────────────

describe("DeltaPatchEncoder / DeltaPatchDecoder", () => {
  let encoder: DeltaPatchEncoder
  let decoder: DeltaPatchDecoder

  beforeEach(() => {
    encoder = new DeltaPatchEncoder()
    decoder = new DeltaPatchDecoder()
  })

  it("round-trips a patch with inserts", () => {
    const patch: DeltaPatch = {
      viewId: "v1",
      sequence: 1,
      inserts: [{ id: "t1", title: "Task 1" }],
      deletes: [],
      updates: [],
      checksum: computeChecksum("test"),
    }

    const encoded = encoder.encode(patch)
    const decoded = decoder.decode(encoded)

    expect(decoded.viewId).toBe("v1")
    expect(decoded.sequence).toBe(1)
    expect(decoded.inserts).toHaveLength(1)
    expect(decoded.inserts[0].id).toBe("t1")
    expect(decoded.deletes).toHaveLength(0)
    expect(decoded.updates).toHaveLength(0)
    expect(decoded.checksum).toBe(patch.checksum)
  })

  it("round-trips a patch with deletes and updates", () => {
    const patch: DeltaPatch = {
      viewId: "v2",
      sequence: 5,
      inserts: [],
      deletes: [{ id: "t2" }],
      updates: [{ old: { id: "t3", title: "Old" }, new: { id: "t3", title: "New" } }],
      checksum: 12345,
    }

    const encoded = encoder.encode(patch)
    const decoded = decoder.decode(encoded)

    expect(decoded.viewId).toBe("v2")
    expect(decoded.sequence).toBe(5)
    expect(decoded.deletes).toHaveLength(1)
    expect(decoded.deletes[0].id).toBe("t2")
    expect(decoded.updates).toHaveLength(1)
    expect(decoded.updates[0].old.title).toBe("Old")
    expect(decoded.updates[0].new.title).toBe("New")
  })

  it("tracks encoder stats", () => {
    const patch: DeltaPatch = {
      viewId: "v1",
      sequence: 1,
      inserts: [{ id: "1" }],
      deletes: [],
      updates: [],
      checksum: 0,
    }

    encoder.encode(patch)
    encoder.encode(patch)

    const stats = encoder.getStats()
    expect(stats.totalEncoded).toBe(2)
    expect(stats.totalBytesEncoded).toBeGreaterThan(0)
  })

  it("tracks decoder stats", () => {
    const patch: DeltaPatch = {
      viewId: "v1",
      sequence: 1,
      inserts: [],
      deletes: [],
      updates: [],
      checksum: 0,
    }

    const encoded = encoder.encode(patch)
    decoder.decode(encoded)

    const stats = decoder.getStats()
    expect(stats.totalDecoded).toBe(1)
    expect(stats.totalBytesDecoded).toBeGreaterThan(0)
  })
})

describe("encodeDeltaPatch / decodeDeltaPatch convenience functions", () => {
  it("round-trips via convenience functions", () => {
    const patch: DeltaPatch = {
      viewId: "v1",
      sequence: 42,
      inserts: [{ id: "x" }],
      deletes: [],
      updates: [],
      checksum: 99,
    }

    const bytes = encodeDeltaPatch(patch)
    const decoded = decodeDeltaPatch(bytes)

    expect(decoded.viewId).toBe("v1")
    expect(decoded.sequence).toBe(42)
    expect(decoded.inserts[0].id).toBe("x")
  })
})

// ─── PatchAccumulator ────────────────────────────────────────────────────────

describe("PatchAccumulator", () => {
  let accumulator: PatchAccumulator

  beforeEach(() => {
    accumulator = new PatchAccumulator()
  })

  it("merges inserts from multiple patches", () => {
    accumulator.add({
      viewId: "v1",
      sequence: 1,
      inserts: [{ id: "t1" }],
      deletes: [],
      updates: [],
      checksum: 0,
    })
    accumulator.add({
      viewId: "v1",
      sequence: 2,
      inserts: [{ id: "t2" }],
      deletes: [],
      updates: [],
      checksum: 0,
    })

    const merged = accumulator.merge("v1")!
    expect(merged.inserts).toHaveLength(2)
    expect(merged.sequence).toBe(2)
  })

  it("cancels insert+delete pairs", () => {
    accumulator.add({
      viewId: "v1",
      sequence: 1,
      inserts: [{ id: "t1", title: "Task" }],
      deletes: [],
      updates: [],
      checksum: 0,
    })
    accumulator.add({
      viewId: "v1",
      sequence: 2,
      inserts: [],
      deletes: [{ id: "t1", title: "Task" }],
      updates: [],
      checksum: 0,
    })

    const merged = accumulator.merge("v1")!
    expect(merged.inserts).toHaveLength(0)
    expect(merged.deletes).toHaveLength(0)
  })

  it("mergeAll returns patches for all views", () => {
    accumulator.add({
      viewId: "v1",
      sequence: 1,
      inserts: [{ id: "t1" }],
      deletes: [],
      updates: [],
      checksum: 0,
    })
    accumulator.add({
      viewId: "v2",
      sequence: 1,
      inserts: [{ id: "t2" }],
      deletes: [],
      updates: [],
      checksum: 0,
    })

    const all = accumulator.mergeAll()
    expect(all).toHaveLength(2)
    expect(all.map((p) => p.viewId).sort()).toEqual(["v1", "v2"])
  })

  it("returns null for unknown view", () => {
    expect(accumulator.merge("nonexistent")).toBeNull()
  })

  it("clears accumulated patches", () => {
    accumulator.add({
      viewId: "v1",
      sequence: 1,
      inserts: [{ id: "t1" }],
      deletes: [],
      updates: [],
      checksum: 0,
    })
    expect(accumulator.size).toBe(1)

    accumulator.clear()
    expect(accumulator.size).toBe(0)
  })

  it("computes checksum on merged patch", () => {
    accumulator.add({
      viewId: "v1",
      sequence: 1,
      inserts: [{ id: "t1" }],
      deletes: [],
      updates: [],
      checksum: 0,
    })

    const merged = accumulator.merge("v1")!
    expect(merged.checksum).toBeGreaterThan(0)
  })
})

// ─── RowLevelCdcAdapter ──────────────────────────────────────────────────────

describe("RowLevelCdcAdapter", () => {
  let adapter: RowLevelCdcAdapter
  let processedTables: string[]
  let processedEvents: unknown[]

  beforeEach(() => {
    processedTables = []
    processedEvents = []
    adapter = new RowLevelCdcAdapter(async (tables, events) => {
      processedTables.push(...tables)
      processedEvents.push(...events)
    })
  })

  it("tracks row-level insert", () => {
    adapter.trackChange({
      table: "tasks",
      pk: "t1",
      operation: "insert",
      newValues: { id: "t1", title: "New Task" },
    })

    const batches = adapter.getBatches()
    expect(batches).toHaveLength(1)
    expect(batches[0].table).toBe("tasks")
    expect(batches[0].changes).toHaveLength(1)
    expect(batches[0].changes[0].pk).toBe("t1")
    expect(batches[0].changes[0].operation).toBe("insert")
  })

  it("detects changed columns on update", () => {
    adapter.trackChange({
      table: "tasks",
      pk: "t1",
      operation: "update",
      oldValues: { id: "t1", title: "Old", done: false },
      newValues: { id: "t1", title: "New", done: false },
    })

    const batches = adapter.getBatches()
    expect(batches[0].changes[0].changedColumns).toEqual(["title"])
  })

  it("batches changes by table", () => {
    adapter.trackChange({ table: "tasks", pk: "t1", operation: "insert", newValues: { id: "t1" } })
    adapter.trackChange({ table: "users", pk: "u1", operation: "insert", newValues: { id: "u1" } })
    adapter.trackChange({ table: "tasks", pk: "t2", operation: "insert", newValues: { id: "t2" } })

    const batches = adapter.getBatches()
    expect(batches).toHaveLength(2)

    const taskBatch = batches.find((b) => b.table === "tasks")!
    expect(taskBatch.changes).toHaveLength(2)
  })

  it("flushes and forwards to processChanges", async () => {
    adapter.trackChange({ table: "tasks", pk: "t1", operation: "insert", newValues: { id: "t1" } })

    const batches = await adapter.flush()
    expect(batches).toHaveLength(1)
    expect(processedTables).toContain("tasks")
    expect(processedEvents).toHaveLength(1)
  })

  it("computes affected subscriptions at row level", () => {
    adapter.addSubscription({
      id: "sub1",
      table: "tasks",
      columns: ["title"],
    })
    adapter.addSubscription({
      id: "sub2",
      table: "tasks",
      columns: ["done"],
    })

    const affected = adapter.computeAffectedSubscriptions({
      table: "tasks",
      pk: "t1",
      operation: "update",
      oldValues: { title: "Old", done: false },
      newValues: { title: "New", done: false },
      changedColumns: ["title"],
      timestamp: Date.now(),
    })

    expect(affected).toEqual(["sub1"])
  })

  it("computes affected subscriptions with predicate", () => {
    adapter.addSubscription({
      id: "sub1",
      table: "tasks",
      predicate: (row) => row.priority === "high",
    })

    const affected = adapter.computeAffectedSubscriptions({
      table: "tasks",
      pk: "t1",
      operation: "insert",
      oldValues: null,
      newValues: { id: "t1", priority: "high" },
      changedColumns: [],
      timestamp: Date.now(),
    })

    expect(affected).toEqual(["sub1"])
  })

  it("tracks stats", async () => {
    adapter.trackChange({ table: "tasks", pk: "t1", operation: "insert", newValues: { id: "t1" } })
    adapter.trackChange({
      table: "tasks",
      pk: "t2",
      operation: "update",
      oldValues: { id: "t2", title: "A" },
      newValues: { id: "t2", title: "B" },
    })

    await adapter.flush()

    const stats = adapter.getStats()
    expect(stats.eventsProcessed).toBe(2)
    expect(stats.rowLevelHits).toBe(2)
    expect(stats.batchesProcessed).toBe(1)
    expect(stats.status).toBe("streaming")
  })

  it("removes subscription", () => {
    adapter.addSubscription({ id: "sub1", table: "tasks" })
    adapter.removeSubscription("sub1")

    const affected = adapter.computeAffectedSubscriptions({
      table: "tasks",
      pk: "t1",
      operation: "insert",
      oldValues: null,
      newValues: { id: "t1" },
      changedColumns: [],
      timestamp: Date.now(),
    })

    expect(affected).toEqual([])
  })
})

// ─── IvmPipeline ─────────────────────────────────────────────────────────────

describe("IvmPipeline", () => {
  let pipeline: IvmPipeline

  beforeEach(() => {
    pipeline = new IvmPipeline()
  })

  it("processes insert through full pipeline", () => {
    pipeline.registerView({
      viewId: "v1",
      queryAst: { type: "scan", table: "tasks" },
      currentResult: [{ id: "t1" }],
    })

    const results = pipeline.processChange({
      table: "tasks",
      type: "insert",
      newRow: { id: "t2", title: "New Task" },
    })

    expect(results).toHaveLength(1)
    expect(results[0].usedDelta).toBe(true)
    expect(results[0].encoded).toBeInstanceOf(Uint8Array)
    expect(results[0].patch).not.toBeNull()
    expect(results[0].patch!.inserts).toHaveLength(1)
    expect(results[0].patch!.inserts[0].id).toBe("t2")
    expect(results[0].patch!.sequence).toBe(1)
  })

  it("increments sequence numbers", () => {
    pipeline.registerView({
      viewId: "v1",
      queryAst: { type: "scan", table: "tasks" },
      currentResult: [],
    })

    pipeline.processChange({ table: "tasks", type: "insert", newRow: { id: "t1" } })
    const results = pipeline.processChange({ table: "tasks", type: "insert", newRow: { id: "t2" } })

    expect(results[0].patch!.sequence).toBe(2)
  })

  it("returns null encoded for full-refresh views", () => {
    pipeline.registerView({
      viewId: "v1",
      queryAst: {
        type: "limit",
        source: { type: "scan", table: "tasks" },
        limit: 10,
      },
      currentResult: [],
    })

    const results = pipeline.processChange({
      table: "tasks",
      type: "insert",
      newRow: { id: "t1" },
    })

    expect(results).toHaveLength(1)
    expect(results[0].usedDelta).toBe(false)
    expect(results[0].encoded).toBeNull()
    expect(results[0].patch).toBeNull()
  })

  it("processes filter delta correctly", () => {
    pipeline.registerView({
      viewId: "v1",
      queryAst: {
        type: "filter",
        source: { type: "scan", table: "tasks" },
        predicate: { field: "done", operator: "=", value: false },
      },
      currentResult: [],
    })

    const results = pipeline.processChange({
      table: "tasks",
      type: "insert",
      newRow: { id: "t1", done: false },
    })

    expect(results[0].patch!.inserts).toHaveLength(1)

    // Insert that doesn't match filter
    const results2 = pipeline.processChange({
      table: "tasks",
      type: "insert",
      newRow: { id: "t2", done: true },
    })

    expect(results2[0].patch!.inserts).toHaveLength(0)
  })

  it("processes batch changes", () => {
    pipeline.registerView({
      viewId: "v1",
      queryAst: { type: "scan", table: "tasks" },
      currentResult: [],
    })

    const results = pipeline.processBatch([
      { table: "tasks", type: "insert", newRow: { id: "t1" } },
      { table: "tasks", type: "insert", newRow: { id: "t2" } },
    ])

    expect(results).toHaveLength(2)
    expect(results.every((r) => r.usedDelta)).toBe(true)
  })

  it("tracks efficiency metrics", () => {
    pipeline.registerView({
      viewId: "v1",
      queryAst: { type: "scan", table: "tasks" },
      currentResult: [],
    })
    pipeline.registerView({
      viewId: "v2",
      queryAst: {
        type: "limit",
        source: { type: "scan", table: "tasks" },
        limit: 5,
      },
      currentResult: [],
    })

    pipeline.processChange({ table: "tasks", type: "insert", newRow: { id: "t1" } })

    const metrics = pipeline.getEfficiencyMetrics()
    expect(metrics.deltaApplied).toBe(1)
    expect(metrics.fullRefreshes).toBe(1)
    expect(metrics.totalChangesProcessed).toBe(1)
    expect(metrics.efficiencyRatio).toBe(1)
  })

  it("encoded patch round-trips correctly", () => {
    const decoder = new DeltaPatchDecoder()
    pipeline.registerView({
      viewId: "v1",
      queryAst: { type: "scan", table: "tasks" },
      currentResult: [],
    })

    const results = pipeline.processChange({
      table: "tasks",
      type: "insert",
      newRow: { id: "t1", title: "Hello" },
    })

    const decoded = decoder.decode(results[0].encoded!)
    expect(decoded.viewId).toBe("v1")
    expect(decoded.inserts[0].title).toBe("Hello")
  })

  it("unregisters a view", () => {
    pipeline.registerView({
      viewId: "v1",
      queryAst: { type: "scan", table: "tasks" },
      currentResult: [],
    })
    pipeline.unregisterView("v1")

    const results = pipeline.processChange({
      table: "tasks",
      type: "insert",
      newRow: { id: "t1" },
    })

    expect(results).toHaveLength(0)
  })

  it("updates cached result through pipeline", () => {
    pipeline.registerView({
      viewId: "v1",
      queryAst: { type: "scan", table: "tasks" },
      currentResult: [],
    })

    pipeline.processChange({ table: "tasks", type: "insert", newRow: { id: "t1" } })
    expect(pipeline.getViewResult("v1")).toHaveLength(1)
  })

  it("returns IVM stats", () => {
    pipeline.registerView({
      viewId: "v1",
      queryAst: { type: "scan", table: "tasks" },
      currentResult: [],
    })

    pipeline.processChange({ table: "tasks", type: "insert", newRow: { id: "t1" } })

    const stats = pipeline.getIvmStats()
    expect(stats.totalViews).toBe(1)
    expect(stats.deltaApplied).toBe(1)
  })
})
