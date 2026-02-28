/**
 * Local-First Sync Engine with CRDT-based bidirectional sync.
 * Extends the offline sync concepts with:
 *   - Client-side SQLite schema sync for local tables
 *   - Write-ahead log (WAL) for offline mutations
 *   - Vector clock conflict detection for causal ordering
 *   - Bidirectional sync protocol with bandwidth-aware batching
 *   - Local-first reads from SQLite for instant UI
 *
 * Usage:
 *   const engine = new LocalFirstSyncEngine({
 *     clientId: "client-1",
 *     adapter: sqliteAdapter,
 *     conflictStrategy: "last-write-wins",
 *   })
 *   await engine.syncSchema({ tables: [{ name: "tasks", columns: [...] }] })
 *   await engine.applyLocalMutation("tasks", "insert", { id: "t1", title: "Buy milk" })
 *   const tasks = await engine.getLocalData("tasks", { where: { done: false } })
 *   await engine.syncWithServer(wsConnection)
 */

import type { VectorClock, ConflictStrategy, MergeFunction } from "./sync-engine.js"
import {
  createVectorClock,
  incrementClock,
  mergeClock,
  happensBefore,
  areConcurrent,
} from "./sync-engine.js"
import type { SQLiteAdapter } from "./sqlite-cache.js"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LocalFirstSyncOptions {
  /** Unique client identifier */
  clientId: string
  /** SQLite adapter instance */
  adapter: SQLiteAdapter
  /** Conflict resolution strategy (default: "last-write-wins") */
  conflictStrategy?: ConflictStrategy
  /** Custom merge function for "custom" strategy */
  customMerge?: MergeFunction
  /** Table prefix for internal tables (default: "rb_") */
  tablePrefix?: string
  /** Max WAL entries before auto-compact (default: 1000) */
  maxWalEntries?: number
  /** Callback for sync status changes */
  onSyncStatus?: (status: LocalFirstSyncStatus) => void
  /** Callback for conflict notifications */
  onConflict?: (entry: WriteAheadEntry, serverData: unknown) => void
}

export type LocalFirstSyncStatus = "idle" | "syncing" | "error" | "offline"

export interface SchemaDefinition {
  /** Tables to create in the local SQLite database */
  tables: TableDefinition[]
  /** Schema version for migrations */
  version?: number
}

export interface TableDefinition {
  /** Table name */
  name: string
  /** Column definitions */
  columns: ColumnDefinition[]
  /** Primary key column(s) (default: ["id"]) */
  primaryKey?: string[]
  /** Index definitions */
  indexes?: IndexDefinition[]
}

export interface ColumnDefinition {
  /** Column name */
  name: string
  /** SQLite column type */
  type: "TEXT" | "INTEGER" | "REAL" | "BLOB"
  /** Whether the column can be null (default: true) */
  nullable?: boolean
  /** Default value */
  defaultValue?: string | number | null
}

export interface IndexDefinition {
  /** Index name */
  name: string
  /** Columns to index */
  columns: string[]
  /** Whether the index is unique */
  unique?: boolean
}

export interface WriteAheadEntry {
  /** Unique entry identifier */
  id: string
  /** Target table name */
  table: string
  /** Mutation operation type */
  operation: "insert" | "update" | "delete"
  /** Mutation data payload */
  data: Record<string, unknown>
  /** Entry creation timestamp (ms since epoch) */
  timestamp: number
  /** Vector clock at the time of mutation */
  vectorClock: VectorClock
  /** Whether this entry has been synced to the server */
  synced: boolean
}

export interface SyncProtocolMessage {
  /** Message type */
  type: "sync-request" | "sync-response" | "ack"
  /** Client identifier */
  clientId: string
  /** State vector for incremental sync */
  stateVector: VectorClock
  /** Changed entries since the given state vector */
  changes?: SyncChange[]
  /** Whether more batches follow */
  hasMore?: boolean
  /** Batch sequence number */
  batchIndex?: number
}

export interface SyncChange {
  /** Target table */
  table: string
  /** Mutation operation */
  operation: "insert" | "update" | "delete"
  /** Row data */
  data: Record<string, unknown>
  /** Vector clock of the change */
  vectorClock: VectorClock
  /** Originating client */
  clientId: string
  /** Change timestamp */
  timestamp: number
}

