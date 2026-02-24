// --------------------------------------------------------------------------
// Schema Registry & Consumer-Driven Contracts
// Breaking change detection, consumer contracts, migration safety checks
// --------------------------------------------------------------------------

// ── Types ──────────────────────────────────────────────────────────────────

export interface SchemaVersion {
  id: string
  version: number
  schema: SchemaSpec
  createdAt: number
  createdBy: string
  description: string
  fingerprint: string
}

export interface SchemaSpec {
  tables: TableSpec[]
  enums?: EnumSpec[]
}

export interface TableSpec {
  name: string
  columns: ColumnSpec[]
  indexes?: IndexSpec[]
  constraints?: ConstraintSpec[]
}

export interface ColumnSpec {
  name: string
  type: string
  nullable: boolean
  defaultValue?: unknown
  isPrimaryKey?: boolean
  isUnique?: boolean
  references?: { table: string; column: string }
}

export interface IndexSpec {
  name: string
  columns: string[]
  unique: boolean
}

export interface ConstraintSpec {
  name: string
  type: "check" | "unique" | "foreign_key" | "exclusion"
  definition: string
}

export interface EnumSpec {
  name: string
  values: string[]
}

export interface ConsumerContract {
  id: string
  consumerId: string
  consumerName: string
  requiredTables: RequiredTable[]
  createdAt: number
  updatedAt: number
  status: "active" | "deprecated" | "broken"
}

export interface RequiredTable {
  name: string
  requiredColumns: RequiredColumn[]
  requiredConstraints?: string[]
}

export interface RequiredColumn {
  name: string
  type?: string
  nullable?: boolean
}

export interface BreakingChange {
  type: BreakingChangeType
  severity: "error" | "warning"
  table?: string
  column?: string
  description: string
  suggestion?: string
}

export type BreakingChangeType =
  | "table_removed"
  | "column_removed"
  | "column_type_changed"
  | "column_made_non_nullable"
  | "column_default_removed"
  | "index_removed"
  | "constraint_removed"
  | "enum_value_removed"
  | "primary_key_changed"
  | "foreign_key_removed"

export interface CompatibilityResult {
  compatible: boolean
  breakingChanges: BreakingChange[]
  warnings: BreakingChange[]
  affectedConsumers: string[]
}

export interface MigrationSafetyCheck {
  safe: boolean
  risks: MigrationRisk[]
  estimatedDowntime: "none" | "minimal" | "moderate" | "significant"
  suggestions: string[]
}

export interface MigrationRisk {
  severity: "low" | "medium" | "high" | "critical"
  description: string
  table: string
  mitigation: string
}

export interface SchemaRegistryOptions {
  maxVersions?: number
  strictMode?: boolean
  autoDetectBreaking?: boolean
}

export interface RegistryStats {
  versionCount: number
  consumerCount: number
  activeContracts: number
  brokenContracts: number
}

// ── Error ──────────────────────────────────────────────────────────────────

export class SchemaRegistryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = "SchemaRegistryError"
  }
}

// ── SQL Builders ───────────────────────────────────────────────────────────

export function buildCreateSchemaRegistryTablesSQL(): string {
  return `
    CREATE TABLE IF NOT EXISTS _rb_schema_versions (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL UNIQUE,
      schema JSONB NOT NULL,
      fingerprint TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_schema_version ON _rb_schema_versions (version);

    CREATE TABLE IF NOT EXISTS _rb_consumer_contracts (
      id TEXT PRIMARY KEY,
      consumer_id TEXT NOT NULL,
      consumer_name TEXT NOT NULL,
      required_tables JSONB NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_contract_consumer ON _rb_consumer_contracts (consumer_id);
    CREATE INDEX IF NOT EXISTS idx_contract_status ON _rb_consumer_contracts (status);

    CREATE TABLE IF NOT EXISTS _rb_schema_changelog (
      id BIGSERIAL PRIMARY KEY,
      from_version INTEGER NOT NULL,
      to_version INTEGER NOT NULL,
      breaking_changes JSONB NOT NULL DEFAULT '[]',
      checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `
}

export function buildInsertVersionSQL(): string {
  return `INSERT INTO _rb_schema_versions (id, version, schema, fingerprint, description, created_by) VALUES ($1, $2, $3, $4, $5, $6)`
}

export function buildGetVersionSQL(): string {
  return `SELECT * FROM _rb_schema_versions WHERE version = $1`
}

