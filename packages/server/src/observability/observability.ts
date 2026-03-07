/**
 * Observability & OpenTelemetry Deep Integration for ReactiveBase.
 * Full OTEL integration with auto-instrumented spans, subscription tracing,
 * CDC pipeline metrics, IVM cache metrics, Prometheus endpoint, and SLI/SLO tracking.
 *
 * Features:
 *   - Auto-instrumentation for queries, mutations, actions
 *   - Subscription lifecycle tracing (subscribe → update → unsubscribe)
 *   - CDC pipeline metrics (lag, throughput, errors)
 *   - IVM cache hit/miss rates
 *   - Prometheus /metrics endpoint
 *   - Grafana dashboard JSON templates
 *   - SLI/SLO framework with alerting
 *
 * Usage:
 *   const otel = new ReactiveBaseInstrumentation({ serviceName: 'my-app' })
 *   otel.instrument(server)
 *   app.get('/metrics', otel.metricsHandler())
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InstrumentationOptions {
  /** Service name for OTEL (default: "reactivebase") */
  serviceName?: string
  /** Service version */
  serviceVersion?: string
  /** Enable query/mutation tracing (default: true) */
  traceQueries?: boolean
  /** Enable subscription lifecycle tracing (default: true) */
  traceSubscriptions?: boolean
  /** Enable CDC pipeline metrics (default: true) */
  trackCdc?: boolean
  /** Enable IVM cache metrics (default: true) */
  trackIvmCache?: boolean
  /** Prometheus endpoint path (default: "/metrics") */
  metricsPath?: string
  /** Custom labels added to all metrics */
  customLabels?: Record<string, string>
  /** Histogram bucket boundaries for latency (ms) */
  latencyBuckets?: number[]
  /** Sample rate for traces (0-1, default: 1) */
  traceSampleRate?: number
}

export interface SpanContext {
  traceId: string
  spanId: string
  parentSpanId: string | null
  operationName: string
  startTime: number
  endTime: number | null
  status: "ok" | "error" | "unset"
  attributes: Record<string, string | number | boolean>
  events: SpanEvent[]
  children: SpanContext[]
}

export interface SpanEvent {
  name: string
  timestamp: number
  attributes?: Record<string, string | number | boolean>
}

export interface MetricValue {
  name: string
  type: "counter" | "gauge" | "histogram"
  value: number
  labels: Record<string, string>
  timestamp: number
}

export interface SliDefinition {
  /** SLI name (e.g., "query_latency_p99") */
  name: string
  /** SLI description */
  description: string
  /** Metric to track */
  metric: string
  /** Threshold value */
  threshold: number
  /** Comparison: whether metric should be below or above threshold */
  comparison: "below" | "above"
  /** Evaluation window in ms (default: 300000 = 5 min) */
  windowMs?: number
}

export interface SloDefinition {
  /** SLO name */
  name: string
  /** Target percentage (e.g., 99.9) */
  target: number
  /** SLI this SLO tracks */
  sliName: string
  /** Rolling window for SLO calculation (ms, default: 2592000000 = 30 days) */
  windowMs?: number
  /** Alert when error budget is below this percentage (default: 10) */
  alertBudgetPercentage?: number
}

export interface SloStatus {
  name: string
  target: number
  current: number
  withinBudget: boolean
  errorBudgetRemaining: number
  evaluatedAt: number
}

export interface PrometheusMetric {
  name: string
  help: string
  type: "counter" | "gauge" | "histogram" | "summary"
  values: Array<{ labels: Record<string, string>; value: number; timestamp?: number }>
  buckets?: Array<{ le: string; count: number }>
}

export interface GrafanaDashboard {
  title: string
  uid: string
  panels: GrafanaPanel[]
  templating: unknown
  time: { from: string; to: string }
}

export interface GrafanaPanel {
  title: string
  type: "timeseries" | "stat" | "gauge" | "table" | "heatmap"
  targets: Array<{ expr: string; legendFormat?: string }>
  gridPos: { h: number; w: number; x: number; y: number }
}

