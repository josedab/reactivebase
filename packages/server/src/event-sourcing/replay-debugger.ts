/**
 * Event Sourcing Replay Debugger for ReactiveBase.
 *
 * Extends event-sourcing/ and time-travel/ with:
 *   - Timeline scrubber showing mutation history
 *   - State reconstruction at any point in time
 *   - Diff between timestamps with side-by-side view
 *   - Event filtering by entity/type
 *   - What-if scenario replay (modify events and replay)
 *   - Embeddable HTML dashboard
 *
 * Usage:
 *   const debugger = new ReplayDebugger(eventStore, timeTravelEngine)
 *   const timeline = debugger.getTimeline({ from: t1, to: t2 })
 *   const stateAt = debugger.reconstructStateAt(streamId, version)
 *   const whatIf = debugger.whatIfReplay(streamId, modifiedEvents)
 */

import type { EventStore, DomainEvent, EventFilter } from "../event-sourcing/event-sourcing.js"
import type { TimeTravelEngine, TimeTravelDiff } from "../time-travel/time-travel.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TimelineEvent {
  id: string
  timestamp: number
  type: "domain-event" | "mutation" | "snapshot" | "projection-update"
  label: string
  detail: string
  streamId?: string
  eventType?: string
  version?: number
  entity?: string
  severity?: "info" | "warning" | "critical"
  data?: unknown
}

export interface TimelineOptions {
  from?: number
  to?: number
  streamId?: string
  eventTypes?: string[]
  entity?: string
  limit?: number
}

export interface StateReconstruction {
  streamId: string
  version: number
  timestamp: number
  state: Record<string, unknown>
  eventCount: number
  events: DomainEvent[]
}

export interface StateDiff {
  fromVersion: number
  toVersion: number
  fromTimestamp: number
  toTimestamp: number
  fromState: Record<string, unknown>
  toState: Record<string, unknown>
  changedFields: FieldDiff[]
  addedFields: string[]
  removedFields: string[]
}

export interface FieldDiff {
  field: string
  from: unknown
  to: unknown
}

export interface WhatIfScenario {
  id: string
  streamId: string
  originalEvents: DomainEvent[]
  modifiedEvents: Array<{ type: string; data: unknown }>
  originalState: Record<string, unknown>
  resultState: Record<string, unknown>
  diff: FieldDiff[]
  createdAt: number
}

export interface ReplayDebuggerStats {
  totalEvents: number
  totalStreams: number
  timelineCoverage: { from: number | null; to: number | null }
  eventTypeDistribution: Record<string, number>
  activeScenarios: number
}

// ─── Replay Debugger ─────────────────────────────────────────────────────────

export class ReplayDebugger {
  private eventStore: EventStore
  private timeTravel: TimeTravelEngine
  private scenarios = new Map<string, WhatIfScenario>()
  private scenarioCounter = 0

  constructor(eventStore: EventStore, timeTravel: TimeTravelEngine) {
    this.eventStore = eventStore
    this.timeTravel = timeTravel
  }

  // ─── Timeline ──────────────────────────────────────────────────────────

  /**
   * Get a unified timeline of events from both event store and time-travel.
   */
  getTimeline(options: TimelineOptions = {}): TimelineEvent[] {
    const limit = options.limit ?? 200
    const events: TimelineEvent[] = []

    // Domain events from event store
    const filter: EventFilter = {
      streamId: options.streamId,
      types: options.eventTypes,
      fromTimestamp: options.from,
      toTimestamp: options.to,
      limit,
    }
    const domainEvents = this.eventStore.queryEvents(filter)

    for (const evt of domainEvents) {
      events.push({
        id: evt.id,
        timestamp: evt.timestamp,
        type: "domain-event",
        label: evt.type,
        detail: `Stream: ${evt.streamId} v${evt.version}`,
        streamId: evt.streamId,
        eventType: evt.type,
        version: evt.version,
        data: evt.data,
      })
    }

    // Mutation events from time-travel
    const from = options.from ?? 0
    const to = options.to ?? Date.now()
    const mutations = this.timeTravel.getEventsInRange(from, to)

    for (const mut of mutations) {
      if (options.entity && mut.table !== options.entity) continue

      events.push({
        id: mut.id,
        timestamp: mut.timestampMs,
        type: "mutation",
        label: `${mut.operation} ${mut.table}`,
        detail: `${mut.mutationName}: ${mut.operation} ${mut.table}.${mut.rowId}`,
        entity: mut.table,
        data: { before: mut.before, after: mut.after, rowId: mut.rowId },
      })
    }

    // Sort by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp)
    return events.slice(0, limit)
  }

