export { generateRestRoutes, matchRoute, parseQueryFilters, generateGraphQLSchema } from "./api-gen.js"
export type { RestApiOptions, RestRoute } from "./api-gen.js"

// API Gateway
export {
  ApiGateway,
  generateApiKeyTableSQL,
  buildInsertApiKeySQL,
  buildValidateApiKeySQL,
  buildRevokeApiKeySQL,
  buildIncrementRequestCountSQL,
} from "./api-gateway.js"
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
} from "./api-gateway.js"

// OpenAPI 3.1 Generator
export { OpenApiGenerator } from "./openapi-generator.js"
export type {
  OpenApi31Spec,
  OpenApi31PathItem,
  OpenApi31Operation,
  OpenApi31Schema,
  FunctionDescriptor,
  ArgSchema,
  ReturnSchema,
  OpenApiGeneratorOptions,
} from "./openapi-generator.js"

// GraphQL Schema Generator
export { GraphQLSchemaGenerator } from "./graphql-schema-generator.js"
export type {
  GeneratedGraphQLResult,
  GraphQLSchemaGeneratorOptions,
  IntrospectionResponse,
} from "./graphql-schema-generator.js"

// Unified Gateway
export { UnifiedGateway } from "./unified-gateway.js"
export type {
  GatewayRequest,
  GatewayResponse,
  UnifiedGatewayOptions,
  GatewayRouteInfo,
  GatewayTransportStats,
} from "./unified-gateway.js"
