import { describe, it, expect, beforeEach } from "vitest"
import {
  AuthzEngine,
  AuthzError,
  definePermissions,
  derived,
  computed,
  generateAuthzTableSQL,
  buildAddRelationSQL,
  buildRemoveRelationSQL,
  buildCheckRelationSQL,
  buildListRelationsSQL,
  permissionToWhereClause,
} from "../authz/authz.js"

describe("definePermissions", () => {
  it("creates a valid permission config", () => {
    const config = definePermissions({
      document: {
        relations: { owner: "user", editor: "user", viewer: "user" },
        permissions: {
          view: ["owner", "editor", "viewer"],
          edit: ["owner", "editor"],
          delete: ["owner"],
        },
      },
    })
    expect(config.schema.document).toBeDefined()
    expect(config.schema.document.permissions.view).toHaveLength(3)
  })

  it("throws on invalid relation reference", () => {
    expect(() =>
      definePermissions({
        document: {
          relations: { owner: "user" },
          permissions: { view: ["nonexistent"] },
        },
      }),
    ).toThrow(AuthzError)
  })
})

describe("AuthzEngine", () => {
  let engine: AuthzEngine

  beforeEach(() => {
    const config = definePermissions({
      document: {
        relations: { owner: "user", editor: "user", viewer: "user", org: "organization" },
        permissions: {
          view: ["owner", "editor", "viewer"],
          edit: ["owner", "editor"],
          delete: ["owner"],
        },
      },
      organization: {
        relations: { admin: "user", member: "user" },
        permissions: {
          manage: ["admin"],
          access: ["admin", "member"],
        },
      },
    })
    engine = new AuthzEngine(config)
  })

  describe("relation management", () => {
    it("adds and checks relations", () => {
      engine.addRelation({
        resourceType: "document",
        resourceId: "doc-1",
        relation: "owner",
        subjectType: "user",
        subjectId: "user-1",
      })

      expect(engine.hasRelation("document", "doc-1", "owner", "user-1")).toBe(true)
      expect(engine.hasRelation("document", "doc-1", "owner", "user-2")).toBe(false)
    })

    it("removes relations", () => {
      const tuple = {
        resourceType: "document",
        resourceId: "doc-1",
        relation: "editor",
        subjectType: "user",
        subjectId: "user-1",
      }
      engine.addRelation(tuple)
      engine.removeRelation(tuple)
      expect(engine.hasRelation("document", "doc-1", "editor", "user-1")).toBe(false)
    })

    it("lists relations for a resource", () => {
      engine.addRelation({
        resourceType: "document",
        resourceId: "doc-1",
        relation: "owner",
        subjectType: "user",
        subjectId: "user-1",
      })
      engine.addRelation({
        resourceType: "document",
        resourceId: "doc-1",
        relation: "viewer",
        subjectType: "user",
        subjectId: "user-2",
      })

      const relations = engine.listRelations("document", "doc-1")
      expect(relations).toHaveLength(2)
    })

    it("lists user resources", () => {
      engine.addRelation({
        resourceType: "document",
        resourceId: "doc-1",
        relation: "editor",
        subjectType: "user",
        subjectId: "user-1",
      })
      engine.addRelation({
        resourceType: "document",
        resourceId: "doc-2",
        relation: "editor",
        subjectType: "user",
        subjectId: "user-1",
      })

      const docs = engine.listUserResources("user-1", "document", "editor")
      expect(docs).toContain("doc-1")
      expect(docs).toContain("doc-2")
    })

    it("tracks relation count", () => {
      engine.addRelation({
        resourceType: "document",
        resourceId: "doc-1",
        relation: "owner",
        subjectType: "user",
        subjectId: "user-1",
      })
      expect(engine.relationCount).toBe(1)
    })
  })

  describe("permission evaluation", () => {
    it("allows owner to view", async () => {
      engine.addRelation({
        resourceType: "document",
        resourceId: "doc-1",
        relation: "owner",
        subjectType: "user",
        subjectId: "user-1",
      })

      const result = await engine.check("view", "document", "doc-1", "user-1")
      expect(result.allowed).toBe(true)
    })

    it("allows editor to edit", async () => {
      engine.addRelation({
        resourceType: "document",
        resourceId: "doc-1",
        relation: "editor",
        subjectType: "user",
        subjectId: "user-1",
      })

      const result = await engine.check("edit", "document", "doc-1", "user-1")
      expect(result.allowed).toBe(true)
    })

    it("denies viewer from editing", async () => {
      engine.addRelation({
        resourceType: "document",
        resourceId: "doc-1",
        relation: "viewer",
        subjectType: "user",
        subjectId: "user-1",
      })

      const result = await engine.check("edit", "document", "doc-1", "user-1")
      expect(result.allowed).toBe(false)
    })

    it("denies non-owner from deleting", async () => {
      engine.addRelation({
        resourceType: "document",
        resourceId: "doc-1",
        relation: "editor",
        subjectType: "user",
        subjectId: "user-1",
      })

      const result = await engine.check("delete", "document", "doc-1", "user-1")
      expect(result.allowed).toBe(false)
    })

    it("denies unknown resource types", async () => {
      const result = await engine.check("view", "unknown", "x", "user-1")
      expect(result.allowed).toBe(false)
      expect(result.trace).toContain("unknown resource type: unknown")
    })

    it("denies unknown permissions", async () => {
      const result = await engine.check("fly", "document", "doc-1", "user-1")
      expect(result.allowed).toBe(false)
      expect(result.trace).toContain("unknown permission: fly")
    })

    it("caches results", async () => {
      engine.addRelation({
        resourceType: "document",
        resourceId: "doc-1",
        relation: "owner",
        subjectType: "user",
        subjectId: "user-1",
      })

      await engine.check("view", "document", "doc-1", "user-1")
      const cached = await engine.check("view", "document", "doc-1", "user-1")
      expect(cached.trace).toContain("cache-hit")
    })

    it("clears cache", async () => {
      engine.addRelation({
        resourceType: "document",
        resourceId: "doc-1",
        relation: "owner",
        subjectType: "user",
        subjectId: "user-1",
      })

      await engine.check("view", "document", "doc-1", "user-1")
      engine.clearCache()
      const result = await engine.check("view", "document", "doc-1", "user-1")
      expect(result.trace).not.toContain("cache-hit")
    })
  })

  describe("computed permissions", () => {
    it("evaluates custom check functions", async () => {
      const config = definePermissions({
        document: {
          relations: { owner: "user" },
          permissions: {
            view: ["owner", computed((ctx) => ctx.claims.isAdmin === true, "admin-override")],
          },
        },
      })

      const eng = new AuthzEngine(config)
      const result = await eng.check("view", "document", "doc-1", "user-1", { isAdmin: true })
      expect(result.allowed).toBe(true)
    })
  })
})

