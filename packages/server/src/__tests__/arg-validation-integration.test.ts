import { describe, it, expect } from "vitest"
import { query, mutation, action } from "../functions/server-functions.js"
import { s, ValidationError } from "../validation/index.js"

describe("function-level argument validation", () => {
  it("query() accepts validate option", () => {
    const fn = query(
      async (_ctx, _args: { title: string }) => [],
      { validate: { title: s.string().min(1) } },
    )
    expect(fn.options).toHaveProperty("validate")
  })

  it("mutation() accepts validate option", () => {
    const fn = mutation({
      handler: async (_ctx, _args: { title: string }) => ({}),
      validate: { title: s.string(), done: s.boolean().optional() },
    })
    expect(fn.options).toHaveProperty("validate")
  })

  it("action() accepts validate option", () => {
    const fn = action(
      async (_ctx, _args: { email: string }) => {},
      { validate: { email: s.string().email() } },
    )
    expect(fn.options).toHaveProperty("validate")
  })

  it("validation schema is passed through to options", () => {
    const schema = { name: s.string().min(2).max(50), age: s.number().min(0) }
    const fn = query(async () => [], { validate: schema })
    expect((fn.options as { validate: unknown }).validate).toBe(schema)
  })
})
