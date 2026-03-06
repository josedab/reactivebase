/**
 * Visual Debugger & Profiler
 *
 * Provides structured trace collection, a self-contained browser dashboard
 * (dependency graph, invalidation timeline, flamegraph, subscription list),
 * and a smart suggestion engine that detects N+1 queries, over-broad
 * subscriptions, and slow invalidation chains.
 */

import type {
  DebugEvent as _DebugEvent,
  DependencyEdge,
  InvalidationChain,
  SubscriptionProfile,
} from "./query-debugger.js"
import { QueryDebugger } from "./query-debugger.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TraceSpan {
  readonly id: string
  readonly name: string
  readonly metadata: Record<string, unknown>
  readonly startTime: number
  endTime: number | null
  durationMs: number | null
  readonly children: TraceSpan[]
  readonly events: TraceEvent[]
}

export interface TraceEvent {
  readonly id: string
  readonly type: "query_execution" | "invalidation" | "subscription_update"
  readonly timestamp: number
  readonly data: Record<string, unknown>
  readonly spanId: string | null
}

export interface DependencyNode {
  readonly id: string
  readonly label: string
  readonly type: "table" | "subscription" | "query"
  readonly metadata: Record<string, unknown>
}

export interface DependencyLink {
  readonly source: string
  readonly target: string
  readonly label?: string
}

export interface FlamegraphNode {
  readonly name: string
  readonly value: number
  readonly children: FlamegraphNode[]
}

export type SuggestionSeverity = "info" | "warning" | "critical"

export interface OptimizationSuggestion {
  readonly severity: SuggestionSeverity
  readonly description: string
  readonly affectedQueries: string[]
  readonly recommendedFix: string
}

export interface NPlusOnePattern {
  readonly queryName: string
  readonly occurrences: number
  readonly windowMs: number
  readonly spanIds: string[]
}

export interface OverBroadSubscription {
  readonly subscriptionId: string
  readonly queryName: string
  readonly tableCount: number
  readonly tables: string[]
}

export interface SlowChain {
  readonly triggerId: string
  readonly sourceTable: string
  readonly totalDurationMs: number
  readonly depth: number
  readonly affectedSubscriptionCount: number
}

export interface VisualDebuggerOptions {
  readonly maxTraceSpans: number
  readonly maxTraceEvents: number
  readonly nPlusOneWindowMs: number
  readonly nPlusOneThreshold: number
  readonly overBroadTableThreshold: number
  readonly slowChainThresholdMs: number
}

const DEFAULT_VISUAL_OPTIONS: VisualDebuggerOptions = {
  maxTraceSpans: 2000,
  maxTraceEvents: 5000,
  nPlusOneWindowMs: 100,
  nPlusOneThreshold: 5,
  overBroadTableThreshold: 5,
  slowChainThresholdMs: 200,
}

// ─── Trace Instrumentation ───────────────────────────────────────────────────

export class TraceInstrumentation {
  private spans: TraceSpan[] = []
  private activeSpans = new Map<string, TraceSpan>()
  private events: TraceEvent[] = []
  private spanCounter = 0
  private eventCounter = 0
  private readonly options: VisualDebuggerOptions

  constructor(options: Partial<VisualDebuggerOptions> = {}) {
    this.options = { ...DEFAULT_VISUAL_OPTIONS, ...options }
  }

  /**
   * Begin a new trace span.
   */
  startSpan(name: string, metadata: Record<string, unknown> = {}): string {
    const id = `span_${++this.spanCounter}`
    const span: TraceSpan = {
      id,
      name,
      metadata,
      startTime: performance.now(),
      endTime: null,
      durationMs: null,
      children: [],
      events: [],
    }

    this.activeSpans.set(id, span)
    this.spans.push(span)

    if (this.spans.length > this.options.maxTraceSpans) {
      const removed = this.spans.shift()!
      this.activeSpans.delete(removed.id)
    }

    return id
  }

  /**
   * End a span and compute its duration.
   */
  endSpan(spanId: string): TraceSpan | undefined {
    const span = this.activeSpans.get(spanId)
    if (!span) return undefined

    span.endTime = performance.now()
    span.durationMs = span.endTime - span.startTime
    this.activeSpans.delete(spanId)
    return span
  }

