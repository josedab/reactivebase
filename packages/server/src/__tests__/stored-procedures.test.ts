import { describe, it, expect } from "vitest"
import {
  StoredProcedureRegistry,
  ProcedureBuilder,
  ProcedureCompileError,
  compileProcedure,
  defineProcedure,
  defineRawProcedure,
  createProcedureRegistry,
  type ProcedureDefinition,
} from "../stored-procedures/index.js"

// ── Helpers ───────────────────────────────────────────────────────────────────

function minimalDef(name = "test_proc"): ProcedureDefinition {
  return {
    name,
    params: [],
    returns: "void",
    body: { statements: [{ kind: "return" }] },
  }
}

// ── defineProcedure & defineRawProcedure ─────────────────────────────────────

describe("defineProcedure", () => {
  it("returns a ProcedureBuilder", () => {
    const builder = defineProcedure("my_proc")
    expect(builder).toBeInstanceOf(ProcedureBuilder)
  })
})

describe("defineRawProcedure", () => {
  it("returns a validated copy of the definition", () => {
    const def = minimalDef("raw_test")
    const result = defineRawProcedure(def)
    expect(result.name).toBe("raw_test")
    expect(result).not.toBe(def) // returns copy
  })

  it("throws for invalid definition", () => {
    expect(() =>
      defineRawProcedure({
        name: "",
        params: [],
        returns: "void",
        body: { statements: [{ kind: "return" }] },
      }),
    ).toThrow(ProcedureCompileError)
  })
})

// ── ProcedureBuilder Chain API ──────────────────────────────────────────────

describe("ProcedureBuilder", () => {
  it("chains .param().returns().body methods", () => {
    const builder = defineProcedure("get_user")
      .param("user_id", "uuid")
      .param("limit_val", "integer", "10")
      .returns("setof", "users")
      .reads("users")
      .writes("audit_log")
      .volatility("stable")
      .securityDefiner()

    const def = builder.build()
    expect(def.name).toBe("get_user")
    expect(def.params).toHaveLength(2)
    expect(def.params[0]).toEqual({ name: "user_id", type: "uuid" })
    expect(def.params[1]).toEqual({ name: "limit_val", type: "integer", defaultValue: "10" })
    expect(def.returns).toBe("setof")
    expect(def.returnsTable).toBe("users")
    expect(def.readsTables).toEqual(["users"])
    expect(def.writesTables).toEqual(["audit_log"])
    expect(def.volatility).toBe("stable")
    expect(def.securityDefiner).toBe(true)
  })

  it("supports statement builder methods", () => {
    const builder = defineProcedure("insert_task")
      .param("title", "text")
      .returns("uuid")
      .declare("new_id", "uuid", "gen_random_uuid()")
      .insert("tasks", ["id", "title"], ['"new_id"', '"title"'], { returning: "id", into: "new_id" })
      .returnValue('"new_id"')

    const def = builder.build()
    expect(def.body.statements).toHaveLength(3) // declare + insert + return
    expect(def.body.statements[0].kind).toBe("declare")
    expect(def.body.statements[1].kind).toBe("insert")
    expect(def.body.statements[2].kind).toBe("return")
  })

  it("supports assign, query, update, delete, perform, raw", () => {
    const builder = defineProcedure("complex_proc")
      .param("x", "integer")
      .assign("counter", "0")
      .query("SELECT count(*) FROM tasks", "counter")
      .update("tasks", { status: "'done'" }, "id = 1")
      .delete("tasks", "id = 2")
      .perform("pg_notify('test', 'payload')")
      .raw("-- custom SQL")
      .returnValue()

    const def = builder.build()
    expect(def.body.statements.map((s) => s.kind)).toEqual([
      "assign",
      "query",
      "update",
      "delete",
      "perform",
      "raw",
      "return",
    ])
  })

  it("supports ifThen with elseIf and else", () => {
    const builder = defineProcedure("cond_proc").param("x", "integer").returns("text")

    builder
      .ifThen("x > 10", (b) => b.returnValue("'high'"))
      .elseIf("x > 5", (b) => b.returnValue("'medium'"))
      .else((b) => b.returnValue("'low'"))

    const def = builder.build()
    const ifStmt = def.body.statements[0]
    expect(ifStmt.kind).toBe("if")
  })

  it("supports raise statements", () => {
    const builder = defineProcedure("err_proc").raise("exception", "Something went wrong", ["42"])
    const def = builder.build()
    const stmt = def.body.statements[0]
    expect(stmt.kind).toBe("raise")
  })

  it("compile() produces PL/pgSQL output", () => {
    const sql = defineProcedure("hello").returns("text").returnValue("'Hello World'").compile()

    expect(sql).toContain('CREATE OR REPLACE FUNCTION "hello"')
    expect(sql).toContain("RETURNS text")
    expect(sql).toContain("LANGUAGE plpgsql")
    expect(sql).toContain("BEGIN")
    expect(sql).toContain("RETURN 'Hello World'")
    expect(sql).toContain("END;")
    expect(sql).toContain("$$;")
  })
})

