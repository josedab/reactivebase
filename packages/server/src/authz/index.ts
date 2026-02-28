export {
  AuthzEngine,
  AuthzError,
  definePermissions,
  derived,
  computed,
  generateAuthzTableSQL,
  buildAddRelationSQL,
  buildRemoveRelationSQL,
  buildCheckRelationSQL,
  buildListRelationsSQL,
  buildListUserPermissionsSQL,
  permissionToWhereClause,
} from "./authz.js"
export type {
  PermissionSchema,
  ResourceDefinition,
  PermissionRule,
  DerivedPermission,
  ComputedPermission,
  AuthzCheckContext,
  AuthzRelationTuple,
  AuthzEvaluationResult,
  AuthzEngineOptions,
  PermissionConfig,
} from "./authz.js"

// Declarative Data Access Policies
export { definePolicy, generatePolicyRlsSQL, applyFieldPolicies, simulatePolicy, testPolicies } from "./policy.js"
export type {
  PolicySchema,
  TablePolicy,
  FieldPolicy,
  PolicyFilter,
  PolicyConfig,
  PolicySimulationRequest,
  PolicySimulationResult,
} from "./policy.js"

// Data Governance Policies
export {
  defineDataGovernance,
  applyGovernanceMasking,
  generateRetentionSQL,
  generateValidationSQL,
  generateAuditTriggerSQL,
  validateGovernance,
  generateAllGovernanceSQL,
  GovernanceError,
} from "./data-governance.js"
export type {
  DataClassification,
  MaskingStrategy,
  RetentionAction,
  DataGovernanceSchema,
  TableGovernancePolicy,
  FieldGovernancePolicy,
  RetentionPolicy,
  AuditPolicy,
  ValidationRule,
  ResidencyPolicy,
  GovernanceConfig,
  GovernanceViolation,
} from "./data-governance.js"
