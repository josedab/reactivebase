import { describe, it, expect, beforeEach } from "vitest"
import { SchemaGenerator } from "../ai-assistant/schema-generator.js"
import { QueryBuilderAssistant } from "../ai-assistant/query-builder.js"
import { MigrationCopilot } from "../ai-assistant/migration-copilot.js"
import type { SchemaInfo } from "../ai-assistant/ai-assistant.js"

const testSchema: SchemaInfo = {
  tables: [
    {
      name: "tasks",
      columns: [
        { name: "id", type: "text", nullable: false },
        { name: "title", type: "text", nullable: false },
        { name: "done", type: "boolean", nullable: false },
        { name: "priority", type: "text", nullable: false },
        { name: "assigneeId", type: "text", nullable: false },
        { name: "createdAt", type: "number", nullable: false },
      ],
      indexes: [{ name: "by_assignee", columns: ["assigneeId"] }],
    },
    {
      name: "users",
      columns: [
        { name: "id", type: "text", nullable: false },
        { name: "name", type: "text", nullable: false },
        { name: "email", type: "text", nullable: false },
      ],
      indexes: [{ name: "by_email", columns: ["email"] }],
    },
  ],
}

// ─── SchemaGenerator ─────────────────────────────────────────────────────────

describe("SchemaGenerator", () => {
  let generator: SchemaGenerator

  beforeEach(() => {
    generator = new SchemaGenerator()
  })

  describe("generateFromDescription", () => {
    it("generates schema for 'a blog with posts, comments, and tags'", async () => {
      const result = await generator.generateFromDescription("a blog with posts, comments, and tags")
      expect(result.tables.length).toBeGreaterThanOrEqual(3)
      const tableNames = result.tables.map((t) => t.name)
      expect(tableNames).toContain("posts")
      expect(tableNames).toContain("comments")
      expect(tableNames).toContain("tags")
      expect(result.generatedCode).toContain("defineSchema")
      expect(result.generatedCode).toContain("defineTable")
    })

    it("generates schema with known column templates", async () => {
      const result = await generator.generateFromDescription("app with users and tasks")
      const users = result.tables.find((t) => t.name === "users")
      expect(users).toBeDefined()
      expect(users!.columns.some((c) => c.name === "email")).toBe(true)
    })

    it("returns warnings for unrecognizable input", async () => {
      const result = await generator.generateFromDescription("")
      expect(result.warnings.length).toBeGreaterThan(0)
    })

    it("uses AI provider when available", async () => {
      const mockProvider = {
        name: "mock",
        generate: async () =>
          JSON.stringify({
            tables: [{ name: "items", columns: [{ name: "id", type: "text", nullable: false }] }],
            relations: [],
          }),
      }
      const gen = new SchemaGenerator({ aiProvider: mockProvider })
      const result = await gen.generateFromDescription("items table")
      expect(result.tables.some((t) => t.name === "items")).toBe(true)
    })

    it("falls back to rule-based on AI failure", async () => {
      const mockProvider = {
        name: "mock",
        generate: async () => {
          throw new Error("API error")
        },
      }
      const gen = new SchemaGenerator({ aiProvider: mockProvider })
      const result = await gen.generateFromDescription("app with users")
      expect(result.tables.length).toBeGreaterThan(0)
    })
  })

  describe("suggestRelations", () => {
    it("detects foreign key columns", () => {
      const tables = [
        {
          name: "posts",
          columns: [
            { name: "id", type: "text", nullable: false },
            { name: "authorId", type: "text", nullable: false },
          ],
        },
        {
          name: "authors",
          columns: [
            { name: "id", type: "text", nullable: false },
            { name: "name", type: "text", nullable: false },
          ],
        },
      ]
      const relations = generator.suggestRelations(tables)
      expect(relations.length).toBe(1)
      expect(relations[0].fromTable).toBe("posts")
      expect(relations[0].fromColumn).toBe("authorId")
      expect(relations[0].toTable).toBe("authors")
    })

    it("returns empty for tables with no FK patterns", () => {
      const tables = [
        {
          name: "tags",
          columns: [
            { name: "id", type: "text", nullable: false },
            { name: "name", type: "text", nullable: false },
          ],
        },
      ]
      expect(generator.suggestRelations(tables)).toEqual([])
    })
  })

  describe("suggestIndexes", () => {
    it("suggests indexes for foreign key columns", () => {
      const schema: SchemaInfo = {
        tables: [
          {
            name: "posts",
            columns: [
              { name: "id", type: "text", nullable: false },
              { name: "authorId", type: "text", nullable: false },
            ],
            indexes: [],
          },
        ],
      }
      const indexes = generator.suggestIndexes(schema, [])
      expect(indexes.some((i) => i.columns.includes("authorId"))).toBe(true)
    })

    it("does not duplicate existing indexes", () => {
      const schema: SchemaInfo = {
        tables: [
          {
            name: "posts",
            columns: [{ name: "authorId", type: "text", nullable: false }],
            indexes: [{ name: "by_author", columns: ["authorId"] }],
          },
        ],
      }
      const indexes = generator.suggestIndexes(schema, [])
      expect(indexes.filter((i) => i.columns.includes("authorId")).length).toBe(0)
    })

    it("suggests indexes from query patterns", () => {
      const schema: SchemaInfo = {
        tables: [
          {
            name: "tasks",
            columns: [{ name: "priority", type: "text", nullable: false }],
            indexes: [],
          },
        ],
      }
      const indexes = generator.suggestIndexes(schema, ['ctx.db.tasks.where({ priority: "high" })'])
      expect(indexes.some((i) => i.columns.includes("priority"))).toBe(true)
    })
  })

  describe("generateMigration", () => {
    it("generates steps for new tables", () => {
      const current: SchemaInfo = { tables: [] }
      const target: SchemaInfo = {
        tables: [
          {
            name: "posts",
            columns: [{ name: "id", type: "text", nullable: false }],
            indexes: [],
          },
        ],
      }
      const migration = generator.generateMigration(current, target)
      expect(migration.steps.some((s) => s.type === "create-table")).toBe(true)
      expect(migration.steps[0].sql).toContain("CREATE TABLE")
    })

    it("generates steps for dropped tables with warnings", () => {
      const current: SchemaInfo = {
        tables: [
          {
            name: "old_table",
            columns: [{ name: "id", type: "text", nullable: false }],
            indexes: [],
          },
        ],
      }
      const target: SchemaInfo = { tables: [] }
      const migration = generator.generateMigration(current, target)
      expect(migration.steps.some((s) => s.type === "drop-table")).toBe(true)
      expect(migration.warnings.length).toBeGreaterThan(0)
    })

    it("generates column add/drop steps", () => {
      const current: SchemaInfo = {
        tables: [
          {
            name: "tasks",
            columns: [
              { name: "id", type: "text", nullable: false },
              { name: "old_field", type: "text", nullable: false },
            ],
            indexes: [],
          },
        ],
      }
      const target: SchemaInfo = {
        tables: [
          {
            name: "tasks",
            columns: [
              { name: "id", type: "text", nullable: false },
              { name: "new_field", type: "text", nullable: true },
            ],
            indexes: [],
          },
        ],
      }
      const migration = generator.generateMigration(current, target)
      expect(migration.steps.some((s) => s.type === "add-column")).toBe(true)
      expect(migration.steps.some((s) => s.type === "drop-column")).toBe(true)
    })

    it("generates rollback steps", () => {
      const current: SchemaInfo = { tables: [] }
      const target: SchemaInfo = {
        tables: [
          {
            name: "posts",
            columns: [{ name: "id", type: "text", nullable: false }],
            indexes: [],
          },
        ],
      }
      const migration = generator.generateMigration(current, target)
      expect(migration.rollbackSteps.length).toBeGreaterThan(0)
    })
  })

  describe("validateSchema", () => {
    it("detects unindexed foreign keys", () => {
      const schema: SchemaInfo = {
        tables: [
          {
            name: "posts",
            columns: [
              { name: "id", type: "text", nullable: false },
              { name: "authorId", type: "text", nullable: false },
              { name: "title", type: "text", nullable: false },
            ],
            indexes: [],
          },
        ],
      }
      const issues = generator.validateSchema(schema)
      expect(issues.some((i) => i.pattern === "unindexed-foreign-key")).toBe(true)
    })

    it("detects wide tables", () => {
      const columns = Array.from({ length: 25 }, (_, i) => ({
        name: `col${i}`,
        type: "text",
        nullable: false,
      }))
      const schema: SchemaInfo = {
        tables: [{ name: "wide", columns, indexes: [] }],
      }
      const issues = generator.validateSchema(schema)
      expect(issues.some((i) => i.pattern === "wide-table")).toBe(true)
    })

    it("detects all-nullable tables", () => {
      const schema: SchemaInfo = {
        tables: [
          {
            name: "loose",
            columns: [
              { name: "a", type: "text", nullable: true },
              { name: "b", type: "text", nullable: true },
            ],
            indexes: [],
          },
        ],
      }
      const issues = generator.validateSchema(schema)
      expect(issues.some((i) => i.pattern === "all-nullable")).toBe(true)
    })

    it("detects generic column names", () => {
      const schema: SchemaInfo = {
        tables: [
          {
            name: "things",
            columns: [{ name: "data", type: "text", nullable: false }],
            indexes: [],
          },
        ],
      }
      const issues = generator.validateSchema(schema)
      expect(issues.some((i) => i.pattern === "generic-column-name")).toBe(true)
    })

    it("returns empty for well-designed schema", () => {
      const schema: SchemaInfo = {
        tables: [
          {
            name: "users",
            columns: [
              { name: "id", type: "text", nullable: false },
              { name: "name", type: "text", nullable: false },
            ],
            indexes: [{ name: "by_name", columns: ["name"] }],
          },
        ],
      }
      const issues = generator.validateSchema(schema)
      expect(issues.length).toBe(0)
    })
  })
})

