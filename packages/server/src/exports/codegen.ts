// Code Generation
export { scanFunctions, generateApiModule, generateServerModule, generate } from "../codegen/index.js"
export {
  TypedCodegen,
  extractFunctionTypes,
  parseSchemaSource,
  generateTypedApiModule,
  generateTypedDbContext,
} from "../codegen/index.js"
export { RpcTypeGenerator, schemaToTypeScript, schemaToValidationCode } from "../codegen/index.js"
export type { ScannedFunction, GenerateResult } from "../codegen/index.js"
export type {
  TypedFunctionInfo,
  SchemaField,
  SchemaTable,
  ParsedSchema,
  TypedCodegenOptions,
  TypedGenerateResult,
  WatchEvent,
} from "../codegen/index.js"
export type {
  RpcFunctionDef,
  RpcSchema,
  RpcGenerateOutput,
  RpcClientSdkConfig,
  FileHashEntry,
} from "../codegen/index.js"

// REST/GraphQL API Generation
export { generateRestRoutes, matchRoute, parseQueryFilters, generateGraphQLSchema } from "../api-gen/index.js"
export type { RestApiOptions, RestRoute } from "../api-gen/index.js"
export {
  ApiGateway,
  generateApiKeyTableSQL,
  buildInsertApiKeySQL,
  buildValidateApiKeySQL,
  buildRevokeApiKeySQL,
  buildIncrementRequestCountSQL,
} from "../api-gen/index.js"
export { OpenApiGenerator } from "../api-gen/index.js"
export { GraphQLSchemaGenerator } from "../api-gen/index.js"
export { UnifiedGateway } from "../api-gen/index.js"
export type {
  ApiGatewayOptions,
  ApiKeyRecord,
  ApiPermission,
  ApiKeyValidationResult,
  OpenApiSpec,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiSchema,
  OpenApiSchemaRef,
  OpenApiSecurityScheme,
  GraphQLSubscriptionField,
  GatewayRoute,
  GatewayStats,
} from "../api-gen/index.js"
export type {
  OpenApi31Spec,
  OpenApi31PathItem,
  OpenApi31Operation,
  OpenApi31Schema,
  FunctionDescriptor,
  OpenApiGeneratorOptions,
} from "../api-gen/index.js"
export type {
  GatewayRequest,
  GatewayResponse,
  UnifiedGatewayOptions,
  GatewayRouteInfo,
  GatewayTransportStats,
} from "../api-gen/index.js"

// Type Inference Utilities
export { typedRef } from "../types/index.js"
export type {
  TypedFunctionReference,
  TypedDatabaseContext,
  TypedTableAccessor,
  TypedQueryResult,
  InferArgs,
  InferReturn,
  TypedApi,
  TableNames,
  TableRow,
} from "../types/index.js"

// GraphQL Federation
export { generateFederatedSchema, generateResolverSkeleton, getSubscriptionMappings } from "../api-gen/federation.js"
export type { FederationOptions, FederatedSchema, SubscriptionMapping } from "../api-gen/federation.js"

// Type Bridge (E2E Type Safety)
export { TypeBridge } from "../type-bridge/index.js"
export type {
  TypeManifest,
  FunctionSignature,
  TypeDescriptor,
  PrimitiveType,
  ObjectType,
  TypeProperty,
  ArrayType,
  UnionType,
  LiteralType,
  ReferenceType,
  VoidType,
  TableTypeInfo,
  ColumnTypeInfo as TypeBridgeColumnTypeInfo,
  TypeBridgeOptions,
  TypedFunctionReference as BridgedFunctionReference,
  ExtractArgs,
  ExtractReturn,
  ExtractKind,
  ScannedFunction as BridgeScannedFunction,
  ScannedTable,
  ManifestValidation,
} from "../type-bridge/index.js"

// Cross-Framework Universal SDK
export { UniversalSdk, ProtocolBuilder, UniversalSdkError } from "../universal-sdk/index.js"
export type {
  ProtocolSpec,
  EndpointSpec,
  TypeSpec,
  FieldSpec,
  TypeRef,
  EnumTypeSpec,
  ErrorSpec,
  AuthSpec,
  TargetLanguage,
  CodegenOptions,
  GeneratedFile,
  GenerationResult,
  UniversalSdkOptions,
} from "../universal-sdk/index.js"