export function buildGetLatestVersionSQL(): string {
  return `SELECT * FROM _rb_schema_versions ORDER BY version DESC LIMIT 1`
}

export function buildUpsertContractSQL(): string {
  return `
    INSERT INTO _rb_consumer_contracts (id, consumer_id, consumer_name, required_tables, status, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (id) DO UPDATE SET required_tables = $4, status = $5, updated_at = NOW()
  `
}

export function buildGetContractsByStatusSQL(): string {
  return `SELECT * FROM _rb_consumer_contracts WHERE status = $1`
}

// ── Schema Fingerprinting ──────────────────────────────────────────────────

export function computeFingerprint(schema: SchemaSpec): string {
  const normalized = JSON.stringify(schema, Object.keys(schema).sort())
  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return `fp_${Math.abs(hash).toString(36)}`
}

// ── Breaking Change Detector ───────────────────────────────────────────────

export class BreakingChangeDetector {
  detect(oldSchema: SchemaSpec, newSchema: SchemaSpec): BreakingChange[] {
    const changes: BreakingChange[] = []

    const oldTables = new Map(oldSchema.tables.map((t) => [t.name, t]))
    const newTables = new Map(newSchema.tables.map((t) => [t.name, t]))

    // Removed tables
    for (const [name] of oldTables) {
      if (!newTables.has(name)) {
        changes.push({
          type: "table_removed",
          severity: "error",
          table: name,
          description: `Table "${name}" was removed`,
          suggestion: `Mark as deprecated first, then remove after consumers migrate`,
        })
      }
    }

    // Changed tables
    for (const [name, oldTable] of oldTables) {
      const newTable = newTables.get(name)
      if (!newTable) continue

      const oldCols = new Map(oldTable.columns.map((c) => [c.name, c]))
      const newCols = new Map(newTable.columns.map((c) => [c.name, c]))

      // Removed columns
      for (const [colName] of oldCols) {
        if (!newCols.has(colName)) {
          changes.push({
            type: "column_removed",
            severity: "error",
            table: name,
            column: colName,
            description: `Column "${name}.${colName}" was removed`,
            suggestion: `Add column back or migrate consumers first`,
          })
        }
      }

      // Changed columns
      for (const [colName, oldCol] of oldCols) {
        const newCol = newCols.get(colName)
        if (!newCol) continue

        if (oldCol.type !== newCol.type) {
          changes.push({
            type: "column_type_changed",
            severity: "error",
            table: name,
            column: colName,
            description: `Column "${name}.${colName}" type changed from "${oldCol.type}" to "${newCol.type}"`,
            suggestion: `Create a new column with the new type and migrate data`,
          })
        }

        if (oldCol.nullable && !newCol.nullable) {
          changes.push({
            type: "column_made_non_nullable",
            severity: "error",
            table: name,
            column: colName,
            description: `Column "${name}.${colName}" changed from nullable to non-nullable`,
            suggestion: `Set a default value or backfill existing NULL values first`,
          })
        }

        if (oldCol.defaultValue !== undefined && newCol.defaultValue === undefined) {
          changes.push({
            type: "column_default_removed",
            severity: "warning",
            table: name,
            column: colName,
            description: `Default value for "${name}.${colName}" was removed`,
          })
        }
      }

      // Removed indexes
      if (oldTable.indexes && newTable.indexes) {
        const newIndexNames = new Set(newTable.indexes.map((i) => i.name))
        for (const idx of oldTable.indexes) {
          if (!newIndexNames.has(idx.name)) {
            changes.push({
              type: "index_removed",
              severity: "warning",
              table: name,
              description: `Index "${idx.name}" on "${name}" was removed`,
            })
          }
        }
      }
    }

    // Removed enum values
    if (oldSchema.enums && newSchema.enums) {
      const newEnums = new Map(newSchema.enums.map((e) => [e.name, e]))
      for (const oldEnum of oldSchema.enums) {
        const newEnum = newEnums.get(oldEnum.name)
        if (!newEnum) continue
        const newValues = new Set(newEnum.values)
        for (const val of oldEnum.values) {
          if (!newValues.has(val)) {
            changes.push({
              type: "enum_value_removed",
              severity: "error",
              description: `Enum value "${val}" removed from "${oldEnum.name}"`,
              suggestion: `Deprecate the value instead of removing it`,
            })
          }
        }
      }
    }

    return changes
  }
}