// ─── Auto-Instrumentation ────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<InstrumentationOptions> = {
  serviceName: "reactivebase",
  serviceVersion: "0.1.0",
  traceQueries: true,
  traceSubscriptions: true,
  trackCdc: true,
  trackIvmCache: true,
  metricsPath: "/metrics",
  customLabels: {},
  latencyBuckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  traceSampleRate: 1,
}

export class ReactiveBaseInstrumentation {
  private options: Required<InstrumentationOptions>
  private spans = new Map<string, SpanContext>()
  private counters = new Map<string, number>()
  private gauges = new Map<string, number>()
  private histograms = new Map<string, number[]>()
  private slis = new Map<string, SliDefinition>()
  private slos = new Map<string, SloDefinition>()
  private sliHistory = new Map<string, Array<{ value: number; timestamp: number }>>()
  private spanCounter = 0

  constructor(options?: InstrumentationOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.initDefaultMetrics()
  }

  // ─── Span Management ──────────────────────────────────────────────────────

  /**
   * Start a new trace span.
   */
  startSpan(
    operationName: string,
    attributes?: Record<string, string | number | boolean>,
    parentSpanId?: string,
  ): SpanContext {
    const span: SpanContext = {
      traceId: parentSpanId ? (this.spans.get(parentSpanId)?.traceId ?? this.generateId()) : this.generateId(),
      spanId: this.generateId(),
      parentSpanId: parentSpanId ?? null,
      operationName,
      startTime: Date.now(),
      endTime: null,
      status: "unset",
      attributes: { ...this.options.customLabels, ...attributes },
      events: [],
      children: [],
    }

    this.spans.set(span.spanId, span)

    if (parentSpanId) {
      const parent = this.spans.get(parentSpanId)
      if (parent) parent.children.push(span)
    }

    return span
  }

  /**
   * End a span and record its duration.
   */
  endSpan(spanId: string, status?: "ok" | "error", attributes?: Record<string, string | number | boolean>): void {
    const span = this.spans.get(spanId)
    if (!span) return

    span.endTime = Date.now()
    span.status = status ?? "ok"
    if (attributes) Object.assign(span.attributes, attributes)

    const durationMs = span.endTime - span.startTime
    this.recordHistogram("reactivebase_operation_duration_ms", durationMs, {
      operation: span.operationName,
      status: span.status,
    })
  }

  /**
   * Add an event to a span.
   */
  addSpanEvent(spanId: string, name: string, attributes?: Record<string, string | number | boolean>): void {
    const span = this.spans.get(spanId)
    if (span) {
      span.events.push({ name, timestamp: Date.now(), attributes })
    }
  }

  // ─── Auto-Instrumentation Hooks ───────────────────────────────────────────

  /**
   * Instrument a query execution.
   */
  instrumentQuery(queryName: string, fn: () => Promise<unknown>): Promise<unknown> {
    if (!this.options.traceQueries) return fn()

    const span = this.startSpan(`query.${queryName}`, { "reactivebase.type": "query", "reactivebase.query": queryName })
    this.incrementCounter("reactivebase_queries_total", { query: queryName })

    return fn()
      .then((result) => {
        this.endSpan(span.spanId, "ok", {
          "reactivebase.rows": typeof result === "object" && Array.isArray(result) ? result.length : 1,
        })
        return result
      })
      .catch((error: Error) => {
        this.endSpan(span.spanId, "error", { "error.message": error.message })
        this.incrementCounter("reactivebase_errors_total", { type: "query", query: queryName })
        throw error
      })
  }

  /**
   * Instrument a mutation execution.
   */
  instrumentMutation(mutationName: string, fn: () => Promise<unknown>): Promise<unknown> {
    if (!this.options.traceQueries) return fn()

    const span = this.startSpan(`mutation.${mutationName}`, {
      "reactivebase.type": "mutation",
      "reactivebase.mutation": mutationName,
    })
    this.incrementCounter("reactivebase_mutations_total", { mutation: mutationName })

    return fn()
      .then((result) => {
        this.endSpan(span.spanId, "ok")
        return result
      })
      .catch((error: Error) => {
        this.endSpan(span.spanId, "error", { "error.message": error.message })
        this.incrementCounter("reactivebase_errors_total", { type: "mutation", mutation: mutationName })
        throw error
      })
  }