export interface BandwidthConfig {
  /** Max bytes per second for sync traffic (0 = unlimited) */
  bytesPerSecond: number
  /** Max changes per batch (default: 50) */
  batchSize: number
}

export interface LocalQuery {
  /** WHERE clause conditions as key-value pairs */
  where?: Record<string, unknown>
  /** ORDER BY columns */
  orderBy?: Array<{ column: string; direction?: "ASC" | "DESC" }>
  /** LIMIT */
  limit?: number
  /** OFFSET */
  offset?: number
}

/** WebSocket-like connection interface used for sync */
export interface SyncConnection {
  send(data: string): void
  onmessage: ((event: { data: string }) => void) | null
  readyState: number
}

// ─── Write-Ahead Log ─────────────────────────────────────────────────────────

const WAL_TABLE = "rb_wal"

/**
 * Durable write-ahead log backed by SQLite.
 * Buffers all local mutations and tracks sync state per entry.
 *
 * Usage:
 *   const wal = new WriteAheadLog(adapter, "rb_")
 *   await wal.initialize()
 *   await wal.append({ id: "w1", table: "tasks", operation: "insert", ... })
 *   const unsynced = await wal.getUnsynced()
 *   await wal.markSynced(["w1"])
 */
export class WriteAheadLog {
  private adapter: SQLiteAdapter
  private tableName: string
  private maxEntries: number
  private initialized = false

  constructor(adapter: SQLiteAdapter, tablePrefix = "rb_", maxEntries = 1000) {
    this.adapter = adapter
    this.tableName = `${tablePrefix}wal`
    this.maxEntries = maxEntries
  }

  /** Create the WAL table if it does not exist. */
  async initialize(): Promise<void> {
    if (this.initialized) return
    await this.adapter.run(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        tbl TEXT NOT NULL,
        operation TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        vector_clock TEXT NOT NULL,
        synced INTEGER NOT NULL DEFAULT 0
      )
    `)
    await this.adapter.run(
      `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_synced ON ${this.tableName} (synced)`,
    )
    this.initialized = true
  }

  /**
   * Append a mutation entry to the write-ahead log.
   *
   * @param entry - The {@link WriteAheadEntry} to persist
   */
  async append(entry: WriteAheadEntry): Promise<void> {
    await this.ensureInitialized()
    await this.adapter.run(
      `INSERT INTO ${this.tableName} (id, tbl, operation, data, timestamp, vector_clock, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.table,
        entry.operation,
        JSON.stringify(entry.data),
        entry.timestamp,
        JSON.stringify(entry.vectorClock),
        entry.synced ? 1 : 0,
      ],
    )
  }

  /**
   * Retrieve all unsynced entries ordered by timestamp.
   *
   * @returns Array of unsynced {@link WriteAheadEntry} items
   */
  async getUnsynced(): Promise<WriteAheadEntry[]> {
    await this.ensureInitialized()
    const rows = await this.adapter.all<{
      id: string
      tbl: string
      operation: string
      data: string
      timestamp: number
      vector_clock: string
      synced: number
    }>(`SELECT * FROM ${this.tableName} WHERE synced = 0 ORDER BY timestamp ASC`)

    return rows.map((row) => ({
      id: row.id,
      table: row.tbl,
      operation: row.operation as WriteAheadEntry["operation"],
      data: JSON.parse(row.data) as Record<string, unknown>,
      timestamp: row.timestamp,
      vectorClock: JSON.parse(row.vector_clock) as VectorClock,
      synced: false,
    }))
  }

  /**
   * Mark entries as synced by their IDs.
   *
   * @param ids - Entry IDs to mark as synced
   */
  async markSynced(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await this.ensureInitialized()
    const placeholders = ids.map(() => "?").join(", ")
    await this.adapter.run(
      `UPDATE ${this.tableName} SET synced = 1 WHERE id IN (${placeholders})`,
      ids,
    )
  }

  /**
   * Remove synced entries to reclaim storage.
   * Keeps the WAL size under {@link maxEntries}.
   */
  async compact(): Promise<void> {
    await this.ensureInitialized()
    await this.adapter.run(`DELETE FROM ${this.tableName} WHERE synced = 1`)

    // If still over max, trim oldest synced-or-not entries
    const countRow = await this.adapter.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM ${this.tableName}`,
    )
    const count = countRow?.cnt ?? 0
    if (count > this.maxEntries) {
      const excess = count - this.maxEntries
      await this.adapter.run(
        `DELETE FROM ${this.tableName} WHERE id IN (
          SELECT id FROM ${this.tableName} ORDER BY timestamp ASC LIMIT ?
        )`,
        [excess],
      )
    }
  }

  /** Return the total number of entries in the WAL. */
  async size(): Promise<number> {
    await this.ensureInitialized()
    const row = await this.adapter.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM ${this.tableName}`,
    )
    return row?.cnt ?? 0
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) await this.initialize()
  }
}

