/**
 * Snapshot Testing & Time-Travel Debugging for ReactiveBase.
 * Capture named database snapshots, replay mutations, diff states,
 * and debug reactive data flows.
 *
 * Usage:
 *   const snapshots = new SnapshotManager(testServer.db)
 *   snapshots.capture("before-migration")
 *   await testServer.runMutation(addTask, { title: "Hello" })
 *   snapshots.capture("after-add")
 *   const diff = snapshots.diff("before-migration", "after-add")
 */

import type { MockRow } from "./mock-database.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NamedSnapshot {
  name: string
  tables: Record<string, MockRow[]>
  capturedAt: number
  metadata?: Record<string, unknown>
}

export interface StateDiff {
  from: string
  to: string
  tables: Record<string, TableDiff>
  summary: {
    tablesAdded: string[]
    tablesRemoved: string[]
    tablesModified: string[]
    totalInserts: number
    totalDeletes: number
    totalUpdates: number
  }
}

export interface TableDiff {
  inserted: MockRow[]
  deleted: MockRow[]
  updated: Array<{ id: string; changes: Record<string, { from: unknown; to: unknown }> }>
}

export interface MutationReplayEntry {
  step: number
  label: string
  fn: string
  args: Record<string, unknown>
  snapshotAfter: string
  durationMs: number
}

export interface ReplayResult {
  entries: MutationReplayEntry[]
  diffs: StateDiff[]
  totalDurationMs: number
}

export interface SnapshotReadable {
  table(name: string): { all(): MockRow[] }
}

// ─── Snapshot Manager ────────────────────────────────────────────────────────

export class SnapshotManager {
  private snapshots = new Map<string, NamedSnapshot>()
  private db: SnapshotReadable
  private tableNames: string[]

  constructor(db: SnapshotReadable, tableNames: string[] = []) {
    this.db = db
    this.tableNames = tableNames
  }

  /**
   * Capture a named snapshot of the current database state.
   */
  capture(name: string, metadata?: Record<string, unknown>): NamedSnapshot {
    if (this.snapshots.has(name)) {
      throw new Error(`Snapshot "${name}" already exists. Use a unique name or delete the existing one.`)
    }

    const tables: Record<string, MockRow[]> = {}
    for (const tableName of this.tableNames) {
      const tableObj = this.db.table(tableName)
      tables[tableName] = deepClone(tableObj.all())
    }

    const snapshot: NamedSnapshot = {
      name,
      tables,
      capturedAt: Date.now(),
      metadata,
    }

    this.snapshots.set(name, snapshot)
    return snapshot
  }

  /**
   * Get a snapshot by name.
   */
  get(name: string): NamedSnapshot | undefined {
    return this.snapshots.get(name)
  }

  /**
   * List all captured snapshots.
   */
  list(): Array<{ name: string; capturedAt: number; tableCount: number; rowCount: number }> {
    return Array.from(this.snapshots.values()).map((s) => ({
      name: s.name,
      capturedAt: s.capturedAt,
      tableCount: Object.keys(s.tables).length,
      rowCount: Object.values(s.tables).reduce((sum, rows) => sum + rows.length, 0),
    }))
  }

  /**
   * Delete a snapshot.
   */
  delete(name: string): boolean {
    return this.snapshots.delete(name)
  }

  /**
   * Clear all snapshots.
   */
  clear(): void {
    this.snapshots.clear()
  }

  /**
   * Compute the diff between two named snapshots.
   */
  diff(fromName: string, toName: string): StateDiff {
    const from = this.snapshots.get(fromName)
    const to = this.snapshots.get(toName)
    if (!from) throw new Error(`Snapshot "${fromName}" not found`)
    if (!to) throw new Error(`Snapshot "${toName}" not found`)

    return computeDiff(fromName, toName, from.tables, to.tables)
  }

  /**
   * Diff current state against a named snapshot.
   */
  diffFromCurrent(snapshotName: string): StateDiff {
    const snapshot = this.snapshots.get(snapshotName)
    if (!snapshot) throw new Error(`Snapshot "${snapshotName}" not found`)

    const currentTables: Record<string, MockRow[]> = {}
    for (const tableName of this.tableNames) {
      const tableObj = this.db.table(tableName)
      currentTables[tableName] = tableObj.all()
    }

    return computeDiff(snapshotName, "<current>", snapshot.tables, currentTables)
  }
}

// ─── Mutation Replay ─────────────────────────────────────────────────────────

export interface MutationStep {
  label: string
  fn: string
  args: Record<string, unknown>
}

export interface MutationRunner {
  runMutation(fn: string, args: Record<string, unknown>): Promise<unknown>
}

/**
 * Replay a sequence of mutations, capturing snapshots and diffs at each step.
 */