// ── compileProcedure ────────────────────────────────────────────────────────

describe("compileProcedure", () => {
  it("generates DROP IF EXISTS for idempotent deployment", () => {
    const sql = compileProcedure(minimalDef())
    expect(sql).toContain('DROP FUNCTION IF EXISTS "test_proc"')
  })

  it("generates DECLARE block for declare statements", () => {
    const def = minimalDef()
    def.body.statements = [{ kind: "declare", name: "x", type: "integer", defaultValue: "0" }, { kind: "return" }]
    const sql = compileProcedure(def)
    expect(sql).toContain("DECLARE")
    expect(sql).toContain('"x" integer := 0')
  })

  it("generates SECURITY DEFINER when set", () => {
    const def = minimalDef()
    def.securityDefiner = true
    const sql = compileProcedure(def)
    expect(sql).toContain("SECURITY DEFINER")
  })

  it("generates volatility clause", () => {
    const def = minimalDef()
    def.volatility = "immutable"
    const sql = compileProcedure(def)
    expect(sql).toContain("IMMUTABLE")
  })

  it("generates pg_notify for writesTables", () => {
    const def = minimalDef()
    def.writesTables = ["tasks"]
    const sql = compileProcedure(def)
    expect(sql).toContain("pg_notify")
    expect(sql).toContain("reactivebase_invalidation")
    expect(sql).toContain("tasks")
  })

  it("generates SETOF return type", () => {
    const def = minimalDef()
    def.returns = "setof"
    def.returnsTable = "users"
    const sql = compileProcedure(def)
    expect(sql).toContain('SETOF "users"')
  })

  it("generates param list with defaults", () => {
    const def = minimalDef()
    def.params = [
      { name: "user_id", type: "uuid" },
      { name: "max_count", type: "integer", defaultValue: "10" },
    ]
    const sql = compileProcedure(def)
    expect(sql).toContain('"user_id" uuid')
    expect(sql).toContain('"max_count" integer DEFAULT 10')
  })

  it("supports SQL language mode", () => {
    const def = minimalDef()
    def.language = "sql"
    def.body.statements = [{ kind: "raw", sql: "SELECT 1" }]
    const sql = compileProcedure(def)
    expect(sql).toContain("LANGUAGE sql")
    expect(sql).not.toContain("BEGIN")
    expect(sql).not.toContain("END;")
  })

  it("generates INSERT with RETURNING INTO", () => {
    const def = minimalDef()
    def.body.statements = [
      { kind: "insert", table: "tasks", columns: ["title"], values: ["'Test'"], returning: "id", into: "new_id" },
      { kind: "return" },
    ]
    const sql = compileProcedure(def)
    expect(sql).toContain('INSERT INTO "tasks"')
    expect(sql).toContain('RETURNING id INTO "new_id"')
  })

  it("generates UPDATE with WHERE", () => {
    const def = minimalDef()
    def.body.statements = [
      { kind: "update", table: "tasks", set: { status: "'done'" }, where: "id = 1" },
      { kind: "return" },
    ]
    const sql = compileProcedure(def)
    expect(sql).toContain('UPDATE "tasks" SET "status" = \'done\'')
    expect(sql).toContain("WHERE id = 1")
  })

  it("generates DELETE", () => {
    const def = minimalDef()
    def.body.statements = [{ kind: "delete", table: "tasks", where: "id = 1" }, { kind: "return" }]
    const sql = compileProcedure(def)
    expect(sql).toContain('DELETE FROM "tasks" WHERE id = 1')
  })

  it("generates RETURN QUERY", () => {
    const def = minimalDef()
    def.body.statements = [{ kind: "return", query: "SELECT * FROM tasks" }]
    const sql = compileProcedure(def)
    expect(sql).toContain("RETURN QUERY SELECT * FROM tasks")
  })

  it("generates RAISE statements", () => {
    const def = minimalDef()
    def.body.statements = [
      { kind: "raise", level: "exception", message: "Error: %", params: ["detail_var"] },
      { kind: "return" },
    ]
    const sql = compileProcedure(def)
    expect(sql).toContain("RAISE EXCEPTION 'Error: %', detail_var")
  })

  it("generates IF/ELSIF/ELSE", () => {
    const def = minimalDef()
    def.body.statements = [
      {
        kind: "if",
        condition: "x > 0",
        then: [{ kind: "return", expression: "'positive'" }],
        elseIf: [{ condition: "x = 0", then: [{ kind: "return", expression: "'zero'" }] }],
        else: [{ kind: "return", expression: "'negative'" }],
      },
    ]
    const sql = compileProcedure(def)
    expect(sql).toContain("IF x > 0 THEN")
    expect(sql).toContain("ELSIF x = 0 THEN")
    expect(sql).toContain("ELSE")
    expect(sql).toContain("END IF;")
  })

  // ── Validation Errors ───────────────────────────────────────────────────

  it("throws for empty procedure name", () => {
    expect(() => compileProcedure({ ...minimalDef(), name: "" })).toThrow(ProcedureCompileError)
  })

  it("throws for invalid procedure name", () => {
    expect(() => compileProcedure({ ...minimalDef(), name: "drop;--" })).toThrow(ProcedureCompileError)
  })

  it("throws for setof without returnsTable", () => {
    expect(() => compileProcedure({ ...minimalDef(), returns: "setof", returnsTable: undefined })).toThrow(
      ProcedureCompileError,
    )
  })

  it("throws for empty body", () => {
    expect(() => compileProcedure({ ...minimalDef(), body: { statements: [] } })).toThrow(ProcedureCompileError)
  })

  it("throws for param without name or type", () => {
    expect(() =>
      compileProcedure({
        ...minimalDef(),
        params: [{ name: "", type: "text" }],
      }),
    ).toThrow(ProcedureCompileError)
  })
})

