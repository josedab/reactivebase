/**
 * Reactive Rate Limiting & Usage Metering.
 *
 * Per-user, per-tenant, and per-query rate limiting with sliding window
 * and token bucket algorithms. Usage metering pipeline tracking query
 * executions, mutation counts, subscription-seconds, and bytes transferred.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type RateLimitAlgorithm = "sliding_window" | "token_bucket"
export type RateLimitScope = "user" | "tenant" | "query" | "global" | "ip"

export interface RateLimitRule {
  /** Unique rule name */
  name: string
  /** Algorithm to use */
  algorithm: RateLimitAlgorithm
  /** Scope of rate limiting */
  scope: RateLimitScope
  /** Max requests allowed in window (sliding_window) or bucket capacity (token_bucket) */
  limit: number
  /** Window size in ms (sliding_window) or refill interval (token_bucket) */
  windowMs: number
  /** Refill rate per interval (token_bucket only) */
  refillRate?: number
  /** Optional: only apply to specific function types */
  functionTypes?: Array<"query" | "mutation" | "action">
  /** Optional: only apply to specific function names */
  functionNames?: string[]
  /** Custom key extractor */
  keyExtractor?: (ctx: RateLimitContext) => string
}

export interface RateLimitContext {
  userId?: string
  tenantId?: string
  functionName: string
  functionType: "query" | "mutation" | "action"
  ip?: string
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  resetAt: number
  retryAfterMs?: number
  rule: string
}

export interface TokenBucketState {
  tokens: number
  lastRefill: number
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class AdvancedRateLimitError extends Error {
  readonly code = "RATE_LIMITED"
  readonly statusCode = 429

  constructor(
    public readonly rule: string,
    public readonly retryAfterMs: number,
    public readonly scope: RateLimitScope,
  ) {
    super(`Rate limit exceeded (rule: "${rule}", scope: ${scope}). Retry after ${Math.ceil(retryAfterMs / 1000)}s`)
    this.name = "AdvancedRateLimitError"
  }
}

// ─── Sliding Window Limiter ──────────────────────────────────────────────────

/**
 * Sliding window rate limiter using a sorted timestamp array.
 * More accurate than fixed window, handles burst at window boundaries.
 */
export class SlidingWindowLimiter {
  private windows = new Map<string, number[]>()

  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  check(key: string): RateLimitResult {
    const now = Date.now()
    const windowStart = now - this.windowMs

    let timestamps = this.windows.get(key) ?? []

    // Remove expired entries
    timestamps = timestamps.filter((t) => t > windowStart)

    if (timestamps.length >= this.limit) {
      const oldestInWindow = timestamps[0]
      const resetAt = oldestInWindow + this.windowMs
      return {
        allowed: false,
        remaining: 0,
        limit: this.limit,
        resetAt,
        retryAfterMs: resetAt - now,
        rule: "",
      }
    }

    timestamps.push(now)
    this.windows.set(key, timestamps)

    return {
      allowed: true,
      remaining: this.limit - timestamps.length,
      limit: this.limit,
      resetAt: now + this.windowMs,
      rule: "",
    }
  }

  reset(key: string): void {
    this.windows.delete(key)
  }

  cleanup(): void {
    const now = Date.now()
    for (const [key, timestamps] of this.windows) {
      const valid = timestamps.filter((t) => t > now - this.windowMs)
      if (valid.length === 0) {
        this.windows.delete(key)
      } else {
        this.windows.set(key, valid)
      }
    }
  }
}

// ─── Token Bucket Limiter ────────────────────────────────────────────────────

/**
 * Token bucket rate limiter.
 * Allows burst traffic up to bucket capacity, then enforces steady rate.
 */
export class TokenBucketLimiter {
  private buckets = new Map<string, TokenBucketState>()

  constructor(
    private capacity: number,
    private refillRate: number,
    private refillIntervalMs: number,
  ) {}

