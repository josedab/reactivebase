---
sidebar_position: 6
---

# Compliance Guide

*Estimated time: 10 minutes*

ReactiveBase includes a built-in compliance toolkit for GDPR, SOC 2, and HIPAA readiness.

## PII Detection

Automatically scan your schema for personally identifiable information:

```typescript
import { ComplianceToolkit } from "@reactivebase/server"

const compliance = new ComplianceToolkit()

const pii = compliance.detectPII([
  { table: "users", columns: [
    { name: "id", type: "text" },
    { name: "email", type: "text" },      // ← detected: PII (email)
    { name: "phone", type: "text" },       // ← detected: PII (phone)
    { name: "name", type: "text" },        // ← detected: PII (name)
    { name: "created_at", type: "timestamptz" },
  ]},
])

// Returns: [{ table: "users", column: "email", piiType: "email", confidence: "high", recommendation: "Encrypt..." }]
```

## GDPR Right to Erasure

Handle deletion requests programmatically:

```typescript
// Create erasure request
const request = compliance.requestErasure("user-123")

// Execute across all tables
await compliance.executeErasure(request.id, ["users", "orders", "comments"])
// → Deletes/anonymizes all data for user-123
// → Removes access logs for user-123
```

## Access Logging

Track who accesses what data:

```typescript
compliance.recordAccess({
  userId: "admin-1",
  action: "read",
  table: "users",
  rowIds: ["user-123", "user-456"],
})

// Query audit trail
const logs = compliance.getAccessLog("admin-1")
```

## Data Retention Policies

Automate data lifecycle:

```typescript
compliance.setRetentionPolicy({
  table: "audit_logs",
  retentionDays: 90,
  action: "delete",
  timestampColumn: "created_at",
})

// Generate cleanup SQL
const sql = compliance.generateRetentionSQL()
// → DELETE FROM "audit_logs" WHERE "created_at" < NOW() - INTERVAL '90 days';
```

## Compliance Reports

Generate compliance documentation:

```typescript
const report = compliance.generateComplianceReport("SOC2")
// → { framework: "SOC2", sections: [...], overallStatus: "partially_compliant", actionItems: [...] }
```

## Field-Level Encryption

Encrypt PII fields at rest:

```typescript
import { EncryptionEngine, localKeyProvider } from "@reactivebase/server"

const engine = new EncryptionEngine({ keyProvider: localKeyProvider("master-key-256bit") })
engine.configureField({ table: "users", field: "email", mode: "deterministic" })
engine.configureField({ table: "users", field: "phone", mode: "random" })

const encrypted = engine.encryptField("email", "user@example.com")
const decrypted = engine.decryptField("email", encrypted)
```
