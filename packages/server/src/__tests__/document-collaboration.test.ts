import { describe, it, expect } from "vitest"
import { DocumentCollaboration, generateCollabDocTableSQL } from "../collaboration/document-collaboration.js"

describe("DocumentCollaboration", () => {
  function createEngine() {
    return new DocumentCollaboration()
  }

  describe("document lifecycle", () => {
    it("creates a document", () => {
      const engine = createEngine()
      const doc = engine.createDocument("doc-1", "richtext")
      expect(doc.id).toBe("doc-1")
      expect(doc.type).toBe("richtext")
      expect(doc.version).toBe(0)
    })

    it("prevents duplicate document IDs", () => {
      const engine = createEngine()
      engine.createDocument("doc-1")
      expect(() => engine.createDocument("doc-1")).toThrow("already exists")
    })

    it("retrieves a document", () => {
      const engine = createEngine()
      engine.createDocument("doc-1")
      expect(engine.getDocument("doc-1")).toBeDefined()
      expect(engine.getDocument("nonexistent")).toBeUndefined()
    })

    it("deletes a document", () => {
      const engine = createEngine()
      engine.createDocument("doc-1")
      engine.deleteDocument("doc-1")
      expect(engine.getDocument("doc-1")).toBeUndefined()
    })

    it("lists all documents", () => {
      const engine = createEngine()
      engine.createDocument("doc-1")
      engine.createDocument("doc-2")
      expect(engine.listDocuments()).toHaveLength(2)
    })
  })

  describe("updates", () => {
    it("applies an update and increments version", () => {
      const engine = createEngine()
      engine.createDocument("doc-1")

      const update = engine.applyUpdate("doc-1", new Uint8Array([1, 2, 3]), "user-1")
      expect(update.version).toBe(1)
      expect(update.clientId).toBe("user-1")

      const doc = engine.getDocument("doc-1")!
      expect(doc.version).toBe(1)
      expect(doc.lastModifiedBy).toBe("user-1")
    })

    it("throws for nonexistent document", () => {
      const engine = createEngine()
      expect(() => engine.applyUpdate("nonexistent", new Uint8Array([1]), "u1")).toThrow("not found")
    })

    it("retrieves updates since a version", () => {
      const engine = createEngine()
      engine.createDocument("doc-1")
      engine.applyUpdate("doc-1", new Uint8Array([1]), "u1")
      engine.applyUpdate("doc-1", new Uint8Array([2]), "u1")
      engine.applyUpdate("doc-1", new Uint8Array([3]), "u2")

      const since1 = engine.getUpdates("doc-1", 1)
      expect(since1).toHaveLength(2)
      expect(since1[0].version).toBe(2)
    })

    it("notifies on update", () => {
      const updates: unknown[] = []
      const engine = new DocumentCollaboration({
        onUpdate: (_, update) => updates.push(update),
      })
      engine.createDocument("doc-1")
      engine.applyUpdate("doc-1", new Uint8Array([1]), "u1")
      expect(updates).toHaveLength(1)
    })
  })

  describe("undo/redo", () => {
    it("undoes the last operation", () => {
      const engine = createEngine()
      engine.createDocument("doc-1")
      engine.applyUpdate("doc-1", new Uint8Array([1, 2, 3]), "u1")

      const undone = engine.undo("doc-1", "u1")
      expect(undone).not.toBeNull()
      expect(undone!.isUndo).toBe(true)
    })

    it("returns null when nothing to undo", () => {
      const engine = createEngine()
      engine.createDocument("doc-1")
      expect(engine.undo("doc-1", "u1")).toBeNull()
    })

    it("tracks undo/redo stack sizes", () => {
      const engine = createEngine()
      engine.createDocument("doc-1")
      engine.applyUpdate("doc-1", new Uint8Array([1]), "u1")
      engine.applyUpdate("doc-1", new Uint8Array([2]), "u1")

      expect(engine.getUndoStackSize("doc-1", "u1")).toBe(2)
      engine.undo("doc-1", "u1")
      expect(engine.getUndoStackSize("doc-1", "u1")).toBe(1)
      expect(engine.getRedoStackSize("doc-1", "u1")).toBe(1)
    })

    it("redo restores undone operation", () => {
      const engine = createEngine()
      engine.createDocument("doc-1")
      engine.applyUpdate("doc-1", new Uint8Array([1]), "u1")
      engine.undo("doc-1", "u1")
      const redone = engine.redo("doc-1", "u1")
      expect(redone).not.toBeNull()
    })
  })

  describe("snapshots", () => {
    it("creates and retrieves snapshots", () => {
      const engine = createEngine()
      engine.createDocument("doc-1")
      engine.applyUpdate("doc-1", new Uint8Array([1, 2]), "u1")

      const snapshot = engine.createSnapshot("doc-1", "checkpoint-1")
      expect(snapshot.version).toBe(1)
      expect(snapshot.label).toBe("checkpoint-1")

      const snapshots = engine.getSnapshots("doc-1")
      expect(snapshots).toHaveLength(1)
    })

    it("restores from a snapshot", () => {
      const engine = createEngine()
      engine.createDocument("doc-1")
      engine.applyUpdate("doc-1", new Uint8Array([1]), "u1")
      engine.createSnapshot("doc-1")
      engine.applyUpdate("doc-1", new Uint8Array([2]), "u1")
      engine.applyUpdate("doc-1", new Uint8Array([3]), "u1")

      engine.restoreSnapshot("doc-1", 1)
      const doc = engine.getDocument("doc-1")!
      expect(doc.version).toBe(1)
    })

    it("throws when snapshot not found", () => {
      const engine = createEngine()
      engine.createDocument("doc-1")
      expect(() => engine.restoreSnapshot("doc-1", 999)).toThrow("not found")
    })

    it("limits snapshot count", () => {
      const engine = new DocumentCollaboration({ maxSnapshots: 3 })
      engine.createDocument("doc-1")

      for (let i = 0; i < 5; i++) {
        engine.applyUpdate("doc-1", new Uint8Array([i]), "u1")
        engine.createSnapshot("doc-1")
      }

      expect(engine.getSnapshots("doc-1")).toHaveLength(3)
    })
  })

  describe("awareness", () => {
    it("sets and retrieves document awareness", () => {
      const engine = createEngine()
      engine.createDocument("doc-1")

      engine.setAwareness("doc-1", {
        clientId: "c1",
        userId: "u1",
        userName: "Alice",
        color: "#EF4444",
        cursor: { index: 10, length: 0 },
        isEditing: true,
        lastActivity: Date.now(),
      })

      const awareness = engine.getAwareness("doc-1")
      expect(awareness).toHaveLength(1)
      expect(awareness[0].userName).toBe("Alice")
    })

    it("removes awareness on disconnect", () => {
      const engine = createEngine()
      engine.createDocument("doc-1")

      engine.setAwareness("doc-1", {
        clientId: "c1",
        userId: "u1",
        userName: "Alice",
        color: "#EF4444",
        cursor: null,
        isEditing: false,
        lastActivity: Date.now(),
      })

      engine.removeAwareness("doc-1", "c1")
      expect(engine.getAwareness("doc-1")).toHaveLength(0)
    })
  })

  describe("stats", () => {
    it("reports comprehensive stats", () => {
      const engine = createEngine()
      engine.createDocument("doc-1")
      engine.createDocument("doc-2")
      engine.applyUpdate("doc-1", new Uint8Array([1]), "u1")
      engine.applyUpdate("doc-1", new Uint8Array([2]), "u2")
      engine.applyUpdate("doc-2", new Uint8Array([3]), "u1")

      const stats = engine.getStats()
      expect(stats.totalDocuments).toBe(2)
      expect(stats.totalUpdates).toBe(3)
      expect(stats.totalEditors).toBe(3) // u1 and u2 on doc-1, u1 on doc-2
    })
  })
})

describe("generateCollabDocTableSQL", () => {
  it("generates table creation SQL", () => {
    const sql = generateCollabDocTableSQL()
    expect(sql).toContain("_reactivebase_collab_docs")
    expect(sql).toContain("_reactivebase_collab_updates")
    expect(sql).toContain("_reactivebase_collab_snapshots")
    expect(sql).toContain("BYTEA")
  })
})
