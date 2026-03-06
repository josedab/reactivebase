/**
 * Subscription Lifecycle Hooks & Client Middleware for ReactiveBase.
 *
 * Implements a client-side middleware pipeline for subscriptions with
 * onSubscribe, onUpdate, onError, onStale, onReconnect hooks.
 *
 * Usage:
 *   const client = new ReactiveBaseClient({
 *     url: "ws://localhost:3001",
 *     middleware: [loggingMiddleware(), retryMiddleware({ maxRetries: 3 })],
 *   })
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SubscriptionEvent {
  subscriptionId: string
  queryName: string
  args: unknown
  timestamp: number
}

export interface SubscriptionUpdateEvent extends SubscriptionEvent {
  data: unknown
  version: number
  /** Time since last update in ms */
  sincePreviousMs: number | null
}

export interface SubscriptionErrorEvent extends SubscriptionEvent {
  error: Error
  /** Number of consecutive errors */
  errorCount: number
}

export interface SubscriptionStaleEvent extends SubscriptionEvent {
  /** How long data has been stale in ms */
  staleForMs: number
  lastUpdateAt: number
}

export interface SubscriptionReconnectEvent {
  attempt: number
  maxAttempts: number
  backoffMs: number
  timestamp: number
}

// ─── Middleware Hooks ─────────────────────────────────────────────────────────

export interface ClientSubscriptionMiddleware {
  /** Unique middleware name for identification */
  name: string

  /** Called when a new subscription is created */
  onSubscribe?: (event: SubscriptionEvent) => void | Promise<void>

  /** Called when subscription data is updated */
  onUpdate?: (event: SubscriptionUpdateEvent) => unknown | Promise<unknown>

  /** Called when a subscription error occurs */
  onError?: (event: SubscriptionErrorEvent) => void | Promise<void>

  /** Called when subscription data becomes stale (no updates for threshold) */
  onStale?: (event: SubscriptionStaleEvent) => void | Promise<void>

  /** Called on WebSocket reconnection attempt */
  onReconnect?: (event: SubscriptionReconnectEvent) => void | Promise<void>

  /** Called when a subscription is removed */
  onUnsubscribe?: (event: SubscriptionEvent) => void | Promise<void>
}

// ─── Middleware Pipeline ─────────────────────────────────────────────────────

export class ClientMiddlewarePipeline {
  private middlewares: ClientSubscriptionMiddleware[] = []
  private _errorCounts: ReadonlyMap<string, number> = new Map()
  private _lastUpdateTimes: ReadonlyMap<string, number> = new Map()

  /** Add a middleware to the pipeline. */
  use(middleware: ClientSubscriptionMiddleware): void {
    this.middlewares.push(middleware)
  }

  /** Remove a middleware by name. */
  remove(name: string): boolean {
    const idx = this.middlewares.findIndex((m) => m.name === name)
    if (idx >= 0) {
      this.middlewares.splice(idx, 1)
      return true
    }
    return false
  }

  /** Run onSubscribe hooks. */
  async runOnSubscribe(event: SubscriptionEvent): Promise<void> {
    this._errorCounts = new Map([...this._errorCounts, [event.subscriptionId, 0]])
    for (const mw of this.middlewares) {
      if (mw.onSubscribe) {
        try {
          await mw.onSubscribe(event)
        } catch {
          // Middleware errors should not break the pipeline
        }
      }
    }
  }

  /** Run onUpdate hooks. Data can be transformed by each middleware. */
  async runOnUpdate(event: SubscriptionUpdateEvent): Promise<unknown> {
    this._errorCounts = new Map([...this._errorCounts, [event.subscriptionId, 0]])
    this._lastUpdateTimes = new Map([...this._lastUpdateTimes, [event.subscriptionId, Date.now()]])

    let data = event.data
    for (const mw of this.middlewares) {
      if (mw.onUpdate) {
        try {
          const result = await mw.onUpdate({ ...event, data })
          if (result !== undefined) {
            data = result
          }
        } catch {
          // Don't break the pipeline
        }
      }
    }
    return data
  }

  /** Run onError hooks. */
  async runOnError(event: SubscriptionErrorEvent): Promise<void> {
    const count = (this._errorCounts.get(event.subscriptionId) ?? 0) + 1
    this._errorCounts = new Map([...this._errorCounts, [event.subscriptionId, count]])

    for (const mw of this.middlewares) {
      if (mw.onError) {
        try {
          await mw.onError({ ...event, errorCount: count })
        } catch {
          // Don't break the pipeline
        }
      }
    }
  }

  /** Run onStale hooks for a subscription. */
  async runOnStale(event: SubscriptionStaleEvent): Promise<void> {
    for (const mw of this.middlewares) {
      if (mw.onStale) {
        try {
          await mw.onStale(event)
        } catch {
          // Don't break the pipeline
        }
      }
    }
  }

  /** Run onReconnect hooks. */
  async runOnReconnect(event: SubscriptionReconnectEvent): Promise<void> {
    for (const mw of this.middlewares) {
      if (mw.onReconnect) {
        try {
          await mw.onReconnect(event)
        } catch {
          // Don't break the pipeline
        }
      }
    }
  }

