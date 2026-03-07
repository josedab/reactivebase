import { describe, it, expect } from "vitest"
import {
  PermissionsDebugger,
  TraceRingBuffer,
  AuthDebugDashboard,
  AuthDebugError,
  createPermissionsDebugger,
  createAuthDebugDashboard,
} from "../auth-debugger/index.js"

describe("auth-debugger", () => {
  it("should export all expected symbols", () => {
    expect(PermissionsDebugger).toBeDefined()
    expect(TraceRingBuffer).toBeDefined()
    expect(AuthDebugDashboard).toBeDefined()
    expect(AuthDebugError).toBeDefined()
    expect(createPermissionsDebugger).toBeDefined()
    expect(createAuthDebugDashboard).toBeDefined()
  })

  it("should create a TraceRingBuffer instance", () => {
    const buffer = new TraceRingBuffer(10)
    expect(buffer).toBeInstanceOf(TraceRingBuffer)
  })

  it("should throw AuthDebugError with correct message", () => {
    const error = new AuthDebugError("test error")
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe("test error")
  })

  it("should test that AuthDebugError captures error details properly", () => {
    const error = new AuthDebugError("Permission denied for user 'alice' on table 'orders'")
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(AuthDebugError)
    expect(error.name).toBe("AuthDebugError")
    expect(error.code).toBe("AUTH_DEBUG_ERROR")
    expect(error.message).toContain("Permission denied")
    expect(error.message).toContain("alice")
    expect(error.message).toContain("orders")

    // Verify it works with try/catch
    try {
      throw error
    } catch (e) {
      expect(e).toBeInstanceOf(AuthDebugError)
      expect((e as AuthDebugError).code).toBe("AUTH_DEBUG_ERROR")
    }
  })
})