  /**
   * Record a trace event, optionally attached to a span.
   */
  recordEvent(type: TraceEvent["type"], data: Record<string, unknown>, spanId?: string): TraceEvent {
    const event: TraceEvent = {
      id: `tevt_${++this.eventCounter}`,
      type,
      timestamp: performance.now(),
      data,
      spanId: spanId ?? null,
    }

    this.events.push(event)
    if (this.events.length > this.options.maxTraceEvents) {
      this.events.shift()
    }

    if (spanId) {
      const span = this.activeSpans.get(spanId) ?? this.spans.find((s) => s.id === spanId)
      if (span) {
        ;(span.events as TraceEvent[]).push(event)
      }
    }

    return event
  }

  /**
   * Return all collected spans as a trace tree.
   */
  getTrace(): TraceSpan[] {
    return [...this.spans]
  }

  /**
   * Export spans as Chrome DevTools Trace Event format.
   */
  exportTraceEvents(): object[] {
    const traceEvents: object[] = []

    for (const span of this.spans) {
      traceEvents.push({
        name: span.name,
        cat: "reactivebase",
        ph: "B",
        ts: Math.round(span.startTime * 1000),
        pid: 1,
        tid: 1,
        args: span.metadata,
      })

      if (span.endTime !== null) {
        traceEvents.push({
          name: span.name,
          cat: "reactivebase",
          ph: "E",
          ts: Math.round(span.endTime * 1000),
          pid: 1,
          tid: 1,
          args: {},
        })
      }

      for (const evt of span.events) {
        traceEvents.push({
          name: evt.type,
          cat: "reactivebase",
          ph: "i",
          ts: Math.round(evt.timestamp * 1000),
          pid: 1,
          tid: 1,
          s: "g",
          args: evt.data,
        })
      }
    }

    return traceEvents
  }

  /**
   * Clear all trace data.
   */
  clear(): void {
    this.spans = []
    this.activeSpans.clear()
    this.events = []
  }
}

// ─── Smart Suggestion Engine ─────────────────────────────────────────────────

export class SmartSuggestionEngine {
  private readonly options: VisualDebuggerOptions

  constructor(options: Partial<VisualDebuggerOptions> = {}) {
    this.options = { ...DEFAULT_VISUAL_OPTIONS, ...options }
  }

  /**
   * Detect N+1 query patterns: many identical queries in a short window.
   */
  detectNPlusOne(traces: TraceSpan[]): NPlusOnePattern[] {
    const patterns: NPlusOnePattern[] = []
    const byName = new Map<string, TraceSpan[]>()

    for (const span of traces) {
      const group = byName.get(span.name) ?? []
      group.push(span)
      byName.set(span.name, group)
    }

    for (const [name, spans] of byName) {
      if (spans.length < this.options.nPlusOneThreshold) continue

      // Sort by start time and look for bursts within the window
      const sorted = [...spans].sort((a, b) => a.startTime - b.startTime)
      let windowStart = 0

      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].startTime - sorted[windowStart].startTime > this.options.nPlusOneWindowMs) {
          windowStart = i
        }

