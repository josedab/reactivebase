/**
 * Server function definitions: query(), mutation(), action().
 * These are the three primitives for defining server-side logic.
 */

import type { Pool, PoolClient } from "pg"
import type { AuthContext } from "../auth/index.js"
import type { TrackedDatabaseContext } from "./database-context.js"
import { createDatabaseContext } from "./database-context.js"
import type { Schema } from "../schema/index.js"
import { executeTransaction, executeReadOnly } from "../transaction/index.js"
import { writeOutboxEvent, type OutboxEvent, type OutboxRecord } from "../transaction/index.js"
import type { QueryDependency } from "../query-builder/index.js"
import { enforceAccess, type AccessRule } from "../permissions/index.js"
import { validateArgs, type ValidationSchema } from "../validation/index.js"

export interface FunctionContext {
  db: TrackedDatabaseContext
  auth: AuthContext
  scheduler: SchedulerContext
  log: LogContext
  /** Emit a domain event to the transactional outbox (mutation context only). */
  emit: (event: OutboxEvent) => Promise<OutboxRecord>
  /**
   * Call another query function from within a query handler.
   * Enables query composition with automatic transitive dependency tracking.
   * Circular dependencies are detected and throw an error.
   */
  query: <TResult = unknown>(queryRef: { _name: string } | string, args?: unknown) => Promise<TResult>
}

export interface SchedulerContext {
  runAfter(delay: string, actionRef: string, args: unknown): Promise<string>
  runAt(date: Date, actionRef: string, args: unknown): Promise<string>
}

export interface LogContext {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, data?: unknown): void
}

export interface QueryOptions {
  reactive?: boolean
  access?: AccessRule
  /** Argument validation schema — auto-validated before handler */
  validate?: ValidationSchema
}

export interface MutationOptions {
  args?: Record<string, unknown>
  auth?: (ctx: FunctionContext) => void
  access?: AccessRule
  validate?: ValidationSchema
}

export interface ActionOptions {
  cron?: string
  timezone?: string
  retries?: number
  timeout?: number
  access?: AccessRule
  validate?: ValidationSchema
}

export interface RegisteredFunction {
  name: string
  type: "query" | "mutation" | "action"
  handler: (ctx: FunctionContext, args: unknown) => Promise<unknown>
  options: QueryOptions | MutationOptions | ActionOptions
}

/**
 * Query execution result with dependency tracking.
 */
export interface QueryExecutionResult<T = unknown> {
  result: T
  dependencies: QueryDependency[]
}

/**
 * Mutation execution result with modified table tracking.
 */
export interface MutationExecutionResult<T = unknown> {
  result: T
  modifiedTables: string[]
  scheduledActions: ScheduledAction[]
}

export interface ScheduledAction {
  delay: string
  actionRef: string
  args: unknown
}

// --- Function definition helpers ---

type QueryHandler<TArgs, TResult> = (ctx: FunctionContext, args: TArgs) => Promise<TResult>

/**
 * Define a reactive query function.
 */
export function query<TArgs, TResult>(
  handler: QueryHandler<TArgs, TResult>,
  options: QueryOptions = {},
): RegisteredFunction {
  return {
    name: "",
    type: "query",
    handler: handler as (ctx: FunctionContext, args: unknown) => Promise<unknown>,
    options: { reactive: true, ...options },
  }
}

/**
 * Define a mutation function (with optional object-style definition).
 */
export function mutation<TArgs, TResult>(
  handlerOrConfig: QueryHandler<TArgs, TResult> | (MutationOptions & { handler: QueryHandler<TArgs, TResult> }),
): RegisteredFunction {
  if (typeof handlerOrConfig === "function") {
    return {
      name: "",
      type: "mutation",
      handler: handlerOrConfig as (ctx: FunctionContext, args: unknown) => Promise<unknown>,
      options: {},
    }
  }

  const { handler, ...options } = handlerOrConfig
  return {
    name: "",
    type: "mutation",
    handler: handler as (ctx: FunctionContext, args: unknown) => Promise<unknown>,
    options,
  }
}

/**
 * Define an action function (background job).
 */
export function action<TArgs, TResult>(
  handler: QueryHandler<TArgs, TResult>,
  options: ActionOptions = {},
): RegisteredFunction {
  return {
    name: "",
    type: "action",
    handler: handler as (ctx: FunctionContext, args: unknown) => Promise<unknown>,
    options,
  }
}

// --- Function execution engine ---

/**
 * Execute a query function with dependency tracking.
 */
export async function executeQueryFunction(
  pool: Pool,
  schema: Schema,
  fn: RegisteredFunction,
  args: unknown,
  auth: AuthContext,
  functionRegistry?: Map<string, RegisteredFunction>,
): Promise<QueryExecutionResult> {
  // Enforce access control
  const opts = fn.options as QueryOptions
  await enforceAccess(opts.access, auth, fn.name)

  // Validate arguments
  if (opts.validate) validateArgs(args, opts.validate)

  return executeReadOnly(pool, async (client: PoolClient) => {
    const db = createDatabaseContext(client, schema, "read")
    const dependencies = db.getDependencies()

    // Build query resolution context for ctx.query() composition
    const queryContext: QueryResolutionContext | undefined = functionRegistry
      ? { registry: functionRegistry, pool, schema, callStack: new Set([fn.name]), parentDependencies: dependencies }
      : undefined

    const ctx = createFunctionContext(db, auth, undefined, undefined, queryContext)

    const result = await fn.handler(ctx, args)

    // If query builder returned, execute it
    const finalResult = await resolveQueryResult(client, result)

    return {
      result: finalResult,
      dependencies,
    }
  })
}