// ─── Bidirectional Sync Protocol ─────────────────────────────────────────────

/**
 * Manages bidirectional sync with bandwidth-aware batching.
 * Compares state vectors for minimal data transfer and splits
 * large payloads into configurable batches.
 *
 * Usage:
 *   const protocol = new BidirectionalSyncProtocol("client-1")
 *   protocol.setBandwidthLimit(50_000) // 50 KB/s
 *   const request = protocol.createSyncRequest(localStateVector)
 *   // send request over WebSocket …
 *   protocol.applySyncResponse(response)
 */
export class BidirectionalSyncProtocol {
  private clientId: string
  private bandwidthConfig: BandwidthConfig = {
    bytesPerSecond: 0,
    batchSize: 50,
  }
  private pendingChanges: SyncChange[] = []

  constructor(clientId: string) {
    this.clientId = clientId
  }

  /**
   * Create a sync request message from the local state vector.
   * The server uses this to determine which changes the client is missing.
   *
   * @param stateVector - The client's current vector clock
   * @returns A {@link SyncProtocolMessage} of type "sync-request"
   */
  createSyncRequest(stateVector: VectorClock): SyncProtocolMessage {
    return {
      type: "sync-request",
      clientId: this.clientId,
      stateVector,
    }
  }

  /**
   * Apply a sync response from the server to the local pending changes list.
   * Returns the changes that need to be written to the local database.
   *
   * @param response - Server sync response message
   * @returns Array of {@link SyncChange} items to apply locally
   */
  applySyncResponse(response: SyncProtocolMessage): SyncChange[] {
    if (response.type !== "sync-response" || !response.changes) return []
    this.pendingChanges.push(...response.changes)

    if (!response.hasMore) {
      const changes = [...this.pendingChanges]
      this.pendingChanges = []
      return changes
    }

    return []
  }

  /**
   * Create a sync response on the server side.
   * Filters server data to only include changes the client hasn't seen,
   * then splits into bandwidth-aware batches.
   *
   * @param clientStateVector - The requesting client's state vector
   * @param serverData - All available changes on the server
   * @returns Array of {@link SyncProtocolMessage} batches
   */
  createSyncResponse(
    clientStateVector: VectorClock,
    serverData: SyncChange[],
  ): SyncProtocolMessage[] {
    // Filter to changes the client hasn't seen
    const missing = serverData.filter(
      (change) => !happensBefore(change.vectorClock, clientStateVector),
    )

    if (missing.length === 0) {
      return [
        {
          type: "sync-response",
          clientId: this.clientId,
          stateVector: clientStateVector,
          changes: [],
          hasMore: false,
          batchIndex: 0,
        },
      ]
    }

    // Split into batches
    const batches: SyncProtocolMessage[] = []
    for (let i = 0; i < missing.length; i += this.bandwidthConfig.batchSize) {
      const batchChanges = missing.slice(i, i + this.bandwidthConfig.batchSize)
      const isLast = i + this.bandwidthConfig.batchSize >= missing.length
      batches.push({
        type: "sync-response",
        clientId: this.clientId,
        stateVector: clientStateVector,
        changes: batchChanges,
        hasMore: !isLast,
        batchIndex: batches.length,
      })
    }

    return batches
  }

  /**
   * Set a bandwidth limit for sync traffic.
   * When set, batches are sized to stay within the byte budget.
   *
   * @param bytesPerSecond - Max bytes per second (0 = unlimited)
   */
  setBandwidthLimit(bytesPerSecond: number): void {
    this.bandwidthConfig.bytesPerSecond = bytesPerSecond
    // Adjust batch size based on bandwidth (rough estimate: ~200 bytes per change)
    if (bytesPerSecond > 0) {
      this.bandwidthConfig.batchSize = Math.max(1, Math.floor(bytesPerSecond / 200))
    }
  }

  /** Get the current bandwidth configuration. */
  get bandwidth(): BandwidthConfig {
    return { ...this.bandwidthConfig }
  }

