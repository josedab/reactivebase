/**
 * Middleware system for ReactiveBase.
 * Provides before/after hooks for queries, mutations, and actions.
 *
 * State is immutable: each middleware receives a snapshot, and state
 * changes are propagated via MiddlewareResult.state to prevent
 * order-dependent mutation bugs.
 */

import type { AuthContext } from "../auth/index.js"

/** Immutable middleware state — use `mergeState()` to produce new state. */
export type MiddlewareState = Readonly<Record<string, unknown>>

export interface MiddlewareContext {
  functionName: string
  functionType: "query" | "mutation" | "action"
  args: unknown
  auth: AuthContext
  /** Immutable state passed between middleware layers. Use `mergeState()` to update. */
  readonly state: MiddlewareState
}

export interface MiddlewareResult {
  /** Replace args before execution */
  args?: unknown
  /** Short-circuit and return this result without executing the function */
  result?: unknown
  /** State entries to merge into the context for downstream middleware */
  state?: MiddlewareState
}

/**
 * Create a new state with additional entries merged in.
 *
 * @param current - The current immutable middleware state
 * @param updates - Key-value pairs to merge into the state
 * @returns A new frozen state with updates applied
 */
export function mergeState(current: MiddlewareState, updates: MiddlewareState): MiddlewareState {
  return Object.freeze({ ...current, ...updates })
}

/**
 * Create an initial empty middleware state.
 *
 * @param initial - Optional initial key-value pairs for the state
 * @returns A frozen middleware state
 */
export function createMiddlewareState(initial?: Record<string, unknown>): MiddlewareState {
  return Object.freeze({ ...initial })
}

export type BeforeHook = (ctx: MiddlewareContext) => Promise<MiddlewareResult | void> | MiddlewareResult | void
export type AfterHook = (ctx: MiddlewareContext, result: unknown) => Promise<unknown> | unknown
export type ErrorHook = (ctx: MiddlewareContext, error: Error) => Promise<void> | void

export interface Middleware {
  name: string
  before?: BeforeHook
  after?: AfterHook
  onError?: ErrorHook
}

export class MiddlewareManager {
  private middlewares: Middleware[] = []

  /**
   * Register a middleware.
   *
   * @param middleware - The middleware to register
   */
  use(middleware: Middleware): void {
    this.middlewares.push(middleware)
  }

  /**
   * Run before hooks. Returns modified args or a short-circuit result.
   * State is accumulated immutably — each middleware gets a frozen snapshot.
   *
   * @param ctx - The middleware context for the current request
   * @returns The possibly-modified args, accumulated state, and optional short-circuit result
   */
  async runBefore(ctx: MiddlewareContext): Promise<{ args: unknown; state: MiddlewareState; shortCircuit?: unknown }> {
    let { args } = ctx
    let state = ctx.state

    for (const mw of this.middlewares) {
      if (!mw.before) continue
      const result = await mw.before({ ...ctx, args, state })
      if (result) {
        if (result.state) {
          state = mergeState(state, result.state)
        }
        if (result.result !== undefined) {
          return { args, state, shortCircuit: result.result }
        }
        if (result.args !== undefined) {
          args = result.args
        }
      }
    }

    return { args, state }
  }

  /**
   * Run after hooks, allowing result transformation.
   *
   * @param ctx - The middleware context for the current request
   * @param result - The result from function execution
   * @returns The possibly-transformed result
   */
  async runAfter(ctx: MiddlewareContext, result: unknown): Promise<unknown> {
    let current = result

    for (const mw of this.middlewares) {
      if (!mw.after) continue
      const transformed = await mw.after(ctx, current)
      if (transformed !== undefined) {
        current = transformed
      }
    }

    return current
  }

  /**
   * Run error hooks.
   *
   * @param ctx - The middleware context for the current request
   * @param error - The error that occurred during execution
   */
  async runOnError(ctx: MiddlewareContext, error: Error): Promise<void> {
    for (const mw of this.middlewares) {
      if (!mw.onError) continue
      try {
        await mw.onError(ctx, error)
      } catch {
        // Swallow middleware errors to avoid masking the original
      }
    }
  }

  get count(): number {
    return this.middlewares.length
  }
}
