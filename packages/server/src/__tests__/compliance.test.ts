/**
 * Tests for ComplianceToolkit — PII detection, access logging,
 * GDPR erasure, retention policies, and compliance report generation.
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
  ComplianceToolkit,
  buildRetentionPruneSQL,
  generateAccessLogTableSQL,
  generateErasureRequestTableSQL,
} from "../encryption/compliance.js"

// ─── PII Detection ───────────────────────────────────────────────────────────

describe("ComplianceToolkit — PII detection", () => {
  let toolkit: ComplianceToolkit

  beforeEach(() => {
    toolkit = new ComplianceToolkit()
  })

  it("detects email columns", () => {
    const detections = toolkit.detectPII([{ table: "users", columns: [{ name: "email", type: "text" }] }])
    expect(detections.length).toBe(1)
    expect(detections[0].piiType).toBe("email")
    expect(detections[0].table).toBe("users")
    expect(detections[0].column).toBe("email")
    expect(detections[0].confidence).toBe("high")
  })

  it("detects phone columns", () => {
    const detections = toolkit.detectPII([{ table: "contacts", columns: [{ name: "phone_number", type: "text" }] }])
    expect(detections.some((d) => d.piiType === "phone")).toBe(true)
  })

  it("detects SSN/tax ID columns", () => {
    const detections = toolkit.detectPII([
      {
        table: "employees",
        columns: [
          { name: "ssn", type: "text" },
          { name: "tax_id", type: "text" },
        ],
      },
    ])
    expect(detections.filter((d) => d.piiType === "ssn").length).toBe(2)
  })

  it("detects name columns with various patterns", () => {
    const detections = toolkit.detectPII([
      {
        table: "users",
        columns: [
          { name: "first_name", type: "text" },
          { name: "last_name", type: "text" },
          { name: "display_name", type: "text" },
        ],
      },
    ])
    expect(detections.filter((d) => d.piiType === "name").length).toBe(3)
  })

  it("detects address columns", () => {
    const detections = toolkit.detectPII([
      {
        table: "addresses",
        columns: [
          { name: "street_address", type: "text" },
          { name: "city", type: "text" },
          { name: "zip_code", type: "text" },
        ],
      },
    ])
    expect(detections.filter((d) => d.piiType === "address").length).toBe(3)
  })

  it("detects IP address columns", () => {
    const detections = toolkit.detectPII([{ table: "logs", columns: [{ name: "ip_address", type: "text" }] }])
    expect(detections.some((d) => d.piiType === "ip")).toBe(true)
  })

  it("detects date-of-birth columns", () => {
    const detections = toolkit.detectPII([{ table: "users", columns: [{ name: "date_of_birth", type: "date" }] }])
    expect(detections.some((d) => d.piiType === "dob")).toBe(true)
  })

  it("detects credit card columns", () => {
    const detections = toolkit.detectPII([
      { table: "payments", columns: [{ name: "credit_card_number", type: "text" }] },
    ])
    expect(detections.some((d) => d.piiType === "credit_card")).toBe(true)
  })

  it("detects passport columns", () => {
    const detections = toolkit.detectPII([{ table: "identity", columns: [{ name: "passport_number", type: "text" }] }])
    expect(detections.some((d) => d.piiType === "passport")).toBe(true)
  })

  it("returns empty for non-PII columns", () => {
    const detections = toolkit.detectPII([
      {
        table: "tasks",
        columns: [
          { name: "title", type: "text" },
          { name: "status", type: "text" },
        ],
      },
    ])
    expect(detections.length).toBe(0)
  })

  it("handles multiple tables", () => {
    const detections = toolkit.detectPII([
      { table: "users", columns: [{ name: "email", type: "text" }] },
      { table: "contacts", columns: [{ name: "phone", type: "text" }] },
    ])
    expect(detections.length).toBe(2)
    expect(detections.map((d) => d.table)).toEqual(["users", "contacts"])
  })

  it("getDetectedPII returns cached detections", () => {
    toolkit.detectPII([{ table: "users", columns: [{ name: "email", type: "text" }] }])
    const cached = toolkit.getDetectedPII()
    expect(cached.length).toBe(1)
    expect(cached[0].piiType).toBe("email")
  })

  it("provides recommendations based on confidence", () => {
    const detections = toolkit.detectPII([{ table: "users", columns: [{ name: "email", type: "text" }] }])
    expect(detections[0].recommendation).toContain("AES-256-GCM")
  })

  it("supports custom PII patterns", () => {
    const custom = new ComplianceToolkit({
      piiPatterns: { custom: [/^employee_id$/i] },
    })
    const detections = custom.detectPII([{ table: "hr", columns: [{ name: "employee_id", type: "text" }] }])
    expect(detections.some((d) => d.piiType === "custom")).toBe(true)
  })
})

// ─── Access Logging ──────────────────────────────────────────────────────────

describe("ComplianceToolkit — access logging", () => {
  let toolkit: ComplianceToolkit

  beforeEach(() => {
    toolkit = new ComplianceToolkit()
  })

  it("records an access log entry", () => {
    const entry = toolkit.recordAccess({
      userId: "user-1",
      action: "read",
      table: "users",
      rowIds: ["row-1"],
    })
    expect(entry.id).toBeTruthy()
    expect(entry.userId).toBe("user-1")
    expect(entry.action).toBe("read")
    expect(entry.timestamp).toBeGreaterThan(0)
  })

  it("retrieves access log for a user", () => {
    toolkit.recordAccess({ userId: "user-1", action: "read", table: "users", rowIds: [] })
    toolkit.recordAccess({ userId: "user-2", action: "write", table: "users", rowIds: [] })

    const logs = toolkit.getAccessLog("user-1")
    expect(logs.length).toBe(1)
    expect(logs[0].userId).toBe("user-1")
  })

  it("retrieves all access logs with limit", () => {
    for (let i = 0; i < 5; i++) {
      toolkit.recordAccess({ userId: `user-${i}`, action: "read", table: "t", rowIds: [] })
    }
    const logs = toolkit.getAccessLog(undefined, 3)
    expect(logs.length).toBe(3)
  })

  it("returns logs in reverse chronological order", () => {
    toolkit.recordAccess({ userId: "u1", action: "read", table: "t", rowIds: [] })
    toolkit.recordAccess({ userId: "u2", action: "write", table: "t", rowIds: [] })
    const logs = toolkit.getAccessLog()
    expect(logs[0].userId).toBe("u2")
  })
})

// ─── GDPR Erasure ────────────────────────────────────────────────────────────

describe("ComplianceToolkit — GDPR erasure", () => {
  let toolkit: ComplianceToolkit

  beforeEach(() => {
    toolkit = new ComplianceToolkit()
  })

  it("creates an erasure request", () => {
    const request = toolkit.requestErasure("user-1")
    expect(request.id).toBeTruthy()
    expect(request.userId).toBe("user-1")
    expect(request.status).toBe("pending")
    expect(request.completedAt).toBeNull()
    expect(request.rowsDeleted).toBe(0)
  })

  it("executes erasure across tables", async () => {
    const request = toolkit.requestErasure("user-1")
    const result = await toolkit.executeErasure(request.id, ["users", "orders"])

    expect(result.status).toBe("completed")
    expect(result.tablesProcessed).toEqual(["users", "orders"])
    expect(result.rowsDeleted).toBe(2)
    expect(result.completedAt).toBeGreaterThan(0)
  })

  it("removes user access logs on erasure", async () => {
    toolkit.recordAccess({ userId: "user-1", action: "read", table: "users", rowIds: [] })
    toolkit.recordAccess({ userId: "user-2", action: "read", table: "users", rowIds: [] })

    const request = toolkit.requestErasure("user-1")
    await toolkit.executeErasure(request.id, ["users"])

    // user-1 logs should be removed
    expect(toolkit.getAccessLog("user-1").length).toBe(0)
    // user-2 logs should remain
    expect(toolkit.getAccessLog("user-2").length).toBe(1)
  })

  it("throws for nonexistent erasure request", async () => {
    await expect(toolkit.executeErasure("nonexistent", [])).rejects.toThrow("not found")
  })

  it("retrieves erasure requests by user", () => {
    toolkit.requestErasure("user-1")
    toolkit.requestErasure("user-2")

    const requests = toolkit.getErasureRequests("user-1")
    expect(requests.length).toBe(1)
    expect(requests[0].userId).toBe("user-1")
  })

  it("retrieves all erasure requests", () => {
    toolkit.requestErasure("user-1")
    toolkit.requestErasure("user-2")

    const requests = toolkit.getErasureRequests()
    expect(requests.length).toBe(2)
  })
})

// ─── Retention Policies ──────────────────────────────────────────────────────

describe("ComplianceToolkit — retention policies", () => {
  let toolkit: ComplianceToolkit

  beforeEach(() => {
    toolkit = new ComplianceToolkit()
  })

  it("sets and retrieves retention policies", () => {
    toolkit.setRetentionPolicy({
      table: "logs",
      retentionDays: 90,
      action: "delete",
      timestampColumn: "created_at",
    })
    const policies = toolkit.getRetentionPolicies()
    expect(policies.length).toBe(1)
    expect(policies[0].table).toBe("logs")
    expect(policies[0].retentionDays).toBe(90)
  })

  it("generates retention SQL for delete policies", () => {
    toolkit.setRetentionPolicy({
      table: "logs",
      retentionDays: 30,
      action: "delete",
      timestampColumn: "created_at",
    })
    const sqls = toolkit.generateRetentionSQL()
    expect(sqls.length).toBe(1)
    expect(sqls[0]).toContain('DELETE FROM "logs"')
    expect(sqls[0]).toContain("30 days")
  })

  it("generates comment for non-delete policies", () => {
    toolkit.setRetentionPolicy({
      table: "logs",
      retentionDays: 30,
      action: "anonymize",
      timestampColumn: "created_at",
    })
    const sqls = toolkit.generateRetentionSQL()
    expect(sqls[0]).toContain("Anonymize/archive")
  })
})

// ─── buildRetentionPruneSQL ──────────────────────────────────────────────────

describe("buildRetentionPruneSQL", () => {
  it("generates correct delete SQL", () => {
    const sql = buildRetentionPruneSQL({
      table: "logs",
      retentionDays: 90,
      action: "delete",
      timestampColumn: "created_at",
    })
    expect(sql).toContain('DELETE FROM "logs"')
    expect(sql).toContain('"created_at"')
    expect(sql).toContain("90 days")
  })

  it("rejects SQL injection in table name", () => {
    expect(() =>
      buildRetentionPruneSQL({
        table: "logs; DROP TABLE users--",
        retentionDays: 90,
        action: "delete",
        timestampColumn: "created_at",
      }),
    ).toThrow("Invalid table name")
  })

  it("rejects SQL injection in column name", () => {
    expect(() =>
      buildRetentionPruneSQL({
        table: "logs",
        retentionDays: 90,
        action: "delete",
        timestampColumn: "created_at; DROP TABLE--",
      }),
    ).toThrow("Invalid timestamp column")
  })
})

// ─── Compliance Reports ──────────────────────────────────────────────────────

describe("ComplianceToolkit — compliance reports", () => {
  let toolkit: ComplianceToolkit

  beforeEach(() => {
    toolkit = new ComplianceToolkit()
  })

  it("generates SOC2 report with no data", () => {
    const report = toolkit.generateComplianceReport("SOC2")
    expect(report.framework).toBe("SOC2")
    expect(report.sections.length).toBeGreaterThanOrEqual(3)
    expect(report.overallStatus).toBe("partially_compliant")
    expect(report.actionItems.length).toBeGreaterThan(0)
  })

  it("generates GDPR report with erasure section", () => {
    const report = toolkit.generateComplianceReport("GDPR")
    expect(report.framework).toBe("GDPR")
    const sectionNames = report.sections.map((s) => s.name)
    expect(sectionNames).toContain("Right to Erasure")
  })

  it("reports compliant when all checks pass", () => {
    toolkit.recordAccess({ userId: "u1", action: "read", table: "t", rowIds: [] })
    toolkit.setRetentionPolicy({ table: "t", retentionDays: 30, action: "delete", timestampColumn: "ts" })

    const report = toolkit.generateComplianceReport("SOC2")
    expect(report.overallStatus).toBe("compliant")
  })

  it("reports partially_compliant when PII is detected", () => {
    toolkit.detectPII([{ table: "users", columns: [{ name: "email", type: "text" }] }])
    toolkit.recordAccess({ userId: "u1", action: "read", table: "t", rowIds: [] })
    toolkit.setRetentionPolicy({ table: "t", retentionDays: 30, action: "delete", timestampColumn: "ts" })

    const report = toolkit.generateComplianceReport("SOC2")
    expect(report.overallStatus).toBe("partially_compliant")
    expect(report.actionItems.some((a) => a.includes("encryption"))).toBe(true)
  })

  it("generates HIPAA report", () => {
    const report = toolkit.generateComplianceReport("HIPAA")
    expect(report.framework).toBe("HIPAA")
  })
})

// ─── SQL Generators ──────────────────────────────────────────────────────────

describe("SQL generators", () => {
  it("generateAccessLogTableSQL creates access log table", () => {
    const sql = generateAccessLogTableSQL()
    expect(sql).toContain("_reactivebase_access_log")
    expect(sql).toContain("user_id")
    expect(sql).toContain("CREATE INDEX")
  })

  it("generateErasureRequestTableSQL creates erasure table", () => {
    const sql = generateErasureRequestTableSQL()
    expect(sql).toContain("_reactivebase_erasure_requests")
    expect(sql).toContain("status")
  })
})
