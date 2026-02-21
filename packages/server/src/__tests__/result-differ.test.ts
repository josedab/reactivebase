import { describe, it, expect } from "vitest"
import { hashResult, hasResultChanged, computeDiff } from "../reactivity/result-differ.js"

describe("result differ", () => {
  it("hashes results consistently", () => {
    const result = [{ id: "1", title: "Task 1" }]
    const hash1 = hashResult(result)
    const hash2 = hashResult(result)

    expect(hash1).toBe(hash2)
  })

  it("detects changed results", () => {
    const oldHash = hashResult([{ id: "1", title: "Task 1" }])
    const newResult = [{ id: "1", title: "Task 1 Updated" }]

    expect(hasResultChanged(oldHash, newResult)).toBe(true)
  })

  it("detects unchanged results", () => {
    const result = [{ id: "1", title: "Task 1" }]
    const oldHash = hashResult(result)

    expect(hasResultChanged(oldHash, result)).toBe(false)
  })

  it("computes null diff for identical results", () => {
    const result = [{ id: "1", title: "Task 1" }]
    const diff = computeDiff(result, result)

    expect(diff).toBeNull()
  })

  it("computes diff for array results", () => {
    const oldResult = [
      { id: "1", title: "Task 1", done: false },
      { id: "2", title: "Task 2", done: false },
    ]
    const newResult = [
      { id: "1", title: "Task 1", done: true },
      { id: "3", title: "Task 3", done: false },
    ]

    const diff = computeDiff(oldResult, newResult)

    expect(diff).not.toBeNull()
    // Either full or array diff depending on size
    expect(diff!.type).toBeDefined()
  })

  it("handles non-array results", () => {
    const oldResult = { count: 5 }
    const newResult = { count: 6 }

    const diff = computeDiff(oldResult, newResult)

    expect(diff).not.toBeNull()
    expect(diff!.type).toBe("full")
    expect(diff!.data).toEqual(newResult)
  })
})
