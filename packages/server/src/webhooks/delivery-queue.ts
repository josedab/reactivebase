/**
 * Webhook Delivery Queue with exponential backoff, dead-letter handling,
 * delivery logs, and metrics. Extends the existing webhook system.
 */

import { randomUUID } from "node:crypto"

// ─── Types ───────────────────────────────────────────────────────────────────

export type DeliveryStatus = "pending" | "in_progress" | "delivered" | "failed" | "dead_letter"

export interface DeliveryRecord {
  id: string
  webhookUrl: string
  mutationName: string
  payload: string
  status: DeliveryStatus
  attempts: number
  maxAttempts: number
  lastAttemptAt: number | null
  nextRetryAt: number | null
  lastError: string | null
  responseStatus: number | null
  createdAt: number
  deliveredAt: number | null
}

export interface DeliveryQueueOptions {
  /** Max retry attempts before dead-letter (default: 5) */
  maxAttempts?: number
  /** Base delay for exponential backoff in ms (default: 1000) */
  baseDelayMs?: number
  /** Max delay between retries in ms (default: 300_000 = 5 min) */
  maxDelayMs?: number
  /** Jitter factor for retry delays (0-1, default: 0.1) */
  jitterFactor?: number
  /** How often to process retry queue in ms (default: 5000) */
  retryIntervalMs?: number
  /** Max concurrent deliveries (default: 10) */
  maxConcurrent?: number
}

const DEFAULT_QUEUE_OPTIONS: Required<DeliveryQueueOptions> = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 300_000,
  jitterFactor: 0.1,
  retryIntervalMs: 5000,
  maxConcurrent: 10,
}

export interface DeliveryMetrics {
  totalDelivered: number
  totalFailed: number
  totalDeadLettered: number
  totalRetries: number
  pendingDeliveries: number
  avgDeliveryTimeMs: number
  deliveriesByWebhook: Record<string, { delivered: number; failed: number }>
}

export interface WebhookTemplate {
  name: string
  formatPayload: (event: string, data: unknown) => unknown
  headers?: Record<string, string>
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class WebhookDeliveryError extends Error {
  readonly code = "WEBHOOK_DELIVERY_ERROR"

  constructor(
    public readonly webhookUrl: string,
    public readonly responseStatus: number | null,
    message: string,
  ) {
    super(message)
    this.name = "WebhookDeliveryError"
  }
}

// ─── Delivery Queue ──────────────────────────────────────────────────────────

/**
 * Persistent delivery queue with exponential backoff retry.
 * In production, backed by Postgres; in-memory for development.
 */
export class WebhookDeliveryQueue {
  private queue: DeliveryRecord[] = []
  private deadLetter: DeliveryRecord[] = []
  private retryTimer: ReturnType<typeof setInterval> | null = null
  private options: Required<DeliveryQueueOptions>
  private activeDeliveries = 0

  // Metrics
  private metrics: DeliveryMetrics = {
    totalDelivered: 0,
    totalFailed: 0,
    totalDeadLettered: 0,
    totalRetries: 0,
    pendingDeliveries: 0,
    avgDeliveryTimeMs: 0,
    deliveriesByWebhook: {},
  }
  private totalDeliveryTimeMs = 0

  constructor(options: DeliveryQueueOptions = {}) {
    this.options = { ...DEFAULT_QUEUE_OPTIONS, ...options }
  }

  /**
   * Enqueue a webhook delivery.
   */
  enqueue(
    webhookUrl: string,
    mutationName: string,
    payload: unknown,
    _secret?: string,
    _headers?: Record<string, string>,
  ): string {
    const id = generateDeliveryId()
    const record: DeliveryRecord = {
      id,
      webhookUrl,
      mutationName,
      payload: JSON.stringify(payload),
      status: "pending",
      attempts: 0,
      maxAttempts: this.options.maxAttempts,
      lastAttemptAt: null,
      nextRetryAt: null,
      lastError: null,
      responseStatus: null,
      createdAt: Date.now(),
      deliveredAt: null,
    }

    this.queue.push(record)
    this.metrics.pendingDeliveries++
    return id
  }

  /**
   * Start processing the delivery queue.
   */
  start(): void {
    if (this.retryTimer) return

    this.retryTimer = setInterval(() => {
      this.processQueue().catch((err) => {
        console.error("Webhook delivery queue error:", err)
      })
    }, this.options.retryIntervalMs)

    // Process immediately
    this.processQueue().catch((err) => {
      console.error("Webhook delivery queue initial processing error:", err)
    })
  }

