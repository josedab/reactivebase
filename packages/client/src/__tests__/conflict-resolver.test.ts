import { describe, it, expect, vi, beforeEach } from "vitest"
import { ConflictResolver } from "../offline/conflict-resolver.js"
import type { Conflict } from "../offline/conflict-resolver.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConflict(overrides: Partial<Conflict> = {}): Conflict {
  return {
    localChange: { name: "local-name", age: 30 },
    remoteChange: { name: "remote-name", age: 25 },
    table: "users",
    rowId: "u1",
    ...overrides,
  }
}

// ─── ConflictResolver ────────────────────────────────────────────────────────

describe("ConflictResolver", () => {
  let resolver: ConflictResolver

  beforeEach(() => {
    resolver = new ConflictResolver()
  })

  describe("constructor", () => {
    it("uses last-write-wins as default strategy", () => {
      const conflict = makeConflict()
      const resolved = resolver.resolve(conflict)
      expect(resolved.strategy).toBe("last-write-wins")
    })

    it("accepts custom default strategy", () => {
      const r = new ConflictResolver({ defaultStrategy: "client-wins" })
      const resolved = r.resolve(makeConflict())
      expect(resolved.strategy).toBe("client-wins")
    })
  })

  describe("resolve() — server-wins", () => {
    beforeEach(() => {
      resolver = new ConflictResolver({ defaultStrategy: "server-wins" })
    })

    it("returns remote change as resolved value", () => {
      const conflict = makeConflict()
      const resolved = resolver.resolve(conflict)
      expect(resolved.resolvedValue).toEqual({ name: "remote-name", age: 25 })
      expect(resolved.strategy).toBe("server-wins")
    })

    it("preserves original conflict fields", () => {
      const conflict = makeConflict()
      const resolved = resolver.resolve(conflict)
      expect(resolved.table).toBe("users")
      expect(resolved.rowId).toBe("u1")
      expect(resolved.localChange).toEqual(conflict.localChange)
      expect(resolved.remoteChange).toEqual(conflict.remoteChange)
    })
  })

  describe("resolve() — client-wins", () => {
    beforeEach(() => {
      resolver = new ConflictResolver({ defaultStrategy: "client-wins" })
    })

    it("returns local change as resolved value", () => {
      const conflict = makeConflict()
      const resolved = resolver.resolve(conflict)
      expect(resolved.resolvedValue).toEqual({ name: "local-name", age: 30 })
      expect(resolved.strategy).toBe("client-wins")
    })
  })

  describe("resolve() — last-write-wins", () => {
    it("returns remote change (server assumed later)", () => {
      const conflict = makeConflict()
      const resolved = resolver.resolve(conflict)
      expect(resolved.resolvedValue).toEqual({ name: "remote-name", age: 25 })
    })
  })

  describe("resolve() — field-merge", () => {
    beforeEach(() => {
      resolver = new ConflictResolver({ defaultStrategy: "field-merge" })
    })

    it("merges fields with client override on conflict", () => {
      const conflict = makeConflict({
        remoteChange: { name: "remote", color: "red" },
        localChange: { name: "local", size: 10 },
      })
      const resolved = resolver.resolve(conflict)
      // Without base version: {...server, ...client}
      expect(resolved.resolvedValue).toEqual({ name: "local", color: "red", size: 10 })
    })
  })

  describe("resolve() — custom", () => {
    it("uses custom resolver function", () => {
      const customResolver = vi.fn((c: Conflict) => ({
        ...c.localChange,
        merged: true,
      }))
      resolver = new ConflictResolver({ defaultStrategy: "custom", customResolver })
      const conflict = makeConflict()
      const resolved = resolver.resolve(conflict)
      expect(customResolver).toHaveBeenCalledWith(conflict)
      expect(resolved.resolvedValue).toEqual({ name: "local-name", age: 30, merged: true })
    })

    it("falls back to last-write-wins when no custom resolver provided", () => {
      resolver = new ConflictResolver({ defaultStrategy: "custom" })
      const conflict = makeConflict()
      const resolved = resolver.resolve(conflict)
      expect(resolved.resolvedValue).toEqual(conflict.remoteChange)
    })
  })

  describe("resolve() — per-table strategy overrides", () => {
    it("uses table-specific strategy", () => {
      resolver = new ConflictResolver({
        defaultStrategy: "server-wins",
        tableStrategies: { users: "client-wins" },
      })
      const conflict = makeConflict({ table: "users" })
      const resolved = resolver.resolve(conflict)
      expect(resolved.strategy).toBe("client-wins")
      expect(resolved.resolvedValue).toEqual(conflict.localChange)
    })

    it("falls back to default for unconfigured tables", () => {
      resolver = new ConflictResolver({
        defaultStrategy: "server-wins",
        tableStrategies: { users: "client-wins" },
      })
      const conflict = makeConflict({ table: "orders" })
      const resolved = resolver.resolve(conflict)
      expect(resolved.strategy).toBe("server-wins")
    })
  })

  describe("fieldMerge()", () => {
    describe("without base version", () => {
      it("merges all fields with client precedence", () => {
        const result = resolver.fieldMerge(
          { a: 1, b: 2 },
          { b: 3, c: 4 },
        )
        expect(result).toEqual({ a: 1, b: 3, c: 4 })
      })

      it("handles empty server version", () => {
        const result = resolver.fieldMerge({}, { name: "local" })
        expect(result).toEqual({ name: "local" })
      })

      it("handles empty client version", () => {
        const result = resolver.fieldMerge({ name: "server" }, {})
        expect(result).toEqual({ name: "server" })
      })

      it("handles both empty", () => {
        const result = resolver.fieldMerge({}, {})
        expect(result).toEqual({})
      })
    })

    describe("with base version (3-way merge)", () => {
      it("keeps base value when neither side changed", () => {
        const base = { a: 1, b: 2 }
        const result = resolver.fieldMerge({ a: 1, b: 2 }, { a: 1, b: 2 }, base)
        expect(result).toEqual({ a: 1, b: 2 })
      })

      it("takes server change when only server changed", () => {
        const base = { a: 1, b: 2 }
        const result = resolver.fieldMerge({ a: 10, b: 2 }, { a: 1, b: 2 }, base)
        expect(result).toEqual({ a: 10, b: 2 })
      })

      it("takes client change when only client changed", () => {
        const base = { a: 1, b: 2 }
        const result = resolver.fieldMerge({ a: 1, b: 2 }, { a: 1, b: 20 }, base)
        expect(result).toEqual({ a: 1, b: 20 })
      })

      it("client wins when both changed same field", () => {
        const base = { a: 1 }
        const result = resolver.fieldMerge({ a: 10 }, { a: 20 }, base)
        expect(result).toEqual({ a: 20 })
      })

      it("merges non-overlapping changes from both sides", () => {
        const base = { a: 1, b: 2 }
        const result = resolver.fieldMerge({ a: 10, b: 2 }, { a: 1, b: 20 }, base)
        expect(result).toEqual({ a: 10, b: 20 })
      })

      it("handles null field values", () => {
        const base = { a: 1, b: null }
        const result = resolver.fieldMerge({ a: 1, b: "new" }, { a: 1, b: null }, base)
        expect(result.a).toBe(1)
        expect(result.b).toBe("new")
      })

      it("handles nested object changes", () => {
        const base = { nested: { x: 1 } }
        const result = resolver.fieldMerge(
          { nested: { x: 2 } },
          { nested: { x: 1 } },
          base,
        )
        expect(result).toEqual({ nested: { x: 2 } })
      })
    })
  })

  describe("detectConflicts()", () => {
    it("detects overlapping changes", () => {
      const local = [
        { table: "users", rowId: "u1", fields: { name: "local" } },
        { table: "users", rowId: "u2", fields: { name: "local2" } },
      ]
      const remote = [
        { table: "users", rowId: "u1", fields: { name: "remote" } },
      ]
      const conflicts = resolver.detectConflicts(local, remote)
      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].table).toBe("users")
      expect(conflicts[0].rowId).toBe("u1")
      expect(conflicts[0].localChange).toEqual({ name: "local" })
      expect(conflicts[0].remoteChange).toEqual({ name: "remote" })
    })

    it("returns empty array for non-overlapping changes", () => {
      const local = [{ table: "users", rowId: "u1", fields: { name: "a" } }]
      const remote = [{ table: "users", rowId: "u2", fields: { name: "b" } }]
      const conflicts = resolver.detectConflicts(local, remote)
      expect(conflicts).toHaveLength(0)
    })

    it("returns empty when no local changes", () => {
      const conflicts = resolver.detectConflicts([], [{ table: "t", rowId: "1", fields: {} }])
      expect(conflicts).toHaveLength(0)
    })

    it("returns empty when no remote changes", () => {
      const conflicts = resolver.detectConflicts([{ table: "t", rowId: "1", fields: {} }], [])
      expect(conflicts).toHaveLength(0)
    })

    it("detects conflicts across different tables separately", () => {
      const local = [
        { table: "users", rowId: "1", fields: { a: 1 } },
        { table: "orders", rowId: "1", fields: { b: 2 } },
      ]
      const remote = [
        { table: "users", rowId: "1", fields: { a: 10 } },
      ]
      const conflicts = resolver.detectConflicts(local, remote)
      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].table).toBe("users")
    })

    it("detects multiple conflicts", () => {
      const local = [
        { table: "users", rowId: "u1", fields: { x: 1 } },
        { table: "users", rowId: "u2", fields: { x: 2 } },
      ]
      const remote = [
        { table: "users", rowId: "u1", fields: { x: 10 } },
        { table: "users", rowId: "u2", fields: { x: 20 } },
      ]
      const conflicts = resolver.detectConflicts(local, remote)
      expect(conflicts).toHaveLength(2)
    })
  })

  describe("getConflictLog()", () => {
    it("starts empty", () => {
      expect(resolver.getConflictLog()).toEqual([])
    })

    it("records resolved conflicts", () => {
      resolver.resolve(makeConflict())
      const log = resolver.getConflictLog()
      expect(log).toHaveLength(1)
      expect(log[0].strategy).toBe("last-write-wins")
      expect(log[0].timestamp).toBeGreaterThan(0)
      expect(log[0].resolvedValue).toBeDefined()
    })

    it("accumulates multiple resolutions", () => {
      resolver.resolve(makeConflict({ rowId: "u1" }))
      resolver.resolve(makeConflict({ rowId: "u2" }))
      expect(resolver.getConflictLog()).toHaveLength(2)
    })

    it("returns a copy (not a reference)", () => {
      resolver.resolve(makeConflict())
      const log1 = resolver.getConflictLog()
      const log2 = resolver.getConflictLog()
      expect(log1).not.toBe(log2)
      expect(log1).toEqual(log2)
    })
  })

  describe("clearConflictLog()", () => {
    it("clears the log", () => {
      resolver.resolve(makeConflict())
      expect(resolver.getConflictLog()).toHaveLength(1)
      resolver.clearConflictLog()
      expect(resolver.getConflictLog()).toHaveLength(0)
    })
  })

  describe("edge cases", () => {
    it("handles empty objects in conflict", () => {
      const conflict = makeConflict({ localChange: {}, remoteChange: {} })
      const resolved = resolver.resolve(conflict)
      expect(resolved.resolvedValue).toEqual({})
    })

    it("handles null field values", () => {
      const conflict = makeConflict({
        localChange: { name: null },
        remoteChange: { name: "server" },
      })
      resolver = new ConflictResolver({ defaultStrategy: "client-wins" })
      const resolved = resolver.resolve(conflict)
      expect(resolved.resolvedValue).toEqual({ name: null })
    })

    it("handles deeply nested objects", () => {
      const conflict = makeConflict({
        localChange: { nested: { deep: { value: 1 } } },
        remoteChange: { nested: { deep: { value: 2 } } },
      })
      resolver = new ConflictResolver({ defaultStrategy: "client-wins" })
      const resolved = resolver.resolve(conflict)
      expect(resolved.resolvedValue).toEqual({ nested: { deep: { value: 1 } } })
    })
  })
})
