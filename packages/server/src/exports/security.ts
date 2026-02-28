// E2E Encryption
export {
  EncryptionEngine,
  EncryptionError,
  localKeyProvider,
  rotatingKeyProvider,
  kmsKeyProvider,
  generateEncryptionTableSQL,
  buildInsertAuditSQL,
} from "../encryption/index.js"
export {
  ComplianceToolkit,
  generateAccessLogTableSQL,
  generateErasureRequestTableSQL,
  buildRetentionPruneSQL,
} from "../encryption/index.js"
export type {
  EncryptionEngineOptions,
  EncryptionMode,
  KeyProvider,
  EncryptedValue,
  FieldEncryptionConfig,
  EncryptionStats,
} from "../encryption/index.js"
export type {
  PiiDetection,
  PiiType,
  AccessLogEntry,
  RetentionPolicy,
  ErasureRequest,
  ComplianceReport,
  ComplianceSection,
  ComplianceToolkitOptions,
} from "../encryption/index.js"

// Vault & GCP KMS Key Providers
export { vaultKeyProvider, gcpKmsKeyProvider, VaultError } from "../encryption/index.js"
export type {
  VaultKeyProviderOptions,
  VaultKeyInfo,
  VaultKeyProvider,
  GcpKmsKeyProviderOptions,
} from "../encryption/index.js"

// MLS Protocol — E2E Encryption for Collaboration
export {
  MlsKeyManager,
  EncryptedCrdtBridge,
  KeyEscrow,
  MlsError,
  generateMlsGroupTableSQL,
  generateMlsKeyHistoryTableSQL,
  generateMlsAuditTableSQL,
  buildInsertMlsAuditSQL,
} from "../encryption/index.js"
export type {
  MlsGroup,
  MlsGroupMember,
  DeviceInfo,
  KeySchedule,
  EncryptedOperation,
  EscrowConfig,
  AccessGrant,
  KeyAuditEntry,
} from "../encryption/index.js"