  /** Run onUnsubscribe hooks. */
  async runOnUnsubscribe(event: SubscriptionEvent): Promise<void> {
    const newErrorCounts = new Map(this._errorCounts)
    newErrorCounts.delete(event.subscriptionId)
    this._errorCounts = newErrorCounts

    const newUpdateTimes = new Map(this._lastUpdateTimes)
    newUpdateTimes.delete(event.subscriptionId)
    this._lastUpdateTimes = newUpdateTimes

    for (const mw of this.middlewares) {
      if (mw.onUnsubscribe) {
        try {
          await mw.onUnsubscribe(event)
        } catch {
          // Don't break the pipeline
        }
      }
    }
  }

  /** Get the staleness of a subscription in ms. */
  getStaleness(subscriptionId: string): number | null {
    const lastUpdate = this._lastUpdateTimes.get(subscriptionId)
    if (!lastUpdate) return null
    return Date.now() - lastUpdate
  }

  get count(): number {
    return this.middlewares.length
  }
}

// ─── Built-in Middleware ─────────────────────────────────────────────────────

/**
 * Logging middleware — logs subscription lifecycle events.
 */
export function loggingMiddleware(options: { prefix?: string; verbose?: boolean } = {}): ClientSubscriptionMiddleware {
  const prefix = options.prefix ?? "[ReactiveBase]"
  const verbose = options.verbose ?? false

  return {
    name: "logging",
    onSubscribe(event) {
      console.info(`${prefix} Subscribe: ${event.queryName}`, verbose ? event.args : "")
    },
    onUpdate(event) {
      console.info(`${prefix} Update: ${event.queryName} (v${event.version})`)
      return event.data
    },
    onError(event) {
      console.error(`${prefix} Error: ${event.queryName}`, event.error.message, `(attempt ${event.errorCount})`)
    },
    onStale(event) {
      console.warn(`${prefix} Stale: ${event.queryName} (${event.staleForMs}ms)`)
    },
    onReconnect(event) {
      console.info(`${prefix} Reconnect: attempt ${event.attempt}/${event.maxAttempts}`)
    },
    onUnsubscribe(event) {
      if (verbose) console.info(`${prefix} Unsubscribe: ${event.queryName}`)
    },
  }
}

/**
 * Retry middleware — tracks error counts per subscription for retry logic.
 */
export function retryMiddleware(
  options: {
    maxRetries?: number
    backoffMs?: number
    onMaxRetriesReached?: (queryName: string) => void
  } = {},
): ClientSubscriptionMiddleware {
  const maxRetries = options.maxRetries ?? 3
  const _backoffMs = options.backoffMs ?? 1000

  return {
    name: "retry",
    onError(event) {
      if (event.errorCount >= maxRetries) {
        options.onMaxRetriesReached?.(event.queryName)
      }
    },
    onReconnect(event) {
      // Exponential backoff is handled by the connection manager
      if (event.attempt > maxRetries) {
        console.warn(`[retry] Max reconnect attempts (${maxRetries}) reached`)
      }
    },
  }
}

/**
 * Analytics middleware — tracks subscription metrics.
 */
export function analyticsMiddleware(
  options: {
    onMetric?: (metric: AnalyticsMetric) => void
  } = {},
): ClientSubscriptionMiddleware {
  const subscriptions = new Map<string, { startedAt: number; updateCount: number; errorCount: number }>()

  return {
    name: "analytics",
    onSubscribe(event) {
      subscriptions.set(event.subscriptionId, {
        startedAt: Date.now(),
        updateCount: 0,
        errorCount: 0,
      })
      options.onMetric?.({ type: "subscribe", queryName: event.queryName, timestamp: Date.now() })
    },
    onUpdate(event) {
      const sub = subscriptions.get(event.subscriptionId)
      if (sub) sub.updateCount++
      options.onMetric?.({
        type: "update",
        queryName: event.queryName,
        timestamp: Date.now(),
        durationMs: event.sincePreviousMs ?? undefined,
      })
      return event.data
    },
    onError(event) {
      const sub = subscriptions.get(event.subscriptionId)
      if (sub) sub.errorCount++
      options.onMetric?.({
        type: "error",
        queryName: event.queryName,
        timestamp: Date.now(),
        error: event.error.message,
      })
    },
    onUnsubscribe(event) {
      const sub = subscriptions.get(event.subscriptionId)
      if (sub) {
        options.onMetric?.({
          type: "unsubscribe",
          queryName: event.queryName,
          timestamp: Date.now(),
          lifetimeMs: Date.now() - sub.startedAt,
          totalUpdates: sub.updateCount,
          totalErrors: sub.errorCount,
        })
      }
      subscriptions.delete(event.subscriptionId)
    },
  }
}

export interface AnalyticsMetric {
  type: "subscribe" | "update" | "error" | "unsubscribe" | "reconnect"
  queryName: string
  timestamp: number
  durationMs?: number
  error?: string
  lifetimeMs?: number
  totalUpdates?: number
  totalErrors?: number
}
