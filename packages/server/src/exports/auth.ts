// Auth
export {
  createAuthContext,
  jwtProvider,
  customProvider,
  tokenProvider,
  defineRlsPolicy,
  AuthenticationError,
  AuthorizationError,
} from "../auth/index.js"
export type { AuthContext, AuthProvider, JwtProviderOptions, RlsPolicy } from "../auth/index.js"

// Zero-Config Auth Providers
export {
  googleAuth,
  githubAuth,
  magicLinkAuth,
  anonymousAuth,
  multiProvider,
  autoDetectProviders,
  zeroConfigAuth,
  generateMagicLinkToken,
} from "../auth/index.js"

// Permissions
export { roles, allow, enforceAccess } from "../permissions/index.js"
export type { AccessRule, RoleRule, CustomRule } from "../permissions/index.js"

// Declarative Authorization (Zanzibar-style)
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
} from "../authz/index.js"
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
} from "../authz/index.js"

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
} from "../authz/index.js"

// Declarative Access Control Language (DACL)
export { DaclEngine, PolicyBuilder, allow as daclAllow, deny as daclDeny } from "../dacl/index.js"
export type {
  Action as DaclAction,
  PolicyDefinition,
  PolicyCondition,
  PolicyCheckContext,
  PolicyCheckResult,
  PolicyTestCase,
  PolicyTestResult,
  PolicyAuditEntry,
  RlsPolicy as DaclRlsPolicy,
  DaclEngineOptions,
  PolicyCoverageItem,
  PolicyCoverageReport,
} from "../dacl/index.js"

// DACL Parser, Compiler & Simulator
export {
  DaclParseError,
  parseDacl,
  compileToPolicies,
  compileToRlsPolicies,
  compileToRlsSQL,
  compileDacl,
  simulateDacl,
  daclParse,
  daclCompile,
  daclSimulate,
} from "../dacl/index.js"
export type {
  DaclPolicyAST,
  DaclStatement,
  DaclCondition,
  DaclRoleCondition,
  DaclFieldCondition,
  DaclAndCondition,
  DaclOrCondition,
  DaclFieldPath,
  DaclLiteral,
  DaclCompileResult,
  DaclSimulationStep,
  DaclSimulationResult,
  DaclParseCliResult,
  DaclCompileCliResult,
  DaclSimulateCliResult,
} from "../dacl/index.js"

// Declarative Authorization (Zanzibar)
export {
  ZanzibarEngine,
  ZanzibarError,
  buildCreateZanzibarTablesSQL,
  buildWriteTupleSQL,
  buildDeleteTupleSQL,
  buildReadTuplesSQL,
  buildListObjectsSQL as buildZanzibarListObjectsSQL,
  buildReverseExpandSQL,
  buildLogChangeSQL,
} from "../zanzibar/index.js"
export type {
  RelationTuple,
  NamespaceConfig,
  RelationRule,
  RelationRef,
  CheckRequest,
  CheckResult,
  ResolutionStep,
  ExpandResult,
  UsersetTree,
  ListObjectsRequest,
  ZanzibarOptions,
  ZanzibarStats,
} from "../zanzibar/index.js"

// Reactive Permissions Debugger
export {
  PermissionsDebugger,
  TraceRingBuffer,
  AuthDebugDashboard,
  AuthDebugError,
  createPermissionsDebugger,
  createAuthDebugDashboard,
} from "../auth-debugger/index.js"
export type {
  DebugTraceEntry,
  PermissionsDebugResult,
  AuthDebugOptions,
  RlsPolicyInfo,
  ZanzibarTupleInfo,
  AuthDebugDashboardData,
} from "../auth-debugger/index.js"
