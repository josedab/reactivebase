/**
 * Middleware system for ReactiveBase.
 * Provides before/after hooks for queries, mutations, and actions.
 */

import type { FunctionContext, RegisteredFunction } from "../functions/index.js"
import type { AuthContext } from "../auth/index.js"

export interface MiddlewareContext {
  functionName: string
  functionType: "query" | "mutation" | "action"
  args: unknown
  auth: AuthContext
  /** Arbitrary data passed between middleware layers */
  state: Map<string, unknown>
}

export interface MiddlewareResult {
  /** Replace args before execution */
  args?: unknown
  /** Short-circuit and return this result without executing the function */
  result?: unknown
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
   */
  use(middleware: Middleware): void {
    this.middlewares.push(middleware)
  }

  /**
   * Run before hooks. Returns modified args or a short-circuit result.
   */
  async runBefore(ctx: MiddlewareContext): Promise<{ args: unknown; shortCircuit?: unknown }> {
    let { args } = ctx

    for (const mw of this.middlewares) {
      if (!mw.before) continue
      const result = await mw.before({ ...ctx, args })
      if (result) {
        if (result.result !== undefined) {
          return { args, shortCircuit: result.result }
        }
        if (result.args !== undefined) {
          args = result.args
        }
      }
    }

    return { args }
  }

  /**
   * Run after hooks, allowing result transformation.
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
