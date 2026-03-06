/**
 * Declarative Webhook Subscriptions for ReactiveBase.
 * Subscribe to data changes via webhooks with configurable filtering,
 * batching, and delivery guarantees.
 *
 * Usage:
 *   const subscriptions = new WebhookSubscriptionManager({ queue, circuitBreaker })
 *   subscriptions.subscribe({
 *     name: "notify-on-task-insert",
 *     url: "https://example.com/webhook",
 *     tables: ["tasks"],
 *     events: ["insert", "update"],
 *     filter: (event) => event.data.status === "active",
 *     secret: "whsec_...",
 *   })
 */

import { randomUUID, createHmac } from "node:crypto"
import type { CircuitBreakerRegistry } from "./circuit-breaker.js"
import type { WebhookDeliveryQueue } from "./delivery-queue.js"
import { validateWebhookUrl } from "./url-validation.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export type WebhookEventType = "insert" | "update" | "delete"

export interface WebhookSubscription {
  /** Unique subscription ID */
  id: string
  /** Human-readable name */
  name: string
  /** Delivery URL */
  url: string
  /** Tables to watch (empty = all tables) */
  tables: string[]
  /** Event types to watch (empty = all events) */
  events: WebhookEventType[]
  /** HMAC secret for signing deliveries */
  secret?: string
  /** Custom filter predicate */
  filter?: (event: DataChangeEvent) => boolean
  /** Whether to batch events (default: false) */
  batch?: boolean
  /** Batch window in ms (default: 1000) */
  batchWindowMs?: number
  /** Max batch size before flushing (default: 50) */
  maxBatchSize?: number
  /** Custom headers to include with deliveries */
  headers?: Record<string, string>
  /** Whether the subscription is active (default: true) */
  enabled?: boolean
  /** Metadata for tracking */
  metadata?: Record<string, unknown>
}

export interface DataChangeEvent {
  id: string
  table: string
  type: WebhookEventType
  data: Record<string, unknown>
  oldData?: Record<string, unknown>
  timestamp: number
}

export interface WebhookSubscriptionManagerOptions {
  queue?: WebhookDeliveryQueue
  circuitBreaker?: CircuitBreakerRegistry
  /** Signature header name (default: "x-reactivebase-signature") */
  signatureHeader?: string
  /** Global max batch window (default: 2000) */
  maxBatchWindowMs?: number
}

interface BatchBuffer {
  subscriptionId: string
  events: DataChangeEvent[]
  timer: ReturnType<typeof setTimeout> | null
}

// ─── Implementation ──────────────────────────────────────────────────────────

export class WebhookSubscriptionManager {
  private subscriptions = new Map<string, WebhookSubscription>()
  private batches = new Map<string, BatchBuffer>()
  private queue?: WebhookDeliveryQueue
  private circuitBreaker?: CircuitBreakerRegistry
  private signatureHeader: string
  private maxBatchWindowMs: number
  private deliveryCount = 0
  private errorCount = 0

  constructor(options: WebhookSubscriptionManagerOptions = {}) {
    this.queue = options.queue
    this.circuitBreaker = options.circuitBreaker
    this.signatureHeader = options.signatureHeader ?? "x-reactivebase-signature"
    this.maxBatchWindowMs = options.maxBatchWindowMs ?? 2000
  }

  /**
   * Register a new webhook subscription.
   */
  subscribe(config: Omit<WebhookSubscription, "id"> & { id?: string }): string {
    const id = config.id ?? `wsub_${randomUUID()}`
    const subscription: WebhookSubscription = {
      ...config,
      id,
      enabled: config.enabled ?? true,
      batch: config.batch ?? false,
      batchWindowMs: config.batchWindowMs ?? 1000,
      maxBatchSize: config.maxBatchSize ?? 50,
    }

    this.subscriptions.set(id, subscription)
    return id
  }

  /**
   * Remove a webhook subscription.
   */
  unsubscribe(id: string): boolean {
    const batch = this.batches.get(id)
    if (batch?.timer) {
      clearTimeout(batch.timer)
      // Flush remaining events
      if (batch.events.length > 0) {
        this.flushBatch(id).catch((err: unknown) => {
          console.debug(`[declarative-subscriptions] flush failed during unsubscribe for "${id}":`, err)
        })
      }
    }
    this.batches.delete(id)
    return this.subscriptions.delete(id)
  }

  /**
   * Enable/disable a subscription.
   */
  setEnabled(id: string, enabled: boolean): boolean {
    const sub = this.subscriptions.get(id)
    if (!sub) return false
    sub.enabled = enabled
    return true
  }

  /**
   * Process a data change event, delivering to all matching subscriptions.
   */
  async handleChange(event: DataChangeEvent): Promise<void> {
    const matching = this.findMatchingSubscriptions(event)
    const deliveries = matching.map((sub) => this.deliverToSubscription(sub, event))
    await Promise.allSettled(deliveries)
  }

  /**
   * Process multiple data change events.
   */
  async handleChanges(events: DataChangeEvent[]): Promise<void> {
    for (const event of events) {
      await this.handleChange(event)
    }
  }

  /**
   * Get a subscription by ID.
   */
  getSubscription(id: string): WebhookSubscription | undefined {
    return this.subscriptions.get(id)
  }

  /**
   * List all subscriptions.
   */
  listSubscriptions(): WebhookSubscription[] {
    return Array.from(this.subscriptions.values())
  }

