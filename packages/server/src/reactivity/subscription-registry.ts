/**
 * Subscription Registry - manages all active query subscriptions.
 * Each subscription tracks the query, its arguments, dependencies, and last result.
 */

import type { QueryDependency } from "../query-builder/index.js"

export interface Subscription {
  readonly id: string
  readonly queryName: string
  readonly args: unknown
  readonly connectionId: string
  dependencies: QueryDependency[]
  lastResult: unknown
  lastResultHash: string
  version: number
}

export class SubscriptionRegistry {
  private subscriptions = new Map<string, Subscription>()
  private connectionSubscriptions = new Map<string, Set<string>>()
  private tableSubscriptions = new Map<string, Set<string>>()

  /**
   * Register a new subscription.
   *
   * @param sub - Subscription data (version is auto-assigned)
   */
  register(sub: Omit<Subscription, "version">): void {
    const subscription: Subscription = { ...sub, version: 1 }
    this.subscriptions.set(sub.id, subscription)

    // Track by connection
    if (!this.connectionSubscriptions.has(sub.connectionId)) {
      this.connectionSubscriptions.set(sub.connectionId, new Set())
    }
    this.connectionSubscriptions.get(sub.connectionId)!.add(sub.id)

    // Track by table
    this.updateTableIndex(subscription)
  }

  /**
   * Update a subscription's dependencies and last result.
   *
   * @param id - Subscription identifier
   * @param deps - New query dependencies
   * @param result - New query result
   * @param resultHash - Hash of the new result
   */
  update(id: string, deps: QueryDependency[], result: unknown, resultHash: string): void {
    const sub = this.subscriptions.get(id)
    if (!sub) return

    // Remove old table index entries
    this.removeTableIndex(sub)

    sub.dependencies = deps
    sub.lastResult = result
    sub.lastResultHash = resultHash
    sub.version++

    // Re-index by table
    this.updateTableIndex(sub)
  }

  /**
   * Remove a subscription.
   *
   * @param id - Subscription identifier to remove
   */
  remove(id: string): void {
    const sub = this.subscriptions.get(id)
    if (!sub) return

    this.removeTableIndex(sub)

    const connSubs = this.connectionSubscriptions.get(sub.connectionId)
    connSubs?.delete(id)
    if (connSubs?.size === 0) {
      this.connectionSubscriptions.delete(sub.connectionId)
    }

    this.subscriptions.delete(id)
  }

  /**
   * Remove all subscriptions for a connection.
   *
   * @param connectionId - Client connection identifier
   */
  removeConnection(connectionId: string): void {
    const subIds = this.connectionSubscriptions.get(connectionId)
    if (!subIds) return

    for (const id of subIds) {
      const sub = this.subscriptions.get(id)
      if (sub) {
        this.removeTableIndex(sub)
        this.subscriptions.delete(id)
      }
    }

    this.connectionSubscriptions.delete(connectionId)
  }

  /**
   * Get all subscriptions that depend on a given table.
   *
   * @param table - Table name to look up
   * @returns Array of subscriptions depending on the table
   */
  getSubscriptionsForTable(table: string): Subscription[] {
    const subIds = this.tableSubscriptions.get(table)
    if (!subIds) return []
    return Array.from(subIds)
      .map((id) => this.subscriptions.get(id))
      .filter((s): s is Subscription => s !== undefined)
  }

  /**
   * Get a subscription by ID.
   *
   * @param id - Subscription identifier
   * @returns The subscription, or undefined if not found
   */
  get(id: string): Subscription | undefined {
    return this.subscriptions.get(id)
  }

  /**
   * Get all subscription IDs for a connection.
   *
   * @param connectionId - Client connection identifier
   * @returns Array of subscription IDs
   */
  getConnectionSubscriptions(connectionId: string): string[] {
    const subs = this.connectionSubscriptions.get(connectionId)
    return subs ? Array.from(subs) : []
  }

  /**
   * Total active subscriptions count.
   */
  get size(): number {
    return this.subscriptions.size
  }

  private updateTableIndex(sub: Subscription): void {
    for (const dep of sub.dependencies) {
      if (!this.tableSubscriptions.has(dep.table)) {
        this.tableSubscriptions.set(dep.table, new Set())
      }
      this.tableSubscriptions.get(dep.table)!.add(sub.id)
    }
  }

  private removeTableIndex(sub: Subscription): void {
    for (const dep of sub.dependencies) {
      this.tableSubscriptions.get(dep.table)?.delete(sub.id)
    }
  }
}
