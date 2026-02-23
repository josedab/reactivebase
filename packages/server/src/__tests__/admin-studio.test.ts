import { describe, it, expect } from "vitest"
import { AdminStudio, buildDataBrowserSQL, buildCountSQL } from "../dashboard/admin-studio.js"
import type { SchemaVisualModel } from "../dashboard/schema-visualizer.js"

function createTestModel(): SchemaVisualModel {
  return {
    tables: [
      {
        name: "users",
        columns: [
          { name: "id", type: "id", pgType: "text", isId: true, isOptional: false, hasDefault: false },
          { name: "name", type: "string", pgType: "text", isId: false, isOptional: false, hasDefault: false },
          { name: "email", type: "string", pgType: "text", isId: false, isOptional: false, hasDefault: false },
        ],
        indexes: [],
      },
      {
        name: "tasks",
        columns: [
          { name: "id", type: "id", pgType: "text", isId: true, isOptional: false, hasDefault: false },
          { name: "title", type: "string", pgType: "text", isId: false, isOptional: false, hasDefault: false },
          {
            name: "assigneeId",
            type: "id",
            pgType: "text",
            isId: false,
            isOptional: false,
            hasDefault: false,
            referencedTable: "users",
          },
          { name: "done", type: "boolean", pgType: "boolean", isId: false, isOptional: false, hasDefault: false },
        ],
        indexes: [],
      },
    ],
    relations: [
      {
        name: "tasks_assigneeId_users",
        fromTable: "tasks",
        fromColumn: "assigneeId",
        toTable: "users",
        toColumn: "id",
        type: "belongs_to",
      },
    ],
  }
}

describe("AdminStudio", () => {
  describe("schema designer", () => {
    it("adds a table with auto-generated id column", () => {
      const studio = new AdminStudio(createTestModel())
      const table = studio.addTable("projects", [{ name: "name", type: "string", isOptional: false }])

      expect(table.name).toBe("projects")
      expect(table.columns[0].name).toBe("id")
      expect(table.columns[0].isId).toBe(true)
      expect(table.columns).toHaveLength(2)
      expect(studio.schema.tables).toHaveLength(3)
    })

    it("prevents duplicate table names", () => {
      const studio = new AdminStudio(createTestModel())
      expect(() => studio.addTable("users", [])).toThrow("already exists")
    })

    it("removes a table and its relations", () => {
      const studio = new AdminStudio(createTestModel())
      studio.removeTable("tasks")
      expect(studio.schema.tables).toHaveLength(1)
      expect(studio.schema.relations).toHaveLength(0)
    })

    it("throws when removing non-existent table", () => {
      const studio = new AdminStudio(createTestModel())
      expect(() => studio.removeTable("nonexistent")).toThrow("not found")
    })

    it("adds a column to an existing table", () => {
      const studio = new AdminStudio(createTestModel())
      studio.addColumn("users", { name: "bio", type: "string", isOptional: true })
      const users = studio.schema.tables.find((t) => t.name === "users")!
      expect(users.columns).toHaveLength(4)
      expect(users.columns[3].name).toBe("bio")
    })

    it("prevents duplicate column names", () => {
      const studio = new AdminStudio(createTestModel())
      expect(() => studio.addColumn("users", { name: "email", type: "string", isOptional: false })).toThrow(
        "already exists",
      )
    })

    it("removes a column", () => {
      const studio = new AdminStudio(createTestModel())
      studio.removeColumn("users", "email")
      const users = studio.schema.tables.find((t) => t.name === "users")!
      expect(users.columns).toHaveLength(2)
    })

    it("prevents removing primary key column", () => {
      const studio = new AdminStudio(createTestModel())
      expect(() => studio.removeColumn("users", "id")).toThrow("primary key")
    })

    it("disables editing when enableEditing is false", () => {
      const studio = new AdminStudio(createTestModel(), { enableEditing: false })
      expect(() => studio.addTable("x", [])).toThrow("disabled")
      expect(() => studio.removeTable("users")).toThrow("disabled")
    })

    it("tracks schema changes", () => {
      const studio = new AdminStudio(createTestModel())
      studio.addTable("projects", [{ name: "name", type: "string", isOptional: false }])
      studio.addColumn("users", { name: "bio", type: "string", isOptional: true })
      expect(studio.pendingChanges).toHaveLength(2)
      expect(studio.pendingChanges[0].type).toBe("add-table")
      expect(studio.pendingChanges[1].type).toBe("add-column")
    })
  })

  describe("migration preview", () => {
    it("generates SQL for added tables", () => {
      const studio = new AdminStudio(createTestModel())
      studio.addTable("projects", [{ name: "name", type: "string", isOptional: false }])
      const preview = studio.previewMigration()
      expect(preview.upSQL).toHaveLength(1)
      expect(preview.upSQL[0]).toContain("CREATE TABLE")
      expect(preview.upSQL[0]).toContain("projects")
      expect(preview.isDestructive).toBe(false)
    })

    it("marks destructive changes", () => {
      const studio = new AdminStudio(createTestModel())
      studio.removeTable("tasks")
      const preview = studio.previewMigration()
      expect(preview.isDestructive).toBe(true)
      expect(preview.warnings.length).toBeGreaterThan(0)
      expect(preview.upSQL[0]).toContain("DROP TABLE")
    })

    it("generates SQL for added columns", () => {
      const studio = new AdminStudio(createTestModel())
      studio.addColumn("users", { name: "bio", type: "string", isOptional: true })
      const preview = studio.previewMigration()
      expect(preview.upSQL[0]).toContain("ALTER TABLE")
      expect(preview.upSQL[0]).toContain("bio")
      expect(preview.downSQL[0]).toContain("DROP COLUMN")
    })

    it("lists affected tables", () => {
      const studio = new AdminStudio(createTestModel())
      studio.addColumn("users", { name: "bio", type: "string", isOptional: true })
      studio.addColumn("tasks", { name: "priority", type: "string", isOptional: true })
      const preview = studio.previewMigration()
      expect(preview.affectedTables).toContain("users")
      expect(preview.affectedTables).toContain("tasks")
    })

    it("clears changes", () => {
      const studio = new AdminStudio(createTestModel())
      studio.addTable("x", [])
      expect(studio.pendingChanges).toHaveLength(1)
      studio.clearChanges()
      expect(studio.pendingChanges).toHaveLength(0)
    })
  })

  describe("subscription inspector", () => {
    it("formats subscription entries", () => {
      const studio = new AdminStudio(createTestModel())
      const entries = studio.inspectSubscriptions([
        {
          id: "sub-1",
          queryName: "tasks.list",
          args: { userId: "u1" },
          connectionId: "conn-1",
          dependencies: [{ table: "tasks" }, { table: "users" }],
          lastResult: [{ id: "t1", title: "Test" }],
          version: 3,
        },
      ])

      expect(entries).toHaveLength(1)
      expect(entries[0].tables).toEqual(["tasks", "users"])
      expect(entries[0].version).toBe(3)
      expect(entries[0].resultSizeBytes).toBeGreaterThan(0)
    })
  })

  describe("metrics", () => {
    it("produces a summary", () => {
      const studio = new AdminStudio(createTestModel())
      studio.addTable("x", [])
      const metrics = studio.getMetrics(42)
      expect(metrics.tables).toBe(3)
      expect(metrics.activeSubscriptions).toBe(42)
      expect(metrics.pendingChanges).toBe(1)
      expect(metrics.totalRelations).toBe(1)
    })
  })
})

