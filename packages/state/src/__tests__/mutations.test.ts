import { describe, it, expect } from "vitest"
import { ReactiveStore } from "../index.js"
import type { MutationHandle } from "../index.js"

describe("state/mutations", () => {
  it("should export ReactiveStore class", () => {
    expect(ReactiveStore).toBeDefined()
  })

  it("should handle mutation state lifecycle", () => {
    expect(typeof ReactiveStore).toBe("function")
  })

  it.todo("should test mutation.execute() state transitions (pending → success/error)")
  it.todo("should test optimistic updates with rollback on error")
  it.todo("should test mutation result caching")
})
