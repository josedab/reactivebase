export { createDatabaseContext } from "./database-context.js"
export type { DatabaseContext, TrackedDatabaseContext, TableAccessor } from "./database-context.js"
export {
  query,
  mutation,
  action,
  executeQueryFunction,
  executeMutationFunction,
  executeActionFunction,
} from "./server-functions.js"
export type {
  FunctionContext,
  SchedulerContext,
  LogContext,
  QueryOptions,
  MutationOptions,
  ActionOptions,
  RegisteredFunction,
  QueryExecutionResult,
  MutationExecutionResult,
  ScheduledAction,
} from "./server-functions.js"

// End-to-End Type Safety
export { defineServerFunctions } from "./type-safe-api.js"
export type {
  TypedFunctionRef,
  InferAPI,
  InferFunctionRefs,
  TypedDatabase,
  TypedClientAPI,
  TypedQueryBuilderFactory,
  NamespacedAPI,
  QueryResult,
  MutationArgs,
} from "./type-safe-api.js"