/**
 * Execute a mutation function within a serializable transaction.
 */
export async function executeMutationFunction(
  pool: Pool,
  schema: Schema,
  fn: RegisteredFunction,
  args: unknown,
  auth: AuthContext,
): Promise<MutationExecutionResult> {
  // Enforce access control
  const fnOpts = fn.options as MutationOptions
  await enforceAccess(fnOpts.access, auth, fn.name)

  // Validate arguments
  if (fnOpts.validate) validateArgs(args, fnOpts.validate)

  const scheduledActions: ScheduledAction[] = []

  const txResult = await executeTransaction(pool, async (client: PoolClient) => {
    const db = createDatabaseContext(client, schema, "readwrite")
    const ctx = createFunctionContext(db, auth, scheduledActions, client)

    // Run legacy auth check if defined
    const opts = fn.options as MutationOptions
    if (opts.auth) {
      opts.auth(ctx)
    }

    const result = await fn.handler(ctx, args)
    return { result, modifiedTables: db.getModifiedTables() }
  })

  return {
    result: txResult.result.result,
    modifiedTables: txResult.result.modifiedTables,
    scheduledActions,
  }
}

/**
 * Execute an action function (no transaction wrapping).
 */
export async function executeActionFunction(
  pool: Pool,
  schema: Schema,
  fn: RegisteredFunction,
  args: unknown,
  auth: AuthContext,
): Promise<unknown> {
  // Enforce access control
  const opts = fn.options as ActionOptions
  await enforceAccess(opts.access, auth, fn.name)

  // Validate arguments
  if (opts.validate) validateArgs(args, opts.validate)

  const client = await pool.connect()
  try {
    const db = createDatabaseContext(client, schema, "readwrite")
    const ctx = createFunctionContext(db, auth)
    return await fn.handler(ctx, args)
  } finally {
    client.release()
  }
}

/** Query resolution context for detecting circular dependencies */
interface QueryResolutionContext {
  registry: Map<string, RegisteredFunction>
  pool: Pool
  schema: Schema
  callStack: Set<string>
  /** Accumulates dependencies from composed queries for transitive tracking */
  parentDependencies?: QueryDependency[]
}

function createFunctionContext(
  db: TrackedDatabaseContext,
  auth: AuthContext,
  scheduledActions?: ScheduledAction[],
  txClient?: PoolClient,
  queryContext?: QueryResolutionContext,
): FunctionContext {
  return {
    db,
    auth,
    async emit(event: OutboxEvent): Promise<OutboxRecord> {
      if (!txClient) {
        throw new Error("ctx.emit() is only available inside mutation handlers")
      }
      return writeOutboxEvent(txClient, event)
    },
    async query<TResult = unknown>(queryRef: { _name: string } | string, args?: unknown): Promise<TResult> {
      if (!queryContext) {
        throw new Error("ctx.query() requires a query resolution context")
      }

      const name = typeof queryRef === "string" ? queryRef : queryRef._name
      const fn = queryContext.registry.get(name)
      if (!fn) throw new Error(`Query function not found: "${name}"`)
      if (fn.type !== "query") throw new Error(`"${name}" is not a query function`)

      // Circular dependency detection
      if (queryContext.callStack.has(name)) {
        const cycle = [...queryContext.callStack, name].join(" → ")
        throw new Error(`Circular query dependency detected: ${cycle}`)
      }

      queryContext.callStack.add(name)
      try {
        const result = await executeQueryFunction(queryContext.pool, queryContext.schema, fn, args, auth)

        // Merge composed query dependencies into parent for transitive tracking
        if (queryContext.parentDependencies) {
          for (const dep of result.dependencies) {
            queryContext.parentDependencies.push(dep)
          }
        }

        return result.result as TResult
      } finally {
        queryContext.callStack.delete(name)
      }
    },
    scheduler: {
      async runAfter(delay: string, actionRef: string, args: unknown): Promise<string> {
        const id = generateId()
        if (scheduledActions) {
          scheduledActions.push({ delay, actionRef, args })
        }
        return id
      },
      async runAt(date: Date, actionRef: string, args: unknown): Promise<string> {
        const delay = `${Math.max(0, date.getTime() - Date.now())}ms`
        return this.runAfter(delay, actionRef, args)
      },
    },
    log: {
      debug(message: string, data?: unknown) {
        console.debug(JSON.stringify({ level: "debug", message, data, timestamp: new Date().toISOString() }))
      },
      info(message: string, data?: unknown) {
        console.info(JSON.stringify({ level: "info", message, data, timestamp: new Date().toISOString() }))
      },
      warn(message: string, data?: unknown) {
        console.warn(JSON.stringify({ level: "warn", message, data, timestamp: new Date().toISOString() }))
      },
      error(message: string, data?: unknown) {
        console.error(JSON.stringify({ level: "error", message, data, timestamp: new Date().toISOString() }))
      },
    },
  }
}

/**
 * If result is a QueryBuilder, execute it and return rows.
 */
async function resolveQueryResult(client: PoolClient, result: unknown): Promise<unknown> {
  if (
    result &&
    typeof result === "object" &&
    "build" in result &&
    typeof (result as { build: unknown }).build === "function"
  ) {
    const built = (result as { build: () => { sql: string; params: unknown[] } }).build()
    const queryResult = await client.query(built.sql, built.params)
    return queryResult.rows
  }
  return result
}

function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}
