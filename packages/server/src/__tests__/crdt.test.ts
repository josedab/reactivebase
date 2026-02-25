import { describe, it, expect, beforeEach } from "vitest"
import {
  CrdtEngine,
  CrdtError,
  generateCrdtTableSQL,
  buildUpsertDocumentSQL,
  buildInsertOperationSQL,
  buildGetDocumentSQL,
  buildGetOperationsSinceSQL,
  buildCompactOperationsSQL,
} from "../crdt/crdt.js"
import type { CrdtOperation } from "../crdt/crdt.js"

describe("CrdtEngine", () => {
  let engine: CrdtEngine

  beforeEach(() => {
    engine = new CrdtEngine({ nodeId: "node-a" })
  })

  describe("document lifecycle", () => {
    it("creates and retrieves a document", () => {
      const doc = engine.createDocument("doc-1", "lww-register")
      expect(doc.id).toBe("doc-1")
      expect(doc.type).toBe("lww-register")
      expect(engine.documentCount).toBe(1)
    })

    it("throws on duplicate document creation", () => {
      engine.createDocument("doc-1", "lww-register")
      expect(() => engine.createDocument("doc-1", "lww-register")).toThrow(CrdtError)
    })

    it("gets existing document", () => {
      engine.createDocument("doc-1", "lww-register")
      const doc = engine.getDocument("doc-1")
      expect(doc.id).toBe("doc-1")
    })

    it("throws when getting non-existent document", () => {
      expect(() => engine.getDocument("missing")).toThrow(CrdtError)
    })

    it("checks document existence", () => {
      engine.createDocument("doc-1", "lww-register")
      expect(engine.hasDocument("doc-1")).toBe(true)
      expect(engine.hasDocument("missing")).toBe(false)
    })

    it("deletes a document", () => {
      engine.createDocument("doc-1", "lww-register")
      engine.deleteDocument("doc-1")
      expect(engine.hasDocument("doc-1")).toBe(false)
      expect(engine.documentCount).toBe(0)
    })

    it("loads from snapshot", () => {
      const doc = engine.loadDocument({
        docId: "restored",
        type: "g-counter",
        state: 0,
        clock: 5,
        operationCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      expect(doc.id).toBe("restored")
      expect(doc.clock).toBe(5)
    })
  })

  describe("LWW-Register", () => {
    it("sets and gets values", () => {
      const doc = engine.createDocument("lww-1", "lww-register")
      doc.set("title", "Hello")
      doc.set("count", 42)

      expect(doc.get("title")).toBe("Hello")
      expect(doc.get("count")).toBe(42)
    })

    it("overwrites values on same key", () => {
      const doc = engine.createDocument("lww-1", "lww-register")
      doc.set("title", "First")
      doc.set("title", "Second")
      expect(doc.get("title")).toBe("Second")
    })

    it("serializes state as object", () => {
      const doc = engine.createDocument("lww-1", "lww-register")
      doc.set("a", 1)
      doc.set("b", "two")

      const snapshot = engine.getSnapshot("lww-1")
      expect(snapshot.state).toEqual({ a: 1, b: "two" })
    })

    it("rejects non-lww operations", () => {
      const doc = engine.createDocument("lww-1", "lww-register")
      expect(() => doc.increment()).toThrow(CrdtError)
    })
  })

  describe("G-Counter", () => {
    it("increments and reads value", () => {
      const doc = engine.createDocument("gc-1", "g-counter")
      doc.increment(5)
      doc.increment(3)

      const snapshot = engine.getSnapshot("gc-1")
      expect(snapshot.state).toBe(8)
    })

    it("rejects negative increments", () => {
      const doc = engine.createDocument("gc-1", "g-counter")
      expect(() => doc.increment(-1)).toThrow("G-Counter cannot be decremented")
    })

    it("handles multi-node counting", () => {
      const engineA = new CrdtEngine({ nodeId: "a" })
      const engineB = new CrdtEngine({ nodeId: "b" })

      const ops: CrdtOperation[] = []
      engineA["options"].onOperation = (op) => ops.push(op)

      const docA = engineA.createDocument("gc", "g-counter")
      docA.increment(5)

      engineB.createDocument("gc", "g-counter")
      const docB = engineB.getDocument("gc")
      docB.increment(3)

      // Apply A's ops to B
      for (const op of ops) {
        engineB.applyRemoteOperation(op)
      }

      const snap = engineB.getSnapshot("gc")
      expect(snap.state).toBe(8)
    })
  })

  describe("PN-Counter", () => {
    it("increments and decrements", () => {
      const doc = engine.createDocument("pn-1", "pn-counter")
      doc.increment(10)
      doc.decrement(3)

      const snapshot = engine.getSnapshot("pn-1")
      expect(snapshot.state).toBe(7)
    })

    it("handles negative totals", () => {
      const doc = engine.createDocument("pn-1", "pn-counter")
      doc.decrement(5)
      const snapshot = engine.getSnapshot("pn-1")
      expect(snapshot.state).toBe(-5)
    })
  })

  describe("OR-Set", () => {
    it("adds and reads elements", () => {
      const doc = engine.createDocument("set-1", "or-set")
      doc.add("apple")
      doc.add("banana")

      const snapshot = engine.getSnapshot("set-1")
      const state = snapshot.state as unknown[]
      expect(state).toContain("apple")
      expect(state).toContain("banana")
    })

    it("removes elements", () => {
      const doc = engine.createDocument("set-1", "or-set")
      doc.add("apple")
      doc.add("banana")
      doc.remove("apple")

      const snapshot = engine.getSnapshot("set-1")
      const state = snapshot.state as unknown[]
      expect(state).not.toContain("apple")
      expect(state).toContain("banana")
    })
  })

  describe("RGA (text)", () => {
    it("inserts characters in order", () => {
      const doc = engine.createDocument("rga-1", "rga")
      const op1 = doc.insertAt(null, "H")
      const _op2 = doc.insertAt(op1.data.positionId as string, "i")

      const snapshot = engine.getSnapshot("rga-1")
      expect(snapshot.state).toBe("Hi")
    })

    it("deletes characters", () => {
      const doc = engine.createDocument("rga-1", "rga")
      const op1 = doc.insertAt(null, "H")
      doc.insertAt(op1.data.positionId as string, "i")
      doc.deleteAt(op1.data.positionId as string)

      const snapshot = engine.getSnapshot("rga-1")
      expect(snapshot.state).toBe("i")
    })
  })

  describe("remote operations", () => {
    it("applies remote operations to existing documents", () => {
      engine.createDocument("doc-1", "lww-register")

      engine.applyRemoteOperation({
        docId: "doc-1",
        type: "lww-register",
        operationId: "1:node-b",
        nodeId: "node-b",
        timestamp: Date.now(),
        clock: 1,
        data: { kind: "lww-set", key: "remote", value: "hello" },
      })

      const doc = engine.getDocument("doc-1")
      expect(doc.get("remote")).toBe("hello")
    })

    it("auto-creates documents for remote ops", () => {
      engine.applyRemoteOperation({
        docId: "auto-doc",
        type: "g-counter",
        operationId: "1:node-b",
        nodeId: "node-b",
        timestamp: Date.now(),
        clock: 1,
        data: { kind: "g-increment", amount: 10 },
      })

      expect(engine.hasDocument("auto-doc")).toBe(true)
      const snap = engine.getSnapshot("auto-doc")
      expect(snap.state).toBe(10)
    })
  })

  describe("subscriptions", () => {
    it("notifies listeners on state change", () => {
      const states: unknown[] = []
      engine.createDocument("doc-1", "g-counter")
      engine.subscribe("doc-1", (state) => states.push(state))

      const doc = engine.getDocument("doc-1")
      doc.increment(5)
      doc.increment(3)

      expect(states).toEqual([5, 8])
    })

    it("unsubscribes correctly", () => {
      const states: unknown[] = []
      engine.createDocument("doc-1", "g-counter")
      const unsub = engine.subscribe("doc-1", (state) => states.push(state))

      const doc = engine.getDocument("doc-1")
      doc.increment(1)
      unsub()
      doc.increment(1)

      expect(states).toHaveLength(1)
    })
  })

  describe("compaction", () => {
    it("compacts operation log", () => {
      engine.createDocument("doc-1", "g-counter")
      const doc = engine.getDocument("doc-1")

      for (let i = 0; i < 10; i++) doc.increment(1)

      const removed = engine.compact("doc-1")
      expect(removed).toBe(10)

      // State is preserved after compaction
      const snap = engine.getSnapshot("doc-1")
      expect(snap.state).toBe(10)
      expect(snap.operationCount).toBe(0)
    })
  })
})

describe("CRDT persistence SQL", () => {
  it("generates table creation SQL", () => {
    const sql = generateCrdtTableSQL()
    expect(sql).toContain("_reactivebase_crdt_documents")
    expect(sql).toContain("_reactivebase_crdt_operations")
    expect(sql).toContain("CREATE INDEX")
  })

  it("builds upsert document SQL", () => {
    const { sql, params } = buildUpsertDocumentSQL("doc-1", "lww-register", {}, 1, "node-a", 1)
    expect(sql).toContain("INSERT INTO _reactivebase_crdt_documents")
    expect(sql).toContain("ON CONFLICT")
    expect(params[0]).toBe("doc-1")
  })

  it("builds insert operation SQL", () => {
    const { sql, params } = buildInsertOperationSQL({
      docId: "doc-1",
      type: "lww-register",
      operationId: "1:node-a",
      nodeId: "node-a",
      timestamp: 123456,
      clock: 1,
      data: { kind: "lww-set", key: "k", value: "v" },
    })
    expect(sql).toContain("INSERT INTO _reactivebase_crdt_operations")
    expect(params[0]).toBe("1:node-a")
  })

  it("builds get document SQL", () => {
    const { sql, params } = buildGetDocumentSQL("doc-1")
    expect(sql).toContain("SELECT * FROM _reactivebase_crdt_documents")
    expect(params).toEqual(["doc-1"])
  })

  it("builds get operations since SQL", () => {
    const { sql, params } = buildGetOperationsSinceSQL("doc-1", 5)
    expect(sql).toContain("clock > $2")
    expect(params).toEqual(["doc-1", 5])
  })

  it("builds compact operations SQL", () => {
    const { sql, params } = buildCompactOperationsSQL("doc-1", 10)
    expect(sql).toContain("DELETE FROM _reactivebase_crdt_operations")
    expect(params).toEqual(["doc-1", 10])
  })
})