describe("buildDataBrowserSQL", () => {
  it("generates basic SELECT with pagination", () => {
    const { sql, params } = buildDataBrowserSQL({
      table: "users",
      page: 1,
      pageSize: 20,
      filters: [],
    })
    expect(sql).toContain('FROM "users"')
    expect(sql).toContain("LIMIT 20")
    expect(sql).toContain("OFFSET 0")
    expect(params).toHaveLength(0)
  })

  it("generates WHERE clauses for filters", () => {
    const { sql, params } = buildDataBrowserSQL({
      table: "tasks",
      page: 1,
      pageSize: 10,
      filters: [
        { column: "done", operator: "eq", value: false },
        { column: "title", operator: "like", value: "bug" },
      ],
    })
    expect(sql).toContain("WHERE")
    expect(sql).toContain('"done" = $1')
    expect(sql).toContain('"title" ILIKE $2')
    expect(params).toEqual([false, "%bug%"])
  })

  it("handles is_null and is_not_null operators", () => {
    const { sql, params } = buildDataBrowserSQL({
      table: "users",
      page: 1,
      pageSize: 10,
      filters: [{ column: "bio", operator: "is_null" }],
    })
    expect(sql).toContain('"bio" IS NULL')
    expect(params).toHaveLength(0)
  })

  it("applies sorting", () => {
    const { sql } = buildDataBrowserSQL({
      table: "tasks",
      page: 1,
      pageSize: 10,
      sortColumn: "title",
      sortDirection: "desc",
      filters: [],
    })
    expect(sql).toContain('"title" DESC')
  })

  it("calculates correct offset for page 3", () => {
    const { sql } = buildDataBrowserSQL({
      table: "tasks",
      page: 3,
      pageSize: 25,
      filters: [],
    })
    expect(sql).toContain("OFFSET 50")
  })
})

describe("buildCountSQL", () => {
  it("generates count query", () => {
    const { sql } = buildCountSQL("users", [])
    expect(sql).toContain("COUNT(*)")
    expect(sql).toContain('"users"')
  })

  it("applies filters to count", () => {
    const { sql, params } = buildCountSQL("tasks", [{ column: "done", operator: "eq", value: true }])
    expect(sql).toContain("WHERE")
    expect(params).toEqual([true])
  })
})
