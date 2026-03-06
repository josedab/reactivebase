export { GraphQLSubscriptionGateway, GraphQLGatewayError } from "./graphql-gateway.js"

export type {
  GraphQLGatewayOptions,
  GraphQLRequest,
  GraphQLResponse,
  GraphQLError,
  GraphQLSubscriptionEvent,
  SubscriptionTransportMessage,
  GraphQLFieldDefinition,
  GraphQLTypeDefinition,
  GeneratedGraphQLSchema,
  SubscriptionMapping,
  SubscriptionHandle,
} from "./graphql-gateway.js"

// Schema-to-GraphQL Compiler (v2)
export { SchemaCompiler, SchemaCompilerError } from "./schema-compiler.js"
export type {
  SchemaCompilerOptions,
  SchemaInput,
  CustomScalarDefinition,
  CompiledSchema,
  CompiledType,
  CompiledField,
  ReactivityMapping,
  CompilationMetadata,
} from "./schema-compiler.js"

// Subscription Engine Bridge (v2)
export { SubscriptionBridge, SubscriptionBridgeError } from "./subscription-bridge.js"
export type {
  SubscriptionBridgeOptions,
  SubscriptionEntry,
  ChangeEvent,
  SubscriptionEvent,
  SubscriptionEventCallback,
  ConnectionState,
  BridgeStats,
} from "./subscription-bridge.js"

// Client Integrations (v2)
export { ClientIntegrations } from "./client-integrations.js"
export type {
  ClientConfigOptions,
  GeneratedClientConfig,
  SubscriptionDocumentOptions,
  GeneratedDocument,
} from "./client-integrations.js"