// ─── QueryBuilderAssistant ───────────────────────────────────────────────────

describe("QueryBuilderAssistant", () => {
  let assistant: QueryBuilderAssistant

  beforeEach(() => {
    assistant = new QueryBuilderAssistant()
  })

  describe("suggestCompletion", () => {
    it("suggests table names after ctx.db.", () => {
      const code = "ctx.db."
      const items = assistant.suggestCompletion(code, 7, testSchema)
      const labels = items.map((i) => i.label)
      expect(labels).toContain("tasks")
      expect(labels).toContain("users")
    })

    it("suggests chain methods after table name", () => {
      const code = "ctx.db.tasks."
      const items = assistant.suggestCompletion(code, 13, testSchema)
      expect(items.some((i) => i.label === ".where")).toBe(true)
      expect(items.some((i) => i.label === ".orderBy")).toBe(true)
    })

    it("suggests keywords at top level", () => {
      const code = "q"
      const items = assistant.suggestCompletion(code, 1, testSchema)
      expect(items.some((i) => i.label === "query")).toBe(true)
    })

    it("returns sorted results", () => {
      const code = "ctx.db."
      const items = assistant.suggestCompletion(code, 7, testSchema)
      for (let i = 1; i < items.length; i++) {
        expect(items[i].sortOrder).toBeGreaterThanOrEqual(items[i - 1].sortOrder)
      }
    })
  })

  describe("explainQuery", () => {
    it("explains a read query", () => {
      const explanation = assistant.explainQuery(
        'ctx.db.tasks.where({ done: false }).orderBy("priority", "desc").limit(10)',
        testSchema,
      )
      expect(explanation).toContain("tasks")
      expect(explanation).toContain("Filters by")
      expect(explanation).toContain("Sorted by")
      expect(explanation).toContain("10")
    })

    it("explains a mutation", () => {
      const explanation = assistant.explainQuery("ctx.db.tasks.insert({ title: 'test' })", testSchema)
      expect(explanation).toContain("Inserts")
    })

    it("explains a delete", () => {
      const explanation = assistant.explainQuery("ctx.db.tasks.delete(id)", testSchema)
      expect(explanation).toContain("Deletes")
    })

    it("explains a join query", () => {
      const explanation = assistant.explainQuery('ctx.db.tasks.where({}).join("users")', testSchema)
      expect(explanation).toContain("Joins")
    })
  })

  describe("optimizeQuery", () => {
    it("suggests adding .limit() for unbounded queries", () => {
      const opts = assistant.optimizeQuery("ctx.db.tasks.where({ done: false })", testSchema)
      expect(opts.some((o) => o.description.includes("limit"))).toBe(true)
    })

    it("suggests index for unindexed filter columns", () => {
      const opts = assistant.optimizeQuery("ctx.db.tasks.where({ priority: 'high' })", testSchema)
      expect(opts.some((o) => o.description.includes("priority"))).toBe(true)
      expect(opts.some((o) => o.impact === "high")).toBe(true)
    })

    it("does not suggest index for indexed columns", () => {
      const opts = assistant.optimizeQuery("ctx.db.tasks.where({ assigneeId: 'user1' })", testSchema)
      expect(opts.some((o) => o.description.includes("assigneeId"))).toBe(false)
    })

    it("suggests .select() for wide tables", () => {
      const opts = assistant.optimizeQuery("ctx.db.tasks.where({ done: false })", testSchema)
      expect(opts.some((o) => o.description.includes("select"))).toBe(true)
    })
  })

  describe("generateExplainPlan", () => {
    it("detects full table scan without .where()", () => {
      const plan = assistant.generateExplainPlan("ctx.db.tasks")
      expect(plan.indexUsage.some((u) => u.scanType === "full-scan")).toBe(true)
      expect(plan.estimatedCost).toBeGreaterThan(50)
    })

    it("estimates lower cost with .where()", () => {
      const plan = assistant.generateExplainPlan("ctx.db.tasks.where({ done: false })")
      expect(plan.estimatedCost).toBeLessThan(50)
    })

    it("increases cost for joins", () => {
      const withJoin = assistant.generateExplainPlan('ctx.db.tasks.where({}).join("users")')
      const withoutJoin = assistant.generateExplainPlan("ctx.db.tasks.where({})")
      expect(withJoin.estimatedCost).toBeGreaterThan(withoutJoin.estimatedCost)
    })

    it("reduces cost with .limit()", () => {
      const withLimit = assistant.generateExplainPlan("ctx.db.tasks.where({}).limit(10)")
      const withoutLimit = assistant.generateExplainPlan("ctx.db.tasks.where({})")
      expect(withLimit.estimatedCost).toBeLessThan(withoutLimit.estimatedCost)
    })
  })

  describe("suggestTestCases", () => {
    it("generates test cases for a query", () => {
      const tests = assistant.suggestTestCases(
        "query(async (ctx) => { return ctx.db.tasks.where({ done: false }) })",
        testSchema,
      )
      expect(tests.length).toBeGreaterThan(0)
      expect(tests.some((t) => t.category === "happy-path")).toBe(true)
      expect(tests.some((t) => t.category === "performance")).toBe(true)
    })

    it("generates mutation-specific tests", () => {
      const tests = assistant.suggestTestCases(
        "mutation(async (ctx, args) => { return ctx.db.tasks.insert(args) })",
        testSchema,
      )
      expect(tests.some((t) => t.category === "error-case")).toBe(true)
    })

    it("generates limit boundary tests", () => {
      const tests = assistant.suggestTestCases(
        "query(async (ctx) => { return ctx.db.tasks.where({}).limit(20) })",
        testSchema,
      )
      expect(tests.some((t) => t.description.includes("20"))).toBe(true)
    })

    it("generates filter-specific tests for .where()", () => {
      const tests = assistant.suggestTestCases(
        "query(async (ctx) => { return ctx.db.tasks.where({ done: false }) })",
        testSchema,
      )
      expect(tests.some((t) => t.description.includes("done"))).toBe(true)
    })
  })
})

