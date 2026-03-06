import { describe, it, expect } from "vitest"
import {
  useOptimistic,
  useCursors,
  useTypingUsers,
  useSelections,
  useDevTools,
} from "../hooks/collaboration-hooks.js"

describe("collaboration-hooks", () => {
  it("should export all expected hooks", () => {
    expect(useOptimistic).toBeDefined()
    expect(useCursors).toBeDefined()
    expect(useTypingUsers).toBeDefined()
    expect(useSelections).toBeDefined()
    expect(useDevTools).toBeDefined()
  })

  it("should export hooks as functions", () => {
    // TODO: test each hook with React Testing Library renderHook
    expect(typeof useOptimistic).toBe("function")
    expect(typeof useCursors).toBe("function")
    expect(typeof useTypingUsers).toBe("function")
    expect(typeof useSelections).toBe("function")
    expect(typeof useDevTools).toBe("function")
  })

  it("should have correct hook naming convention", () => {
    // TODO: test hook behavior with mocked ReactiveBase context
    // TODO: test optimistic update rollback on error
    expect(useOptimistic.name).toContain("use")
  })
})
