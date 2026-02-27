---
sidebar_position: 13
---

# Field-Level Encryption

*Estimated time: 10 minutes*

ReactiveBase includes a field-level encryption system built on AES-256-GCM, with pluggable key providers (local, Vault, KMS) and a compliance toolkit for PII detection and GDPR erasure. All encryption utilities are exported from `@reactivebase/server` under the `security` category.

## Overview

| Feature | Description |
|---------|-------------|
| AES-256-GCM | Authenticated encryption with associated data |
| Field-level granularity | Encrypt individual columns, not entire rows |
| Deterministic mode | Enables equality searches on encrypted fields |
| Key rotation | Re-encrypt data with a new key without downtime |
| Vault / KMS providers | HashiCorp Vault, AWS KMS, GCP KMS integration |
| Compliance toolkit | PII detection, access logging, GDPR erasure |

## Enabling Field-Level Encryption

### 1. Create a Key Provider

The key provider manages encryption keys. Start with `localKeyProvider` for development, then switch to Vault or KMS for production.

```typescript
import { EncryptionEngine, localKeyProvider } from "@reactivebase/server"

// Development: local key (32-byte hex string)
const keyProvider = localKeyProvider("a]1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b")

const encryption = new EncryptionEngine(keyProvider)
```

### 2. Configure Encrypted Fields

Define which fields to encrypt and in which mode:

```typescript
// Random IV — maximum security (default)
encryption.configureField({
  fieldName: "ssn",
  mode: "random",
})

// Deterministic IV — allows equality searches
encryption.configureField({
  fieldName: "email",
  mode: "deterministic",
})
```

### 3. Encrypt and Decrypt

```typescript
// Encrypt a single field
const encrypted = await encryption.encryptField("ssn", "123-45-6789")
// => { ciphertext, iv, authTag, keyId, mode, version }

// Decrypt
const ssn = await encryption.decryptField("ssn", encrypted)
// => "123-45-6789"

// Encrypt/decrypt entire rows
const encryptedRow = await encryption.encryptRow({
  ssn: "123-45-6789",
  email: "user@example.com",
  name: "Alice", // not configured — left as plaintext
})

const decryptedRow = await encryption.decryptRow(encryptedRow)
```

## Key Providers

### Local (Development)

```typescript
import { localKeyProvider } from "@reactivebase/server"

const provider = localKeyProvider("your-32-byte-hex-master-key")
```

Derives per-field keys using HKDF from a single master key. Suitable for development and testing.

### Rotating Keys

```typescript
import { rotatingKeyProvider } from "@reactivebase/server"

const provider = rotatingKeyProvider(
  {
    "key-2025": Buffer.from("..."),
    "key-2026": Buffer.from("..."),
  },
  "key-2026", // current key ID
)
```

New encryptions use the current key. Decryption automatically selects the correct key based on the `keyId` stored with each encrypted value.

### HashiCorp Vault

```typescript
import { vaultKeyProvider } from "@reactivebase/server"

const provider = vaultKeyProvider({
  endpoint: "https://vault.example.com",
  token: process.env.VAULT_TOKEN,
  mountPath: "transit",
  keyName: "reactivebase",
})
```

Uses Vault's Transit secrets engine with HKDF derivation per field.

### AWS KMS

```typescript
import { kmsKeyProvider } from "@reactivebase/server"

const provider = kmsKeyProvider({
  region: "us-east-1",
  keyId: "arn:aws:kms:us-east-1:123456789:key/abc-def",
})
```

### GCP KMS

```typescript
import { gcpKmsKeyProvider } from "@reactivebase/server"

const provider = gcpKmsKeyProvider({
  projectId: "my-project",
  locationId: "us-east1",
  keyRingId: "my-ring",
  keyId: "my-key",
})
```

## Key Rotation

To rotate keys, add the new key to your provider and re-encrypt existing data:

```typescript
// Re-encrypt a single value with the current key
const rotated = await encryption.reEncryptValue(existingEncryptedValue)
```

For bulk rotation, iterate over rows and call `reEncryptValue` for each encrypted field. The `keyId` in each `EncryptedValue` ensures the correct decryption key is used during the transition.

## Searchable Encryption (Deterministic Mode)

Deterministic mode produces the same ciphertext for the same plaintext and key, enabling equality queries (`WHERE email = ?`) on encrypted columns.

**Tradeoffs:**

| | Random (default) | Deterministic |
|---|---|---|
| Security | Highest — identical values produce different ciphertext | Leaks equality patterns |
| Searchable | No — must decrypt to compare | Yes — `WHERE encrypted_email = encrypt("user@example.com")` |
| Use case | PII, secrets, health data | Email lookups, unique identifiers |

```typescript
// Encrypt with deterministic mode for search
encryption.configureField({ fieldName: "email", mode: "deterministic" })

const searchToken = await encryption.encryptField("email", "alice@example.com")
// Use searchToken.ciphertext in WHERE clause
```

## Compliance Toolkit

The `ComplianceToolkit` integrates with the encryption engine for regulatory requirements.

### PII Detection

```typescript
import { ComplianceToolkit } from "@reactivebase/server"

const compliance = new ComplianceToolkit(encryption)

// Scan your schema for PII fields
const piiFields = compliance.detectPII(schema)
// => [{ field: "email", type: "email" }, { field: "ssn", type: "ssn" }, ...]
```

### Access Logging

```typescript
compliance.recordAccess({
  action: "read",
  resource: "users.ssn",
  userId: "admin-1",
  severity: "high",
})
```

### GDPR Erasure

```typescript
// Request erasure
const request = await compliance.requestErasure({
  userId: "user-42",
  reason: "Right to be forgotten",
})

// Execute erasure (deletes or anonymizes PII fields)
await compliance.executeErasure(request.id)
```

### Retention Policies

```typescript
compliance.setRetentionPolicy({
  table: "audit_logs",
  retentionDays: 365,
  action: "delete",
})
```

### Compliance Reports

```typescript
const report = await compliance.generateComplianceReport("gdpr")
// Sections: encryption status, PII inventory, access logs, erasure requests
```

Supported frameworks: `"gdpr"`, `"soc2"`, `"hipaa"`.

## Encryption Statistics

```typescript
const stats = encryption.getStats()
// { encryptionCount, decryptionCount, reEncryptionCount, ... }
```

## Next Steps

→ [Multi-Tenancy](./multi-tenancy.md) — Isolate data per tenant with row-level or schema-level strategies
→ [Observability](./observability.md) — Monitor encryption operations with metrics and tracing