// ─── MigrationCopilot ───────────────────────────────────────────────────────

describe("MigrationCopilot", () => {
  let copilot: MigrationCopilot

  beforeEach(() => {
    copilot = new MigrationCopilot()
  })

  describe("analyzeMigration", () => {
    it("detects DROP TABLE as critical", () => {
      const analysis = copilot.analyzeMigration('DROP TABLE "users";')
      expect(analysis.riskLevel).toBe("critical")
      expect(analysis.issues.some((i) => i.type === "destructive")).toBe(true)
    })

    it("detects DROP COLUMN as critical", () => {
      const analysis = copilot.analyzeMigration('ALTER TABLE "users" DROP COLUMN "email";')
      expect(analysis.riskLevel).toBe("critical")
      expect(analysis.issues.some((i) => i.type === "data-loss")).toBe(true)
    })

    it("detects non-concurrent index creation", () => {
      const analysis = copilot.analyzeMigration('CREATE INDEX idx_email ON "users" ("email");')
      expect(analysis.issues.some((i) => i.type === "locking")).toBe(true)
    })

    it("detects NOT NULL without DEFAULT", () => {
      const analysis = copilot.analyzeMigration("ALTER TABLE users ADD COLUMN status TEXT NOT NULL;")
      expect(analysis.issues.some((i) => i.type === "locking" && i.severity === "critical")).toBe(true)
    })

    it("returns low risk for safe migrations", () => {
      const analysis = copilot.analyzeMigration('ALTER TABLE "users" ADD COLUMN "bio" TEXT;')
      expect(analysis.riskLevel).toBe("low")
    })

    it("suggests transaction wrapper", () => {
      const analysis = copilot.analyzeMigration(
        'ALTER TABLE "a" ADD COLUMN "x" TEXT;\nALTER TABLE "b" ADD COLUMN "y" TEXT;',
      )
      expect(analysis.suggestions.some((s) => s.includes("transaction"))).toBe(true)
    })
  })

  describe("suggestSafeStrategy", () => {
    it("suggests phased strategy for DROP COLUMN", () => {
      const strategy = copilot.suggestSafeStrategy('ALTER TABLE "posts" DROP COLUMN "old_field";')
      expect(strategy.phases.length).toBeGreaterThan(1)
      expect(strategy.phases[0].name).toContain("Add new")
    })

    it("suggests phased strategy for DROP TABLE", () => {
      const strategy = copilot.suggestSafeStrategy('DROP TABLE "legacy";')
      expect(strategy.phases.some((p) => p.name.includes("backup") || p.name.includes("Backup"))).toBe(true)
    })

    it("suggests phased strategy for NOT NULL column", () => {
      const strategy = copilot.suggestSafeStrategy("ALTER TABLE users ADD COLUMN status TEXT NOT NULL;")
      expect(strategy.phases.some((p) => p.name.includes("nullable"))).toBe(true)
    })

    it("wraps simple migration in single phase", () => {
      const strategy = copilot.suggestSafeStrategy('ALTER TABLE "users" ADD COLUMN "bio" TEXT;')
      expect(strategy.phases.length).toBe(1)
    })
  })

  describe("suggestIndexOptimizations", () => {
    it("suggests indexes for WHERE clause columns", () => {
      const opts = copilot.suggestIndexOptimizations(testSchema, ['SELECT * FROM "tasks" WHERE "priority" = \'high\''])
      expect(opts.some((o) => o.columns.includes("priority"))).toBe(true)
    })

    it("suggests indexes for ORDER BY columns", () => {
      const opts = copilot.suggestIndexOptimizations(testSchema, ['SELECT * FROM "tasks" ORDER BY "createdAt"'])
      expect(opts.some((o) => o.columns.includes("createdAt"))).toBe(true)
    })

    it("suggests composite indexes for multi-column filters", () => {
      const opts = copilot.suggestIndexOptimizations(testSchema, [
        'SELECT * FROM "tasks" WHERE "done" = false AND "priority" = \'high\'',
      ])
      expect(opts.some((o) => o.type === "composite")).toBe(true)
    })

    it("does not suggest existing indexes", () => {
      const opts = copilot.suggestIndexOptimizations(testSchema, [
        'SELECT * FROM "tasks" WHERE "assigneeId" = \'user1\'',
      ])
      expect(opts.some((o) => o.columns.includes("assigneeId"))).toBe(false)
    })
  })

  describe("generateRollbackPlan", () => {
    it("generates rollback for CREATE TABLE", () => {
      const plan = copilot.generateRollbackPlan('CREATE TABLE "posts" ("id" TEXT PRIMARY KEY);')
      expect(plan.steps.some((s) => s.sql.includes("DROP TABLE"))).toBe(true)
      expect(plan.fullRollbackPossible).toBe(true)
    })

    it("marks DROP TABLE rollback as not fully possible", () => {
      const plan = copilot.generateRollbackPlan('DROP TABLE "posts";')
      expect(plan.fullRollbackPossible).toBe(false)
      expect(plan.warnings.length).toBeGreaterThan(0)
    })

    it("generates rollback for ADD COLUMN", () => {
      const plan = copilot.generateRollbackPlan('ALTER TABLE "users" ADD COLUMN "bio" TEXT;')
      expect(plan.steps.some((s) => s.sql.includes("DROP COLUMN"))).toBe(true)
    })

    it("generates rollback for CREATE INDEX", () => {
      const plan = copilot.generateRollbackPlan('CREATE INDEX "idx_email" ON "users" ("email");')
      expect(plan.steps.some((s) => s.sql.includes("DROP INDEX"))).toBe(true)
    })

    it("generates rollback for RENAME", () => {
      const plan = copilot.generateRollbackPlan('ALTER TABLE "users" RENAME COLUMN "name" TO "full_name";')
      expect(plan.steps.some((s) => s.sql.includes("RENAME"))).toBe(true)
    })
  })

  describe("estimateMigrationImpact", () => {
    it("reports no downtime for safe migrations", () => {
      const impact = copilot.estimateMigrationImpact('ALTER TABLE "users" ADD COLUMN "bio" TEXT;')
      expect(impact.estimatedDowntime).toBe("None")
      expect(impact.backwardsCompatible).toBe(true)
    })

    it("reports downtime for destructive migrations", () => {
      const impact = copilot.estimateMigrationImpact('DROP TABLE "users";')
      expect(impact.estimatedDowntime).not.toBe("None")
      expect(impact.backwardsCompatible).toBe(false)
    })

    it("detects affected tables", () => {
      const impact = copilot.estimateMigrationImpact(
        'ALTER TABLE "users" ADD COLUMN "bio" TEXT;\nALTER TABLE "posts" ADD COLUMN "slug" TEXT;',
      )
      expect(impact.tablesAffected).toContain("users")
      expect(impact.tablesAffected).toContain("posts")
    })

    it("reports lock duration for NOT NULL column", () => {
      const impact = copilot.estimateMigrationImpact("ALTER TABLE users ADD COLUMN status TEXT NOT NULL;")
      expect(impact.lockDuration).not.toBe("None")
    })
  })

  describe("validateMigration", () => {
    it("checks for transaction wrapper", () => {
      const checks = copilot.validateMigration('ALTER TABLE "users" ADD COLUMN "bio" TEXT;')
      const txCheck = checks.find((c) => c.check === "transaction-wrapper")
      expect(txCheck).toBeDefined()
      expect(txCheck!.passed).toBe(false)
    })

    it("passes transaction check with BEGIN/COMMIT", () => {
      const checks = copilot.validateMigration('BEGIN;\nALTER TABLE "users" ADD COLUMN "bio" TEXT;\nCOMMIT;')
      const txCheck = checks.find((c) => c.check === "transaction-wrapper")
      expect(txCheck!.passed).toBe(true)
    })

    it("flags DROP without IF EXISTS", () => {
      const checks = copilot.validateMigration('DROP TABLE "users";')
      const dropCheck = checks.find((c) => c.check === "safe-drop")
      expect(dropCheck!.passed).toBe(false)
    })

    it("passes safe-drop with IF EXISTS", () => {
      const checks = copilot.validateMigration('DROP TABLE IF EXISTS "users";')
      const dropCheck = checks.find((c) => c.check === "safe-drop")
      expect(dropCheck!.passed).toBe(true)
    })

    it("flags non-concurrent index creation", () => {
      const checks = copilot.validateMigration('CREATE INDEX "idx_email" ON "users" ("email");')
      const idxCheck = checks.find((c) => c.check === "concurrent-index")
      expect(idxCheck!.passed).toBe(false)
    })

    it("passes concurrent index creation", () => {
      const checks = copilot.validateMigration('CREATE INDEX CONCURRENTLY "idx_email" ON "users" ("email");')
      const idxCheck = checks.find((c) => c.check === "concurrent-index")
      expect(idxCheck!.passed).toBe(true)
    })

    it("flags NOT NULL without DEFAULT", () => {
      const checks = copilot.validateMigration("ALTER TABLE users ADD COLUMN status TEXT NOT NULL;")
      const nnCheck = checks.find((c) => c.check === "not-null-default")
      expect(nnCheck!.passed).toBe(false)
    })
  })
})