// ── Contract Validator ─────────────────────────────────────────────────────

export class ContractValidator {
  validate(contract: ConsumerContract, schema: SchemaSpec): BreakingChange[] {
    const changes: BreakingChange[] = []
    const tables = new Map(schema.tables.map((t) => [t.name, t]))

    for (const req of contract.requiredTables) {
      const table = tables.get(req.name)
      if (!table) {
        changes.push({
          type: "table_removed",
          severity: "error",
          table: req.name,
          description: `Consumer "${contract.consumerName}" requires table "${req.name}" which is missing`,
        })
        continue
      }

      const cols = new Map(table.columns.map((c) => [c.name, c]))
      for (const reqCol of req.requiredColumns) {
        const col = cols.get(reqCol.name)
        if (!col) {
          changes.push({
            type: "column_removed",
            severity: "error",
            table: req.name,
            column: reqCol.name,
            description: `Consumer "${contract.consumerName}" requires column "${req.name}.${reqCol.name}" which is missing`,
          })
          continue
        }

        if (reqCol.type && col.type !== reqCol.type) {
          changes.push({
            type: "column_type_changed",
            severity: "error",
            table: req.name,
            column: reqCol.name,
            description: `Consumer "${contract.consumerName}" expects "${req.name}.${reqCol.name}" to be "${reqCol.type}" but found "${col.type}"`,
          })
        }

        if (reqCol.nullable === false && col.nullable) {
          changes.push({
            type: "column_made_non_nullable",
            severity: "warning",
            table: req.name,
            column: reqCol.name,
            description: `Consumer "${contract.consumerName}" expects "${req.name}.${reqCol.name}" to be non-nullable`,
          })
        }
      }
    }

    return changes
  }
}

// ── Migration Safety Checker ───────────────────────────────────────────────

export class MigrationSafetyChecker {
  check(oldSchema: SchemaSpec, newSchema: SchemaSpec): MigrationSafetyCheck {
    const risks: MigrationRisk[] = []
    const suggestions: string[] = []

    const oldTables = new Map(oldSchema.tables.map((t) => [t.name, t]))
    const newTables = new Map(newSchema.tables.map((t) => [t.name, t]))

    for (const [name, newTable] of newTables) {
      const oldTable = oldTables.get(name)
      if (!oldTable) continue

      const oldCols = new Map(oldTable.columns.map((c) => [c.name, c]))

      for (const col of newTable.columns) {
        const oldCol = oldCols.get(col.name)

        // New non-nullable column without default
        if (!oldCol && !col.nullable && col.defaultValue === undefined) {
          risks.push({
            severity: "critical",
            description: `New non-nullable column "${name}.${col.name}" without default value`,
            table: name,
            mitigation: "Add a default value or make the column nullable initially",
          })
        }

        // Type change on existing column
        if (oldCol && oldCol.type !== col.type) {
          risks.push({
            severity: "high",
            description: `Type change on "${name}.${col.name}": ${oldCol.type} → ${col.type}`,
            table: name,
            mitigation: "Use a multi-step migration: add new column, copy data, rename, drop old",
          })
        }
      }

      // Check for removed columns that may still have data
      for (const [colName] of oldCols) {
        if (!newTable.columns.some((c) => c.name === colName)) {
          risks.push({
            severity: "medium",
            description: `Dropped column "${name}.${colName}" may contain data`,
            table: name,
            mitigation: "Verify no application code references this column before dropping",
          })
        }
      }
    }

    // Determine downtime estimate
    let downtime: MigrationSafetyCheck["estimatedDowntime"] = "none"
    const maxSeverity = risks.reduce(
      (max, r) => {
        const order = { low: 0, medium: 1, high: 2, critical: 3 }
        return order[r.severity] > order[max] ? r.severity : max
      },
      "low" as MigrationRisk["severity"],
    )

    if (maxSeverity === "critical") {
      downtime = "significant"
      suggestions.push("Consider running this migration during a maintenance window")
    } else if (maxSeverity === "high") {
      downtime = "moderate"
      suggestions.push("Use online DDL techniques to minimize lock time")
    } else if (maxSeverity === "medium") {
      downtime = "minimal"
    }

    if (risks.length === 0) {
      suggestions.push("Migration appears safe for online deployment")
    }

    return {
      safe: risks.every((r) => r.severity !== "critical"),
      risks,
      estimatedDowntime: downtime,
      suggestions,
    }
  }
}