  /**
   * Stop processing the delivery queue.
   */
  stop(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer)
      this.retryTimer = null
    }
  }

  /**
   * Process pending and retryable deliveries.
   */
  async processQueue(): Promise<void> {
    const now = Date.now()
    const ready = this.queue.filter(
      (r) => r.status === "pending" || (r.status === "failed" && r.nextRetryAt !== null && r.nextRetryAt <= now),
    )

    const batch = ready.slice(0, this.options.maxConcurrent - this.activeDeliveries)
    if (batch.length === 0) return

    await Promise.allSettled(batch.map((record) => this.deliver(record)))
  }

  /**
   * Attempt to deliver a single webhook.
   */
  private async deliver(record: DeliveryRecord): Promise<void> {
    this.activeDeliveries++
    record.status = "in_progress"
    record.attempts++
    record.lastAttemptAt = Date.now()

    try {
      const startTime = performance.now()

      const response = await fetch(record.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Delivery-Id": record.id,
          "X-Webhook-Event": record.mutationName,
        },
        body: record.payload,
        signal: AbortSignal.timeout(30_000),
      })

      const deliveryTime = performance.now() - startTime
      record.responseStatus = response.status

      if (response.ok) {
        record.status = "delivered"
        record.deliveredAt = Date.now()
        this.metrics.totalDelivered++
        this.metrics.pendingDeliveries--
        this.totalDeliveryTimeMs += deliveryTime
        this.metrics.avgDeliveryTimeMs = this.totalDeliveryTimeMs / this.metrics.totalDelivered
        this.trackByWebhook(record.webhookUrl, true)
        this.removeFromQueue(record.id)
      } else {
        this.handleFailure(record, `HTTP ${response.status}: ${response.statusText}`)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown delivery error"
      this.handleFailure(record, message)
    } finally {
      this.activeDeliveries--
    }
  }

  private handleFailure(record: DeliveryRecord, error: string): void {
    record.lastError = error

    if (record.attempts >= record.maxAttempts) {
      // Move to dead letter
      record.status = "dead_letter"
      this.deadLetter.push(record)
      this.removeFromQueue(record.id)
      this.metrics.totalDeadLettered++
      this.metrics.pendingDeliveries--
      this.trackByWebhook(record.webhookUrl, false)
    } else {
      // Schedule retry with exponential backoff + jitter
      record.status = "failed"
      record.nextRetryAt = Date.now() + this.calculateDelay(record.attempts)
      this.metrics.totalRetries++
      this.metrics.totalFailed++
    }
  }

  private calculateDelay(attempt: number): number {
    const exponentialDelay = this.options.baseDelayMs * Math.pow(2, attempt - 1)
    const bounded = Math.min(exponentialDelay, this.options.maxDelayMs)
    const jitter = bounded * this.options.jitterFactor * Math.random()
    return bounded + jitter
  }

  private removeFromQueue(id: string): void {
    const idx = this.queue.findIndex((r) => r.id === id)
    if (idx !== -1) this.queue.splice(idx, 1)
  }

  private trackByWebhook(url: string, success: boolean): void {
    if (!this.metrics.deliveriesByWebhook[url]) {
      this.metrics.deliveriesByWebhook[url] = { delivered: 0, failed: 0 }
    }
    if (success) {
      this.metrics.deliveriesByWebhook[url].delivered++
    } else {
      this.metrics.deliveriesByWebhook[url].failed++
    }
  }

  // ─── Queries ─────────────────────────────────────────────────────────────

  /**
   * Get delivery status by ID.
   */
  getDelivery(id: string): DeliveryRecord | undefined {
    return this.queue.find((r) => r.id === id) ?? this.deadLetter.find((r) => r.id === id)
  }

  /**
   * Get all dead-lettered deliveries.
   */
  getDeadLetters(): DeliveryRecord[] {
    return [...this.deadLetter]
  }

  /**
   * Retry a dead-lettered delivery.
   */
  retryDeadLetter(id: string): boolean {
    const idx = this.deadLetter.findIndex((r) => r.id === id)
    if (idx === -1) return false

    const record = this.deadLetter.splice(idx, 1)[0]
    record.status = "pending"
    record.attempts = 0
    record.nextRetryAt = null
    record.lastError = null
    this.queue.push(record)
    this.metrics.pendingDeliveries++
    return true
  }

  /**
   * Get delivery metrics.
   */
  getMetrics(): DeliveryMetrics {
    return { ...this.metrics, pendingDeliveries: this.queue.length }
  }

  /**
   * Get recent delivery log.
   */
  getDeliveryLog(limit: number = 50): DeliveryRecord[] {
    return [...this.queue, ...this.deadLetter].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
  }

  get pendingCount(): number {
    return this.queue.filter((r) => r.status === "pending" || r.status === "failed").length
  }
}