  /**
   * Compare two state vectors to determine sync direction.
   *
   * @returns "ahead" if local is ahead, "behind" if local is behind,
   *          "diverged" if concurrent, "equal" if identical
   */
  compareStateVectors(
    local: VectorClock,
    remote: VectorClock,
  ): "ahead" | "behind" | "diverged" | "equal" {
    const localAhead = happensBefore(remote, local)
    const remoteAhead = happensBefore(local, remote)

    if (localAhead) return "ahead"
    if (remoteAhead) return "behind"
    if (areConcurrent(local, remote)) return "diverged"
    return "equal"
  }
}

// ─── Local-First Sync Engine ─────────────────────────────────────────────────

const DEFAULT_LOCAL_FIRST_OPTIONS = {
  conflictStrategy: "last-write-wins" as ConflictStrategy,
  tablePrefix: "rb_",
  maxWalEntries: 1000,
}

let walIdCounter = 0

function generateWalId(): string {
  walIdCounter++
  return `wal_${Date.now()}_${walIdCounter}`
}

/**
 * Local-first sync engine that writes to a local SQLite database first,
 * then syncs bidirectionally with the server using vector clocks.
 *
 * Usage:
 *   const engine = new LocalFirstSyncEngine({
 *     clientId: "client-1",
 *     adapter: sqliteAdapter,
 *   })
 *
 *   // Set up local schema
 *   await engine.syncSchema({
 *     tables: [{
 *       name: "tasks",
 *       columns: [
 *         { name: "id", type: "TEXT" },
 *         { name: "title", type: "TEXT" },
 *         { name: "done", type: "INTEGER" },
 *       ],
 *       primaryKey: ["id"],
 *     }],
 *   })
 *
 *   // Write locally (instant)
 *   await engine.applyLocalMutation("tasks", "insert", { id: "t1", title: "Buy milk", done: 0 })
 *
 *   // Read from local DB
 *   const tasks = await engine.getLocalData("tasks", { where: { done: 0 } })
 *
 *   // Sync with server when online
 *   await engine.syncWithServer(wsConnection)
 */
export class LocalFirstSyncEngine {
  private options: Required<
    Omit<LocalFirstSyncOptions, "customMerge" | "onSyncStatus" | "onConflict">
  > &
    Pick<LocalFirstSyncOptions, "customMerge" | "onSyncStatus" | "onConflict">
  private adapter: SQLiteAdapter
  private clock: VectorClock
  private wal: WriteAheadLog
  private protocol: BidirectionalSyncProtocol
  private syncStatus: LocalFirstSyncStatus = "idle"
  private schemas = new Map<string, TableDefinition>()

  constructor(options: LocalFirstSyncOptions) {
    this.options = { ...DEFAULT_LOCAL_FIRST_OPTIONS, ...options }
    this.adapter = options.adapter
    this.clock = createVectorClock(options.clientId)
    this.wal = new WriteAheadLog(this.adapter, this.options.tablePrefix, this.options.maxWalEntries)
    this.protocol = new BidirectionalSyncProtocol(options.clientId)
  }

  /** The write-ahead log instance for direct access. */
  get writeAheadLog(): WriteAheadLog {
    return this.wal
  }

  /** Current vector clock. */
  get vectorClock(): VectorClock {
    return { ...this.clock }
  }

  /** Current sync status. */
  get status(): LocalFirstSyncStatus {
    return this.syncStatus
  }

  /** The underlying sync protocol. */
  get syncProtocol(): BidirectionalSyncProtocol {
    return this.protocol
  }

  /** Unique client identifier. */
  get clientId(): string {
    return this.options.clientId
  }

  // ─── Schema Management ──────────────────────────────────────────────────────

  /**
   * Create local SQLite tables from a schema definition.
   * Existing tables are left unchanged (CREATE TABLE IF NOT EXISTS).
   *
   * @param schema - The {@link SchemaDefinition} describing tables and columns
   */
  async syncSchema(schema: SchemaDefinition): Promise<void> {
    for (const table of schema.tables) {
      const pk = table.primaryKey ?? ["id"]
      const columnDefs = table.columns.map((col) => {
        let def = `${col.name} ${col.type}`
        if (col.nullable === false) def += " NOT NULL"
        if (col.defaultValue !== undefined) def += ` DEFAULT ${col.defaultValue}`
        return def
      })

      const sql = `CREATE TABLE IF NOT EXISTS ${table.name} (
  ${columnDefs.join(",\n  ")},
  PRIMARY KEY (${pk.join(", ")})
)`
      await this.adapter.run(sql)

      // Create indexes
      if (table.indexes) {
        for (const idx of table.indexes) {
          const unique = idx.unique ? "UNIQUE " : ""
          await this.adapter.run(
            `CREATE ${unique}INDEX IF NOT EXISTS ${idx.name} ON ${table.name} (${idx.columns.join(", ")})`,
          )
        }
      }

      this.schemas.set(table.name, table)
    }

    // Ensure WAL table exists
    await this.wal.initialize()
  }

