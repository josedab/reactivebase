import { describe, it, expect, beforeEach } from "vitest"
import {
  ZanzibarEngine,
  ZanzibarError,
  buildCreateZanzibarTablesSQL,
  buildWriteTupleSQL,
  buildDeleteTupleSQL,
  buildReadTuplesSQL,
  buildListObjectsSQL,
  buildReverseExpandSQL,
  buildLogChangeSQL,
  type ZanzibarOptions,
  type RelationTuple,
  type NamespaceConfig,
} from "../zanzibar/zanzibar.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createDocNamespaces(): NamespaceConfig[] {
  return [
    {
      name: "document",
      relations: {
        owner: {},
        editor: {
          union: [{ this: true }, { computedUserset: { relation: "owner" } }],
        },
        viewer: {
          union: [
            { this: true },
            { computedUserset: { relation: "editor" } },
            {
              tupleToUserset: {
                tupleset: { relation: "parent" },
                computedUserset: { relation: "viewer" },
              },
            },
          ],
        },
        parent: {},
      },
    },
    {
      name: "folder",
      relations: {
        owner: {},
        viewer: {
          union: [{ this: true }, { computedUserset: { relation: "owner" } }],
        },
      },
    },
    {
      name: "org",
      relations: {
        member: {},
        admin: {},
      },
    },
  ]
}

function createEngine(overrides: Partial<ZanzibarOptions> = {}): ZanzibarEngine {
  return new ZanzibarEngine({
    namespaces: createDocNamespaces(),
    cacheEnabled: true,
    cacheTtlMs: 5000,
    ...overrides,
  })
}

function makeTuple(
  namespace: string,
  objectId: string,
  relation: string,
  subjectId: string,
  subjectNamespace?: string,
): RelationTuple {
  return { namespace, objectId, relation, subjectId, subjectNamespace }
}

// ─── SQL Builders ────────────────────────────────────────────────────────────

describe("Zanzibar SQL Builders", () => {
  it("generates create tables SQL", () => {
    const sql = buildCreateZanzibarTablesSQL()
    expect(sql).toContain("_rb_zanzibar_tuples")
    expect(sql).toContain("_rb_zanzibar_changelog")
    expect(sql).toContain("CREATE INDEX")
  })

  it("generates write tuple SQL with placeholders", () => {
    const sql = buildWriteTupleSQL()
    expect(sql).toContain("INSERT INTO")
    expect(sql).toContain("$1")
  })

  it("generates delete tuple SQL", () => {
    expect(buildDeleteTupleSQL()).toContain("DELETE FROM")
  })

  it("generates read tuples SQL", () => {
    expect(buildReadTuplesSQL()).toContain("SELECT")
  })

  it("generates list objects SQL", () => {
    expect(buildListObjectsSQL()).toContain("DISTINCT object_id")
  })

  it("generates reverse expand SQL", () => {
    expect(buildReverseExpandSQL()).toContain("subject_id")
  })

  it("generates log change SQL", () => {
    expect(buildLogChangeSQL()).toContain("_rb_zanzibar_changelog")
  })
})

// ─── ZanzibarError ───────────────────────────────────────────────────────────

describe("ZanzibarError", () => {
  it("creates error with code", () => {
    const err = new ZanzibarError("test", "TEST_CODE")
    expect(err.message).toBe("test")
    expect(err.code).toBe("TEST_CODE")
    expect(err.name).toBe("ZanzibarError")
  })
})

// ─── ZanzibarEngine ──────────────────────────────────────────────────────────

