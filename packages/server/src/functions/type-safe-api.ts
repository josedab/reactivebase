/**
 * End-to-End Type Safety — Zero-Codegen Type Inference.
 *
 * Provides TypeScript mapped types that flow types from `defineSchema()`
 * through server functions to client hooks without a code generation step.
 *
 * Usage:
 *   const schema = defineSchema({ tasks: defineTable({ title: v.string() }) })
 *
 *   // Server-side: typed function definitions
 *   const functions = defineServerFunctions(schema, {
 *     listTasks: query(async (ctx) => ctx.db.tasks.where({})),
 *     createTask: mutation(async (ctx, args: { title: string }) => ctx.db.tasks.insert(args)),
 *   })
 *
 *   // Client-side: auto-inferred argument and return types
 *   type API = InferAPI<typeof functions>
 *   // API.listTasks → { args: void; result: InferRow<tasks>[] }
 *   // API.createTask → { args: { title: string }; result: InferRow<tasks> }
 */

import type { Schema, SchemaDefinition, InferSchemaTypes } from "../schema/index.js"
import type { RegisteredFunction, FunctionContext } from "./server-functions.js"

// ─── Core Type Inference ─────────────────────────────────────────────────────

/**
 * Extract the argument type from a handler function.
 */
type ExtractArgs<T> = T extends (ctx: FunctionContext, args: infer A) => Promise<unknown>
  ? unknown extends A
    ? void
    : A
  : void

/**
 * Extract the return type from a handler function.
 */
type ExtractReturn<T> = T extends (ctx: FunctionContext, args: unknown) => Promise<infer R>
  ? R
  : T extends (ctx: FunctionContext) => Promise<infer R>
    ? R
    : unknown

/**
 * A typed function reference that carries argument and return type info.
 */
export interface TypedFunctionRef<TArgs = unknown, TReturn = unknown> {
  readonly _name: string
  readonly _type: "query" | "mutation" | "action"
  readonly _args: TArgs
  readonly _return: TReturn
}

/**
 * Infer the client API types from a server function map.
 * Produces a record of { functionName: { args: TArgs; result: TReturn } }.
 */
export type InferAPI<T extends Record<string, RegisteredFunction>> = {
  [K in keyof T]: T[K] extends RegisteredFunction
    ? {
        args: ExtractArgs<T[K]["handler"]>
        result: ExtractReturn<T[K]["handler"]>
        type: T[K]["type"]
      }
    : never
}

/**
 * Infer typed function references from a function definition map.
 * Each key becomes a TypedFunctionRef with the correct arg/return types.
 */
export type InferFunctionRefs<T extends Record<string, RegisteredFunction>> = {
  [K in keyof T]: TypedFunctionRef<ExtractArgs<T[K]["handler"]>, ExtractReturn<T[K]["handler"]>>
}

/**
 * Schema-aware database type that maps table names to their row types.
 * Used to type `ctx.db` in server functions.
 */
export type TypedDatabase<T extends SchemaDefinition> = {
  [K in keyof T & string]: import("./database-context.js").TableAccessor<InferSchemaTypes<T>[K]>
} & import("./database-context.js").TrackedDatabaseContext

// ─── Typed Function Definitions ──────────────────────────────────────────────

export interface TypedQueryHandler<TSchema extends SchemaDefinition, TArgs, TReturn> {
  (ctx: FunctionContext & { db: TypedDatabase<TSchema> }, args: TArgs): Promise<TReturn>
}

export interface TypedMutationHandler<TSchema extends SchemaDefinition, TArgs, TReturn> {
  (ctx: FunctionContext & { db: TypedDatabase<TSchema> }, args: TArgs): Promise<TReturn>
}

export interface TypedActionHandler<TSchema extends SchemaDefinition, TArgs, TReturn> {
  (ctx: FunctionContext & { db: TypedDatabase<TSchema> }, args: TArgs): Promise<TReturn>
}

/**
 * Define typed server functions bound to a schema.
 * Returns both the registered functions and typed function references for client use.
 *
 * @param schema - The application schema
 * @param definitions - Record of named function definitions
 * @returns Object with `functions` map and typed `api` references
 */
export function defineServerFunctions<
  TSchema extends SchemaDefinition,
  TFns extends Record<string, RegisteredFunction>,
>(
  _schema: Schema<TSchema>,
  definitions: TFns,
): {
  functions: Map<string, RegisteredFunction>
  api: InferFunctionRefs<TFns>
} {
  const functions = new Map<string, RegisteredFunction>()
  const api = {} as Record<string, TypedFunctionRef>

  for (const [name, fn] of Object.entries(definitions)) {
    const registered: RegisteredFunction = { ...fn, name }
    functions.set(name, registered)

    api[name] = {
      _name: name,
      _type: fn.type,
      _args: undefined as unknown,
      _return: undefined as unknown,
    }
  }

  return { functions, api: api as InferFunctionRefs<TFns> }
}

// ─── Client-Side Type Helpers ────────────────────────────────────────────────

/**
 * Helper type for useQuery hook — extracts the result type from a function ref.
 */
export type QueryResult<T extends TypedFunctionRef> = T["_return"]

/**
 * Helper type for useMutation hook — extracts the args type from a function ref.
 */
export type MutationArgs<T extends TypedFunctionRef> = T["_args"]

/**
 * Type for a fully typed client API proxy.
 * Client code uses: `api.tasks.listTasks(args)` with full type inference.
 */
export type TypedClientAPI<T extends Record<string, RegisteredFunction>> = {
  [K in keyof T]: T[K]["type"] extends "query"
    ? {
        (args: ExtractArgs<T[K]["handler"]>): Promise<ExtractReturn<T[K]["handler"]>>
        useQuery: (args: ExtractArgs<T[K]["handler"]>) => {
          data: ExtractReturn<T[K]["handler"]> | undefined
          isLoading: boolean
          error: Error | null
        }
      }
    : T[K]["type"] extends "mutation"
      ? {
          (args: ExtractArgs<T[K]["handler"]>): Promise<ExtractReturn<T[K]["handler"]>>
          useMutation: () => {
            mutate: (args: ExtractArgs<T[K]["handler"]>) => Promise<ExtractReturn<T[K]["handler"]>>
            isLoading: boolean
            error: Error | null
          }
        }
      : (args: ExtractArgs<T[K]["handler"]>) => Promise<ExtractReturn<T[K]["handler"]>>
}

// ─── Schema-to-Function Type Bridge ──────────────────────────────────────────

/**
 * Create a type-safe query builder factory for a schema table.
 * Ensures the QueryBuilder is typed to the correct row type.
 */
export type TypedQueryBuilderFactory<TSchema extends SchemaDefinition> = <TTable extends keyof TSchema & string>(
  table: TTable,
) => import("../query-builder/index.js").QueryBuilder<InferSchemaTypes<TSchema>[TTable]>

/**
 * Namespace-style API type that groups functions by table.
 * Enables `api.tasks.listTasks()` patterns.
 */
export type NamespacedAPI<TSchema extends SchemaDefinition, TFns extends Record<string, RegisteredFunction>> = {
  [Table in keyof TSchema & string]: {
    [K in keyof TFns as K extends `${Table}${string}` ? K : never]: TFns[K]["type"] extends "query"
      ? (args: ExtractArgs<TFns[K]["handler"]>) => Promise<ExtractReturn<TFns[K]["handler"]>>
      : (args: ExtractArgs<TFns[K]["handler"]>) => Promise<ExtractReturn<TFns[K]["handler"]>>
  }
}
