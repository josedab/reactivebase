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
  /** Row IDs returned by the last query execution, keyed by table name */
  trackedRowIds?: Map<string, Set<string>>
  /** Primary key column name for each table */
  primaryKeyColumns?: Map<string, string>
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

  /**
   * Store row IDs captured during query execution for a subscription.
   *
   * @param id - Subscription identifier
   * @param table - Table the rows belong to
   * @param rowIds - Set of primary key values
   * @param pkColumn - Primary key column name
   */
  setTrackedRowIds(id: string, table: string, rowIds: Set<string>, pkColumn: string = "id"): void {
    const sub = this.subscriptions.get(id)
    if (!sub) return

    if (!sub.trackedRowIds) {
      ;(sub as { trackedRowIds: Map<string, Set<string>> }).trackedRowIds = new Map()
    }
    if (!sub.primaryKeyColumns) {
      ;(sub as { primaryKeyColumns: Map<string, string> }).primaryKeyColumns = new Map()
    }
    sub.trackedRowIds!.set(table, rowIds)
    sub.primaryKeyColumns!.set(table, pkColumn)
  }

  /**
   * Get tracked row IDs for a subscription and table.
   *
   * @param id - Subscription identifier
   * @param table - Table name
   * @returns Set of tracked row IDs, or undefined if not tracked
   */
  getTrackedRowIds(id: string, table: string): Set<string> | undefined {
    return this.subscriptions.get(id)?.trackedRowIds?.get(table)
  }

  /**
   * Get subscriptions for a table that track specific row IDs.
   * Returns only subscriptions whose tracked rows intersect with the given row IDs.
   *
   * @param table - Table name
   * @param rowIds - Row IDs to match against
   * @returns Subscriptions with matching tracked rows
   */
  getSubscriptionsForRows(table: string, rowIds: string[]): Subscription[] {
    const subs = this.getSubscriptionsForTable(table)
    if (rowIds.length === 0) return subs

    return subs.filter((sub) => {
      const tracked = sub.trackedRowIds?.get(table)
      if (!tracked) return true // No row tracking — must invalidate
      for (const id of rowIds) {
        if (tracked.has(id)) return true
      }
      return false
    })
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
