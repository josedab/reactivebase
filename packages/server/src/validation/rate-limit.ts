/**
 * Rate limiting middleware for ReactiveBase.
 * Uses a sliding window counter with in-memory storage.
 */

import type { Middleware, MiddlewareContext } from "../middleware/index.js"

export interface RateLimitOptions {
  /** Max requests per window (default: 100) */
  limit: number
  /** Window duration in ms (default: 60_000 = 1 minute) */
  window?: number
  /** Key extractor: determines what to rate limit by (default: userId or connectionId) */
  keyBy?: (ctx: MiddlewareContext) => string
  /** Function types to rate limit (default: all) */
  functionTypes?: Array<"query" | "mutation" | "action">
}

interface WindowEntry {
  count: number
  resetAt: number
}

export class RateLimiter {
  private windows = new Map<string, WindowEntry>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(private options: RateLimitOptions) {
    // Periodic cleanup of expired windows
    this.cleanupTimer = setInterval(() => this.cleanup(), (options.window ?? 60_000) * 2)
  }

  /**
   * Check if a request should be allowed.
   * Returns remaining count or throws if limit exceeded.
   */
  check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const window = this.options.window ?? 60_000
    const now = Date.now()

    let entry = this.windows.get(key)

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + window }
      this.windows.set(key, entry)
    }

    entry.count++

    if (entry.count > this.options.limit) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt }
    }

    return {
      allowed: true,
      remaining: this.options.limit - entry.count,
      resetAt: entry.resetAt,
    }
  }

  /**
   * Reset a specific key's counter.
   */
  reset(key: string): void {
    this.windows.delete(key)
  }

  /**
   * Stop the cleanup timer.
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.windows) {
      if (now >= entry.resetAt) this.windows.delete(key)
    }
  }
}

export class RateLimitError extends Error {
  readonly code = "RATE_LIMITED"
  readonly statusCode = 429

  constructor(public readonly retryAfterMs: number) {
    super(`Rate limit exceeded. Retry after ${Math.ceil(retryAfterMs / 1000)}s`)
    this.name = "RateLimitError"
  }
}

/**
 * Create a rate limiting middleware.
 */
export function rateLimit(options: RateLimitOptions): Middleware {
  const limiter = new RateLimiter(options)
  const types = options.functionTypes ?? ["query", "mutation", "action"]

  return {
    name: "rate-limit",
    before(ctx) {
      if (!types.includes(ctx.functionType)) return

      const key = options.keyBy ? options.keyBy(ctx) : (ctx.auth.userId ?? "anonymous")

      const result = limiter.check(key)
      if (!result.allowed) {
        throw new RateLimitError(result.resetAt - Date.now())
      }

      return { state: { _rateLimit_remaining: result.remaining } }
    },
  }
}