export async function replayMutations(
  runner: MutationRunner,
  snapshots: SnapshotManager,
  steps: MutationStep[],
): Promise<ReplayResult> {
  const entries: MutationReplayEntry[] = []
  const diffs: StateDiff[] = []
  const totalStart = Date.now()

  snapshots.capture("_replay_initial")

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const snapshotName = `_replay_step_${i}`
    const start = Date.now()

    await runner.runMutation(step.fn, step.args)

    const durationMs = Date.now() - start
    snapshots.capture(snapshotName)

    const prevSnapshot = i === 0 ? "_replay_initial" : `_replay_step_${i - 1}`
    const diff = snapshots.diff(prevSnapshot, snapshotName)
    diffs.push(diff)

    entries.push({
      step: i,
      label: step.label,
      fn: step.fn,
      args: step.args,
      snapshotAfter: snapshotName,
      durationMs,
    })
  }

  return {
    entries,
    diffs,
    totalDurationMs: Date.now() - totalStart,
  }
}

// ─── Assertion Helpers ───────────────────────────────────────────────────────

/**
 * Assert that a snapshot matches expected table data.
 */
export function assertSnapshotMatches(snapshot: NamedSnapshot, expected: Record<string, MockRow[]>): void {
  for (const [table, expectedRows] of Object.entries(expected)) {
    const actualRows = snapshot.tables[table]
    if (!actualRows) {
      throw new Error(`Table "${table}" not found in snapshot "${snapshot.name}"`)
    }

    const actualJson = JSON.stringify(sortById(actualRows))
    const expectedJson = JSON.stringify(sortById(expectedRows))

    if (actualJson !== expectedJson) {
      throw new Error(
        `Snapshot "${snapshot.name}" table "${table}" mismatch.\n` +
          `Expected: ${expectedJson}\n` +
          `Actual: ${actualJson}`,
      )
    }
  }
}

/**
 * Assert that a diff contains specific changes.
 */
export function assertDiffContains(
  diff: StateDiff,
  expectations: {
    inserts?: Record<string, number>
    deletes?: Record<string, number>
    updates?: Record<string, number>
  },
): void {
  if (expectations.inserts) {
    for (const [table, count] of Object.entries(expectations.inserts)) {
      const actual = diff.tables[table]?.inserted.length ?? 0
      if (actual !== count) {
        throw new Error(`Expected ${count} inserts in "${table}", got ${actual}`)
      }
    }
  }

  if (expectations.deletes) {
    for (const [table, count] of Object.entries(expectations.deletes)) {
      const actual = diff.tables[table]?.deleted.length ?? 0
      if (actual !== count) {
        throw new Error(`Expected ${count} deletes in "${table}", got ${actual}`)
      }
    }
  }

  if (expectations.updates) {
    for (const [table, count] of Object.entries(expectations.updates)) {
      const actual = diff.tables[table]?.updated.length ?? 0
      if (actual !== count) {
        throw new Error(`Expected ${count} updates in "${table}", got ${actual}`)
      }
    }
  }
}

// ─── Diff Computation ────────────────────────────────────────────────────────

function computeDiff(
  fromName: string,
  toName: string,
  fromTables: Record<string, MockRow[]>,
  toTables: Record<string, MockRow[]>,
): StateDiff {
  const allTables = Array.from(new Set([...Object.keys(fromTables), ...Object.keys(toTables)]))
  const tables: Record<string, TableDiff> = {}
  const tablesAdded: string[] = []
  const tablesRemoved: string[] = []
  const tablesModified: string[] = []
  let totalInserts = 0
  let totalDeletes = 0
  let totalUpdates = 0

  for (const table of allTables) {
    const fromRows = fromTables[table] ?? []
    const toRows = toTables[table] ?? []

    if (!fromTables[table]) {
      tablesAdded.push(table)
    } else if (!toTables[table]) {
      tablesRemoved.push(table)
    }

    const fromById = new Map(fromRows.map((r) => [r.id, r]))
    const toById = new Map(toRows.map((r) => [r.id, r]))

    const inserted: MockRow[] = []
    const deleted: MockRow[] = []
    const updated: Array<{ id: string; changes: Record<string, { from: unknown; to: unknown }> }> = []

    // Find inserts and updates
    for (const [id, toRow] of Array.from(toById.entries())) {
      const fromRow = fromById.get(id)
      if (!fromRow) {
        inserted.push(toRow)
      } else {
        const changes = diffRow(fromRow, toRow)
        if (Object.keys(changes).length > 0) {
          updated.push({ id, changes })
        }
      }
    }

    // Find deletes
    for (const [id, fromRow] of Array.from(fromById.entries())) {
      if (!toById.has(id)) {
        deleted.push(fromRow)
      }
    }

    if (inserted.length > 0 || deleted.length > 0 || updated.length > 0) {
      tables[table] = { inserted, deleted, updated }
      if (fromTables[table] && toTables[table]) {
        tablesModified.push(table)
      }
      totalInserts += inserted.length
      totalDeletes += deleted.length
      totalUpdates += updated.length
    }
  }

  return {
    from: fromName,
    to: toName,
    tables,
    summary: { tablesAdded, tablesRemoved, tablesModified, totalInserts, totalDeletes, totalUpdates },
  }
}

function diffRow(from: MockRow, to: MockRow): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  const allKeys = Array.from(new Set([...Object.keys(from), ...Object.keys(to)]))

  for (const key of allKeys) {
    if (JSON.stringify(from[key]) !== JSON.stringify(to[key])) {
      changes[key] = { from: from[key], to: to[key] }
    }
  }

  return changes
}

function sortById(rows: MockRow[]): MockRow[] {
  return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}