  // ─── Local Mutations ────────────────────────────────────────────────────────

  /**
   * Apply a mutation to the local SQLite database and append to the WAL.
   * Writes are immediate — no network round-trip required.
   *
   * @param table - Target table name
   * @param operation - "insert", "update", or "delete"
   * @param data - Row data (must include primary key for update/delete)
   * @returns The WAL entry ID
   */
  async applyLocalMutation(
    table: string,
    operation: "insert" | "update" | "delete",
    data: Record<string, unknown>,
  ): Promise<string> {
    this.clock = incrementClock(this.clock, this.options.clientId)

    // Apply to local SQLite
    switch (operation) {
      case "insert": {
        const keys = Object.keys(data)
        const placeholders = keys.map(() => "?").join(", ")
        await this.adapter.run(
          `INSERT OR REPLACE INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`,
          keys.map((k) => data[k]),
        )
        break
      }
      case "update": {
        const entries = Object.entries(data)
        const pk = this.schemas.get(table)?.primaryKey ?? ["id"]
        const setClauses = entries.filter(([k]) => !pk.includes(k)).map(([k]) => `${k} = ?`)
        const setValues = entries.filter(([k]) => !pk.includes(k)).map(([, v]) => v)
        const whereClauses = pk.map((k) => `${k} = ?`)
        const whereValues = pk.map((k) => data[k])

        if (setClauses.length > 0) {
          await this.adapter.run(
            `UPDATE ${table} SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")}`,
            [...setValues, ...whereValues],
          )
        }
        break
      }
      case "delete": {
        const pk = this.schemas.get(table)?.primaryKey ?? ["id"]
        const whereClauses = pk.map((k) => `${k} = ?`)
        const whereValues = pk.map((k) => data[k])
        await this.adapter.run(
          `DELETE FROM ${table} WHERE ${whereClauses.join(" AND ")}`,
          whereValues,
        )
        break
      }
    }

    // Append to WAL
    const entry: WriteAheadEntry = {
      id: generateWalId(),
      table,
      operation,
      data,
      timestamp: Date.now(),
      vectorClock: { ...this.clock },
      synced: false,
    }
    await this.wal.append(entry)

    return entry.id
  }

  // ─── Local Reads ────────────────────────────────────────────────────────────

  /**
   * Read data from the local SQLite database.
   *
   * @param table - Table name to query
   * @param query - Optional query filters, ordering, and pagination
   * @returns Array of matching rows
   */
  async getLocalData<T = Record<string, unknown>>(
    table: string,
    query?: LocalQuery,
  ): Promise<T[]> {
    let sql = `SELECT * FROM ${table}`
    const params: unknown[] = []

    if (query?.where && Object.keys(query.where).length > 0) {
      const conditions = Object.entries(query.where).map(([key]) => {
        return `${key} = ?`
      })
      params.push(...Object.values(query.where))
      sql += ` WHERE ${conditions.join(" AND ")}`
    }

    if (query?.orderBy && query.orderBy.length > 0) {
      const orderClauses = query.orderBy.map(
        (o) => `${o.column} ${o.direction ?? "ASC"}`,
      )
      sql += ` ORDER BY ${orderClauses.join(", ")}`
    }

    if (query?.limit !== undefined) {
      sql += ` LIMIT ?`
      params.push(query.limit)
    }

    if (query?.offset !== undefined) {
      sql += ` OFFSET ?`
      params.push(query.offset)
    }

    return this.adapter.all<T>(sql, params)
  }

  // ─── Server Sync ────────────────────────────────────────────────────────────