  /**
   * Get event type distribution for the timeline.
   */
  getEventTypeDistribution(options: TimelineOptions = {}): Record<string, number> {
    const timeline = this.getTimeline({ ...options, limit: 10000 })
    const dist: Record<string, number> = {}
    for (const evt of timeline) {
      const key = evt.eventType ?? evt.type
      dist[key] = (dist[key] ?? 0) + 1
    }
    return dist
  }

  // ─── State Reconstruction ──────────────────────────────────────────────

  /**
   * Reconstruct the state of a stream at a specific version.
   */
  reconstructStateAt(streamId: string, version: number): StateReconstruction {
    const allEvents = this.eventStore.getEvents(streamId, 0)
    const eventsUpTo = allEvents.filter((e) => e.version <= version)

    const state: Record<string, unknown> = {}
    for (const evt of eventsUpTo) {
      Object.assign(state, evt.data as Record<string, unknown>)
    }

    const lastEvent = eventsUpTo[eventsUpTo.length - 1]
    return {
      streamId,
      version,
      timestamp: lastEvent?.timestamp ?? 0,
      state,
      eventCount: eventsUpTo.length,
      events: eventsUpTo,
    }
  }

  /**
   * Reconstruct a row's state at a point in time using time-travel.
   */
  reconstructRowAt(table: string, rowId: string, atMs: number): Record<string, unknown> | null {
    return this.timeTravel.getRowStateAt(table, rowId, atMs)
  }

  // ─── Diff Between Versions ─────────────────────────────────────────────

  /**
   * Generate a diff between two versions of a stream.
   */
  diffVersions(streamId: string, fromVersion: number, toVersion: number): StateDiff {
    const fromState = this.reconstructStateAt(streamId, fromVersion)
    const toState = this.reconstructStateAt(streamId, toVersion)

    return computeStateDiff(
      fromVersion,
      toVersion,
      fromState.timestamp,
      toState.timestamp,
      fromState.state,
      toState.state,
    )
  }

  /**
   * Generate a diff between two timestamps using time-travel.
   */
  diffTimestamps(fromMs: number, toMs: number): TimeTravelDiff {
    return this.timeTravel.diff(fromMs, toMs)
  }

  // ─── What-If Replay ───────────────────────────────────────────────────

  /**
   * Create a what-if scenario: replay with modified events.
   * Does not modify the actual event store.
   */
  whatIfReplay(streamId: string, modifiedEvents: Array<{ type: string; data: unknown }>): WhatIfScenario {
    const originalEvents = this.eventStore.getEvents(streamId, 0)

    // Build original state
    const originalState: Record<string, unknown> = {}
    for (const evt of originalEvents) {
      Object.assign(originalState, evt.data as Record<string, unknown>)
    }

    // Build what-if state
    const resultState: Record<string, unknown> = {}
    for (const evt of modifiedEvents) {
      Object.assign(resultState, evt.data as Record<string, unknown>)
    }

    const diff = computeFieldDiffs(originalState, resultState)

    const scenario: WhatIfScenario = {
      id: `scenario_${++this.scenarioCounter}`,
      streamId,
      originalEvents,
      modifiedEvents,
      originalState,
      resultState,
      diff,
      createdAt: Date.now(),
    }

    this.scenarios.set(scenario.id, scenario)
    return scenario
  }

  /**
   * Get a what-if scenario by ID.
   */
  getScenario(id: string): WhatIfScenario | undefined {
    return this.scenarios.get(id)
  }

  /**
   * List all what-if scenarios.
   */
  listScenarios(): WhatIfScenario[] {
    return [...this.scenarios.values()]
  }

  /**
   * Delete a what-if scenario.
   */
  deleteScenario(id: string): boolean {
    return this.scenarios.delete(id)
  }

  // ─── Stats ─────────────────────────────────────────────────────────────

  getStats(): ReplayDebuggerStats {
    const esStats = this.eventStore.getStats()
    const timeline = this.getTimeline({ limit: 10000 })
    const timestamps = timeline.map((e) => e.timestamp).filter((t) => t > 0)

    return {
      totalEvents: esStats.totalEvents + this.timeTravel.eventCount,
      totalStreams: esStats.totalStreams,
      timelineCoverage: {
        from: timestamps.length > 0 ? Math.min(...timestamps) : null,
        to: timestamps.length > 0 ? Math.max(...timestamps) : null,
      },
      eventTypeDistribution: this.getEventTypeDistribution(),
      activeScenarios: this.scenarios.size,
    }
  }

  // ─── HTML Dashboard ────────────────────────────────────────────────────

