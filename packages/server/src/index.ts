// Schema
export { defineSchema, defineTable, v } from "./schema/index.js"
export type {
  Schema,
  SchemaDefinition,
  InferSchemaTypes,
  TableDefinition,
  ColumnDefinitions,
  InferRow,
  Validator,
  ValidatorType,
  ValidatorOptions,
  IndexDefinition,
  RelationDefinition,
  Migration,
} from "./schema/index.js"
export { generateMigrationSQL } from "./schema/index.js"

// Functions
export { query, mutation, action } from "./functions/index.js"
export type {
  FunctionContext,
  RegisteredFunction,
  QueryOptions,
  MutationOptions,
  ActionOptions,
  SchedulerContext,
  LogContext,
} from "./functions/index.js"

// Auth
export {
  createAuthContext,
  jwtProvider,
  customProvider,
  AuthenticationError,
  AuthorizationError,
} from "./auth/index.js"
export type { AuthContext, AuthProvider, JwtProviderOptions } from "./auth/index.js"

// Config
export { defineConfig } from "./config/index.js"
export type { ReactiveBaseConfig } from "./config/index.js"

// Server
export { createReactiveBaseServer } from "./server.js"
export type { ReactiveBaseServer } from "./server.js"

// Transport (for advanced usage)
export { TransportServer } from "./transport/index.js"
export type { ClientMessage, ServerMessage } from "./transport/index.js"

// Reactivity (for advanced usage)
export { ReactivityEngine } from "./reactivity/index.js"
export type { SubscriptionUpdate } from "./reactivity/index.js"

// Query Builder (for advanced usage)
export { QueryBuilder } from "./query-builder/index.js"
export type { BuiltQuery, QueryDependency } from "./query-builder/index.js"