describe("ZanzibarEngine", () => {
  let engine: ZanzibarEngine

  beforeEach(() => {
    engine = createEngine()
  })

  // ── writeTuple & deleteTuple ─────────────────────────────────────────────

  describe("writeTuple", () => {
    it("writes a valid tuple", () => {
      engine.writeTuple(makeTuple("document", "doc1", "owner", "user1"))
      const stats = engine.getStats()
      expect(stats.tupleCount).toBe(1)
    })

    it("throws on missing required fields", () => {
      expect(() => engine.writeTuple(makeTuple("", "doc1", "owner", "user1"))).toThrow(ZanzibarError)
      expect(() => engine.writeTuple(makeTuple("document", "", "owner", "user1"))).toThrow(ZanzibarError)
      expect(() => engine.writeTuple(makeTuple("document", "doc1", "", "user1"))).toThrow(ZanzibarError)
      expect(() => engine.writeTuple(makeTuple("document", "doc1", "owner", ""))).toThrow(ZanzibarError)
    })

    it("throws on unknown namespace", () => {
      expect(() => engine.writeTuple(makeTuple("unknown", "doc1", "owner", "user1"))).toThrow("Unknown namespace")
    })

    it("throws on unknown relation", () => {
      expect(() => engine.writeTuple(makeTuple("document", "doc1", "nonexistent", "user1"))).toThrow("Unknown relation")
    })
  })

  describe("deleteTuple", () => {
    it("deletes an existing tuple", () => {
      engine.writeTuple(makeTuple("document", "doc1", "owner", "user1"))
      engine.deleteTuple(makeTuple("document", "doc1", "owner", "user1"))
      expect(engine.getStats().tupleCount).toBe(0)
    })

    it("handles deleting non-existent tuple gracefully", () => {
      engine.deleteTuple(makeTuple("document", "doc1", "owner", "user1"))
      expect(engine.getStats().tupleCount).toBe(0)
    })
  })

  // ── check() with direct tuples ───────────────────────────────────────────

  describe("check - direct tuples", () => {
    it("allows direct relation", () => {
      engine.writeTuple(makeTuple("document", "doc1", "owner", "user1"))
      const result = engine.check({
        namespace: "document",
        objectId: "doc1",
        relation: "owner",
        subjectId: "user1",
      })
      expect(result.allowed).toBe(true)
      expect(result.evaluationTimeMs).toBeGreaterThanOrEqual(0)
    })

    it("denies when no matching tuple", () => {
      const result = engine.check({
        namespace: "document",
        objectId: "doc1",
        relation: "owner",
        subjectId: "user1",
      })
      expect(result.allowed).toBe(false)
    })

    it("supports wildcard tuples", () => {
      engine.writeTuple(makeTuple("document", "doc1", "viewer", "*"))
      const result = engine.check({
        namespace: "document",
        objectId: "doc1",
        relation: "viewer",
        subjectId: "anyone",
      })
      expect(result.allowed).toBe(true)
    })

    it("supports trace mode", () => {
      engine.writeTuple(makeTuple("document", "doc1", "owner", "user1"))
      const result = engine.check({
        namespace: "document",
        objectId: "doc1",
        relation: "owner",
        subjectId: "user1",
        trace: true,
      })
      expect(result.allowed).toBe(true)
      expect(result.resolution).toBeDefined()
      expect(result.resolution!.length).toBeGreaterThan(0)
      expect(result.resolution![0].via).toBe("direct")
    })
  })

  // ── check() with computed usersets ────────────────────────────────────────

  describe("check - computed usersets", () => {
    it("owner implies editor via computed userset", () => {
      engine.writeTuple(makeTuple("document", "doc1", "owner", "user1"))
      const result = engine.check({
        namespace: "document",
        objectId: "doc1",
        relation: "editor",
        subjectId: "user1",
      })
      expect(result.allowed).toBe(true)
    })

    it("editor implies viewer via computed userset chain", () => {
      engine.writeTuple(makeTuple("document", "doc1", "editor", "user1"))
      const result = engine.check({
        namespace: "document",
        objectId: "doc1",
        relation: "viewer",
        subjectId: "user1",
      })
      expect(result.allowed).toBe(true)
    })

    it("owner implies viewer via transitive computed userset", () => {
      engine.writeTuple(makeTuple("document", "doc1", "owner", "user1"))
      const result = engine.check({
        namespace: "document",
        objectId: "doc1",
        relation: "viewer",
        subjectId: "user1",
      })
      expect(result.allowed).toBe(true)
    })
  })

  // ── check() with tuple-to-userset ────────────────────────────────────────

  describe("check - tuple-to-userset", () => {
    it("resolves parent folder viewer", () => {
      // doc1 is in folder1, user1 is viewer of folder1
      engine.writeTuple(makeTuple("document", "doc1", "parent", "folder1", "folder"))
      engine.writeTuple(makeTuple("folder", "folder1", "viewer", "user1"))

      const result = engine.check({
        namespace: "document",
        objectId: "doc1",
        relation: "viewer",
        subjectId: "user1",
      })
      expect(result.allowed).toBe(true)
    })

    it("resolves parent folder owner as viewer", () => {
      engine.writeTuple(makeTuple("document", "doc1", "parent", "folder1", "folder"))
      engine.writeTuple(makeTuple("folder", "folder1", "owner", "user1"))

      const result = engine.check({
        namespace: "document",
        objectId: "doc1",
        relation: "viewer",
        subjectId: "user1",
      })
      expect(result.allowed).toBe(true)
    })
  })

  // ── check() with intersection ─────────────────────────────────────────────

  describe("check - intersection", () => {
    it("requires all refs to be true for intersection", () => {
      const engine2 = new ZanzibarEngine({
        namespaces: [
          {
            name: "resource",
            relations: {
              member: {},
              approved: {},
              access: {
                intersection: [
                  { computedUserset: { relation: "member" } },
                  { computedUserset: { relation: "approved" } },
                ],
              },
            },
          },
        ],
      })

      engine2.writeTuple(makeTuple("resource", "r1", "member", "user1"))
      // Not approved yet
      expect(
        engine2.check({ namespace: "resource", objectId: "r1", relation: "access", subjectId: "user1" }).allowed,
      ).toBe(false)

      engine2.writeTuple(makeTuple("resource", "r1", "approved", "user1"))
      expect(
        engine2.check({ namespace: "resource", objectId: "r1", relation: "access", subjectId: "user1" }).allowed,
      ).toBe(true)
    })
  })

  // ── check() with exclusion ────────────────────────────────────────────────

  describe("check - exclusion", () => {
    it("base minus subtract — banned user denied", () => {
      const engine2 = new ZanzibarEngine({
        namespaces: [
          {
            name: "resource",
            relations: {
              member: {},
              banned: {},
              access: {
                exclusion: {
                  base: { computedUserset: { relation: "member" } },
                  subtract: { computedUserset: { relation: "banned" } },
                },
              },
            },
          },
        ],
      })

      engine2.writeTuple(makeTuple("resource", "r1", "member", "user1"))
      engine2.writeTuple(makeTuple("resource", "r1", "member", "user2"))
      engine2.writeTuple(makeTuple("resource", "r1", "banned", "user1"))

      // user1 is member AND banned → access denied
      expect(
        engine2.check({ namespace: "resource", objectId: "r1", relation: "access", subjectId: "user1" }).allowed,
      ).toBe(false)
      // user2 is member but NOT banned → access allowed
      expect(
        engine2.check({ namespace: "resource", objectId: "r1", relation: "access", subjectId: "user2" }).allowed,
      ).toBe(true)
    })
  })

  // ── check() with contextual tuples ────────────────────────────────────────

  describe("check - contextual tuples", () => {
    it("uses contextual tuples for permission check", () => {
      const result = engine.check({
        namespace: "document",
        objectId: "doc1",
        relation: "owner",
        subjectId: "user1",
        contextualTuples: [makeTuple("document", "doc1", "owner", "user1")],
      })
      expect(result.allowed).toBe(true)
    })

    it("cleans up contextual tuples after check", () => {
      // Use a fresh engine without cache to test tuple cleanup
      const noCacheEngine = createEngine({ cacheEnabled: false })
      noCacheEngine.check({
        namespace: "document",
        objectId: "doc1",
        relation: "owner",
        subjectId: "user1",
        contextualTuples: [makeTuple("document", "doc1", "owner", "user1")],
      })
      // Without contextual tuples, should be denied
      const result = noCacheEngine.check({
        namespace: "document",
        objectId: "doc1",
        relation: "owner",
        subjectId: "user1",
      })
      expect(result.allowed).toBe(false)
    })
  })

  // ── check() - max depth ───────────────────────────────────────────────────

  describe("check - max depth", () => {
    it("throws when max depth exceeded", () => {
      const shallowEngine = createEngine({ maxDepth: 1 })
      shallowEngine.writeTuple(makeTuple("document", "doc1", "owner", "user1"))

      // Direct check should work (depth 0)
      const direct = shallowEngine.check({
        namespace: "document",
        objectId: "doc1",
        relation: "owner",
        subjectId: "user1",
      })
      expect(direct.allowed).toBe(true)

      // Deep computed userset should exceed depth
      expect(() =>
        shallowEngine.check({
          namespace: "document",
          objectId: "doc1",
          relation: "viewer",
          subjectId: "user1",
        }),
      ).toThrow("Max resolution depth")
    })
  })

  // ── check() - namespace resolution ────────────────────────────────────────

  describe("check - namespace resolution", () => {
    it("returns false for unknown namespace", () => {
      const result = engine.check({
        namespace: "nonexistent",
        objectId: "x",
        relation: "y",
        subjectId: "z",
      })
      expect(result.allowed).toBe(false)
    })

    it("returns false for unknown relation in known namespace", () => {
      const result = engine.check({
        namespace: "document",
        objectId: "doc1",
        relation: "nonexistent",
        subjectId: "user1",
      })
      expect(result.allowed).toBe(false)
    })
  })

  // ── Cache behavior ────────────────────────────────────────────────────────

  describe("cache", () => {
    it("caches permission check results", () => {
      engine.writeTuple(makeTuple("document", "doc1", "owner", "user1"))

      engine.check({ namespace: "document", objectId: "doc1", relation: "owner", subjectId: "user1" })
      engine.check({ namespace: "document", objectId: "doc1", relation: "owner", subjectId: "user1" })

      const stats = engine.getStats()
      expect(stats.cacheHits).toBe(1)
      expect(stats.cacheMisses).toBe(1)
    })

    it("invalidates cache on writeTuple", () => {
      engine.writeTuple(makeTuple("document", "doc1", "owner", "user1"))
      engine.check({ namespace: "document", objectId: "doc1", relation: "owner", subjectId: "user1" })

      // Write a new tuple for the same object — invalidates cache
      engine.writeTuple(makeTuple("document", "doc1", "editor", "user2"))
      engine.check({ namespace: "document", objectId: "doc1", relation: "owner", subjectId: "user1" })

      const stats = engine.getStats()
      expect(stats.cacheMisses).toBe(2)
    })

    it("invalidates cache on deleteTuple", () => {
      engine.writeTuple(makeTuple("document", "doc1", "owner", "user1"))
      engine.check({ namespace: "document", objectId: "doc1", relation: "owner", subjectId: "user1" })

      engine.deleteTuple(makeTuple("document", "doc1", "owner", "user1"))
      const result = engine.check({
        namespace: "document",
        objectId: "doc1",
        relation: "owner",
        subjectId: "user1",
      })
      expect(result.allowed).toBe(false)
    })

    it("works with cache disabled", () => {
      const noCacheEngine = createEngine({ cacheEnabled: false })
      noCacheEngine.writeTuple(makeTuple("document", "doc1", "owner", "user1"))

      const r1 = noCacheEngine.check({ namespace: "document", objectId: "doc1", relation: "owner", subjectId: "user1" })
      const r2 = noCacheEngine.check({ namespace: "document", objectId: "doc1", relation: "owner", subjectId: "user1" })

      expect(r1.allowed).toBe(true)
      expect(r2.allowed).toBe(true)
      expect(noCacheEngine.getStats().cacheHits).toBe(0)
    })

    it("clearCache resets all cached entries", () => {
      engine.writeTuple(makeTuple("document", "doc1", "owner", "user1"))
      engine.check({ namespace: "document", objectId: "doc1", relation: "owner", subjectId: "user1" })
      engine.clearCache()

      engine.check({ namespace: "document", objectId: "doc1", relation: "owner", subjectId: "user1" })
      expect(engine.getStats().cacheMisses).toBe(2)
    })
  })

  // ── expand() ──────────────────────────────────────────────────────────────

  describe("expand", () => {
    it("expands direct subjects as leaf", () => {
      engine.writeTuple(makeTuple("document", "doc1", "owner", "user1"))
      engine.writeTuple(makeTuple("document", "doc1", "owner", "user2"))

      const result = engine.expand("document", "doc1", "owner")
      expect(result.tree.type).toBe("leaf")
      expect(result.tree.subjects).toContain("user1")
      expect(result.tree.subjects).toContain("user2")
    })

    it("expands union relation with children", () => {
      engine.writeTuple(makeTuple("document", "doc1", "editor", "user1"))
      engine.writeTuple(makeTuple("document", "doc1", "owner", "user2"))

      const result = engine.expand("document", "doc1", "editor")
      expect(result.tree.type).toBe("union")
      expect(result.tree.children).toBeDefined()
      expect(result.tree.children!.length).toBeGreaterThanOrEqual(2)
    })

    it("returns empty leaf for unknown namespace", () => {
      const result = engine.expand("nonexistent", "x", "y")
      expect(result.tree.type).toBe("leaf")
      expect(result.tree.subjects).toEqual([])
    })

    it("returns leaf for relation with no rules", () => {
      engine.writeTuple(makeTuple("document", "doc1", "parent", "folder1", "folder"))
      const result = engine.expand("document", "doc1", "parent")
      expect(result.tree.type).toBe("leaf")
      expect(result.tree.subjects).toContain("folder1")
    })
  })

  // ── listObjects() ─────────────────────────────────────────────────────────

  describe("listObjects", () => {
    it("lists objects a user has a relation to", () => {
      engine.writeTuple(makeTuple("document", "doc1", "viewer", "user1"))
      engine.writeTuple(makeTuple("document", "doc2", "viewer", "user1"))
      engine.writeTuple(makeTuple("document", "doc3", "viewer", "user2"))

      const objects = engine.listObjects({
        namespace: "document",
        relation: "viewer",
        subjectId: "user1",
      })
      expect(objects).toContain("doc1")
      expect(objects).toContain("doc2")
      expect(objects).not.toContain("doc3")
    })

    it("respects limit", () => {
      for (let i = 0; i < 10; i++) {
        engine.writeTuple(makeTuple("document", `doc${i}`, "viewer", "user1"))
      }
      const objects = engine.listObjects({
        namespace: "document",
        relation: "viewer",
        subjectId: "user1",
        limit: 3,
      })
      expect(objects.length).toBeLessThanOrEqual(3)
    })

    it("returns empty array when no matches", () => {
      const objects = engine.listObjects({
        namespace: "document",
        relation: "viewer",
        subjectId: "nobody",
      })
      expect(objects).toEqual([])
    })
  })

  // ── onPermissionChange callback ───────────────────────────────────────────

  describe("onPermissionChange callback", () => {
    it("fires on write", () => {
      const calls: Array<{ action: string }> = []
      const engine2 = createEngine({
        onPermissionChange: (_tuple, action) => calls.push({ action }),
      })
      engine2.writeTuple(makeTuple("document", "doc1", "owner", "user1"))
      expect(calls).toEqual([{ action: "write" }])
    })

    it("fires on delete", () => {
      const calls: Array<{ action: string }> = []
      const engine2 = createEngine({
        onPermissionChange: (_tuple, action) => calls.push({ action }),
      })
      engine2.writeTuple(makeTuple("document", "doc1", "owner", "user1"))
      engine2.deleteTuple(makeTuple("document", "doc1", "owner", "user1"))
      expect(calls).toEqual([{ action: "write" }, { action: "delete" }])
    })
  })

  // ── getStats() ────────────────────────────────────────────────────────────

  describe("getStats", () => {
    it("tracks check count", () => {
      engine.check({ namespace: "document", objectId: "doc1", relation: "owner", subjectId: "user1" })
      engine.check({ namespace: "document", objectId: "doc1", relation: "owner", subjectId: "user1" })
      expect(engine.getStats().checkCount).toBe(2)
    })

    it("computes avg evaluation time", () => {
      engine.check({ namespace: "document", objectId: "doc1", relation: "owner", subjectId: "user1" })
      expect(engine.getStats().avgEvaluationTimeMs).toBeGreaterThanOrEqual(0)
    })
  })

  // ── Empty namespace config ────────────────────────────────────────────────

  describe("empty namespace config", () => {
    it("works with zero namespaces", () => {
      const emptyEngine = new ZanzibarEngine({ namespaces: [] })
      const result = emptyEngine.check({
        namespace: "document",
        objectId: "doc1",
        relation: "owner",
        subjectId: "user1",
      })
      expect(result.allowed).toBe(false)
    })
  })
})
