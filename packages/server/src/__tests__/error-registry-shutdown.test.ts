import { describe, it, expect } from "vitest"
import {
  ReactiveBaseError,
  RecordNotFoundError,
  FunctionNotFoundError,
  InvalidMessageError,
  PaginationError,
  ShutdownError,
  ERROR_HTTP_STATUS,
  deserializeError,
} from "../errors.js"
import { ShutdownCoordinator } from "../transport/shutdown.js"

describe("error registry and serialization", () => {
  it("base error has code, httpStatus, and serialize()", () => {
    const err = new ReactiveBaseError("test error", "INTERNAL_ERROR")
    expect(err.code).toBe("INTERNAL_ERROR")
    expect(err.httpStatus).toBe(500)
    expect(err.message).toBe("test error")

    const serialized = err.serialize()
    expect(serialized).toEqual({
      code: "INTERNAL_ERROR",
      message: "test error",
      httpStatus: 500,
    })
  })

  it("domain errors carry structured details", () => {
    const err = new RecordNotFoundError("users", "abc123")
    expect(err.httpStatus).toBe(404)
    expect(err.details).toEqual({ tableName: "users", id: "abc123" })

    const serialized = err.serialize()
    expect(serialized.details).toEqual({ tableName: "users", id: "abc123" })
  })

  it("FunctionNotFoundError maps to 404", () => {
    const err = new FunctionNotFoundError("getTasks")
    expect(err.httpStatus).toBe(404)
    expect(err.details?.functionName).toBe("getTasks")
  })

  it("InvalidMessageError maps to 400 with detail", () => {
    const err = new InvalidMessageError("missing type field")
    expect(err.httpStatus).toBe(400)
    expect(err.details?.detail).toBe("missing type field")
  })

  it("PaginationError maps to 400", () => {
    const err = new PaginationError("Invalid cursor")
    expect(err.httpStatus).toBe(400)
  })

  it("ShutdownError maps to 503", () => {
    const err = new ShutdownError()
    expect(err.httpStatus).toBe(503)
  })

  it("deserializeError reconstructs from wire format", () => {
    const original = new RecordNotFoundError("tasks", "xyz")
    const serialized = original.serialize()
    const restored = deserializeError(serialized)

    expect(restored.code).toBe("RECORD_NOT_FOUND")
    expect(restored.message).toBe(original.message)
    expect(restored.httpStatus).toBe(404)
    expect(restored.details).toEqual({ tableName: "tasks", id: "xyz" })
  })

  it("ERROR_HTTP_STATUS covers all known codes", () => {
    expect(ERROR_HTTP_STATUS["AUTHENTICATION_ERROR"]).toBe(401)
    expect(ERROR_HTTP_STATUS["AUTHORIZATION_ERROR"]).toBe(403)
    expect(ERROR_HTTP_STATUS["RATE_LIMIT_EXCEEDED"]).toBe(429)
    expect(ERROR_HTTP_STATUS["VALIDATION_ERROR"]).toBe(400)
  })

  it("unknown error codes default to 500", () => {
    const err = new ReactiveBaseError("unknown", "TOTALLY_NEW_CODE")
    expect(err.httpStatus).toBe(500)
  })
})

describe("graceful shutdown coordinator", () => {
  it("runs hooks in phase order", async () => {
    const order: string[] = []
    const coordinator = new ShutdownCoordinator({ logger: () => {} })

    coordinator.addHook({
      name: "close-pools",
      phase: "closing-pools",
      execute: async () => {
        order.push("pools")
      },
    })
    coordinator.addHook({
      name: "drain",
      phase: "draining",
      execute: async () => {
        order.push("drain")
      },
    })
    coordinator.addHook({
      name: "cancel-subs",
      phase: "closing-subscriptions",
      execute: async () => {
        order.push("subs")
      },
    })

    await coordinator.shutdown()

    expect(order).toEqual(["drain", "subs", "pools"])
    expect(coordinator.phase).toBe("stopped")
  })

  it("is idempotent — second call returns same promise", async () => {
    const coordinator = new ShutdownCoordinator({ logger: () => {} })
    let callCount = 0
    coordinator.addHook({
      name: "counter",
      phase: "draining",
      execute: async () => {
        callCount++
      },
    })

    await Promise.all([coordinator.shutdown(), coordinator.shutdown()])
    expect(callCount).toBe(1)
  })

  it("ensureRunning() throws ShutdownError when shutting down", async () => {
    const coordinator = new ShutdownCoordinator({ logger: () => {} })
    coordinator.ensureRunning() // should not throw

    await coordinator.shutdown()
    expect(() => coordinator.ensureRunning()).toThrow(ShutdownError)
  })

  it("continues if a hook throws", async () => {
    const order: string[] = []
    const coordinator = new ShutdownCoordinator({ logger: () => {} })

    coordinator.addHook({
      name: "failing-hook",
      phase: "draining",
      execute: async () => {
        throw new Error("oops")
      },
    })
    coordinator.addHook({
      name: "after-fail",
      phase: "closing-subscriptions",
      execute: async () => {
        order.push("after")
      },
    })

    await coordinator.shutdown()
    expect(order).toEqual(["after"])
  })

  it("registerDefaults wires up convenience hooks", async () => {
    const order: string[] = []
    const coordinator = new ShutdownCoordinator({ logger: () => {} })

    coordinator.registerDefaults({
      stopAccepting: async () => {
        order.push("stop")
      },
      drainConnections: async () => {
        order.push("drain")
      },
      cancelSubscriptions: async () => {
        order.push("cancel")
      },
      flushOutbox: async () => {
        order.push("flush")
      },
      closePools: async () => {
        order.push("pools")
      },
    })

    await coordinator.shutdown()
    expect(order).toEqual(["stop", "drain", "cancel", "flush", "pools"])
  })

  it("times out if hooks take too long", async () => {
    const coordinator = new ShutdownCoordinator({ timeoutMs: 50, logger: () => {} })

    coordinator.addHook({
      name: "slow",
      phase: "draining",
      execute: () => new Promise((resolve) => setTimeout(resolve, 5000)),
    })

    await coordinator.shutdown()
    expect(coordinator.phase).toBe("stopped")
  })
})
