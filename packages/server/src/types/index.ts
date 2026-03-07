export { typedRef } from "./typed-api.js"
export type {
  TypedFunctionReference,
  TypedQueryHandler,
  TypedDatabaseContext,
  TypedTableAccessor,
  TypedQueryResult,
  InferArgs,
  InferReturn,
  TypedApi,
  TypedApiModule,
  TableNames,
  TableRow,
  Writable,
  DeepPartial,
} from "./typed-api.js"

/** Executes a SQL query and returns rows. Used for optional DB persistence across modules. */
export type QueryExecutor = (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
