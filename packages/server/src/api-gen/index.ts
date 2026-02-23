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
