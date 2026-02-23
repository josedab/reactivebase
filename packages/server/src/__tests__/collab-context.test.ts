import { describe, it, expect, beforeEach } from "vitest"
import { CrdtEngine } from "../crdt/crdt.js"
import { DocumentCollaboration } from "../collaboration/document-collaboration.js"
import { CollaborationManager } from "../collaboration/collaboration.js"
import { createCollabContext } from "../collaboration/collab-context.js"

describe("createCollabContext", () => {
  let crdtEngine: CrdtEngine
  let docCollab: DocumentCollaboration
  let collabManager: CollaborationManager

  beforeEach(() => {
    crdtEngine = new CrdtEngine({ nodeId: "test-node" })
    docCollab = new DocumentCollaboration()
    collabManager = new CollaborationManager()
  })

  function makeCtx(connectionId = "conn-1") {
    return createCollabContext({
      crdtEngine,
      documentCollaboration: docCollab,
      collaborationManager: collabManager,
      connectionId,
    })
  }

  describe("getList", () => {
    it("creates and manages a collaborative list", () => {
      const ctx = makeCtx()
      const list = ctx.getList<string>("shopping")

      expect(list.toArray()).toEqual([])
      expect(list.length).toBe(0)

      list.push("milk")
      list.push("eggs")
      expect(list.toArray()).toEqual(["milk", "eggs"])
      expect(list.length).toBe(2)
      expect(list.has("milk")).toBe(true)
      expect(list.has("bread")).toBe(false)
    })

    it("removes items from list", () => {
      const ctx = makeCtx()
      const list = ctx.getList<string>("shopping")
      list.push("milk")
      list.push("eggs")
      list.remove("milk")
      expect(list.has("milk")).toBe(false)
    })

    it("subscribes to changes", () => {
      const ctx = makeCtx()
      const list = ctx.getList<string>("shopping")
      const changes: unknown[] = []
      const unsub = list.onChange((items) => changes.push(items))
      list.push("milk")
      expect(changes.length).toBeGreaterThan(0)
      unsub()
    })

    it("reuses existing CRDT document", () => {
      const ctx = makeCtx()
      ctx.getList("shopping")
      const list2 = ctx.getList("shopping")
      expect(list2).toBeDefined()
    })
  })

  describe("getMap", () => {
    it("creates and manages a collaborative map", () => {
      const ctx = makeCtx()
      const map = ctx.getMap<string>("settings")

      expect(map.entries()).toEqual({})
      expect(map.keys()).toEqual([])

      map.set("theme", "dark")
      map.set("lang", "en")
      expect(map.get("theme")).toBe("dark")
      expect(map.keys()).toContain("theme")
    })

    it("deletes keys", () => {
      const ctx = makeCtx()
      const map = ctx.getMap<string>("settings")
      map.set("key", "value")
      map.delete("key")
      // LWW-Register sets to null on delete
      expect(map.get("key")).toBeNull()
    })

    it("subscribes to changes", () => {
      const ctx = makeCtx()
      const map = ctx.getMap("settings")
      const changes: unknown[] = []
      const unsub = map.onChange((entries) => changes.push(entries))
      map.set("x", "y")
      expect(changes.length).toBeGreaterThan(0)
      unsub()
    })
  })

  describe("getCounter", () => {
    it("creates and manages a collaborative counter", () => {
      const ctx = makeCtx()
      const counter = ctx.getCounter("likes")

      expect(counter.getValue()).toBe(0)

      counter.increment()
      counter.increment(5)
      expect(counter.getValue()).toBe(6)

      counter.decrement(2)
      expect(counter.getValue()).toBe(4)
    })

    it("subscribes to changes", () => {
      const ctx = makeCtx()
      const counter = ctx.getCounter("likes")
      const values: number[] = []
      const unsub = counter.onChange((v) => values.push(v))
      counter.increment()
      expect(values.length).toBeGreaterThan(0)
      unsub()
    })
  })

  describe("getText", () => {
    it("creates a collaborative text document", () => {
      const ctx = makeCtx()
      const text = ctx.getText("doc-1")
      expect(text.getText()).toBe("")
    })

    it("sets text content", () => {
      const ctx = makeCtx()
      const text = ctx.getText("doc-1")
      text.setText("Hello world")
      // The document should have state after setting
      const doc = docCollab.getDocument("doc-1")
      expect(doc).toBeDefined()
    })

    it("reuses existing document", () => {
      const ctx = makeCtx()
      ctx.getText("doc-1")
      const text2 = ctx.getText("doc-1")
      expect(text2).toBeDefined()
    })
  })

  describe("getPresence", () => {
    it("returns room state", () => {
      const ctx = makeCtx()
      const state = ctx.getPresence("room-1")
      expect(state).toBeDefined()
    })
  })
})
