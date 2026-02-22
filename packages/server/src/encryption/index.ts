export {
  EncryptionEngine,
  EncryptionError,
  localKeyProvider,
  rotatingKeyProvider,
  kmsKeyProvider,
  generateEncryptionTableSQL,
  buildInsertAuditSQL,
} from "./encryption.js"
export type {
  EncryptionEngineOptions,
  EncryptionMode,
  KeyProvider,
  EncryptedValue,
  FieldEncryptionConfig,
  EncryptionStats,
} from "./encryption.js"

// Compliance Toolkit
export { ComplianceToolkit, generateAccessLogTableSQL, generateErasureRequestTableSQL, buildRetentionPruneSQL } from "./compliance.js"
export type { PiiDetection, PiiType, AccessLogEntry, RetentionPolicy, ErasureRequest, ComplianceReport, ComplianceSection, ComplianceToolkitOptions } from "./compliance.js"
