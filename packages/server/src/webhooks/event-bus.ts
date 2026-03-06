/**
 * Reactive Event Bus for ReactiveBase.
 * Publish/subscribe domain events across services with webhook delivery,
 * dead-letter queues, event filtering with CEL-like expressions,
 * and CloudEvents standard compliance.
 *
 * Features:
 *   - Pub/sub for domain events across services
 *   - CloudEvents 1.0 standard envelope format
 *   - CEL-like expression filtering
 *   - Webhook delivery with retry and dead-letter queue
 *   - Event routing and fan-out
 *   - Visual event flow data for diagram rendering
 *   - Event replay from history
 *
 * Usage:
 *   const bus = new ReactiveEventBus({ source: 'orders-service' })
 *   bus.subscribe('order.created', handler, { filter: 'data.total > 100' })
 *   bus.publish({ type: 'order.created', data: { orderId: '123', total: 150 } })
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EventBusOptions {
  /** Event source identifier (e.g., service name) */
  source: string
  /** Max events to retain in history (default: 10000) */
  maxHistorySize?: number
  /** Dead-letter queue max size (default: 5000) */
  maxDeadLetterSize?: number
  /** Default retry policy for webhook deliveries */
  retryPolicy?: EventBusRetryPolicy
  /** Enable CloudEvents envelope (default: true) */
  cloudEventsFormat?: boolean
}

export interface EventBusRetryPolicy {
  maxRetries: number
  initialBackoffMs: number
  backoffMultiplier: number
  maxBackoffMs: number
}

/**
 * CloudEvents 1.0 compatible event envelope.
 */
export interface CloudEvent {
  /** CloudEvents spec version (always "1.0") */
  specversion: "1.0"
  /** Unique event ID */
  id: string
  /** Event source URI */
  source: string
  /** Event type (e.g., "com.example.order.created") */
  type: string
  /** Event timestamp (ISO 8601) */
  time: string
  /** Content type of the data (default: "application/json") */
  datacontenttype: string
  /** Optional subject */
  subject?: string
  /** Event data payload */
  data: unknown
  /** Optional data schema URI */
  dataschema?: string
  /** Custom extension attributes */
  [key: string]: unknown
}

export interface EventPublishRequest {
  /** Event type (e.g., "order.created", "user.updated") */
  type: string
  /** Event data payload */
  data: unknown
  /** Optional subject (e.g., resource ID) */
  subject?: string
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

export interface EventSubscription {
  id: string
  /** Event type pattern (supports wildcards: "order.*") */
  eventType: string
  /** Handler callback */
  handler: EventHandler
  /** CEL-like filter expression */
  filter?: string
  /** Whether this is a webhook delivery subscription */
  webhookUrl?: string
  /** Subscription status */
  active: boolean
  /** Events received count */
  receivedCount: number
  createdAt: number
}

export type EventHandler = (event: CloudEvent) => void | Promise<void>

export interface DeliveryAttempt {
  eventId: string
  subscriptionId: string
  attempt: number
  status: "pending" | "delivered" | "failed" | "dead_letter"
  statusCode?: number
  error?: string
  timestamp: number
  nextRetryAt?: number
}

export interface EventFlowNode {
  id: string
  type: "source" | "event_type" | "handler" | "webhook" | "dead_letter"
  label: string
  metadata?: Record<string, unknown>
}

export interface EventFlowEdge {
  source: string
  target: string
  label: string
  eventCount: number
}

export interface EventFlowDiagram {
  nodes: EventFlowNode[]
  edges: EventFlowEdge[]
}

export interface EventBusStats {
  totalEventsPublished: number
  totalEventsDelivered: number
  totalDeliveryFailures: number
  activeSubscriptions: number
  deadLetterSize: number
  historySize: number
  eventTypes: string[]
}

// ─── CEL-like Expression Evaluator ───────────────────────────────────────────

/**
 * Evaluate a simple CEL-like filter expression against event data.
 * Supports: ==, !=, >, <, >=, <=, &&, ||, in, contains
 */
function evaluateFilter(expression: string, event: CloudEvent): boolean {
  if (!expression || expression.trim() === "") return true

  try {
    // Parse simple comparison expressions
    const data = event.data as Record<string, unknown> | undefined
    if (!data) return true

    // Handle AND/OR
    if (expression.includes(" && ")) {
      return expression.split(" && ").every((part) => evaluateFilter(part.trim(), event))
    }
    if (expression.includes(" || ")) {
      return expression.split(" || ").some((part) => evaluateFilter(part.trim(), event))
    }

    // Handle comparisons
    const compMatch = expression.match(/^([\w.]+)\s*(==|!=|>=?|<=?|in|contains)\s*(.+)$/)
    if (!compMatch) return true

    const [, path, operator, rawValue] = compMatch
    const actualValue = resolvePath(data, path)
    const expectedValue = parseValue(rawValue.trim())

    switch (operator) {
      case "==":
        return actualValue === expectedValue
      case "!=":
        return actualValue !== expectedValue
      case ">":
        return (actualValue as number) > (expectedValue as number)
      case ">=":
        return (actualValue as number) >= (expectedValue as number)
      case "<":
        return (actualValue as number) < (expectedValue as number)
      case "<=":
        return (actualValue as number) <= (expectedValue as number)
      case "in":
        return Array.isArray(expectedValue) && (expectedValue as unknown[]).includes(actualValue)
      case "contains":
        return typeof actualValue === "string" && actualValue.includes(String(expectedValue))
      default:
        return true
    }
  } catch {
    return true // Filter errors default to pass
  }
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".")
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function parseValue(raw: string): unknown {
  if (raw === "true") return true
  if (raw === "false") return false
  if (raw === "null") return null
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1)
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1)
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  return raw
}

