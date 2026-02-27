// Functions
export { query, mutation, action } from "../functions/index.js"
export type {
  FunctionContext,
  RegisteredFunction,
  QueryOptions,
  MutationOptions,
  ActionOptions,
  SchedulerContext,
  LogContext,
} from "../functions/index.js"

// Structured Errors
export {
  ReactiveBaseError,
  ReadOnlyError,
  RecordNotFoundError,
  FunctionNotFoundError,
  NotQueryFunctionError,
  CircularDependencyError,
  EmitOutsideMutationError,
  QueryContextRequiredError,
  InvalidMessageError,
  SchemaValidationError,
} from "../errors.js"
