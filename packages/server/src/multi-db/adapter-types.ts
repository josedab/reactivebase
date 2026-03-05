/**
 * Core types and interfaces for the multi-database adapter layer.
 */

// ─── Database Adapter Interface ──────────────────────────────────────────────

export interface DatabaseAdapter {
  /** Adapter name (e.g., "postgres", "sqlite", "mysql") */
  readonly name: string
  /** Database dialect for SQL generation */
  readonly dialect: DatabaseDialect

  /** Execute a query and return rows */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  /** Execute a statement (INSERT, UPDATE, DELETE) and return affected row count */
  execute(sql: string, params?: unknown[]): Promise<{ affectedRows: number; lastInsertId?: string }>
  /** Begin a transaction */
  beginTransaction(): Promise<TransactionHandle>
  /** Check database connectivity */
  ping(): Promise<boolean>
  /** Get adapter-specific database info */
  getInfo(): Promise<DatabaseAdapterInfo>
  /** Close the connection pool */
  close(): Promise<void>
}

export type DatabaseDialect = "postgres" | "mysql" | "sqlite"

export interface TransactionHandle {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  execute(sql: string, params?: unknown[]): Promise<{ affectedRows: number; lastInsertId?: string }>
  commit(): Promise<void>
  rollback(): Promise<void>
}

export interface DatabaseAdapterInfo {
  dialect: DatabaseDialect
  version: string
  maxConnections: number
  currentConnections: number
  supportsTransactions: boolean
  supportsReturning: boolean
  supportsJsonb: boolean
  supportsArrays: boolean
  supportsListenNotify: boolean
}

// ─── SQL Translation ─────────────────────────────────────────────────────────

export interface SQLTranslator {
  /** Convert $1, $2 parameter placeholders to dialect-specific format */
  translateParams(sql: string): string
  /** Generate a "RETURNING *" clause or equivalent */
  returning(columns?: string[]): string
  /** Generate UPSERT (INSERT ... ON CONFLICT) */
  upsert(table: string, columns: string[], conflictColumns: string[]): string
  /** Generate JSON aggregation */
  jsonAgg(expression: string): string
  /** Generate current timestamp */
  now(): string
  /** Generate UUID function */
  uuid(): string
  /** Generate LIMIT/OFFSET clause */
  paginate(limit: number, offset: number): string
  /** Boolean literal */
  boolean(value: boolean): string
}

// ─── Connection Pool ─────────────────────────────────────────────────────────

export interface ConnectionPoolAdapter {
  /** Total number of connections in the pool (active + idle) */
  readonly totalCount: number
  /** Number of connections currently in use */
  readonly activeCount: number
  /** Number of idle connections available */
  readonly idleCount: number
  /** Number of queued requests waiting for a connection */
  readonly waitingCount: number

  /** Acquire a connection from the pool */
  acquire(): Promise<PooledConnection>
  /** Release a connection back to the pool */
  release(connection: PooledConnection): void
  /** Register a callback invoked when the pool is drained (all connections returned) */
  onDrain(callback: () => void): void
}

export interface PooledConnection {
  /** Unique identifier for this pooled connection */
  readonly id: string
  /** Execute a query on this specific connection */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  /** Execute a statement on this specific connection */
  execute(sql: string, params?: unknown[]): Promise<{ affectedRows: number; lastInsertId?: string }>
}

// ─── CDC ─────────────────────────────────────────────────────────────────────

/** A change event emitted by the CDC adapter */
export interface CdcChangeEvent {
  /** Table where the change occurred */
  table: string
  /** Type of change */
  operation: "INSERT" | "UPDATE" | "DELETE"
  /** Row data after the change (null for DELETE) */
  newRow: Record<string, unknown> | null
  /** Row data before the change (null for INSERT) */
  oldRow: Record<string, unknown> | null
  /** Dialect-specific position marker */
  position: CdcPosition
}

/** Dialect-specific position in the change stream */
export type CdcPosition =
  | { type: "lsn"; lsn: string }
  | { type: "binlog"; file: string; position: number }
  | { type: "wal_offset"; offset: number }

export type CdcChangeCallback = (event: CdcChangeEvent) => void

