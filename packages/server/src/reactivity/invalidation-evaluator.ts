/**
 * Invalidation Evaluator - determines which subscriptions need re-execution
 * after a mutation commits.
 *
 * Phase 1: Table-level invalidation (Level 1).
 * Any mutation to a table invalidates all subscriptions reading from that table.
 */

import type { SubscriptionRegistry, Subscription } from "./subscription-registry.js"

export interface ChangeEvent {
  table: string
  operation: "insert" | "update" | "delete"
  /** Column values for filter matching (Phase 2: Level 2 tracking) */
  affectedFilters?: Record<string, unknown>
}

export interface InvalidationResult {
  subscriptionId: string
  queryName: string
  args: unknown
  connectionId: string
}

export class InvalidationEvaluator {
  constructor(private registry: SubscriptionRegistry) {}

  /**
   * Evaluate which subscriptions need re-execution based on change events.
   * Phase 1: Table-level matching only.
   */
  evaluate(changes: ChangeEvent[]): InvalidationResult[] {
    const invalidated = new Map<string, InvalidationResult>()

    for (const change of changes) {
      const subs = this.registry.getSubscriptionsForTable(change.table)

      for (const sub of subs) {
        if (!invalidated.has(sub.id)) {
          invalidated.set(sub.id, {
            subscriptionId: sub.id,
            queryName: sub.queryName,
            args: sub.args,
            connectionId: sub.connectionId,
          })
        }
      }
    }

    return Array.from(invalidated.values())
  }
}