  check(key: string): RateLimitResult {
    const now = Date.now()
    let bucket = this.buckets.get(key)

    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: now }
      this.buckets.set(key, bucket)
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill
    const tokensToAdd = Math.floor(elapsed / this.refillIntervalMs) * this.refillRate
    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(this.capacity, bucket.tokens + tokensToAdd)
      bucket.lastRefill = now
    }

    if (bucket.tokens < 1) {
      const timeForNextToken = this.refillIntervalMs - (elapsed % this.refillIntervalMs)
      return {
        allowed: false,
        remaining: 0,
        limit: this.capacity,
        resetAt: now + timeForNextToken,
        retryAfterMs: timeForNextToken,
        rule: "",
      }
    }

    bucket.tokens--
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      limit: this.capacity,
      resetAt: now + this.refillIntervalMs,
      rule: "",
    }
  }

  reset(key: string): void {
    this.buckets.delete(key)
  }

  cleanup(): void {
    const now = Date.now()
    const expiry = this.refillIntervalMs * this.capacity
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > expiry) {
        this.buckets.delete(key)
      }
    }
  }
}

// ─── Rate Limit Engine ──────────────────────────────────────────────────────

/**
 * Multi-rule rate limiting engine.
 * Evaluates all matching rules and returns the most restrictive result.
 */
export class RateLimitEngine {
  private rules: RateLimitRule[] = []
  private slidingLimiters = new Map<string, SlidingWindowLimiter>()
  private tokenBucketLimiters = new Map<string, TokenBucketLimiter>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000)
  }

  /**
   * Add a rate limit rule.
   */
  addRule(rule: RateLimitRule): void {
    this.rules.push(rule)

    if (rule.algorithm === "sliding_window") {
      this.slidingLimiters.set(rule.name, new SlidingWindowLimiter(rule.limit, rule.windowMs))
    } else {
      this.tokenBucketLimiters.set(rule.name, new TokenBucketLimiter(rule.limit, rule.refillRate ?? 1, rule.windowMs))
    }
  }

  /**
   * Check all applicable rules for a request.
   * Throws AdvancedRateLimitError if any rule denies the request.
   */
  check(ctx: RateLimitContext): RateLimitResult[] {
    const results: RateLimitResult[] = []

    for (const rule of this.rules) {
      if (!this.ruleApplies(rule, ctx)) continue

      const key = this.buildKey(rule, ctx)
      const result = this.checkRule(rule, key)
      result.rule = rule.name
      results.push(result)

      if (!result.allowed) {
        throw new AdvancedRateLimitError(rule.name, result.retryAfterMs ?? 0, rule.scope)
      }
    }

    return results
  }

  /**
   * Get current state for a context (without consuming a request).
   */
  peek(ctx: RateLimitContext): RateLimitResult[] {
    const results: RateLimitResult[] = []

    for (const rule of this.rules) {
      if (!this.ruleApplies(rule, ctx)) continue

      const key = this.buildKey(rule, ctx)

      if (rule.algorithm === "sliding_window") {
        const limiter = this.slidingLimiters.get(rule.name)
        if (limiter) {
          // Peek without consuming
          const result = limiter.check(key)
          if (result.allowed) {
            limiter.reset(key) // Undo the check
          }
          results.push({ ...result, rule: rule.name })
        }
      }
    }

    return results
  }

  /**
   * Stop cleanup timer.
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  private ruleApplies(rule: RateLimitRule, ctx: RateLimitContext): boolean {
    if (rule.functionTypes && !rule.functionTypes.includes(ctx.functionType)) return false
    if (rule.functionNames && !rule.functionNames.includes(ctx.functionName)) return false
    if (rule.scope === "user" && !ctx.userId) return false
    if (rule.scope === "tenant" && !ctx.tenantId) return false
    if (rule.scope === "ip" && !ctx.ip) return false
    return true
  }

  private buildKey(rule: RateLimitRule, ctx: RateLimitContext): string {
    if (rule.keyExtractor) return rule.keyExtractor(ctx)

    switch (rule.scope) {
      case "user":
        return `user:${ctx.userId}`
      case "tenant":
        return `tenant:${ctx.tenantId}`
      case "query":
        return `query:${ctx.functionName}`
      case "ip":
        return `ip:${ctx.ip}`
      case "global":
        return "global"
    }
  }

  private checkRule(rule: RateLimitRule, key: string): RateLimitResult {
    if (rule.algorithm === "sliding_window") {
      const limiter = this.slidingLimiters.get(rule.name)!
      return limiter.check(key)
    } else {
      const limiter = this.tokenBucketLimiters.get(rule.name)!
      return limiter.check(key)
    }
  }

  private cleanup(): void {
    for (const limiter of this.slidingLimiters.values()) limiter.cleanup()
    for (const limiter of this.tokenBucketLimiters.values()) limiter.cleanup()
  }
}

// ─── Usage Metering ──────────────────────────────────────────────────────────

export interface UsageMetrics {
  /** Total query executions */
  queryExecutions: number
  /** Total mutation executions */
  mutationExecutions: number
  /** Total action executions */
  actionExecutions: number
  /** Active subscription-seconds (cumulative) */
  subscriptionSeconds: number
  /** Total bytes transferred */
  bytesTransferred: number
  /** Breakdown by tenant */
  byTenant: Record<string, TenantUsage>
  /** Breakdown by function */
  byFunction: Record<string, FunctionUsage>
  /** Period start */
  periodStart: number
  /** Period end (current time) */
  periodEnd: number
}

