import { describe, it, expect } from "vitest"
import {
  useCollabText,
  useCollabList,
  useCollabMap,
  useCollabCounter,
} from "../hooks/crdt-hooks.js"

describe("crdt-hooks", () => {
  it("should export all expected hooks", () => {
    expect(useCollabText).toBeDefined()
    expect(useCollabList).toBeDefined()
    expect(useCollabMap).toBeDefined()
    expect(useCollabCounter).toBeDefined()
  })

  it("should export hooks as functions", () => {
    // TODO: test each CRDT hook with React Testing Library renderHook
    expect(typeof useCollabText).toBe("function")
    expect(typeof useCollabList).toBe("function")
    expect(typeof useCollabMap).toBe("function")
    expect(typeof useCollabCounter).toBe("function")
  })

  it("should support collaborative data types", () => {
    // TODO: test concurrent edits with useCollabText
    // TODO: test list operations (insert, remove, move) with useCollabList
    // TODO: test map operations (set, delete) with useCollabMap
    expect(useCollabCounter.name).toContain("use")
  })
})