  generateDashboardHTML(): string {
    const stats = this.getStats()
    const timeline = this.getTimeline({ limit: 50 })
    const timelineRows = timeline
      .map(
        (evt) => `<tr>
          <td>${new Date(evt.timestamp).toISOString().replace("T", " ").substring(0, 19)}</td>
          <td><span class="badge-${evt.type}">${evt.type}</span></td>
          <td>${esc(evt.label)}</td>
          <td>${esc(evt.detail)}</td>
          <td>${evt.streamId ? esc(evt.streamId) : "—"}</td>
          <td>${evt.version ?? "—"}</td>
        </tr>`,
      )
      .join("\n")

    const distEntries = Object.entries(stats.eventTypeDistribution)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([type, count]) => `<li><strong>${esc(type)}</strong>: ${count}</li>`)
      .join("")

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ReactiveBase — Replay Debugger</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; padding: 24px; }
    h1 { font-size: 24px; margin-bottom: 8px; color: #f0f6fc; }
    h2 { font-size: 18px; margin: 24px 0 12px; color: #f0f6fc; }
    .subtitle { color: #8b949e; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; text-align: center; }
    .card .label { font-size: 11px; text-transform: uppercase; color: #8b949e; }
    .card .value { font-size: 24px; font-weight: 700; color: #f0f6fc; }
    .section { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 24px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #21262d; }
    th { color: #8b949e; font-weight: 600; font-size: 11px; text-transform: uppercase; }
    .badge-domain-event { padding: 2px 8px; border-radius: 12px; font-size: 11px; background: #1f6feb; color: #fff; }
    .badge-mutation { padding: 2px 8px; border-radius: 12px; font-size: 11px; background: #238636; color: #fff; }
    .badge-snapshot { padding: 2px 8px; border-radius: 12px; font-size: 11px; background: #8957e5; color: #fff; }
    .badge-projection-update { padding: 2px 8px; border-radius: 12px; font-size: 11px; background: #9e6a03; color: #fff; }
    ul { list-style: none; padding: 0; }
    li { padding: 4px 0; }
  </style>
</head>
<body>
  <h1>⏪ Replay Debugger</h1>
  <p class="subtitle">${stats.totalEvents} events across ${stats.totalStreams} streams · ${stats.activeScenarios} active scenario(s)</p>

  <div class="grid">
    <div class="card"><div class="label">Total Events</div><div class="value">${stats.totalEvents}</div></div>
    <div class="card"><div class="label">Streams</div><div class="value">${stats.totalStreams}</div></div>
    <div class="card"><div class="label">Scenarios</div><div class="value">${stats.activeScenarios}</div></div>
    <div class="card"><div class="label">Coverage</div><div class="value">${stats.timelineCoverage.from ? new Date(stats.timelineCoverage.from).toLocaleDateString() + " → " + new Date(stats.timelineCoverage.to!).toLocaleDateString() : "—"}</div></div>
  </div>

  <h2>Event Type Distribution</h2>
  <div class="section">
    <ul>${distEntries || "<li>No events recorded</li>"}</ul>
  </div>

  <h2>Recent Timeline</h2>
  <div class="section">
    <table>
      <thead><tr><th>Timestamp</th><th>Type</th><th>Label</th><th>Detail</th><th>Stream</th><th>Version</th></tr></thead>
      <tbody>${timelineRows || '<tr><td colspan="6" style="text-align:center;color:#484f58">No timeline events</td></tr>'}</tbody>
    </table>
  </div>
</body>
</html>`
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeStateDiff(
  fromVersion: number,
  toVersion: number,
  fromTimestamp: number,
  toTimestamp: number,
  fromState: Record<string, unknown>,
  toState: Record<string, unknown>,
): StateDiff {
  const changedFields = computeFieldDiffs(fromState, toState)
  const fromKeys = new Set(Object.keys(fromState))
  const toKeys = new Set(Object.keys(toState))

  const addedFields = [...toKeys].filter((k) => !fromKeys.has(k))
  const removedFields = [...fromKeys].filter((k) => !toKeys.has(k))

  return {
    fromVersion,
    toVersion,
    fromTimestamp,
    toTimestamp,
    fromState,
    toState,
    changedFields,
    addedFields,
    removedFields,
  }
}

function computeFieldDiffs(fromState: Record<string, unknown>, toState: Record<string, unknown>): FieldDiff[] {
  const diffs: FieldDiff[] = []
  const allKeys = new Set([...Object.keys(fromState), ...Object.keys(toState)])

  for (const key of allKeys) {
    const fromVal = fromState[key]
    const toVal = toState[key]
    if (JSON.stringify(fromVal) !== JSON.stringify(toVal)) {
      diffs.push({ field: key, from: fromVal, to: toVal })
    }
  }

  return diffs
}

function esc(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
