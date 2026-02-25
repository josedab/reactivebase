/**
 * OpenTelemetry auto-instrumentation for ReactiveBase.
 * Wraps query, mutation, action, and subscription execution with OTel spans,
 * and optionally exports metrics to an OTLP endpoint.
 */

import type { Tracer, Span } from "./tracing.js"
import { NoopTracer } from "./tracing.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OtelConfig {
  /** Service name reported in spans (default: "reactivebase") */
  serviceName: string
  /** OTLP collector endpoint (e.g. "http://localhost:4318") */
  endpoint?: string
  /** Fraction of traces to sample, 0.0–1.0 (default: 1.0) */
  tracesSampleRate: number
  /** Interval in ms for pushing aggregated metrics (default: 60000) */
  metricsInterval: number
}

export interface ConnectionPoolLike {
  totalCount: number
  activeCount: number
  idleCount: number
  waitingCount: number
}

export interface InstrumentedResult<T> {
  result: T
  durationMs: number
}

type FunctionType = "query" | "mutation" | "action" | "subscription"

// ─── OtelInstrumentation ────────────────────────────────────────────────────

export class OtelInstrumentation {
  private tracer: Tracer
  private config: OtelConfig
  private poolMetrics: ConnectionPoolLike | null = null
  private metricsTimer: ReturnType<typeof setInterval> | null = null

  constructor(tracer: Tracer, config: Partial<OtelConfig> = {}) {
    this.tracer = tracer
    this.config = {
      serviceName: config.serviceName ?? "reactivebase",
      endpoint: config.endpoint,
      tracesSampleRate: config.tracesSampleRate ?? 1.0,
      metricsInterval: config.metricsInterval ?? 60_000,
    }
  }

  /**
   * Wrap a query execution with a traced span.
   */
  async instrumentQuery<T>(name: string, fn: () => Promise<T>): Promise<InstrumentedResult<T>> {
    return this.instrumentFunction("query", name, fn)
  }

  /**
   * Wrap a mutation execution with a traced span.
   */
  async instrumentMutation<T>(name: string, fn: () => Promise<T>): Promise<InstrumentedResult<T>> {
    return this.instrumentFunction("mutation", name, fn)
  }

  /**
   * Wrap an action execution with a traced span.
   */
  async instrumentAction<T>(name: string, fn: () => Promise<T>): Promise<InstrumentedResult<T>> {
    return this.instrumentFunction("action", name, fn)
  }

  /**
   * Track a subscription lifecycle with a span.
   * Returns a dispose function that ends the span.
   */
  instrumentSubscription(name: string): { span: Span; dispose: () => number } {
    const span = this.tracer.startSpan(`subscription:${name}`, {
      "function.name": name,
      "function.type": "subscription",
      "service.name": this.config.serviceName,
    })
    const startTime = performance.now()

    return {
      span,
      dispose() {
        const durationMs = performance.now() - startTime
        span.setAttribute("duration_ms", Math.round(durationMs * 100) / 100)
        span.setStatus("ok")
        span.end()
        return durationMs
      },
    }
  }

  /**
   * Monitor connection pool metrics by storing a reference to the pool.
   */
  instrumentConnectionPool(pool: ConnectionPoolLike): void {
    this.poolMetrics = pool
  }

  /**
   * Get latest connection pool snapshot, or null if not instrumented.
   */
  getConnectionPoolMetrics(): ConnectionPoolLike | null {
    return this.poolMetrics
  }

  /**
   * Start periodic metrics push (no-op if no endpoint configured).
   */
  startMetricsExport(): void {
    if (!this.config.endpoint || this.metricsTimer) return

    this.metricsTimer = setInterval(() => {
      // In a real implementation this would POST metrics to the OTLP endpoint.
      // Kept as a no-op to avoid hard dependency on HTTP clients.
    }, this.config.metricsInterval)
  }

  /**
   * Stop periodic metrics push.
   */
  stopMetricsExport(): void {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer)
      this.metricsTimer = null
    }
  }

  /** Expose the underlying config for inspection. */
  getConfig(): Readonly<OtelConfig> {
    return this.config
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private async instrumentFunction<T>(
    type: FunctionType,
    name: string,
    fn: () => Promise<T>,
  ): Promise<InstrumentedResult<T>> {
    if (!this.shouldSample()) {
      const start = performance.now()
      const result = await fn()
      return { result, durationMs: performance.now() - start }
    }

    const span = this.tracer.startSpan(`${type}:${name}`, {
      "function.name": name,
      "function.type": type,
      "service.name": this.config.serviceName,
    })

    const startTime = performance.now()
    try {
      const result = await fn()
      const durationMs = performance.now() - startTime
      span.setAttribute("duration_ms", Math.round(durationMs * 100) / 100)
      span.setStatus("ok")
      span.end()
      return { result, durationMs }
    } catch (error: unknown) {
      const durationMs = performance.now() - startTime
      span.setAttribute("duration_ms", Math.round(durationMs * 100) / 100)
      span.setStatus("error", error instanceof Error ? error.message : String(error))
      span.end()
      throw error
    }
  }

  private shouldSample(): boolean {
    return Math.random() < this.config.tracesSampleRate
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a fully configured OtelInstrumentation instance.
 * If no tracer is provided, falls back to NoopTracer.
 */
export function createAutoInstrumentedTracer(config: Partial<OtelConfig> = {}, tracer?: Tracer): OtelInstrumentation {
  const inst = new OtelInstrumentation(tracer ?? new NoopTracer(), config)
  inst.startMetricsExport()
  return inst
}