export interface TenantUsage {
  tenantId: string
  queryExecutions: number
  mutationExecutions: number
  actionExecutions: number
  subscriptionSeconds: number
  bytesTransferred: number
}

export interface FunctionUsage {
  functionName: string
  functionType: "query" | "mutation" | "action"
  executions: number
  totalLatencyMs: number
  avgLatencyMs: number
  bytesTransferred: number
}

export interface UsageAlert {
  tenantId: string
  metric: string
  threshold: number
  currentValue: number
  triggeredAt: number
}

export interface UsageAlertRule {
  /** Metric to watch */
  metric: "queryExecutions" | "mutationExecutions" | "subscriptionSeconds" | "bytesTransferred"
  /** Threshold value */
  threshold: number
  /** Per-tenant or global */
  scope: "tenant" | "global"
  /** Callback when threshold is exceeded */
  onAlert: (alert: UsageAlert) => void
}

/**
 * Usage metering pipeline that tracks per-tenant resource consumption.
 */
export class UsageMeter {
  private metrics: UsageMetrics
  private alertRules: UsageAlertRule[] = []
  private activeSubscriptions = new Map<string, { startedAt: number; tenantId?: string }>()

  constructor() {
    this.metrics = this.createEmptyMetrics()
  }

  /**
   * Record a function execution.
   */
  recordExecution(
    functionName: string,
    functionType: "query" | "mutation" | "action",
    latencyMs: number,
    bytesTransferred: number = 0,
    tenantId?: string,
  ): void {
    // Global metrics
    switch (functionType) {
      case "query":
        this.metrics.queryExecutions++
        break
      case "mutation":
        this.metrics.mutationExecutions++
        break
      case "action":
        this.metrics.actionExecutions++
        break
    }
    this.metrics.bytesTransferred += bytesTransferred

    // Per-tenant
    if (tenantId) {
      if (!this.metrics.byTenant[tenantId]) {
        this.metrics.byTenant[tenantId] = {
          tenantId,
          queryExecutions: 0,
          mutationExecutions: 0,
          actionExecutions: 0,
          subscriptionSeconds: 0,
          bytesTransferred: 0,
        }
      }
      const tenant = this.metrics.byTenant[tenantId]
      switch (functionType) {
        case "query":
          tenant.queryExecutions++
          break
        case "mutation":
          tenant.mutationExecutions++
          break
        case "action":
          tenant.actionExecutions++
          break
      }
      tenant.bytesTransferred += bytesTransferred
    }

    // Per-function
    if (!this.metrics.byFunction[functionName]) {
      this.metrics.byFunction[functionName] = {
        functionName,
        functionType,
        executions: 0,
        totalLatencyMs: 0,
        avgLatencyMs: 0,
        bytesTransferred: 0,
      }
    }
    const fn = this.metrics.byFunction[functionName]
    fn.executions++
    fn.totalLatencyMs += latencyMs
    fn.avgLatencyMs = fn.totalLatencyMs / fn.executions
    fn.bytesTransferred += bytesTransferred

    // Check alerts
    this.checkAlerts(tenantId)
  }