  /**
   * Get manager stats.
   */
  getStats(): {
    totalSubscriptions: number
    activeSubscriptions: number
    totalDeliveries: number
    totalErrors: number
    pendingBatches: number
  } {
    return {
      totalSubscriptions: this.subscriptions.size,
      activeSubscriptions: Array.from(this.subscriptions.values()).filter((s) => s.enabled).length,
      totalDeliveries: this.deliveryCount,
      totalErrors: this.errorCount,
      pendingBatches: Array.from(this.batches.values()).filter((b) => b.events.length > 0).length,
    }
  }

  /**
   * Destroy the manager, flushing all pending batches.
   */
  async destroy(): Promise<void> {
    for (const [id, batch] of Array.from(this.batches)) {
      if (batch.timer) clearTimeout(batch.timer)
      if (batch.events.length > 0) {
        await this.flushBatch(id).catch((err: unknown) => {
          console.debug(`[declarative-subscriptions] flush failed during destroy for "${id}":`, err)
        })
      }
    }
    this.batches.clear()
    this.subscriptions.clear()
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private findMatchingSubscriptions(event: DataChangeEvent): WebhookSubscription[] {
    const matches: WebhookSubscription[] = []
    for (const sub of Array.from(this.subscriptions.values())) {
      if (!sub.enabled) continue
      if (sub.tables.length > 0 && !sub.tables.includes(event.table)) continue
      if (sub.events.length > 0 && !sub.events.includes(event.type)) continue
      if (sub.filter && !sub.filter(event)) continue
      matches.push(sub)
    }
    return matches
  }

  private async deliverToSubscription(sub: WebhookSubscription, event: DataChangeEvent): Promise<void> {
    if (sub.batch) {
      this.addToBatch(sub.id, event)
      return
    }

    await this.sendDelivery(sub, [event])
  }

  private addToBatch(subscriptionId: string, event: DataChangeEvent): void {
    let batch = this.batches.get(subscriptionId)
    if (!batch) {
      batch = { subscriptionId, events: [], timer: null }
      this.batches.set(subscriptionId, batch)
    }

    batch.events.push(event)

    const sub = this.subscriptions.get(subscriptionId)
    if (!sub) return

    if (batch.events.length >= (sub.maxBatchSize ?? 50)) {
      if (batch.timer) clearTimeout(batch.timer)
      batch.timer = null
      this.flushBatch(subscriptionId).catch((err: unknown) => {
        console.debug(`[declarative-subscriptions] flush failed for batch "${subscriptionId}":`, err)
      })
      return
    }

    if (!batch.timer) {
      const windowMs = Math.min(sub.batchWindowMs ?? 1000, this.maxBatchWindowMs)
      batch.timer = setTimeout(() => {
        this.flushBatch(subscriptionId).catch((err: unknown) => {
          console.debug(`[declarative-subscriptions] flush failed for timer batch "${subscriptionId}":`, err)
        })
      }, windowMs)
    }
  }

  private async flushBatch(subscriptionId: string): Promise<void> {
    const batch = this.batches.get(subscriptionId)
    if (!batch || batch.events.length === 0) return

    const sub = this.subscriptions.get(subscriptionId)
    if (!sub) return

    const events = batch.events.splice(0)
    batch.timer = null

    await this.sendDelivery(sub, events)
  }

  private async sendDelivery(sub: WebhookSubscription, events: DataChangeEvent[]): Promise<void> {
    // Check circuit breaker
    if (this.circuitBreaker && !this.circuitBreaker.canExecute(sub.url)) {
      this.errorCount++
      return
    }

    const payload = {
      subscription: sub.name,
      events,
      deliveredAt: new Date().toISOString(),
    }

    // If we have a queue, use it for reliable delivery
    if (this.queue) {
      this.queue.enqueue(sub.url, sub.name, payload, sub.secret, sub.headers)
      this.deliveryCount++
      return
    }

    // Direct delivery
    try {
      validateWebhookUrl(sub.url)
      const body = JSON.stringify(payload)
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Webhook-Subscription": sub.name,
        ...sub.headers,
      }

      if (sub.secret) {
        headers[this.signatureHeader] = createHmac("sha256", sub.secret).update(body).digest("hex")
      }

      const response = await fetch(sub.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(30_000),
      })

      if (response.ok) {
        this.deliveryCount++
        this.circuitBreaker?.recordSuccess(sub.url)
      } else {
        this.errorCount++
        this.circuitBreaker?.recordFailure(sub.url)
      }
    } catch {
      this.errorCount++
      this.circuitBreaker?.recordFailure(sub.url)
    }
  }
}

// ─── Declarative Helper ──────────────────────────────────────────────────────

/**
 * Define a webhook subscription declaratively.
 * Returns a subscription config that can be passed to WebhookSubscriptionManager.subscribe().
 */
export function defineWebhookSubscription(config: Omit<WebhookSubscription, "id">): Omit<WebhookSubscription, "id"> {
  if (!config.name) throw new Error("Webhook subscription requires a name")
  if (!config.url) throw new Error("Webhook subscription requires a URL")
  return config
}

// ─── SQL Builders ────────────────────────────────────────────────────────────

export function generateSubscriptionTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_webhook_subscriptions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  tables TEXT[] NOT NULL DEFAULT '{}',
  events TEXT[] NOT NULL DEFAULT '{}',
  secret TEXT,
  headers JSONB DEFAULT '{}',
  batch BOOLEAN NOT NULL DEFAULT false,
  batch_window_ms INTEGER DEFAULT 1000,
  max_batch_size INTEGER DEFAULT 50,
  enabled BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_enabled
  ON _reactivebase_webhook_subscriptions(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_tables
  ON _reactivebase_webhook_subscriptions USING GIN(tables);
`.trim()
}