  /**
   * Instrument a subscription lifecycle.
   */
  instrumentSubscription(subscriptionId: string, queryName: string): SubscriptionInstrumentation {
    const span = this.startSpan(`subscription.${queryName}`, {
      "reactivebase.type": "subscription",
      "reactivebase.subscription_id": subscriptionId,
      "reactivebase.query": queryName,
    })

    this.incrementCounter("reactivebase_subscriptions_active", { query: queryName })
    this.setGauge("reactivebase_subscriptions_total", this.getGauge("reactivebase_subscriptions_total") + 1)

    return {
      onUpdate: () => {
        this.addSpanEvent(span.spanId, "subscription.update")
        this.incrementCounter("reactivebase_subscription_updates_total", { query: queryName })
      },
      onError: (error: string) => {
        this.addSpanEvent(span.spanId, "subscription.error", { "error.message": error })
        this.incrementCounter("reactivebase_errors_total", { type: "subscription", query: queryName })
      },
      onComplete: () => {
        this.endSpan(span.spanId, "ok")
        this.incrementCounter("reactivebase_subscriptions_active", { query: queryName }, -1)
      },
    }
  }

  /**
   * Instrument an action execution.
   * Actions are background operations that may take longer than queries/mutations.
   */
  instrumentAction(actionName: string, fn: () => Promise<unknown>): Promise<unknown> {
    if (!this.options.traceQueries) return fn()

    const span = this.startSpan(`action.${actionName}`, {
      "reactivebase.type": "action",
      "reactivebase.action": actionName,
    })
    this.incrementCounter("reactivebase_actions_total", { action: actionName })

    return fn()
      .then((result) => {
        this.endSpan(span.spanId, "ok")
        return result
      })
      .catch((error: Error) => {
        this.endSpan(span.spanId, "error", { "error.message": error.message })
        this.incrementCounter("reactivebase_errors_total", { type: "action", action: actionName })
        throw error
      })
  }

  /**
   * Create middleware that auto-instruments all function executions.
   * Attach this to the server's middleware pipeline for zero-config observability.
   *
   * @example
   * const otel = new ReactiveBaseInstrumentation({ serviceName: 'my-app' })
   * server.use(otel.middleware())
   */
  middleware(): {
    name: string
    before: (ctx: { functionName: string; functionType: string }) => { span: SpanContext }
    after: (ctx: { functionName: string; functionType: string }, state: { span: SpanContext }) => void
    onError: (ctx: { functionName: string; functionType: string }, error: Error, state: { span: SpanContext }) => void
  } {
    return {
      name: "reactivebase-otel",
      before: (ctx) => {
        const span = this.startSpan(`${ctx.functionType}.${ctx.functionName}`, {
          "reactivebase.type": ctx.functionType,
          "reactivebase.function": ctx.functionName,
        })
        this.incrementCounter(`reactivebase_${ctx.functionType}s_total`, {
          [ctx.functionType]: ctx.functionName,
        })
        return { span }
      },
      after: (_ctx, state) => {
        this.endSpan(state.span.spanId, "ok")
      },
      onError: (ctx, error, state) => {
        this.endSpan(state.span.spanId, "error", { "error.message": error.message })
        this.incrementCounter("reactivebase_errors_total", {
          type: ctx.functionType,
          [ctx.functionType]: ctx.functionName,
        })
      },
    }
  }

  // ─── CDC & IVM Metrics ─────────────────────────────────────────────────────

  /**
   * Record CDC pipeline metrics.
   */
  recordCdcMetrics(metrics: { lag: number; throughput: number; errors: number; table: string }): void {
    if (!this.options.trackCdc) return

    this.setGauge("reactivebase_cdc_lag_ms", metrics.lag, { table: metrics.table })
    this.setGauge("reactivebase_cdc_throughput", metrics.throughput, { table: metrics.table })
    if (metrics.errors > 0) {
      this.incrementCounter("reactivebase_cdc_errors_total", { table: metrics.table }, metrics.errors)
    }
  }

