export { detectExtensions, ExtensionProvisioner } from "./pg-extensions.js"
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
} from "./pg-extensions.js"

// Extension-Aware Schema Types & Query Builder
export {
  v,
  generateExtensionColumnDDL,
  ExtensionQueryBuilder,
  extQuery,
  ExtensionTypeError,
} from "./extension-types.js"
export type {
  ExtensionValidator,
  GeometryConfig,
  VectorConfig,
  TimeseriesConfig,
  ExtensionDDL,
  ExtensionQueryResult,
} from "./extension-types.js"
