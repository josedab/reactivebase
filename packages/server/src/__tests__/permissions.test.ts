import { describe, it, expect } from "vitest"
import { roles, allow, enforceAccess } from "../permissions/permissions.js"
import { createAuthContext, AuthenticationError, AuthorizationError } from "../auth/auth.js"

describe("enforceAccess", () => {
  const admin = createAuthContext("u1", { role: "admin" })
  const editor = createAuthContext("u2", { role: "editor" })
  const member = createAuthContext("u3", { role: "member" })
  const anon = createAuthContext(null)

  it("allows public access for anyone", async () => {
    await expect(enforceAccess("public", anon, "fn")).resolves.not.toThrow()
    await expect(enforceAccess(undefined, anon, "fn")).resolves.not.toThrow()
  })

  it("requires authentication for 'authenticated' rule", async () => {
    await expect(enforceAccess("authenticated", admin, "fn")).resolves.not.toThrow()
    await expect(enforceAccess("authenticated", anon, "fn")).rejects.toThrow(AuthenticationError)
  })

  it("checks role-based access", async () => {
    const rule = roles("admin", "editor")
    await expect(enforceAccess(rule, admin, "fn")).resolves.not.toThrow()
    await expect(enforceAccess(rule, editor, "fn")).resolves.not.toThrow()
    await expect(enforceAccess(rule, member, "fn")).rejects.toThrow(AuthorizationError)
    await expect(enforceAccess(rule, anon, "fn")).rejects.toThrow(AuthenticationError)
  })

  it("evaluates custom access predicates", async () => {
    const rule = allow((auth) => auth.hasClaim("role") && auth.claims.role === "admin")
    await expect(enforceAccess(rule, admin, "fn")).resolves.not.toThrow()
    await expect(enforceAccess(rule, member, "fn")).rejects.toThrow(AuthorizationError)
  })

  it("supports async custom predicates", async () => {
    const rule = allow(async (auth) => {
      return auth.userId === "u1"
    })
    await expect(enforceAccess(rule, admin, "fn")).resolves.not.toThrow()
    await expect(enforceAccess(rule, editor, "fn")).rejects.toThrow(AuthorizationError)
  })

  it("includes function name in error messages", async () => {
    try {
      await enforceAccess("authenticated", anon, "tasks.list")
    } catch (e) {
      expect((e as Error).message).toContain("tasks.list")
    }
  })

  it("includes role list in error messages", async () => {
    try {
      await enforceAccess(roles("admin"), member, "admin.panel")
    } catch (e) {
      expect((e as Error).message).toContain("admin")
    }
  })
})

describe("roles() helper", () => {
  it("creates a role rule", () => {
    const rule = roles("admin", "editor")
    expect(rule._type).toBe("roles")
    expect(rule.roles).toEqual(["admin", "editor"])
  })
})

describe("allow() helper", () => {
  it("creates a custom rule with label", () => {
    const rule = allow(() => true, "must be org member")
    expect(rule._type).toBe("custom")
    expect(rule.label).toBe("must be org member")
  })
})