describe("DSL helpers", () => {
  it("creates derived permission rules", () => {
    const rule = derived("org.admin")
    expect(rule._type).toBe("derived")
    expect(rule.from).toBe("org")
    expect(rule.permission).toBe("admin")
  })

  it("throws on invalid derived path", () => {
    expect(() => derived("invalid")).toThrow(AuthzError)
  })

  it("creates computed permission rules", () => {
    const rule = computed(() => true, "always-allow")
    expect(rule._type).toBe("computed")
    expect(rule.label).toBe("always-allow")
  })
})

describe("Authorization SQL builders", () => {
  it("generates authz table SQL", () => {
    const sql = generateAuthzTableSQL()
    expect(sql).toContain("_reactivebase_authz_tuples")
    expect(sql).toContain("CREATE INDEX")
  })

  it("builds add relation SQL", () => {
    const { sql, params } = buildAddRelationSQL({
      resourceType: "document",
      resourceId: "doc-1",
      relation: "owner",
      subjectType: "user",
      subjectId: "user-1",
    })
    expect(sql).toContain("INSERT INTO _reactivebase_authz_tuples")
    expect(params).toHaveLength(5)
  })

  it("builds remove relation SQL", () => {
    const { sql, params } = buildRemoveRelationSQL({
      resourceType: "document",
      resourceId: "doc-1",
      relation: "owner",
      subjectType: "user",
      subjectId: "user-1",
    })
    expect(sql).toContain("DELETE FROM _reactivebase_authz_tuples")
    expect(params).toHaveLength(5)
  })

  it("builds check relation SQL", () => {
    const { sql, params } = buildCheckRelationSQL("document", "doc-1", "owner", "user-1")
    expect(sql).toContain("SELECT 1")
    expect(params).toHaveLength(4)
  })

  it("builds list relations SQL", () => {
    const { sql, params } = buildListRelationsSQL("document", "doc-1")
    expect(sql).toContain("SELECT relation")
    expect(params).toEqual(["document", "doc-1"])
  })

  it("generates WHERE clause for RLS", () => {
    const clause = permissionToWhereClause("document", "viewer")
    expect(clause).toContain("EXISTS")
    expect(clause).toContain("_reactivebase_authz_tuples")
    expect(clause).toContain("relation = 'viewer'")
  })

  it("rejects invalid userIdParam in WHERE clause", () => {
    expect(() => permissionToWhereClause("document", "viewer", "current_user")).toThrow("Invalid userIdParam")
    expect(() => permissionToWhereClause("document", "viewer", "'; DROP TABLE --")).toThrow("Invalid userIdParam")
  })
})
