import { describe, it, expect } from "vitest"
import { MiddlewareManager, type MiddlewareContext } from "../middleware/index.js"

function createTestContext(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
  return {
    functionName: "testFn",
    functionType: "mutation",
    args: { foo: "bar" },
    auth: { userId: "u1", claims: {}, requireUser: () => "u1", requireRole: () => {} },
    state: new Map(),
    ...overrides,
  }
}

describe("MiddlewareManager", () => {
  it("runs before hooks and allows arg modification", async () => {
    const mgr = new MiddlewareManager()
    mgr.use({
      name: "modify-args",
      before: (ctx) => ({ args: { ...ctx.args as object, injected: true } }),
    })

    const result = await mgr.runBefore(createTestContext())
    expect(result.args).toEqual({ foo: "bar", injected: true })
  })

  it("supports short-circuit via before hook", async () => {
    const mgr = new MiddlewareManager()
    mgr.use({
      name: "short-circuit",
      before: () => ({ result: "cached-result" }),
    })

    const result = await mgr.runBefore(createTestContext())
    expect(result.shortCircuit).toBe("cached-result")
  })

  it("runs after hooks and transforms result", async () => {
    const mgr = new MiddlewareManager()
    mgr.use({
      name: "transform",
      after: (_ctx, result) => ({ ...(result as object), extra: true }),
    })

    const result = await mgr.runAfter(createTestContext(), { value: 1 })
    expect(result).toEqual({ value: 1, extra: true })
  })

  it("chains multiple before hooks in order", async () => {
    const mgr = new MiddlewareManager()
    const order: string[] = []

    mgr.use({ name: "first", before: () => { order.push("first") } })
    mgr.use({ name: "second", before: () => { order.push("second") } })

    await mgr.runBefore(createTestContext())
    expect(order).toEqual(["first", "second"])
  })

  it("runs error hooks without throwing", async () => {
    const mgr = new MiddlewareManager()
    const errors: string[] = []

    mgr.use({
      name: "logger",
      onError: (_ctx, err) => { errors.push(err.message) },
    })

    await mgr.runOnError(createTestContext(), new Error("test error"))
    expect(errors).toEqual(["test error"])
  })

  it("reports correct middleware count", () => {
    const mgr = new MiddlewareManager()
    expect(mgr.count).toBe(0)
    mgr.use({ name: "a" })
    mgr.use({ name: "b" })
    expect(mgr.count).toBe(2)
  })
})
