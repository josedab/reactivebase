/**
 * Data Governance Policies for ReactiveBase.
 * Extends the declarative policy system with data classification,
 * retention rules, masking, and compliance enforcement.
 *
 * Features:
 *   - Data classification (public, internal, confidential, restricted)
 *   - Automatic field masking/redaction based on classification
 *   - Retention policies with automatic cleanup SQL
 *   - Data residency constraints (region-aware)
 *   - Audit logging policy for tracking access
 *   - Validation policies for data integrity
 *   - Cross-table referential integrity policies
 *
 * Usage:
 *   const governance = defineDataGovernance({
 *     users: {
 *       classification: "confidential",
 *       fields: {
 *         email: { classification: "pii", mask: "email" },
 *         ssn: { classification: "restricted", mask: "full" },
 *       },
 *       retention: { days: 365, action: "anonymize" },
 *       audit: { read: true, write: true },
 *     },
 *   })
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type DataClassification = "public" | "internal" | "confidential" | "restricted" | "pii"

export type MaskingStrategy = "none" | "partial" | "email" | "full" | "hash" | "null" | "custom"

export type RetentionAction = "delete" | "anonymize" | "archive"

export interface DataGovernanceSchema {
  [tableName: string]: TableGovernancePolicy
}

export interface TableGovernancePolicy {
  /** Overall data classification for the table */
  classification?: DataClassification
  /** Field-level governance */
  fields?: Record<string, FieldGovernancePolicy>
  /** Data retention policy */
  retention?: RetentionPolicy
  /** Audit logging configuration */
  audit?: AuditPolicy
  /** Validation rules */
  validations?: ValidationRule[]
  /** Data residency requirements */
  residency?: ResidencyPolicy
}

export interface FieldGovernancePolicy {
  /** Data classification for this field */
  classification?: DataClassification
  /** Masking strategy for unauthorized access */
  mask?: MaskingStrategy
  /** Custom masking function (when mask is "custom") */
  customMask?: (value: unknown) => unknown
  /** Minimum role required to see unmasked value */
  unmaskRoles?: string[]
}

export interface RetentionPolicy {
  /** Retention period in days */
  days: number
  /** Column to check for age (default: "created_at") */
  timeColumn?: string
  /** Action when retention period expires */
  action: RetentionAction
  /** Columns to anonymize (when action is "anonymize") */
  anonymizeColumns?: string[]
  /** Archive table name (when action is "archive") */
  archiveTable?: string
}

export interface AuditPolicy {
  /** Log read access */
  read?: boolean
  /** Log write access (insert/update/delete) */
  write?: boolean
  /** Specific columns to audit */
  columns?: string[]
  /** Include row data in audit log */
  includeData?: boolean
}

export interface ValidationRule {
  /** Rule name */
  name: string
  /** Column to validate */
  column: string
  /** Validation type */
  type: "not_empty" | "regex" | "range" | "enum" | "unique" | "custom_sql"
  /** Validation parameters */
  params?: Record<string, unknown>
  /** Error message */
  message: string
}

export interface ResidencyPolicy {
  /** Allowed regions for data storage */
  regions: string[]
  /** Column tracking data region (if applicable) */
  regionColumn?: string
}

export interface GovernanceConfig {
  schema: DataGovernanceSchema
  tables: string[]
}