  /**
   * Record IVM cache metrics.
   */
  recordIvmCacheMetrics(metrics: { hits: number; misses: number; evictions: number; queryName: string }): void {
    if (!this.options.trackIvmCache) return

    this.incrementCounter("reactivebase_ivm_cache_hits_total", { query: metrics.queryName }, metrics.hits)
    this.incrementCounter("reactivebase_ivm_cache_misses_total", { query: metrics.queryName }, metrics.misses)
    this.incrementCounter("reactivebase_ivm_cache_evictions_total", { query: metrics.queryName }, metrics.evictions)

    const total = metrics.hits + metrics.misses
    if (total > 0) {
      this.setGauge("reactivebase_ivm_cache_hit_rate", metrics.hits / total, { query: metrics.queryName })
    }
  }

  // ─── SLI / SLO Framework ──────────────────────────────────────────────────

  /**
   * Define an SLI.
   */
  defineSli(sli: SliDefinition): void {
    this.slis.set(sli.name, sli)
    this.sliHistory.set(sli.name, [])
  }

  /**
   * Define an SLO.
   */
  defineSlo(slo: SloDefinition): void {
    if (!this.slis.has(slo.sliName)) {
      throw new ObservabilityError(`SLI "${slo.sliName}" not found`)
    }
    this.slos.set(slo.name, slo)
  }

  /**
   * Record an SLI measurement.
   */
  recordSli(sliName: string, value: number): void {
    const history = this.sliHistory.get(sliName)
    if (history) {
      history.push({ value, timestamp: Date.now() })
      // Keep only last hour of data
      const oneHourAgo = Date.now() - 3_600_000
      while (history.length > 0 && history[0].timestamp < oneHourAgo) {
        history.shift()
      }
    }
  }

  /**
   * Evaluate all SLOs and return their status.
   */
  evaluateSlos(): SloStatus[] {
    const results: SloStatus[] = []

    for (const [, slo] of this.slos) {
      const sli = this.slis.get(slo.sliName)
      const history = this.sliHistory.get(slo.sliName)
      if (!sli || !history || history.length === 0) continue

      const windowMs = slo.windowMs ?? 2_592_000_000
      const cutoff = Date.now() - windowMs
      const windowData = history.filter((h) => h.timestamp >= cutoff)
      if (windowData.length === 0) continue

      const goodCount = windowData.filter((h) =>
        sli.comparison === "below" ? h.value < sli.threshold : h.value > sli.threshold,
      ).length

      const current = (goodCount / windowData.length) * 100
      const errorBudget = 100 - slo.target
      const consumed = 100 - current
      const remaining = Math.max(0, errorBudget - consumed)

      results.push({
        name: slo.name,
        target: slo.target,
        current: Math.round(current * 1000) / 1000,
        withinBudget: current >= slo.target,
        errorBudgetRemaining: Math.round(remaining * 1000) / 1000,
        evaluatedAt: Date.now(),
      })
    }

    return results
  }

  // ─── Prometheus Export ─────────────────────────────────────────────────────

