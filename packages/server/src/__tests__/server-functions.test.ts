import { describe, it, expect } from "vitest"
import { query, mutation, action } from "../functions/server-functions.js"

describe("server function definitions", () => {
  it("defines a query function", () => {
    const fn = query(async (_ctx) => {
      return [{ id: "1", title: "Test" }]
    })

    expect(fn.type).toBe("query")
    expect(fn.options).toEqual({ reactive: true })
  })

  it("defines a non-reactive query", () => {
    const fn = query(
      async (_ctx) => {
        return [{ id: "1", title: "Test" }]
      },
      { reactive: false },
    )

    expect(fn.type).toBe("query")
    expect((fn.options as { reactive: boolean }).reactive).toBe(false)
  })

  it("defines a mutation function", () => {
    const fn = mutation(async (_ctx, _args: { title: string }) => {
      return { id: "1" }
    })

    expect(fn.type).toBe("mutation")
  })

  it("defines a mutation with object config", () => {
    const fn = mutation({
      args: { title: {} },
      handler: async (_ctx, _args: { title: string }) => {
        return { id: "1" }
      },
    })

    expect(fn.type).toBe("mutation")
  })

  it("defines an action function", () => {
    const fn = action(async (_ctx, _args: { userId: string }) => {
      // background work
    })

    expect(fn.type).toBe("action")
  })

  it("defines an action with options", () => {
    const fn = action(
      async (_ctx) => {
        // scheduled work
      },
      {
        cron: "0 9 * * *",
        timezone: "UTC",
      },
    )

    expect(fn.type).toBe("action")
    expect((fn.options as { cron: string }).cron).toBe("0 9 * * *")
  })
})