  /**
   * Track a subscription start.
   */
  subscriptionStarted(subscriptionId: string, tenantId?: string): void {
    this.activeSubscriptions.set(subscriptionId, { startedAt: Date.now(), tenantId })
  }

  /**
   * Track a subscription end.
   */
  subscriptionEnded(subscriptionId: string): void {
    const sub = this.activeSubscriptions.get(subscriptionId)
    if (!sub) return

    const seconds = (Date.now() - sub.startedAt) / 1000
    this.metrics.subscriptionSeconds += seconds

    if (sub.tenantId && this.metrics.byTenant[sub.tenantId]) {
      this.metrics.byTenant[sub.tenantId].subscriptionSeconds += seconds
    }

    this.activeSubscriptions.delete(subscriptionId)
  }

  /**
   * Add a usage alert rule.
   */
  addAlertRule(rule: UsageAlertRule): void {
    this.alertRules.push(rule)
  }

  /**
   * Get current usage metrics.
   */
  getMetrics(): UsageMetrics {
    return {
      ...this.metrics,
      periodEnd: Date.now(),
    }
  }

  /**
   * Get usage for a specific tenant.
   */
  getTenantUsage(tenantId: string): TenantUsage | null {
    return this.metrics.byTenant[tenantId] ?? null
  }

  /**
   * Reset metrics for a new billing period.
   */
  resetPeriod(): UsageMetrics {
    const snapshot = { ...this.metrics, periodEnd: Date.now() }
    this.metrics = this.createEmptyMetrics()
    return snapshot
  }

  /**
   * Get billing-ready data for a tenant.
   */
  getBillingData(tenantId: string): {
    usage: TenantUsage | null
    periodStart: number
    periodEnd: number
  } {
    return {
      usage: this.metrics.byTenant[tenantId] ?? null,
      periodStart: this.metrics.periodStart,
      periodEnd: Date.now(),
    }
  }

  private checkAlerts(tenantId?: string): void {
    for (const rule of this.alertRules) {
      let currentValue: number

      if (rule.scope === "tenant" && tenantId) {
        const tenant = this.metrics.byTenant[tenantId]
        if (!tenant) continue
        currentValue = tenant[rule.metric as keyof TenantUsage] as number
      } else if (rule.scope === "global") {
        currentValue = this.metrics[rule.metric as keyof UsageMetrics] as number
      } else {
        continue
      }

      if (currentValue >= rule.threshold) {
        rule.onAlert({
          tenantId: tenantId ?? "global",
          metric: rule.metric,
          threshold: rule.threshold,
          currentValue,
          triggeredAt: Date.now(),
        })
      }
    }
  }

  private createEmptyMetrics(): UsageMetrics {
    return {
      queryExecutions: 0,
      mutationExecutions: 0,
      actionExecutions: 0,
      subscriptionSeconds: 0,
      bytesTransferred: 0,
      byTenant: {},
      byFunction: {},
      periodStart: Date.now(),
      periodEnd: Date.now(),
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createRateLimitEngine(): RateLimitEngine {
  return new RateLimitEngine()
}

export function createUsageMeter(): UsageMeter {
  return new UsageMeter()
}
