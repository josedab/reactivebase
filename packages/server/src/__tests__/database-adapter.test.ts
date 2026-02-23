import { describe, it, expect } from "vitest"
import {
  createPostgresAdapter,
  createSQLiteAdapter,
  createMySQLAdapter,
  postgresTranslator,
  sqliteTranslator,
  mysqlTranslator,
  getTranslator,
  translateColumnType,
  translateCreateTable,
} from "../multi-db/database-adapter.js"

describe("DatabaseAdapter", () => {
  describe("PostgresAdapter", () => {
    const adapter = createPostgresAdapter({ connectionString: "postgresql://localhost/test" })

    it("has correct name and dialect", () => {
      expect(adapter.name).toBe("postgres")
      expect(adapter.dialect).toBe("postgres")
    })

    it("pings successfully", async () => {
      expect(await adapter.ping()).toBe(true)
    })

    it("reports correct capabilities", async () => {
      const info = await adapter.getInfo()
      expect(info.supportsTransactions).toBe(true)
      expect(info.supportsReturning).toBe(true)
      expect(info.supportsJsonb).toBe(true)
      expect(info.supportsArrays).toBe(true)
      expect(info.supportsListenNotify).toBe(true)
    })

    it("supports transactions", async () => {
      const tx = await adapter.beginTransaction()
      await tx.commit()
    })
  })

  describe("SQLiteAdapter", () => {
    it("creates local sqlite adapter", () => {
      const adapter = createSQLiteAdapter({ url: "file:test.db" })
      expect(adapter.name).toBe("sqlite")
      expect(adapter.dialect).toBe("sqlite")
    })

    it("creates turso adapter", () => {
      const adapter = createSQLiteAdapter({ url: "libsql://my-db.turso.io" })
      expect(adapter.name).toBe("turso")
      expect(adapter.dialect).toBe("sqlite")
    })

    it("reports correct capabilities", async () => {
      const adapter = createSQLiteAdapter({ url: "file:test.db" })
      const info = await adapter.getInfo()
      expect(info.supportsJsonb).toBe(false)
      expect(info.supportsArrays).toBe(false)
      expect(info.supportsListenNotify).toBe(false)
      expect(info.supportsReturning).toBe(true)
    })
  })

  describe("MySQLAdapter", () => {
    const adapter = createMySQLAdapter({ connectionString: "mysql://localhost/test" })

    it("has correct name and dialect", () => {
      expect(adapter.name).toBe("mysql")
      expect(adapter.dialect).toBe("mysql")
    })

    it("reports correct capabilities", async () => {
      const info = await adapter.getInfo()
      expect(info.supportsReturning).toBe(false)
      expect(info.supportsJsonb).toBe(true)
      expect(info.supportsArrays).toBe(false)
    })
  })
})

describe("SQLTranslator", () => {
  describe("postgres", () => {
    it("keeps $1 params unchanged", () => {
      expect(postgresTranslator.translateParams("SELECT * WHERE id = $1")).toBe("SELECT * WHERE id = $1")
    })

    it("generates RETURNING clause", () => {
      expect(postgresTranslator.returning()).toBe("RETURNING *")
      expect(postgresTranslator.returning(["id", "name"])).toBe("RETURNING id, name")
    })

    it("generates upsert SQL", () => {
      const sql = postgresTranslator.upsert("users", ["id", "name", "email"], ["id"])
      expect(sql).toContain("ON CONFLICT")
      expect(sql).toContain("EXCLUDED")
    })
  })

  describe("sqlite", () => {
    it("converts $N params to ?", () => {
      expect(sqliteTranslator.translateParams("WHERE id = $1 AND name = $2")).toBe("WHERE id = ? AND name = ?")
    })

    it("uses datetime for now()", () => {
      expect(sqliteTranslator.now()).toContain("datetime")
    })

    it("generates boolean as integer", () => {
      expect(sqliteTranslator.boolean(true)).toBe("1")
      expect(sqliteTranslator.boolean(false)).toBe("0")
    })
  })

  describe("mysql", () => {
    it("converts $N params to ?", () => {
      expect(mysqlTranslator.translateParams("WHERE id = $1")).toBe("WHERE id = ?")
    })

    it("generates ON DUPLICATE KEY UPDATE", () => {
      const sql = mysqlTranslator.upsert("users", ["id", "name"], ["id"])
      expect(sql).toContain("ON DUPLICATE KEY UPDATE")
      expect(sql).toContain("VALUES(")
    })

    it("returns empty for RETURNING (not supported)", () => {
      expect(mysqlTranslator.returning()).toBe("")
    })
  })

  describe("getTranslator", () => {
    it("returns correct translator for each dialect", () => {
      expect(getTranslator("postgres")).toBe(postgresTranslator)
      expect(getTranslator("sqlite")).toBe(sqliteTranslator)
      expect(getTranslator("mysql")).toBe(mysqlTranslator)
    })
  })
})

describe("translateColumnType", () => {
  it("keeps postgres types unchanged", () => {
    expect(translateColumnType("text", "postgres")).toBe("text")
    expect(translateColumnType("jsonb", "postgres")).toBe("jsonb")
  })

  it("converts to SQLite types", () => {
    expect(translateColumnType("text", "sqlite")).toBe("TEXT")
    expect(translateColumnType("boolean", "sqlite")).toBe("INTEGER")
    expect(translateColumnType("timestamptz", "sqlite")).toBe("TEXT")
    expect(translateColumnType("jsonb", "sqlite")).toBe("TEXT")
  })

  it("converts to MySQL types", () => {
    expect(translateColumnType("text", "mysql")).toBe("VARCHAR(255)")
    expect(translateColumnType("boolean", "mysql")).toBe("TINYINT(1)")
    expect(translateColumnType("timestamptz", "mysql")).toBe("DATETIME")
    expect(translateColumnType("jsonb", "mysql")).toBe("JSON")
  })
})

describe("translateCreateTable", () => {
  const columns = {
    name: { pgType: "text", isOptional: false },
    age: { pgType: "integer", isOptional: true },
  }

  it("generates postgres DDL", () => {
    const sql = translateCreateTable("users", columns, "postgres")
    expect(sql).toContain('"users"')
    expect(sql).toContain('"name" text NOT NULL')
  })

  it("generates sqlite DDL", () => {
    const sql = translateCreateTable("users", columns, "sqlite")
    expect(sql).toContain('"users"')
    expect(sql).toContain('"name" TEXT NOT NULL')
    expect(sql).toContain('"age" INTEGER')
  })

  it("generates mysql DDL with backticks", () => {
    const sql = translateCreateTable("users", columns, "mysql")
    expect(sql).toContain("`users`")
    expect(sql).toContain("ENGINE=InnoDB")
  })
})
