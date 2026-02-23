import { describe, it, expect } from "vitest"
import { SchemaDesigner } from "../schema-designer/schema-designer.js"

function createTestSchema() {
  return {
    tableNames: ["tasks", "users", "comments"],
    tables: {
      tasks: {
        columns: {
          title: { type: "string", isOptional: false, pgType: "text" },
          done: { type: "boolean", isOptional: false, pgType: "boolean" },
          assignee_id: { type: "id", isOptional: true, pgType: "text", referencedTable: "users" },
        },
        indexes: [{ name: "idx_tasks_assignee", columns: ["assignee_id"] }],
      },
      users: {
        columns: {
          name: { type: "string", isOptional: false, pgType: "text" },
          email: { type: "string", isOptional: false, pgType: "text" },
        },
        indexes: [{ name: "idx_users_email", columns: ["email"], unique: true }],
      },
      comments: {
        columns: {
          body: { type: "string", isOptional: false, pgType: "text" },
          task_id: { type: "id", isOptional: false, pgType: "text", referencedTable: "tasks" },
          author_id: { type: "id", isOptional: false, pgType: "text", referencedTable: "users" },
        },
        indexes: [],
      },
    },
  }
}

describe("SchemaDesigner", () => {
  const schema = createTestSchema()

  describe("ER model generation", () => {
    it("generates nodes for all tables", () => {
      const designer = new SchemaDesigner({ schema })
      const model = designer.getERModel()
      expect(model.nodes).toHaveLength(3)
      expect(model.nodes.map((n) => n.id).sort()).toEqual(["comments", "tasks", "users"])
    })

    it("generates columns with primary key", () => {
      const designer = new SchemaDesigner({ schema })
      const model = designer.getERModel()
      const tasksNode = model.nodes.find((n) => n.id === "tasks")!
      expect(tasksNode.columns[0].name).toBe("id")
      expect(tasksNode.columns[0].isPrimaryKey).toBe(true)
    })

    it("detects foreign key columns", () => {
      const designer = new SchemaDesigner({ schema })
      const model = designer.getERModel()
      const tasksNode = model.nodes.find((n) => n.id === "tasks")!
      const fkCol = tasksNode.columns.find((c) => c.name === "assignee_id")!
      expect(fkCol.isForeignKey).toBe(true)
      expect(fkCol.referencedTable).toBe("users")
    })

    it("generates edges for foreign keys", () => {
      const designer = new SchemaDesigner({ schema })
      const model = designer.getERModel()
      expect(model.edges.length).toBe(3) // tasks→users, comments→tasks, comments→users
      const taskEdge = model.edges.find((e) => e.source === "tasks")
      expect(taskEdge?.target).toBe("users")
    })

    it("computes correct stats", () => {
      const designer = new SchemaDesigner({ schema })
      const model = designer.getERModel()
      expect(model.stats.tableCount).toBe(3)
      expect(model.stats.relationCount).toBe(3)
      expect(model.stats.indexCount).toBe(2)
      expect(model.stats.columnCount).toBeGreaterThan(6)
    })
  })

  describe("impact analysis", () => {
    it("analyzes adding a column (safe)", () => {
      const designer = new SchemaDesigner({
        schema,
        queryNames: ["tasks.list"],
        subscriptionMappings: { "tasks.list": ["tasks"] },
      })
      const [impact] = designer.analyzeImpact([
        {
          type: "add_column",
          table: "tasks",
          column: "priority",
          details: { pgType: "integer", nullable: true },
        },
      ])
      expect(impact.severity).toBe("safe")
      expect(impact.migrationSQL[0]).toContain("ADD COLUMN")
      expect(impact.rollbackSQL[0]).toContain("DROP COLUMN")
      expect(impact.dataLossRisk).toBe(false)
    })

    it("analyzes dropping a column (destructive)", () => {
      const designer = new SchemaDesigner({ schema })
      const [impact] = designer.analyzeImpact([
        {
          type: "remove_column",
          table: "tasks",
          column: "title",
          details: {},
        },
      ])
      expect(impact.severity).toBe("destructive")
      expect(impact.dataLossRisk).toBe(true)
      expect(impact.warnings.length).toBeGreaterThan(0)
    })

    it("analyzes dropping a table (destructive)", () => {
      const designer = new SchemaDesigner({ schema })
      const [impact] = designer.analyzeImpact([
        {
          type: "remove_table",
          table: "tasks",
          details: {},
        },
      ])
      expect(impact.severity).toBe("destructive")
      expect(impact.migrationSQL[0]).toContain("DROP TABLE")
    })

    it("analyzes adding an index (safe)", () => {
      const designer = new SchemaDesigner({ schema })
      const [impact] = designer.analyzeImpact([
        {
          type: "add_index",
          table: "tasks",
          column: "title",
          details: { columns: ["title"] },
        },
      ])
      expect(impact.severity).toBe("safe")
      expect(impact.migrationSQL[0]).toContain("CREATE")
      expect(impact.migrationSQL[0]).toContain("CONCURRENTLY")
    })

    it("detects affected subscriptions", () => {
      const designer = new SchemaDesigner({
        schema,
        subscriptionMappings: { "tasks.list": ["tasks"], "comments.recent": ["comments"] },
      })
      const [impact] = designer.analyzeImpact([
        {
          type: "remove_column",
          table: "tasks",
          column: "done",
          details: {},
        },
      ])
      expect(impact.affectedSubscriptions).toContain("tasks.list")
      expect(impact.affectedSubscriptions).not.toContain("comments.recent")
    })
  })

  describe("code generation", () => {
    it("generates schema code", () => {
      const designer = new SchemaDesigner({ schema })
      const result = designer.generateCode([
        {
          type: "add_column",
          table: "tasks",
          column: "priority",
          details: { pgType: "integer" },
        },
      ])
      expect(result.schemaCode).toContain("defineSchema")
      expect(result.schemaCode).toContain("defineTable")
      expect(result.migrationSQL).toContain("ADD COLUMN")
    })
  })

  describe("HTML visualizer", () => {
    it("generates valid HTML with all nodes", () => {
      const designer = new SchemaDesigner({ schema })
      const html = designer.generateVisualizerHTML()
      expect(html).toContain("<!DOCTYPE html>")
      expect(html).toContain("Schema Designer")
      expect(html).toContain("tasks")
      expect(html).toContain("users")
      expect(html).toContain("comments")
      // Stats are in separate span elements
      expect(html).toContain("tables")
      expect(html).toContain(">3<")
    })
  })
})
