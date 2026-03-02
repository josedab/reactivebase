/**
 * Prometheus exposition format exporter.
 * Converts MetricsSnapshot to Prometheus text format.
 */

import type { MetricsSnapshot } from "./metrics.js"

/** Escape label values per Prometheus spec: backslash, double-quote, newline */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")
}

/**
 * Convert a MetricsSnapshot to Prometheus exposition format.
 *
 * @param snapshot - The metrics snapshot to convert
 * @returns Prometheus text exposition format string
 */
export function toPrometheusFormat(snapshot: MetricsSnapshot): string {
  const lines: string[] = []

  const gauge = (name: string, help: string, value: number) => {
    lines.push(`# HELP ${name} ${help}`)
    lines.push(`# TYPE ${name} gauge`)
    lines.push(`${name} ${value}`)
  }

  const counter = (name: string, help: string, value: number) => {
    lines.push(`# HELP ${name} ${help}`)
    lines.push(`# TYPE ${name} counter`)
    lines.push(`${name} ${value}`)
  }

  // Server metrics
  gauge("reactivebase_connections", "Current WebSocket connections", snapshot.server.connections)
  gauge("reactivebase_subscriptions_active", "Current active subscriptions", snapshot.server.activeSubscriptions)
  gauge("reactivebase_jobs_pending", "Pending scheduled jobs", snapshot.server.pendingJobs)

  // Query metrics
  counter("reactivebase_queries_total", "Total queries executed", snapshot.queries.totalExecuted)
  counter("reactivebase_queries_errors_total", "Total query errors", snapshot.queries.totalErrors)
  gauge("reactivebase_queries_latency_avg_ms", "Average query latency in ms", snapshot.queries.avgLatencyMs)
  gauge("reactivebase_queries_latency_p99_ms", "P99 query latency in ms", snapshot.queries.p99LatencyMs)

  // Per-function query metrics
  for (const [name, fm] of Object.entries(snapshot.queries.byFunction)) {
    const escaped = escapeLabel(name)
    lines.push(`reactivebase_query_calls_total{function="${escaped}"} ${fm.calls}`)
    lines.push(`reactivebase_query_errors_total{function="${escaped}"} ${fm.errors}`)
    lines.push(`reactivebase_query_latency_avg_ms{function="${escaped}"} ${fm.avgLatencyMs.toFixed(2)}`)
  }

  // Mutation metrics
  counter("reactivebase_mutations_total", "Total mutations executed", snapshot.mutations.totalExecuted)
  counter("reactivebase_mutations_errors_total", "Total mutation errors", snapshot.mutations.totalErrors)
  counter("reactivebase_mutations_retries_total", "Total mutation retries", snapshot.mutations.totalRetries)
  gauge("reactivebase_mutations_latency_avg_ms", "Average mutation latency in ms", snapshot.mutations.avgLatencyMs)
  gauge("reactivebase_mutations_latency_p99_ms", "P99 mutation latency in ms", snapshot.mutations.p99LatencyMs)

  // Per-function mutation metrics
  for (const [name, fm] of Object.entries(snapshot.mutations.byFunction)) {
    const escaped = escapeLabel(name)
    lines.push(`reactivebase_mutation_calls_total{function="${escaped}"} ${fm.calls}`)
    lines.push(`reactivebase_mutation_errors_total{function="${escaped}"} ${fm.errors}`)
    lines.push(`reactivebase_mutation_latency_avg_ms{function="${escaped}"} ${fm.avgLatencyMs.toFixed(2)}`)
  }

  // Subscription metrics
  counter(
    "reactivebase_subscriptions_created_total",
    "Total subscriptions created",
    snapshot.subscriptions.totalCreated,
  )
  counter(
    "reactivebase_subscriptions_removed_total",
    "Total subscriptions removed",
    snapshot.subscriptions.totalRemoved,
  )
  gauge(
    "reactivebase_subscriptions_per_connection_avg",
    "Average subscriptions per connection",
    snapshot.subscriptions.avgPerConnection,
  )

  // Invalidation metrics
  counter("reactivebase_invalidations_total", "Total invalidation evaluations", snapshot.invalidations.totalEvaluations)
  counter(
    "reactivebase_invalidations_hits_total",
    "Total subscriptions invalidated",
    snapshot.invalidations.totalInvalidated,
  )
  counter(
    "reactivebase_invalidations_skipped_total",
    "Total subscriptions skipped",
    snapshot.invalidations.totalSkipped,
  )
  gauge(
    "reactivebase_invalidations_eval_time_avg_ms",
    "Average invalidation evaluation time ms",
    snapshot.invalidations.avgEvaluationTimeMs,
  )
  gauge(
    "reactivebase_invalidations_false_rate",
    "False invalidation rate",
    snapshot.invalidations.falseInvalidationRate,
  )

  // Uptime
  gauge("reactivebase_uptime_ms", "Server uptime in milliseconds", snapshot.uptime)

  return lines.join("\n") + "\n"
}
