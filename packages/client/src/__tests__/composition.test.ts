import { describe, it, expect } from "vitest"
import { subscribeDerived, subscribeTransformed } from "../composition/composition.js"

describe("composition", () => {
  it("should export composition utilities", () => {
    expect(subscribeDerived).toBeDefined()
    expect(subscribeTransformed).toBeDefined()
  })

  it("should create derived subscriptions", () => {
    expect(typeof subscribeDerived).toBe("function")
    expect(typeof subscribeTransformed).toBe("function")
  })

  it.todo("should test subscribeDerived with multiple source subscriptions")
  it.todo("should test subscribeTransformed with mapping functions")
})