  /**
   * Generate Prometheus-compatible metrics output.
   */
  generatePrometheusMetrics(): string {
    const lines: string[] = []

    // Counters
    for (const [key, value] of this.counters) {
      const { name, labels } = parseMetricKey(key)
      lines.push(`# HELP ${name} Auto-instrumented counter`)
      lines.push(`# TYPE ${name} counter`)
      lines.push(`${name}${formatLabels(labels)} ${value}`)
    }

    // Gauges
    for (const [key, value] of this.gauges) {
      const { name, labels } = parseMetricKey(key)
      lines.push(`# HELP ${name} Auto-instrumented gauge`)
      lines.push(`# TYPE ${name} gauge`)
      lines.push(`${name}${formatLabels(labels)} ${value}`)
    }

    // Histograms
    for (const [key, values] of this.histograms) {
      const { name, labels } = parseMetricKey(key)
      lines.push(`# HELP ${name} Auto-instrumented histogram`)
      lines.push(`# TYPE ${name} histogram`)

      const sorted = [...values].sort((a, b) => a - b)
      for (const bucket of this.options.latencyBuckets) {
        const count = sorted.filter((v) => v <= bucket).length
        lines.push(`${name}_bucket${formatLabels({ ...labels, le: String(bucket) })} ${count}`)
      }
      lines.push(`${name}_bucket${formatLabels({ ...labels, le: "+Inf" })} ${sorted.length}`)
      lines.push(`${name}_sum${formatLabels(labels)} ${sorted.reduce((a, b) => a + b, 0)}`)
      lines.push(`${name}_count${formatLabels(labels)} ${sorted.length}`)
    }

    return lines.join("\n")
  }

  /**
   * Create an HTTP handler for the /metrics endpoint.
   */
  metricsHandler(): (req: unknown, res: MetricsResponse) => void {
    return (_req, res) => {
      const body = this.generatePrometheusMetrics()
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" })
      res.end(body)
    }
  }

  // ─── Grafana Dashboard Templates ──────────────────────────────────────────

  /**
   * Generate a Grafana dashboard JSON for ReactiveBase metrics.
   */
  generateGrafanaDashboard(): GrafanaDashboard {
    return {
      title: "ReactiveBase Observability",
      uid: "reactivebase-main",
      time: { from: "now-1h", to: "now" },
      templating: { list: [] },
      panels: [
        {
          title: "Query Latency (p50, p95, p99)",
          type: "timeseries",
          targets: [
            {
              expr: 'histogram_quantile(0.5, rate(reactivebase_operation_duration_ms_bucket{operation=~"query.*"}[5m]))',
              legendFormat: "p50",
            },
            {
              expr: 'histogram_quantile(0.95, rate(reactivebase_operation_duration_ms_bucket{operation=~"query.*"}[5m]))',
              legendFormat: "p95",
            },
            {
              expr: 'histogram_quantile(0.99, rate(reactivebase_operation_duration_ms_bucket{operation=~"query.*"}[5m]))',
              legendFormat: "p99",
            },
          ],
          gridPos: { h: 8, w: 12, x: 0, y: 0 },
        },
        {
          title: "Queries & Mutations / sec",
          type: "timeseries",
          targets: [
            { expr: "rate(reactivebase_queries_total[5m])", legendFormat: "Queries/s" },
            { expr: "rate(reactivebase_mutations_total[5m])", legendFormat: "Mutations/s" },
          ],
          gridPos: { h: 8, w: 12, x: 12, y: 0 },
        },
        {
          title: "Active Subscriptions",
          type: "stat",
          targets: [{ expr: "reactivebase_subscriptions_total", legendFormat: "Active" }],
          gridPos: { h: 4, w: 6, x: 0, y: 8 },
        },
        {
          title: "Error Rate",
          type: "gauge",
          targets: [
            {
              expr: "rate(reactivebase_errors_total[5m]) / rate(reactivebase_queries_total[5m])",
              legendFormat: "Error %",
            },
          ],
          gridPos: { h: 4, w: 6, x: 6, y: 8 },
        },
        {
          title: "IVM Cache Hit Rate",
          type: "gauge",
          targets: [{ expr: "reactivebase_ivm_cache_hit_rate", legendFormat: "Hit Rate" }],
          gridPos: { h: 4, w: 6, x: 12, y: 8 },
        },
        {
          title: "CDC Lag (ms)",
          type: "timeseries",
          targets: [{ expr: "reactivebase_cdc_lag_ms", legendFormat: "{{table}}" }],
          gridPos: { h: 4, w: 6, x: 18, y: 8 },
        },
        {
          title: "Subscription Updates / sec",
          type: "timeseries",
          targets: [{ expr: "rate(reactivebase_subscription_updates_total[5m])", legendFormat: "{{query}}" }],
          gridPos: { h: 8, w: 12, x: 0, y: 12 },
        },
        {
          title: "CDC Throughput",
          type: "timeseries",
          targets: [{ expr: "reactivebase_cdc_throughput", legendFormat: "{{table}} events/s" }],
          gridPos: { h: 8, w: 12, x: 12, y: 12 },
        },
      ],
    }
  }