  /**
   * Perform bidirectional sync with the server over a WebSocket connection.
   * Sends unsynced local mutations and applies incoming server changes.
   *
   * @param connection - A WebSocket-like {@link SyncConnection}
   * @returns Promise that resolves when the sync round-trip completes
   */
  async syncWithServer(connection: SyncConnection): Promise<void> {
    if (this.syncStatus === "syncing") return

    this.updateStatus("syncing")

    try {
      // Gather unsynced local changes
      const unsynced = await this.wal.getUnsynced()

      // Build sync request with local changes
      const request = this.protocol.createSyncRequest(this.clock)
      const message: SyncProtocolMessage = {
        ...request,
        changes: unsynced.map((entry) => ({
          table: entry.table,
          operation: entry.operation,
          data: entry.data,
          vectorClock: entry.vectorClock,
          clientId: this.options.clientId,
          timestamp: entry.timestamp,
        })),
      }

      // Send to server
      connection.send(JSON.stringify(message))

      // Listen for server response
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Sync timeout"))
        }, 30_000)

        connection.onmessage = async (event: { data: string }) => {
          try {
            const response = JSON.parse(event.data) as SyncProtocolMessage

            if (response.type === "sync-response") {
              const changes = this.protocol.applySyncResponse(response)

              // Apply server changes locally
              for (const change of changes) {
                await this.applyRemoteChange(change)
              }

              // If no more batches, mark local entries as synced
              if (!response.hasMore) {
                await this.wal.markSynced(unsynced.map((e) => e.id))

                // Compact WAL if needed
                const walSize = await this.wal.size()
                if (walSize > this.options.maxWalEntries) {
                  await this.wal.compact()
                }

                clearTimeout(timeout)
                resolve()
              }
            } else if (response.type === "ack") {
              await this.wal.markSynced(unsynced.map((e) => e.id))
              clearTimeout(timeout)
              resolve()
            }
          } catch (err) {
            clearTimeout(timeout)
            reject(err)
          }
        }
      })

      this.updateStatus("idle")
    } catch (error) {
      this.updateStatus("error")
      throw error
    }
  }

  /**
   * Merge a remote vector clock into the local clock.
   *
   * @param remoteClock - The remote client's vector clock
   */
  receiveClock(remoteClock: VectorClock): void {
    this.clock = mergeClock(this.clock, remoteClock)
    this.clock = incrementClock(this.clock, this.options.clientId)
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private async applyRemoteChange(change: SyncChange): Promise<void> {
    // Detect conflicts using vector clocks
    if (areConcurrent(change.vectorClock, this.clock)) {
      this.options.onConflict?.(
        {
          id: `remote_${change.timestamp}`,
          table: change.table,
          operation: change.operation,
          data: change.data,
          timestamp: change.timestamp,
          vectorClock: change.vectorClock,
          synced: true,
        },
        change.data,
      )
    }

    // Apply the change to local DB
    switch (change.operation) {
      case "insert": {
        const keys = Object.keys(change.data)
        const placeholders = keys.map(() => "?").join(", ")
        await this.adapter.run(
          `INSERT OR REPLACE INTO ${change.table} (${keys.join(", ")}) VALUES (${placeholders})`,
          keys.map((k) => change.data[k]),
        )
        break
      }
      case "update": {
        const entries = Object.entries(change.data)
        const pk = this.schemas.get(change.table)?.primaryKey ?? ["id"]
        const setClauses = entries.filter(([k]) => !pk.includes(k)).map(([k]) => `${k} = ?`)
        const setValues = entries.filter(([k]) => !pk.includes(k)).map(([, v]) => v)
        const whereClauses = pk.map((k) => `${k} = ?`)
        const whereValues = pk.map((k) => change.data[k])

        if (setClauses.length > 0) {
          await this.adapter.run(
            `UPDATE ${change.table} SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")}`,
            [...setValues, ...whereValues],
          )
        }
        break
      }
      case "delete": {
        const pk = this.schemas.get(change.table)?.primaryKey ?? ["id"]
        const whereClauses = pk.map((k) => `${k} = ?`)
        const whereValues = pk.map((k) => change.data[k])
        await this.adapter.run(
          `DELETE FROM ${change.table} WHERE ${whereClauses.join(" AND ")}`,
          whereValues,
        )
        break
      }
    }

    // Merge remote clock
    this.clock = mergeClock(this.clock, change.vectorClock)
  }

  private updateStatus(status: LocalFirstSyncStatus): void {
    this.syncStatus = status
    this.options.onSyncStatus?.(status)
  }
}