export interface CdcAdapter {
  /** Start listening for changes on the specified tables */
  startListening(tables: string[], callback: CdcChangeCallback): Promise<void>
  /** Stop listening for changes */
  stopListening(): Promise<void>
  /** Get the current position in the change stream */
  getPosition(): Promise<CdcPosition>
}

// ─── CDC Options ─────────────────────────────────────────────────────────────

/** Options for the Postgres CDC adapter (logical replication) */
export interface PostgresCdcOptions {
  /** Replication slot name */
  slotName?: string
  /** Publication name */
  publicationName?: string
  /** Connection string for the replication connection */
  connectionString: string
}

/** Options for the MySQL CDC adapter (binlog replication) */
export interface MySQLCdcOptions {
  /** MySQL server ID for the replication client */
  serverId?: number
  /** Connection string */
  connectionString: string
}

/** Options for the SQLite CDC adapter (polling-based) */
export interface SQLiteCdcOptions {
  /** Database URL */
  url: string
  /** Polling interval in milliseconds (default: 1000) */
  pollIntervalMs?: number
}

// ─── Migrations ──────────────────────────────────────────────────────────────

export interface AppliedMigration {
  /** Migration name (unique identifier) */
  name: string
  /** SHA-256 checksum of the migration SQL */
  checksum: string
  /** Timestamp when the migration was applied */
  appliedAt: string
}

export interface MigrationAdapter {
  /** Create the migrations tracking table if it does not exist */
  createMigrationsTable(): Promise<void>
  /** Get the list of migrations that have already been applied */
  getAppliedMigrations(): Promise<AppliedMigration[]>
  /** Apply a migration and record it in the tracking table */
  applyMigration(name: string, sql: string, checksum: string): Promise<void>
  /** Rollback a migration and remove it from the tracking table */
  rollbackMigration(name: string, sql: string): Promise<void>
  /** Acquire an advisory lock to prevent concurrent migration runs */
  lockMigrations(): Promise<void>
  /** Release the advisory lock */
  unlockMigrations(): Promise<void>
}

// ─── Adapter Options ─────────────────────────────────────────────────────────

export interface PostgresAdapterOptions {
  connectionString: string
  poolSize?: number
  ssl?: boolean | "require"
}

export interface SQLiteAdapterOptions {
  /** Database URL: "file:local.db" or Turso URL "libsql://..." */
  url: string
  /** Auth token for Turso */
  authToken?: string
}

export interface MySQLAdapterOptions {
  connectionString: string
  poolSize?: number
  ssl?: boolean
}

// ─── Bundle ──────────────────────────────────────────────────────────────────

export interface AdapterBundle {
  /** Core database adapter */
  adapter: DatabaseAdapter
  /** Change data capture adapter */
  cdc: CdcAdapter
  /** Migration adapter */
  migrations: MigrationAdapter
  /** Connection pool adapter */
  pool: ConnectionPoolAdapter
}

export interface AdapterBundleOptions {
  /** Database connection string or URL */
  connectionString: string
  /** Connection pool size (ignored for SQLite) */
  poolSize?: number
  /** SSL configuration (Postgres and MySQL only) */
  ssl?: boolean | "require"
  /** Replication slot name (Postgres CDC only) */
  cdcSlotName?: string
  /** Polling interval for SQLite CDC in milliseconds */
  cdcPollIntervalMs?: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export class DatabaseAdapterError extends Error {
  constructor(
    message: string,
    public dialect: DatabaseDialect,
  ) {
    super(message)
    this.name = "DatabaseAdapterError"
  }
}

export function createStubTransaction(): TransactionHandle {
  return {
    async query<T>(_sql: string, _params?: unknown[]): Promise<T[]> {
      return [] as T[]
    },
    async execute(_sql: string, _params?: unknown[]): Promise<{ affectedRows: number }> {
      return { affectedRows: 0 }
    },
    async commit(): Promise<void> {},
    async rollback(): Promise<void> {},
  }
}

export function createStubPooledConnection(dialect: string): PooledConnection {
  return {
    id: `${dialect}-${Date.now()}`,
    async query<T>(_sql: string, _params?: unknown[]): Promise<T[]> {
      return [] as T[]
    },
    async execute(_sql: string, _params?: unknown[]): Promise<{ affectedRows: number; lastInsertId?: string }> {
      return { affectedRows: 0 }
    },
  }
}