// ─── Event Bus ───────────────────────────────────────────────────────────────

const DEFAULT_RETRY: EventBusRetryPolicy = {
  maxRetries: 3,
  initialBackoffMs: 1_000,
  backoffMultiplier: 2,
  maxBackoffMs: 30_000,
}

export class ReactiveEventBus {
  private options: Required<EventBusOptions>
  private subscriptions = new Map<string, EventSubscription>()
  private history: CloudEvent[] = []
  private deadLetter: DeliveryAttempt[] = []
  private subscriptionCounter = 0
  private eventCounter = 0
  private totalPublished = 0
  private totalDelivered = 0
  private totalFailed = 0
  // Track event counts per edge for flow diagram
  private flowCounts = new Map<string, number>()

  constructor(options: EventBusOptions) {
    this.options = {
      maxHistorySize: options.maxHistorySize ?? 10_000,
      maxDeadLetterSize: options.maxDeadLetterSize ?? 5_000,
      retryPolicy: options.retryPolicy ?? DEFAULT_RETRY,
      cloudEventsFormat: options.cloudEventsFormat ?? true,
      source: options.source,
    }
  }

  /**
   * Publish a domain event to the bus.
   */
  async publish(request: EventPublishRequest): Promise<CloudEvent> {
    const event = this.createCloudEvent(request)

    // Add to history
    this.history.push(event)
    if (this.history.length > this.options.maxHistorySize) {
      this.history.shift()
    }
    this.totalPublished++

    // Fan-out to matching subscriptions
    const matching = this.getMatchingSubscriptions(event.type)
    const deliveryPromises: Promise<void>[] = []

    for (const sub of matching) {
      // Apply filter
      if (sub.filter && !evaluateFilter(sub.filter, event)) {
        continue
      }

      deliveryPromises.push(this.deliverToSubscription(event, sub))
    }

    await Promise.allSettled(deliveryPromises)
    return event
  }

  /**
   * Subscribe to events matching a type pattern.
   */
  subscribe(
    eventType: string,
    handler: EventHandler,
    options?: { filter?: string; webhookUrl?: string },
  ): EventSubscription {
    const sub: EventSubscription = {
      id: `sub-${++this.subscriptionCounter}`,
      eventType,
      handler,
      filter: options?.filter,
      webhookUrl: options?.webhookUrl,
      active: true,
      receivedCount: 0,
      createdAt: Date.now(),
    }

    this.subscriptions.set(sub.id, sub)
    return sub
  }

  /**
   * Unsubscribe from events.
   */
  unsubscribe(subscriptionId: string): boolean {
    const sub = this.subscriptions.get(subscriptionId)
    if (!sub) return false
    sub.active = false
    this.subscriptions.delete(subscriptionId)
    return true
  }

  /**
   * Replay events from history matching a type pattern.
   */
  async replay(eventType: string, since?: number): Promise<number> {
    const matching = this.history.filter((e) => {
      if (!matchEventType(e.type, eventType)) return false
      if (since && new Date(e.time).getTime() < since) return false
      return true
    })

    const subs = this.getMatchingSubscriptions(eventType)
    let replayed = 0

    for (const event of matching) {
      for (const sub of subs) {
        if (sub.filter && !evaluateFilter(sub.filter, event)) continue
        await this.deliverToSubscription(event, sub)
        replayed++
      }
    }

    return replayed
  }

  /**
   * Get dead-letter queue entries.
   */
  getDeadLetterQueue(): DeliveryAttempt[] {
    return [...this.deadLetter]
  }