  /**
   * Generate alerting rules for Prometheus/Grafana.
   */
  generateAlertingRules(): object {
    return {
      groups: [
        {
          name: "reactivebase-alerts",
          rules: [
            {
              alert: "HighQueryLatency",
              expr: 'histogram_quantile(0.99, rate(reactivebase_operation_duration_ms_bucket{operation=~"query.*"}[5m])) > 1000',
              for: "5m",
              labels: { severity: "warning" },
              annotations: { summary: "Query p99 latency exceeds 1s" },
            },
            {
              alert: "HighErrorRate",
              expr: "rate(reactivebase_errors_total[5m]) / rate(reactivebase_queries_total[5m]) > 0.05",
              for: "5m",
              labels: { severity: "critical" },
              annotations: { summary: "Error rate exceeds 5%" },
            },
            {
              alert: "CDCLagHigh",
              expr: "reactivebase_cdc_lag_ms > 10000",
              for: "10m",
              labels: { severity: "warning" },
              annotations: { summary: "CDC replication lag exceeds 10s" },
            },
            {
              alert: "LowIVMCacheHitRate",
              expr: "reactivebase_ivm_cache_hit_rate < 0.5",
              for: "15m",
              labels: { severity: "info" },
              annotations: { summary: "IVM cache hit rate below 50%" },
            },
          ],
        },
      ],
    }
  }

  /**
   * Clean up all metrics and spans.
   */
  reset(): void {
    this.spans.clear()
    this.counters.clear()
    this.gauges.clear()
    this.histograms.clear()
    this.sliHistory.clear()
    this.initDefaultMetrics()
  }

  // ─── Internal Metric Helpers ───────────────────────────────────────────────

  incrementCounter(name: string, labels?: Record<string, string>, amount = 1): void {
    const key = buildMetricKey(name, labels)
    this.counters.set(key, (this.counters.get(key) ?? 0) + amount)
  }

  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = buildMetricKey(name, labels)
    this.gauges.set(key, value)
  }

  getGauge(name: string, labels?: Record<string, string>): number {
    const key = buildMetricKey(name, labels)
    return this.gauges.get(key) ?? 0
  }

  recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const key = buildMetricKey(name, labels)
    const values = this.histograms.get(key) ?? []
    values.push(value)
    this.histograms.set(key, values)
  }

  private initDefaultMetrics(): void {
    this.setGauge("reactivebase_subscriptions_total", 0)
    this.setGauge("reactivebase_connections_total", 0)
  }

  private generateId(): string {
    return `${Date.now().toString(36)}-${(++this.spanCounter).toString(36)}`
  }
}

export interface SubscriptionInstrumentation {
  onUpdate: () => void
  onError: (error: string) => void
  onComplete: () => void
}

export interface MetricsResponse {
  writeHead(status: number, headers: Record<string, string>): void
  end(body: string): void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildMetricKey(name: string, labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return name
  const sorted = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
  return `${name}{${sorted.map(([k, v]) => `${k}="${v}"`).join(",")}}`
}

function parseMetricKey(key: string): { name: string; labels: Record<string, string> } {
  const match = key.match(/^([^{]+)(\{(.+)\})?$/)
  if (!match) return { name: key, labels: {} }

  const name = match[1]
  const labels: Record<string, string> = {}
  if (match[3]) {
    const pairs = match[3].match(/(\w+)="([^"]*)"/g) ?? []
    for (const pair of pairs) {
      const [k, v] = pair.split("=")
      labels[k] = v.replace(/"/g, "")
    }
  }
  return { name, labels }
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels)
  if (entries.length === 0) return ""
  return `{${entries.map(([k, v]) => `${k}="${v}"`).join(",")}}`
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class ObservabilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ObservabilityError"
  }
}
