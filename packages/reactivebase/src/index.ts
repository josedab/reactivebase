// Main reactivebase package - re-exports from @reactivebase/server for convenience
export {
  defineSchema,
  defineTable,
  v,
  query,
  mutation,
  action,
  defineConfig,
  createReactiveBaseServer,
} from "@reactivebase/server"

export type {
  Schema,
  SchemaDefinition,
  TableDefinition,
  Validator,
  FunctionContext,
  RegisteredFunction,
  ReactiveBaseConfig,
  ReactiveBaseServer,
  AuthContext,
} from "@reactivebase/server"

export { ReactiveBaseClient } from "@reactivebase/client"
export type { ReactiveBaseClientOptions } from "@reactivebase/client"