// ── StoredProcedureRegistry ─────────────────────────────────────────────────

describe("StoredProcedureRegistry", () => {
  it("creates via factory function", () => {
    const registry = createProcedureRegistry()
    expect(registry).toBeInstanceOf(StoredProcedureRegistry)
  })

  it("registers and retrieves procedures", () => {
    const registry = createProcedureRegistry()
    const def = minimalDef("my_func")
    registry.register(def)
    expect(registry.get("my_func")).toMatchObject({ name: "my_func" })
    expect(registry.size).toBe(1)
  })

  it("lists all registered procedures", () => {
    const registry = createProcedureRegistry()
    registry.register(minimalDef("func_a"))
    registry.register(minimalDef("func_b"))
    const all = registry.getAll()
    expect(all).toHaveLength(2)
    expect(all.map((d) => d.name).sort()).toEqual(["func_a", "func_b"])
  })

  it("overwrites on duplicate name", () => {
    const registry = createProcedureRegistry()
    registry.register(minimalDef("dup"))
    registry.register({ ...minimalDef("dup"), volatility: "stable" })
    expect(registry.size).toBe(1)
    expect(registry.get("dup")?.volatility).toBe("stable")
  })

  it("compiles a single procedure by name", () => {
    const registry = createProcedureRegistry()
    registry.register(minimalDef("my_proc"))
    const sql = registry.compile("my_proc")
    expect(sql).toContain('CREATE OR REPLACE FUNCTION "my_proc"')
  })

  it("throws when compiling non-registered procedure", () => {
    const registry = createProcedureRegistry()
    expect(() => registry.compile("missing")).toThrow(ProcedureCompileError)
  })

  it("compiles all procedures with LISTEN/NOTIFY setup", () => {
    const registry = createProcedureRegistry()
    registry.register(minimalDef("func_a"))
    registry.register(minimalDef("func_b"))
    const sql = registry.compileAll()
    expect(sql).toContain("_reactivebase_notify_invalidation")
    expect(sql).toContain('"func_a"')
    expect(sql).toContain('"func_b"')
  })

  it("generates LISTEN SQL", () => {
    const registry = createProcedureRegistry()
    const sql = registry.generateListenSQL()
    expect(sql).toContain("LISTEN")
    expect(sql).toContain("reactivebase_invalidation")
  })

  it("parses valid NOTIFY payloads", () => {
    const registry = createProcedureRegistry()
    const result = registry.parseNotifyPayload('{"table":"tasks","operation":"procedure","procedure":"update_task"}')
    expect(result).toEqual({ table: "tasks", operation: "procedure", procedure: "update_task" })
  })

  it("returns null for invalid NOTIFY payloads", () => {
    const registry = createProcedureRegistry()
    expect(registry.parseNotifyPayload("not json")).toBeNull()
    expect(registry.parseNotifyPayload('{"table":"x","operation":"insert"}')).toBeNull()
  })

  it("rejects invalid notifyChannel", () => {
    expect(() => createProcedureRegistry({ notifyChannel: "invalid;channel" })).toThrow()
  })
})

// ── ProcedureCompileError ───────────────────────────────────────────────────

describe("ProcedureCompileError", () => {
  it("has correct properties", () => {
    const err = new ProcedureCompileError("test_proc", "something broke")
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe("ProcedureCompileError")
    expect(err.procedureName).toBe("test_proc")
    expect(err.code).toBe("PROCEDURE_COMPILE_ERROR")
    expect(err.message).toContain("something broke")
    expect(err.message).toContain("test_proc")
  })
})