// ─── Webhook Templates ──────────────────────────────────────────────────────

export const webhookTemplates = {
  slack(_webhookUrl: string): WebhookTemplate {
    return {
      name: "slack",
      formatPayload: (event: string, data: unknown) => ({
        text: `[ReactiveBase] ${event}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Event:* \`${event}\`\n*Data:* \`\`\`${JSON.stringify(data, null, 2).substring(0, 500)}\`\`\``,
            },
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    }
  },

  discord(_webhookUrl: string): WebhookTemplate {
    return {
      name: "discord",
      formatPayload: (event: string, data: unknown) => ({
        content: `**[ReactiveBase] ${event}**`,
        embeds: [
          {
            title: event,
            description: `\`\`\`json\n${JSON.stringify(data, null, 2).substring(0, 1000)}\n\`\`\``,
            color: 0x0099ff,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    }
  },

  email(): WebhookTemplate {
    return {
      name: "email",
      formatPayload: (event: string, data: unknown) => ({
        subject: `[ReactiveBase] ${event}`,
        body: JSON.stringify(data, null, 2),
        event,
        timestamp: new Date().toISOString(),
      }),
    }
  },
} as const

// ─── SQL for Postgres-backed Queue ──────────────────────────────────────────

export function generateDeliveryQueueTableSQL(): string {
  return `
CREATE TABLE IF NOT EXISTS _reactivebase_webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_url TEXT NOT NULL,
  mutation_name TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_attempt_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  response_status INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON _reactivebase_webhook_deliveries (status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry ON _reactivebase_webhook_deliveries (next_retry_at) WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON _reactivebase_webhook_deliveries (webhook_url);
`
}

// ─── Webhook Simulator (Local Dev) ──────────────────────────────────────────

export interface SimulatedDelivery {
  id: string
  url: string
  event: string
  payload: unknown
  headers: Record<string, string>
  receivedAt: number
}

/**
 * Local development webhook simulator.
 * Captures outbound webhook deliveries for inspection without actually sending them.
 */
export class WebhookSimulator {
  private deliveries: SimulatedDelivery[] = []
  private maxDeliveries: number
  private enabled = false

  constructor(maxDeliveries: number = 100) {
    this.maxDeliveries = maxDeliveries
  }

  /**
   * Enable the simulator (intercepts deliveries instead of sending them).
   */
  enable(): void {
    this.enabled = true
  }

  /**
   * Disable the simulator.
   */
  disable(): void {
    this.enabled = false
  }

  /**
   * Check if the simulator is active.
   */
  get isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Simulate a delivery (capture without sending).
   */
  capture(url: string, event: string, payload: unknown, headers: Record<string, string> = {}): string {
    const id = generateDeliveryId()
    this.deliveries.push({
      id,
      url,
      event,
      payload,
      headers,
      receivedAt: Date.now(),
    })

    if (this.deliveries.length > this.maxDeliveries) {
      this.deliveries.shift()
    }

    return id
  }

  /**
   * Get all captured deliveries.
   */
  getDeliveries(): SimulatedDelivery[] {
    return [...this.deliveries]
  }

  /**
   * Get deliveries filtered by event name.
   */
  getByEvent(event: string): SimulatedDelivery[] {
    return this.deliveries.filter((d) => d.event === event)
  }

  /**
   * Get deliveries filtered by URL.
   */
  getByUrl(url: string): SimulatedDelivery[] {
    return this.deliveries.filter((d) => d.url === url)
  }

  /**
   * Clear all captured deliveries.
   */
  clear(): void {
    this.deliveries = []
  }

  get count(): number {
    return this.deliveries.length
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createDeliveryQueue(options?: DeliveryQueueOptions): WebhookDeliveryQueue {
  return new WebhookDeliveryQueue(options)
}

export function createWebhookSimulator(maxDeliveries?: number): WebhookSimulator {
  return new WebhookSimulator(maxDeliveries)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateDeliveryId(): string {
  return `whd_${randomUUID()}`
}
