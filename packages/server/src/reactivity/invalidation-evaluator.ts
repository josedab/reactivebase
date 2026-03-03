/**
 * Invalidation Evaluator - determines which subscriptions need re-execution
 * after a mutation commits.
 *
 * Supports two levels of invalidation:
 * - Level 1 (table-level): Any mutation to a table invalidates all subscriptions reading from that table.
 * - Level 2 (filter-level): Match mutation change-sets against subscription WHERE predicates.
 */

import type { SubscriptionRegistry, Subscription } from "./subscription-registry.js"

export interface ChangeEvent {
  table: string
  operation: "insert" | "update" | "delete"
  /** Column values of the affected row for filter-level matching */
  affectedFilters?: Record<string, unknown>
  /** For updates: the old values of changed columns */
  oldValues?: Record<string, unknown>
  /** Primary key values of affected rows for row-level matching */
  affectedRowIds?: string[]
}

export interface InvalidationResult {
  subscriptionId: string
  queryName: string
  args: unknown
  connectionId: string
}

export type InvalidationLevel = "table" | "filter" | "row"

export class InvalidationEvaluator {
  private level: InvalidationLevel

  /**
   * Create a new InvalidationEvaluator.
   *
   * @param registry - Subscription registry to evaluate against
   * @param level - Invalidation granularity level
   */
  constructor(
    private registry: SubscriptionRegistry,
    level: InvalidationLevel = "filter",
  ) {
    this.level = level
  }

  /**
   * Evaluate which subscriptions need re-execution based on change events.
   *
   * @param changes - Array of change events from committed mutations
   * @returns Array of invalidation results identifying affected subscriptions
   */
  evaluate(changes: ChangeEvent[]): InvalidationResult[] {
    const invalidated = new Map<string, InvalidationResult>()

    for (const change of changes) {
      // For row-level, use row-aware lookup when row IDs are available
      const subs =
        this.level === "row" && change.affectedRowIds && change.affectedRowIds.length > 0
          ? this.registry.getSubscriptionsForRows(change.table, change.affectedRowIds)
          : this.registry.getSubscriptionsForTable(change.table)

      for (const sub of subs) {
        if (invalidated.has(sub.id)) continue

        if (this.shouldInvalidate(sub, change)) {
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

  private shouldInvalidate(sub: Subscription, change: ChangeEvent): boolean {
    // If no filter data provided or using table-level, always invalidate
    if (this.level === "table" || !change.affectedFilters) {
      return true
    }

    // Filter-level: check if the change matches subscription dependencies
    const relevantDeps = sub.dependencies.filter((d) => d.table === change.table)
    if (relevantDeps.length === 0) return false

    for (const dep of relevantDeps) {
      // If dependency has no filters, it reads all rows — always invalidate
      if (Object.keys(dep.filters).length === 0) {
        return true
      }

      // Check if the changed row matches the subscription's filters
      const matchesNew = this.filtersMatch(dep.filters, change.affectedFilters)

      // For updates, also check if the old values matched (row leaving the result set)
      if (change.operation === "update" && change.oldValues) {
        const matchesOld = this.filtersMatch(dep.filters, change.oldValues)
        if (matchesNew || matchesOld) return true
      } else {
        if (matchesNew) return true
      }
    }

    return false
  }

  /**
   * Check if a set of filter predicates matches a row's values.
   */
  private filtersMatch(filters: Record<string, unknown>, rowValues: Record<string, unknown>): boolean {
    for (const [column, filterValue] of Object.entries(filters)) {
      const rowValue = rowValues[column]

      // If the row doesn't have the column, we can't filter it out — assume match
      if (rowValue === undefined) continue

      // Array filter (IN operator)
      if (Array.isArray(filterValue)) {
        if (!filterValue.includes(rowValue)) return false
        continue
      }

      // Equality match
      if (rowValue !== filterValue) return false
    }

    return true
  }
}
