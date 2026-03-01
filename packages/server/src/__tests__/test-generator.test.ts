import { describe, it, expect } from "vitest"
import { analyzeSchema, generateTests } from "../test-generator/test-generator.js"

describe("analyzeSchema", () => {
  it("analyzes tables with columns and indexes", () => {
    const analysis = analyzeSchema({
      users: {
        columns: {
          id: { type: "uuid" },
          name: { type: "text" },
          email: { type: "text", unique: true },
        },
        indexes: [{ name: "idx_users_email", columns: ["email"], unique: true }],
      },
    })

    expect(analysis.tables).toHaveLength(1)
    expect(analysis.tables[0].name).toBe("users")
    expect(analysis.tables[0].columns).toHaveLength(3)
    expect(analysis.tables[0].indexes).toHaveLength(1)
  })

  it("detects foreign key relationships", () => {
    const analysis = analyzeSchema({
      users: {
        columns: { id: { type: "uuid" }, name: { type: "text" } },
        indexes: [],
      },
      posts: {
        columns: {
          id: { type: "uuid" },
          authorId: { type: "uuid", referencedTable: "users", referencedColumn: "id" },
          title: { type: "text" },
        },
        indexes: [],
      },
    })

    expect(analysis.relationships).toHaveLength(1)
    expect(analysis.relationships[0].from).toBe("posts")
    expect(analysis.relationships[0].to).toBe("users")
    expect(analysis.tables[1].foreignKeys).toHaveLength(1)
  })

  it("detects circular dependencies", () => {
    const analysis = analyzeSchema({
      a: {
        columns: { id: { type: "uuid" }, bId: { type: "uuid", referencedTable: "b" } },
        indexes: [],
      },
      b: {
        columns: { id: { type: "uuid" }, aId: { type: "uuid", referencedTable: "a" } },
        indexes: [],
      },
    })

    expect(analysis.circularDeps.length).toBeGreaterThan(0)
  })
})

describe("generateTests", () => {
  it("generates test files for each table", () => {
    const analysis = analyzeSchema({
      users: {
        columns: { id: { type: "uuid" }, name: { type: "text" } },
        indexes: [],
      },
      posts: {
        columns: {
          id: { type: "uuid" },
          title: { type: "text" },
          authorId: { type: "uuid", referencedTable: "users" },
        },
        indexes: [{ name: "idx_posts_author", columns: ["authorId"] }],
      },
    })

    const files = generateTests(analysis, { coverage: "standard" })

    expect(files).toHaveLength(2)
    expect(files[0].tableName).toBe("users")
    expect(files[1].tableName).toBe("posts")
    expect(files[0].content).toContain("describe(")
    expect(files[0].content).toContain("vitest")
    expect(files[0].testCount).toBeGreaterThanOrEqual(4) // at least CRUD
  })

  it("includes foreign key tests when tables have references", () => {
    const analysis = analyzeSchema({
      users: {
        columns: { id: { type: "uuid" } },
        indexes: [],
      },
      posts: {
        columns: { id: { type: "uuid" }, userId: { type: "uuid", referencedTable: "users" } },
        indexes: [],
      },
    })

    const files = generateTests(analysis)
    const postFile = files.find((f) => f.tableName === "posts")
    expect(postFile?.content).toContain("Foreign Key")
  })

  it("adjusts test count based on coverage level", () => {
    const analysis = analyzeSchema({
      items: {
        columns: { id: { type: "uuid" }, name: { type: "text" } },
        indexes: [{ name: "idx_name", columns: ["name"] }],
      },
    })

    const basic = generateTests(analysis, { coverage: "basic" })
    const high = generateTests(analysis, { coverage: "high", includeConcurrencyTests: true })

    expect(high[0].testCount).toBeGreaterThan(basic[0].testCount)
  })
})
