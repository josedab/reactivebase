import { describe, it, expect } from "vitest"
import { createAuthContext, AuthenticationError, AuthorizationError } from "../auth/auth.js"

describe("auth context", () => {
  it("creates authenticated context", () => {
    const ctx = createAuthContext("user1", { role: "admin" })

    expect(ctx.userId).toBe("user1")
    expect(ctx.claims.role).toBe("admin")
  })

  it("creates unauthenticated context", () => {
    const ctx = createAuthContext(null)

    expect(ctx.userId).toBeNull()
  })

  it("requireUser throws for unauthenticated", () => {
    const ctx = createAuthContext(null)

    expect(() => ctx.requireUser()).toThrow(AuthenticationError)
  })

  it("requireUser returns userId for authenticated", () => {
    const ctx = createAuthContext("user1")

    expect(ctx.requireUser()).toBe("user1")
  })

  it("requireRole throws for wrong role", () => {
    const ctx = createAuthContext("user1", { role: "member" })

    expect(() => ctx.requireRole("admin")).toThrow(AuthorizationError)
  })

  it("requireRole passes for correct role", () => {
    const ctx = createAuthContext("user1", { role: "admin" })

    expect(() => ctx.requireRole("admin")).not.toThrow()
  })
})