        const windowSize = i - windowStart + 1
        if (windowSize >= this.options.nPlusOneThreshold) {
          const spanIds = sorted.slice(windowStart, i + 1).map((s) => s.id)
          patterns.push({
            queryName: name,
            occurrences: windowSize,
            windowMs: sorted[i].startTime - sorted[windowStart].startTime,
            spanIds,
          })
          windowStart = i + 1
        }
      }
    }

    return patterns
  }

  /**
   * Find subscriptions watching too many tables.
   */
  detectOverBroadSubscriptions(
    subscriptions: SubscriptionProfile[],
    dependencyGraph: Map<string, DependencyEdge[]>,
  ): OverBroadSubscription[] {
    const results: OverBroadSubscription[] = []

    for (const sub of subscriptions) {
      const edges = dependencyGraph.get(sub.subscriptionId) ?? []
      const tables = [...new Set(edges.map((e) => e.sourceTable))]

      if (tables.length >= this.options.overBroadTableThreshold) {
        results.push({
          subscriptionId: sub.subscriptionId,
          queryName: sub.queryName,
          tableCount: tables.length,
          tables,
        })
      }
    }

    return results
  }

  /**
   * Identify slow cascading invalidation chains.
   */
  detectSlowInvalidationChains(traces: InvalidationChain[]): SlowChain[] {
    const chains: SlowChain[] = []

    for (const chain of traces) {
      if (chain.totalDurationMs >= this.options.slowChainThresholdMs) {
        chains.push({
          triggerId: chain.triggerId,
          sourceTable: chain.sourceTable,
          totalDurationMs: chain.totalDurationMs,
          depth: chain.affectedSubscriptions.length,
          affectedSubscriptionCount: chain.affectedSubscriptions.length,
        })
      }
    }

    return chains.sort((a, b) => b.totalDurationMs - a.totalDurationMs)
  }

  /**
   * Generate prioritised optimisation suggestions.
   */
  generateSuggestions(
    traces: TraceSpan[],
    subscriptions: SubscriptionProfile[],
    dependencyGraph: Map<string, DependencyEdge[]> = new Map(),
    invalidationChains: InvalidationChain[] = [],
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = []

    // N+1 detection
    const nPlusOnes = this.detectNPlusOne(traces)
    for (const pattern of nPlusOnes) {
      suggestions.push({
        severity: pattern.occurrences >= 20 ? "critical" : "warning",
        description: `N+1 query pattern: "${pattern.queryName}" executed ${pattern.occurrences} times within ${Math.round(pattern.windowMs)}ms`,
        affectedQueries: [pattern.queryName],
        recommendedFix: `Batch the "${pattern.queryName}" queries into a single query or use a DataLoader-style approach.`,
      })
    }

    // Over-broad subscriptions
    const overBroad = this.detectOverBroadSubscriptions(subscriptions, dependencyGraph)
    for (const sub of overBroad) {
      suggestions.push({
        severity: sub.tableCount >= 10 ? "critical" : "warning",
        description: `Subscription "${sub.queryName}" watches ${sub.tableCount} tables (${sub.tables.join(", ")})`,
        affectedQueries: [sub.queryName],
        recommendedFix: `Split "${sub.queryName}" into narrower subscriptions that each watch fewer tables.`,
      })
    }

    // Slow invalidation chains
    const slowChains = this.detectSlowInvalidationChains(invalidationChains)
    for (const chain of slowChains) {
      suggestions.push({
        severity: chain.totalDurationMs >= 500 ? "critical" : "warning",
        description: `Slow invalidation chain from "${chain.sourceTable}": ${Math.round(chain.totalDurationMs)}ms affecting ${chain.affectedSubscriptionCount} subscriptions`,
        affectedQueries: [chain.sourceTable],
        recommendedFix: `Consider debouncing writes to "${chain.sourceTable}" or reducing the number of dependent subscriptions.`,
      })
    }

    // High re-execution cost subscriptions
    for (const sub of subscriptions) {
      if (sub.avgReExecutionMs > 100 && sub.reExecutionCount > 5) {
        suggestions.push({
          severity: sub.avgReExecutionMs > 500 ? "critical" : "warning",
          description: `Query "${sub.queryName}" averages ${Math.round(sub.avgReExecutionMs)}ms per re-execution (${sub.reExecutionCount} times)`,
          affectedQueries: [sub.queryName],
          recommendedFix: `Optimise the "${sub.queryName}" query or add caching to reduce re-execution cost.`,
        })
      }
    }

    // Wasteful re-executions (many re-executions, few result changes)
    for (const sub of subscriptions) {
      if (sub.reExecutionCount > 10 && sub.resultDiffCount / sub.reExecutionCount < 0.1) {
        suggestions.push({
          severity: "info",
          description: `Query "${sub.queryName}" re-executed ${sub.reExecutionCount} times but results changed only ${sub.resultDiffCount} times`,
          affectedQueries: [sub.queryName],
          recommendedFix: `Add more specific table/column filters to "${sub.queryName}" to avoid unnecessary invalidations.`,
        })
      }
    }

    return suggestions.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
  }
}