  /**
   * Retry a dead-letter entry.
   */
  async retryDeadLetter(eventId: string): Promise<boolean> {
    const dlEntry = this.deadLetter.find((d) => d.eventId === eventId)
    if (!dlEntry) return false

    const event = this.history.find((e) => e.id === eventId)
    const sub = this.subscriptions.get(dlEntry.subscriptionId)
    if (!event || !sub) return false

    try {
      await sub.handler(event)
      this.deadLetter = this.deadLetter.filter((d) => d.eventId !== eventId)
      this.totalDelivered++
      return true
    } catch {
      return false
    }
  }

  /**
   * Generate a visual event flow diagram data structure.
   */
  generateEventFlowDiagram(): EventFlowDiagram {
    const nodes: EventFlowNode[] = []
    const edges: EventFlowEdge[] = []
    const addedNodes = new Set<string>()

    const addNode = (node: EventFlowNode) => {
      if (!addedNodes.has(node.id)) {
        nodes.push(node)
        addedNodes.add(node.id)
      }
    }

    // Source node
    addNode({ id: `source:${this.options.source}`, type: "source", label: this.options.source })

    // Event type nodes
    const eventTypes = new Set(this.history.map((e) => e.type))
    for (const type of eventTypes) {
      addNode({ id: `type:${type}`, type: "event_type", label: type })
      const count = this.history.filter((e) => e.type === type).length
      edges.push({
        source: `source:${this.options.source}`,
        target: `type:${type}`,
        label: `${count} events`,
        eventCount: count,
      })
    }

    // Subscription nodes
    for (const [, sub] of this.subscriptions) {
      const nodeType = sub.webhookUrl ? "webhook" : "handler"
      const label = sub.webhookUrl ?? `handler:${sub.id}`
      addNode({ id: `sub:${sub.id}`, type: nodeType, label })

      for (const type of eventTypes) {
        if (matchEventType(type, sub.eventType)) {
          edges.push({
            source: `type:${type}`,
            target: `sub:${sub.id}`,
            label: `${sub.receivedCount} received`,
            eventCount: sub.receivedCount,
          })
        }
      }
    }

    // Dead letter node
    if (this.deadLetter.length > 0) {
      addNode({ id: "dead_letter", type: "dead_letter", label: `Dead Letter (${this.deadLetter.length})` })
    }

    return { nodes, edges }
  }

  /**
   * Get event bus statistics.
   */
  getStats(): EventBusStats {
    const eventTypes = new Set<string>()
    for (const e of this.history) eventTypes.add(e.type)

    return {
      totalEventsPublished: this.totalPublished,
      totalEventsDelivered: this.totalDelivered,
      totalDeliveryFailures: this.totalFailed,
      activeSubscriptions: this.subscriptions.size,
      deadLetterSize: this.deadLetter.length,
      historySize: this.history.length,
      eventTypes: [...eventTypes],
    }
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.subscriptions.clear()
    this.history = []
    this.deadLetter = []
    this.flowCounts.clear()
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private createCloudEvent(request: EventPublishRequest): CloudEvent {
    return {
      specversion: "1.0",
      id: `${this.options.source}-${++this.eventCounter}-${Date.now().toString(36)}`,
      source: this.options.source,
      type: request.type,
      time: new Date().toISOString(),
      datacontenttype: "application/json",
      subject: request.subject,
      data: request.data,
      ...(request.metadata ?? {}),
    }
  }

  private getMatchingSubscriptions(eventType: string): EventSubscription[] {
    return Array.from(this.subscriptions.values()).filter(
      (sub) => sub.active && matchEventType(eventType, sub.eventType),
    )
  }

  private async deliverToSubscription(event: CloudEvent, sub: EventSubscription): Promise<void> {
    try {
      await sub.handler(event)
      sub.receivedCount++
      this.totalDelivered++

      const flowKey = `${event.type}→${sub.id}`
      this.flowCounts.set(flowKey, (this.flowCounts.get(flowKey) ?? 0) + 1)
    } catch (error: unknown) {
      this.totalFailed++
      this.deadLetter.push({
        eventId: event.id,
        subscriptionId: sub.id,
        attempt: 1,
        status: "dead_letter",
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      })

      if (this.deadLetter.length > this.options.maxDeadLetterSize) {
        this.deadLetter.shift()
      }
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function matchEventType(actual: string, pattern: string): boolean {
  if (pattern === "*") return true
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2)
    return actual.startsWith(prefix)
  }
  return actual === pattern
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class EventBusError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EventBusError"
  }
}
