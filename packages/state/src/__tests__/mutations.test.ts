import { describe, it, expect } from "vitest"
import { ReactiveStore } from "../index.js"
import type { MutationHandle } from "../index.js"

describe("state/mutations", () => {
  it("should export ReactiveStore class", () => {
    expect(ReactiveStore).toBeDefined()
  })

  it("should handle mutation state lifecycle", () => {
    // TODO: test mutation.execute() state transitions (pending → success/error)
    // TODO: test optimistic updates with rollback on error
    // TODO: test mutation result caching
    expect(typeof ReactiveStore).toBe("function")
  })
})