function severityRank(s: SuggestionSeverity): number {
  switch (s) {
    case "critical":
      return 3
    case "warning":
      return 2
    case "info":
      return 1
  }
}

// ─── Visual Debugger ─────────────────────────────────────────────────────────

export class VisualDebugger {
  private readonly debugger: QueryDebugger
  private readonly tracer: TraceInstrumentation
  private readonly suggestionEngine: SmartSuggestionEngine

  constructor(
    queryDebugger: QueryDebugger,
    tracer?: TraceInstrumentation,
    options: Partial<VisualDebuggerOptions> = {},
  ) {
    this.debugger = queryDebugger
    this.tracer = tracer ?? new TraceInstrumentation(options)
    this.suggestionEngine = new SmartSuggestionEngine(options)
  }

  /**
   * Return nodes and edges for dependency graph visualisation.
   */
  getDependencyGraph(): { nodes: DependencyNode[]; links: DependencyLink[] } {
    const graph = this.debugger.getDependencyGraph()
    const nodeMap = new Map<string, DependencyNode>()
    const links: DependencyLink[] = []

    for (const [subscriptionId, edges] of graph) {
      const profile = this.debugger.getProfile(subscriptionId)
      const queryName = profile?.queryName ?? subscriptionId

      // Subscription node
      if (!nodeMap.has(subscriptionId)) {
        nodeMap.set(subscriptionId, {
          id: subscriptionId,
          label: queryName,
          type: "subscription",
          metadata: profile ? { avgMs: profile.avgReExecutionMs, reExecCount: profile.reExecutionCount } : {},
        })
      }

      for (const edge of edges) {
        // Table node
        if (!nodeMap.has(edge.sourceTable)) {
          nodeMap.set(edge.sourceTable, {
            id: edge.sourceTable,
            label: edge.sourceTable,
            type: "table",
            metadata: {},
          })
        }

        links.push({
          source: edge.sourceTable,
          target: subscriptionId,
          label: edge.filters ? JSON.stringify(edge.filters) : undefined,
        })
      }
    }

    return { nodes: Array.from(nodeMap.values()), links }
  }

  /**
   * Return chronological invalidation events.
   */
  getInvalidationTimeline(): InvalidationChain[] {
    return this.debugger.getInvalidationChains()
  }

  /**
   * Return hierarchical timing data suitable for flamegraph rendering.
   */
  getFlamegraphData(): FlamegraphNode {
    const profiles = this.debugger.getProfiles()
    const root: FlamegraphNode = {
      name: "root",
      value: 0,
      children: [],
    }

    // Group by query name, accumulate total execution time
    const byQuery = new Map<string, { totalMs: number; count: number }>()
    for (const profile of profiles) {
      const existing = byQuery.get(profile.queryName) ?? { totalMs: 0, count: 0 }
      existing.totalMs += profile.totalReExecutionMs
      existing.count += profile.reExecutionCount
      byQuery.set(profile.queryName, existing)
    }

    let rootValue = 0
    for (const [queryName, data] of byQuery) {
      rootValue += data.totalMs
      ;(root.children as FlamegraphNode[]).push({
        name: `${queryName} (×${data.count})`,
        value: Math.round(data.totalMs * 100) / 100,
        children: [],
      })
    }

    // Sort children descending by cost
    ;(root.children as FlamegraphNode[]).sort((a, b) => b.value - a.value)

    return {
      ...root,
      value: Math.round(rootValue * 100) / 100,
    }
  }

