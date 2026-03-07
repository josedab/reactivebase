import { describe, it, expect } from "vitest"
import {
  roles,
  allow,
  fields,
  resource,
  allOf,
  anyOf,
  enforceAccess,
  enforceResourceAccess,
  applyFieldPermissions,
} from "../permissions/permissions.js"
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
    } catch (e: unknown) {
      expect((e as Error).message).toContain("tasks.list")
    }
  })

  it("includes role list in error messages", async () => {
    try {
      await enforceAccess(roles("admin"), member, "admin.panel")
    } catch (e: unknown) {
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

// ─── Field-Level Permissions ─────────────────────────────────────────────────

describe("fields() helper", () => {
  it("creates a field rule with exclude list", () => {
    const rule = fields({ exclude: ["ssn", "salary"] })
    expect(rule._type).toBe("fields")
    expect(rule.exclude).toEqual(["ssn", "salary"])
  })

  it("creates a field rule with include list", () => {
    const rule = fields({ include: ["name", "email"] })
    expect(rule._type).toBe("fields")
    expect(rule.include).toEqual(["name", "email"])
  })

  it("throws if both include and exclude are specified", () => {
    expect(() => fields({ include: ["a"], exclude: ["b"] })).toThrow("Cannot specify both")
  })

  it("supports role overrides", () => {
    const rule = fields({
      exclude: ["ssn"],
      roleOverrides: { admin: { exclude: [] } },
    })
    expect(rule.roleOverrides).toBeDefined()
    expect(rule.roleOverrides!.admin.exclude).toEqual([])
  })
})

describe("applyFieldPermissions", () => {
  const admin = createAuthContext("u1", { role: "admin" })
  const member = createAuthContext("u3", { role: "member" })

  const row = { name: "Alice", email: "alice@co.com", ssn: "123-45-6789", salary: 100000 }

  it("excludes specified fields", () => {
    const rule = fields({ exclude: ["ssn", "salary"] })
    const result = applyFieldPermissions(row, rule, member)
    expect(result).toEqual({ name: "Alice", email: "alice@co.com" })
    expect(result).not.toHaveProperty("ssn")
    expect(result).not.toHaveProperty("salary")
  })

  it("includes only specified fields", () => {
    const rule = fields({ include: ["name", "email"] })
    const result = applyFieldPermissions(row, rule, member)
    expect(result).toEqual({ name: "Alice", email: "alice@co.com" })
  })

  it("applies role overrides", () => {
    const rule = fields({
      exclude: ["ssn", "salary"],
      roleOverrides: { admin: { exclude: [] } },
    })

    const memberResult = applyFieldPermissions(row, rule, member)
    expect(memberResult).not.toHaveProperty("ssn")

    const adminResult = applyFieldPermissions(row, rule, admin)
    expect(adminResult).toHaveProperty("ssn")
    expect(adminResult).toHaveProperty("salary")
  })

  it("returns all fields when no restrictions", () => {
    const rule = fields({})
    const result = applyFieldPermissions(row, rule, member)
    expect(result).toEqual(row)
  })
})

// ─── Resource-Scoped Permissions ─────────────────────────────────────────────

describe("resource() helper", () => {
  it("creates a resource rule", () => {
    const rule = resource("document", () => true)
    expect(rule._type).toBe("resource")
    expect(rule.resourceType).toBe("document")
  })
})

describe("enforceResourceAccess", () => {
  const admin = createAuthContext("u1", { role: "admin" })
  const anon = createAuthContext(null)

  it("allows access when check returns true", async () => {
    const rule = resource("doc", (auth, id) => auth.userId === "u1" && id === "doc-1")
    await expect(enforceResourceAccess(rule, admin, "doc-1", "fn")).resolves.not.toThrow()
  })

  it("denies access when check returns false", async () => {
    const rule = resource("doc", () => false)
    await expect(enforceResourceAccess(rule, admin, "doc-1", "fn")).rejects.toThrow(AuthorizationError)
  })

  it("requires authentication", async () => {
    const rule = resource("doc", () => true)
    await expect(enforceResourceAccess(rule, anon, "doc-1", "fn")).rejects.toThrow(AuthenticationError)
  })

  it("includes resource info in error message", async () => {
    const rule = resource("document", () => false)
    try {
      await enforceResourceAccess(rule, admin, "doc-42", "getDoc")
    } catch (e: unknown) {
      expect((e as Error).message).toContain("document")
      expect((e as Error).message).toContain("doc-42")
    }
  })
})

// ─── Composed Rules ──────────────────────────────────────────────────────────

describe("allOf / anyOf composition", () => {
  const admin = createAuthContext("u1", { role: "admin" })
  const editor = createAuthContext("u2", { role: "editor" })
  const member = createAuthContext("u3", { role: "member" })
  const anon = createAuthContext(null)

  it("allOf requires all rules to pass", async () => {
    const rule = allOf("authenticated", roles("admin"))
    await expect(enforceAccess(rule, admin, "fn")).resolves.not.toThrow()
    await expect(enforceAccess(rule, member, "fn")).rejects.toThrow(AuthorizationError)
    await expect(enforceAccess(rule, anon, "fn")).rejects.toThrow(AuthenticationError)
  })

  it("anyOf succeeds if any rule passes", async () => {
    const rule = anyOf(roles("admin"), roles("editor"))
    await expect(enforceAccess(rule, admin, "fn")).resolves.not.toThrow()
    await expect(enforceAccess(rule, editor, "fn")).resolves.not.toThrow()
    await expect(enforceAccess(rule, member, "fn")).rejects.toThrow(AuthorizationError)
  })

  it("anyOf error message mentions rule count", async () => {
    const rule = anyOf(roles("admin"), roles("superadmin"))
    try {
      await enforceAccess(rule, member, "fn")
    } catch (e: unknown) {
      expect((e as Error).message).toContain("2 rules")
    }
  })
})
