/**
 * End-to-end type inference utilities for ReactiveBase.
 *
 * Provides generic types that flow from schema definition through
 * to client-side hooks, enabling full autocomplete without manual annotations.
 *
 * Type flow:
 *   defineSchema({ tasks: defineTable({ title: v.string() }) })
 *     → InferSchemaTypes → { tasks: { id: string; title: string } }
 *     → TypedDatabaseContext<Schema> → ctx.db.tasks returns typed rows
 *     → TypedFunctionReference<TArgs, TReturn> → useQuery returns TReturn
 */

import type { SchemaDefinition, ColumnDefinitions, InferRow } from "../schema/index.js"

// --- Typed Function References ---

/**
 * A typed reference to a server function with known argument and return types.
 */
export interface TypedFunctionReference<
  TArgs = unknown,
  TReturn = unknown,
  TType extends "query" | "mutation" | "action" = "query" | "mutation" | "action",
> {
  readonly _name: string
  readonly _type: TType
  readonly _args: TArgs
  readonly _return: TReturn
}

/**
 * Create a typed function reference (used by generated api.ts).
 */
export function typedRef<TArgs, TReturn, TType extends "query" | "mutation" | "action">(
  name: string,
  type: TType,
): TypedFunctionReference<TArgs, TReturn, TType> {
  return { _name: name, _type: type } as TypedFunctionReference<TArgs, TReturn, TType>
}

// --- Typed Query/Mutation/Action Definitions ---

/**
 * Define a query with typed args and return type.
 */
export type TypedQueryHandler<TSchema extends SchemaDefinition, TArgs, TReturn> = (
  ctx: { db: TypedDatabaseContext<TSchema>; auth: import("../auth/index.js").AuthContext },
  args: TArgs,
) => Promise<TReturn>

/**
 * Database context typed to a specific schema.
 * Provides typed table accessors for each table in the schema.
 */
export type TypedDatabaseContext<TSchema extends SchemaDefinition> = {
  [K in keyof TSchema]: TypedTableAccessor<
    TSchema[K] extends { columns: infer C extends ColumnDefinitions } ? InferRow<C> : Record<string, unknown>
  >
} & {
  raw<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>
}

/**
 * Typed table accessor providing CRUD operations with proper return types.
 */
export interface TypedTableAccessor<TRow> {
  where(filters: Partial<TRow>): TypedQueryResult<TRow>
  where(column: string & keyof TRow, value: TRow[string & keyof TRow]): TypedQueryResult<TRow>
  where(column: string, operator: string, value: unknown): TypedQueryResult<TRow>
  get(id: string): Promise<TRow | null>
  getOrThrow(id: string): Promise<TRow>
  insert(data: Omit<Partial<TRow>, "id">): Promise<TRow>
  update(id: string, data: Partial<Omit<TRow, "id">>): Promise<TRow>
  delete(id: string): Promise<void>
  count(): Promise<number>
}

/**
 * A chainable query result that resolves to typed rows.
 */
export interface TypedQueryResult<TRow> extends PromiseLike<TRow[]> {
  orderBy(column: string & keyof TRow, direction?: "asc" | "desc"): TypedQueryResult<TRow>
  limit(n: number): TypedQueryResult<TRow>
  offset(n: number): TypedQueryResult<TRow>
}

// --- Extract Types from Function References ---

/**
 * Extract the argument type from a TypedFunctionReference.
 */
export type InferArgs<T> =
  T extends TypedFunctionReference<infer A, unknown, "query" | "mutation" | "action"> ? A : unknown

/**
 * Extract the return type from a TypedFunctionReference.
 */
export type InferReturn<T> =
  T extends TypedFunctionReference<unknown, infer R, "query" | "mutation" | "action"> ? R : unknown

// --- API Object Type ---

/**
 * A typed API module containing function references.
 */
export type TypedApiModule = Record<string, TypedFunctionReference>

/**
 * A typed API object containing modules of function references.
 */
export type TypedApi = Record<string, TypedApiModule>

// --- Schema Type Helpers ---

/**
 * Extract table names from a schema definition as a union type.
 */
export type TableNames<T extends SchemaDefinition> = keyof T & string

/**
 * Extract the row type for a specific table.
 */
export type TableRow<T extends SchemaDefinition, K extends keyof T> = T[K] extends {
  columns: infer C extends ColumnDefinitions
}
  ? InferRow<C>
  : never

/**
 * Utility: make all properties of InferRow writable for insert/update.
 */
export type Writable<T> = { -readonly [K in keyof T]: T[K] }

/**
 * Utility: deep partial for nested updates.
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}
