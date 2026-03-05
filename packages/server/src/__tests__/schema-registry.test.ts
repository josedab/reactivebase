/**
 * Tests for Schema Registry — schema registration, version tracking,
 * breaking change detection, consumer contracts, migration safety.
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
  SchemaRegistry,
  SchemaRegistryError,
  BreakingChangeDetector,
  ContractValidator,
  MigrationSafetyChecker,
  computeFingerprint,
  buildCreateSchemaRegistryTablesSQL,
  buildInsertVersionSQL,
  buildGetVersionSQL,
  buildGetLatestVersionSQL,
  buildUpsertContractSQL,
  buildGetContractsByStatusSQL,
  type SchemaSpec,
  type ConsumerContract,
} from "../schema-registry/schema-registry.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function baseSchema(): SchemaSpec {
  return {
    tables: [
      {
        name: "users",
        columns: [
          { name: "id", type: "text", nullable: false, isPrimaryKey: true },
          { name: "name", type: "text", nullable: false },
          { name: "email", type: "text", nullable: false, isUnique: true },
          { name: "bio", type: "text", nullable: true, defaultValue: "" },
        ],
        indexes: [{ name: "idx_users_email", columns: ["email"], unique: true }],
      },
      {
        name: "posts",
        columns: [
          { name: "id", type: "text", nullable: false, isPrimaryKey: true },
          { name: "title", type: "text", nullable: false },
          { name: "author_id", type: "text", nullable: false, references: { table: "users", column: "id" } },
        ],
      },
    ],
    enums: [{ name: "status", values: ["draft", "published", "archived"] }],
  }
}

function makeContract(overrides: Partial<ConsumerContract> = {}): ConsumerContract {
  return {
    id: "c1",
    consumerId: "svc-1",
    consumerName: "frontend-app",
    requiredTables: [
      {
        name: "users",
        requiredColumns: [
          { name: "id", type: "text" },
          { name: "name", type: "text" },
          { name: "email", type: "text" },
        ],
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "active",
    ...overrides,
  }
}

// ─── SQL Builders ────────────────────────────────────────────────────────────

describe("Schema Registry SQL Builders", () => {
  it("generates create tables SQL", () => {
    const sql = buildCreateSchemaRegistryTablesSQL()
    expect(sql).toContain("_rb_schema_versions")
    expect(sql).toContain("_rb_consumer_contracts")
    expect(sql).toContain("_rb_schema_changelog")
  })

  it("generates insert version SQL", () => {
    expect(buildInsertVersionSQL()).toContain("INSERT INTO _rb_schema_versions")
  })

  it("generates get version SQL", () => {
    expect(buildGetVersionSQL()).toContain("WHERE version = $1")
  })

  it("generates get latest version SQL", () => {
    expect(buildGetLatestVersionSQL()).toContain("ORDER BY version DESC LIMIT 1")
  })

  it("generates upsert contract SQL", () => {
    expect(buildUpsertContractSQL()).toContain("ON CONFLICT")
  })

  it("generates get contracts by status SQL", () => {
    expect(buildGetContractsByStatusSQL()).toContain("WHERE status = $1")
  })
})

// ─── computeFingerprint ──────────────────────────────────────────────────────

describe("computeFingerprint", () => {
  it("produces consistent fingerprint for same schema", () => {
    const fp1 = computeFingerprint(baseSchema())
    const fp2 = computeFingerprint(baseSchema())
    expect(fp1).toBe(fp2)
  })

  it("produces different fingerprints for different schemas", () => {
    const fp1 = computeFingerprint(baseSchema())
    const modified = baseSchema()
    modified.tables.push({ name: "extra", columns: [] })
    const fp2 = computeFingerprint(modified)
    expect(fp1).not.toBe(fp2)
  })

  it("starts with fp_ prefix", () => {
    expect(computeFingerprint(baseSchema())).toMatch(/^fp_/)
  })
})

// ─── SchemaRegistryError ─────────────────────────────────────────────────────

describe("SchemaRegistryError", () => {
  it("creates error with code", () => {
    const err = new SchemaRegistryError("test error", "TEST")
    expect(err.name).toBe("SchemaRegistryError")
    expect(err.code).toBe("TEST")
    expect(err.message).toBe("test error")
  })
})

// ─── BreakingChangeDetector ──────────────────────────────────────────────────

describe("BreakingChangeDetector", () => {
  let detector: BreakingChangeDetector

  beforeEach(() => {
    detector = new BreakingChangeDetector()
  })

  it("detects removed table", () => {
    const oldSchema = baseSchema()
    const newSchema = { ...baseSchema(), tables: [baseSchema().tables[0]] } // remove posts
    const changes = detector.detect(oldSchema, newSchema)
    expect(changes.some((c) => c.type === "table_removed" && c.table === "posts")).toBe(true)
  })

  it("detects removed column", () => {
    const oldSchema = baseSchema()
    const newSchema = baseSchema()
    newSchema.tables[0].columns = newSchema.tables[0].columns.filter((c) => c.name !== "bio")
    const changes = detector.detect(oldSchema, newSchema)
    expect(changes.some((c) => c.type === "column_removed" && c.column === "bio")).toBe(true)
  })

  it("detects column type change", () => {
    const oldSchema = baseSchema()
    const newSchema = baseSchema()
    newSchema.tables[0].columns.find((c) => c.name === "name")!.type = "integer"
    const changes = detector.detect(oldSchema, newSchema)
    expect(changes.some((c) => c.type === "column_type_changed" && c.column === "name")).toBe(true)
  })

  it("detects column made non-nullable", () => {
    const oldSchema = baseSchema()
    const newSchema = baseSchema()
    newSchema.tables[0].columns.find((c) => c.name === "bio")!.nullable = false
    const changes = detector.detect(oldSchema, newSchema)
    expect(changes.some((c) => c.type === "column_made_non_nullable")).toBe(true)
  })

  it("detects column default removed", () => {
    const oldSchema = baseSchema()
    const newSchema = baseSchema()
    delete newSchema.tables[0].columns.find((c) => c.name === "bio")!.defaultValue
    const changes = detector.detect(oldSchema, newSchema)
    expect(changes.some((c) => c.type === "column_default_removed")).toBe(true)
  })

  it("detects removed index", () => {
    const oldSchema = baseSchema()
    const newSchema = baseSchema()
    newSchema.tables[0].indexes = []
    const changes = detector.detect(oldSchema, newSchema)
    expect(changes.some((c) => c.type === "index_removed")).toBe(true)
  })

  it("detects removed enum value", () => {
    const oldSchema = baseSchema()
    const newSchema = baseSchema()
    newSchema.enums![0].values = ["draft", "published"] // removed "archived"
    const changes = detector.detect(oldSchema, newSchema)
    expect(changes.some((c) => c.type === "enum_value_removed")).toBe(true)
  })

  it("returns empty for identical schemas", () => {
    const changes = detector.detect(baseSchema(), baseSchema())
    expect(changes).toHaveLength(0)
  })

  it("handles schema with no enums", () => {
    const noEnums = { tables: baseSchema().tables }
    const changes = detector.detect(noEnums, noEnums)
    expect(changes).toHaveLength(0)
  })

  it("handles adding a new table (not breaking)", () => {
    const newSchema = baseSchema()
    newSchema.tables.push({ name: "comments", columns: [{ name: "id", type: "text", nullable: false }] })
    const changes = detector.detect(baseSchema(), newSchema)
    expect(changes.filter((c) => c.severity === "error")).toHaveLength(0)
  })

  it("handles adding a new column (not breaking)", () => {
    const newSchema = baseSchema()
    newSchema.tables[0].columns.push({ name: "avatar", type: "text", nullable: true })
    const changes = detector.detect(baseSchema(), newSchema)
    expect(changes.filter((c) => c.severity === "error")).toHaveLength(0)
  })
})

// ─── ContractValidator ───────────────────────────────────────────────────────

describe("ContractValidator", () => {
  let validator: ContractValidator

  beforeEach(() => {
    validator = new ContractValidator()
  })

  it("validates contract against matching schema", () => {
    const changes = validator.validate(makeContract(), baseSchema())
    expect(changes).toHaveLength(0)
  })

  it("detects missing required table", () => {
    const schema: SchemaSpec = { tables: [] }
    const changes = validator.validate(makeContract(), schema)
    expect(changes.some((c) => c.type === "table_removed" && c.table === "users")).toBe(true)
  })

  it("detects missing required column", () => {
    const schema = baseSchema()
    schema.tables[0].columns = schema.tables[0].columns.filter((c) => c.name !== "email")
    const changes = validator.validate(makeContract(), schema)
    expect(changes.some((c) => c.type === "column_removed" && c.column === "email")).toBe(true)
  })

  it("detects type mismatch", () => {
    const schema = baseSchema()
    schema.tables[0].columns.find((c) => c.name === "name")!.type = "integer"
    const changes = validator.validate(makeContract(), schema)
    expect(changes.some((c) => c.type === "column_type_changed")).toBe(true)
  })

  it("detects non-nullable expectation mismatch", () => {
    const contract = makeContract({
      requiredTables: [
        {
          name: "users",
          requiredColumns: [{ name: "name", nullable: false }],
        },
      ],
    })
    const schema = baseSchema()
    schema.tables[0].columns.find((c) => c.name === "name")!.nullable = true
    const changes = validator.validate(contract, schema)
    expect(changes.some((c) => c.type === "column_made_non_nullable")).toBe(true)
  })
})

// ─── MigrationSafetyChecker ──────────────────────────────────────────────────

describe("MigrationSafetyChecker", () => {
  let checker: MigrationSafetyChecker

  beforeEach(() => {
    checker = new MigrationSafetyChecker()
  })

  it("reports safe for identical schemas", () => {
    const result = checker.check(baseSchema(), baseSchema())
    expect(result.safe).toBe(true)
    expect(result.risks).toHaveLength(0)
    expect(result.estimatedDowntime).toBe("none")
  })

  it("detects critical risk for new non-nullable column without default", () => {
    const newSchema = baseSchema()
    newSchema.tables[0].columns.push({ name: "age", type: "integer", nullable: false })
    const result = checker.check(baseSchema(), newSchema)
    expect(result.safe).toBe(false)
    expect(result.risks.some((r) => r.severity === "critical")).toBe(true)
    expect(result.estimatedDowntime).toBe("significant")
  })

  it("detects high risk for type change", () => {
    const newSchema = baseSchema()
    newSchema.tables[0].columns.find((c) => c.name === "name")!.type = "integer"
    const result = checker.check(baseSchema(), newSchema)
    expect(result.risks.some((r) => r.severity === "high")).toBe(true)
  })

  it("detects medium risk for dropped column", () => {
    const newSchema = baseSchema()
    newSchema.tables[0].columns = newSchema.tables[0].columns.filter((c) => c.name !== "bio")
    const result = checker.check(baseSchema(), newSchema)
    expect(result.risks.some((r) => r.severity === "medium")).toBe(true)
  })

  it("new nullable column with default is safe", () => {
    const newSchema = baseSchema()
    newSchema.tables[0].columns.push({ name: "avatar", type: "text", nullable: true })
    const result = checker.check(baseSchema(), newSchema)
    expect(result.safe).toBe(true)
    expect(result.risks).toHaveLength(0)
  })
})

// ─── SchemaRegistry ──────────────────────────────────────────────────────────

describe("SchemaRegistry", () => {
  let registry: SchemaRegistry

  beforeEach(() => {
    registry = new SchemaRegistry()
  })

  describe("registerVersion", () => {
    it("registers first version with no compatibility check", () => {
      const { version, compatibility } = registry.registerVersion(baseSchema(), "initial schema", "dev")
      expect(version.version).toBe(1)
      expect(version.description).toBe("initial schema")
      expect(version.createdBy).toBe("dev")
      expect(version.fingerprint).toBeTruthy()
      expect(compatibility).toBeNull()
    })

    it("auto-increments versions", () => {
      registry.registerVersion(baseSchema())
      const { version } = registry.registerVersion(baseSchema())
      expect(version.version).toBe(2)
    })

    it("returns compatibility for second+ versions", () => {
      registry.registerVersion(baseSchema())
      const modified = baseSchema()
      modified.tables[0].columns.push({ name: "avatar", type: "text", nullable: true })
      const { compatibility } = registry.registerVersion(modified)
      expect(compatibility).not.toBeNull()
      expect(compatibility!.compatible).toBe(true)
    })

    it("strict mode throws on breaking changes", () => {
      const strict = new SchemaRegistry({ strictMode: true })
      strict.registerVersion(baseSchema())

      const breaking = { tables: [] } as SchemaSpec
      expect(() => strict.registerVersion(breaking)).toThrow(SchemaRegistryError)
    })

    it("strict mode doesn't increment version on failure", () => {
      const strict = new SchemaRegistry({ strictMode: true })
      strict.registerVersion(baseSchema())

      try {
        strict.registerVersion({ tables: [] })
      } catch {
        // expected
      }

      expect(strict.getLatestVersion()!.version).toBe(1)
    })
  })

  describe("getVersion / getLatestVersion", () => {
    it("returns null for nonexistent version", () => {
      expect(registry.getVersion(999)).toBeNull()
    })

    it("returns null when registry is empty", () => {
      expect(registry.getLatestVersion()).toBeNull()
    })

    it("retrieves specific version", () => {
      registry.registerVersion(baseSchema(), "v1")
      registry.registerVersion(baseSchema(), "v2")
      expect(registry.getVersion(1)!.description).toBe("v1")
      expect(registry.getVersion(2)!.description).toBe("v2")
    })

    it("returns latest version", () => {
      registry.registerVersion(baseSchema(), "first")
      registry.registerVersion(baseSchema(), "second")
      expect(registry.getLatestVersion()!.description).toBe("second")
    })
  })

  describe("listVersions", () => {
    it("returns sorted versions", () => {
      registry.registerVersion(baseSchema())
      registry.registerVersion(baseSchema())
      registry.registerVersion(baseSchema())
      const versions = registry.listVersions()
      expect(versions).toHaveLength(3)
      expect(versions[0].version).toBe(1)
      expect(versions[2].version).toBe(3)
    })
  })

  describe("version pruning", () => {
    it("prunes old versions when maxVersions exceeded", () => {
      const small = new SchemaRegistry({ maxVersions: 2 })
      small.registerVersion(baseSchema(), "v1")
      small.registerVersion(baseSchema(), "v2")
      small.registerVersion(baseSchema(), "v3")
      expect(small.listVersions()).toHaveLength(2)
      expect(small.getVersion(1)).toBeNull()
    })
  })

  describe("checkCompatibility", () => {
    it("detects breaking changes", () => {
      const result = registry.checkCompatibility(baseSchema(), { tables: [] })
      expect(result.compatible).toBe(false)
      expect(result.breakingChanges.length).toBeGreaterThan(0)
    })

    it("reports affected consumers", () => {
      registry.registerVersion(baseSchema())
      registry.registerContract(makeContract())

      const result = registry.checkCompatibility(baseSchema(), { tables: [] })
      expect(result.affectedConsumers).toContain("frontend-app")
    })
  })

  describe("consumer contracts", () => {
    it("registers and retrieves contract", () => {
      const violations = registry.registerContract(makeContract())
      // No schema registered yet, so no validation
      expect(violations).toHaveLength(0)

      expect(registry.getContract("c1")).toBeDefined()
      expect(registry.getContract("c1")!.consumerName).toBe("frontend-app")
    })

    it("validates contract against latest schema", () => {
      registry.registerVersion(baseSchema())
      const violations = registry.registerContract(makeContract())
      expect(violations).toHaveLength(0) // schema satisfies contract
    })

    it("reports violations when schema doesn't match contract", () => {
      registry.registerVersion({ tables: [] })
      const violations = registry.registerContract(makeContract())
      expect(violations.length).toBeGreaterThan(0)
    })

    it("returns null for nonexistent contract", () => {
      expect(registry.getContract("missing")).toBeNull()
    })

    it("lists contracts by status", () => {
      registry.registerContract(makeContract({ id: "c1", status: "active" }))
      registry.registerContract(makeContract({ id: "c2", status: "deprecated" }))
      expect(registry.listContracts("active")).toHaveLength(1)
      expect(registry.listContracts("deprecated")).toHaveLength(1)
      expect(registry.listContracts()).toHaveLength(2)
    })
  })

  describe("checkMigrationSafety", () => {
    it("checks migration safety between versions", () => {
      registry.registerVersion(baseSchema())
      const modified = baseSchema()
      modified.tables[0].columns.push({ name: "age", type: "integer", nullable: false })
      registry.registerVersion(modified)

      const result = registry.checkMigrationSafety(1, 2)
      expect(result.safe).toBe(false)
    })

    it("throws for nonexistent version", () => {
      expect(() => registry.checkMigrationSafety(1, 2)).toThrow("Version not found")
    })
  })

  describe("getStats", () => {
    it("returns correct stats", () => {
      registry.registerVersion(baseSchema())
      registry.registerVersion(baseSchema())
      registry.registerContract(makeContract({ id: "c1", status: "active" }))
      registry.registerContract(makeContract({ id: "c2", consumerId: "svc-2", status: "broken" }))

      const stats = registry.getStats()
      expect(stats.versionCount).toBe(2)
      expect(stats.consumerCount).toBe(2)
      expect(stats.activeContracts).toBe(1)
      expect(stats.brokenContracts).toBe(1)
    })
  })

  describe("empty registry", () => {
    it("handles empty registry gracefully", () => {
      expect(registry.getLatestVersion()).toBeNull()
      expect(registry.listVersions()).toHaveLength(0)
      expect(registry.listContracts()).toHaveLength(0)
      expect(registry.getStats().versionCount).toBe(0)
    })
  })
})
