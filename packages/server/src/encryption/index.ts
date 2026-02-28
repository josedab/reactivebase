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
export {
  ComplianceToolkit,
  generateAccessLogTableSQL,
  generateErasureRequestTableSQL,
  buildRetentionPruneSQL,
} from "./compliance.js"
export type {
  PiiDetection,
  PiiType,
  AccessLogEntry,
  RetentionPolicy,
  ErasureRequest,
  ComplianceReport,
  ComplianceSection,
  ComplianceToolkitOptions,
} from "./compliance.js"

// Vault & GCP KMS Key Providers
export { vaultKeyProvider, gcpKmsKeyProvider, VaultError } from "./vault-provider.js"
export type {
  VaultKeyProviderOptions,
  VaultKeyInfo,
  VaultKeyProvider,
  GcpKmsKeyProviderOptions,
} from "./vault-provider.js"

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
} from "./mls-protocol.js"
export type {
  MlsGroup,
  MlsGroupMember,
  DeviceInfo,
  KeySchedule,
  EncryptedOperation,
  EscrowConfig,
  AccessGrant,
  KeyAuditEntry,
} from "./mls-protocol.js"
