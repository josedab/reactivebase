/**
 * Reactivity Engine - orchestrates the entire reactive pipeline:
 * 1. Track query dependencies when subscriptions are created
 * 2. Evaluate invalidations when mutations commit
 * 3. Re-execute invalidated queries
 * 4. Diff results and push updates
 */

import type { Pool } from "pg"
import type { Schema } from "../schema/index.js"
import type { RegisteredFunction } from "../functions/index.js"
import { executeQueryFunction } from "../functions/index.js"
import type { AuthContext } from "../auth/index.js"
import { SubscriptionRegistry } from "./subscription-registry.js"
import { InvalidationEvaluator, type ChangeEvent } from "./invalidation-evaluator.js"
import { hashResult, hasResultChanged } from "./result-differ.js"

export interface ReactivityEngineOptions {
  maxConcurrentReExecutions: number
}

const DEFAULT_OPTIONS: ReactivityEngineOptions = {
  maxConcurrentReExecutions: 50,
}

export interface SubscriptionUpdate {
  subscriptionId: string
  connectionId: string
  queryName: string
  result: unknown
  version: number
  diff?: unknown
}

export type UpdateCallback = (update: SubscriptionUpdate) => void

export class ReactivityEngine {
  readonly registry: SubscriptionRegistry
  private evaluator: InvalidationEvaluator
  private functions = new Map<string, RegisteredFunction>()
  private authContexts = new Map<string, AuthContext>()
  private updateCallback: UpdateCallback | null = null
  private options: ReactivityEngineOptions

  constructor(
    private pool: Pool,
    private schema: Schema,
    options: Partial<ReactivityEngineOptions> = {},
  ) {
    this.registry = new SubscriptionRegistry()
    this.evaluator = new InvalidationEvaluator(this.registry)
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Register a server function by name.
   */
  registerFunction(name: string, fn: RegisteredFunction): void {
    fn.name = name
    this.functions.set(name, fn)
  }

  /**
   * Set the callback for delivering subscription updates to clients.
   */
  onUpdate(callback: UpdateCallback): void {
    this.updateCallback = callback
  }

  /**
   * Subscribe a client to a query. Executes the query immediately and returns results.
   */
  async subscribe(
    subscriptionId: string,
    connectionId: string,
    queryName: string,
    args: unknown,
    auth: AuthContext,
  ): Promise<{ result: unknown; version: number }> {
    const fn = this.functions.get(queryName)
    if (!fn) throw new Error(`Query function not found: "${queryName}"`)
    if (fn.type !== "query") throw new Error(`"${queryName}" is not a query function`)

    // Store auth context for re-execution
    this.authContexts.set(connectionId, auth)

    // Execute the query
    const execution = await executeQueryFunction(this.pool, this.schema, fn, args, auth)

    const resultHash = hashResult(execution.result)

    // Register subscription
    this.registry.register({
      id: subscriptionId,
      queryName,
      args,
      connectionId,
      dependencies: execution.dependencies,
      lastResult: execution.result,
      lastResultHash: resultHash,
    })

    return { result: execution.result, version: 1 }
  }

  /**
   * Unsubscribe from a query.
   */
  unsubscribe(subscriptionId: string): void {
    this.registry.remove(subscriptionId)
  }

  /**
   * Remove all subscriptions for a connection.
   */
  removeConnection(connectionId: string): void {
    this.registry.removeConnection(connectionId)
    this.authContexts.delete(connectionId)
  }

  /**
   * Process changes from a committed mutation.
   * Evaluates which subscriptions are affected and re-executes them.
   */
  async processChanges(modifiedTables: string[], changeEvents?: ChangeEvent[]): Promise<void> {
    const changes: ChangeEvent[] =
      changeEvents ??
      modifiedTables.map((table) => ({
        table,
        operation: "update" as const,
      }))

    const invalidated = this.evaluator.evaluate(changes)

    if (invalidated.length === 0) return

    // Re-execute invalidated queries in batches
    const batchSize = this.options.maxConcurrentReExecutions
    for (let i = 0; i < invalidated.length; i += batchSize) {
      const batch = invalidated.slice(i, i + batchSize)
      await Promise.all(batch.map((inv) => this.reExecuteSubscription(inv.subscriptionId)))
    }
  }

  private async reExecuteSubscription(subscriptionId: string): Promise<void> {
    const sub = this.registry.get(subscriptionId)
    if (!sub) return

    const fn = this.functions.get(sub.queryName)
    if (!fn) return

    const auth = this.authContexts.get(sub.connectionId)
    if (!auth) return

    try {
      const execution = await executeQueryFunction(this.pool, this.schema, fn, sub.args, auth)
      const newHash = hashResult(execution.result)

      // Only send update if result actually changed
      if (!hasResultChanged(sub.lastResultHash, execution.result)) return

      // Update subscription state
      this.registry.update(subscriptionId, execution.dependencies, execution.result, newHash)

      const updatedSub = this.registry.get(subscriptionId)
      if (!updatedSub) return

      // Deliver update
      this.updateCallback?.({
        subscriptionId,
        connectionId: sub.connectionId,
        queryName: sub.queryName,
        result: execution.result,
        version: updatedSub.version,
      })
    } catch (error: unknown) {
      console.error(`Failed to re-execute subscription ${subscriptionId}:`, error)
    }
  }
}