// ── Schema Registry (Main Engine) ──────────────────────────────────────────

export class SchemaRegistry {
  private versions = new Map<number, SchemaVersion>()
  private contracts = new Map<string, ConsumerContract>()
  private latestVersion = 0
  readonly detector = new BreakingChangeDetector()
  readonly contractValidator = new ContractValidator()
  readonly safetyChecker = new MigrationSafetyChecker()
  private readonly maxVersions: number
  private readonly strictMode: boolean

  constructor(options: SchemaRegistryOptions = {}) {
    this.maxVersions = options.maxVersions ?? 1000
    this.strictMode = options.strictMode ?? false
  }

  registerVersion(
    schema: SchemaSpec,
    description: string = "",
    createdBy: string = "",
  ): { version: SchemaVersion; compatibility: CompatibilityResult | null } {
    this.latestVersion++
    const fingerprint = computeFingerprint(schema)

    const sv: SchemaVersion = {
      id: `sv_${this.latestVersion}`,
      version: this.latestVersion,
      schema,
      createdAt: Date.now(),
      createdBy,
      description,
      fingerprint,
    }

    // Check compatibility with previous version
    let compatibility: CompatibilityResult | null = null
    if (this.latestVersion > 1) {
      const previous = this.versions.get(this.latestVersion - 1)
      if (previous) {
        compatibility = this.checkCompatibility(previous.schema, schema)

        if (this.strictMode && !compatibility.compatible) {
          this.latestVersion--
          throw new SchemaRegistryError(
            `Breaking changes detected: ${compatibility.breakingChanges.map((c) => c.description).join("; ")}`,
            "BREAKING_CHANGES",
          )
        }
      }
    }

    this.versions.set(this.latestVersion, sv)

    // Prune old versions
    if (this.versions.size > this.maxVersions) {
      const oldest = Math.min(...this.versions.keys())
      this.versions.delete(oldest)
    }

    return { version: sv, compatibility }
  }

  getVersion(version: number): SchemaVersion | null {
    return this.versions.get(version) || null
  }

  getLatestVersion(): SchemaVersion | null {
    return this.versions.get(this.latestVersion) || null
  }

  listVersions(): SchemaVersion[] {
    return Array.from(this.versions.values()).sort((a, b) => a.version - b.version)
  }

  checkCompatibility(oldSchema: SchemaSpec, newSchema: SchemaSpec): CompatibilityResult {
    const allChanges = this.detector.detect(oldSchema, newSchema)
    const breakingChanges = allChanges.filter((c) => c.severity === "error")
    const warnings = allChanges.filter((c) => c.severity === "warning")

    // Check consumer contracts
    const affectedConsumers: string[] = []
    for (const [, contract] of this.contracts) {
      if (contract.status !== "active") continue
      const violations = this.contractValidator.validate(contract, newSchema)
      if (violations.length > 0) {
        affectedConsumers.push(contract.consumerName)
      }
    }

    return {
      compatible: breakingChanges.length === 0 && affectedConsumers.length === 0,
      breakingChanges,
      warnings,
      affectedConsumers,
    }
  }

  registerContract(contract: ConsumerContract): BreakingChange[] {
    this.contracts.set(contract.id, contract)

    // Validate against current schema
    const latest = this.getLatestVersion()
    if (latest) {
      return this.contractValidator.validate(contract, latest.schema)
    }
    return []
  }

  getContract(id: string): ConsumerContract | null {
    return this.contracts.get(id) || null
  }

  listContracts(status?: ConsumerContract["status"]): ConsumerContract[] {
    const all = Array.from(this.contracts.values())
    return status ? all.filter((c) => c.status === status) : all
  }

  checkMigrationSafety(fromVersion: number, toVersion: number): MigrationSafetyCheck {
    const from = this.versions.get(fromVersion)
    const to = this.versions.get(toVersion)
    if (!from || !to) {
      throw new SchemaRegistryError("Version not found", "VERSION_NOT_FOUND")
    }
    return this.safetyChecker.check(from.schema, to.schema)
  }

  getStats(): RegistryStats {
    const contracts = Array.from(this.contracts.values())
    return {
      versionCount: this.versions.size,
      consumerCount: new Set(contracts.map((c) => c.consumerId)).size,
      activeContracts: contracts.filter((c) => c.status === "active").length,
      brokenContracts: contracts.filter((c) => c.status === "broken").length,
    }
  }
}
