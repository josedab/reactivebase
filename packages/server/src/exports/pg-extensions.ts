// Postgres Extension Auto-Provisioner
export { detectExtensions, ExtensionProvisioner } from "../pg-extensions/index.js"
export type {
  ExtensionStatus,
  ExtensionRequirement,
  ExtensionInfo,
  DetectionResult,
  DetectedPattern,
  ExtensionProvisioningResult,
  DoctorReport,
  ExtensionCheckResult,
  SchemaInput,
  ProvisionerAdapter,
} from "../pg-extensions/index.js"

// Extension-Aware Schema Types & Query Builder
export {
  v as extV,
  generateExtensionColumnDDL,
  ExtensionQueryBuilder,
  extQuery,
  ExtensionTypeError,
} from "../pg-extensions/index.js"
export type {
  ExtensionValidator,
  GeometryConfig,
  VectorConfig,
  TimeseriesConfig,
  ExtensionDDL,
  ExtensionQueryResult,
} from "../pg-extensions/index.js"