  /**
   * Generate a self-contained HTML dashboard with embedded CSS and JS.
   */
  generateDashboardHTML(options?: { title?: string }): string {
    const title = esc(options?.title ?? "ReactiveBase Visual Debugger")
    const summary = this.debugger.getSummary()
    const { nodes, links } = this.getDependencyGraph()
    const timeline = this.getInvalidationTimeline()
    const flamegraph = this.getFlamegraphData()
    const suggestions = this.suggestionEngine.generateSuggestions(
      this.tracer.getTrace(),
      this.debugger.getProfiles(),
      this.debugger.getDependencyGraph(),
      this.debugger.getInvalidationChains(),
    )
    const profiles = this.debugger.getProfiles()

    // Serialise data for embedding
    const graphJSON = JSON.stringify({ nodes, links })
    const timelineJSON = JSON.stringify(timeline)
    const flamegraphJSON = JSON.stringify(flamegraph)
    const suggestionsJSON = JSON.stringify(suggestions)

    // ── Subscription table rows ──
    const subscriptionRows = profiles
      .sort((a, b) => b.totalReExecutionMs - a.totalReExecutionMs)
      .map(
        (p) =>
          `<tr>
            <td>${esc(p.subscriptionId)}</td>
            <td>${esc(p.queryName)}</td>
            <td>${p.invalidationCount}</td>
            <td>${p.reExecutionCount}</td>
            <td>${Math.round(p.avgReExecutionMs * 100) / 100}</td>
            <td>${Math.round(p.totalReExecutionMs * 100) / 100}</td>
            <td>${p.resultDiffCount}</td>
          </tr>`,
      )
      .join("")

    // ── Suggestion rows ──
    const suggestionRows = suggestions
      .map(
        (s) =>
          `<div class="suggestion suggestion-${esc(s.severity)}">
            <span class="badge badge-${esc(s.severity)}">${esc(s.severity.toUpperCase())}</span>
            <p>${esc(s.description)}</p>
            <p class="fix"><strong>Fix:</strong> ${esc(s.recommendedFix)}</p>
            <p class="affected">Affected: ${s.affectedQueries.map(esc).join(", ")}</p>
          </div>`,
      )
      .join("")

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  :root { --bg: #0d1117; --surface: #161b22; --border: #30363d; --text: #c9d1d9; --text-muted: #8b949e; --accent: #58a6ff; --green: #3fb950; --yellow: #d29922; --red: #f85149; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); }
  .header { padding: 16px 24px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 16px; }
  .header h1 { font-size: 18px; font-weight: 600; }
  .stats { display: flex; gap: 24px; padding: 16px 24px; border-bottom: 1px solid var(--border); }
  .stat { text-align: center; }
  .stat .value { font-size: 24px; font-weight: 700; color: var(--accent); }
  .stat .label { font-size: 12px; color: var(--text-muted); }
  .tabs { display: flex; border-bottom: 1px solid var(--border); padding: 0 24px; }
  .tab { padding: 10px 16px; cursor: pointer; color: var(--text-muted); border-bottom: 2px solid transparent; font-size: 14px; }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .panel { display: none; padding: 24px; }
  .panel.active { display: block; }
  #graph-panel { height: 500px; position: relative; }
  #graph-svg { width: 100%; height: 100%; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); }
  th { color: var(--text-muted); font-weight: 600; position: sticky; top: 0; background: var(--surface); }
  tr:hover { background: var(--surface); }
  .timeline-event { display: flex; align-items: flex-start; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
  .timeline-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); margin-top: 4px; flex-shrink: 0; }
  .timeline-time { color: var(--text-muted); min-width: 80px; }
  .flamegraph-bar { display: flex; height: 24px; line-height: 24px; font-size: 11px; color: #fff; overflow: hidden; cursor: pointer; border-radius: 2px; margin-bottom: 2px; }
  .flamegraph-bar:hover { opacity: 0.85; }
  .suggestion { padding: 12px 16px; margin-bottom: 8px; border-radius: 6px; border-left: 4px solid var(--text-muted); background: var(--surface); }
  .suggestion-critical { border-left-color: var(--red); }
  .suggestion-warning { border-left-color: var(--yellow); }
  .suggestion-info { border-left-color: var(--accent); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; margin-right: 8px; }
  .badge-critical { background: var(--red); color: #fff; }
  .badge-warning { background: var(--yellow); color: #000; }
  .badge-info { background: var(--accent); color: #000; }
  .fix { margin-top: 6px; color: var(--text-muted); font-size: 13px; }
  .affected { margin-top: 4px; color: var(--text-muted); font-size: 12px; }
  .empty { padding: 32px; text-align: center; color: var(--text-muted); }
</style>
</head>
<body>
  <div class="header">
    <h1>${title}</h1>
  </div>

  <div class="stats">
    <div class="stat"><div class="value">${summary.totalSubscriptions}</div><div class="label">Subscriptions</div></div>
    <div class="stat"><div class="value">${summary.totalEvents}</div><div class="label">Events</div></div>
    <div class="stat"><div class="value">${summary.totalInvalidations}</div><div class="label">Invalidations</div></div>
    <div class="stat"><div class="value">${summary.bottleneckCount}</div><div class="label">Bottlenecks</div></div>
    <div class="stat"><div class="value">${suggestions.length}</div><div class="label">Suggestions</div></div>
  </div>

  <div class="tabs">
    <div class="tab active" onclick="switchTab('graph')">Dependency Graph</div>
    <div class="tab" onclick="switchTab('timeline')">Invalidation Timeline</div>
    <div class="tab" onclick="switchTab('flamegraph')">Flamegraph</div>
    <div class="tab" onclick="switchTab('subscriptions')">Subscriptions</div>
    <div class="tab" onclick="switchTab('suggestions')">Suggestions</div>
  </div>

  <div id="graph" class="panel active">
    <div id="graph-panel">
      <svg id="graph-svg"></svg>
    </div>
  </div>

  <div id="timeline" class="panel">
    <div id="timeline-container">
      ${
        timeline.length === 0
          ? '<div class="empty">No invalidation events recorded yet.</div>'
          : timeline
              .slice(-100)
              .map(
                (e) =>
                  `<div class="timeline-event">
                    <div class="timeline-dot"></div>
                    <div class="timeline-time">${Math.round(e.timestamp)}ms</div>
                    <div><strong>${esc(e.sourceTable)}</strong> → ${e.affectedSubscriptions.length} subscriptions (${Math.round(e.totalDurationMs)}ms)</div>
                  </div>`,
              )
              .join("")
      }
    </div>
  </div>

  <div id="flamegraph" class="panel">
    <div id="flamegraph-container"></div>
  </div>

  <div id="subscriptions" class="panel">
    ${
      profiles.length === 0
        ? '<div class="empty">No subscriptions registered yet.</div>'
        : `<table>
            <thead><tr><th>ID</th><th>Query</th><th>Invalidations</th><th>Re-executions</th><th>Avg ms</th><th>Total ms</th><th>Diffs</th></tr></thead>
            <tbody>${subscriptionRows}</tbody>
          </table>`
    }
  </div>

  <div id="suggestions" class="panel">
    ${suggestions.length === 0 ? '<div class="empty">No optimization suggestions — looking good!</div>' : suggestionRows}
  </div>

<script>
// ── Tab switching ──
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(function(t, i) {
    var panels = ['graph','timeline','flamegraph','subscriptions','suggestions'];
    t.classList.toggle('active', panels[i] === name);
  });
  document.querySelectorAll('.panel').forEach(function(p) {
    p.classList.toggle('active', p.id === name);
  });
}

// ── Data ──
var graphData = ${graphJSON};
var timelineData = ${timelineJSON};
var flamegraphData = ${flamegraphJSON};
var suggestionsData = ${suggestionsJSON};

// ── Dependency Graph (D3 force-directed) ──
(function() {
  if (graphData.nodes.length === 0) {
    document.getElementById('graph-panel').innerHTML = '<div class="empty">No dependency data available.</div>';
    return;
  }

  var svg = document.getElementById('graph-svg');
  var width = svg.clientWidth || 800;
  var height = svg.clientHeight || 500;
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

  var colors = { table: '#3fb950', subscription: '#58a6ff', query: '#d29922' };

  // Simple force simulation without external D3 dependency
  var nodes = graphData.nodes.map(function(n, i) {
    return { id: n.id, label: n.label, type: n.type, x: width / 2 + (Math.random() - 0.5) * 200, y: height / 2 + (Math.random() - 0.5) * 200, vx: 0, vy: 0 };
  });
  var nodeById = {};
  nodes.forEach(function(n) { nodeById[n.id] = n; });

  var links = graphData.links.filter(function(l) { return nodeById[l.source] && nodeById[l.target]; }).map(function(l) {
    return { source: nodeById[l.source], target: nodeById[l.target] };
  });

  // Run a basic force layout
  for (var iter = 0; iter < 100; iter++) {
    // Repulsion
    for (var i = 0; i < nodes.length; i++) {
      for (var j = i + 1; j < nodes.length; j++) {
        var dx = nodes[j].x - nodes[i].x;
        var dy = nodes[j].y - nodes[i].y;
        var d = Math.sqrt(dx * dx + dy * dy) || 1;
        var force = 5000 / (d * d);
        var fx = dx / d * force;
        var fy = dy / d * force;
        nodes[i].vx -= fx; nodes[i].vy -= fy;
        nodes[j].vx += fx; nodes[j].vy += fy;
      }
    }
    // Attraction along links
    for (var k = 0; k < links.length; k++) {
      var s = links[k].source, t = links[k].target;
      var dx2 = t.x - s.x, dy2 = t.y - s.y;
      var d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
      var f = (d2 - 100) * 0.01;
      var fx2 = dx2 / d2 * f, fy2 = dy2 / d2 * f;
      s.vx += fx2; s.vy += fy2;
      t.vx -= fx2; t.vy -= fy2;
    }
    // Center gravity
    for (var m = 0; m < nodes.length; m++) {
      nodes[m].vx += (width / 2 - nodes[m].x) * 0.005;
      nodes[m].vy += (height / 2 - nodes[m].y) * 0.005;
      nodes[m].x += nodes[m].vx * 0.3;
      nodes[m].y += nodes[m].vy * 0.3;
      nodes[m].vx *= 0.8; nodes[m].vy *= 0.8;
      nodes[m].x = Math.max(30, Math.min(width - 30, nodes[m].x));
      nodes[m].y = Math.max(30, Math.min(height - 30, nodes[m].y));
    }
  }

  // Render
  var html = '';
  // Links
  for (var li = 0; li < links.length; li++) {
    html += '<line x1="' + links[li].source.x + '" y1="' + links[li].source.y + '" x2="' + links[li].target.x + '" y2="' + links[li].target.y + '" stroke="#30363d" stroke-width="1.5" />';
  }
  // Nodes
  for (var ni = 0; ni < nodes.length; ni++) {
    var n = nodes[ni];
    var r = n.type === 'table' ? 12 : 8;
    html += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + r + '" fill="' + (colors[n.type] || '#ccc') + '" />';
    html += '<text x="' + n.x + '" y="' + (n.y - r - 4) + '" text-anchor="middle" fill="#c9d1d9" font-size="11">' + n.label + '</text>';
  }
  svg.innerHTML = html;
})();

// ── Flamegraph ──
(function() {
  var container = document.getElementById('flamegraph-container');
  if (!flamegraphData.children || flamegraphData.children.length === 0) {
    container.innerHTML = '<div class="empty">No execution timing data available.</div>';
    return;
  }

  var total = flamegraphData.value || 1;
  var barColors = ['#f85149','#d29922','#58a6ff','#3fb950','#bc8cff','#f778ba'];
  var html = '<div style="font-size:12px;color:#8b949e;margin-bottom:8px;">Total: ' + total.toFixed(2) + 'ms</div>';

  flamegraphData.children.forEach(function(child, i) {
    var pct = (child.value / total) * 100;
    if (pct < 0.5) return;
    var color = barColors[i % barColors.length];
    html += '<div class="flamegraph-bar" style="width:' + Math.max(pct, 2) + '%;background:' + color + '" title="' + child.name + ': ' + child.value.toFixed(2) + 'ms (' + pct.toFixed(1) + '%)">';
    html += '&nbsp;' + child.name + ' — ' + child.value.toFixed(2) + 'ms';
    html += '</div>';
  });

  container.innerHTML = html;
})();
</script>
</body>
</html>`
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
