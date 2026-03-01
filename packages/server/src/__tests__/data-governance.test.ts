import { describe, it, expect } from "vitest"
import {
  defineDataGovernance,
  applyGovernanceMasking,
  generateRetentionSQL,
  generateValidationSQL,
  generateAuditTriggerSQL,
  validateGovernance,
  generateAllGovernanceSQL,
  GovernanceError as _GovernanceError,
} from "../authz/data-governance.js"

describe("Data Governance Policies", () => {
  describe("defineDataGovernance", () => {
    it("creates governance config", () => {
      const config = defineDataGovernance({
        users: {
          classification: "confidential",
          fields: {
            email: { classification: "pii", mask: "email" },
          },
        },
      })
      expect(config.tables).toEqual(["users"])
    })

    it("rejects empty schema", () => {
      expect(() => defineDataGovernance({})).toThrow("At least one table")
    })

    it("validates retention days", () => {
      expect(() =>
        defineDataGovernance({
          users: { retention: { days: 0, action: "delete" } },
        }),
      ).toThrow("must be positive")
    })

    it("validates anonymize requires columns", () => {
      expect(() =>
        defineDataGovernance({
          users: { retention: { days: 30, action: "anonymize" } },
        }),
      ).toThrow("anonymizeColumns")
    })
  })

  describe("applyGovernanceMasking", () => {
    const config = defineDataGovernance({
      users: {
        fields: {
          email: { classification: "pii", mask: "email", unmaskRoles: ["admin"] },
          ssn: { classification: "restricted", mask: "full" },
          name: { classification: "internal", mask: "partial" },
          phone: { classification: "pii", mask: "hash" },
          notes: { classification: "internal", mask: "null" },
        },
      },
    })

    it("masks email fields", () => {
      const { row, maskedFields } = applyGovernanceMasking(
        config,
        "users",
        { email: "john@example.com", ssn: "123-45-6789" },
        [],
      )
      expect(row.email).toBe("j****@example.com")
      expect(row.ssn).toBe("████████")
      expect(maskedFields).toContain("email")
      expect(maskedFields).toContain("ssn")
    })

    it("unmasks for authorized roles", () => {
      const { row, maskedFields } = applyGovernanceMasking(config, "users", { email: "john@example.com" }, ["admin"])
      expect(row.email).toBe("john@example.com")
      expect(maskedFields).not.toContain("email")
    })

    it("applies partial masking", () => {
      const { row } = applyGovernanceMasking(config, "users", { name: "John Doe" }, [])
      expect(row.name).toBe("Jo****oe")
    })

    it("applies hash masking", () => {
      const { row } = applyGovernanceMasking(config, "users", { phone: "555-1234" }, [])
      expect(row.phone).toMatch(/\[HASH:\d+\]/)
    })

    it("applies null masking", () => {
      const { row } = applyGovernanceMasking(config, "users", { notes: "secret" }, [])
      expect(row.notes).toBeNull()
    })

    it("returns unchanged for unknown table", () => {
      const { row, maskedFields } = applyGovernanceMasking(config, "unknown", { email: "test" }, [])
      expect(row.email).toBe("test")
      expect(maskedFields).toHaveLength(0)
    })
  })

  describe("generateRetentionSQL", () => {
    it("generates delete retention SQL", () => {
      const config = defineDataGovernance({
        logs: { retention: { days: 90, action: "delete" } },
      })
      const sql = generateRetentionSQL(config, "logs")
      expect(sql).toHaveLength(1)
      expect(sql[0]).toContain("DELETE FROM")
      expect(sql[0]).toContain("90 days")
    })

    it("generates anonymize retention SQL", () => {
      const config = defineDataGovernance({
        users: {
          retention: { days: 365, action: "anonymize", anonymizeColumns: ["email", "name"] },
        },
      })
      const sql = generateRetentionSQL(config, "users")
      expect(sql).toHaveLength(1)
      expect(sql[0]).toContain("UPDATE")
      expect(sql[0]).toContain("NULL")
    })

    it("generates archive retention SQL", () => {
      const config = defineDataGovernance({
        events: {
          retention: { days: 180, action: "archive", archiveTable: "events_archive" },
        },
      })
      const sql = generateRetentionSQL(config, "events")
      expect(sql).toHaveLength(2)
      expect(sql[0]).toContain("INSERT INTO")
      expect(sql[1]).toContain("DELETE FROM")
    })

    it("returns empty for no retention", () => {
      const config = defineDataGovernance({ users: {} })
      expect(generateRetentionSQL(config, "users")).toHaveLength(0)
    })
  })

  describe("generateValidationSQL", () => {
    it("generates not_empty constraint", () => {
      const config = defineDataGovernance({
        users: {
          validations: [{ name: "email_required", column: "email", type: "not_empty", message: "Email required" }],
        },
      })
      const sql = generateValidationSQL(config, "users")
      expect(sql).toHaveLength(1)
      expect(sql[0]).toContain("CHECK")
      expect(sql[0]).toContain("IS NOT NULL")
    })

    it("generates regex constraint", () => {
      const config = defineDataGovernance({
        users: {
          validations: [
            {
              name: "email_format",
              column: "email",
              type: "regex",
              params: { pattern: "^.+@.+$" },
              message: "Invalid",
            },
          ],
        },
      })
      const sql = generateValidationSQL(config, "users")
      expect(sql[0]).toContain("~")
    })

    it("generates enum constraint", () => {
      const config = defineDataGovernance({
        tasks: {
          validations: [
            {
              name: "valid_status",
              column: "status",
              type: "enum",
              params: { values: ["open", "closed"] },
              message: "Invalid status",
            },
          ],
        },
      })
      const sql = generateValidationSQL(config, "tasks")
      expect(sql[0]).toContain("IN")
      expect(sql[0]).toContain("'open'")
    })

    it("generates range constraint", () => {
      const config = defineDataGovernance({
        products: {
          validations: [
            { name: "valid_price", column: "price", type: "range", params: { min: 0, max: 99999 }, message: "Invalid" },
          ],
        },
      })
      const sql = generateValidationSQL(config, "products")
      expect(sql[0]).toContain(">= 0")
    })
  })

  describe("generateAuditTriggerSQL", () => {
    it("generates audit trigger", () => {
      const config = defineDataGovernance({
        users: { audit: { read: true, write: true, includeData: true } },
      })
      const sql = generateAuditTriggerSQL(config, "users")
      expect(sql.length).toBeGreaterThan(0)
      expect(sql[0]).toContain("_reactivebase_audit_log")
      expect(sql[1]).toContain("CREATE TRIGGER")
    })

    it("returns empty for no audit", () => {
      const config = defineDataGovernance({ users: {} })
      expect(generateAuditTriggerSQL(config, "users")).toHaveLength(0)
    })
  })

  describe("validateGovernance", () => {
    it("warns about restricted fields without masking", () => {
      const config = defineDataGovernance({
        users: {
          fields: { ssn: { classification: "restricted" } },
        },
      })
      const violations = validateGovernance(config)
      expect(violations.some((v) => v.rule === "restricted-no-mask")).toBe(true)
    })

    it("warns about confidential tables without audit", () => {
      const config = defineDataGovernance({
        secrets: { classification: "confidential" },
      })
      const violations = validateGovernance(config)
      expect(violations.some((v) => v.rule === "confidential-no-audit")).toBe(true)
    })

    it("warns about PII without retention", () => {
      const config = defineDataGovernance({
        users: {
          fields: { email: { classification: "pii", mask: "email" } },
        },
      })
      const violations = validateGovernance(config)
      expect(violations.some((v) => v.rule === "pii-no-retention")).toBe(true)
    })
  })

  describe("generateAllGovernanceSQL", () => {
    it("generates combined SQL", () => {
      const config = defineDataGovernance({
        users: {
          retention: { days: 365, action: "delete" },
          audit: { write: true },
          validations: [{ name: "email_required", column: "email", type: "not_empty", message: "Required" }],
        },
      })
      const sql = generateAllGovernanceSQL(config)
      expect(sql).toContain("Governance: users")
      expect(sql).toContain("DELETE FROM")
      expect(sql).toContain("CREATE TRIGGER")
      expect(sql).toContain("CHECK")
    })
  })
})
