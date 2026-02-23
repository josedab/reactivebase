/**
 * Subscription Manager - manages the lifecycle of query subscriptions,
 * coordinating between the connection, cache, and application layer.
 */

import { ConnectionManager, type ConnectionStatus } from "../connection/index.js"
import { QueryCache, type CacheEntry } from "../cache/index.js"

export interface SubscriptionHandle {
  id: string
  queryName: string
  args: unknown
  unsubscribe: () => void
}

export interface ReactiveBaseClientOptions {
  url: string
  token?: string
}

export type QueryListener = (data: unknown, error?: Error) => void

/**
 * ReactiveBase client - the main entry point for client-side reactive queries.
 */
export class ReactiveBaseClient {
  private connection: ConnectionManager
  private cache: QueryCache
  private subscriptions = new Map<string, SubscriptionHandle>()
  private queryListeners = new Map<string, Set<QueryListener>>()
  private mutationCallbacks = new Map<
    string,
    {
      resolve: (data: unknown) => void
      reject: (error: Error) => void
    }
  >()
  private subscriptionCounter = 0

  constructor(options: ReactiveBaseClientOptions) {
    this.connection = new ConnectionManager({
      url: options.url,
      token: options.token,
    })

    this.cache = new QueryCache()

    // Route incoming messages
    this.connection.onMessage((msg) => this.handleMessage(msg as Record<string, unknown>))

    // Handle reconnection
    this.connection.onStatus((status) => this.handleStatusChange(status))

    // Auto-connect
    this.connection.connect()
  }

  /**
   * Subscribe to a reactive query.
   */
  subscribe(queryName: string, args: unknown, listener: QueryListener): () => void {
    const subscriptionId = `sub_${++this.subscriptionCounter}`

    // Register listener
    if (!this.queryListeners.has(subscriptionId)) {
      this.queryListeners.set(subscriptionId, new Set())
    }
    this.queryListeners.get(subscriptionId)!.add(listener)

    // Send subscribe message
    this.connection.send({
      type: "subscribe",
      subscriptionId,
      queryName,
      args,
    })

    const handle: SubscriptionHandle = {
      id: subscriptionId,
      queryName,
      args,
      unsubscribe: () => {
        this.connection.send({ type: "unsubscribe", subscriptionId })
        this.subscriptions.delete(subscriptionId)
        this.queryListeners.delete(subscriptionId)
        this.cache.remove(subscriptionId)
      },
    }

    this.subscriptions.set(subscriptionId, handle)

    return handle.unsubscribe
  }

  /**
   * Execute a mutation.
   */
  async mutate(mutationName: string, args: unknown): Promise<unknown> {
    const requestId = `mut_${++this.subscriptionCounter}`

    return new Promise((resolve, reject) => {
      this.mutationCallbacks.set(requestId, { resolve, reject })

      this.connection.send({
        type: "mutate",
        requestId,
        mutationName,
        args,
      })
    })
  }

  /**
   * Execute an action.
   */
  async runAction(actionName: string, args: unknown): Promise<unknown> {
    const requestId = `act_${++this.subscriptionCounter}`

    return new Promise((resolve, reject) => {
      this.mutationCallbacks.set(requestId, { resolve, reject })

      this.connection.send({
        type: "action",
        requestId,
        actionName,
        args,
      })
    })
  }

  /**
   * Execute a one-shot (non-reactive) query.
   */
  async fetchQuery(queryName: string, args: unknown): Promise<unknown> {
    // Subscribe, get data, then immediately unsubscribe
    return new Promise((resolve, reject) => {
      const unsubscribe = this.subscribe(queryName, args, (data, error) => {
        unsubscribe()
        if (error) reject(error)
        else resolve(data)
      })
    })
  }

  /**
   * Get the cache for optimistic updates.
   */
  getCache(): QueryCache {
    return this.cache
  }

  /**
   * Disconnect from the server.
   */
  disconnect(): void {
    this.connection.disconnect()
    this.cache.clear()
    this.subscriptions.clear()
    this.queryListeners.clear()
  }

  private handleMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "subscription_data":
        this.handleSubscriptionData(
          msg as {
            subscriptionId: string
            data: unknown
            version: number
          },
        )
        break

      case "subscription_update":
        this.handleSubscriptionUpdate(
          msg as {
            subscriptionId: string
            data: unknown
            version: number
          },
        )
        break

      case "subscription_error":
        this.handleSubscriptionError(
          msg as {
            subscriptionId: string
            error: { code: string; message: string }
          },
        )
        break

      case "mutation_result":
        this.handleMutationResult(msg as { requestId: string; data: unknown })
        break

      case "mutation_error":
        this.handleMutationError(
          msg as {
            requestId: string
            error: { code: string; message: string }
          },
        )
        break

      case "action_result":
        this.handleMutationResult(msg as { requestId: string; data: unknown })
        break

      case "action_error":
        this.handleMutationError(
          msg as {
            requestId: string
            error: { code: string; message: string }
          },
        )
        break
    }
  }

  private handleSubscriptionData(msg: { subscriptionId: string; data: unknown; version: number }): void {
    const handle = this.subscriptions.get(msg.subscriptionId)
    if (!handle) return

    this.cache.set(msg.subscriptionId, {
      queryName: handle.queryName,
      args: handle.args,
      data: msg.data,
      version: msg.version,
    })

    this.notifyListeners(msg.subscriptionId, msg.data)
  }

  private handleSubscriptionUpdate(msg: { subscriptionId: string; data: unknown; version: number }): void {
    this.cache.update(msg.subscriptionId, msg.data, msg.version)
    this.notifyListeners(msg.subscriptionId, msg.data)
  }

  private handleSubscriptionError(msg: { subscriptionId: string; error: { code: string; message: string } }): void {
    const error = new Error(msg.error.message)
    this.notifyListeners(msg.subscriptionId, undefined, error)
  }

  private handleMutationResult(msg: { requestId: string; data: unknown }): void {
    const cb = this.mutationCallbacks.get(msg.requestId)
    if (cb) {
      this.mutationCallbacks.delete(msg.requestId)
      cb.resolve(msg.data)
    }
  }

  private handleMutationError(msg: { requestId: string; error: { code: string; message: string } }): void {
    const cb = this.mutationCallbacks.get(msg.requestId)
    if (cb) {
      this.mutationCallbacks.delete(msg.requestId)
      cb.reject(new Error(msg.error.message))
    }
  }

  private handleStatusChange(status: ConnectionStatus): void {
    if (status === "reconnecting") {
      this.cache.markAllStale()
    }

    if (status === "connected") {
      // Re-subscribe all active subscriptions
      for (const handle of this.subscriptions.values()) {
        this.connection.send({
          type: "subscribe",
          subscriptionId: handle.id,
          queryName: handle.queryName,
          args: handle.args,
        })
      }
    }
  }

  private notifyListeners(subscriptionId: string, data?: unknown, error?: Error): void {
    const listeners = this.queryListeners.get(subscriptionId)
    if (listeners) {
      for (const listener of listeners) {
        listener(data, error)
      }
    }
  }
}