export interface GovernanceViolation {
  table: string
  field?: string
  rule: string
  severity: "error" | "warning" | "info"
  message: string
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Define data governance policies.
 */
export function defineDataGovernance(schema: DataGovernanceSchema): GovernanceConfig {
  const tables = Object.keys(schema)
  if (tables.length === 0) {
    throw new GovernanceError("At least one table must be defined")
  }

  // Validate schema
  for (const [table, policy] of Object.entries(schema)) {
    if (policy.retention) {
      if (policy.retention.days <= 0) {
        throw new GovernanceError(`Retention days for "${table}" must be positive`)
      }
      if (policy.retention.action === "anonymize" && !policy.retention.anonymizeColumns?.length) {
        throw new GovernanceError(`Retention policy for "${table}" uses "anonymize" but no anonymizeColumns specified`)
      }
    }
  }

  return { schema, tables }
}

/**
 * Apply field masking based on governance policies.
 */
export function applyGovernanceMasking(
  config: GovernanceConfig,
  table: string,
  row: Record<string, unknown>,
  userRoles: string[],
): { row: Record<string, unknown>; maskedFields: string[] } {
  const policy = config.schema[table]
  if (!policy?.fields) return { row, maskedFields: [] }

  const result = { ...row }
  const maskedFields: string[] = []

  for (const [field, fieldPolicy] of Object.entries(policy.fields)) {
    if (!(field in result)) continue

    // Check if user has unmasking roles
    if (fieldPolicy.unmaskRoles?.length) {
      const canUnmask = fieldPolicy.unmaskRoles.some((r) => userRoles.includes(r))
      if (canUnmask) continue
    }

    // Apply masking
    const masked = maskValue(result[field], fieldPolicy.mask ?? "none", fieldPolicy.customMask)
    if (masked !== result[field]) {
      result[field] = masked
      maskedFields.push(field)
    }
  }

  return { row: result, maskedFields }
}

/**
 * Generate retention cleanup SQL for a table.
 */
export function generateRetentionSQL(config: GovernanceConfig, table: string): string[] {
  const policy = config.schema[table]
  if (!policy?.retention) return []

  const timeCol = policy.retention.timeColumn ?? "created_at"
  const sanitizedTable = sanitize(table)
  const sanitizedTimeCol = sanitize(timeCol)
  const days = Number(policy.retention.days)
  if (!Number.isFinite(days) || days <= 0) {
    throw new GovernanceError(`Invalid retention.days for table "${table}": must be a finite positive number`)
  }
  const interval = `${days} days`

  const statements: string[] = []

  switch (policy.retention.action) {
    case "delete":
      statements.push(`DELETE FROM "${sanitizedTable}" WHERE "${sanitizedTimeCol}" < NOW() - INTERVAL '${interval}';`)
      break

    case "anonymize": {
      const setClauses = (policy.retention.anonymizeColumns ?? []).map((col) => `"${sanitize(col)}" = NULL`).join(", ")
      if (setClauses) {
        statements.push(
          `UPDATE "${sanitizedTable}" SET ${setClauses} WHERE "${sanitizedTimeCol}" < NOW() - INTERVAL '${interval}' AND "${sanitize((policy.retention.anonymizeColumns ?? [])[0])}" IS NOT NULL;`,
        )
      }
      break
    }

    case "archive": {
      const archiveTable = sanitize(policy.retention.archiveTable ?? `${table}_archive`)
      statements.push(
        `INSERT INTO "${archiveTable}" SELECT * FROM "${sanitizedTable}" WHERE "${sanitizedTimeCol}" < NOW() - INTERVAL '${interval}';`,
      )
      statements.push(`DELETE FROM "${sanitizedTable}" WHERE "${sanitizedTimeCol}" < NOW() - INTERVAL '${interval}';`)
      break
    }
  }

  return statements
}

/**
 * Generate validation constraint SQL from governance policies.
 */
export function generateValidationSQL(config: GovernanceConfig, table: string): string[] {
  const policy = config.schema[table]
  if (!policy?.validations?.length) return []

  const sanitizedTable = sanitize(table)
  const statements: string[] = []

  for (const rule of policy.validations) {
    const constraintName = sanitize(`chk_${table}_${rule.name}`)
    const col = sanitize(rule.column)

    switch (rule.type) {
      case "not_empty":
        statements.push(
          `ALTER TABLE "${sanitizedTable}" ADD CONSTRAINT "${constraintName}" CHECK ("${col}" IS NOT NULL AND "${col}" != '');`,
        )
        break
      case "regex":
        if (rule.params?.pattern) {
          const pattern = String(rule.params.pattern)
          // Validate that the pattern is a well-formed regex
          try {
            new RegExp(pattern)
          } catch {
            throw new GovernanceError(`Invalid regex pattern for constraint "${rule.name}": ${pattern}`)
          }
          // Reject patterns containing single quotes that could escape the SQL string context
          if (/[;]/.test(pattern) || /--/.test(pattern)) {
            throw new GovernanceError(`Regex pattern for constraint "${rule.name}" contains disallowed SQL characters`)
          }
          statements.push(
            `ALTER TABLE "${sanitizedTable}" ADD CONSTRAINT "${constraintName}" CHECK ("${col}" ~ '${pattern.replace(/'/g, "''")}');`,
          )
        }
        break
      case "range":
        if (rule.params?.min !== undefined && rule.params?.max !== undefined) {
          statements.push(
            `ALTER TABLE "${sanitizedTable}" ADD CONSTRAINT "${constraintName}" CHECK ("${col}" >= ${Number(rule.params.min)} AND "${col}" <= ${Number(rule.params.max)});`,
          )
        }
        break
      case "enum":
        if (Array.isArray(rule.params?.values)) {
          const values = (rule.params.values as string[]).map((v) => `'${String(v).replace(/'/g, "''")}'`).join(", ")
          statements.push(
            `ALTER TABLE "${sanitizedTable}" ADD CONSTRAINT "${constraintName}" CHECK ("${col}" IN (${values}));`,
          )
        }
        break
      case "unique":
        statements.push(`ALTER TABLE "${sanitizedTable}" ADD CONSTRAINT "${constraintName}" UNIQUE ("${col}");`)
        break
      case "custom_sql":
        if (rule.params?.sql) {
          const customSql = String(rule.params.sql)
          // Blocklist: reject semicolons, DDL keywords, and subqueries to prevent SQL injection
          const sqlBlocklistPattern =
            /;|--|\/\*|\b(DROP|ALTER|CREATE|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE|UNION|INTO)\b/i
          if (sqlBlocklistPattern.test(customSql)) {
            throw new GovernanceError(
              `custom_sql for constraint "${rule.name}" contains disallowed SQL keywords or characters`,
            )
          }
          if (/\([\s]*SELECT\b/i.test(customSql)) {
            throw new GovernanceError(`custom_sql for constraint "${rule.name}" contains disallowed subquery`)
          }
          statements.push(`ALTER TABLE "${sanitizedTable}" ADD CONSTRAINT "${constraintName}" CHECK (${customSql});`)
        }
        break
    }
  }

  return statements
}

/**
 * Generate audit trigger SQL for a table.
 */
export function generateAuditTriggerSQL(config: GovernanceConfig, table: string): string[] {
  const policy = config.schema[table]
  if (!policy?.audit) return []
  if (!policy.audit.read && !policy.audit.write) return []

  const sanitizedTable = sanitize(table)
  const statements: string[] = []

  // Audit table
  statements.push(
    `
CREATE TABLE IF NOT EXISTS _reactivebase_audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  action TEXT NOT NULL,
  user_id TEXT,
  row_id TEXT,
  old_data JSONB,
  new_data JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_table ON _reactivebase_audit_log(table_name, timestamp);
`.trim(),
  )

  if (policy.audit.write) {
    const includeData = policy.audit.includeData !== false
    const funcName = `_rb_audit_${sanitizedTable}`

    statements.push(
      `
CREATE OR REPLACE FUNCTION ${funcName}() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO _reactivebase_audit_log (table_name, action, row_id${includeData ? ", new_data" : ""})
    VALUES ('${sanitizedTable}', 'INSERT', NEW.id::text${includeData ? ", to_jsonb(NEW)" : ""});
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO _reactivebase_audit_log (table_name, action, row_id${includeData ? ", old_data, new_data" : ""})
    VALUES ('${sanitizedTable}', 'UPDATE', NEW.id::text${includeData ? ", to_jsonb(OLD), to_jsonb(NEW)" : ""});
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO _reactivebase_audit_log (table_name, action, row_id${includeData ? ", old_data" : ""})
    VALUES ('${sanitizedTable}', 'DELETE', OLD.id::text${includeData ? ", to_jsonb(OLD)" : ""});
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "${funcName}_trg" ON "${sanitizedTable}";
CREATE TRIGGER "${funcName}_trg"
  AFTER INSERT OR UPDATE OR DELETE ON "${sanitizedTable}"
  FOR EACH ROW EXECUTE FUNCTION ${funcName}();
`.trim(),
    )
  }

  return statements
}

/**
 * Validate a governance schema and return any violations.
 */
export function validateGovernance(config: GovernanceConfig): GovernanceViolation[] {
  const violations: GovernanceViolation[] = []

  for (const [table, policy] of Object.entries(config.schema)) {
    // Check for restricted fields without masking
    if (policy.fields) {
      for (const [field, fieldPolicy] of Object.entries(policy.fields)) {
        if (
          (fieldPolicy.classification === "restricted" || fieldPolicy.classification === "pii") &&
          (!fieldPolicy.mask || fieldPolicy.mask === "none")
        ) {
          violations.push({
            table,
            field,
            rule: "restricted-no-mask",
            severity: "warning",
            message: `Field "${field}" is classified as "${fieldPolicy.classification}" but has no masking strategy`,
          })
        }
      }
    }

    // Check for confidential tables without audit
    if ((policy.classification === "confidential" || policy.classification === "restricted") && !policy.audit) {
      violations.push({
        table,
        rule: "confidential-no-audit",
        severity: "warning",
        message: `Table "${table}" is classified as "${policy.classification}" but has no audit policy`,
      })
    }

    // Check for PII without retention
    if (policy.fields) {
      const hasPii = Object.values(policy.fields).some((f) => f.classification === "pii")
      if (hasPii && !policy.retention) {
        violations.push({
          table,
          rule: "pii-no-retention",
          severity: "info",
          message: `Table "${table}" contains PII fields but has no retention policy`,
        })
      }
    }
  }

  return violations
}

/**
 * Generate all governance SQL for all tables.
 */
export function generateAllGovernanceSQL(config: GovernanceConfig): string {
  const parts: string[] = ["-- ReactiveBase Data Governance SQL", ""]

  for (const table of config.tables) {
    const retentionSQL = generateRetentionSQL(config, table)
    const validationSQL = generateValidationSQL(config, table)
    const auditSQL = generateAuditTriggerSQL(config, table)

    if (retentionSQL.length || validationSQL.length || auditSQL.length) {
      parts.push(`-- ═══ Governance: ${table} ═══`)
    }

    if (validationSQL.length) {
      parts.push("-- Validation constraints")
      parts.push(...validationSQL)
    }
    if (auditSQL.length) {
      parts.push("-- Audit triggers")
      parts.push(...auditSQL)
    }
    if (retentionSQL.length) {
      parts.push("-- Retention cleanup (run periodically)")
      parts.push(...retentionSQL)
    }
    parts.push("")
  }

  return parts.join("\n")
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function maskValue(value: unknown, strategy: MaskingStrategy, customMask?: (value: unknown) => unknown): unknown {
  if (value === null || value === undefined) return value

  switch (strategy) {
    case "none":
      return value

    case "full":
      return "████████"

    case "partial": {
      const str = String(value)
      if (str.length <= 4) return "****"
      return str.slice(0, 2) + "****" + str.slice(-2)
    }

    case "email": {
      const str = String(value)
      const atIdx = str.indexOf("@")
      if (atIdx <= 0) return "****@****"
      return str[0] + "****" + str.slice(atIdx)
    }

    case "hash":
      return `[HASH:${String(value).length}]`

    case "null":
      return null

    case "custom":
      return customMask ? customMask(value) : value

    default:
      return value
  }
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "")
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class GovernanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GovernanceError"
  }
}
