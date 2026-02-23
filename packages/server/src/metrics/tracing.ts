/**
 * Tracing instrumentation for ReactiveBase.
 * Provides an abstract tracer interface that can be backed by OpenTelemetry
 * or any other tracing system. No hard dependency on @opentelemetry/api.
 */

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void
  setStatus(status: "ok" | "error", message?: string): void
  end(): void
}

export interface Tracer {
  startSpan(name: string, attributes?: Record<string, string | number | boolean>): Span
}

/**
 * No-op tracer for when tracing is not configured.
 */
export class NoopTracer implements Tracer {
  startSpan(): Span {
    return {
      setAttribute() {},
      setStatus() {},
      end() {},
    }
  }
}

/**
 * Simple console tracer for development.
 */
export class ConsoleTracer implements Tracer {
  startSpan(name: string, attributes?: Record<string, string | number | boolean>): Span {
    const startTime = performance.now()
    const attrs: Record<string, string | number | boolean> = { ...attributes }

    return {
      setAttribute(key, value) {
        attrs[key] = value
      },
      setStatus(status, message) {
        attrs["status"] = status
        if (message) attrs["status.message"] = message
      },
      end() {
        const duration = (performance.now() - startTime).toFixed(2)
        console.log(
          JSON.stringify({
            trace: name,
            duration_ms: parseFloat(duration),
            ...attrs,
            timestamp: new Date().toISOString(),
          }),
        )
      },
    }
  }
}

/**
 * Adapter that wraps an OpenTelemetry Tracer to our interface.
 * Pass the result of `trace.getTracer("reactivebase")` from @opentelemetry/api.
 */
export function createOtelTracerAdapter(otelTracer: OtelTracerLike): Tracer {
  return {
    startSpan(name, attributes) {
      const span = otelTracer.startSpan(name, {
        attributes: attributes as Record<string, string | number | boolean>,
      })

      return {
        setAttribute(key, value) {
          span.setAttribute(key, value)
        },
        setStatus(status, message) {
          span.setStatus({
            code: status === "ok" ? 1 : 2,
            message,
          })
        },
        end() {
          span.end()
        },
      }
    },
  }
}

/** Minimal OpenTelemetry Tracer interface for loose coupling */
export interface OtelTracerLike {
  startSpan(
    name: string,
    options?: {
      attributes?: Record<string, string | number | boolean>
    },
  ): OtelSpanLike
}

export interface OtelSpanLike {
  setAttribute(key: string, value: string | number | boolean): void
  setStatus(status: { code: number; message?: string }): void
  end(): void
}

/**
 * Instrument a function with tracing.
 */
export function traced<T>(
  tracer: Tracer,
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  const span = tracer.startSpan(name, attributes)

  return fn().then(
    (result) => {
      span.setStatus("ok")
      span.end()
      return result
    },
    (error) => {
      span.setStatus("error", error instanceof Error ? error.message : String(error))
      span.end()
      throw error
    },
  )
}
